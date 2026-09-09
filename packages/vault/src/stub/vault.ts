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
import type { RunId, RunState, StationId, VaultRef } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type { EvidenceBundle, LockEntry, LockManifest, LockVerdict, Vault } from '../types.js';

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

  /** `root` is what locked paths resolve against (S1 finding 4d; P1 decides where the base belongs). */
  constructor(root: string) {
    this.root = root;
  }

  read(ref: VaultRef): Promise<Uint8Array> {
    const bytes = this.blobs.get(refKey(ref));
    if (bytes === undefined) return Promise.reject(new Error(`StubVault: no ${ref.kind} ${ref.hash} for run ${ref.runId}`));
    return Promise.resolve(new Uint8Array(bytes));
  }

  async lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest> {
    if (paths.length === 0) {
      throw new Error(`StubVault: refusing to lock nothing for run ${runId}; an empty manifest would verify as intact`);
    }
    const lockedAt = new Date().toISOString();
    const entries: LockEntry[] = [];
    for (const path of paths) {
      const hash = await this.hashFile(path);
      if (hash === undefined) throw new Error(`StubVault: cannot lock ${path} for run ${runId}: no such file under ${this.root}`);
      entries.push({ path, sha256: hash, lockedAt, lockedBy: by });
    }
    const manifest: LockManifest = { runId, entries };
    this.locks.set(runId, manifest);
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

  readRunState(runId: RunId): Promise<RunState> {
    const state = this.states.get(runId);
    if (state === undefined) return Promise.reject(new Error(`StubVault: no run state for ${runId}`));
    return Promise.resolve(structuredClone(state));
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
    return Promise.resolve(structuredClone(stored));
  }

  private store(runId: RunId, kind: 'evidence' | 'violation', record: EvidenceBundle | IntegrityViolation): VaultRef {
    const bytes = new TextEncoder().encode(JSON.stringify(record));
    const ref: VaultRef = { runId, kind, hash: sha256(bytes) };
    this.blobs.set(refKey(ref), bytes);
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
