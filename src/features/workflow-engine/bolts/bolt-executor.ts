import type {
  BoltSpec,
  BoltStatus,
  BoltExecutionStage,
  BoltStageProgress,
  WorkflowCheckpointV3,
} from '../phase-types.js';
import { saveCheckpoint } from '../checkpoint.js';

export interface StageResult {
  success: boolean;
  artifact_path?: string;
  error?: string;
}

export interface StageHandlers {
  onElaboration: (bolt: BoltSpec, projectPath: string) => Promise<StageResult>;
  onCodeGeneration: (bolt: BoltSpec, projectPath: string) => Promise<StageResult>;
  onBuildAndTest: (bolt: BoltSpec, projectPath: string, targetFiles: string[]) => Promise<StageResult>;
  onReview: (bolt: BoltSpec, projectPath: string) => Promise<StageResult>;
}

export interface BoltExecutionResult {
  status: BoltStatus;
  stages: Record<BoltExecutionStage, BoltStageProgress>;
}

const STAGE_ORDER: BoltExecutionStage[] = [
  'elaboration',
  'code_generation',
  'build_and_test',
  'review',
];

const HANDLER_MAP: Record<BoltExecutionStage, keyof StageHandlers> = {
  elaboration: 'onElaboration',
  code_generation: 'onCodeGeneration',
  build_and_test: 'onBuildAndTest',
  review: 'onReview',
};

// Bolt-level status transitions triggered after specific stages complete (BR-003)
const STATUS_AFTER_STAGE: Partial<Record<BoltExecutionStage, BoltStatus>> = {
  build_and_test: 'built',
  review: 'done',
};

async function callHandler(
  handlers: StageHandlers,
  stage: BoltExecutionStage,
  bolt: BoltSpec,
  projectPath: string,
): Promise<StageResult> {
  const handlerKey = HANDLER_MAP[stage];
  if (stage === 'build_and_test') {
    return handlers.onBuildAndTest(bolt, projectPath, bolt.target_files ?? []);
  }
  return (handlers[handlerKey] as (bolt: BoltSpec, projectPath: string) => Promise<StageResult>)(
    bolt,
    projectPath,
  );
}

/**
 * Executes the 4-stage pipeline for a single bolt.
 *
 * The caller must ensure `checkpoint.construction_bolts[boltSpec.id]` exists
 * before calling this function (via `registerBoltsInCheckpoint`).
 *
 * @returns The final execution result with bolt status and per-stage progress.
 */
export async function execute(
  boltSpec: BoltSpec,
  checkpoint: WorkflowCheckpointV3,
  projectPath: string,
  workflowId: string,
  handlers: StageHandlers,
): Promise<BoltExecutionResult> {
  const boltProgress = checkpoint.construction_bolts![boltSpec.id];

  checkpoint.active_bolt_id = boltSpec.id;
  boltProgress.status = 'in_progress';
  await saveCheckpoint(projectPath, checkpoint);

  for (const stage of STAGE_ORDER) {
    const stageProgress = boltProgress.stages[stage];

    // Express mode: skip elaboration (BR-002, BR-009)
    if (boltSpec.express_mode && stage === 'elaboration') {
      stageProgress.status = 'skipped';
      stageProgress.completed_at = new Date().toISOString();
      await saveCheckpoint(projectPath, checkpoint);
      continue;
    }

    // Transition to in_review at review start (BR-003)
    if (stage === 'review') {
      boltProgress.status = 'in_review';
      await saveCheckpoint(projectPath, checkpoint);
    }

    checkpoint.active_bolt_stage = stage;
    stageProgress.status = 'in_progress';
    stageProgress.started_at = new Date().toISOString();
    await saveCheckpoint(projectPath, checkpoint);

    const result = await callHandler(handlers, stage, boltSpec, projectPath);

    if (result.success) {
      stageProgress.status = 'completed';
      stageProgress.completed_at = new Date().toISOString();
      if (result.artifact_path) {
        stageProgress.artifact_path = result.artifact_path;
      }

      const nextStatus = STATUS_AFTER_STAGE[stage];
      if (nextStatus) {
        boltProgress.status = nextStatus;
      }

      await saveCheckpoint(projectPath, checkpoint);
    } else {
      stageProgress.failure_count += 1;
      stageProgress.last_error = result.error ?? 'Unknown error';
      boltProgress.failure_count += 1;
      boltProgress.last_error = stageProgress.last_error;

      if (stageProgress.failure_count >= 2) {
        stageProgress.status = 'failed';
        boltProgress.status = 'failed';
        await saveCheckpoint(projectPath, checkpoint);
        break;
      }

      // First failure: revert to not_started so caller can retry
      stageProgress.status = 'not_started';
      await saveCheckpoint(projectPath, checkpoint);
      break;
    }
  }

  checkpoint.active_bolt_id = null;
  checkpoint.active_bolt_stage = null;
  await saveCheckpoint(projectPath, checkpoint);

  return {
    status: boltProgress.status,
    stages: { ...boltProgress.stages },
  };
}

export const BoltExecutor = { execute };
