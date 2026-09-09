/**
 * StubDriver: the Driver contract with no model behind it. runTask returns
 * the canned claim the driver was constructed with, observes no events, and
 * emits no artifacts. There is no status field to fill and no place the stub
 * could report success (I2). It lives beside the contract it implements, so
 * the I9 terminal scan covers it. P5 replaces it.
 */
import type { ModelTier, TaskId } from '../../run/types.js';
import {
  DRIVER_CONTRACT_VERSION,
  type AgentClaim,
  type CompiledRole,
  type Driver,
  type DriverCapabilities,
  type DriverEvent,
  type ModelFamily,
  type ModelIdentity,
  type TaskRequest,
  type TaskResult,
} from '../contract.js';

export interface CannedResult {
  /** Default: `{ narrative: 'stub: no model was called', filesChanged: [] }`. */
  readonly claim: AgentClaim;
}

export class StubDriver implements Driver {
  readonly id = 'stub';
  readonly contractVersion = DRIVER_CONTRACT_VERSION;

  /**
   * Read structurally by the entry point in @olympus-ai/api; the conformance
   * fixture I5.stubs-declare-unsafe pins the shape.
   */
  readonly unsafe: { readonly component: 'StubDriver'; readonly cannotEnforce: readonly string[] } = {
    component: 'StubDriver',
    cannotEnforce: [
      'no model is called: every result is the canned claim, whatever the request says',
      'no event is observed: TaskResult.events is empty and handlers passed to on() never fire',
      'emitArtifacts writes nothing',
    ],
  };

  private readonly canned: CannedResult;

  constructor(canned: Partial<CannedResult> = {}) {
    this.canned = { claim: canned.claim ?? { narrative: 'stub: no model was called', filesChanged: [] } };
  }

  provenanceId(): string {
    return `stub-driver@${this.contractVersion}`;
  }

  capabilities(): DriverCapabilities {
    return { subagents: false, hooks: false, mcp: false, parallelism: 1, computerUse: false, steering: false, stablePrefixCaching: false };
  }

  /** Every tier resolves to the stub model; the family is assigned deliberately, never inferred (I6). */
  resolveModel(_tier: ModelTier): ModelIdentity {
    return { provider: 'stub', family: 'stub' as ModelFamily, model: 'stub', version: '0' };
  }

  runTask(req: TaskRequest): Promise<TaskResult> {
    const { narrative, filesChanged } = this.canned.claim;
    return Promise.resolve({
      taskId: req.taskId,
      claim: { narrative, filesChanged: [...filesChanged] },
      events: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, wallClockMs: 0 },
      model: this.resolveModel(req.tier),
      contractVersion: this.contractVersion,
    });
  }

  cancel(_taskId: TaskId): Promise<void> {
    return Promise.resolve();
  }

  emitArtifacts(_roles: CompiledRole[], _targetDir: string): Promise<void> {
    return Promise.resolve();
  }

  on(_kind: DriverEvent['kind'], _handler: (e: DriverEvent) => void): void {
    // Nothing is recorded and nothing ever fires; `unsafe` says so.
  }
}
