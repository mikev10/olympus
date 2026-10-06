/**
 * The CLI: a client of the runtime's HTTP API and nothing more (I9).
 * Every command is one or two HTTP requests to the URL it is given. There is
 * no default URL: a CLI that guessed one could reach a server nobody chose.
 *
 * The CLI imports types from `@olympus-ai/api` and no code; `import type` is
 * erased, so nothing of the runtime runs in this process (D-P9-07).
 */
import { parseArgs } from 'node:util';
import type { ApproveBody, CreateRunBody, ErrorBody } from '@olympus-ai/api';

export interface CliIo {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  out(line: string): void;
  err(line: string): void;
}

/** 0: done. 1: the server refused or failed. 2: the command line was wrong, or no server was reached. */
export type ExitCode = 0 | 1 | 2;

/** The executable's name: the package name, which the I10 scan exempts exactly and nowhere else. */
const COMMAND = 'olympus-ai';

const USAGE = [
  `usage: ${COMMAND} <command> [options]`,
  '',
  'commands:',
  '  create   --workspace <abs path> --base-commit <sha> --level <0-3> --spec <path>... --tests <path>...',
  '           --manifest <path> --graph <path> [--approve-cost <usd>]',
  '  status   <run id>',
  '  approve  <run id> <station:level>',
  '  cancel   <run id>',
  '  events   <run id>',
  '  report   <run id>      cost, cache-hit rate, gates, iterations, mismatches, refusals, and the merge, from the Vault',
  '',
  'every command needs --url <api url> (or FACTORY_API_URL) and --token <token> (or FACTORY_API_TOKEN)',
].join('\n');

class UsageError extends Error {}

interface Target {
  readonly url: URL;
  readonly token: string;
}

function target(values: { url?: string | undefined; token?: string | undefined }, env: CliIo['env']): Target {
  const url = values.url ?? env.FACTORY_API_URL;
  const token = values.token ?? env.FACTORY_API_TOKEN;
  if (url === undefined || url === '') throw new UsageError('no API URL: pass --url or set FACTORY_API_URL');
  if (token === undefined || token === '') throw new UsageError('no token: pass --token or set FACTORY_API_TOKEN');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UsageError(`'${url}' is not a URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new UsageError(`'${url}' is not an http or https URL`);
  return { url: parsed, token };
}

function endpoint(t: Target, path: string): URL {
  const base = t.url.href.endsWith('/') ? t.url.href : `${t.url.href}/`;
  return new URL(path, base);
}

function runPath(runId: string, action?: string): string {
  const id = encodeURIComponent(runId);
  return action === undefined ? `runs/${id}` : `runs/${id}/${action}`;
}

async function call(io: CliIo, t: Target, method: 'GET' | 'POST', path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { authorization: `Bearer ${t.token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await io.fetch(endpoint(t, path), body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    // Not JSON: shown as the server sent it.
  }
  return { status: res.status, body: parsed };
}

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Prints a response: the body on stdout when it succeeded, the error on stderr when it did not. */
function report(io: CliIo, res: { status: number; body: unknown }): ExitCode {
  if (res.status >= 200 && res.status < 300) {
    io.out(json(res.body));
    return 0;
  }
  if (isErrorBody(res.body)) {
    io.err(`error ${String(res.status)} ${res.body.error}: ${res.body.message}`);
    if (res.body.refusal !== undefined) io.err(json(res.body.refusal));
  } else {
    io.err(`error ${String(res.status)}: ${typeof res.body === 'string' ? res.body : json(res.body)}`);
  }
  return 1;
}

interface CostRefusal {
  readonly reason: 'cost-unapproved';
  readonly worstCase: { readonly usd: number; readonly calls: number };
}

function costRefusal(value: unknown): CostRefusal | undefined {
  if (!isErrorBody(value)) return undefined;
  const refusal = value.refusal as Partial<CostRefusal> | undefined;
  return refusal?.reason === 'cost-unapproved' && typeof refusal.worstCase?.usd === 'number' ? (refusal as CostRefusal) : undefined;
}

function level(text: string | undefined): CreateRunBody['requestedLevel'] {
  if (text === '0' || text === '1' || text === '2' || text === '3') return Number(text) as CreateRunBody['requestedLevel'];
  throw new UsageError('--level must be 0, 1, 2, or 3');
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value === '') throw new UsageError(`${flag} is required`);
  return value;
}

function cost(text: string | undefined): number | null {
  if (text === undefined) return null;
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) throw new UsageError('--approve-cost must be a number of dollars');
  return value;
}

async function create(io: CliIo, t: Target, args: string[]): Promise<ExitCode> {
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      workspace: { type: 'string' },
      'base-commit': { type: 'string' },
      level: { type: 'string' },
      spec: { type: 'string', multiple: true },
      tests: { type: 'string', multiple: true },
      manifest: { type: 'string' },
      graph: { type: 'string' },
      'approve-cost': { type: 'string' },
    },
  });
  if (positionals.length > 0) throw new UsageError(`create takes no positional arguments: ${positionals.join(' ')}`);
  const body: CreateRunBody = {
    workspace: required(values.workspace, '--workspace'),
    baseCommit: required(values['base-commit'], '--base-commit'),
    requestedLevel: level(values.level),
    artifacts: {
      spec: values.spec ?? [],
      acceptanceTests: values.tests ?? [],
      verificationManifest: required(values.manifest, '--manifest'),
      taskGraph: required(values.graph, '--graph'),
    },
    approvedCostUsd: cost(values['approve-cost']),
  };
  const res = await call(io, t, 'POST', 'runs', body);
  const unapproved = costRefusal(res.body);
  if (unapproved !== undefined) {
    const { usd, calls } = unapproved.worstCase;
    io.err(`the worst-case cost of this run is $${String(usd)}, over at most ${String(calls)} driver calls`);
    io.err(body.approvedCostUsd === null
      ? `nothing was started; to approve it, run the same command with --approve-cost ${String(usd)}`
      : `nothing was started; --approve-cost ${String(body.approvedCostUsd)} is not that figure`);
    return 1;
  }
  return report(io, res);
}

function one(positionals: string[], names: readonly string[]): string[] {
  if (positionals.length !== names.length) throw new UsageError(`expected ${names.join(' ')}`);
  return positionals;
}

/** Reads the server-sent stream and prints one line per event: its name, then its JSON data. */
async function events(io: CliIo, t: Target, runId: string): Promise<ExitCode> {
  const res = await io.fetch(endpoint(t, runPath(runId, 'events')), { headers: { authorization: `Bearer ${t.token}`, accept: 'text/event-stream' } });
  if (res.status !== 200 || res.body === null) return report(io, { status: res.status, body: await res.text().then((text) => { try { return JSON.parse(text) as unknown; } catch { return text; } }) });
  const decoder = new TextDecoder();
  let buffered = '';
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (value !== undefined) buffered += decoder.decode(value, { stream: true });
    for (let end = buffered.indexOf('\n\n'); end !== -1; end = buffered.indexOf('\n\n')) {
      const block = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      let name = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) name = line.slice('event: '.length);
        else if (line.startsWith('data: ')) data.push(line.slice('data: '.length));
      }
      io.out(`${name} ${data.join('\n')}`);
    }
    if (done) return 0;
  }
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      strict: false,
      allowPositionals: true,
      options: { url: { type: 'string' }, token: { type: 'string' }, help: { type: 'boolean' } },
    });
    const [command, ...rest] = positionals;
    if (values.help === true || command === undefined) {
      io.out(USAGE);
      return command === undefined && values.help !== true ? 2 : 0;
    }
    const t = target({ url: typeof values.url === 'string' ? values.url : undefined, token: typeof values.token === 'string' ? values.token : undefined }, io.env);
    // What remains once the global options are taken out: the command's own arguments.
    const own = stripGlobals(argv).slice(1);
    switch (command) {
      case 'create':
        return await create(io, t, own);
      case 'status': {
        const [runId = ''] = one(rest, ['<run id>']);
        return report(io, await call(io, t, 'GET', runPath(runId)));
      }
      case 'approve': {
        const [runId = '', key = ''] = one(rest, ['<run id>', '<station:level>']);
        const body: ApproveBody = { key: key as ApproveBody['key'] };
        return report(io, await call(io, t, 'POST', runPath(runId, 'approve'), body));
      }
      case 'cancel': {
        const [runId = ''] = one(rest, ['<run id>']);
        return report(io, await call(io, t, 'POST', runPath(runId, 'cancel')));
      }
      case 'events': {
        const [runId = ''] = one(rest, ['<run id>']);
        return await events(io, t, runId);
      }
      case 'report': {
        const [runId = ''] = one(rest, ['<run id>']);
        return report(io, await call(io, t, 'GET', runPath(runId, 'report')));
      }
      default:
        throw new UsageError(`unknown command '${command}'`);
    }
  } catch (error) {
    if (error instanceof UsageError || (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))) {
      io.err(error.message);
      io.err(USAGE);
      return 2;
    }
    io.err(`could not reach the API: ${error instanceof Error ? error.message : 'unknown error'}`);
    return 2;
  }
}

/** The argument vector without `--url`, `--token`, and their values, in either `--flag value` or `--flag=value` form. */
function stripGlobals(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--url' || arg === '--token') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--url=') || arg.startsWith('--token=')) continue;
    out.push(arg);
  }
  return out;
}
