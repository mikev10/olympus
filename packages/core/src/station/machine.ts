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
import type { ApprovalGrant, AutonomyLevel, DraftRef, RunState, StationId, Task, TaskGraph, TaskId, TaskStatus } from '../run/types.js';
import { gatedIterations } from '../policy/tier.js';
import {
  CRITIC_CONTRACTS,
  criticContractProblems,
  DRAFT_ROLES,
  DRAFT_STATIONS,
  LOCKING_STATIONS,
  M1_STATIONS,
  REVIEW_FORBIDDEN_GRANTS,
  seatTaskId,
  STATION_CONTRACTS,
  type ReviewForbiddenGrant,
  type StationContractTable,
} from './contracts.js';
import type {
  ContextGrant,
  CriticContract,
  DraftCondition,
  DraftSeat,
  DraftStation,
  IndependenceGrade,
  ParkCause,
  RetryPart,
  ReviewSeat,
  StationContract,
  StationRefusal,
  StationTransition,
  TamperedPath,
} from './types.js';

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
 * A drafted artifact at its station's exit (R19): the draft, and the
 * conditions the runtime found failed for it. Empty `failed` means every
 * condition held; a condition the runtime could not evaluate is in it (I5).
 */
export interface DraftFloor {
  readonly draft: DraftRef;
  readonly failed: readonly DraftCondition[];
}

/**
 * The approval a station exit needs at a level: the stricter of the
 * contract's own floor and the policy cell, raised to `human-required` when a
 * protected path was touched or tamper analysis found anything
 * (`protectedPathPolicy: 'escalate'`).
 *
 * A drafted artifact's exit has a floor of its own, applied as `integrate`'s
 * is (D-A-DS-04): `human-required` unless the level is L2 and every condition
 * held, so `auto` stands only where the person's cell is `auto`, at L2, with
 * nothing failed. L3 is `human-required` until its own amendment (M3).
 *
 * The policy is total, so a missing cell means the value did not come from
 * `resolvePolicy`; it reads `human-required`, the value `resolvePolicy` gives
 * every omitted key. A cell that is not an outcome at all reads `blocked`:
 * nothing can be approved against a rule nobody can read (I5).
 */
export function effectiveApproval(
  contract: StationContract, policy: Policy, level: AutonomyLevel, protectedPathsTouched: readonly string[], drafted?: DraftFloor,
): ApprovalOutcome {
  const key = approvalKey(contract.id, level);
  const cell: unknown = Object.hasOwn(policy.approvals, key) ? policy.approvals[key] : 'human-required';
  const fromPolicy: ApprovalOutcome = isApprovalOutcome(cell) ? cell : 'blocked';
  const floor: ApprovalOutcome = isApprovalOutcome(contract.exitGate.approval) ? contract.exitGate.approval : 'blocked';
  let outcome = stricter(floor, fromPolicy);
  if (drafted !== undefined) outcome = stricter(outcome, level === 2 && drafted.failed.length === 0 ? 'auto' : 'human-required');
  // `protectedPathPolicy` is the literal 'escalate' on every contract, so a
  // touched protected path always raises the gate; contractTableProblems
  // checks the literal on the values.
  return protectedPathsTouched.length > 0 ? stricter(outcome, 'human-required') : outcome;
}

/** Whether a grant clears this exit: the key, unspent, and for a drafted exit the same draft and attempt (R19). */
export function grantClears(grant: ApprovalGrant, key: ApprovalKey, draft: DraftRef | null): boolean {
  if (grant.key !== key || grant.usedAt !== null) return false;
  const named = grant.draft;
  if (draft === null) return named === null;
  return named !== null && named.sha256 === draft.sha256 && named.attempt === draft.attempt;
}

export interface TransitionInput {
  readonly from: StationId;
  readonly to: StationId;
  readonly level: AutonomyLevel;
  readonly policy: Policy;
  /** What the lock re-verification found on the way out; empty when intact. */
  readonly tampered: readonly TamperedPath[];
  readonly grants: readonly ApprovalGrant[];
  /** Protected paths the work touched, from the tamper reports of the tasks it accepted. */
  readonly protectedPathsTouched: readonly string[];
  /**
   * Every other tamper finding in those reports: a weakened assertion, an added
   * skip marker, a deleted test, a regenerated snapshot. Each escalates the exit
   * the way a protected path does; none decides anything alone (P7).
   */
  readonly tamperFindings: readonly string[];
  /** A drafted artifact's exit: its draft and failed conditions. Absent at every other exit (R19). */
  readonly draft?: DraftFloor;
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
  const approval = effectiveApproval(contract, input.policy, input.level, [...input.protectedPathsTouched, ...input.tamperFindings], input.draft);
  if (approval === 'blocked') {
    return { ok: false, reason: 'approval-blocked', key, message: `the exit from ${input.from} at L${String(input.level)} is blocked by policy; the run does not advance` };
  }
  if (approval === 'human-required' && !input.grants.some((g) => grantClears(g, key, input.draft?.draft ?? null))) {
    const escalations = [...input.protectedPathsTouched.map((path) => `protected path touched: ${path}`), ...input.tamperFindings];
    const why = escalations.length === 0 ? '' : `; escalated by: ${escalations.join('; ')}`;
    return { ok: false, reason: 'approval-required', key, escalations, message: `the exit from ${input.from} at L${String(input.level)} needs a human approval, and none is recorded${why}` };
  }
  return { ok: true, next: input.to, spends: approval === 'human-required' ? key : null };
}

export type SeatResult = { readonly ok: true; readonly seat: ReviewSeat } | StationRefusal;

const GRADE_RANK: Readonly<Record<IndependenceGrade, number>> = { 'different-family': 0, 'different-model': 1, 'same-model': 2 };

/**
 * How independent two seats are, from the models the runtime resolved for
 * them (D-A-DS-06). The family is the declared one, never inferred (I6); a
 * model is the same model when its provider, name, and version all match.
 */
export function gradeOf(a: ModelIdentity, b: ModelIdentity): IndependenceGrade {
  if (a.family !== b.family) return 'different-family';
  return a.provider === b.provider && a.model === b.model && a.version === b.version ? 'same-model' : 'different-model';
}

/** The weaker of two grades: what a pair compared twice, or a seat compared with several authors, can claim. */
export function weakerGrade(a: IndependenceGrade, b: IndependenceGrade): IndependenceGrade {
  return GRADE_RANK[a] >= GRADE_RANK[b] ? a : b;
}

/** The weakest grade between `seat` and any of `others`. */
export function gradeAgainst(seat: ModelIdentity, others: readonly ModelIdentity[]): IndependenceGrade {
  return others.reduce<IndependenceGrade>((grade, other) => weakerGrade(grade, gradeOf(seat, other)), 'different-family');
}

/**
 * Assembles one review seat (I6). The reviewer's family is compared with every
 * author's. At L3 a match refuses the seat and the run does not advance. At
 * L0-L2 the seat is filled and records the weakest grade, so the run says it
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
    seat: { task, authors: authors.map((a) => ({ ...a })), reviewer: { ...reviewer }, independence: gradeAgainst(reviewer, authors) },
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
  /** Every task in it is built at once, each in its own sandbox (R4). Never empty, never more than the limit allows. */
  | { readonly kind: 'build'; readonly tasks: readonly [Task, ...Task[]] }
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
 * What the policy lets a run do at once, read by `nextStep` (R4). The line
 * passes `maxParallelTasks` as the lower of the policy's and the driver's
 * declared `parallelism`; a caller with no driver passes the policy's own,
 * since the batch size changes no refusal and no exit (D-R4-02).
 */
export interface StepLimits {
  readonly maxParallelTasks: number;
  readonly maxConflictRetries: number;
}

/**
 * The most times a station may invoke a driver for one task: every iteration
 * spending every retry, and one more iteration's worth for each of the task's
 * `conflicts` (A-R4-01). An uninterrupted run cannot exceed it, so a run that
 * does is replaying an attempt a stop left in flight rather than progressing,
 * and the task parks instead of spending without bound (A-P4-06).
 */
export function maxStarts(contract: StationContract, conflicts: number): number {
  return (contract.maxIterations + conflicts) * (contract.retry.max + 1);
}

/**
 * Why a parked task was parked: the cause its park recorded, or, for a park
 * committed before the cause was recorded, the cause read back from its attempt
 * counts against the contract of the station it parked at and the policy's
 * conflict bound (A-R4-05).
 */
export function parkRefusal(state: RunState, task: Task, limits: StepLimits, contracts: StationContractTable = STATION_CONTRACTS): StationRefusal {
  const attempts = Object.hasOwn(state.attempts, task.id) ? state.attempts[task.id] : undefined;
  const recorded = attempts?.parkedFor;
  const last = attempts?.conflicts.at(-1);
  const byConflicts = recorded === undefined ? attempts !== undefined && attempts.conflicts.length > limits.maxConflictRetries : recorded === 'conflicts-exhausted';
  if (byConflicts && last !== undefined) {
    const limit = limits.maxConflictRetries;
    return {
      ok: false,
      reason: 'parked',
      task: task.id,
      cause: 'conflicts-exhausted',
      limit,
      conflictsWith: last.with,
      paths: last.paths,
      message: `task ${task.id} parked at ${state.station}: its change collided with ${last.with.join(', ')} on ${last.paths.join(', ')}, `
        + `past the ${String(limit)} rebuild(s) the policy allows; no side was picked`,
    };
  }
  const at = contracts[state.station];
  const startLimit = maxStarts(at, attempts?.conflicts.length ?? 0);
  const retryLimit = at.retry.max;
  const byStarts = attempts !== undefined && attempts.starts >= startLimit && gatedIterations(attempts) < contracts[task.station].maxIterations;
  const byRetries = !byStarts && attempts !== undefined && attempts.retries > retryLimit;
  const derived: Exclude<ParkCause, 'conflicts-exhausted' | 'drafts-rejected'> = byStarts ? 'starts-exhausted' : byRetries ? 'retries-exhausted' : 'iterations-exhausted';
  // A task's park never records `drafts-rejected`, which parks a station, not a task.
  const cause = recorded === undefined || recorded === 'conflicts-exhausted' || recorded === 'drafts-rejected' ? derived : recorded;
  const limit = cause === 'starts-exhausted' ? startLimit : cause === 'retries-exhausted' ? retryLimit : contracts[task.station].maxIterations;
  const message =
    cause === 'starts-exhausted'
      ? `task ${task.id} parked at ${state.station}: its driver was invoked ${String(limit)} times, the most an uninterrupted run could, without the task finishing`
      : cause === 'retries-exhausted'
        ? `task ${task.id} parked at ${state.station}: its driver or sandbox failed more than ${String(limit)} retries`
        : `task ${task.id} parked: its gate failed on all ${String(limit)} iterations`;
  return { ok: false, reason: 'parked', task: task.id, cause, limit, message };
}

/**
 * The next thing the line does, from committed state alone.
 *
 * `build` builds every task whose dependencies have passed and that has not,
 * up to `limits.maxParallelTasks` at once, in graph order (R4); `verify`
 * verifies one task at a time, every task
 * `build` left verifying; leaving `verify` goes back to `build` while any build
 * task has not passed, and on to `review` once all have. A task whose status is
 * `running` was in flight when the run stopped, and is run again.
 */
export function nextStep(state: RunState, graph: TaskGraph, limits: StepLimits, contracts: StationContractTable = STATION_CONTRACTS): Step {
  if (!Number.isInteger(limits.maxParallelTasks) || limits.maxParallelTasks < 1) {
    throw new Error(`station machine: ${String(limits.maxParallelTasks)} tasks at once is not a positive integer; refused rather than building none`);
  }
  // A cancelled run does nothing more, whatever else its state holds (A-P9-01).
  if (state.cancelled !== null) {
    const { by, at } = state.cancelled;
    return {
      kind: 'refuse',
      refusal: { ok: false, reason: 'cancelled', cancelledBy: by, cancelledAt: at, message: `the run was cancelled by ${by} at ${at} and does not continue` },
    };
  }
  // A drive that ended in an error stopped the run without saying why in its state; the halt is that record (A-P9-02).
  if (state.halted !== null) {
    const { at, message } = state.halted;
    return { kind: 'refuse', refusal: { ok: false, reason: 'halted', haltedAt: at, message: `a drive of the run ended in an error at ${at} and the run does not continue: ${message}` } };
  }
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
  if (parked !== undefined) return { kind: 'refuse', refusal: parkRefusal(state, parked, limits, contracts) };
  // A drafting seat parks like a task, and a person's rejection of a station's last draft parks the run (R19).
  for (const station of DRAFT_STATIONS) {
    for (const seat of ['drafter', 'critic'] as const) {
      const task = seatTask(state, station, seat);
      if (statusOf(state, task) === 'parked') return { kind: 'refuse', refusal: parkRefusal(state, task, limits, contracts) };
    }
    if (state.drafts[station]?.parked === true) return { kind: 'refuse', refusal: draftsRejected(station, contracts) };
  }

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
      const [first, ...rest] = builds.filter((t) => BUILDABLE.has(statusOf(state, t) ?? 'pending') && depsPassed(state, t)).slice(0, limits.maxParallelTasks);
      return first === undefined ? { kind: 'finish', station: 'build' } : { kind: 'build', tasks: [first, ...rest] };
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

/**
 * A drafting seat as a task, so its attempts, retries, starts, usage, and park
 * are counted by the same rules as a graph task's (R19). It depends on
 * nothing, and no graph names it.
 */
export function seatTask(state: Pick<RunState, 'runId'>, station: DraftStation, seat: DraftSeat, baseCommit = ''): Task {
  return {
    id: seatTaskId(station, seat),
    runId: state.runId,
    station,
    role: DRAFT_ROLES[station][seat],
    dependsOn: [],
    baseCommit,
    dependencySet: [],
    worktreePath: '',
    attempt: 1,
  };
}

/** The refusal of a run whose drafting station's last allowed draft a person rejected (R19, D-A-DS-02). */
export function draftsRejected(station: DraftStation, contracts: StationContractTable = STATION_CONTRACTS): StationRefusal {
  const limit = contracts[station].maxIterations;
  return {
    ok: false,
    reason: 'parked',
    task: null,
    station,
    cause: 'drafts-rejected',
    limit,
    message: `the run parked at ${station}: a person rejected its draft on the last of ${String(limit)} attempts`,
  };
}

/**
 * A drafter's retry as its request's variable suffix: the typed parts of
 * what sent its last draft back, and nothing else (D-A-DS-02). Never in the
 * stable prefix or a role. At `test-design` the locked-spec-alone rule
 * admits these parts and no other: a person's notes there are refused, since
 * an approver who has read the repository would otherwise be a channel
 * around the black box, and a test drafter learns of a base run only each
 * check's id, declaration, and exit code or fixed cause.
 */
export function retrySuffix(station: DraftStation, attempt: number, parts: readonly RetryPart[]): string {
  const lines = [`attempt ${String(attempt)}`];
  for (const part of parts) {
    switch (part.kind) {
      case 'critic-findings':
        lines.push('[critic-findings]', ...part.findings.map((f) => `- ${f}`));
        break;
      case 'runtime-problems':
        lines.push('[runtime-problems]', ...part.problems.map((p) => `- ${p.path}: ${p.code}`));
        break;
      case 'base-refusal':
        lines.push('[base-refusal]', ...part.checks.map((c) => `- ${c.checkId} declared ${c.declared ?? 'nothing'}: ${'exitCode' in c ? `exit ${String(c.exitCode)}` : c.cause}`));
        break;
      case 'rejection-reason':
        lines.push('[rejection-reason]', part.reason);
        break;
      case 'notes':
        if (station !== 'spec') throw new Error(`station machine: a ${station} retry carries no notes; a rejection there carries a reason from a fixed set`);
        lines.push('[approver-notes]', part.notes);
        break;
    }
  }
  return lines.join('\n');
}

/**
 * The context a critic seat is given: the offered parts its contract grants,
 * in the contract's order, and nothing else (R19). The contract is checked
 * again here rather than trusted, as `grantedContext` checks a station's: a
 * `test-design` critic granted anything beyond the locked spec, the draft,
 * and the rubric throws before anything is assembled.
 */
export function grantedCriticContext(contract: CriticContract, offered: Partial<Record<ContextGrant, string>>): ContextPart[] {
  const problems = criticContractProblems({ ...CRITIC_CONTRACTS, [contract.station]: contract });
  if (problems.length > 0) throw new Error(`station machine: ${problems.map((p) => `${p.station}: ${p.message}`).join('; ')}`);
  const parts: ContextPart[] = [];
  for (const grant of contract.allowedContext) {
    const text = Object.hasOwn(offered, grant) ? offered[grant] : undefined;
    if (typeof text === 'string') parts.push({ grant, text });
  }
  return parts;
}

/**
 * Seats a test drafter against every model the build driver can resolve for
 * the run (R19, R9's `test-design` and `build` row). A drafter of a builder's
 * family writes the tests its own family is judged by: at L3 it is refused,
 * as a same-family reviewer is; below L3 it is seated and the floor's
 * `drafter-independent-of-builder` condition fails, so its draft goes to a
 * person. The grade is the weakest against any builder model.
 */
export function seatTestDrafter(
  drafter: ModelIdentity, builders: readonly ModelIdentity[], level: AutonomyLevel,
): { readonly ok: true; readonly grade: IndependenceGrade } | StationRefusal {
  const grade = gradeAgainst(drafter, builders);
  if (grade !== 'different-family' && level === 3) {
    return {
      ok: false,
      reason: 'same-family-drafter',
      station: 'test-design',
      family: drafter.family,
      message: `the test drafter shares the model family '${drafter.family}' with a model the build driver can resolve, and L3 does not seat it`,
    };
  }
  return { ok: true, grade };
}
