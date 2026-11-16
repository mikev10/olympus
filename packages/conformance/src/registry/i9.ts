import { compileError, runtime } from '../kit/assert.js';
import { moduleSpecifiers, packageProgram, propertyChains, sourceFilesOutsideProgram, terminalBindings } from '../kit/scan.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import ts from 'typescript';
import { workspacePackages, workspaceRelative } from '../kit/workspace.js';
import { assertApiRunsHeadless } from './headless.js';
import { assertPackagedHostRuns } from './release.js';
import { SANDBOX_OUTPUT_IS_BOUNDED } from './output.js';

/**
 * Modules that exist to drive a terminal, and `process` as a module, which
 * hands out the same streams under names the binding scan does not follow.
 * None may be imported by the runtime; it reads `process.env` by member name.
 */
const TERMINAL_MODULES: ReadonlySet<string> = new Set([
  'tty', 'node:tty',
  'process', 'node:process',
  'readline', 'node:readline', 'readline/promises', 'node:readline/promises',
  'inquirer', 'prompts', 'enquirer', 'ink', 'chalk', 'ora', 'commander', 'yargs', 'blessed', 'cli-progress',
]);

/** Property chains that assume a foreground process with a terminal attached. */
const TERMINAL_CHAINS = /^process\.(stdin|stdout|stderr|exit|exitCode|argv)(\.|$)|\.isTTY$|^console\./;

/**
 * Throws when any file in the named package's program imports a terminal
 * module or touches process streams, argv, exit, isTTY, or console. The
 * program is what `tsc -p` would build, so a package that includes its
 * tests scans those too. A program that leaves any `.ts` under `src` out is
 * refused first: a non-empty program is not evidence that the runtime source
 * is in it.
 */
/**
 * An executable entry that may report its own refusal (A-HS-01): one file,
 * and only these uses, which write a line to stderr and set a non-zero exit.
 * stdin, stdout, argv, exit, isTTY, console, and every terminal module stay
 * refused there too, and the file may export nothing, so no other module can
 * call through it.
 */
interface EntryExemption {
  readonly file: string;
  readonly uses: ReadonlySet<string>;
}

const HOST_ENTRY: EntryExemption = {
  file: 'packages/api/src/host/main.ts',
  uses: new Set(['process.stderr.write', 'process.exitCode', 'Process.stderr', 'Process.exitCode']),
};

function exports(sf: ts.SourceFile): boolean {
  return sf.statements.some((st) => ts.isExportDeclaration(st) || ts.isExportAssignment(st)
    || (ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)));
}

function assertNeverTouchesATerminal(packageName: string, entry: EntryExemption | null = null): void {
  const pkg = workspacePackages().find((p) => p.name === packageName);
  if (pkg === undefined) throw new Error(`I9: ${packageName} is not in the workspace`);
  const { files, checker } = packageProgram(pkg);
  if (files.length === 0) throw new Error(`I9: ${packageName} has no source files`);
  const omitted = sourceFilesOutsideProgram(pkg);
  if (omitted.length > 0) {
    throw new Error(`I9: ${packageName}'s tsconfig leaves source files out of its program, where this scan cannot see them\n  ${omitted.join('\n  ')}`);
  }
  const hits: string[] = [];
  if (entry !== null) {
    const sf = files.find((f) => workspaceRelative(f.fileName) === entry.file);
    if (sf === undefined) throw new Error(`I9: the exempt entry ${entry.file} is not in ${packageName}'s program, so the exemption names nothing`);
    if (exports(sf)) hits.push(`${entry.file} exports, so its terminal write is reachable from other modules`);
  }
  const exempt = (site: { readonly file: string; readonly text: string }): boolean => entry !== null && site.file === entry.file && entry.uses.has(site.text);
  for (const sf of files) {
    for (const m of moduleSpecifiers(sf)) {
      if (TERMINAL_MODULES.has(m.text)) hits.push(`${m.file}:${String(m.line)} imports ${m.text}`);
    }
    for (const chain of propertyChains(sf)) {
      if (TERMINAL_CHAINS.test(chain.text) && !exempt(chain)) hits.push(`${chain.file}:${String(chain.line)} uses ${chain.text}`);
    }
    // By binding as well as by spelling: a destructured, aliased, or re-exported terminal is the same terminal.
    for (const binding of terminalBindings(sf, checker)) {
      if (!exempt(binding)) hits.push(`${binding.file}:${String(binding.line)} binds ${binding.text}`);
    }
  }
  if (hits.length > 0) throw new Error(`I9: ${packageName} assumes a terminal\n  ${hits.join('\n  ')}`);
}

/**
 * The host's entry passes `createApiServer` a `log` whose body writes to
 * `process.stderr` (A-HS-03). The service emits the line; this asserts the
 * executable does not drop it.
 */
function assertHostLogsFailedAttempts(): void {
  const pkg = workspacePackages().find((p) => p.name === '@olympus-ai/api');
  if (pkg === undefined) throw new Error('I9: @olympus-ai/api is not in the workspace');
  const sf = packageProgram(pkg).files.find((f) => workspaceRelative(f.fileName) === HOST_ENTRY.file);
  if (sf === undefined) throw new Error(`I9: ${HOST_ENTRY.file} is not in the api program`);
  const sinks: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createApiServer') {
      const [options] = node.arguments;
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const prop of options.properties) {
          if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === 'log') sinks.push(prop.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (sinks.length === 0) throw new Error(`I9: ${HOST_ENTRY.file} passes createApiServer no log, so a failed attempt is never printed`);
  const writes = (node: ts.Node): boolean => (ts.isCallExpression(node) && node.expression.getText(sf) === 'process.stderr.write') || (ts.forEachChild(node, writes) ?? false);
  for (const sink of sinks) {
    if (!(ts.isArrowFunction(sink) || ts.isFunctionExpression(sink)) || !writes(sink.body)) {
      throw new Error(`I9: ${HOST_ENTRY.file}'s log does not write to process.stderr`);
    }
  }
}

/** I9: The runtime is a service; the CLI is a client. */
export const I9: InvariantEntry = {
  title: INVARIANTS.I9,
  assertions: [
    runtime({
      id: 'I9.core-never-touches-a-terminal',
      title: 'no file in core imports a terminal module or touches process streams, argv, exit, isTTY, or console, and every .ts under its src is in the scanned program',
      run: () => {
        assertNeverTouchesATerminal('@olympus-ai/core');
      },
    }),
    runtime({
      id: 'I9.api-never-touches-a-terminal',
      title: 'no file in api imports a terminal module or touches process streams, argv, exit, isTTY, or console, by spelling or by binding, and every .ts under its src is in the scanned program; the one exception is the host executable\'s entry, which exports nothing and may only write to stderr (its refusal, and each failed-attempt line the service hands it) and set its exit code (A-HS-01, A-HS-03)',
      run: () => {
        assertNeverTouchesATerminal('@olympus-ai/api', HOST_ENTRY);
      },
    }),
    runtime({
      id: 'I9.host-logs-failed-attempts',
      title: 'the host executable hands the service a log that writes each failed-attempt line to stderr, so an attempt that fails is printed by the process running it (A-HS-03, #149)',
      run: assertHostLogsFailedAttempts,
    }),
    runtime({
      id: 'I9.api-runs-headless',
      title: 'the API process, spawned with stdin closed and no TTY, serves a run from create to passed, and the CLI, a separate process given only a URL and a token, drives every step over HTTP',
      run: assertApiRunsHeadless,
    }),
    runtime({
      id: 'I9.packaged-host-runs',
      title: 'the packed packages install into an empty directory; factory-host, started from its installed bin, refuses an empty environment with every required variable in one list and no stack frame, and configured from the shipped examples listens headless; the CLI, from its own installed bin, reaches it over HTTP (R35)',
      run: assertPackagedHostRuns,
      // Builds, packs, installs, and composes the host, which builds the driver image on a cold Docker cache.
      timeoutMs: 1_200_000,
    }),
    compileError({
      id: 'I9.no-dom-in-lib',
      title: 'the compiler lib has no DOM: document, window, navigator, localStorage, and addEventListener are unknown names',
      fixture: 'i9/core-has-no-dom.ts',
    }),
    // R14: what a command prints is bounded while it is read, so a check cannot exhaust the runtime's host (D-P8-15).
    SANDBOX_OUTPUT_IS_BOUNDED,
  ],
  pending: [],
};
