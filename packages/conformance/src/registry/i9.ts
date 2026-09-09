import { compileError, pending, runtime } from '../kit/assert.js';
import { moduleSpecifiers, packageProgram, propertyChains, sourceFilesOutsideProgram } from '../kit/scan.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { workspacePackages } from '../kit/workspace.js';

/** Modules that exist to drive a terminal. None may be imported by the runtime. */
const TERMINAL_MODULES: ReadonlySet<string> = new Set([
  'tty', 'node:tty',
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
function assertNeverTouchesATerminal(packageName: string): void {
  const pkg = workspacePackages().find((p) => p.name === packageName);
  if (pkg === undefined) throw new Error(`I9: ${packageName} is not in the workspace`);
  const { files } = packageProgram(pkg);
  if (files.length === 0) throw new Error(`I9: ${packageName} has no source files`);
  const omitted = sourceFilesOutsideProgram(pkg);
  if (omitted.length > 0) {
    throw new Error(`I9: ${packageName}'s tsconfig leaves source files out of its program, where this scan cannot see them\n  ${omitted.join('\n  ')}`);
  }
  const hits: string[] = [];
  for (const sf of files) {
    for (const m of moduleSpecifiers(sf)) {
      if (TERMINAL_MODULES.has(m.text)) hits.push(`${m.file}:${String(m.line)} imports ${m.text}`);
    }
    for (const chain of propertyChains(sf)) {
      if (TERMINAL_CHAINS.test(chain.text)) hits.push(`${chain.file}:${String(chain.line)} uses ${chain.text}`);
    }
  }
  if (hits.length > 0) throw new Error(`I9: ${packageName} assumes a terminal\n  ${hits.join('\n  ')}`);
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
      title: 'no file in api, the entry point, imports a terminal module or touches process streams, argv, exit, isTTY, or console, and every .ts under its src is in the scanned program',
      run: () => {
        assertNeverTouchesATerminal('@olympus-ai/api');
      },
    }),
    compileError({
      id: 'I9.no-dom-in-lib',
      title: 'the compiler lib has no DOM: document, window, navigator, localStorage, and addEventListener are unknown names',
      fixture: 'i9/core-has-no-dom.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I9.api-runs-headless',
      owner: 'P9',
      reason:
        'The API process must start and serve a run with no TTY and stdin closed, and the CLI must drive it ' +
        'only through the API. Neither exists until P9.',
    }),
  ],
};
