/**
 * StubVault: the Vault contract over an in-memory store. Nothing is relaxed:
 * there is no generic write, locks are real SHA-256 over file bytes, an
 * unknown ref or run throws, and run state is guarded by ifVersion. What is
 * missing is persistence and the mount-layer enforcement of I1, and `unsafe`
 * says so. The store is a Map that dies with the process. P1 replaces this
 * file.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RunId, RunState, StationId, TaskResult, VaultRef } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type {
  AdmissionRecord, BaseRunRecord, CriticRecord, DraftLockRecord, DraftRecord, EnforcementDecision, EvidenceBundle, IntegrationRecord, IntentRecord,
  LockEntry, LockManifest, LockVerdict, NoRunState, RubricRecord, UsageRecord, Vault,
} from '../types.js';

/** Reported as `actual` for a locked path that no longer exists: a deleted artifact is a mismatch, not an empty file. */
const MISSING = 'missing';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function refKey(ref: VaultRef): string {
  return `${ref.runId}/${ref.kind}/${ref.hash}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

export class StubVault implements Vault {
  /**
   * Read structurally by the entry point in @olympus-ai/api, which this
   * package cannot import; the conformance fixture I5.stubs-declare-unsafe
   * pins the shape.
   */
  readonly unsafe: { readonly component: 'StubVault'; readonly cannotEnforce: readonly string[] } = {
    component: 'StubVault',
    cannotEnforce: [
      'persistence: the store is process memory, and everything in it is lost with the process',
      "I1 at the mount layer: nothing prevents a process on the host from reaching this memory; the guarantee is the sandbox's, and the sandbox is also a stub",
    ],
  };

  private readonly root: string;
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly locks = new Map<RunId, LockManifest>();
  private readonly states = new Map<RunId, RunState>();
  private readonly decisions = new Map<RunId, VaultRef[]>();
  private readonly integration = new Map<RunId, VaultRef[]>();
  private readonly usage = new Map<RunId, VaultRef[]>();
  private readonly admitted = new Set<RunId>();
  private readonly baseRuns = new Map<string, VaultRef>();
  private readonly draftLocks = new Set<string>();
  /** Every run any record was written for, so `listRuns` names a run refused at admission too (A-R2-02). */
  private readonly runs = new Set<RunId>();

  /** `root` is what locked paths resolve against (S1 finding 4d; P1 decides where the base belongs). */
  constructor(root: string) {
    this.root = root;
  }

  read(ref: VaultRef): Promise<Uint8Array> {
    const bytes = this.blobs.get(refKey(ref));
    if (bytes === undefined) return Promise.reject(new Error(`StubVault: no ${ref.kind} ${ref.hash} for run ${ref.runId}`));
    return Promise.resolve(new Uint8Array(bytes));
  }

  /**
   * Adds to the run's manifest and refuses an already-locked path, as the
   * local Vault does (D-P1-05). The skeleton replaced the manifest instead,
   * which went unnoticed while its line locked once; a line that locks at
   * `spec`, `test-design`, and `plan` would drop the spec from verification at
   * the second lock (D-P4-05).
   */
  async lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest> {
    if (paths.length === 0) {
      throw new Error(`StubVault: refusing to lock nothing for run ${runId}; an empty manifest would verify as intact`);
    }
    const existing = this.locks.get(runId)?.entries ?? [];
    const already = paths.filter((path) => existing.some((entry) => entry.path === path));
    if (already.length > 0) {
      throw new Error(`StubVault: refusing to lock ${already.join(', ')} again for run ${runId}; an artifact is fixed from its first lock`);
    }
    const lockedAt = new Date().toISOString();
    const entries: LockEntry[] = [...existing];
    for (const path of paths) {
      const hash = await this.hashFile(path);
      if (hash === undefined) throw new Error(`StubVault: cannot lock ${path} for run ${runId}: no such file under ${this.root}`);
      entries.push({ path, sha256: hash, lockedAt, lockedBy: by });
    }
    const manifest: LockManifest = { runId, entries };
    this.locks.set(runId, manifest);
    this.runs.add(runId);
    return structuredClone(manifest);
  }

  async verifyLocks(runId: RunId): Promise<LockVerdict> {
    const manifest = this.locks.get(runId);
    if (manifest === undefined) throw new Error(`StubVault: nothing is locked for run ${runId}; refusing to report intact`);
    const tampered: Array<{ path: string; expected: string; actual: string }> = [];
    for (const entry of manifest.entries) {
      const actual = (await this.hashFile(entry.path)) ?? MISSING;
      if (actual !== entry.sha256) tampered.push({ path: entry.path, expected: entry.sha256, actual });
    }
    return tampered.length === 0 ? { ok: true } : { ok: false, tampered };
  }

  writeEvidence(b: EvidenceBundle): Promise<VaultRef> {
    return Promise.resolve(this.store(b.runId, 'evidence', b));
  }

  recordViolation(v: IntegrityViolation): Promise<VaultRef> {
    return Promise.resolve(this.store(v.runId, 'violation', v));
  }

  recordAdmission(a: AdmissionRecord): Promise<VaultRef> {
    const runId = a.run.id;
    if (typeof (a.stack as unknown) !== 'string' || a.stack === '') {
      return Promise.reject(new Error(`StubVault: the admission record of run ${runId} names no stack; nothing was stored`));
    }
    // The roles a run's seats run under cannot be supplied later (D-A-RC-01).
    if (!Array.isArray(a.roles)) {
      return Promise.reject(new Error(`StubVault: the admission record of run ${runId} does not pin its roles; nothing was stored`));
    }
    if (this.admitted.has(runId)) {
      return Promise.reject(new Error(`StubVault: run ${runId} already has an admission record; nothing was stored`));
    }
    this.admitted.add(runId);
    return Promise.resolve(this.store(runId, 'admission', a));
  }

  recordTaskResult(runId: RunId, r: TaskResult): Promise<VaultRef> {
    return Promise.resolve(this.store(runId, 'task-result', r));
  }

  recordUsage(r: UsageRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error("StubVault: a usage record is collected by the runtime, or it is not recorded"));
    const ref = this.store(r.runId, 'usage', r);
    const refs = this.usage.get(r.runId) ?? [];
    if (!refs.some((u) => u.hash === ref.hash)) refs.push(ref);
    this.usage.set(r.runId, refs);
    return Promise.resolve(ref);
  }

  readUsage(runId: RunId): Promise<readonly VaultRef[]> {
    return Promise.resolve([...(this.usage.get(runId) ?? [])]);
  }

  recordDecision(d: EnforcementDecision): Promise<VaultRef> {
    if ((d.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: an enforcement decision is collected by the runtime, or it is not recorded'));
    const ref = this.store(d.runId, 'decision', d);
    const refs = this.decisions.get(d.runId) ?? [];
    if (!refs.some((r) => r.hash === ref.hash)) refs.push(ref);
    this.decisions.set(d.runId, refs);
    return Promise.resolve(ref);
  }

  readDecisions(runId: RunId): Promise<readonly VaultRef[]> {
    return Promise.resolve([...(this.decisions.get(runId) ?? [])]);
  }

  recordIntegration(r: IntegrationRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: an integration record is collected by the runtime, or it is not recorded'));
    const ref = this.store(r.runId, 'integration', r);
    const refs = this.integration.get(r.runId) ?? [];
    if (!refs.some((i) => i.hash === ref.hash)) refs.push(ref);
    this.integration.set(r.runId, refs);
    return Promise.resolve(ref);
  }

  readIntegration(runId: RunId): Promise<readonly VaultRef[]> {
    return Promise.resolve([...(this.integration.get(runId) ?? [])]);
  }

  recordBaseRun(r: BaseRunRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: a base record is collected by the runtime, or it is not recorded'));
    const key = `${r.runId}\0${r.draft ?? ''}`;
    if (this.baseRuns.has(key)) return Promise.reject(new Error(`StubVault: run ${r.runId} already has a base record for this draft; nothing was stored`));
    const ref = this.store(r.runId, 'base-run', r);
    this.baseRuns.set(key, ref);
    return Promise.resolve(ref);
  }

  readBaseRun(runId: RunId, draft: string | null): Promise<VaultRef | null> {
    return Promise.resolve(this.baseRuns.get(`${runId}\0${draft ?? ''}`) ?? null);
  }

  recordIntent(r: IntentRecord): Promise<VaultRef> {
    if ((r.from as string) !== 'principal' || (r.collectedBy as string) !== 'runtime') return Promise.reject(new Error("StubVault: an intent comes from the principal's channel, collected by the runtime"));
    return Promise.resolve(this.store(r.runId, 'intent', r));
  }

  recordRubric(r: RubricRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: a rubric is collected by the runtime, or it is not recorded'));
    return Promise.resolve(this.store(r.runId, 'rubric', r));
  }

  recordDraft(r: DraftRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: a draft is collected by the runtime, or it is not recorded'));
    return Promise.resolve(this.store(r.runId, 'draft', r));
  }

  recordCriticResult(r: CriticRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: a critic result is collected by the runtime, or it is not recorded'));
    return Promise.resolve(this.store(r.runId, 'critic-result', r));
  }

  recordDraftLock(r: DraftLockRecord): Promise<VaultRef> {
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error('StubVault: a draft lock is collected by the runtime, or it is not recorded'));
    const key = `${r.runId}\0${r.station}`;
    if (this.draftLocks.has(key)) return Promise.reject(new Error(`StubVault: run ${r.runId} already locked a draft at ${r.station}; nothing was stored`));
    this.draftLocks.add(key);
    return Promise.resolve(this.store(r.runId, 'draft-lock', r));
  }

  readLocks(runId: RunId): Promise<LockManifest | null> {
    const manifest = this.locks.get(runId);
    return Promise.resolve(manifest === undefined ? null : structuredClone(manifest));
  }

  listRuns(): Promise<readonly RunId[]> {
    return Promise.resolve([...this.runs].sort());
  }

  readRunState(runId: RunId): Promise<RunState> {
    const state = this.states.get(runId);
    if (state === undefined) return Promise.reject(Object.assign(new Error(`StubVault: no run state for ${runId}`), { code: 'no-run-state' as const, runId }) satisfies NoRunState);
    // As the filesystem Vault reads a state committed before R19: no drafts, and grants that name none.
    const read = structuredClone(state) as Omit<RunState, 'drafts' | 'approvals'> & { drafts?: RunState['drafts']; approvals: ReadonlyArray<Omit<RunState['approvals'][number], 'draft'> & { draft?: RunState['approvals'][number]['draft'] }> };
    return Promise.resolve({ ...read, drafts: read.drafts ?? {}, approvals: read.approvals.map((g) => ({ ...g, draft: g.draft ?? null })) });
  }

  /**
   * `ifVersion` is authoritative and `s.version` is ignored; the contract
   * leaves which of the two wins to P1 (docs/decisions.md, D-S1).
   */
  commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
    const current = this.states.get(s.runId)?.version ?? '0';
    if (ifVersion !== current) {
      return Promise.reject(new Error(`StubVault: run ${s.runId} is at version ${current}, not ${ifVersion}; nothing stored`));
    }
    const stored = structuredClone({ ...s, version: String(Number(current) + 1) });
    this.states.set(s.runId, stored);
    this.runs.add(s.runId);
    return Promise.resolve(structuredClone(stored));
  }

  private store(
    runId: RunId,
    kind: 'evidence' | 'violation' | 'admission' | 'task-result' | 'usage' | 'decision' | 'integration' | 'base-run' | 'intent' | 'rubric' | 'draft' | 'critic-result' | 'draft-lock',
    record: EvidenceBundle | IntegrityViolation | AdmissionRecord | TaskResult | UsageRecord | EnforcementDecision | IntegrationRecord | BaseRunRecord
      | IntentRecord | RubricRecord | DraftRecord | CriticRecord | DraftLockRecord,
  ): VaultRef {
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const ref: VaultRef = { runId, kind, hash: sha256(bytes) };
    this.blobs.set(refKey(ref), bytes);
    this.runs.add(runId);
    return ref;
  }

  /** SHA-256 of the file's bytes under root, or undefined when there is no such file. */
  private async hashFile(path: string): Promise<string | undefined> {
    try {
      return sha256(await readFile(resolve(this.root, path)));
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }
}
