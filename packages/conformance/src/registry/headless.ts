/**
 * `I9.api-runs-headless`: the API process starts and serves a run with no
 * terminal, and the CLI drives it only through the API.
 *
 * Two processes, neither a child of the other's code. The host is spawned
 * with stdin closed, stdout discarded, and no TTY on any descriptor; it
 * reports its URL over the IPC channel and nothing else. The CLI is spawned
 * as its own process for every command, given only that URL and the token,
 * and carries a run from create — through the worst-case cost it must approve
 * — to passed. A create refused for its cost is checked at the host, where
 * the Vault and the driver are counted, to have written and called nothing.
 * The CLI's own program is read first: a workspace package imported as a
 * value, a module outside the CLI imported by path, or a module loaded at
 * run time fails before anything is spawned. A server that needed a
 * terminal, or a CLI that reached the runtime by any route but HTTP, fails
 * here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { packageProgram } from '../kit/scan.js';
import { toPosix, workspacePackages } from '../kit/workspace.js';

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

interface Census { readonly vaultWrites: number; readonly driverCalls: number }

/** Asks the host what the runtime has done, counted at the Vault and the driver. */
function census(host: ChildProcess): Promise<Census> {
  return new Promise((resolveCensus, reject) => {
    const listen = (message: unknown): void => {
      if (typeof message !== 'object' || message === null || (message as { kind?: unknown }).kind !== 'census') return;
      clearTimeout(timer);
      host.off('message', listen);
      resolveCensus(message as Census);
    };
    const timer = setTimeout(() => { host.off('message', listen); reject(new Error('I9: the headless host did not answer a census')); }, TIMEOUT_MS);
    host.on('message', listen);
    host.send({ kind: 'census' });
  });
}

/**
 * The CLI reaches the runtime only over HTTP, so no module in its program may
 * bring runtime code into its process: every import of a workspace package is
 * type-only, which TypeScript erases, nothing outside the CLI is imported by
 * path, and nothing is loaded at run time. Separate processes prove the CLI
 * works over HTTP; this proves it has no other route (P9 review, codex-6).
 */
function assertCliImportsOnlyTypes(): void {
  const pkg = workspacePackages().find((p) => p.name === 'olympus-ai');
  if (pkg === undefined) throw new Error('I9: the CLI package is not in the workspace');
  const manifest = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
  const runtimeDeps = Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith('@olympus-ai/'));
  if (runtimeDeps.length > 0) throw new Error(`I9: the CLI takes workspace packages as runtime dependencies: ${runtimeDeps.join(', ')}`);
  const { files } = packageProgram(pkg);
  const src = `${toPosix(join(pkg.dir, 'src'))}/`;
  const hits: string[] = [];
  let scanned = 0;
  for (const sf of files) {
    const file = toPosix(sf.fileName);
    if (!file.startsWith(src)) continue;
    scanned += 1;
    for (const statement of sf.statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
      const specifier = statement.moduleSpecifier;
      if (specifier === undefined || !ts.isStringLiteral(specifier)) continue;
      if (specifier.text.startsWith('.') && !toPosix(join(dirname(sf.fileName), specifier.text)).startsWith(src)) hits.push(`${file} imports ${specifier.text} from outside the CLI`);
      if (specifier.text.startsWith('@olympus-ai/') && !isTypeOnly(statement)) hits.push(`${file} imports ${specifier.text} as a value`);
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        hits.push(`${file} loads a module at run time`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  if (scanned === 0) throw new Error('I9: no CLI source was in its program, so nothing was checked');
  if (hits.length > 0) throw new Error(`I9: the CLI can reach the runtime by a route other than HTTP\n  ${hits.join('\n  ')}`);
}

/** An import or re-export the compiler erases: `import type`, `export type`, or one whose every named binding is `type`. */
function isTypeOnly(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) {
    return statement.isTypeOnly || (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.every((e) => e.isTypeOnly));
  }
  const clause = statement.importClause;
  if (clause === undefined) return false; // a bare import runs the module
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  if (clause.name !== undefined) return false;
  const bindings = clause.namedBindings;
  return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((e) => e.isTypeOnly);
}

export async function assertApiRunsHeadless(): Promise<void> {
  assertCliImportsOnlyTypes();
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
    // Read from the host, not the CLI: a refusal printed after a run was admitted or driven is not a refusal.
    const refused = await census(host);
    if (refused.vaultWrites !== 0 || refused.driverCalls !== 0) throw new Error(`I9: a create refused for its cost still wrote to the Vault or called a driver: ${JSON.stringify(refused)}`);

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
    // The positive control: the same count sees a run that did happen, so the zero above was measured.
    const ran = await census(host);
    if (ran.vaultWrites === 0 || ran.driverCalls === 0) throw new Error(`I9: the host counted nothing for a run that passed, so its count is not evidence: ${JSON.stringify(ran)}`);
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
