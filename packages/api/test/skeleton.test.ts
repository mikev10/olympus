/**
 * The walking skeleton end to end: the hello fixture through spec, build,
 * and verify with the three stubs wired. Each test copies the fixture to a
 * fresh temporary directory, which is the Workspace.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDriver, type RunId, type TaskId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import type { CheckSpec, IntegrityViolation } from '@olympus-ai/integrity';
import { StubSandboxProvider, type SandboxHandle, type SandboxSpec } from '@olympus-ai/sandbox';
import { StubVault, type EvidenceBundle, type LockVerdict, type Vault } from '@olympus-ai/vault';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startRun, type ComponentGraph, type FixtureTask, type RunRequest } from '../src/index.js';
import { DelegatingDriver, DelegatingSandbox, DelegatingVault } from './wrappers.js';

const HELLO = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hello');
const runId = 'run-hello' as RunId;
const taskId = 'hello' as TaskId;
const BASE_COMMIT = '0'.repeat(40);

const HELLO_CHECK: CheckSpec = {
  id: 'hello-exit-zero',
  kind: 'unit',
  command: 'node -e process.exit(0)',
  required: true,
  timeoutMs: 10_000,
};

/** Rewrites the locked spec before the n-th lock verification, like an agent that edited it after the lock. */
class TamperingVault extends DelegatingVault {
  private readonly workspace: string;
  private readonly onCall: number;
  private calls = 0;

  constructor(inner: Vault, workspace: string, onCall: number) {
    super(inner);
    this.workspace = workspace;
    this.onCall = onCall;
  }

  override async verifyLocks(runId: RunId): Promise<LockVerdict> {
    this.calls += 1;
    if (this.calls === this.onCall) await writeFile(join(this.workspace, 'spec.md'), '# rewritten after the lock\n');
    return this.inner.verifyLocks(runId);
  }
}

class RecordingDriver extends DelegatingDriver {
  readonly requests: TaskRequest[] = [];

  override runTask(req: TaskRequest): Promise<TaskResult> {
    this.requests.push(req);
    return this.inner.runTask(req);
  }
}

class RecordingSandbox extends DelegatingSandbox {
  readonly provisioned: SandboxHandle[] = [];
  readonly destroyed: SandboxHandle[] = [];
  readonly executed: Array<{ handle: SandboxHandle; cmd: string[] }> = [];
  readonly specs: SandboxSpec[] = [];

  override async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    this.specs.push(spec);
    const handle = await this.inner.provision(spec);
    this.provisioned.push(handle);
    return handle;
  }

  override exec(h: SandboxHandle, cmd: string[]): Promise<ExecResultLike> {
    this.executed.push({ handle: h, cmd });
    return this.inner.exec(h, cmd);
  }

  override destroy(h: SandboxHandle): Promise<void> {
    this.destroyed.push(h);
    return this.inner.destroy(h);
  }
}

type ExecResultLike = Awaited<ReturnType<DelegatingSandbox['exec']>>;

let workspace: string;
let vault: StubVault;
let components: ComponentGraph;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 's1-skeleton-'));
  await cp(HELLO, workspace, { recursive: true });
  vault = new StubVault(workspace);
  components = { vault, sandbox: new StubSandboxProvider(), driver: new StubDriver() };
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function task(checks: readonly CheckSpec[] = [HELLO_CHECK]): FixtureTask {
  return { id: taskId, workspace, lockedPaths: ['spec.md'], checks };
}

function request(overrides: Partial<RunRequest> = {}): RunRequest {
  return { runId, baseCommit: BASE_COMMIT, requestedLevel: 1, task: task(), components, ...overrides };
}

async function readEvidence(ref: Parameters<Vault['read']>[0]): Promise<EvidenceBundle> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as EvidenceBundle;
}

async function readViolation(ref: Parameters<Vault['read']>[0]): Promise<IntegrityViolation> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as IntegrityViolation;
}

describe('hello at L1', () => {
  test('runs spec, build, and verify and produces a passing gate with runtime-collected evidence', async () => {
    const outcome = await startRun(request());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.verdict).toBe('pass');
    expect(outcome.gate.checks).toHaveLength(1);
    expect(outcome.gate.checks[0]).toMatchObject({ checkId: 'hello-exit-zero', exitCode: 0, suiteCount: null });
    expect(outcome.gate.violations).toEqual([]);
    expect(outcome.next).toEqual({ ok: true, next: 'review' });
    expect(outcome.state.station).toBe('verify');
    expect(outcome.state.tasks[taskId]).toBe('passed');
    expect(outcome.state.evidenceRefs).toEqual([outcome.evidence]);
    expect(outcome.state.violations).toEqual([]);
    await expect(vault.readRunState(runId)).resolves.toEqual(outcome.state);

    const bundle = await readEvidence(outcome.evidence);
    expect(bundle.collectedBy).toBe('runtime');
    expect(bundle.claim).toEqual({ narrative: 'stub: no model was called', filesChanged: [] });
    expect(bundle.claimEvidenceDiff).toEqual([]);
    expect(bundle).toMatchObject({ runId, taskId, baseCommit: BASE_COMMIT, driverProvenanceId: 'stub-driver@1.0.0', contractVersion: '1.0.0' });
    expect(bundle.checks).toEqual(outcome.gate.checks);
  });

  test('L0 runs the same three stations; nothing distinguishes it from L1 without a policy engine', async () => {
    const outcome = await startRun(request({ requestedLevel: 0 }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.verdict).toBe('pass');
  });

  test('build hands the driver the locked text as the stable prefix, no tools (I4), the fast tier, and the build sandbox', async () => {
    const driver = new RecordingDriver(new StubDriver());
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    const outcome = await startRun(request({ components: { vault, sandbox, driver } }));
    expect(outcome.ok).toBe(true);
    expect(driver.requests).toHaveLength(1);
    const req = driver.requests[0];
    if (req === undefined) return;
    expect(req.taskId).toBe(taskId);
    expect(req.role).toBe('builder');
    expect(req.stablePrefix).toContain(await readFile(join(workspace, 'spec.md'), 'utf8'));
    expect(req.variableSuffix).toBe(taskId);
    expect(req.tier).toBe('fast');
    expect(req.tools).toEqual([]);
    expect(req.sandbox).toBe(sandbox.provisioned[0]);
  });

  test('verify collects evidence in a fresh sandbox, after the build sandbox is destroyed; build mounts the workspace rw and verify mounts it ro', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    const outcome = await startRun(request({ components: { ...components, sandbox } }));
    expect(outcome.ok).toBe(true);
    expect(sandbox.provisioned).toHaveLength(2);
    expect(sandbox.destroyed).toEqual(sandbox.provisioned);
    const [build, verify] = sandbox.provisioned;
    expect(build).not.toBe(verify);
    expect(sandbox.executed.map((e) => e.handle)).toEqual([verify]);
    expect(sandbox.executed[0]?.cmd).toEqual(['node', '-e', 'process.exit(0)']);
    // The workspace is the only mount either way; the checks get a tree they cannot modify (I3).
    expect(sandbox.specs.map((s) => s.mounts)).toEqual([
      { workspace: { source: workspace, target: '/workspace', mode: 'rw' }, others: [] },
      { workspace: { source: workspace, target: '/workspace', mode: 'ro' }, others: [] },
    ]);
    for (const spec of sandbox.specs) expect(spec.egress).toEqual({ mode: 'deny-all', allow: [] });
  });
});

describe('the verdict follows the checks and nothing else (I2)', () => {
  test('a failing check fails the gate from its exit code, whatever the driver claimed', async () => {
    const claim = { narrative: 'all tests pass', filesChanged: [] };
    const outcome = await startRun(
      request({
        task: task([{ ...HELLO_CHECK, command: 'node -e process.exit(3)' }]),
        components: { ...components, driver: new StubDriver({ claim }) },
      }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.verdict).toBe('fail');
    expect(outcome.gate.checks[0]?.exitCode).toBe(3);
    expect(outcome.next).toMatchObject({ ok: false, reason: 'gate-failed' });
    expect(outcome.state.tasks[taskId]).toBe('failed');
    expect(outcome.state.evidenceRefs).toEqual([outcome.evidence]);
    expect((await readEvidence(outcome.evidence)).claim).toEqual(claim);
  });

  test('a required check with an expected suite count fails while the count is unknown (I5)', async () => {
    const outcome = await startRun(request({ task: task([{ ...HELLO_CHECK, expectedSuiteCount: 1 }]) }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.verdict).toBe('fail');
    expect(outcome.gate.checks[0]).toMatchObject({ exitCode: 0, suiteCount: null });
    expect(outcome.next).toMatchObject({ ok: false, reason: 'gate-failed' });
    if (outcome.next.ok) return;
    expect(outcome.next.detail).toMatch(/hello-exit-zero/);
  });

  test('a required check that cannot be started has no result and fails the gate, naming it (I5)', async () => {
    const outcome = await startRun(
      request({ task: task([{ ...HELLO_CHECK, id: 'cannot-start', command: 'no-such-program-s1 --version' }]) }),
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.verdict).toBe('fail');
    expect(outcome.gate.checks).toEqual([]);
    expect(outcome.next).toMatchObject({ ok: false, reason: 'gate-failed' });
    if (outcome.next.ok) return;
    expect(outcome.next.detail).toMatch(/cannot-start/);
    expect(outcome.state.tasks[taskId]).toBe('failed');
  });

  test('a failing check that is not required does not fail the gate', async () => {
    const optional: CheckSpec = { ...HELLO_CHECK, id: 'optional-exit-one', command: 'node -e process.exit(1)', required: false };
    const outcome = await startRun(request({ task: task([HELLO_CHECK, optional]) }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.verdict).toBe('pass');
    expect(outcome.gate.checks.map((c) => [c.checkId, c.exitCode])).toEqual([
      ['hello-exit-zero', 0],
      ['optional-exit-one', 1],
    ]);
  });
});

describe('locks are re-verified at every transition (I3)', () => {
  test('a locked artifact changed between spec and build is refused at build with a recorded violation', async () => {
    const outcome = await startRun(request({ components: { ...components, vault: new TamperingVault(vault, workspace, 1) } }));
    expect(outcome).toMatchObject({ ok: false, reason: 'refused', at: 'build', transition: { ok: false, reason: 'lock-tamper' } });
    if (outcome.ok || outcome.reason !== 'refused') return;
    expect(outcome.transition.detail).toMatch(/spec\.md/);

    const state = await vault.readRunState(runId);
    expect(state.station).toBe('build');
    expect(state.tasks[taskId]).toBe('failed');
    expect(state.evidenceRefs).toEqual([]);
    expect(state.violations).toHaveLength(1);
    const ref = state.violations[0];
    if (ref === undefined) return;
    const violation = await readViolation(ref);
    expect(violation).toMatchObject({
      runId,
      taskId,
      kind: 'lock-tamper',
      role: 'builder',
      driverProvenanceId: 'stub-driver@1.0.0',
      contractVersion: '1.0.0',
    });
    expect(violation.detail).toMatchObject({ tampered: [{ path: 'spec.md' }] });
  });

  test('a locked artifact changed between build and verify is refused at verify before any check runs', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    const outcome = await startRun(request({ components: { vault: new TamperingVault(vault, workspace, 2), sandbox, driver: new StubDriver() } }));
    expect(outcome).toMatchObject({ ok: false, reason: 'refused', at: 'verify', transition: { ok: false, reason: 'lock-tamper' } });
    expect(sandbox.executed).toEqual([]);
    const state = await vault.readRunState(runId);
    expect(state.station).toBe('verify');
    expect(state.tasks[taskId]).toBe('failed');
    expect(state.evidenceRefs).toEqual([]);
    expect(state.violations).toHaveLength(1);
  });
});

describe('above L1 (I5)', () => {
  test.each([2, 3] as const)('a run requested at L%i with the stubs wired is refused, naming all four unsafe components', async (level) => {
    const outcome = await startRun(request({ requestedLevel: level }));
    expect(outcome).toMatchObject({ ok: false, reason: 'unsafe-above-l1', requestedLevel: level });
    if (outcome.ok || outcome.reason !== 'unsafe-above-l1') return;
    expect(outcome.unsafe.map((u) => u.component)).toEqual(['StubVault', 'StubSandboxProvider', 'StubDriver', 'SkeletonLine']);
    for (const u of outcome.unsafe) expect(u.cannotEnforce.length).toBeGreaterThan(0);
  });

  test('the refusal happens before anything is committed, locked, or provisioned', async () => {
    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    await startRun(request({ requestedLevel: 2, components: { ...components, sandbox } }));
    await expect(vault.readRunState(runId)).rejects.toThrow();
    await expect(vault.verifyLocks(runId)).rejects.toThrow();
    expect(sandbox.provisioned).toEqual([]);
  });
});
