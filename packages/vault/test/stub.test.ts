/**
 * StubVault: in-memory, but no operation is relaxed. Locks are real SHA-256
 * over file bytes under the root, an unknown ref or run throws, a missing
 * path refuses to lock, and run state is guarded by ifVersion.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunId, RunState, TaskId } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { StubVault, type EvidenceBundle } from '../src/index.js';

const runId = 'run-1' as RunId;
const taskId = 'task-1' as TaskId;

const SPEC = '# spec\n';

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function bundle(): EvidenceBundle {
  return {
    runId,
    taskId,
    baseCommit: 'abc',
    checks: [],
    claim: { narrative: 'stub', filesChanged: [] },
    claimEvidenceDiff: [],
    collectedBy: 'runtime',
    driverProvenanceId: 'stub-driver@1.0.0',
    contractVersion: '1.0.0',
  };
}

function violation(): IntegrityViolation {
  return {
    runId,
    taskId,
    kind: 'lock-tamper',
    role: 'builder' as IntegrityViolation['role'],
    driverProvenanceId: 'stub-driver@1.0.0',
    contractVersion: '1.0.0',
    detectedAt: '2026-09-08T00:00:00.000Z',
    detail: { tampered: ['spec.md'] },
  };
}

function state(): RunState {
  return { runId, station: 'spec', tasks: { [taskId]: 'pending' }, evidenceRefs: [], violations: [], version: '0' };
}

let root: string;
let vault: StubVault;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stub-vault-'));
  await writeFile(join(root, 'spec.md'), SPEC);
  vault = new StubVault(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('declaration', () => {
  test('declares itself unsafe as StubVault, naming persistence and the mount layer', () => {
    expect(vault.unsafe.component).toBe('StubVault');
    const text = vault.unsafe.cannotEnforce.join('\n');
    expect(text).toMatch(/persist/i);
    expect(text).toMatch(/mount/i);
  });
});

describe('lock', () => {
  test('hashes each path under the root with SHA-256 and records who locked it and when', async () => {
    const manifest = await vault.lock(runId, ['spec.md'], 'spec');
    expect(manifest.runId).toBe(runId);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({ path: 'spec.md', sha256: sha256(SPEC), lockedBy: 'spec' });
    expect(Date.parse(manifest.entries[0]?.lockedAt ?? '')).not.toBeNaN();
  });

  test('replaces an earlier manifest for the run', async () => {
    await vault.lock(runId, ['spec.md'], 'spec');
    await writeFile(join(root, 'tests.md'), 'tests');
    const second = await vault.lock(runId, ['tests.md'], 'test-design');
    expect(second.entries.map((e) => e.path)).toEqual(['tests.md']);
    await writeFile(join(root, 'spec.md'), 'changed');
    await expect(vault.verifyLocks(runId)).resolves.toEqual({ ok: true });
  });

  test('throws on a path that does not exist and locks nothing (I5)', async () => {
    await expect(vault.lock(runId, ['spec.md', 'missing.md'], 'spec')).rejects.toThrow(/missing\.md/);
    await expect(vault.verifyLocks(runId)).rejects.toThrow();
  });

  test('throws on an empty path list: a manifest with nothing in it is not a lock', async () => {
    await expect(vault.lock(runId, [], 'spec')).rejects.toThrow();
    await expect(vault.verifyLocks(runId)).rejects.toThrow();
  });
});

describe('verifyLocks', () => {
  test('is ok while every locked file is unchanged', async () => {
    await vault.lock(runId, ['spec.md'], 'spec');
    await expect(vault.verifyLocks(runId)).resolves.toEqual({ ok: true });
  });

  test('names each changed path with the expected and actual hash', async () => {
    await writeFile(join(root, 'tests.md'), 'tests');
    await vault.lock(runId, ['spec.md', 'tests.md'], 'spec');
    await writeFile(join(root, 'spec.md'), '# changed\n');
    await expect(vault.verifyLocks(runId)).resolves.toEqual({
      ok: false,
      tampered: [{ path: 'spec.md', expected: sha256(SPEC), actual: sha256('# changed\n') }],
    });
  });

  test('reports a deleted locked file as tampered rather than throwing', async () => {
    await vault.lock(runId, ['spec.md'], 'spec');
    await rm(join(root, 'spec.md'));
    const verdict = await vault.verifyLocks(runId);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.tampered).toHaveLength(1);
    expect(verdict.tampered[0]).toMatchObject({ path: 'spec.md', expected: sha256(SPEC), actual: 'missing' });
  });

  test('throws for a run with no manifest: ok is never the answer to nothing locked', async () => {
    await expect(vault.verifyLocks(runId)).rejects.toThrow(/run-1/);
  });
});

describe('writeEvidence, recordViolation, read', () => {
  test('stores the bundle under the SHA-256 of its JSON bytes and reads it back', async () => {
    const b = bundle();
    const ref = await vault.writeEvidence(b);
    expect(ref).toEqual({ runId, kind: 'evidence', hash: sha256(JSON.stringify(b)) });
    const bytes = await vault.read(ref);
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(b);
  });

  test('returns the same ref for a second write of identical bytes', async () => {
    const first = await vault.writeEvidence(bundle());
    const second = await vault.writeEvidence(bundle());
    expect(second).toEqual(first);
  });

  test('stores a violation under kind violation', async () => {
    const v = violation();
    const ref = await vault.recordViolation(v);
    expect(ref).toEqual({ runId, kind: 'violation', hash: sha256(JSON.stringify(v)) });
    expect(JSON.parse(new TextDecoder().decode(await vault.read(ref)))).toEqual(v);
  });

  test('read throws for an unknown ref', async () => {
    await expect(vault.read({ runId, kind: 'evidence', hash: sha256('nothing') })).rejects.toThrow(/evidence/);
  });

  test('read throws for a ref whose kind or run does not match what was stored', async () => {
    const ref = await vault.writeEvidence(bundle());
    await expect(vault.read({ ...ref, kind: 'violation' })).rejects.toThrow();
    await expect(vault.read({ ...ref, runId: 'run-2' as RunId })).rejects.toThrow();
  });
});

describe('run state', () => {
  test('readRunState throws when the run has no state', async () => {
    await expect(vault.readRunState(runId)).rejects.toThrow(/run-1/);
  });

  test('the first commit needs ifVersion 0, stores version 1, and ignores the input version', async () => {
    const stored = await vault.commitRunState({ ...state(), version: '99' }, '0');
    expect(stored).toEqual({ ...state(), version: '1' });
    await expect(vault.readRunState(runId)).resolves.toEqual(stored);
  });

  test('a mismatched ifVersion throws and stores nothing', async () => {
    await vault.commitRunState(state(), '0');
    await expect(vault.commitRunState({ ...state(), station: 'build' }, '0')).rejects.toThrow(/version/);
    await expect(vault.commitRunState({ ...state(), station: 'build' }, '2')).rejects.toThrow(/version/);
    expect((await vault.readRunState(runId)).station).toBe('spec');
  });

  test('each matched commit advances the version by one', async () => {
    const v1 = await vault.commitRunState(state(), '0');
    const v2 = await vault.commitRunState({ ...v1, station: 'build' }, v1.version);
    const v3 = await vault.commitRunState({ ...v2, station: 'verify' }, v2.version);
    expect([v1.version, v2.version, v3.version]).toEqual(['1', '2', '3']);
    expect((await vault.readRunState(runId)).station).toBe('verify');
  });

  test('what is stored is a copy: mutating the input or the result does not change what is read back', async () => {
    const input = state();
    const stored = await vault.commitRunState(input, '0');
    input.station = 'build';
    stored.tasks[taskId] = 'passed';
    const read = await vault.readRunState(runId);
    expect(read.station).toBe('spec');
    expect(read.tasks[taskId]).toBe('pending');
  });
});
