import { compileError, pending, runtime } from '../kit/assert.js';
import { moduleSpecifiers, packageProgram, propertyChains } from '../kit/scan.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { workspacePackages } from '../kit/workspace.js';

/** Modules that exist to drive a terminal. None may be imported by core. */
const TERMINAL_MODULES: ReadonlySet<string> = new Set([
  'tty', 'node:tty',
  'readline', 'node:readline', 'readline/promises', 'node:readline/promises',
  'inquirer', 'prompts', 'enquirer', 'ink', 'chalk', 'ora', 'commander', 'yargs', 'blessed', 'cli-progress',
]);

/** Property chains that assume a foreground process with a terminal attached. */
const TERMINAL_CHAINS = /^process\.(stdin|stdout|stderr|exit|exitCode|argv)(\.|$)|\.isTTY$|^console\./;

/** I9: The runtime is a service; the CLI is a client. */
export const I9: InvariantEntry = {
  title: INVARIANTS.I9,
  assertions: [
    runtime({
      id: 'I9.core-never-touches-a-terminal',
      title: 'no file in core imports a terminal module or touches process streams, argv, exit, isTTY, or console',
      run: () => {
        const core = workspacePackages().find((p) => p.name === '@olympus-ai/core');
        if (core === undefined) throw new Error('I9: @olympus-ai/core is not in the workspace');
        const { files } = packageProgram(core);
        if (files.length === 0) throw new Error('I9: core has no source files');
        const hits: string[] = [];
        for (const sf of files) {
          for (const m of moduleSpecifiers(sf)) {
            if (TERMINAL_MODULES.has(m.text)) hits.push(`${m.file}:${String(m.line)} imports ${m.text}`);
          }
          for (const chain of propertyChains(sf)) {
            if (TERMINAL_CHAINS.test(chain.text)) hits.push(`${chain.file}:${String(chain.line)} uses ${chain.text}`);
          }
        }
        if (hits.length > 0) throw new Error(`I9: core assumes a terminal\n  ${hits.join('\n  ')}`);
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
