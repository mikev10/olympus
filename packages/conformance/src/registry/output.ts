/**
 * R14: a command's output is bounded while it is read (D-P8-15, D-I1b-16).
 *
 * Requires a Docker daemon, as every assertion over the real sandbox does
 * (D-P2-02): the bound is on the bytes the provider holds for a command run
 * inside a container, and there is nothing to observe without one.
 */
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { refusalFrom, specFor, withSandbox, withSandboxDirs } from './local-sandbox.js';

/** Small enough to cross quickly, large enough that a command printing under it is no edge case. */
const CAP = 256 * 1024;

export const SANDBOX_OUTPUT_IS_BOUNDED: LocalAssertion = runtime({
  id: 'I9.sandbox-output-is-bounded',
  title:
    "a command that prints more than the provider's output cap, on stdout and stderr together, is refused at the output layer and its sandbox ended, and none of what it printed is returned; a command under the cap returns its output whole, so the bound refuses rather than truncates",
  run: async () => {
    await withSandboxDirs('r14-i9-output-', async (dirs) => {
      const { LocalDockerProvider } = await import('@olympus-ai/sandbox');
      const zero = await refusalFrom(() => LocalDockerProvider.create({ vaultPaths: [dirs.vault], maxOutputBytes: 0 }));
      if (zero.layer !== 'limits') throw new Error(`I9: a provider with a cap of zero was refused at '${zero.layer}', not 'limits'`);

      const provider = await LocalDockerProvider.create({ vaultPaths: [dirs.vault], maxOutputBytes: CAP });
      await withSandbox(provider, specFor(dirs, 'ro'), async (handle) => {
        // Under the cap, split across both streams: returned whole, byte for byte.
        const half = CAP / 4;
        const under = await provider.exec(handle, ['sh', '-c', `head -c ${String(half)} /dev/zero | tr '\\0' a; head -c ${String(half)} /dev/zero | tr '\\0' b >&2`]);
        if (under.exitCode !== 0 || under.stdout.length !== half || under.stderr.length !== half) {
          throw new Error(`I9: a command printing ${String(half)} bytes to each stream returned ${String(under.stdout.length)} and ${String(under.stderr.length)}`);
        }
        // Over the cap only once the two streams are counted together.
        const together = CAP / 2 + 1024;
        const over = await refusalFrom(() =>
          provider.exec(handle, ['sh', '-c', `head -c ${String(together)} /dev/zero; head -c ${String(together)} /dev/zero >&2; sleep 30`]),
        );
        if (over.layer !== 'output') throw new Error(`I9: a command printing past the cap was refused at '${over.layer}', not 'output': ${over.message}`);
        // The sandbox went with the command: nothing it started is still running.
        const after = await refusalFrom(() => provider.exec(handle, ['true']));
        if (after.layer !== 'lifetime') throw new Error(`I9: the sandbox survived an output overrun; the next command was refused at '${after.layer}'`);
      });
    });
  },
});
