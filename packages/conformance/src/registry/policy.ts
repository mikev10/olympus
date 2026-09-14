/**
 * Support for the registry assertions that exercise the real policy engine
 * (P3).
 *
 * The engine is reached through `@olympus-ai/core`'s published entry, the same
 * way the Vault assertions reach `LocalVault`, so the conformance package
 * keeps no `package.json` dependency on it and no workspace cycle forms
 * (D-F3-04).
 *
 * One document serves every assertion: it grants exactly one role, at exactly
 * two stations, with exactly two tools, and sets each of the three caps to a
 * different value. Every refusal the assertions require is then one edit away
 * from something the policy really does allow, so none of them can pass by
 * refusing everything.
 */
import type { AutonomyLevel, CapabilityScope, PolicyDocument, RoleId, StationId } from '@olympus-ai/core';

/** The one role the fixture document defines. */
export const GRANTED_ROLE = 'builder' as RoleId;

/** A role the fixture document does not define, at any station. */
export const UNDEFINED_ROLE = 'reviewer' as RoleId;

/** Stations the granted role may act at. */
export const GRANTED_STATIONS: readonly StationId[] = ['build', 'verify'];

/** A station the granted role may not act at. */
export const FORBIDDEN_STATION: StationId = 'integrate';

/** Tools the granted role holds. */
export const GRANTED_TOOLS: readonly string[] = ['read', 'write'];

/** A tool no role in the fixture document holds. */
export const UNGRANTED_TOOL = 'shell';

/** The role's own ceiling: the tightest of the three bounds at `verify`. */
export const ROLE_CEILING: AutonomyLevel = 2;

/** The station cap on `build`: tighter than global, looser than nothing. */
export const BUILD_CAP: AutonomyLevel = 1;

/** The global cap the fixture document carries. */
export const GLOBAL_CAP: AutonomyLevel = 3;

function scope(): CapabilityScope {
  return {
    stations: [...GRANTED_STATIONS],
    writableGlobs: ['src/**'],
    tools: [...GRANTED_TOOLS],
    network: { egress: 'none' },
    tier: 'standard',
    autonomyCeiling: ROLE_CEILING,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
  };
}

/**
 * A document that grants something, so a refusal proves a rule rather than an
 * empty policy. `approvals` is deliberately left with one entry: a resolution
 * that filled every key with `auto` and a resolution that carried the stated
 * key through are told apart by the assertions, and an entirely empty table
 * could not tell them apart.
 */
export function grantingDocument(): PolicyDocument {
  return {
    globalCap: GLOBAL_CAP,
    stationCaps: { build: BUILD_CAP },
    approvals: { 'build:1': 'auto' },
    roles: { [GRANTED_ROLE]: scope() },
    protectedPaths: ['.github/**'],
    triggers: {
      enabled: ['human'],
      entryStation: { human: 'intake' },
      taskTemplate: {},
      maxAutonomy: { human: 2 },
      minAuthorTrust: { human: 'owner' },
      maxTriggerDepth: 2,
      budgetPerWindow: { runs: 20, windowMs: 3_600_000 },
    },
    concurrency: { maxParallelTasks: 4, maxConflictRetries: 3 },
  };
}
