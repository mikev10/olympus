/**
 * The driver contract: what every model runner (Claude Code, Codex, ...) must
 * implement, and the only shape through which a model's output re-enters the
 * runtime.
 */
import type { SandboxHandle } from '@olympus-ai/sandbox';
import type { ModelTier, RoleId, TaskId } from '../run/types.js';

export const DRIVER_CONTRACT_VERSION = '1.0.0';

/**
 * I6: reviewers never share the author's model family. Branded so a driver
 * must assign it deliberately; a driver id, provider string, or model name
 * cannot be passed as a family by accident.
 */
export type ModelFamily = string & { readonly __brand: 'ModelFamily' };

export interface ModelIdentity {
  provider: string;
  family: ModelFamily; // explicit. NEVER inferred from driver id - I6 depends on this
  model: string;
  version: string;
}

/**
 * I8: every `true` here is a capability claim. The conformance suite
 * (packages/conformance) must hold an executable assertion per capability
 * that fails when that capability is removed.
 */
export interface DriverCapabilities {
  subagents: boolean;
  hooks: boolean;
  mcp: boolean;
  parallelism: number;
  computerUse: boolean;
  steering: boolean;          // supports steer()
  stablePrefixCaching: boolean;
}

export type DriverCapability = keyof DriverCapabilities;

/** Context is split so invariant material forms a cacheable prefix. */
export interface TaskRequest {
  taskId: TaskId;
  role: RoleId;
  stablePrefix: string;       // spec, rubric, conventions - identical across a run
  variableSuffix: string;     // this task only
  tier: ModelTier;
  tools: string[];            // policy-granted; default deny (I4)
  sandbox: SandboxHandle;
  timeoutMs: number;
  budget: Budget;
}

export interface Budget { maxTokens: number; maxCostUsd: number; maxWallClockMs: number; }

/** Read-only once collected: what the model said is recorded, never edited. */
export interface AgentClaim {
  readonly narrative: string;          // what the model says it did - a CLAIM, not evidence
  readonly filesChanged: readonly string[];
}

/**
 * I2: there is deliberately NO status field. The runtime computes status from
 * CheckResult exit codes (integrity/types.ts). A model cannot report success.
 * Read-only: the runtime records a result; nothing holding one rewrites it.
 */
export interface TaskResult {
  readonly taskId: TaskId;
  readonly claim: AgentClaim;
  readonly events: readonly DriverEvent[];
  readonly usage: Usage;
  readonly model: ModelIdentity;
  readonly contractVersion: string;
}

export interface DriverEvent {
  at: string;
  kind: 'command' | 'file-write' | 'tool-call' | 'network' | 'subagent';
  detail: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number; outputTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number;   // cache-hit metric
  costUsd: number; wallClockMs: number;
}

/**
 * A role in driver-neutral compiled form: what a driver renders into its native
 * artifact format (agent definitions, instructions, hooks) via emitArtifacts().
 *
 * The contract spec references this type without defining it. The compiler
 * package (M2) will produce it; it is declared here because drivers consume it,
 * so the compiler depends on core and not the reverse. Capability grants
 * (tools, network, writable paths) are deliberately absent: they arrive from
 * policy through TaskRequest, so there is exactly one source of truth for what
 * a role may do (I4). The compiler unit may add fields; additions are
 * non-breaking.
 */
export interface CompiledRole {
  role: RoleId;
  instructions: string;
}

export interface Driver {
  readonly id: string;
  readonly contractVersion: string;
  provenanceId(): string;                       // stamped onto every evidence artifact
  capabilities(): DriverCapabilities;
  resolveModel(tier: ModelTier): ModelIdentity;
  runTask(req: TaskRequest): Promise<TaskResult>;
  spawnSubagent?(role: RoleId, req: TaskRequest): Promise<TaskResult>;
  steer?(taskId: TaskId, message: string): Promise<void>;   // runtime-only; never a human channel
  cancel(taskId: TaskId): Promise<void>;
  emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void>;
  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void;
}
