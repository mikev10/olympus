/**
 * The ten station contracts, and the table's own rules checked at run time.
 *
 * Two stations are narrower than `StationContract` by type. `test-design` is
 * granted the locked spec and nothing else: acceptance tests written by a seat
 * that has seen the plan, the repository, or the conversation are tests of the
 * implementation it expects, not of the capability (I3). A review seat is never
 * granted `author-narrative` or `plan`: a reviewer handed the author's account
 * of the work grades the account (I6). A table that widens either does not
 * compile, and `contractTableProblems` refuses the same widening in a table
 * that reached the runtime past the compiler.
 *
 * M1 enters stations 1-8. `observe` and `learn` have contracts so the table is
 * total, and the line never enters them.
 */
import type { DriverCapability } from '../driver/contract.js';
import { isApprovalOutcome, isModelTier, STATION_IDS } from '../policy/constants.js';
import type { StationId } from '../run/types.js';
import type { ContextGrant, StationContract, WriteBoundary } from './types.js';

/** Grants a review seat may never hold (I6). */
export type ReviewForbiddenGrant = 'author-narrative' | 'plan';

export const REVIEW_FORBIDDEN_GRANTS: readonly ReviewForbiddenGrant[] = Object.freeze(['author-narrative', 'plan']);

/** The one grant `test-design` holds (I3). */
export const TEST_DESIGN_CONTEXT: readonly ['locked-spec'] = Object.freeze(['locked-spec'] as const);

/**
 * The table's shape. Keyed by the closed station union, so a missing station
 * is a compile error; `test-design` and `review` narrow `allowedContext`.
 */
export interface StationContractTable {
  readonly intake: StationContract;
  readonly spec: StationContract;
  readonly 'test-design': StationContract & { readonly allowedContext: ['locked-spec'] };
  readonly plan: StationContract;
  readonly build: StationContract;
  readonly verify: StationContract;
  readonly review: StationContract & { readonly allowedContext: Array<Exclude<ContextGrant, ReviewForbiddenGrant>> };
  readonly integrate: StationContract;
  readonly observe: StationContract;
  readonly learn: StationContract;
}

/** The stations M1 runs, in order. */
export const M1_STATIONS: readonly StationId[] = Object.freeze([
  'intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review', 'integrate',
]);

/** Where a driver runs a task. Every other station is the runtime's own work and requires nothing of a driver. */
export type AgentStation = 'build' | 'review';

export const AGENT_STATIONS: readonly AgentStation[] = Object.freeze(['build', 'review']);

export function isAgentStation(station: StationId): station is AgentStation {
  return station === 'build' || station === 'review';
}

/** Stations whose own work is to lock artifacts: every transition from the first of them on re-verifies the locks (I3). */
export const LOCKING_STATIONS: readonly StationId[] = Object.freeze(['spec', 'test-design', 'plan']);

function boundary(workspaceGlobs: string[]): WriteBoundary {
  return { workspaceGlobs, vault: 'never', protectedPathPolicy: 'escalate' };
}

/**
 * The runtime's own stations. A driver never runs at one, so it requires no
 * capability and has no iteration budget to spend; `retry` bounds a sandbox
 * that fails to provision where the station uses one.
 */
function runtimeStation(id: StationId, allowedContext: ContextGrant[], approval: 'auto' | 'human-required' = 'auto'): StationContract {
  return {
    id,
    requires: [],
    allowedContext,
    tier: 'fast',
    writeBoundary: boundary([]),
    maxIterations: 1,
    retry: { max: 2, backoffMs: 100 },
    exitGate: { requiredChecks: [], requiresPanel: false, approval },
  };
}

/**
 * `requires: ['parallelism']` at the two agent stations is a real requirement,
 * not a placeholder: the line runs a task through the driver, and a driver
 * that declares it can run no task at a time cannot run this one.
 *
 * `integrate` states `human-required` as its own floor. M1 claims no
 * lights-off autonomy, and the effective approval is the stricter of this and
 * the policy cell, so no policy relaxes it (D-P4-03).
 */
export const STATION_CONTRACTS: StationContractTable = {
  intake: runtimeStation('intake', ['conversation']),
  spec: runtimeStation('spec', ['conversation', 'base-repo-readonly']),
  'test-design': { ...runtimeStation('test-design', []), allowedContext: ['locked-spec'] },
  plan: runtimeStation('plan', ['locked-spec', 'base-repo-readonly']),
  build: {
    id: 'build',
    requires: ['parallelism'],
    allowedContext: ['locked-spec', 'acceptance-tests', 'task-graph', 'base-repo-readonly'],
    tier: 'standard',
    writeBoundary: boundary(['**']),
    maxIterations: 3,
    retry: { max: 2, backoffMs: 100 },
    exitGate: { requiredChecks: [], requiresPanel: false, approval: 'auto' },
  },
  verify: runtimeStation('verify', []),
  review: {
    id: 'review',
    requires: ['parallelism'],
    allowedContext: ['locked-spec', 'acceptance-tests', 'diff', 'evidence-bundle'],
    tier: 'deep',
    writeBoundary: boundary([]),
    maxIterations: 1,
    retry: { max: 2, backoffMs: 100 },
    exitGate: { requiredChecks: [], requiresPanel: false, approval: 'auto' },
  },
  integrate: runtimeStation('integrate', ['evidence-bundle', 'diff'], 'human-required'),
  observe: runtimeStation('observe', ['evidence-bundle']),
  learn: runtimeStation('learn', ['evidence-bundle']),
};

deepFreeze(STATION_CONTRACTS);

function deepFreeze(value: object): void {
  for (const inner of Object.values(value as Record<string, unknown>)) {
    if (typeof inner === 'object' && inner !== null) deepFreeze(inner);
  }
  Object.freeze(value);
}

export interface ContractProblem {
  readonly station: string;
  readonly message: string;
}

const CAPABILITY_KEYS: ReadonlySet<DriverCapability> = new Set<DriverCapability>([
  'subagents', 'hooks', 'mcp', 'parallelism', 'computerUse', 'steering', 'stablePrefixCaching',
]);

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Every way a table breaks the rules its type states, checked on the values.
 * The type is a compiler claim, and a table that reached the runtime through
 * an assertion otherwise carries a widened review seat straight into a prompt
 * (D-P3-14: no type is part of the security argument). Empty when the table
 * holds.
 */
export function contractTableProblems(table: StationContractTable): ContractProblem[] {
  const problems: ContractProblem[] = [];
  const report = (station: string, message: string): void => {
    problems.push({ station, message });
  };
  for (const station of STATION_IDS) {
    const contract: unknown = Object.hasOwn(table, station) ? table[station] : undefined;
    if (typeof contract !== 'object' || contract === null) {
      report(station, 'the table has no contract for this station');
      continue;
    }
    const c = contract as Partial<Record<keyof StationContract, unknown>>;
    if (c.id !== station) report(station, `the contract is filed under '${station}' but names '${String(c.id)}'`);
    const requires: readonly unknown[] = Array.isArray(c.requires) ? c.requires : [];
    if (!Array.isArray(c.requires)) report(station, 'requires is not a list');
    for (const capability of requires) {
      if (typeof capability !== 'string' || !CAPABILITY_KEYS.has(capability as DriverCapability)) {
        report(station, `requires '${String(capability)}', which is not a driver capability`);
      }
    }
    if (!isAgentStation(station) && requires.length > 0) {
      report(station, 'no driver runs at this station, so it cannot require a driver capability');
    }
    const context: readonly unknown[] = Array.isArray(c.allowedContext) ? c.allowedContext : [];
    if (!Array.isArray(c.allowedContext)) report(station, 'allowedContext is not a list');
    if (station === 'test-design' && !(context.length === 1 && context[0] === 'locked-spec')) {
      report(station, `test-design may be granted the locked spec alone; it is granted [${context.map(String).join(', ')}]`);
    }
    if (station === 'review') {
      for (const grant of context) {
        if (REVIEW_FORBIDDEN_GRANTS.includes(grant as ReviewForbiddenGrant)) {
          report(station, `a review seat is never granted '${String(grant)}'`);
        }
      }
    }
    if (!isModelTier(c.tier)) report(station, `tier '${String(c.tier)}' is not a model tier`);
    const writes = c.writeBoundary as Partial<Record<keyof WriteBoundary, unknown>> | undefined;
    if (writes?.vault !== 'never') report(station, 'the write boundary must deny the Vault');
    if (writes?.protectedPathPolicy !== 'escalate') report(station, 'protected paths must escalate');
    if (!(isNonNegativeInteger(c.maxIterations) && c.maxIterations >= 1)) {
      report(station, 'maxIterations must be a positive integer; a task that may never be attempted cannot pass');
    }
    const retry = c.retry as { max?: unknown; backoffMs?: unknown } | undefined;
    if (retry === undefined || !isNonNegativeInteger(retry.max) || !isNonNegativeInteger(retry.backoffMs)) {
      report(station, 'retry.max and retry.backoffMs must be non-negative integers');
    }
    const gate = c.exitGate as { requiredChecks?: unknown; requiresPanel?: unknown; approval?: unknown } | undefined;
    if (!Array.isArray(gate?.requiredChecks)) report(station, 'exitGate.requiredChecks is not a list');
    if (!isApprovalOutcome(gate?.approval)) report(station, `exitGate.approval '${String(gate?.approval)}' is not an approval outcome`);
    if (gate?.requiresPanel !== false && M1_STATIONS.includes(station)) {
      report(station, 'requires a review panel, and M1 has none; a panel of one reviewer is not a panel');
    }
  }
  return problems;
}
