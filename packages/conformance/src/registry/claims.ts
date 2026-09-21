import { external, runtime } from '../kit/assert.js';
import type { ClaimEntry, ClaimId } from '../kit/types.js';
import { specFor, withProvider, withSandbox } from './local-sandbox.js';

/**
 * Capability claims (I8). Every key of DriverCapabilities and
 * SandboxCapabilities is a claim an implementation makes about itself, and
 * each needs an assertion that fails when the capability is removed. The
 * sandbox claims are live as of P2, and the driver claims as of P5.
 * I8.driver-capability-keys-registered and
 * I8.sandbox-capability-keys-registered keep this list equal to the
 * interfaces' keys, so a new capability cannot be declared without a registry
 * entry.
 *
 * A claim of `false` needs an assertion as much as a claim of `true` does.
 * "Fails when the capability is deleted" cuts both ways: each sandbox
 * assertion below observes the container and compares what it found against
 * what `capabilities()` declared, so flipping a flag without changing what
 * the provider does fails the suite, and so does adding the capability
 * without declaring it.
 */
/**
 * The package that owns the driver claims, and the file its suite asserts them
 * in. External rather than local because each one drives the real CLI inside a
 * real container: the registry cannot import a sibling's tests (D-F3-04), and
 * re-running them here would be a second set of model calls for an answer the
 * first run already has (D-P5-02). Each is counted only after reconciliation
 * against that package's own run report, so an id no test carries, a skipped
 * test, a failing test, a report from another tree, and a missing report are
 * five distinct refusals.
 */
const DRIVER_PACKAGE = '@olympus-ai/driver-claude-code';
const DRIVER_CLAIMS_FILE = 'test/claims.test.ts';

function driverClaim(id: ClaimId, title: string): [ClaimId, ClaimEntry] {
  return [
    id,
    {
      assertions: [external({ id, title, level: 'runtime', package: DRIVER_PACKAGE, file: DRIVER_CLAIMS_FILE })],
      pending: [],
    },
  ];
}

const DRIVER: Array<[ClaimId, ClaimEntry]> = [
  driverClaim('driver.subagents', "spawnSubagent() runs a child task under the parent request's policy grants and returns its own TaskResult"),
  driverClaim('driver.hooks', 'the driver installs the hook points emitArtifacts() renders, and each one that fires arrives as a DriverEvent the CLI reported'),
  driverClaim('driver.mcp', "the MCP servers a task's grants name are reachable from that task, and no other server is loaded"),
  driverClaim('driver.parallelism', 'the driver runs the declared number of tasks concurrently under one provenance id: one, enforced, so a second task on a sandbox waits for the first'),
  driverClaim('driver.computerUse', 'computerUse is declared false and is absent: no declared tool drives a display, and a session granted the whole inventory offers none'),
  driverClaim('driver.steering', 'steering is declared false and there is no steer(): a running task has no runtime message channel, in both directions'),
  driverClaim('driver.stablePrefixCaching', 'cacheReadTokens is zero on the first task of a run and non-zero on a second that shares its stablePrefix and differs only in variableSuffix'),
];

/** One assertion per sandbox claim: observe the provisioned container, then require the declaration to match. */
function sandboxClaim(id: ClaimId, title: string, run: () => Promise<void>): [ClaimId, ClaimEntry] {
  return [id, { assertions: [runtime({ id, title, run })], pending: [] }];
}

/** Throws unless what the container showed and what the provider declared are the same. */
function requireAgreement(id: ClaimId, declared: unknown, observed: unknown, observedBy: string): void {
  if (declared === observed) return;
  throw new Error(
    `${id}: capabilities() declares ${JSON.stringify(declared)} but the container shows ${JSON.stringify(observed)} ` +
      `(${observedBy}). A capability claim and the substrate behind it must agree in both directions: declaring one the ` +
      'provider does not give is a false claim, and giving one it does not declare is an undeclared capability (I8).',
  );
}

const SANDBOX: Array<[ClaimId, ClaimEntry]> = [
  sandboxClaim(
    'sandbox.os',
    'the operating system a provisioned container reports is the one capabilities() declares',
    async () => {
      await withProvider('claim-os-', async (provider, dirs) => {
        await withSandbox(provider, specFor(dirs), async (handle) => {
          const result = await provider.exec(handle, ['uname', '-s']);
          const kernels: Record<string, string> = { Linux: 'linux', Darwin: 'macos' };
          const observed = kernels[result.stdout.trim()] ?? result.stdout.trim();
          requireAgreement('sandbox.os', provider.capabilities().os, observed, `uname -s reported ${result.stdout.trim()}`);
        });
      });
    },
  ),
  sandboxClaim(
    'sandbox.persistent',
    'a file written in one exec() survives to the next exactly when `persistent` is declared',
    async () => {
      await withProvider('claim-persistent-', async (provider, dirs) => {
        await withSandbox(provider, specFor(dirs), async (handle) => {
          // /tmp, not the workspace: the workspace is a bind mount and would survive whether the
          // sandbox itself persisted or not, so it would prove the mount rather than the claim.
          await provider.exec(handle, ['sh', '-c', 'echo kept > /tmp/marker']);
          const second = await provider.exec(handle, ['sh', '-c', 'cat /tmp/marker 2>/dev/null || true']);
          requireAgreement(
            'sandbox.persistent',
            provider.capabilities().persistent,
            second.stdout.trim() === 'kept',
            'a file written by one exec was read back by the next',
          );
        });
      });
    },
  ),
  sandboxClaim(
    'sandbox.computerUse',
    'a provisioned container exposes a display exactly when `computerUse` is declared',
    async () => {
      await withProvider('claim-computer-use-', async (provider, dirs) => {
        await withSandbox(provider, specFor(dirs), async (handle) => {
          const result = await provider.exec(handle, [
            'sh',
            '-c',
            'if [ -n "$DISPLAY" ] || [ -e /tmp/.X11-unix ] || [ -e /dev/fb0 ]; then echo yes; else echo no; fi',
          ]);
          requireAgreement(
            'sandbox.computerUse',
            provider.capabilities().computerUse,
            result.stdout.trim() === 'yes',
            'looked for DISPLAY, an X11 socket, and a framebuffer device',
          );
        });
      });
    },
  ),
  sandboxClaim(
    'sandbox.gpu',
    'a provisioned container exposes a GPU device exactly when `gpu` is declared',
    async () => {
      await withProvider('claim-gpu-', async (provider, dirs) => {
        await withSandbox(provider, specFor(dirs), async (handle) => {
          const result = await provider.exec(handle, [
            'sh',
            '-c',
            'if ls /dev/nvidia* >/dev/null 2>&1 || [ -e /dev/dri ] || [ -e /dev/kfd ]; then echo yes; else echo no; fi',
          ]);
          requireAgreement(
            'sandbox.gpu',
            provider.capabilities().gpu,
            result.stdout.trim() === 'yes',
            'looked for an NVIDIA device, /dev/dri, and /dev/kfd',
          );
        });
      });
    },
  ),
  sandboxClaim(
    'sandbox.remote',
    'the provider provisions on a remote worker exactly when `remote` is declared; a local daemon is a pipe or a socket on this machine',
    async () => {
      await withProvider('claim-remote-', (provider) => {
        const endpoint = provider.daemon().endpoint;
        const local = endpoint.startsWith('unix://') || endpoint.startsWith('npipe://');
        requireAgreement('sandbox.remote', provider.capabilities().remote, !local, `the daemon endpoint is ${endpoint}`);
        return Promise.resolve();
      });
    },
  ),
];

export const CLAIMS: Readonly<Record<ClaimId, ClaimEntry>> = Object.fromEntries([...DRIVER, ...SANDBOX]);

/** The capability names registered for a family, in registry order. */
export function claimKeys(family: 'driver' | 'sandbox'): string[] {
  const prefix = `${family}.`;
  return Object.keys(CLAIMS)
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length));
}
