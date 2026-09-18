/**
 * The station machine: pure functions over run state, policy, and the
 * contract table. Nothing here reads a file, calls a driver, or touches the
 * Vault. `vault` and `integrity` both depend on `core`, so the machine cannot
 * import them, and it does not need to: the line in `packages/api` performs
 * each step this module names and hands back what it observed.
 *
 * `nextStep` is the whole of scheduling and resume. It reads only a committed
 * `RunState` and the task graph the run was admitted with, so a run started
 * fresh and a run resumed from the same state take the same next step; there
 * is no second code path for resume to drift from.
 */
import type { DriverCapabilities, DriverCapability, ModelIdentity } from '../driver/contract.js';
import { isApprovalOutcome, isAutonomyLevel } from '../policy/constants.js';
import type { ApprovalKey, ApprovalOutcome, Policy, PolicyRefusal } from '../policy/types.js';
import type { ApprovalGrant, AutonomyLevel, RunState, StationId, Task, TaskGraph, TaskId, TaskStatus } from '../run/types.js';
import {
  LOCKING_STATIONS,
  M1_STATIONS,
  REVIEW_FORBIDDEN_GRANTS,
  STATION_CONTRACTS,
  type ReviewForbiddenGrant,
  type StationContractTable,
} from './contracts.js';
import type { ContextGrant, ParkCause, ReviewSeat, StationContract, StationRefusal, StationTransition, TamperedPath } from './types.js';

/** The station after `from` in station order; `learn` has none. */
export function successor(from: StationId): StationId | null {
  const order: readonly StationId[] = [...M1_STATIONS, 'observe', 'learn'];
  const at = order.indexOf(from);
  return at === -1 || at === order.length - 1 ? null : (order[at + 1] ?? null);
}

function orderOf(station: StationId): number {
  return [...M1_STATIONS, 'observe', 'learn'].indexOf(station);
}

/** True when the run leaves `from` for a station earlier on the line: a rebuild, not an advance. */
export function isBackward(from: StationId, to: StationId): boolean {
  return orderOf(to) < orderOf(from);
}

/** True once a station that locks artifacts has done its work, so a transition out of `station` has locks to re-verify (I3). */
export function locksHeldLeaving(station: StationId): boolean {
  const first = LOCKING_STATIONS[0];
  return first !== undefined && orderOf(station) >= orderOf(first);
}

/**
 * The capability a driver lacks for a station, or undefined when it has every
 * one. A boolean capability is missing when false; `parallelism` is a count,
 * missing below one. Anything else in the capabilities object, including a
 * value of the wrong type, is missing: an unreadable declaration is not a
 * declaration (I5).
 */
export function missingCapability(contract: StationContract, capabilities: DriverCapabilities): DriverCapability | undefined {
  for (const capability of contract.requires) {
    const declared: unknown = Object.hasOwn(capabilities, capability) ? capabilities[capability] : undefined;
    const present = capability === 'parallelism'
      ? typeof declared === 'number' && Number.isInteger(declared) && declared >= 1
      : declared === true;
    if (!present) return capability;
  }
  return undefined;
}

/** The capability refusal for a station whose driver lacks something its contract requires, or undefined (I5). */
export function capabilityRefusal(contract: StationContract, capabilities: DriverCapabilities): StationRefusal | undefined {
  const capability = missingCapability(contract, capabilities);
  if (capability === undefined) return undefined;
  return {
    ok: false,
    reason: 'capability-missing',
    station: contract.id,
    capability,
    message: `${contract.id} requires the driver capability '${capability}', and the driver does not declare it; refused, not run without it`,
  };
}

const STRICTNESS: Readonly<Record<ApprovalOutcome, number>> = { auto: 0, 'human-required': 1, blocked: 2 };

function stricter(a: ApprovalOutcome, b: ApprovalOutcome): ApprovalOutcome {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

export function approvalKey(station: StationId, level: AutonomyLevel): ApprovalKey {
  return `${station}:${String(level)}` as ApprovalKey;
}

/**
 * The approval a station exit needs at a level: the stricter of the
 * contract's own floor and the policy cell, raised to `human-required` when a
 * protected path was touched (`protectedPathPolicy: 'escalate'`).
 *
 * The policy is total, so a missing cell means the value did not come from
 * `resolvePolicy`; it reads `human-required`, the value `resolvePolicy` gives
 * every omitted key. A cell that is not an outcome at all reads `blocked`:
 * nothing can be approved against a rule nobody can read (I5).
 */
export function effectiveApproval(
  contract: StationContract, policy: Policy, level: AutonomyLevel, protectedPathsTouched: readonly string[],
): ApprovalOutcome {
  const key = approvalKey(contract.id, level);
  const cell: unknown = Object.hasOwn(policy.approvals, key) ? policy.approvals[key] : 'human-required';
  const fromPolicy: ApprovalOutcome = isApprovalOutcome(cell) ? cell : 'blocked';
  const floor: ApprovalOutcome = isApprovalOutcome(contract.exitGate.approval) ? contract.exitGate.approval : 'blocked';
  const outcome = stricter(floor, fromPolicy);
  // `protectedPathPolicy` is the literal 'escalate' on every contract, so a
  // touched protected path always raises the gate; contractTableProblems
  // checks the literal on the values.
  return protectedPathsTouched.length > 0 ? stricter(outcome, 'human-required') : outcome;
}

export interface TransitionInput {
  readonly from: StationId;
  readonly to: StationId;
  readonly level: AutonomyLevel;
  readonly policy: Policy;
  /** What the lock re-verification found on the way out; empty when intact. */
  readonly tampered: readonly TamperedPath[];
  readonly grants: readonly ApprovalGrant[];
  /** Protected paths the work touched. Empty until tamper analysis exists (P7); SKELETON_LINE says so. */
  readonly protectedPathsTouched: readonly string[];
  readonly contracts?: StationContractTable;
}

/**
 * The transition function. A tampered lock refuses whatever else is true
 * (I3). A move back up the line — `verify` returning a task to `build` — is a
 * rebuild, not an advance, and needs no approval. An advance needs the exit
 * approval: `blocked` refuses, `human-required` refuses until an unspent grant
 * for exactly this station and level is recorded, and `auto` advances (I4). A
 * human-required advance names the grant it spends, so the next visit to the
 * same station waits for its own approval (A-P4-04).
 */
export function transition(input: TransitionInput): StationTransition {
  if (input.tampered.length > 0) {
    const paths = input.tampered.map((t) => `${t.path} (expected ${t.expected}, actual ${t.actual})`).join(', ');
    return { ok: false, reason: 'lock-tamper', tampered: [...input.tampered], message: `a locked artifact changed before leaving ${input.from}: ${paths}` };
  }
  if (isBackward(input.from, input.to)) return { ok: true, next: input.to, spends: null };
  const contracts = input.contracts ?? STATION_CONTRACTS;
  const contract = contracts[input.from];
  const key = approvalKey(input.from, input.level);
  const approval = effectiveApproval(contract, input.policy, input.level, input.protectedPathsTouched);
  if (approval === 'blocked') {
    return { ok: false, reason: 'approval-blocked', key, message: `the exit from ${input.from} at L${String(input.level)} is blocked by policy; the run does not advance` };
  }
  if (approval === 'human-required' && !input.grants.some((g) => g.key === key && g.usedAt === null)) {
    return { ok: false, reason: 'approval-required', key, message: `the exit from ${input.from} at L${String(input.level)} needs a human approval, and none is recorded` };
  }
  return { ok: true, next: input.to, spends: approval === 'human-required' ? key : null };
}

export type SeatResult = { readonly ok: true; readonly seat: ReviewSeat } | StationRefusal;

/**
 * Assembles one review seat (I6). The reviewer's family is compared with every
 * author's. At L3 a match refuses the seat and the run does not advance. At
 * L0-L2 the seat is filled and says `reduced`, so the run records that it
 * lacks the guarantee rather than claiming it. A seat with no author is not a
 * review and throws.
 */
export function seatReviewer(task: TaskId, authors: readonly ModelIdentity[], reviewer: ModelIdentity, level: AutonomyLevel): SeatResult {
  if (authors.length === 0) throw new Error(`station machine: review task ${task} has no author to be independent of`);
  const shared = authors.find((author) => author.family === reviewer.family);
  if (shared !== undefined && level === 3) {
    return {
      ok: false,
      reason: 'same-family-reviewer',
      task,
      family: reviewer.family,
      message: `review task ${task}: the reviewer shares the model family '${reviewer.family}' with an author, and L3 does not seat it`,
    };
  }
  return {
    ok: true,
    seat: { task, authors: authors.map((a) => ({ ...a })), reviewer: { ...reviewer }, independence: shared === undefined ? 'independent' : 'reduced' },
  };
}

export interface ContextPart {
  readonly grant: ContextGrant;
  readonly text: string;
}

/**
 * The context a station's seat is given: the offered parts its contract
 * grants, in the contract's order, and nothing else. The line offers what it
 * has, including material a seat must not see; this function is what keeps it
 * out, so deleting it puts the author's narrative in front of the reviewer.
 *
 * The contract is checked again here rather than trusted: a review contract
 * granting `author-narrative` or `plan`, or a `test-design` contract granting
 * anything but the locked spec, throws before anything is assembled.
 */
export function grantedContext(contract: StationContract, offered: Partial<Record<ContextGrant, string>>): ContextPart[] {
  if (contract.id === 'review') {
    const forbidden = contract.allowedContext.filter((g) => REVIEW_FORBIDDEN_GRANTS.includes(g as ReviewForbiddenGrant));
    if (forbidden.length > 0) throw new Error(`station machine: a review seat is never granted ${forbidden.join(', ')}`);
  }
  if (contract.id === 'test-design' && !(contract.allowedContext.length === 1 && contract.allowedContext[0] === 'locked-spec')) {
    throw new Error(`station machine: test-design may be granted the locked spec alone, not [${contract.allowedContext.join(', ')}]`);
  }
  const parts: ContextPart[] = [];
  for (const grant of contract.allowedContext) {
    const text = Object.hasOwn(offered, grant) ? offered[grant] : undefined;
    if (typeof text === 'string') parts.push({ grant, text });
  }
  return parts;
}

/**
 * Cap arithmetic for a station where no role acts: the global cap and the
 * station's own cap, if the policy sets one. A station a role acts at is
 * resolved by `PolicyEngine.resolveAutonomy`, which adds the role's ceiling.
 * Over-request is refused, never downgraded (I5).
 */
export function stationCapRefusal(requested: AutonomyLevel, station: StationId, policy: Policy): PolicyRefusal | undefined {
  // As in resolveAutonomy (D-P3-12): a value that is not a level survives a
  // numeric comparison, so it is refused before one is made.
  if (!isAutonomyLevel(requested)) {
    throw new Error(`station machine: autonomy level ${String(requested)} is not one of 0, 1, 2, 3; refused rather than compared`);
  }
  const stationCap: unknown = Object.hasOwn(policy.stationCaps, station) ? policy.stationCaps[station] : undefined;
  const bounds = [policy.globalCap, ...(typeof stationCap === 'number' ? [stationCap] : [])];
  const cap = Math.min(...bounds);
  if (requested <= cap) return undefined;
  return {
    ok: false,
    reason: 'exceeds-cap',
    detail: `L${String(requested)} requested at '${station}', effective cap L${String(cap)} (global L${String(policy.globalCap)}, `
      + `${typeof stationCap === 'number' ? `${station} L${String(stationCap)}` : `no ${station} cap`}). Refused, not downgraded.`,
  };
}

export type Step =
  /** The run cannot continue: a violation is recorded or a task is parked. */
  | { readonly kind: 'refuse'; readonly refusal: StationRefusal }
  /** A station that is the runtime's own work: do it, then the station is exiting. */
  | { readonly kind: 'work'; readonly station: StationId }
  | { readonly kind: 'build'; readonly task: Task }
  | { readonly kind: 'verify'; readonly task: Task }
  | { readonly kind: 'review'; readonly task: Task }
  /** A task station with nothing left to do at it: the station is exiting. */
  | { readonly kind: 'finish'; readonly station: StationId }
  /** The station's work is done: evaluate the exit into `to`. */
  | { readonly kind: 'exit'; readonly from: StationId; readonly to: StationId };

const BUILDABLE: ReadonlySet<TaskStatus> = new Set(['pending', 'failed', 'running']);

function statusOf(state: RunState, task: Task): TaskStatus | undefined {
  return Object.hasOwn(state.tasks, task.id) ? state.tasks[task.id] : undefined;
}

function depsPassed(state: RunState, task: Task): boolean {
  return task.dependsOn.every((dep) => Object.hasOwn(state.tasks, dep) && state.tasks[dep] === 'passed');
}

/**
 * The most times a station may invoke a driver for one task: every iteration
 * spending every retry. An uninterrupted run cannot exceed it, so a run that
 * does is replaying an attempt a stop left in flight rather than progressing,
 * and the task parks instead of spending without bound (A-P4-06).
 */
export function maxStarts(contract: StationContract): number {
  return contract.maxIterations * (contract.retry.max + 1);
}

/** Why a parked task was parked, read back from its attempt counts against the contract of the station it parked at. */
export function parkRefusal(state: RunState, task: Task, contracts: StationContractTable = STATION_CONTRACTS): StationRefusal {
  const attempts = Object.hasOwn(state.attempts, task.id) ? state.attempts[task.id] : undefined;
  const at = contracts[state.station];
  const startLimit = maxStarts(at);
  const retryLimit = at.retry.max;
  const byStarts = attempts !== undefined && attempts.starts >= startLimit && attempts.iterations < contracts[task.station].maxIterations;
  const byRetries = !byStarts && attempts !== undefined && attempts.retries > retryLimit;
  const cause: ParkCause = byStarts ? 'starts-exhausted' : byRetries ? 'retries-exhausted' : 'iterations-exhausted';
  const limit = byStarts ? startLimit : byRetries ? retryLimit : contracts[task.station].maxIterations;
  const message =
    byStarts
      ? `task ${task.id} parked at ${state.station}: its driver was invoked ${String(limit)} times, the most an uninterrupted run could, without the task finishing`
      : byRetries
        ? `task ${task.id} parked at ${state.station}: its driver or sandbox failed more than ${String(limit)} retries`
        : `task ${task.id} parked: its gate failed on all ${String(limit)} iterations`;
  return { ok: false, reason: 'parked', task: task.id, cause, limit, message };
}

/**
 * The next thing the line does, from committed state alone.
 *
 * Tasks run one at a time in graph order. `build` builds every task whose
 * dependencies have passed and that has not; `verify` verifies every task
 * `build` left verifying; leaving `verify` goes back to `build` while any build
 * task has not passed, and on to `review` once all have. A task whose status is
 * `running` was in flight when the run stopped, and is run again.
 */
export function nextStep(state: RunState, graph: TaskGraph, contracts: StationContractTable = STATION_CONTRACTS): Step {
  if (state.violations.length > 0) {
    return {
      kind: 'refuse',
      refusal: {
        ok: false,
        reason: 'violation',
        violations: [...state.violations],
        message: `the run has ${String(state.violations.length)} recorded integrity violation(s) and does not continue`,
      },
    };
  }
  const parked = graph.tasks.find((task) => statusOf(state, task) === 'parked');
  if (parked !== undefined) return { kind: 'refuse', refusal: parkRefusal(state, parked, contracts) };

  const builds = graph.tasks.filter((task) => task.station === 'build');
  const reviews = graph.tasks.filter((task) => task.station === 'review');

  if (state.phase === 'exiting') {
    if (state.station === 'verify') {
      if (builds.every((task) => statusOf(state, task) === 'passed')) return { kind: 'exit', from: 'verify', to: 'review' };
      if (!builds.some((task) => BUILDABLE.has(statusOf(state, task) ?? 'pending') && depsPassed(state, task))) {
        throw new Error('station machine: leaving verify with build tasks unpassed, and none of them can be built; the graph cannot finish');
      }
      return { kind: 'exit', from: 'verify', to: 'build' };
    }
    const to = successor(state.station);
    if (to === null) throw new Error(`station machine: there is no station after ${state.station}`);
    return { kind: 'exit', from: state.station, to };
  }

  switch (state.station) {
    case 'build': {
      const task = builds.find((t) => BUILDABLE.has(statusOf(state, t) ?? 'pending') && depsPassed(state, t));
      return task === undefined ? { kind: 'finish', station: 'build' } : { kind: 'build', task };
    }
    case 'verify': {
      const task = builds.find((t) => statusOf(state, t) === 'verifying');
      return task === undefined ? { kind: 'finish', station: 'verify' } : { kind: 'verify', task };
    }
    case 'review': {
      const task = reviews.find((t) => {
        const status = statusOf(state, t) ?? 'pending';
        return status === 'pending' || status === 'running';
      });
      return task === undefined ? { kind: 'finish', station: 'review' } : { kind: 'review', task };
    }
    case 'intake':
    case 'spec':
    case 'test-design':
    case 'plan':
    case 'integrate':
      return { kind: 'work', station: state.station };
    case 'observe':
    case 'learn':
      throw new Error(`station machine: M1 never enters ${state.station}`);
  }
}
