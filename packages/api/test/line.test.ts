/**
 * The line end to end over the stubs: the hello fixture through stations 1-8.
 * Each test copies the fixture to a fresh temporary directory, which is the
 * Workspace. The invariant assertions themselves are the registry's; what is
 * here is the rest of the behaviour, read by field.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunId, RunState, TaskId, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import { StubSandboxProvider, type SandboxHandle, type SandboxSpec } from '@olympus-ai/sandbox';
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
      attempts: { [hello]: { iterations: 1, retries: 0 }, [helloReview]: { iterations: 1, retries: 0 } },
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

  test('a task runs in a rw sandbox, its checks in a fresh ro one, and every sandbox is destroyed; egress is denied', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    await startRun(runRequest(runId, workspace, { ...components, sandbox }));
    expect(sandbox.specs.map((s) => s.mounts.workspace.mode)).toEqual(['rw', 'ro', 'rw']);
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
    await writeChecks(workspace, [{ ...HELLO_CHECK, command: 'node -e process.exit(3)' }]);
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
    expect(state.attempts[hello]).toEqual({ iterations: 3, retries: 0 });
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
    await writeChecks(workspace, [{ ...HELLO_CHECK, id: 'cannot-start', command: 'no-such-program-p4 --version' }]);
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    expect(state.tasks[hello]).toBe('parked');
    const [ref] = state.evidenceRefs;
    if (ref === undefined) return;
    expect((await read<EvidenceBundle>(components.vault, ref)).checks).toEqual([]);
  });

  test('a failing check that is not required does not fail the gate', async () => {
    await writeChecks(workspace, [HELLO_CHECK, { ...HELLO_CHECK, id: 'optional', command: 'node -e process.exit(1)', required: false }]);
    const state = refusedState(await startRun(runRequest(runId, workspace, components)));
    expect(state.tasks[hello]).toBe('passed');
  });
});

describe('retries are bounded (I5)', () => {
  test('a driver that keeps failing parks the task after retry.max retries, with the count in run state', async () => {
    const driver = new ThrowingDriver(new ChosenDriver());
    const outcome = await startRun(runRequest(runId, workspace, { ...components, driver }));
    expect(outcome).toMatchObject({ at: 'build', transition: { reason: 'parked', task: hello, cause: 'retries-exhausted', limit: 2 } });
    expect(driver.calls).toBe(3);
    const state = refusedState(outcome);
    expect(state.attempts[hello]).toEqual({ iterations: 1, retries: 3 });

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
    expect(await read<IntegrityViolation>(components.vault, ref)).toMatchObject({ kind: 'lock-tamper', taskId: hello, role: 'builder' });

    const resumed = await resumeRun({ runId, components });
    expect(resumed).toMatchObject({ ok: false, reason: 'refused', transition: { reason: 'violation', violations: [ref] } });
  });

  test('a check that rewrites a locked artifact is refused after the checks, and no evidence is written', async () => {
    await writeChecks(workspace, [{ ...HELLO_CHECK, id: 'rewrite', command: "node -e require('node:fs').writeFileSync('spec.md','changed')" }]);
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
});
