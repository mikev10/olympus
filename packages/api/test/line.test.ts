/**
 * The line end to end over the stubs: the hello fixture through stations 1-8.
 * Each test copies the fixture to a fresh temporary directory, which is the
 * Workspace. The invariant assertions themselves are the registry's; what is
 * here is the rest of the behaviour, read by field.
 */
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATION_CONTRACTS, type RunId, type RunState, type TaskId, type TaskRequest, type TaskResult, type VaultRef } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import { StubSandboxProvider, type ExecResult, type RelaySpec, type SandboxHandle, type SandboxSpec, type Teardown } from '@olympus-ai/sandbox';
import type { EnforcementDecision, EvidenceBundle, LockVerdict, UsageRecord, Vault } from '@olympus-ai/vault';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { approveStation, costTotals, readUsage, resumeRun, runStanding, startRun, type ComponentGraph, type RunOutcome } from '../src/index.js';
import { integrateEscalations, UNANALYSED_TESTS } from '../src/line.js';
import {
  approvals,
  built,
  ChosenDriver,
  HELLO_CHECK,
  makeWorkspace,
  policy,
  readSpec,
  removeWorkspace,
  runRequest,
  stubComponents,
  writeChecks,
} from './harness.js';
import { DelegatingDriver, DelegatingSandbox, DelegatingVault } from './wrappers.js';

const runId = 'run-hello' as RunId;
const hello = 'hello' as TaskId;
const helloReview = 'hello-review' as TaskId;

let workspace: string;
let components: ComponentGraph;

beforeEach(async () => {
  workspace = await makeWorkspace('p4-line-');
  components = stubComponents(workspace);
});

afterEach(async () => {
  await removeWorkspace(workspace);
});

async function read<T>(vault: Vault, ref: Parameters<Vault['read']>[0]): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as T;
}

function refusedState(outcome: RunOutcome): RunState {
  if (outcome.ok || outcome.reason !== 'refused' || outcome.state === null) throw new Error(`expected a refusal on the line, got ${JSON.stringify(outcome)}`);
  return outcome.state;
}

class RecordingSandbox extends DelegatingSandbox {
  readonly specs: SandboxSpec[] = [];
  readonly provisioned: SandboxHandle[] = [];
  readonly destroyed: SandboxHandle[] = [];

  override async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    this.specs.push(spec);
    const handle = await this.inner.provision(spec);
    this.provisioned.push(handle);
    return handle;
  }

  override destroy(h: SandboxHandle): Promise<Teardown> {
    this.destroyed.push(h);
    return this.inner.destroy(h);
  }
}

/** Rewrites the locked spec on the n-th lock verification, like an agent that edited it after the lock. */
class TamperingVault extends DelegatingVault {
  private readonly dir: string;
  private readonly onCall: number;
  private calls = 0;

  constructor(inner: Vault, dir: string, onCall: number) {
    super(inner);
    this.dir = dir;
    this.onCall = onCall;
  }

  override async verifyLocks(id: RunId): Promise<LockVerdict> {
    this.calls += 1;
    if (this.calls === this.onCall) await writeFile(join(this.dir, 'spec.md'), '# rewritten after the lock\n');
    return this.inner.verifyLocks(id);
  }
}

/** Fails the first check it runs and passes afterwards, so one verify sends the task back to `build`. */
class FailsFirstCheck extends DelegatingSandbox {
  private calls = 0;

  override async exec(handle: SandboxHandle, argv: string[]): Promise<ExecResult> {
    this.calls += 1;
    const result = await this.inner.exec(handle, argv);
    return this.calls === 1 ? { ...result, exitCode: 1 } : result;
  }
}

/** A kill: throws before the commit lands, so every Vault write before it is durable and the commit is not. */
class KillsBeforeCommit extends DelegatingVault {
  readonly when: (s: RunState) => boolean;

  constructor(inner: Vault, when: (s: RunState) => boolean) {
    super(inner);
    this.when = when;
  }

  override commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
    if (this.when(s)) throw new Error('killed');
    return this.inner.commitRunState(s, ifVersion);
  }
}

/** The park decisions recorded for a run, as the Vault holds them. */
async function parkDecisions(vault: Vault, id: RunId): Promise<EnforcementDecision[]> {
  const all = await Promise.all((await vault.readDecisions(id)).map((ref) => read<EnforcementDecision>(vault, ref)));
  return all.filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'parked');
}

/**
 * Stops the run at the commit that would park a task, noting first whether
 * that park's decision is already in the Vault. A park committed before its
 * decision leaves parked state with no record if the process stops between
 * the two (external review of P14, codex-2).
 */
class StopsAtPark extends DelegatingVault {
  recordedFirst: boolean | undefined;

  override async commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
    if (Object.values(s.tasks).includes('parked')) {
      this.recordedFirst = (await parkDecisions(this.inner, s.runId)).length > 0;
      throw new Error('stopped at park');
    }
    return this.inner.commitRunState(s, ifVersion);
  }
}

class ThrowingDriver extends DelegatingDriver {
  calls = 0;

  override runTask(_req: TaskRequest): Promise<TaskResult> {
    this.calls += 1;
    return Promise.reject(new Error('the model provider is unreachable'));
  }
}

describe('hello at L1', () => {
  test('runs intake through review, then waits at integrate, whose own floor needs a human', async () => {
    const outcome = await startRun(runRequest(runId, workspace, components));
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'refused',
      at: 'integrate',
      transition: { ok: false, reason: 'approval-required', key: 'integrate:1' },
    });
    const state = refusedState(outcome);
    expect(state).toMatchObject({
      station: 'integrate',
      phase: 'exiting',
      tasks: { [hello]: 'passed', [helloReview]: 'passed' },
      attempts: { [hello]: { iterations: 1, retries: 0, starts: 1 }, [helloReview]: { iterations: 1, retries: 0, starts: 1 } },
      violations: [],
      approvals: [],
    });
    expect(state.evidenceRefs).toHaveLength(1);
    await expect(components.vault.readRunState(runId)).resolves.toEqual(state);

    const [ref] = state.evidenceRefs;
    if (ref === undefined) return;
    const bundle = await read<EvidenceBundle>(components.vault, ref);
    expect(bundle).toMatchObject({ runId, taskId: hello, collectedBy: 'runtime', claimEvidenceDiff: [] });
    expect(bundle.checks).toEqual([expect.objectContaining({ checkId: 'hello-exit-zero', exitCode: 0, suiteCount: null })]);
  });

  test('an approval of the integrate exit, then a resume, completes the run', async () => {
    await startRun(runRequest(runId, workspace, components));
    const approved = await approveStation({ runId, key: 'integrate:1', approvedBy: 'maintainer', vault: components.vault });
    expect(approved.ok).toBe(true);
    const outcome = await resumeRun({ runId, components: built(components) });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.state).toMatchObject({ station: 'integrate', phase: 'exiting' });
    expect(outcome.state.approvals).toEqual([expect.objectContaining({ key: 'integrate:1', approvedBy: 'maintainer' })]);
  });

  test('build hands the driver the locked text as the stable prefix and the scope the policy grants the role', async () => {
    const driver = new ChosenDriver();
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    await startRun(runRequest(runId, workspace, { ...components, driver, reviewer: new ChosenDriver({ family: 'other' }), sandbox }));
    expect(driver.requests).toHaveLength(1);
    const [req] = driver.requests;
    if (req === undefined) return;
    expect(req).toMatchObject({ taskId: hello, role: 'builder', variableSuffix: hello, tier: 'standard', tools: ['read', 'write'] });
    expect(req.stablePrefix).toContain(await readSpec(workspace));
    expect(req.stablePrefix).toContain('The black-box oracle');
    expect(req.sandbox).toBe(sandbox.provisioned[0]);
  });

  test('a build runs in a rw sandbox, its checks and the review seat in ro ones, and every sandbox is destroyed; egress is denied', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    await startRun(runRequest(runId, workspace, { ...components, sandbox }));
    // The mount follows the station contract's write boundary: `build` grants
    // `**` and gets rw; `review` grants nothing and gets a tree it cannot write.
    expect(STATION_CONTRACTS.review.writeBoundary.workspaceGlobs).toEqual([]);
    expect(sandbox.specs.map((s) => s.mounts.workspace.mode)).toEqual(['rw', 'ro', 'ro']);
    expect(sandbox.destroyed).toEqual(sandbox.provisioned);
    for (const spec of sandbox.specs) expect(spec.egress).toEqual({ mode: 'deny-all', allow: [] });
  });

  test('starting an admitted run again is refused, at any level, and changes nothing', async () => {
    const first = refusedState(await startRun(runRequest(runId, workspace, components)));
    const again = await startRun(runRequest(runId, workspace, components, { requestedLevel: 0 }));
    expect(again).toMatchObject({ ok: false, reason: 'invalid-request', problems: [{ path: 'runId', code: 'already-admitted' }] });
    await expect(components.vault.readRunState(runId)).resolves.toEqual(first);
  });

  test('a run id that is not one directory name is refused, and nothing is written for it (D-P14-14)', async () => {
    for (const unusable of ['../escape', 'a/b', '.hidden']) {
      const outcome = await startRun(runRequest(unusable as RunId, workspace, components));
      expect(outcome).toMatchObject({ ok: false, reason: 'invalid-request', problems: [{ path: 'runId', code: 'unusable' }] });
    }
    // The workspace store's base was the first thing written for an admitted id; nothing reached outside it.
    await expect(stat(join(components.workspaces.root, '..', 'escape'))).rejects.toThrow();
  });
});

describe('the verdict follows the checks and nothing else (I2)', () => {
  test('a failing check fails the gate whatever the driver claimed; the task is rebuilt, then parks after maxIterations', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, command: ['node', '-e', 'process.exit(3)'] }]);
    const driver = new ChosenDriver({ narrative: 'all tests pass' });
    const outcome = await startRun(runRequest(runId, workspace, { ...components, driver, reviewer: driver }));
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'refused',
      at: 'verify',
      transition: { ok: false, reason: 'parked', task: hello, cause: 'iterations-exhausted', limit: 3 },
    });
    const state = refusedState(outcome);
    expect(driver.requests).toHaveLength(3);
    expect(state.tasks[hello]).toBe('parked');
    expect(state.attempts[hello]).toEqual({ iterations: 3, retries: 0, starts: 3 });
    expect(state.evidenceRefs).toHaveLength(3);
    expect(await parkDecisions(components.vault, runId)).toHaveLength(1);
    for (const ref of state.evidenceRefs) {
      const bundle = await read<EvidenceBundle>(components.vault, ref);
      expect(bundle.checks[0]?.exitCode).toBe(3);
      expect(bundle.claim.narrative).toBe('all tests pass');
    }
  });

  test('a required check with an expected suite count fails while the count is unknown (I5)', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, expectedSuiteCount: 1 }]);
    const outcome = await startRun(runRequest(runId, workspace, components));
    expect(outcome).toMatchObject({ transition: { reason: 'parked', cause: 'iterations-exhausted' } });
  });

  test('a required check that cannot be started has no result and fails the gate', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, id: 'cannot-start', command: ['no-such-program-p4', '--version'] }]);
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    expect(state.tasks[hello]).toBe('parked');
    const [ref] = state.evidenceRefs;
    if (ref === undefined) return;
    expect((await read<EvidenceBundle>(components.vault, ref)).checks).toEqual([]);
  });

  test('a failing check that is not required does not fail the gate', async () => {
    await writeChecks(workspace, [HELLO_CHECK, { ...HELLO_CHECK, id: 'optional', command: ['node', '-e', 'process.exit(1)'], required: false }]);
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    expect(state.tasks[hello]).toBe('passed');
  });

  // codex-4: a unit or acceptance check is a suite run by its kind, so a tree whose suites
  // cannot be enumerated has not shown one ran, whether or not the manifest pinned a count.
  test('a unit check over a tree whose suites cannot be enumerated fails the gate, with no count pinned (I5)', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, kind: 'unit' }]);
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    expect(state.tasks[hello]).toBe('parked');
  });

  test('a unit check over a tree whose suites are enumerated passes, and records the count', async () => {
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'p6', devDependencies: { vitest: '4.1.11' } }));
    await writeFile(join(workspace, 'a.test.ts'), "test('a', () => {})\n");
    await writeChecks(workspace, [{ ...HELLO_CHECK, kind: 'unit' }]);
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    expect(state.tasks[hello]).toBe('passed');
    const [ref] = state.evidenceRefs;
    if (ref === undefined) return;
    expect((await read<EvidenceBundle>(components.vault, ref)).checks[0]?.suiteCount).toBe(1);
  });

  // D-P7-05: a check over a read-only tree has nowhere to write a report the host can read.
  test('a pinned coverage check is refused rather than read as covering nothing, and no evidence is written', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, id: 'cov', kind: 'coverage' }]);
    await expect(startRun(runRequest(runId, workspace, components))).rejects.toThrow(/coverage check/);
  });

  test('every bundle carries a tamper report, empty for a task that touched no test', async () => {
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    const [ref] = state.evidenceRefs;
    if (ref === undefined) throw new Error('no evidence written');
    expect((await read<EvidenceBundle>(components.vault, ref)).tamper).toEqual({
      assertionsWeakened: [], skipMarkersAdded: [], testsDeleted: [], snapshotsRegenerated: [], coverageDelta: null, protectedPathsTouched: [],
    });
  });
});

describe('each check runs alone (codex-2, codex-7)', () => {
  test('every check gets its own fresh sandbox, bounded by its own timeout, and each is destroyed', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    await writeChecks(workspace, [HELLO_CHECK, { ...HELLO_CHECK, id: 'second', timeoutMs: 2_500 }]);
    await startRun(runRequest(runId, workspace, { ...components, sandbox }));
    // build, then one per check, then review.
    expect(sandbox.specs.map((s) => s.mounts.workspace.mode)).toEqual(['rw', 'ro', 'ro', 'ro']);
    expect(sandbox.specs.slice(1, 3).map((s) => s.limits.wallClockMs)).toEqual([10_000, 2_500]);
    expect(new Set(sandbox.provisioned.slice(1, 3)).size).toBe(2);
    expect(sandbox.destroyed).toEqual(sandbox.provisioned);
  });
});

/** A builder that deletes one file from its workspace, through the sandbox it was given. */
class DeletingDriver extends DelegatingDriver {
  constructor(private readonly sandbox: StubSandboxProvider, private readonly path: string) {
    super(new ChosenDriver());
  }

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    const removed = await this.sandbox.exec(req.sandbox, ['node', '-e', `require('node:fs').rmSync(${JSON.stringify(this.path)})`]);
    if (removed.exitCode !== 0) throw new Error(`the delete failed: ${removed.stderr}`);
    const result = await this.inner.runTask(req);
    return { ...result, claim: { narrative: '', filesChanged: [this.path] } };
  }
}

describe('the review seat is shown what changed', () => {
  // codex-5: the seat's tree holds surviving files, so a deletion left no trace in it.
  test("a deleted file is in the seat's diff listing, read from the runtime's diff", async () => {
    await writeFile(join(workspace, 'notes.txt'), 'to be removed\n');
    const sandbox = new StubSandboxProvider();
    const reviewer = new ChosenDriver({ family: 'other' });
    await startRun(runRequest(runId, workspace, { ...components, sandbox, driver: new DeletingDriver(sandbox, 'notes.txt'), reviewer }));
    const [req] = reviewer.requests;
    if (req === undefined) throw new Error('the reviewer never ran');
    expect(req.stablePrefix).toContain('[diff]');
    expect(req.stablePrefix).toContain('{"path":"notes.txt","change":"removed"}');
  });

  // codex-6: the key check ran where build's result arrives and not where review's does.
  test("a review seat's result carrying a key the contract does not name is refused and not recorded", async () => {
    const reviewer = new (class extends ChosenDriver {
      override async runTask(req: TaskRequest): Promise<TaskResult> {
        const result = await super.runTask(req);
        const widened: Record<string, unknown> = { ...result, status: 'passed' };
        return widened as unknown as TaskResult;
      }
    })({ family: 'other' });
    await expect(startRun(runRequest(runId, workspace, { ...components, reviewer }))).rejects.toThrow(/result\.status/);
    const state = await components.vault.readRunState(runId);
    expect(Object.hasOwn(state.results, helloReview)).toBe(false);
  });
});

describe('retries are bounded (I5)', () => {
  test('a driver that keeps failing parks the task after retry.max retries, with the count in run state', async () => {
    const driver = new ThrowingDriver(new ChosenDriver());
    const outcome = await startRun(runRequest(runId, workspace, { ...components, driver }));
    expect(outcome).toMatchObject({ at: 'build', transition: { reason: 'parked', task: hello, cause: 'retries-exhausted', limit: 2 } });
    expect(driver.calls).toBe(3);
    const state = refusedState(outcome);
    expect(state.attempts[hello]).toEqual({ iterations: 1, retries: 3, starts: 3 });

    expect(await parkDecisions(components.vault, runId)).toHaveLength(1);

    // A resume with a driver that works does not get the task back: parked is parked.
    const resumed = await resumeRun({ runId, components: built(components) });
    expect(resumed).toMatchObject({ ok: false, reason: 'refused', transition: { reason: 'parked', cause: 'retries-exhausted' } });
  });
});

describe('a park is recorded before it is committed (D-P14-07)', () => {
  test('failing checks: the park decision is in the Vault when the parked status is committed', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, command: ['node', '-e', 'process.exit(3)'] }]);
    const driver = new ChosenDriver();
    const vault = new StopsAtPark(components.vault);
    await expect(startRun(runRequest(runId, workspace, { ...components, vault, driver, reviewer: driver }))).rejects.toThrow('stopped at park');
    expect(vault.recordedFirst).toBe(true);
  });

  test('a failing driver: the park decision is in the Vault when the parked status is committed', async () => {
    const vault = new StopsAtPark(components.vault);
    await expect(startRun(runRequest(runId, workspace, { ...components, vault, driver: new ThrowingDriver(new ChosenDriver()) }))).rejects.toThrow('stopped at park');
    expect(vault.recordedFirst).toBe(true);
  });
});

describe('locks are re-verified at every transition (I3)', () => {
  test('a locked artifact changed while build runs is refused with a violation, and a resume refuses the run', async () => {
    // Verification 1 is the exit from spec; 2 the exit from test-design; 3 the exit from plan; 4 before the build.
    const vault = new TamperingVault(components.vault, workspace, 4);
    const outcome = await startRun(runRequest(runId, workspace, { ...components, vault }));
    expect(outcome).toMatchObject({ at: 'build', transition: { reason: 'lock-tamper', tampered: [{ path: 'spec.md' }] } });
    const state = refusedState(outcome);
    expect(state.tasks[hello]).toBe('failed');
    expect(state.violations).toHaveLength(1);
    const [ref] = state.violations;
    if (ref === undefined) return;
    // The task in flight is failed with the violation, but it had not run when
    // the mismatch was found, so no role is named for it (D-P4-08, A-P4-05).
    expect(await read<IntegrityViolation>(components.vault, ref)).toMatchObject({ kind: 'lock-tamper', taskId: hello, role: 'unattributed' });

    const resumed = await resumeRun({ runId, components: built(components) });
    expect(resumed).toMatchObject({ ok: false, reason: 'refused', transition: { reason: 'violation', violations: [ref] } });
  });

  test('a check that rewrites a locked artifact is refused after the checks, and no evidence is written', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, id: 'rewrite', command: ['node', '-e', "require('node:fs').writeFileSync('spec.md','changed')"] }]);
    const outcome = await startRun(runRequest(runId, workspace, components));
    expect(outcome).toMatchObject({ at: 'verify', transition: { reason: 'lock-tamper' } });
    const state = refusedState(outcome);
    expect(state.evidenceRefs).toEqual([]);
    const [ref] = state.violations;
    if (ref === undefined) return;
    const violation = await read<IntegrityViolation>(components.vault, ref);
    expect(violation.detail).toMatchObject({ station: 'verify', phase: 'after-checks' });
  });
});

describe('approvals gate the station (I4)', () => {
  test('a blocked cell refuses the exit, cannot be approved, and the run stays where it was', async () => {
    const outcome = await startRun(runRequest(runId, workspace, components, { policy: policy(approvals({ 'plan:1': 'blocked' })) }));
    expect(outcome).toMatchObject({ at: 'plan', transition: { reason: 'approval-blocked', key: 'plan:1' } });
    const approved = await approveStation({ runId, key: 'plan:1', approvedBy: 'maintainer', vault: components.vault });
    expect(approved).toMatchObject({ ok: false, reason: 'not-awaiting' });
    expect(refusedState(await resumeRun({ runId, components: built(components) }))).toMatchObject({ station: 'plan', phase: 'exiting' });
  });

  test('a human-required cell waits for exactly its own key; any other approval is refused', async () => {
    const outcome = await startRun(runRequest(runId, workspace, components, { policy: policy(approvals({ 'spec:1': 'human-required' })) }));
    expect(outcome).toMatchObject({ at: 'spec', transition: { reason: 'approval-required', key: 'spec:1' } });
    for (const key of ['spec:2', 'plan:1', 'integrate:1'] as const) {
      expect(await approveStation({ runId, key, approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: false, reason: 'not-awaiting' });
    }
    expect(await approveStation({ runId, key: 'spec:1', approvedBy: '  ', vault: components.vault })).toMatchObject({ reason: 'invalid-request' });
    expect(await approveStation({ runId, key: 'spec:1', approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: true });
    expect(await resumeRun({ runId, components: built(components) })).toMatchObject({ at: 'integrate', transition: { reason: 'approval-required' } });
  });

  test('a grant authorises one exit: the rebuild after a failed verify waits for a second approval', async () => {
    const driver = new ChosenDriver({ narrative: 'built' });
    const sandbox = new FailsFirstCheck(new StubSandboxProvider());
    components = stubComponents(workspace, { driver, reviewer: driver, sandbox });
    const request = runRequest(runId, workspace, components, { policy: policy(approvals({ 'build:1': 'human-required' })) });

    expect(await startRun(request)).toMatchObject({ at: 'build', transition: { reason: 'approval-required', key: 'build:1' } });
    expect(await approveStation({ runId, key: 'build:1', approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: true });

    // The first check fails, so `verify` sends the task back to `build`, and it is built a second time.
    const second = await resumeRun({ runId, components: built(components) });
    expect(driver.requests.filter((r) => r.taskId === hello)).toHaveLength(2);
    expect(second).toMatchObject({ at: 'build', transition: { reason: 'approval-required', key: 'build:1' } });
    const spent = refusedState(second).approvals;
    expect(spent).toHaveLength(1);
    expect(spent[0]?.usedAt).toEqual(expect.any(String));

    // The second visit is approved in its own right, and the run then goes on.
    expect(await approveStation({ runId, key: 'build:1', approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: true });
    expect(await resumeRun({ runId, components: built(components) })).toMatchObject({ at: 'integrate' });
  });
});

describe('a replayed attempt is spent, not free (I5)', () => {
    test('a kill between the running commit and the result runs the driver again, and the replay is counted', async () => {
    const driver = new ChosenDriver({ narrative: 'built' });
    const base = stubComponents(workspace, { driver, reviewer: driver });
    // The commit after `running` is the one recording the result and moving the task to verifying.
    const kill = (s: RunState): boolean => s.tasks[hello] === 'verifying';

    const first = { ...base, vault: new KillsBeforeCommit(base.vault, kill) };
    await expect(startRun(runRequest(runId, workspace, first))).rejects.toThrow('killed');
    expect(await base.vault.readRunState(runId)).toMatchObject({ attempts: { [hello]: { iterations: 1, retries: 0, starts: 1 } } });

    // Each resume runs the driver again; each one is counted, and the iteration is not re-spent.
    for (const starts of [2, 3]) {
      const components = { ...base, vault: new KillsBeforeCommit(base.vault, kill) };
      await expect(resumeRun({ runId, components: built(components) })).rejects.toThrow('killed');
      expect(await base.vault.readRunState(runId)).toMatchObject({ attempts: { [hello]: { iterations: 1, retries: 0, starts } } });
    }
    expect(driver.requests.filter((r) => r.taskId === hello)).toHaveLength(3);
  });

  test('replays past the station invocation bound park the task rather than spending forever', async () => {
    const driver = new ChosenDriver({ narrative: 'built' });
    const base = stubComponents(workspace, { driver, reviewer: driver });
    const kill = (s: RunState): boolean => s.tasks[hello] === 'verifying';
    // build: maxIterations 3, retry.max 2, so nine driver calls is the most an uninterrupted run could make.
    const bound = STATION_CONTRACTS.build.maxIterations * (STATION_CONTRACTS.build.retry.max + 1);

    await expect(startRun(runRequest(runId, workspace, { ...base, vault: new KillsBeforeCommit(base.vault, kill) }))).rejects.toThrow('killed');
    for (let i = 1; i < bound; i += 1) {
      await expect(resumeRun({ runId, components: { ...base, vault: new KillsBeforeCommit(base.vault, kill) } })).rejects.toThrow('killed');
    }
    expect(driver.requests.filter((r) => r.taskId === hello)).toHaveLength(bound);

    // The next resume does not reach the driver at all.
    const parked = await resumeRun({ runId, components: base });
    expect(parked).toMatchObject({ at: 'build', transition: { reason: 'parked', task: hello, cause: 'starts-exhausted', limit: bound } });
    expect(driver.requests.filter((r) => r.taskId === hello)).toHaveLength(bound);
    expect(await parkDecisions(base.vault, runId)).toHaveLength(1);
  });
});

describe('what a station is handed, beyond its prompt', () => {
  test('a locked artifact swapped between the lock check and the read is caught by the bytes read (I3)', async () => {
    const driver = new ChosenDriver({ narrative: 'built' });
    const spec = join(workspace, 'spec.md');
    const original = await readSpec(workspace);
    class SwapsAfterTheCheck extends DelegatingVault {
      station = 'intake';
      swapped = false;

      override async commitRunState(s: RunState, version: string): Promise<RunState> {
        const stored = await this.inner.commitRunState(s, version);
        this.station = stored.station;
        return stored;
      }

      override async verifyLocks(id: RunId): Promise<LockVerdict> {
        // Put the admitted bytes back, so every lock comparison sees what was admitted.
        if (this.swapped) {
          await writeFile(spec, original);
          this.swapped = false;
        }
        const verdict = await this.inner.verifyLocks(id);
        if (this.station === 'build' && verdict.ok) {
          await writeFile(spec, '# swapped between the check and the read\n');
          this.swapped = true;
        }
        return verdict;
      }
    }
    const base = stubComponents(workspace, { driver, reviewer: driver });
    components = { ...base, vault: new SwapsAfterTheCheck(base.vault) };
    const outcome = await startRun(runRequest(runId, workspace, components));
    expect(outcome).toMatchObject({ at: 'build', transition: { reason: 'lock-tamper' } });
    expect(driver.requests).toHaveLength(0);
    const state = refusedState(outcome);
    expect(state.violations).toHaveLength(1);
    const [ref] = state.violations;
    if (ref === undefined) return;
    const violation = await read<IntegrityViolation>(base.vault, ref);
    expect(violation.detail).toMatchObject({ station: 'build', phase: 'context' });
  });

  test('a tamper found before a task ran names neither that task role nor the other driver', async () => {
    const author = new ChosenDriver({ narrative: 'built' });
    const reviewer = new ChosenDriver({ family: 'other-family' });
    const base = stubComponents(workspace, { driver: author, reviewer });
    class TampersAtReview extends DelegatingVault {
      station = 'intake';

      override async commitRunState(s: RunState, version: string): Promise<RunState> {
        const stored = await this.inner.commitRunState(s, version);
        this.station = stored.station;
        return stored;
      }

      override verifyLocks(id: RunId): Promise<LockVerdict> {
        if (this.station !== 'review') return this.inner.verifyLocks(id);
        return Promise.resolve({ ok: false, tampered: [{ path: 'spec.md', expected: 'a', actual: 'b' }] });
      }
    }
    components = { ...base, vault: new TampersAtReview(base.vault) };
    const outcome = await startRun(runRequest(runId, workspace, components));
    expect(outcome).toMatchObject({ at: 'review', transition: { reason: 'lock-tamper' } });
    expect(reviewer.requests).toHaveLength(0);
    const [ref] = refusedState(outcome).violations;
    if (ref === undefined) return;
    const violation = await read<IntegrityViolation>(base.vault, ref);
    // The reviewer never ran, so the builder is the last role that acted; the reviewer's driver is what found it.
    expect(violation.role).toBe('builder');
    expect(violation.driverProvenanceId).toBe(reviewer.provenanceId());
  });
});

/**
 * Stands in for a provider whose sandboxes have relays: each destroy returns a
 * metered reading, the n-th with n calls, so every record can be told apart
 * and every total checked by hand (D-P13-11). The line itself provisions no
 * relay until I1; what is proven here is that it records what `destroy`
 * returns, and nothing a driver says.
 */
class MeteredSandbox extends DelegatingSandbox {
  private destroyed = 0;

  override async destroy(h: SandboxHandle): Promise<Teardown> {
    await this.inner.destroy(h);
    this.destroyed += 1;
    const n = this.destroyed;
    return { meter: { kind: 'metered', calls: n, inputTokens: 100 * n, outputTokens: 10 * n, cacheReadTokens: n, cacheWriteTokens: 2 * n, costUsd: n / 1000, exhausted: 'none', refused: 0 }, egress: { kind: 'none' } };
  }
}

/** Counts what went through `recordUsage`, the only way a usage record reaches the Vault. */
class CountingVault extends DelegatingVault {
  readonly usage: UsageRecord[] = [];

  override recordUsage(r: UsageRecord): Promise<VaultRef> {
    this.usage.push(r);
    return this.inner.recordUsage(r);
  }
}

/** A driver that fails its first call, as a crashed CLI would, and delegates after. */
class FailsFirstCall extends ChosenDriver {
  private calls = 0;

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    this.calls += 1;
    if (this.calls === 1) {
      this.requests.push(req);
      throw new Error('the driver failed');
    }
    return super.runTask(req);
  }
}

describe('cost is what the relay counted, recorded per driver call (I2)', () => {
  test('every driver call writes one usage record through recordUsage, with the meter figures, and a driver reporting zero cannot lower them', async () => {
    const driver = new ChosenDriver({ narrative: 'built' });
    const reviewer = new ChosenDriver({ family: 'other' });
    const vault = new CountingVault(components.vault);
    // Build twice (the first check fails), then one review seat: three driver calls, each in its own sandbox.
    const sandbox = new MeteredSandbox(new FailsFirstCheck(new StubSandboxProvider()));
    const outcome = await startRun(runRequest(runId, workspace, { ...components, vault, driver, reviewer, sandbox }));
    const state = outcome.ok ? outcome.state : refusedState(outcome);

    const records = await readUsage(vault, state);
    // Each call writes a pending record before it is made, and its reading after it; run state references the readings, and the Vault lists the pending ones by run (D-I1a-12).
    expect(vault.usage.map((r) => r.reading.kind === 'pending')).toStrictEqual([true, false, true, false, true, false]);
    const readings = records.filter((r) => r.reading.kind !== 'pending');
    expect(records).toStrictEqual([...readings, ...vault.usage.filter((r) => r.reading.kind === 'pending')]);
    expect(readings).toStrictEqual(vault.usage.filter((r) => r.reading.kind !== 'pending'));
    expect(readings.map((r) => [r.taskId, r.station, r.attempt])).toStrictEqual([
      [hello, 'build', 1],
      [hello, 'build', 2],
      [helloReview, 'review', 1],
    ]);
    for (const record of records) expect(record.collectedBy).toBe('runtime');
    // The driver reported zero for every call; each record carries what its sandbox's destroy returned.
    const results = await Promise.all(Object.values(state.results).map((ref) => read<TaskResult>(vault, ref)));
    for (const result of results) expect(result.usage.costUsd).toBe(0);
    expect(readings.every((r) => r.reading.kind === 'metered' && r.reading.costUsd > 0)).toBe(true);

    // Totals are the sums of their records, and nothing else.
    const sums = (rs: readonly UsageRecord[]): number => rs.reduce((s, r) => s + (r.reading.kind === 'metered' ? r.reading.costUsd : 0), 0);
    const totals = costTotals(records);
    expect(totals.run).toMatchObject({ calls: 3, unmetered: 0, metered: { calls: 3 } });
    expect(totals.run.metered.costUsd).toBeCloseTo(sums(records), 12);
    expect(totals.byStation.build?.metered.costUsd).toBeCloseTo(sums(records.filter((r) => r.station === 'build')), 12);
    expect(totals.byStation.review?.calls).toBe(1);
    expect(totals.byTask[hello]?.calls).toBe(2);
    expect(totals.byTask[helloReview]?.metered.inputTokens).toBe(readings[2]?.reading.kind === 'metered' ? readings[2].reading.inputTokens : -1);
  });

  test('a driver call that failed is recorded before its retry', async () => {
    const driver = new FailsFirstCall({ narrative: 'built' });
    const vault = new CountingVault(components.vault);
    await startRun(runRequest(runId, workspace, { ...components, vault, driver, reviewer: new ChosenDriver({ family: 'other' }), sandbox: new MeteredSandbox(new StubSandboxProvider()) }));
    const builds = vault.usage.filter((r) => r.station === 'build' && r.reading.kind !== 'pending');
    expect(driver.requests.filter((r) => r.taskId === hello)).toHaveLength(2);
    expect(builds).toHaveLength(2);
    expect(builds[0]?.reading).toMatchObject({ kind: 'metered', calls: 1 });
  });

  test('calls whose sandbox had no relay are counted as unmetered, never as zero cost', async () => {
    const vault = new CountingVault(components.vault);
    const outcome = await startRun(runRequest(runId, workspace, { ...components, vault, reviewer: new ChosenDriver({ family: 'other' }) }));
    const state = outcome.ok ? outcome.state : refusedState(outcome);
    const totals = costTotals(await readUsage(vault, state));
    expect(totals.run).toMatchObject({ calls: 2, unmetered: 2, metered: { calls: 0 } });
  });

  test('every usage record names the model the runtime resolved the scope tier to, not the one the driver reported', async () => {
    class MisreportingDriver extends ChosenDriver {
      override async runTask(req: TaskRequest): Promise<TaskResult> {
        const result = await super.runTask(req);
        return { ...result, model: { ...result.model, model: 'what-the-driver-says' } };
      }
    }
    const driver = new MisreportingDriver({ narrative: 'built' });
    const reviewer = new ChosenDriver({ family: 'other' });
    const vault = new CountingVault(components.vault);
    await startRun(runRequest(runId, workspace, { ...components, vault, driver, reviewer }));
    expect(vault.usage.length).toBeGreaterThan(0);
    for (const record of vault.usage) {
      const seat = record.station === 'review' ? reviewer : driver;
      const tier = record.station === 'review' ? 'deep' : 'standard';
      expect(record.model).toStrictEqual(seat.resolveModel(tier));
    }
  });

  test('a sandbox whose cost cannot be read after the driver ran records the call as lost and stops the run, and a resume over it is refused and recorded', async () => {
    class UnreadableMeter extends DelegatingSandbox {
      override async destroy(h: SandboxHandle): Promise<Teardown> {
        await this.inner.destroy(h);
        throw new Error("the model relay's meter could not be read");
      }
    }
    const driver = new ChosenDriver({ narrative: 'built' });
    const vault = new CountingVault(components.vault);
    await expect(startRun(runRequest(runId, workspace, { ...components, vault, driver, sandbox: new UnreadableMeter(new StubSandboxProvider()) }))).rejects.toThrow(
      /could not be destroyed and its cost read/u,
    );
    expect(driver.requests).toHaveLength(1);
    expect(vault.usage.map((r) => r.reading.kind)).toStrictEqual(['pending', 'lost']);
    const totals = costTotals(await readUsage(vault, await vault.readRunState(runId)));
    expect(totals.run).toMatchObject({ calls: 1, lost: 1, bound: 'lower' });

    // The same graph, metered this time: the resume is refused for the lost reading, not driven on top of it.
    const resumed = await resumeRun({ runId, components: built({ ...components, vault, driver }) });
    expect(resumed).toMatchObject({ ok: false, reason: 'meter-lost', tasks: [hello] });
    expect(driver.requests).toHaveLength(1);
    const decisions = await Promise.all((await vault.readDecisions(runId)).map((ref) => read<EnforcementDecision>(vault, ref)));
    expect(decisions.map((d) => d.decision)).toContainEqual({ cause: 'resume-refused', decidedBy: 'admission', refusal: { reason: 'meter-lost', tasks: [hello] } });
  });

  test('a usage record stored before the commit that would reference it is still read, and a lost one in it still refuses the resume', async () => {
    class DiesAfterUsage extends DelegatingVault {
      private stored = false;
      override async recordUsage(r: UsageRecord): Promise<VaultRef> {
        const ref = await this.inner.recordUsage({ ...r, reading: { kind: 'lost', detail: 'test' } });
        this.stored = true;
        return ref;
      }
      override commitRunState(state: RunState, ifVersion: string): Promise<RunState> {
        if (this.stored) return Promise.reject(new Error('the process died'));
        return this.inner.commitRunState(state, ifVersion);
      }
    }
    const vault = new DiesAfterUsage(components.vault);
    await expect(startRun(runRequest(runId, workspace, { ...components, vault }))).rejects.toThrow(/the process died/u);
    const state = await components.vault.readRunState(runId);
    expect(state.usage).toHaveLength(0);
    expect(await readUsage(components.vault, state)).toHaveLength(1);
    expect(await resumeRun({ runId, components: built(components) })).toMatchObject({ ok: false, reason: 'meter-lost' });
  });

  test('a process stop while a driver call is in flight leaves a pending record, so the resume is refused and the total is a lower bound (D-I1a-12)', async () => {
    // Nothing reaches the Vault once the process has stopped: every write after the call began is lost with it.
    class StopsMidCall extends DelegatingVault {
      stopped = false;
      private dead<T>(write: () => Promise<T>): Promise<T> {
        return this.stopped ? Promise.reject(new Error('the process stopped')) : write();
      }
      override recordUsage(r: UsageRecord): Promise<VaultRef> {
        return this.dead(() => this.inner.recordUsage(r));
      }
      override recordDecision(d: EnforcementDecision): Promise<VaultRef> {
        return this.dead(() => this.inner.recordDecision(d));
      }
      override recordTaskResult(id: RunId, r: TaskResult): Promise<VaultRef> {
        return this.dead(() => this.inner.recordTaskResult(id, r));
      }
      override writeEvidence(b: EvidenceBundle): Promise<VaultRef> {
        return this.dead(() => this.inner.writeEvidence(b));
      }
      override commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
        return this.dead(() => this.inner.commitRunState(s, ifVersion));
      }
    }
    const vault = new StopsMidCall(components.vault);
    class StopsTheProcess extends ChosenDriver {
      override runTask(req: TaskRequest): Promise<TaskResult> {
        this.requests.push(req);
        vault.stopped = true;
        return Promise.reject(new Error('the process stopped during the call'));
      }
    }
    const killed = new StopsTheProcess({ narrative: 'built' });
    await expect(startRun(runRequest(runId, workspace, { ...components, vault, driver: killed }))).rejects.toThrow(/the process stopped/u);
    expect(killed.requests).toHaveLength(1);

    const state = await components.vault.readRunState(runId);
    const totals = costTotals(await readUsage(components.vault, state));
    expect(totals.run).toMatchObject({ calls: 1, lost: 1, bound: 'lower' });

    const driver = new ChosenDriver({ narrative: 'built' });
    expect(await resumeRun({ runId, components: built({ ...components, driver }) })).toMatchObject({ ok: false, reason: 'meter-lost', tasks: [hello] });
    expect(driver.requests).toHaveLength(0);
  });

  test('a call whose usage the relay could not read makes its total a lower bound, counted apart from exact calls (D-P13-19)', () => {
    const base = { runId, taskId: hello, station: 'build' as const, attempt: 1, model: new ChosenDriver().resolveModel('standard'), collectedBy: 'runtime' as const };
    const exact = { kind: 'metered' as const, calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, exhausted: 'none' as const, refused: 0 };
    expect(costTotals([{ ...base, reading: exact }]).run).toMatchObject({ bound: 'exact', metered: { unreadable: 0 } });
    const totals = costTotals([{ ...base, reading: exact }, { ...base, attempt: 2, reading: { ...exact, exhausted: 'unreadable' } }]);
    expect(totals.run).toMatchObject({ bound: 'lower', metered: { calls: 2, unreadable: 1, exhausted: 1 } });
  });
});

describe('the line provisions what the graph and the policy name (D-I1a-01, A-I1a-02)', () => {
  const PROFILE = { buildImage: 'build-image', checkImage: 'check-image', limits: { cpus: 1, memoryMb: 512, pids: 64 } };
  const PRICE = { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, cacheWrite1hPerMTok: 2 };
  const RELAY: Omit<RelaySpec, 'budget'> = { upstream: 'https://models.example', paths: ['/v1/messages'], header: 'x-api-key', credential: 'model', urlVariable: 'MODEL_URL', meter: { dialect: 'anthropic-messages', prices: { stub: PRICE, 'another-model': PRICE } } };

  class RelayingDriver extends ChosenDriver {
    override relayRequest(): typeof RELAY {
      return RELAY;
    }
  }

  test('a build sandbox runs the profile\'s build image and limits, the scope\'s wall clock, and the driver\'s relay under the budget policy grants the role', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    const driver = new RelayingDriver({ narrative: 'built' });
    await startRun(runRequest(runId, workspace, { ...components, sandbox, driver, reviewer: new ChosenDriver({ family: 'other' }), profile: PROFILE }));
    const build = sandbox.specs.find((s) => s.relay !== undefined);
    expect(build).toMatchObject({
      image: 'build-image',
      limits: { cpus: 1, memoryMb: 512, pids: 64, wallClockMs: 60_000 },
      relay: { ...RELAY, meter: { ...RELAY.meter, prices: { stub: PRICE } }, budget: { maxTokens: 1000, maxCostUsd: 1 } },
      mounts: { others: [] },
    });
  });

  test('the relay is priced for the model the call resolved and no other, so a request naming another is refused by the relay (D-R14-01)', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    const driver = new RelayingDriver({ narrative: 'built' });
    await startRun(runRequest(runId, workspace, { ...components, sandbox, driver, reviewer: new ChosenDriver({ family: 'other' }), profile: PROFILE }));
    const build = sandbox.specs.find((s) => s.relay !== undefined);
    expect(Object.keys(build?.relay?.meter.prices ?? {})).toStrictEqual(['stub']);
  });

  test('a resolved model the relay has no price for is never provisioned', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    class UnpricedDriver extends ChosenDriver {
      override relayRequest(): typeof RELAY {
        return { ...RELAY, meter: { ...RELAY.meter, prices: { 'another-model': PRICE } } };
      }
    }
    await startRun(runRequest(runId, workspace, { ...components, sandbox, driver: new UnpricedDriver({ narrative: 'built' }), reviewer: new ChosenDriver({ family: 'other' }), profile: PROFILE }));
    expect(sandbox.specs.filter((s) => s.relay !== undefined)).toHaveLength(0);
  });

  test('a check sandbox runs the profile\'s check image under the check\'s own timeout, with no relay and no network', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    await startRun(runRequest(runId, workspace, { ...components, sandbox, reviewer: new ChosenDriver({ family: 'other' }), profile: PROFILE }));
    const check = sandbox.specs.find((s) => s.image === 'check-image');
    expect(check).toMatchObject({ limits: { cpus: 1, wallClockMs: HELLO_CHECK.timeoutMs }, egress: { mode: 'deny-all' }, mounts: { others: [] } });
    expect(check?.relay).toBeUndefined();
  });
});

describe('integrate escalates a run whose tests were never analysed (D-A-I1-06)', () => {
  test('a repository with no test framework adds the finding, read from the admission record, and the approver is told it', async () => {
    const outcome = await startRun(runRequest(runId, workspace, { ...components, reviewer: new ChosenDriver({ family: 'other' }) }));
    expect(outcome).toMatchObject({ at: 'integrate', transition: { reason: 'approval-required', escalations: [UNANALYSED_TESTS] } });
    expect((await runStanding(components.vault, runId)).standing).toMatchObject({ standing: 'awaiting-approval', escalations: [UNANALYSED_TESTS] });
    const state = await components.vault.readRunState(runId);
    const record = await read<{ unavailableControls: string[] }>(components.vault, state.admission);
    expect(record.unavailableControls).toContain('test');
    const escalations = await integrateEscalations(components.vault, state, (ref) => read<EvidenceBundle>(components.vault, ref));
    expect(escalations.tamperFindings).toContain(UNANALYSED_TESTS);
  });
});
