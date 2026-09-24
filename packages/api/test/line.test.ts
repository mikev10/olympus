/**
 * The line end to end over the stubs: the hello fixture through stations 1-8.
 * Each test copies the fixture to a fresh temporary directory, which is the
 * Workspace. The invariant assertions themselves are the registry's; what is
 * here is the rest of the behaviour, read by field.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATION_CONTRACTS, type RunId, type RunState, type TaskId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import { StubSandboxProvider, type ExecResult, type SandboxHandle, type SandboxSpec } from '@olympus-ai/sandbox';
import type { EvidenceBundle, LockVerdict, Vault } from '@olympus-ai/vault';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { approveStation, resumeRun, startRun, type ComponentGraph, type RunOutcome } from '../src/index.js';
import {
  approvals,
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

  override destroy(h: SandboxHandle): Promise<void> {
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
    const outcome = await resumeRun({ runId, components });
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

    // A resume with a driver that works does not get the task back: parked is parked.
    const resumed = await resumeRun({ runId, components });
    expect(resumed).toMatchObject({ ok: false, reason: 'refused', transition: { reason: 'parked', cause: 'retries-exhausted' } });
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

    const resumed = await resumeRun({ runId, components });
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
    expect(refusedState(await resumeRun({ runId, components }))).toMatchObject({ station: 'plan', phase: 'exiting' });
  });

  test('a human-required cell waits for exactly its own key; any other approval is refused', async () => {
    const outcome = await startRun(runRequest(runId, workspace, components, { policy: policy(approvals({ 'spec:1': 'human-required' })) }));
    expect(outcome).toMatchObject({ at: 'spec', transition: { reason: 'approval-required', key: 'spec:1' } });
    for (const key of ['spec:2', 'plan:1', 'integrate:1'] as const) {
      expect(await approveStation({ runId, key, approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: false, reason: 'not-awaiting' });
    }
    expect(await approveStation({ runId, key: 'spec:1', approvedBy: '  ', vault: components.vault })).toMatchObject({ reason: 'invalid-request' });
    expect(await approveStation({ runId, key: 'spec:1', approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: true });
    expect(await resumeRun({ runId, components })).toMatchObject({ at: 'integrate', transition: { reason: 'approval-required' } });
  });

  test('a grant authorises one exit: the rebuild after a failed verify waits for a second approval', async () => {
    const driver = new ChosenDriver({ narrative: 'built' });
    const sandbox = new FailsFirstCheck(new StubSandboxProvider());
    components = stubComponents(workspace, { driver, reviewer: driver, sandbox });
    const request = runRequest(runId, workspace, components, { policy: policy(approvals({ 'build:1': 'human-required' })) });

    expect(await startRun(request)).toMatchObject({ at: 'build', transition: { reason: 'approval-required', key: 'build:1' } });
    expect(await approveStation({ runId, key: 'build:1', approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: true });

    // The first check fails, so `verify` sends the task back to `build`, and it is built a second time.
    const second = await resumeRun({ runId, components });
    expect(driver.requests.filter((r) => r.taskId === hello)).toHaveLength(2);
    expect(second).toMatchObject({ at: 'build', transition: { reason: 'approval-required', key: 'build:1' } });
    const spent = refusedState(second).approvals;
    expect(spent).toHaveLength(1);
    expect(spent[0]?.usedAt).toEqual(expect.any(String));

    // The second visit is approved in its own right, and the run then goes on.
    expect(await approveStation({ runId, key: 'build:1', approvedBy: 'maintainer', vault: components.vault })).toMatchObject({ ok: true });
    expect(await resumeRun({ runId, components })).toMatchObject({ at: 'integrate' });
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
      await expect(resumeRun({ runId, components })).rejects.toThrow('killed');
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
