/**
 * Delegating wrappers for the line tests. Each forwards every contract
 * method to the component it wraps and carries no `unsafe` declaration of
 * its own, so a test can observe or interfere with one call without
 * changing what the stub is. Test code only; nothing in src knows them.
 */
import type {
  CompiledRole,
  Driver,
  DriverCapabilities,
  DriverEvent,
  ModelIdentity,
  ModelTier,
  RunId,
  RunState,
  StationId,
  TaskId,
  TaskRequest,
  TaskResult,
  VaultRef,
} from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type { ExecOptions, ExecResult, SandboxCapabilities, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { AdmissionRecord, EvidenceBundle, LockManifest, LockVerdict, Vault } from '@olympus-ai/vault';

export class DelegatingVault implements Vault {
  protected readonly inner: Vault;

  constructor(inner: Vault) {
    this.inner = inner;
  }

  read(ref: VaultRef): Promise<Uint8Array> {
    return this.inner.read(ref);
  }

  lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest> {
    return this.inner.lock(runId, paths, by);
  }

  verifyLocks(runId: RunId): Promise<LockVerdict> {
    return this.inner.verifyLocks(runId);
  }

  writeEvidence(b: EvidenceBundle): Promise<VaultRef> {
    return this.inner.writeEvidence(b);
  }

  recordViolation(v: IntegrityViolation): Promise<VaultRef> {
    return this.inner.recordViolation(v);
  }

  recordAdmission(a: AdmissionRecord): Promise<VaultRef> {
    return this.inner.recordAdmission(a);
  }

  recordTaskResult(runId: RunId, r: TaskResult): Promise<VaultRef> {
    return this.inner.recordTaskResult(runId, r);
  }

  readRunState(runId: RunId): Promise<RunState> {
    return this.inner.readRunState(runId);
  }

  commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
    return this.inner.commitRunState(s, ifVersion);
  }
}

export class DelegatingSandbox implements SandboxProvider {
  readonly id: string;
  protected readonly inner: SandboxProvider;

  constructor(inner: SandboxProvider) {
    this.inner = inner;
    this.id = inner.id;
  }

  provision(spec: SandboxSpec): Promise<SandboxHandle> {
    return this.inner.provision(spec);
  }

  exec(h: SandboxHandle, cmd: string[], options?: ExecOptions): Promise<ExecResult> {
    return this.inner.exec(h, cmd, options);
  }

  destroy(h: SandboxHandle): Promise<void> {
    return this.inner.destroy(h);
  }

  capabilities(): SandboxCapabilities {
    return this.inner.capabilities();
  }
}

export class DelegatingDriver implements Driver {
  readonly id: string;
  readonly contractVersion: string;
  protected readonly inner: Driver;

  constructor(inner: Driver) {
    this.inner = inner;
    this.id = inner.id;
    this.contractVersion = inner.contractVersion;
  }

  provenanceId(): string {
    return this.inner.provenanceId();
  }

  capabilities(): DriverCapabilities {
    return this.inner.capabilities();
  }

  declaredTools(): readonly string[] {
    return this.inner.declaredTools();
  }

  resolveModel(tier: ModelTier): ModelIdentity {
    return this.inner.resolveModel(tier);
  }

  runTask(req: TaskRequest): Promise<TaskResult> {
    return this.inner.runTask(req);
  }

  cancel(taskId: TaskId): Promise<void> {
    return this.inner.cancel(taskId);
  }

  emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void> {
    return this.inner.emitArtifacts(roles, targetDir);
  }

  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void {
    this.inner.on(kind, handler);
  }
}
