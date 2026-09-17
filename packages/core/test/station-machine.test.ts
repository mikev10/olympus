/**
 * The station machine's pure functions. The registry holds the invariant
 * assertions, which drive the line end to end; what is here is each rule on
 * its own, including the ones the line cannot reach yet (L3).
 */
import { describe, expect, test } from 'vitest';
import {
  approvalKey,
  capabilityRefusal,
  contractTableProblems,
  DEFAULT_POLICY_DOCUMENT,
  effectiveApproval,
  grantedContext,
  isBackward,
  locksHeldLeaving,
  M1_STATIONS,
  missingCapability,
  nextStep,
  seatReviewer,
  STATION_CONTRACTS,
  stationCapRefusal,
  StrictPolicyEngine,
  StubDriver,
  successor,
  transition,
  type ApprovalOutcome,
  type AutonomyLevel,
  type ModelFamily,
  type ModelIdentity,
  type Policy,
  type RoleId,
  type RunId,
  type RunState,
  type StationContractTable,
  type Task,
  type TaskGraph,
  type TaskId,
} from '../src/index.js';

const engine = new StrictPolicyEngine();
const runId = 'run-machine' as RunId;

function policyWith(cells: Record<string, ApprovalOutcome> = {}, stationCaps: Policy['stationCaps'] = {}): Policy {
  return engine.resolvePolicy({ ...DEFAULT_POLICY_DOCUMENT, approvals: cells, stationCaps });
}

function identity(family: string): ModelIdentity {
  return { provider: 'p', family: family as ModelFamily, model: 'm', version: '1' };
}

function task(id: string, station: 'build' | 'review', dependsOn: string[] = []): Task {
  return {
    id: id as TaskId,
    runId,
    station,
    role: (station === 'build' ? 'builder' : 'reviewer') as RoleId,
    dependsOn: dependsOn.map((d) => d as TaskId),
    baseCommit: 'c',
    dependencySet: ['**'],
    worktreePath: '/w',
    attempt: 1,
  };
}

const GRAPH: TaskGraph = { tasks: [task('a', 'build'), task('b', 'build', ['a']), task('r', 'review', ['a', 'b'])], edges: [] };

function state(overrides: Partial<RunState> = {}): RunState {
  return {
    runId,
    admission: { runId, kind: 'admission', hash: '0'.repeat(64) },
    station: 'intake',
    phase: 'working',
    tasks: {},
    attempts: {},
    results: {},
    evidenceRefs: [],
    violations: [],
    approvals: [],
    reviews: [],
    version: '1',
    ...overrides,
  };
}

describe('the contract table', () => {
  test('holds its own rules: no problems, every M1 station present, observe and learn never entered', () => {
    expect(contractTableProblems(STATION_CONTRACTS)).toEqual([]);
    expect(M1_STATIONS).toHaveLength(8);
    expect(successor('integrate')).toBe('observe');
  });

  test('is frozen: a caller cannot widen a seat at run time', () => {
    expect(() => {
      (STATION_CONTRACTS.review.allowedContext as string[]).push('author-narrative');
    }).toThrow();
  });

  test('a table widened past the compiler is refused, naming each rule it breaks', () => {
    const widened = {
      ...STATION_CONTRACTS,
      'test-design': { ...STATION_CONTRACTS['test-design'], allowedContext: ['locked-spec', 'plan'] },
      review: { ...STATION_CONTRACTS.review, allowedContext: ['diff', 'author-narrative'] },
      intake: { ...STATION_CONTRACTS.intake, requires: ['hooks'] },
      verify: { ...STATION_CONTRACTS.verify, exitGate: { ...STATION_CONTRACTS.verify.exitGate, requiresPanel: true } },
    } as unknown as StationContractTable;
    const problems = contractTableProblems(widened).map((p) => `${p.station}: ${p.message}`);
    expect(problems).toEqual([
      expect.stringMatching(/^intake: no driver runs/),
      expect.stringMatching(/^test-design: .*locked spec alone/),
      expect.stringMatching(/^verify: requires a review panel/),
      expect.stringMatching(/^review: .*never granted 'author-narrative'/),
    ]);
  });
});

describe('capabilities (I5)', () => {
  const caps = new StubDriver().capabilities();

  test('parallelism is a count: missing below one, present at one', () => {
    expect(missingCapability(STATION_CONTRACTS.build, caps)).toBeUndefined();
    expect(missingCapability(STATION_CONTRACTS.build, { ...caps, parallelism: 0 })).toBe('parallelism');
    expect(missingCapability(STATION_CONTRACTS.build, { ...caps, parallelism: Number.NaN })).toBe('parallelism');
  });

  test('a boolean capability is missing unless it is exactly true, and the refusal names the station and capability', () => {
    const contract = { ...STATION_CONTRACTS.build, requires: ['hooks' as const] };
    expect(capabilityRefusal(contract, caps)).toMatchObject({ ok: false, reason: 'capability-missing', station: 'build', capability: 'hooks' });
    expect(capabilityRefusal(contract, { ...caps, hooks: 'yes' as unknown as boolean })).toMatchObject({ capability: 'hooks' });
    expect(capabilityRefusal(contract, { ...caps, hooks: true })).toBeUndefined();
  });
});

describe('approvals (I4)', () => {
  test('the effective approval is the stricter of the contract floor and the policy cell', () => {
    const auto = policyWith({ 'integrate:2': 'auto', 'build:2': 'auto', 'review:2': 'blocked' });
    expect(effectiveApproval(STATION_CONTRACTS.integrate, auto, 2, [])).toBe('human-required');
    expect(effectiveApproval(STATION_CONTRACTS.build, auto, 2, [])).toBe('auto');
    expect(effectiveApproval(STATION_CONTRACTS.review, auto, 2, [])).toBe('blocked');
    expect(effectiveApproval(STATION_CONTRACTS.build, policyWith(), 2, [])).toBe('human-required');
  });

  test('a touched protected path raises an auto exit to human-required and leaves blocked blocked', () => {
    const cells = policyWith({ 'build:1': 'auto', 'review:1': 'blocked' });
    expect(effectiveApproval(STATION_CONTRACTS.build, cells, 1, ['.github/workflows/ci.yml'])).toBe('human-required');
    expect(effectiveApproval(STATION_CONTRACTS.review, cells, 1, ['.github/workflows/ci.yml'])).toBe('blocked');
  });

  test('a cell that is missing reads human-required, and one that is not an outcome reads blocked', () => {
    const forged = { ...policyWith(), approvals: { 'build:1': 'yes' } } as unknown as Policy;
    expect(effectiveApproval(STATION_CONTRACTS.build, forged, 1, [])).toBe('blocked');
    expect(effectiveApproval(STATION_CONTRACTS.spec, forged, 1, [])).toBe('human-required');
  });
});

describe('transition', () => {
  const base = { level: 1 as AutonomyLevel, tampered: [], grants: [], protectedPathsTouched: [] };

  test('a tampered lock refuses whatever the approval says', () => {
    const t = transition({ ...base, from: 'build', to: 'verify', policy: policyWith({ 'build:1': 'auto' }), tampered: [{ path: 'spec.md', expected: 'a', actual: 'b' }] });
    expect(t).toMatchObject({ ok: false, reason: 'lock-tamper', tampered: [{ path: 'spec.md' }] });
  });

  test('blocked refuses, human-required waits for exactly its key, auto advances', () => {
    expect(transition({ ...base, from: 'spec', to: 'test-design', policy: policyWith({ 'spec:1': 'blocked' }) })).toMatchObject({ reason: 'approval-blocked', key: 'spec:1' });
    const waits = policyWith({ 'spec:1': 'human-required' });
    expect(transition({ ...base, from: 'spec', to: 'test-design', policy: waits })).toMatchObject({ reason: 'approval-required', key: 'spec:1' });
    const wrong = [{ key: approvalKey('spec', 2), approvedBy: 'm', approvedAt: 't', usedAt: null }];
    expect(transition({ ...base, from: 'spec', to: 'test-design', policy: waits, grants: wrong })).toMatchObject({ reason: 'approval-required' });
    const right = [{ key: approvalKey('spec', 1), approvedBy: 'm', approvedAt: 't', usedAt: null }];
    expect(transition({ ...base, from: 'spec', to: 'test-design', policy: waits, grants: right })).toEqual({ ok: true, next: 'test-design', spends: 'spec:1' });
    // A grant already spent is not a standing approval of the next visit (A-P4-04).
    const spent = [{ key: approvalKey('spec', 1), approvedBy: 'm', approvedAt: 't', usedAt: 't' }];
    expect(transition({ ...base, from: 'spec', to: 'test-design', policy: waits, grants: spent })).toMatchObject({ reason: 'approval-required', key: 'spec:1' });
    expect(transition({ ...base, from: 'spec', to: 'test-design', policy: policyWith({ 'spec:1': 'auto' }) })).toEqual({ ok: true, next: 'test-design', spends: null });
  });

  test('a rebuild is not an advance and needs no approval, but still refuses a tampered lock', () => {
    expect(isBackward('verify', 'build')).toBe(true);
    expect(transition({ ...base, from: 'verify', to: 'build', policy: policyWith({ 'verify:1': 'blocked' }) })).toEqual({ ok: true, next: 'build', spends: null });
  });

  test('locks are re-verified leaving spec and every station after it, and not leaving intake, where nothing is locked yet', () => {
    expect(locksHeldLeaving('intake')).toBe(false);
    for (const station of M1_STATIONS.slice(1)) expect(locksHeldLeaving(station)).toBe(true);
  });
});

describe('the review seat (I6)', () => {
  const authors = [identity('claude'), identity('gpt')];

  test('at L3 a reviewer sharing any author family is refused', () => {
    expect(seatReviewer('r' as TaskId, authors, identity('gpt'), 3)).toMatchObject({ ok: false, reason: 'same-family-reviewer', task: 'r', family: 'gpt' });
  });

  test.each([0, 1, 2] as const)('at L%i the same family is seated and recorded as reduced', (level) => {
    expect(seatReviewer('r' as TaskId, authors, identity('claude'), level)).toMatchObject({ ok: true, seat: { independence: 'reduced' } });
  });

  test('a reviewer of another family is independent at every level, and a seat with no author throws', () => {
    for (const level of [0, 1, 2, 3] as const) {
      expect(seatReviewer('r' as TaskId, authors, identity('gemini'), level)).toMatchObject({ ok: true, seat: { independence: 'independent' } });
    }
    expect(() => seatReviewer('r' as TaskId, [], identity('gemini'), 1)).toThrow(/no author/);
  });
});

describe('context', () => {
  const offered = { 'locked-spec': 'SPEC', 'author-narrative': 'NARRATIVE', plan: 'PLAN', 'acceptance-tests': 'TESTS', conversation: 'CHAT' };

  test('a seat receives the offered parts its contract grants and nothing else', () => {
    expect(grantedContext(STATION_CONTRACTS.review, offered).map((p) => p.grant)).toEqual(['locked-spec', 'acceptance-tests']);
    expect(grantedContext(STATION_CONTRACTS['test-design'], offered)).toEqual([{ grant: 'locked-spec', text: 'SPEC' }]);
  });

  test('a contract widened past the compiler throws before anything is assembled', () => {
    const review = { ...STATION_CONTRACTS.review, allowedContext: ['locked-spec', 'author-narrative'] } as unknown as typeof STATION_CONTRACTS.review;
    expect(() => grantedContext(review, offered)).toThrow(/author-narrative/);
    const testDesign = { ...STATION_CONTRACTS['test-design'], allowedContext: ['locked-spec', 'plan'] } as unknown as typeof STATION_CONTRACTS.review;
    expect(() => grantedContext(testDesign, offered)).toThrow(/locked spec alone/);
  });
});

describe('station caps where no role acts (I5)', () => {
  test('refuses above the tighter of the global and station caps, never downgrades, and refuses a value that is not a level', () => {
    const capped = policyWith({}, { integrate: 1 });
    expect(stationCapRefusal(1, 'integrate', capped)).toBeUndefined();
    expect(stationCapRefusal(2, 'integrate', capped)).toMatchObject({ ok: false, reason: 'exceeds-cap' });
    expect(stationCapRefusal(2, 'intake', capped)).toBeUndefined();
    expect(stationCapRefusal(3, 'intake', capped)).toMatchObject({ reason: 'exceeds-cap' });
    expect(() => stationCapRefusal(Number.NaN as AutonomyLevel, 'intake', capped)).toThrow(/not one of/);
  });
});

describe('nextStep', () => {
  test('the runtime stations work, then exit into their successor', () => {
    expect(nextStep(state(), GRAPH)).toEqual({ kind: 'work', station: 'intake' });
    expect(nextStep(state({ station: 'plan', phase: 'exiting' }), GRAPH)).toEqual({ kind: 'exit', from: 'plan', to: 'build' });
  });

  test('build takes tasks in graph order once their dependencies pass; verify takes what build left verifying', () => {
    const tasks = { a: 'pending', b: 'pending', r: 'pending' } as RunState['tasks'];
    expect(nextStep(state({ station: 'build', tasks }), GRAPH)).toMatchObject({ kind: 'build', task: { id: 'a' } });
    const built = { ...tasks, a: 'verifying' } as RunState['tasks'];
    expect(nextStep(state({ station: 'build', tasks: built }), GRAPH)).toEqual({ kind: 'finish', station: 'build' });
    expect(nextStep(state({ station: 'verify', tasks: built }), GRAPH)).toMatchObject({ kind: 'verify', task: { id: 'a' } });
    const passed = { ...tasks, a: 'passed' } as RunState['tasks'];
    expect(nextStep(state({ station: 'verify', phase: 'exiting', tasks: passed }), GRAPH)).toEqual({ kind: 'exit', from: 'verify', to: 'build' });
    expect(nextStep(state({ station: 'build', tasks: passed }), GRAPH)).toMatchObject({ kind: 'build', task: { id: 'b' } });
    const all = { a: 'passed', b: 'passed', r: 'pending' } as RunState['tasks'];
    expect(nextStep(state({ station: 'verify', phase: 'exiting', tasks: all }), GRAPH)).toEqual({ kind: 'exit', from: 'verify', to: 'review' });
    expect(nextStep(state({ station: 'review', tasks: all }), GRAPH)).toMatchObject({ kind: 'review', task: { id: 'r' } });
  });

  test('a task running when the run stopped is run again', () => {
    const tasks = { a: 'running', b: 'pending', r: 'pending' } as RunState['tasks'];
    expect(nextStep(state({ station: 'build', tasks }), GRAPH)).toMatchObject({ kind: 'build', task: { id: 'a' } });
  });

  test('a recorded violation or a parked task refuses before anything else, naming the cause from the counts', () => {
    const violation = { runId, kind: 'violation' as const, hash: '1'.repeat(64) };
    expect(nextStep(state({ station: 'build', violations: [violation] }), GRAPH)).toMatchObject({ kind: 'refuse', refusal: { reason: 'violation', violations: [violation] } });
    const parked = state({
      station: 'verify',
      tasks: { a: 'parked' } as RunState['tasks'],
      attempts: { a: { iterations: 3, retries: 0 } } as RunState['attempts'],
    });
    expect(nextStep(parked, GRAPH)).toMatchObject({ kind: 'refuse', refusal: { reason: 'parked', task: 'a', cause: 'iterations-exhausted', limit: 3 } });
    const retried = state({
      station: 'build',
      tasks: { a: 'parked' } as RunState['tasks'],
      attempts: { a: { iterations: 1, retries: 3 } } as RunState['attempts'],
    });
    expect(nextStep(retried, GRAPH)).toMatchObject({ kind: 'refuse', refusal: { reason: 'parked', cause: 'retries-exhausted', limit: 2 } });
  });

  test('leaving verify with unpassed tasks none of which can be built is a defect, not a loop', () => {
    const stuck = { a: 'passed', b: 'verifying', r: 'pending' } as RunState['tasks'];
    expect(() => nextStep(state({ station: 'verify', phase: 'exiting', tasks: stuck }), GRAPH)).toThrow(/cannot finish/);
  });
});
