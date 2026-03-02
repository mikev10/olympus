import * as fs from 'fs-extra';
import { join } from 'path';
import type {
  InceptionStage,
  InceptionStageState,
  WorkflowCheckpointV3,
  PathwayType,
  WorkflowRoutingPlan,
} from '../phase-types.js';
import { loadCheckpoint, saveCheckpoint, invalidateCache } from '../checkpoint.js';
import { updateStateFile } from '../state-file.js';
import {
  appendToAudit,
  generateAuditDocument,
  renderAuditMarkdown,
  writeAuditArtifact,
} from '../audit-generator.js';
import type { AuditTimelineEntry } from '../audit-generator.js';
import { isStageIncluded } from '../workflow-routing.js';

export interface InceptionStageResult {
  stage: InceptionStage;
  status: 'completed' | 'awaiting_answers' | 'review_required' | 'skipped';
  requires_approval: boolean;
  artifacts_generated: string[];
  questions_file?: string;
  review_summary?: string;
  whats_next?: string;
  next_stage?: InceptionStage;
}

export interface InceptionProgress {
  total_stages: number;
  completed_stages: number;
  skipped_stages: number;
  current_stage: InceptionStage | null;
  stages: Record<InceptionStage, InceptionStageState>;
}

export type StageHandler = (
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
) => Promise<InceptionStageResult>;

const stageHandlers: Partial<Record<InceptionStage, StageHandler>> = {};

export function registerStageHandler(stage: InceptionStage, handler: StageHandler): void {
  stageHandlers[stage] = handler;
}

const INCEPTION_STAGE_ORDER: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'user-stories',
  'workflow-planning',
  'application-design',
  'units-generation',
];

function buildInitialStageState(
  stage: InceptionStage,
  status: 'not_started' | 'skipped',
  skipReason: string | null = null
): InceptionStageState {
  return {
    stage,
    status,
    started_at: null,
    completed_at: null,
    skip_reason: skipReason,
    artifacts_generated: [],
    questions_file: null,
    answers_received: false,
  };
}

function determineInitialStatus(
  stage: InceptionStage,
  pathwayType: PathwayType,
  plan: WorkflowRoutingPlan | null
): { status: 'not_started' | 'skipped'; skipReason: string | null } {
  if (plan && !isStageIncluded(plan, 'inception', stage)) {
    return { status: 'skipped', skipReason: 'Excluded by workflow routing plan' };
  }

  if (pathwayType === 'greenfield' && stage === 'reverse-engineering') {
    return { status: 'skipped', skipReason: 'Greenfield project — no existing codebase to reverse-engineer' };
  }

  if (
    (pathwayType === 'bugfix' || pathwayType === 'optimization') &&
    (stage === 'user-stories' || stage === 'application-design')
  ) {
    return {
      status: 'skipped',
      skipReason: `${pathwayType} pathway does not require ${stage}`,
    };
  }

  return { status: 'not_started', skipReason: null };
}

function firstPendingStage(
  stages: Record<InceptionStage, InceptionStageState>
): InceptionStage | null {
  for (const stage of INCEPTION_STAGE_ORDER) {
    const s = stages[stage];
    if (s && (s.status === 'not_started' || s.status === 'in_progress')) {
      return stage;
    }
  }
  return null;
}

function nextStageAfter(
  stage: InceptionStage,
  stages: Record<InceptionStage, InceptionStageState>
): InceptionStage | undefined {
  const idx = INCEPTION_STAGE_ORDER.indexOf(stage);
  for (let i = idx + 1; i < INCEPTION_STAGE_ORDER.length; i++) {
    const candidate = INCEPTION_STAGE_ORDER[i];
    const s = stages[candidate];
    if (s && (s.status === 'not_started' || s.status === 'in_progress')) {
      return candidate;
    }
  }
  return undefined;
}

async function readTrustLevel(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<number> {
  if (!checkpoint.trust_state_path) return 0;

  try {
    const trustPath = join(projectPath, 'aidlc-docs', workflowId, checkpoint.trust_state_path);
    const raw = await fs.readFile(trustPath, 'utf-8');
    const trustState = JSON.parse(raw);
    return trustState.current_level ?? 0;
  } catch {
    return 0;
  }
}

function computeRequiresApproval(
  stage: InceptionStage,
  result: InceptionStageResult,
  trustLevel: number
): boolean {
  const isAutomatedStage = stage === 'workspace-detection';
  const isQAStage = result.status === 'awaiting_answers';

  // Trust level 3: gate nothing
  if (trustLevel >= 3) return false;
  // Trust level 2: gate only Q&A stages (no code gen in inception)
  if (trustLevel >= 2 && !isQAStage) return false;
  // Trust level 1: automate workspace-detection only if not Q&A
  if (trustLevel >= 1 && isAutomatedStage && !isQAStage) return false;

  return true;
}

function allStagesTerminal(stages: Record<InceptionStage, InceptionStageState>): boolean {
  return INCEPTION_STAGE_ORDER.every((stage) => {
    const s = stages[stage];
    return s && (s.status === 'completed' || s.status === 'skipped');
  });
}

function isDiscoveryComplete(checkpoint: WorkflowCheckpointV3): boolean {
  const discoveryPhase = checkpoint.phases?.discovery;
  if (!discoveryPhase) return false;
  const status = (discoveryPhase as { status?: string }).status;
  return status === 'complete' || status === 'completed';
}

function buildCompletedStageState(stage: InceptionStage, skipReason: string | null = null): InceptionStageState {
  const isSkipped = skipReason !== null;
  const now = new Date().toISOString();
  return {
    stage,
    status: isSkipped ? 'skipped' : 'completed',
    started_at: isSkipped ? null : now,
    completed_at: now,
    skip_reason: skipReason,
    artifacts_generated: [],
    questions_file: null,
    answers_received: false,
  };
}

export class InceptionOrchestrator {
  /**
   * Migrates a legacy checkpoint that lacks `inception_stages`.
   *
   * Case 1 — Already past inception (current_stage !== 'intent'):
   *   Mark all inception stages as completed retroactively and clear
   *   current_inception_stage so the workflow resumes normally.
   *
   * Case 2 — Paused at intent (current_stage === 'intent'):
   *   Initialize inception_stages, auto-complete workspace-detection and
   *   (if discovery is done) reverse-engineering, then set
   *   current_inception_stage to requirements-analysis.
   *
   * If inception_stages already exists, the method is a no-op (idempotent).
   */
  async migrateCheckpoint(
    projectPath: string,
    workflowId: string
  ): Promise<{ migrated: boolean; case: 'already_past_inception' | 'paused_at_intent' | 'no_migration_needed' }> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) {
      throw new Error(`[InceptionOrchestrator] Checkpoint not found for workflow ${workflowId}`);
    }

    if (checkpoint.inception_stages) {
      return { migrated: false, case: 'no_migration_needed' };
    }

    const pathwayType = checkpoint.pathway_type ?? 'brownfield-enhancement';

    if (checkpoint.current_stage !== 'intent') {
      // Case 1: Workflow is already past the inception phase.
      // Retroactively mark all inception stages as completed (or skipped for stages
      // that would have been skipped given the pathway type).
      const inception_stages = {} as Record<InceptionStage, InceptionStageState>;
      for (const stage of INCEPTION_STAGE_ORDER) {
        const { skipReason } = determineInitialStatus(stage, pathwayType, null);
        inception_stages[stage] = buildCompletedStageState(stage, skipReason);
      }

      checkpoint.inception_stages = inception_stages;
      checkpoint.current_inception_stage = undefined;

      await saveCheckpoint(projectPath, checkpoint);
      invalidateCache(projectPath, workflowId);

      return { migrated: true, case: 'already_past_inception' };
    }

    // Case 2: Workflow is paused at the 'intent' stage (beginning of inception).
    // Initialize stages, auto-complete workspace-detection and optionally
    // reverse-engineering (if discovery is already done), then begin from
    // requirements-analysis.
    const inception_stages = {} as Record<InceptionStage, InceptionStageState>;
    for (const stage of INCEPTION_STAGE_ORDER) {
      const { status, skipReason } = determineInitialStatus(stage, pathwayType, null);
      inception_stages[stage] = buildInitialStageState(stage, status, skipReason);
    }

    // Auto-complete workspace-detection from existing pathway_type
    if (inception_stages['workspace-detection'].status !== 'skipped') {
      inception_stages['workspace-detection'] = buildCompletedStageState('workspace-detection');
    }

    // Auto-complete reverse-engineering if discovery phase is done
    if (
      inception_stages['reverse-engineering'].status !== 'skipped' &&
      isDiscoveryComplete(checkpoint)
    ) {
      inception_stages['reverse-engineering'] = buildCompletedStageState('reverse-engineering');
    }

    checkpoint.inception_stages = inception_stages;

    const firstPending = firstPendingStage(inception_stages);
    checkpoint.current_inception_stage = firstPending ?? undefined;

    await saveCheckpoint(projectPath, checkpoint);
    invalidateCache(projectPath, workflowId);

    return { migrated: true, case: 'paused_at_intent' };
  }

  async initialize(
    projectPath: string,
    workflowId: string,
    pathwayType: PathwayType,
    plan: WorkflowRoutingPlan | null
  ): Promise<void> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) {
      throw new Error(`[InceptionOrchestrator] Checkpoint not found for workflow ${workflowId}`);
    }

    if (checkpoint.inception_stages) return; // idempotent

    const inception_stages = {} as Record<InceptionStage, InceptionStageState>;
    let firstNonSkipped: InceptionStage | undefined;

    for (const stage of INCEPTION_STAGE_ORDER) {
      const { status, skipReason } = determineInitialStatus(stage, pathwayType, plan);
      inception_stages[stage] = buildInitialStageState(stage, status, skipReason);
      if (!firstNonSkipped && status === 'not_started') {
        firstNonSkipped = stage;
      }
    }

    checkpoint.inception_stages = inception_stages;
    checkpoint.current_inception_stage = firstNonSkipped ?? undefined;

    await saveCheckpoint(projectPath, checkpoint);
    invalidateCache(projectPath, workflowId);
  }

  async executeNextStage(
    projectPath: string,
    workflowId: string
  ): Promise<InceptionStageResult> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) {
      throw new Error(`[InceptionOrchestrator] Checkpoint not found for workflow ${workflowId}`);
    }

    const stages = checkpoint.inception_stages;
    if (!stages) {
      throw new Error(
        `[InceptionOrchestrator] inception_stages not initialized for workflow ${workflowId}. Call initialize() first.`
      );
    }

    const stage = firstPendingStage(stages);

    if (!stage) {
      return {
        stage: 'units-generation', // last stage as sentinel — no pending stage exists
        status: 'completed',
        requires_approval: false,
        artifacts_generated: [],
        whats_next: 'Inception is complete. Proceed to construction phase.',
      };
    }

    stages[stage].status = 'in_progress';
    stages[stage].started_at = new Date().toISOString();
    checkpoint.current_inception_stage = stage;
    await saveCheckpoint(projectPath, checkpoint);
    invalidateCache(projectPath, workflowId);

    const handler = stageHandlers[stage];
    let result: InceptionStageResult;

    if (handler) {
      try {
        result = await handler(projectPath, workflowId, checkpoint);
      } catch (error) {
        const err = error as Error;
        console.error(`[InceptionOrchestrator] Stage '${stage}' handler threw:`, err.message);

        const cp2 = await loadCheckpoint(projectPath, workflowId);
        if (cp2?.inception_stages) {
          cp2.inception_stages[stage].status = 'not_started';
          cp2.inception_stages[stage].started_at = null;
          await saveCheckpoint(projectPath, cp2);
          invalidateCache(projectPath, workflowId);
        }

        return {
          stage,
          status: 'review_required',
          requires_approval: true,
          artifacts_generated: [],
          review_summary: `Stage '${stage}' failed with error: ${err.message}`,
        };
      }
    } else {
      result = {
        stage,
        status: 'completed',
        requires_approval: true,
        artifacts_generated: [],
        review_summary: `Stage '${stage}' has no handler registered yet.`,
        whats_next: 'This stage will be implemented in a future TODO.',
      };
    }

    await this._postStage(projectPath, workflowId, stage, result);
    return result;
  }

  async processAnswers(
    projectPath: string,
    workflowId: string,
    stage: InceptionStage
  ): Promise<InceptionStageResult> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) {
      throw new Error(`[InceptionOrchestrator] Checkpoint not found for workflow ${workflowId}`);
    }

    const stages = checkpoint.inception_stages;
    if (!stages) {
      throw new Error(
        `[InceptionOrchestrator] inception_stages not initialized for workflow ${workflowId}`
      );
    }

    const stageState = stages[stage];
    if (!stageState || stageState.status !== 'in_progress') {
      throw new Error(
        `[InceptionOrchestrator] Stage '${stage}' is not in_progress (status: ${stageState?.status ?? 'unknown'})`
      );
    }

    const handler = stageHandlers[stage];
    let result: InceptionStageResult;

    if (handler) {
      try {
        result = await handler(projectPath, workflowId, checkpoint);
      } catch (error) {
        const err = error as Error;
        console.error(`[InceptionOrchestrator] processAnswers for '${stage}' threw:`, err.message);
        return {
          stage,
          status: 'review_required',
          requires_approval: true,
          artifacts_generated: [],
          review_summary: `Stage '${stage}' answer processing failed: ${err.message}`,
        };
      }
    } else {
      result = {
        stage,
        status: 'completed',
        requires_approval: true,
        artifacts_generated: [],
        review_summary: `Stage '${stage}' has no handler registered yet.`,
        whats_next: 'This stage will be implemented in a future TODO.',
      };
    }

    await this._postStage(projectPath, workflowId, stage, result);
    return result;
  }

  async getProgress(
    projectPath: string,
    workflowId: string
  ): Promise<InceptionProgress> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) {
      throw new Error(`[InceptionOrchestrator] Checkpoint not found for workflow ${workflowId}`);
    }

    const stages = checkpoint.inception_stages ?? ({} as Record<InceptionStage, InceptionStageState>);
    const total_stages = INCEPTION_STAGE_ORDER.length;

    let completed_stages = 0;
    let skipped_stages = 0;

    for (const stage of INCEPTION_STAGE_ORDER) {
      const s = stages[stage];
      if (!s) continue;
      if (s.status === 'completed') completed_stages++;
      if (s.status === 'skipped') skipped_stages++;
    }

    return {
      total_stages,
      completed_stages,
      skipped_stages,
      current_stage: checkpoint.current_inception_stage ?? null,
      stages,
    };
  }

  async isComplete(projectPath: string, workflowId: string): Promise<boolean> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint?.inception_stages) return false;
    return allStagesTerminal(checkpoint.inception_stages);
  }

  private async _postStage(
    projectPath: string,
    workflowId: string,
    stage: InceptionStage,
    result: InceptionStageResult
  ): Promise<void> {
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint?.inception_stages) return;

    const stages = checkpoint.inception_stages;
    const now = new Date().toISOString();

    if (result.status === 'completed') {
      stages[stage].status = 'completed';
      stages[stage].completed_at = now;
      stages[stage].artifacts_generated = result.artifacts_generated;
    } else if (result.status === 'awaiting_answers') {
      stages[stage].status = 'in_progress';
      stages[stage].questions_file = result.questions_file ?? null;
    } else if (result.status === 'skipped') {
      stages[stage].status = 'skipped';
      stages[stage].completed_at = now;
    }

    const isTerminal = result.status === 'completed' || result.status === 'skipped';
    if (isTerminal) {
      checkpoint.current_inception_stage = nextStageAfter(stage, stages);
    }

    await saveCheckpoint(projectPath, checkpoint);
    invalidateCache(projectPath, workflowId);

    try {
      if (result.status === 'completed') {
        updateStateFile(projectPath, workflowId, stage, 'completed');
      } else if (result.status === 'awaiting_answers') {
        updateStateFile(projectPath, workflowId, stage, 'in_progress');
      } else if (result.status === 'skipped') {
        updateStateFile(projectPath, workflowId, stage, 'skipped');
      }
    } catch (error) {
      console.error(`[InceptionOrchestrator] Failed to update state file for stage ${stage}:`, (error as Error).message);
    }

    try {
      const auditEntry: AuditTimelineEntry = {
        timestamp: now,
        phase: 'inception',
        action: `Stage '${stage}' ${result.status}`,
        actor: 'ai',
        reason: result.review_summary ?? null,
      };
      appendToAudit(projectPath, workflowId, auditEntry);
    } catch (error) {
      console.error(`[InceptionOrchestrator] Failed to append to audit for stage ${stage}:`, (error as Error).message);
    }

    if (allStagesTerminal(stages)) {
      try {
        const auditDoc = generateAuditDocument(projectPath, workflowId);
        renderAuditMarkdown(auditDoc);
        await writeAuditArtifact(projectPath, workflowId, auditDoc);
      } catch (error) {
        console.error(`[InceptionOrchestrator] Failed to generate final audit document:`, (error as Error).message);
      }
    }

    try {
      const trustLevel = await readTrustLevel(projectPath, workflowId, checkpoint);
      result.requires_approval = computeRequiresApproval(stage, result, trustLevel);
    } catch (error) {
      console.error(`[InceptionOrchestrator] Failed to compute trust level:`, (error as Error).message);
      result.requires_approval = true;
    }

    const freshCheckpoint = await loadCheckpoint(projectPath, workflowId);
    if (freshCheckpoint?.current_inception_stage) {
      result.next_stage = freshCheckpoint.current_inception_stage;
    }
  }
}
