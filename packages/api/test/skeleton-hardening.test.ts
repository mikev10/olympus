/**
 * Regression tests from the external review of S1
 * (docs/reviews/2026-09-09-S1-walking-skeleton-adversarial-triage.md). Each
 * test is one finding's construction, kept as the reviewer wrote it, and
 * failed against the code the review saw.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StubDriver, type RunId, type TaskId } from '@olympus-ai/core';
import type { CheckSpec, IntegrityViolation } from '@olympus-ai/integrity';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startRun, type FixtureTask, type RunOutcome, type RunRequest } from '../src/index.js';

const HELLO = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hello');
const runId = 'run-hardening' as RunId;
const taskId = 'hello' as TaskId;

const ok: CheckSpec = { id: 'x', kind: 'unit', command: 'node -e process.exit(0)', required: true, timeoutMs: 10_000 };
const bad: CheckSpec = { ...ok, command: 'node -e process.exit(3)' };

let workspace: string;
let vault: StubVault;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 's1-hardening-'));
  await cp(HELLO, workspace, { recursive: true });
  vault = new StubVault(workspace);
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function request(task: Partial<FixtureTask>): RunRequest {
  return {
    runId,
    baseCommit: '0'.repeat(40),
    requestedLevel: 1,
    task: { id: taskId, workspace, lockedPaths: ['spec.md'], checks: [ok], ...task },
    components: { vault, sandbox: new StubSandboxProvider(), driver: new StubDriver() },
  };
}

/** The refusal that happens before anything is locked, provisioned, or committed. */
async function expectInvalid(outcome: RunOutcome, problem: RegExp): Promise<void> {
  expect(outcome).toMatchObject({ ok: false, reason: 'invalid-request' });
  if (outcome.ok || outcome.reason !== 'invalid-request') return;
  expect(outcome.problems.join('\n')).toMatch(problem);
  await expect(vault.readRunState(runId)).rejects.toThrow();
  await expect(vault.verifyLocks(runId)).rejects.toThrow();
}

describe('finding 1: duplicate check ids', () => {
  test('a manifest with a duplicated id is refused before anything runs', async () => {
    await expectInvalid(await startRun(request({ checks: [ok, bad] })), /'x'.*(twice|duplicate)/i);
  });

  test('results keep their position: a second required check that fails is not masked by a first that passes', async () => {
    const outcome = await startRun(request({ checks: [ok, { ...bad, id: 'y' }] }));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.checks.map((c) => [c.checkId, c.exitCode])).toEqual([
      ['x', 0],
      ['y', 3],
    ]);
    expect(outcome.gate.verdict).toBe('fail');
  });
});

describe('finding 2: a locked artifact changed during verify', () => {
  test('is refused at verify after the checks, with a violation recorded and no evidence written', async () => {
    const rewrite: CheckSpec = { ...ok, id: 'rewrite', command: "node -e require('node:fs').writeFileSync('spec.md','changed')" };
    const outcome = await startRun(request({ checks: [rewrite] }));
    expect(await readFile(join(workspace, 'spec.md'), 'utf8')).toBe('changed');
    expect(outcome).toMatchObject({ ok: false, reason: 'refused', at: 'verify', transition: { ok: false, reason: 'lock-tamper' } });

    const state = await vault.readRunState(runId);
    expect(state.station).toBe('verify');
    expect(state.tasks[taskId]).toBe('failed');
    expect(state.evidenceRefs).toEqual([]);
    expect(state.violations).toHaveLength(1);
    const ref = state.violations[0];
    if (ref === undefined) return;
    const violation = JSON.parse(new TextDecoder().decode(await vault.read(ref))) as IntegrityViolation;
    expect(violation.kind).toBe('lock-tamper');
    expect(violation.detail).toMatchObject({ station: 'verify', phase: 'after-checks', tampered: [{ path: 'spec.md' }] });
    expect(violation.detail.checks).toEqual([expect.objectContaining({ checkId: 'rewrite', exitCode: 0 })]);
  });
});

describe('finding 3: the verification manifest', () => {
  test('3a: a manifest with no checks is refused', async () => {
    await expectInvalid(await startRun(request({ checks: [] })), /no check/i);
  });

  test('3a: a manifest with only optional checks is refused', async () => {
    await expectInvalid(await startRun(request({ checks: [{ ...ok, required: false }] })), /required/i);
  });

  test("3b: the run works from a snapshot: shrinking the caller's array after startRun changes nothing", async () => {
    const checks: CheckSpec[] = [bad];
    const pending = startRun(request({ checks }));
    checks.length = 0;
    const outcome = await pending;
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.gate.checks).toHaveLength(1);
    expect(outcome.gate.verdict).toBe('fail');
  });

  test('3c: a check whose required flag is not a boolean is refused', async () => {
    const unrequired = { ...bad, required: undefined as unknown as boolean };
    await expectInvalid(await startRun(request({ checks: [unrequired] })), /required.*boolean/i);
  });

  test('3c: a check with an empty command, an empty id, or a bad suite count is refused', async () => {
    await expectInvalid(await startRun(request({ checks: [{ ...ok, command: '  ' }] })), /command/i);
    await expectInvalid(await startRun(request({ checks: [{ ...ok, id: '' }] })), /id/i);
    await expectInvalid(await startRun(request({ checks: [{ ...ok, expectedSuiteCount: -1 }] })), /expectedSuiteCount/);
  });
});

describe('finding 7: locked paths', () => {
  test('an absolute locked path is refused before the lock, not thrown after it', async () => {
    const outside = await mkdtemp(join(tmpdir(), 's1-outside-'));
    try {
      await writeFile(join(outside, 'other.md'), 'elsewhere');
      await expectInvalid(await startRun(request({ lockedPaths: [join(outside, 'other.md')] })), /absolute/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('a path with a .. segment is refused', async () => {
    await expectInvalid(await startRun(request({ lockedPaths: ['../spec.md'] })), /\.\./);
    await expectInvalid(await startRun(request({ lockedPaths: ['a/../../spec.md'] })), /\.\./);
  });

  test('an empty list, an empty path, or a duplicated path is refused', async () => {
    await expectInvalid(await startRun(request({ lockedPaths: [] })), /lockedPaths/);
    await expectInvalid(await startRun(request({ lockedPaths: [''] })), /empty/i);
    await expectInvalid(await startRun(request({ lockedPaths: ['spec.md', 'spec.md'] })), /twice|duplicate/i);
  });
});
