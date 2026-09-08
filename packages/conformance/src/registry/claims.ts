import { pending } from '../kit/assert.js';
import type { ClaimEntry, ClaimId, UnitId } from '../kit/types.js';

/**
 * Capability claims (I8). Every key of DriverCapabilities and
 * SandboxCapabilities is a claim an implementation makes about itself, and
 * each needs an assertion that fails when the capability is removed. No
 * driver or provider exists yet, so every claim is pending: P5 owes the
 * driver assertions and P2 the sandbox ones. I8.driver-capability-keys-
 * registered and I8.sandbox-capability-keys-registered keep this list equal
 * to the interfaces' keys, so a new capability cannot be declared without a
 * registry entry.
 */
function owed(id: ClaimId, owner: UnitId, proves: string): [ClaimId, ClaimEntry] {
  return [id, { assertions: [], pending: [pending({ id, owner, reason: proves })] }];
}

const DRIVER: Array<[ClaimId, ClaimEntry]> = [
  owed('driver.subagents', 'P5', 'spawnSubagent() runs a child task under the parent request\'s policy grants and returns its own TaskResult.'),
  owed('driver.hooks', 'P5', 'the driver installs the hook points emitArtifacts() renders and each fires a DriverEvent.'),
  owed('driver.mcp', 'P5', 'the MCP servers named in TaskRequest.tools are reachable from a task, and no other server is.'),
  owed('driver.parallelism', 'P5', 'the driver runs the declared number of tasks concurrently under one provenance id.'),
  owed('driver.computerUse', 'P5', 'a task can drive a display inside the sandbox when declared, and the capability is refused when not.'),
  owed('driver.steering', 'P5', 'steer() delivers a runtime message to a running task and it appears in the event stream.'),
  owed('driver.stablePrefixCaching', 'P5', 'Usage.cacheReadTokens grows across tasks that share a stablePrefix.'),
];

const SANDBOX: Array<[ClaimId, ClaimEntry]> = [
  owed('sandbox.computerUse', 'P2', 'a provisioned sandbox exposes a display when declared, and provisioning is refused when a spec needs one it cannot give.'),
  owed('sandbox.gpu', 'P2', 'a provisioned sandbox exposes a GPU when declared, and never when not.'),
  owed('sandbox.os', 'P2', 'exec() inside a provisioned sandbox reports the declared operating system.'),
  owed('sandbox.persistent', 'P2', 'a file written in one exec() survives to the next only when persistent is declared.'),
  owed('sandbox.remote', 'P2', 'the provider provisions on a remote worker only when remote is declared.'),
];

export const CLAIMS: Readonly<Record<ClaimId, ClaimEntry>> = Object.fromEntries([...DRIVER, ...SANDBOX]);

/** The capability names registered for a family, in registry order. */
export function claimKeys(family: 'driver' | 'sandbox'): string[] {
  const prefix = `${family}.`;
  return Object.keys(CLAIMS)
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length));
}
