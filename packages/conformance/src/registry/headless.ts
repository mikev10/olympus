/**
 * `I9.api-runs-headless`: the API process starts and serves a run with no
 * terminal, and the CLI drives it only through the API.
 *
 * Two processes, neither a child of the other's code. The host is spawned
 * with stdin closed, stdout discarded, and no TTY on any descriptor; it
 * reports its URL over the IPC channel and nothing else. The CLI is spawned
 * as its own process for every command, given only that URL and the token,
 * and carries a run from create — through the worst-case cost it must approve
 * — to passed. A server that needed a terminal, or a CLI that reached the
 * runtime by any route but HTTP, fails here.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { workspacePackages } from '../kit/workspace.js';

/**
 * Runs the workspace's TypeScript sources directly: Node strips the types,
 * and this resolve hook maps the `.js` specifiers the sources are written
 * with to the `.ts` files on disk. Inline, so the suite adds no file a linter
 * or a scan would have to know about.
 */
const HOOK = "export async function resolve(s, c, n) { try { return await n(s, c); } catch (e) { if (s.endsWith('.js') && (s.startsWith('.') || s.startsWith('file:'))) return n(s.slice(0, -3) + '.ts', c); throw e; } }";
const REGISTER = `import { register } from 'node:module'; register('data:text/javascript,' + encodeURIComponent(${JSON.stringify(HOOK)}));`;
const NODE_ARGS = ['--experimental-transform-types', '--no-warnings', '--import', `data:text/javascript,${encodeURIComponent(REGISTER)}`];

const TIMEOUT_MS = 60_000;

function packageDir(name: string): string {
  const pkg = workspacePackages().find((p) => p.name === name);
  if (pkg === undefined) throw new Error(`I9: ${name} is not in the workspace`);
  return pkg.dir;
}

interface Ran { readonly code: number | null; readonly stdout: string; readonly stderr: string }

/** One CLI command as its own process: stdin closed, no URL but the one passed, no token but the one passed. */
function cli(args: readonly string[]): Promise<Ran> {
  const main = join(packageDir('olympus-ai'), 'src', 'main.ts');
  return new Promise((resolveRan, reject) => {
    const env: Record<string, string> = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE']) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    const child = spawn(process.execPath, [...NODE_ARGS, main, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`I9: the CLI did not finish: ${args.join(' ')}`)); }, TIMEOUT_MS);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRan({ code, stdout, stderr });
    });
  });
}

function parse(ran: Ran, what: string): unknown {
  if (ran.code !== 0) throw new Error(`I9: ${what} exited ${String(ran.code)}\n${ran.stderr}`);
  return JSON.parse(ran.stdout) as unknown;
}

interface Standing { readonly standing: string; readonly key?: string }
interface View { readonly driving: boolean; readonly standing: Standing }

export async function assertApiRunsHeadless(): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const hostFile = join(packageDir('@olympus-ai/api'), 'test', 'fixtures', 'headless-host.ts');
  const host = spawn(process.execPath, [...NODE_ARGS, hostFile], {
    // stdin closed, stdout discarded: nothing on a descriptor the server could treat as a terminal.
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, FACTORY_API_TOKEN: token },
    detached: false,
  });
  let hostErr = '';
  host.stderr?.on('data', (chunk: Buffer) => { hostErr += chunk.toString('utf8'); });
  const exited = new Promise<number | null>((done) => host.on('exit', (code) => { done(code); }));
  let hung: boolean;
  try {
    const ready = await new Promise<{ url: string; workspace: string }>((resolveReady, reject) => {
      const timer = setTimeout(() => { reject(new Error(`I9: the headless host never reported a URL\n${hostErr}`)); }, TIMEOUT_MS);
      host.once('message', (message) => { clearTimeout(timer); resolveReady(message as { url: string; workspace: string }); });
      void exited.then((code) => { clearTimeout(timer); reject(new Error(`I9: the headless host exited ${String(code)} before serving\n${hostErr}`)); });
    });
    const remote = ['--url', ready.url, '--token', token];
    const create = ['create', '--workspace', ready.workspace, '--base-commit', '0'.repeat(40), '--level', '1',
      '--spec', 'spec.md', '--tests', 'acceptance.md', '--manifest', 'verify.json', '--graph', 'graph.json'];

    // The figure is shown before anything starts, and nothing starts without it.
    const shown = await cli([...remote, ...create]);
    const figure = /worst-case cost of this run is \$([0-9.]+)/.exec(shown.stderr)?.[1];
    if (shown.code !== 1 || figure === undefined) throw new Error(`I9: create without an approved cost did not refuse with the figure\n${shown.stderr}`);

    const created = parse(await cli([...remote, ...create, '--approve-cost', figure]), 'create') as { runId: string };
    const streamed = await cli([...remote, 'events', created.runId]);
    if (streamed.code !== 0 || !streamed.stdout.includes('end {"kind":"outcome"')) throw new Error(`I9: the event stream did not end with the drive's outcome\n${streamed.stdout}${streamed.stderr}`);

    const settle = async (): Promise<View> => {
      for (let i = 0; i < 200; i += 1) {
        const view = parse(await cli([...remote, 'status', created.runId]), 'status') as View;
        if (!view.driving) return view;
      }
      throw new Error('I9: the run never settled');
    };
    const waiting = await settle();
    if (waiting.standing.standing !== 'awaiting-approval' || waiting.standing.key !== 'integrate:1') {
      throw new Error(`I9: expected the run to await integrate:1, it is ${JSON.stringify(waiting.standing)}`);
    }
    parse(await cli([...remote, 'approve', created.runId, 'integrate:1']), 'approve');
    const done = await settle();
    if (done.standing.standing !== 'passed') throw new Error(`I9: the run did not pass: ${JSON.stringify(done.standing)}`);
  } finally {
    if (host.connected) host.disconnect();
    let timer: NodeJS.Timeout | undefined;
    const code = await Promise.race([exited, new Promise<'hung'>((done) => { timer = setTimeout(() => { done('hung'); }, TIMEOUT_MS); })]);
    clearTimeout(timer);
    if (code === 'hung') host.kill();
    hung = code === 'hung';
  }
  // Reached only if nothing above threw: a host that does not stop when its parent goes is a failure of its own.
  if (hung) throw new Error('I9: the headless host did not exit when its parent disconnected');
}
