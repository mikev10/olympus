/**
 * The CLI: a client of the runtime's HTTP API and nothing more (I9).
 * Every command is one or two HTTP requests to the URL it is given. There is
 * no default URL: a CLI that guessed one could reach a server nobody chose.
 *
 * The CLI imports types from `@olympus-ai/api` and no code; `import type` is
 * erased, so nothing of the runtime runs in this process (D-P9-07).
 */
import { parseArgs } from 'node:util';
import type { ApproveBody, CreateRunBody, ErrorBody, RejectBody, TelemetryExport } from '@olympus-ai/api';

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

/** One flag: how the parser reads it and the line `--help` prints for it. */
export interface Flag {
  readonly type: 'string' | 'boolean';
  readonly multiple?: true;
  /** The value's placeholder in help, for a string flag. */
  readonly value?: string;
  readonly help: string;
}

export interface Command {
  readonly name: string;
  /** The positional arguments, as help writes them. */
  readonly args: string;
  readonly summary: string;
  readonly flags: Readonly<Record<string, Flag>>;
}

/**
 * Every command and its flags (R35, #126): the parser's options are built
 * from this table and `<command> --help` prints it, so a flag cannot be
 * accepted without being documented, or documented without being accepted.
 */
export const COMMANDS: readonly Command[] = [
  {
    name: 'create', args: '', summary: 'admit a run; a refusal names what to fix',
    flags: {
      workspace: { type: 'string', value: '<abs path>', help: 'required: the host\'s FACTORY_REPOSITORY, as an absolute path' },
      'base-commit': { type: 'string', value: '<sha>', help: 'required: the commit the run starts from, as a full sha' },
      level: { type: 'string', value: '<0-3>', help: 'required: the autonomy level asked for; more than policy allows is refused' },
      spec: { type: 'string', multiple: true, value: '<path>', help: 'a spec file, relative to the workspace; repeatable; or --draft-spec' },
      tests: { type: 'string', multiple: true, value: '<path>', help: 'an acceptance-test file, relative to the workspace; repeatable; or --draft-tests' },
      manifest: { type: 'string', value: '<path>', help: 'required: the verification manifest, the checks the runtime runs' },
      graph: { type: 'string', value: '<path>', help: 'required: the task graph' },
      'security-part': { type: 'string', value: '<path>', help: 'the spec\'s security part; without it the run is refused at the spec exit' },
      'run-requirements': { type: 'string', value: '<path>', help: 'the spec\'s run-requirements part' },
      questions: { type: 'string', value: '<path>', help: 'the spec\'s questions part' },
      'acceptance-manifest': { type: 'string', value: '<path>', help: 'the acceptance checks\' manifest, run on the base before build' },
      'approve-cost': { type: 'string', value: '<usd>', help: 'approves the worst-case cost in US dollars, the figure a refused create prints' },
      'draft-spec': { type: 'boolean', help: 'draft the spec on the line from --intent instead of naming it; needs FACTORY_RUBRICS_DIR' },
      'draft-tests': { type: 'boolean', help: 'draft the acceptance tests on the line instead of naming them' },
      intent: { type: 'string', value: '<text>', help: 'what the run is for, the text a drafted spec is written from' },
    },
  },
  { name: 'status', args: '<run id>', summary: 'the run\'s station, tasks, and gates', flags: {} },
  {
    name: 'approve', args: '<run id> <station:level>', summary: 'pass a gate the policy holds for a person',
    flags: { draft: { type: 'string', value: '<hash>', help: 'the draft approved, as status names it, at a drafting station' } },
  },
  {
    name: 'reject', args: '<run id> <station:level>', summary: 'send a draft back',
    flags: {
      draft: { type: 'string', value: '<hash>', help: 'required: the draft rejected' },
      notes: { type: 'string', value: '<text>', help: 'at spec: what to change' },
      reason: { type: 'string', value: '<reason>', help: 'at test-design: not-black-box, does-not-follow-spec, not-runnable, or misses-spec-cases' },
    },
  },
  { name: 'cancel', args: '<run id>', summary: 'stop a run', flags: {} },
  { name: 'events', args: '<run id>', summary: 'stream the run\'s events, one line each', flags: {} },
  { name: 'report', args: '<run id>', summary: 'cost, cache-hit rate, gates, iterations, mismatches, refusals, and the merge, from the Vault', flags: {} },
  {
    name: 'outcomes', args: '', summary: 'safety and throughput rates over every run, each with its sample and bound',
    flags: {
      from: { type: 'string', value: '<time>', help: 'only runs admitted at or after this ISO time' },
      to: { type: 'string', value: '<time>', help: 'only runs admitted before this ISO time' },
    },
  },
  {
    name: 'telemetry', args: '<run id>...', summary: 'a finished run as OTLP/JSON traces and metrics, printed or sent to a collector',
    flags: {
      endpoint: { type: 'string', value: '<otlp url>', help: 'send to <url>/v1/traces and /v1/metrics (or OTEL_EXPORTER_OTLP_ENDPOINT)' },
      header: { type: 'string', multiple: true, value: '<name=value>', help: 'a collector header; repeatable (or OTEL_EXPORTER_OTLP_HEADERS)' },
    },
  },
  {
    name: 'readiness', args: '', summary: 'the autonomy ceiling the host\'s repository supports at a commit, with every probe\'s outcome',
    flags: { revision: { type: 'string', value: '<rev>', help: 'the revision scanned; default HEAD of the host\'s FACTORY_REPOSITORY' } },
  },
];

/** The flags every command takes, read before the command's own. */
export const GLOBAL_FLAGS: Readonly<Record<string, Flag>> = {
  url: { type: 'string', value: '<api url>', help: 'the API\'s address (or FACTORY_API_URL)' },
  token: { type: 'string', value: '<token>', help: 'the API\'s token (or FACTORY_API_TOKEN)' },
  help: { type: 'boolean', help: 'print this help' },
};

function flagLines(flags: Readonly<Record<string, Flag>>): string[] {
  const left = Object.entries(flags).map(([name, f]) => `--${name}${f.value === undefined ? '' : ` ${f.value}`}${f.multiple === true ? '...' : ''}`);
  const width = Math.max(0, ...left.map((l) => l.length));
  return Object.values(flags).map((f, i) => `  ${(left[i] ?? '').padEnd(width)}  ${f.help}`);
}

/** One command's help: its usage, then one line per flag, then the global flags. */
export function commandHelp(command: Command): string {
  const own = Object.keys(command.flags).length === 0 ? [] : ['', 'options:', ...flagLines(command.flags)];
  return [`usage: ${COMMAND} ${command.name}${command.args === '' ? '' : ` ${command.args}`}${Object.keys(command.flags).length === 0 ? '' : ' [options]'}`, '', command.summary, ...own, '', 'global options:', ...flagLines(GLOBAL_FLAGS)].join('\n');
}

const width = Math.max(...COMMANDS.map((c) => c.name.length));
const USAGE = [
  `usage: ${COMMAND} <command> [options]`,
  '',
  'commands:',
  ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
  '',
  `${COMMAND} <command> --help prints one line per flag`,
  'every command needs --url <api url> (or FACTORY_API_URL) and --token <token> (or FACTORY_API_TOKEN)',
].join('\n');

/** The parser's options for one command, from the table. */
function optionsOf(name: string): Record<string, { type: 'string' | 'boolean'; multiple?: boolean }> {
  const command = COMMANDS.find((c) => c.name === name);
  if (command === undefined) throw new UsageError(`unknown command '${name}'`);
  return Object.fromEntries(Object.entries(command.flags).map(([flag, f]) => [flag, f.multiple === true ? { type: f.type, multiple: true } : { type: f.type }]));
}

/** A command's own arguments, parsed strictly against its row of the table. */
function parseOwn(name: string, args: string[]): { values: Record<string, string | boolean | Array<string | boolean> | undefined>; positionals: string[] } {
  return parseArgs({ args, strict: true, allowPositionals: true, options: optionsOf(name) });
}

type Parsed = ReturnType<typeof parseOwn>['values'];
const str = (values: Parsed, flag: string): string | undefined => (typeof values[flag] === 'string' ? values[flag] : undefined);
const strs = (values: Parsed, flag: string): string[] | undefined => {
  const value = values[flag];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
};
const bool = (values: Parsed, flag: string): boolean => values[flag] === true;

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
  /** Absent from a service that predates R2; the line is then not printed. */
  readonly likely?:
    | { readonly kind: 'likely'; readonly usd: number }
    | { readonly kind: 'insufficient-sample'; readonly short: ReadonlyArray<{ readonly station: string; readonly model: string; readonly sample: number }>; readonly needed: number };
}

/** The likely figure, said beside the bound and never as the figure approved. */
function likelyLine(likely: CostRefusal['likely']): string | undefined {
  if (likely === undefined) return undefined;
  if (likely.kind === 'likely') return `past runs put its likely cost at $${String(Number(likely.usd.toFixed(6)))}; the worst case is what is approved`;
  const cells = likely.short.map((c) => `${c.station} on ${c.model} (${String(c.sample)})`).join(', ');
  return `no likely cost: fewer than ${String(likely.needed)} past tasks at ${cells}`;
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
  const { values, positionals } = parseOwn('create', args);
  if (positionals.length > 0) throw new UsageError(`create takes no positional arguments: ${positionals.join(' ')}`);
  const spec = strs(values, 'spec');
  const tests = strs(values, 'tests');
  // A drafted artifact is drafted on the line instead of named here (R19); naming both is a contradiction.
  if (bool(values, 'draft-spec') && spec !== undefined) throw new UsageError('--draft-spec and --spec name the spec twice');
  if (bool(values, 'draft-tests') && tests !== undefined) throw new UsageError('--draft-tests and --tests name the acceptance tests twice');
  const security = str(values, 'security-part');
  const runRequirements = str(values, 'run-requirements');
  const questions = str(values, 'questions');
  const parts = {
    ...(security === undefined ? {} : { security }),
    ...(runRequirements === undefined ? {} : { runRequirements }),
    ...(questions === undefined ? {} : { questions }),
  };
  const acceptanceManifest = str(values, 'acceptance-manifest');
  const intent = str(values, 'intent');
  const body: CreateRunBody = {
    workspace: required(str(values, 'workspace'), '--workspace'),
    baseCommit: required(str(values, 'base-commit'), '--base-commit'),
    requestedLevel: level(str(values, 'level')),
    artifacts: {
      spec: bool(values, 'draft-spec') ? 'draft' : (spec ?? []),
      acceptanceTests: bool(values, 'draft-tests') ? 'draft' : (tests ?? []),
      verificationManifest: required(str(values, 'manifest'), '--manifest'),
      taskGraph: required(str(values, 'graph'), '--graph'),
      ...(acceptanceManifest === undefined ? {} : { acceptanceManifest }),
      // Optional on the wire: a spec created without its security part is refused at the spec exit, naming the part (R17).
      ...(Object.keys(parts).length === 0 ? {} : { specParts: parts }),
    },
    approvedCostUsd: cost(str(values, 'approve-cost')),
    ...(intent === undefined ? {} : { intent }),
  };
  const res = await call(io, t, 'POST', 'runs', body);
  const unapproved = costRefusal(res.body);
  if (unapproved !== undefined) {
    const { usd, calls } = unapproved.worstCase;
    io.err(`the worst-case cost of this run is $${String(usd)}, over at most ${String(calls)} driver calls`);
    const likely = likelyLine(unapproved.likely);
    if (likely !== undefined) io.err(likely);
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

/**
 * Reads a server-sent stream, calling `onEvent` with each event's name and
 * data; a block that is only a comment, a keep-alive, is skipped. A response
 * that is not a stream is reported as any other and its exit code returned.
 */
async function stream(io: CliIo, t: Target, path: string, onEvent: (name: string, data: string) => void): Promise<ExitCode | null> {
  const res = await io.fetch(endpoint(t, path), { headers: { authorization: `Bearer ${t.token}`, accept: 'text/event-stream' } });
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
      let name: string | null = null;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) name = line.slice('event: '.length);
        else if (line.startsWith('data: ')) data.push(line.slice('data: '.length));
      }
      if (name !== null || data.length > 0) onEvent(name ?? 'message', data.join('\n'));
    }
    if (done) return null;
  }
}

/** Prints one line per event: its name, then its JSON data. */
async function events(io: CliIo, t: Target, runId: string): Promise<ExitCode> {
  return (await stream(io, t, runPath(runId, 'events'), (name, data) => { io.out(`${name} ${data}`); })) ?? 0;
}

/**
 * The readiness report for one revision of the host's repository: the commit
 * is said on stderr as the scan starts, and the report printed on stdout when
 * it ends. A scan that failed, or a stream that ended without a report, exits 1.
 */
async function readiness(io: CliIo, t: Target, revision: string | undefined): Promise<ExitCode> {
  // Set from inside the stream callback, so an object: a let narrowed at its declaration would read as never changed.
  const seen = { report: false, failed: false };
  const path = revision === undefined ? 'readiness' : `readiness?${new URLSearchParams({ revision }).toString()}`;
  const refused = await stream(io, t, path, (name, data) => {
    if (name === 'started') {
      const { commit } = JSON.parse(data) as { commit?: unknown };
      io.err(`scanning ${typeof commit === 'string' ? commit : 'the commit'}; this runs the repository's install and checks in sandboxes, and takes minutes`);
    } else if (name === 'report') {
      io.out(json(JSON.parse(data) as unknown));
      seen.report = true;
    } else if (name === 'failed') {
      seen.failed = true;
      const { message } = JSON.parse(data) as { message?: unknown };
      io.err(`the scan failed: ${typeof message === 'string' ? message : data}`);
    }
  });
  if (refused !== null) return refused;
  if (seen.report) return 0;
  if (!seen.failed) io.err('the scan ended without a report');
  return 1;
}

/** Outcomes over every run the Vault holds, optionally those admitted in a window; the service refuses a time it cannot read. */
async function outcomes(io: CliIo, t: Target, args: string[]): Promise<ExitCode> {
  const { values, positionals } = parseOwn('outcomes', args);
  if (positionals.length > 0) throw new UsageError(`outcomes takes no positional arguments: ${positionals.join(' ')}`);
  const query = new URLSearchParams();
  const from = str(values, 'from');
  const to = str(values, 'to');
  if (from !== undefined) query.set('from', from);
  if (to !== undefined) query.set('to', to);
  const search = query.toString();
  return report(io, await call(io, t, 'GET', search === '' ? 'outcomes' : `outcomes?${search}`));
}

/** `name=value` pairs, from `--header` or from the comma-separated `OTEL_EXPORTER_OTLP_HEADERS`, whose values are percent-encoded. */
function otlpHeaders(flags: readonly string[], env: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  const pairs = [...(env === undefined || env === '' ? [] : env.split(',').map((p) => ({ pair: p.trim(), encoded: true }))), ...flags.map((pair) => ({ pair, encoded: false }))];
  for (const { pair, encoded } of pairs) {
    const at = pair.indexOf('=');
    const name = at < 1 ? '' : pair.slice(0, at).trim();
    if (name === '') throw new UsageError('a collector header is name=value; the name is not given');
    let value = pair.slice(at + 1).trim();
    if (encoded) {
      try {
        value = decodeURIComponent(value);
      } catch {
        throw new UsageError(`the collector header ${name} in OTEL_EXPORTER_OTLP_HEADERS is not percent-encoded`);
      }
    }
    headers[name.toLowerCase()] = value;
  }
  return headers;
}

/**
 * Each named run's telemetry, read from the service. With no collector it is
 * printed; with one, this client sends it there. The service never makes the
 * request, so a token holder cannot point the runtime at a host (D-R12-02).
 * A header's value is never printed: it may be the collector's credential.
 */
async function telemetry(io: CliIo, t: Target, args: string[]): Promise<ExitCode> {
  const { values, positionals } = parseOwn('telemetry', args);
  if (positionals.length === 0) throw new UsageError('telemetry needs at least one <run id>');
  const raw = str(values, 'endpoint') ?? io.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  let collector: URL | null = null;
  if (raw !== undefined && raw !== '') {
    // Each refusal is a fixed message: the value may carry a credential, and nothing here prints it (codex-2).
    try {
      collector = new URL(raw);
    } catch {
      throw new UsageError('the collector endpoint is not a URL');
    }
    if (collector.protocol !== 'http:' && collector.protocol !== 'https:') throw new UsageError('the collector endpoint is not an http or https URL');
    if (collector.username !== '' || collector.password !== '') throw new UsageError('the collector endpoint carries user information; pass a credential with --header');
  }
  const headers = collector === null ? {} : otlpHeaders(strs(values, 'header') ?? [], io.env.OTEL_EXPORTER_OTLP_HEADERS);
  let code: ExitCode = 0;
  for (const runId of positionals) {
    const res = await call(io, t, 'GET', runPath(runId, 'telemetry'));
    if (res.status < 200 || res.status >= 300) {
      report(io, res);
      code = 1;
      continue;
    }
    const exported = res.body as TelemetryExport;
    if (collector === null) {
      io.out(JSON.stringify({ runId, ...exported }));
      continue;
    }
    for (const [signal, body] of [['traces', exported.traces], ['metrics', exported.metrics]] as const) {
      const base = collector.href.endsWith('/') ? collector.href : `${collector.href}/`;
      let sent: Response;
      try {
        sent = await io.fetch(new URL(`v1/${signal}`, base), { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      } catch {
        // The error's own text is not printed: it may quote the request, headers included (codex-2).
        io.err(`${runId} ${signal}: the collector could not be reached`);
        code = 1;
        continue;
      }
      if (sent.ok) {
        io.out(`${runId} ${signal}: sent (${String(sent.status)})`);
      } else {
        io.err(`${runId} ${signal}: the collector answered ${String(sent.status)}`);
        code = 1;
      }
    }
  }
  return code;
}

export async function runCli(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      strict: false,
      allowPositionals: true,
      options: { url: { type: 'string' }, token: { type: 'string' }, help: { type: 'boolean' } },
    });
    const [command] = positionals;
    if (command === undefined) {
      io.out(USAGE);
      return values.help === true ? 0 : 2;
    }
    const row = COMMANDS.find((c) => c.name === command);
    if (row === undefined) throw new UsageError(`unknown command '${command}'`);
    // Help needs no server: it is printed from the table before a URL or token is asked for.
    if (values.help === true) {
      io.out(commandHelp(row));
      return 0;
    }
    const t = target({ url: typeof values.url === 'string' ? values.url : undefined, token: typeof values.token === 'string' ? values.token : undefined }, io.env);
    // What remains once the global options are taken out: the command's own arguments.
    const own = stripGlobals(argv).slice(1);
    switch (command) {
      case 'create':
        return await create(io, t, own);
      case 'status': {
        const [runId = ''] = one(parseOwn(command, own).positionals, ['<run id>']);
        return report(io, await call(io, t, 'GET', runPath(runId)));
      }
      case 'approve': {
        const { values: flags, positionals: named } = parseOwn(command, own);
        const [runId = '', key = ''] = one(named, ['<run id>', '<station:level>']);
        const draft = str(flags, 'draft');
        const body: ApproveBody = { key: key as ApproveBody['key'], ...(draft === undefined ? {} : { draft }) };
        return report(io, await call(io, t, 'POST', runPath(runId, 'approve'), body));
      }
      case 'reject': {
        const { values: flags, positionals: named } = parseOwn(command, own);
        const [runId = '', key = ''] = one(named, ['<run id>', '<station:level>']);
        const notes = str(flags, 'notes');
        const reason = str(flags, 'reason');
        const body: RejectBody = {
          key: key as RejectBody['key'],
          draft: required(str(flags, 'draft'), '--draft'),
          ...(notes === undefined ? {} : { notes }),
          ...(reason === undefined ? {} : { reason: reason as NonNullable<RejectBody['reason']> }),
        };
        return report(io, await call(io, t, 'POST', runPath(runId, 'reject'), body));
      }
      case 'cancel': {
        const [runId = ''] = one(parseOwn(command, own).positionals, ['<run id>']);
        return report(io, await call(io, t, 'POST', runPath(runId, 'cancel')));
      }
      case 'events': {
        const [runId = ''] = one(parseOwn(command, own).positionals, ['<run id>']);
        return await events(io, t, runId);
      }
      case 'report': {
        const [runId = ''] = one(parseOwn(command, own).positionals, ['<run id>']);
        return report(io, await call(io, t, 'GET', runPath(runId, 'report')));
      }
      case 'outcomes':
        return await outcomes(io, t, own);
      case 'telemetry':
        return await telemetry(io, t, own);
      case 'readiness': {
        const { values: flags, positionals: named } = parseOwn(command, own);
        if (named.length > 0) throw new UsageError(`readiness takes no positional arguments: ${named.join(' ')}`);
        return await readiness(io, t, str(flags, 'revision'));
      }
      default:
        throw new UsageError(`'${command}' is in the command table but has no handler`);
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
