/**
 * LocalVault: the Vault contract over the local filesystem.
 *
 * The registry owns the invariant assertions — that a changed lock verifies as
 * tampered (I3), that a later lock preserves the earlier one (I3), that
 * concurrent commits leave one winner (I5), and that the prototype carries
 * only the seven named operations (I1). What is here is the rest of the
 * contract: durability, content addressing, the refusals, and the audit
 * property that an object file's own SHA-256 is its name. Substitution by
 * symlink or junction is `I3.locked-artifact-cannot-be-substituted` in the
 * registry, which is the suite CI runs with a verbose reporter, so its log
 * names the mechanism that ran on each platform.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunId, RunState, TaskId } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { LocalVault, type EvidenceBundle } from '../src/index.js';

const runId = 'run-1' as RunId;
const taskId = 'task-1' as TaskId;
const SPEC = '# spec\n\nOne shippable capability.\n';


let base: string;
let store: string;
let artifacts: string;
let vault: LocalVault;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'p1-local-'));
  store = join(base, 'vault');
  artifacts = join(base, 'workspace');
  await mkdir(store, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  vault = new LocalVault({ store, artifacts });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function bundle(): EvidenceBundle {
  return {
    runId,
    taskId,
    baseCommit: 'a'.repeat(40),
    checks: [],
    claim: { narrative: 'the task, as the model tells it', filesChanged: [] },
    claimEvidenceDiff: [],
    collectedBy: 'runtime',
    driverProvenanceId: 'local-vault-test@1.0.0',
    contractVersion: '1.0.0',
  };
}

function violation(): IntegrityViolation {
  return {
    runId,
    taskId,
    kind: 'lock-tamper',
    role: 'builder' as IntegrityViolation['role'],
    driverProvenanceId: 'local-vault-test@1.0.0',
    contractVersion: '1.0.0',
    detectedAt: new Date().toISOString(),
    detail: { station: 'verify' },
  };
}

function state(version: string): RunState {
  return { runId, station: 'spec', tasks: {}, evidenceRefs: [], violations: [], version };
}

describe('two roots', () => {
  test('refuses a store inside the artifact root, and the reverse', () => {
    // The artifact root is the tree an agent writes. A Vault inside it is a
    // Vault an agent can reach, which is what I1 denies.
    expect(() => new LocalVault({ store: join(artifacts, 'vault'), artifacts })).toThrow(/overlap/);
    expect(() => new LocalVault({ store, artifacts: store })).toThrow(/overlap/);
    expect(() => new LocalVault({ store, artifacts: join(store, 'work') })).toThrow(/overlap/);
  });

  test('refuses a run id that would climb out of the store', async () => {
    for (const bad of ['../escape', 'a/b', '..', '.', '']) {
      await expect(vault.readRunState(bad as RunId)).rejects.toThrow(/not a usable run id/);
    }
  });
});

describe('evidence and violations', () => {
  test('read back byte-identical, and an object file verifies as its own name', async () => {
    const ref = await vault.writeEvidence(bundle());
    const read = await vault.read(ref);
    expect(JSON.parse(new TextDecoder().decode(read))).toEqual(bundle());

    // The audit claim: the bytes on disk are the bytes that were hashed, so
    // recomputing the digest reproduces the file's name with no Olympus in the
    // way. This is the property a database would have taken away.
    const file = join(store, 'runs', runId, 'objects', 'evidence', `${ref.hash}.json`);
    expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(ref.hash);
  });

  test('the same bytes twice yield the same reference and store one object', async () => {
    const first = await vault.writeEvidence(bundle());
    const second = await vault.writeEvidence(bundle());
    expect(second).toEqual(first);
    expect(await readdir(join(store, 'runs', runId, 'objects', 'evidence'))).toHaveLength(1);
  });

  test('a violation is stored under its own kind', async () => {
    const recorded = violation();
    const ref = await vault.recordViolation(recorded);
    expect(ref.kind).toBe('violation');
    expect(JSON.parse(new TextDecoder().decode(await vault.read(ref)))).toEqual(recorded);
  });

  test('an unknown reference throws, and a right hash under the wrong kind or run is unknown', async () => {
    const ref = await vault.writeEvidence(bundle());
    await expect(vault.read({ ...ref, hash: 'b'.repeat(64) })).rejects.toThrow(/no evidence/);
    await expect(vault.read({ ...ref, kind: 'violation' })).rejects.toThrow(/no violation/);
    await expect(vault.read({ ...ref, runId: 'run-2' as RunId })).rejects.toThrow(/run-2/);
  });

  test('refuses a reference that is not a digest, rather than reading a path from it', async () => {
    await expect(vault.read({ runId, kind: 'evidence', hash: '../../etc/passwd' })).rejects.toThrow(/not a SHA-256/);
  });
});

describe('locking', () => {
  beforeEach(async () => {
    await writeFile(join(artifacts, 'spec.md'), SPEC);
  });

  test('refuses an empty path list: an empty manifest would verify as intact', async () => {
    await expect(vault.lock(runId, [], 'spec')).rejects.toThrow(/refusing to lock nothing/);
  });

  test('refuses a path that is absolute, escaping, or duplicated', async () => {
    await expect(vault.lock(runId, ['/etc/passwd'], 'spec')).rejects.toThrow(/absolute/);
    await expect(vault.lock(runId, ['C:\\Windows\\win.ini'], 'spec')).rejects.toThrow(/absolute/);
    await expect(vault.lock(runId, ['../outside.md'], 'spec')).rejects.toThrow(/'\.\.' segment/);
    await expect(vault.lock(runId, ['spec.md', 'spec.md'], 'spec')).rejects.toThrow(/listed twice/);
  });

  test('refuses to lock a file that is not there', async () => {
    await expect(vault.lock(runId, ['absent.md'], 'spec')).rejects.toThrow(/no such file/);
  });

  test('verifyLocks throws for a run with no manifest rather than reporting intact', async () => {
    await expect(vault.verifyLocks(runId)).rejects.toThrow(/nothing is locked/);
  });

  test('a deleted locked artifact is tampered, distinguishably from an edited one', async () => {
    await vault.lock(runId, ['spec.md'], 'spec');
    await rm(join(artifacts, 'spec.md'));
    const verdict = await vault.verifyLocks(runId);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? [] : verdict.tampered[0]?.actual).toBe('missing');
  });

  test('each lock is a new generation; no earlier manifest is rewritten', async () => {
    await writeFile(join(artifacts, 'acceptance.test.ts'), 'test.todo("acceptance");\n');
    await vault.lock(runId, ['spec.md'], 'spec');
    await vault.lock(runId, ['acceptance.test.ts'], 'test-design');
    expect((await readdir(join(store, 'runs', runId, 'locks'))).sort()).toEqual(['1.json', '2.json']);
  });
});

describe('run state', () => {
  test('commits from version 0 and reads back what was stored', async () => {
    const stored = await vault.commitRunState(state('0'), '0');
    expect(stored.version).toBe('1');
    expect(await vault.readRunState(runId)).toEqual(stored);
  });

  test('ifVersion is authoritative; the version on the record is ignored', async () => {
    const stored = await vault.commitRunState({ ...state('99'), station: 'build' }, '0');
    expect(stored.version).toBe('1');
    expect(stored.station).toBe('build');
  });

  test('a stale commit is rejected and stores nothing', async () => {
    await vault.commitRunState(state('0'), '0');
    await vault.commitRunState(state('1'), '1');
    await expect(vault.commitRunState(state('0'), '0')).rejects.toThrow(/already moved past|never current/);
    expect((await vault.readRunState(runId)).version).toBe('2');
    expect(await readdir(join(store, 'runs', runId, 'state'))).toHaveLength(2);
  });

  test('a version that was never current is refused, so a run cannot jump forward', async () => {
    await expect(vault.commitRunState(state('7'), '7')).rejects.toThrow(/never current/);
    await vault.commitRunState(state('0'), '0');
    await expect(vault.commitRunState(state('5'), '5')).rejects.toThrow(/never current/);
    expect((await vault.readRunState(runId)).version).toBe('1');
  });

  test('refuses a version that is not one', async () => {
    for (const bad of ['', '-1', '1.5', 'latest', '01']) {
      await expect(vault.commitRunState(state(bad), bad)).rejects.toThrow(/not a run state version/);
    }
  });

  test('an unknown run has no state', async () => {
    await expect(vault.readRunState(runId)).rejects.toThrow(/no run state/);
  });
});

describe('durability', () => {
  test('a Vault reopened over the same store reads back what an earlier one wrote', async () => {
    await writeFile(join(artifacts, 'spec.md'), SPEC);
    const manifest = await vault.lock(runId, ['spec.md'], 'spec');
    const ref = await vault.writeEvidence(bundle());
    await vault.commitRunState(state('0'), '0');

    // A different instance over the same roots: this is what the in-memory
    // stub could not do, and the reason the store is on disk at all.
    const reopened = new LocalVault({ store, artifacts });
    expect(await reopened.verifyLocks(runId)).toEqual({ ok: true });
    expect((await reopened.readRunState(runId)).version).toBe('1');
    expect(JSON.parse(new TextDecoder().decode(await reopened.read(ref)))).toEqual(bundle());

    // And the manifest a reopened Vault verifies against is the one on disk.
    await writeFile(join(artifacts, 'spec.md'), `${SPEC}quietly widened\n`);
    const verdict = await reopened.verifyLocks(runId);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok ? [] : verdict.tampered[0]?.expected).toBe(manifest.entries[0]?.sha256);
  });
});
