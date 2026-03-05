import { join } from 'path';
import * as fs from 'fs-extra';
import { detectBrownfield } from '../../discovery.js';
import { detectPathway } from '../../workflow-routing.js';
import { loadCheckpoint, saveCheckpoint, invalidateCache } from '../../checkpoint.js';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3, PathwayType } from '../../phase-types.js';

function getSkippedStagesForPathway(
  pathwayType: PathwayType
): Array<{ stage: string; reason: string }> {
  const skips: Array<{ stage: string; reason: string }> = [];

  if (pathwayType === 'greenfield') {
    skips.push({
      stage: 'reverse-engineering',
      reason: 'Greenfield project — no existing codebase to reverse-engineer',
    });
  }

  if (pathwayType === 'bugfix' || pathwayType === 'optimization') {
    skips.push(
      {
        stage: 'user-stories',
        reason: `${pathwayType} pathway does not require user-stories`,
      },
      {
        stage: 'application-design',
        reason: `${pathwayType} pathway does not require application-design`,
      }
    );
  }

  return skips;
}

export async function executeWorkspaceDetection(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const { isBrownfield, sourceFileCount } = await detectBrownfield(projectPath);

  let pathwayType: PathwayType;

  if (checkpoint.pathway_type) {
    pathwayType = checkpoint.pathway_type;
  } else {
    const intentPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'intent.md');
    const intentExists = await fs.pathExists(intentPath);

    if (intentExists) {
      try {
        const intentText = await fs.readFile(intentPath, 'utf-8');
        pathwayType = await detectPathway(projectPath, intentText);
      } catch {
        pathwayType = isBrownfield ? 'brownfield-enhancement' : 'greenfield';
      }
    } else {
      pathwayType = isBrownfield ? 'brownfield-enhancement' : 'greenfield';
    }
  }

  const freshCheckpoint = await loadCheckpoint(projectPath, workflowId);
  if (freshCheckpoint) {
    freshCheckpoint.pathway_type = pathwayType;

    if (freshCheckpoint.inception_stages) {
      const stagesToSkip = getSkippedStagesForPathway(pathwayType);
      for (const { stage, reason } of stagesToSkip) {
        const stageKey = stage as keyof typeof freshCheckpoint.inception_stages;
        const stageState = freshCheckpoint.inception_stages[stageKey];
        if (stageState && stageState.status === 'not_started') {
          stageState.status = 'skipped';
          stageState.skip_reason = reason;
          stageState.completed_at = new Date().toISOString();
        }
      }
    }

    await saveCheckpoint(projectPath, freshCheckpoint);
    invalidateCache(projectPath, workflowId);

    if (freshCheckpoint.origin === 'hook-init') {
      freshCheckpoint.origin = 'ai-initialized';
      await saveCheckpoint(projectPath, freshCheckpoint);
      invalidateCache(projectPath, workflowId);
    }
  }

  const detectionMethod = checkpoint.pathway_type
    ? 'preserved from existing checkpoint'
    : 'auto-detected';

  const reviewSummary = [
    `Workspace detection complete.`,
    `Source files found: ${sourceFileCount}`,
    `Project type: ${isBrownfield ? 'brownfield' : 'greenfield'} (${sourceFileCount} source file${sourceFileCount === 1 ? '' : 's'})`,
    `Pathway type: ${pathwayType} (${detectionMethod})`,
  ].join('\n');

  const skipped = getSkippedStagesForPathway(pathwayType);
  const whatsNext =
    skipped.length > 0
      ? `Next stage will begin. Skipping: ${skipped.map((s) => s.stage).join(', ')} due to ${pathwayType} pathway.`
      : 'Next stage: reverse-engineering.';

  return {
    stage: 'workspace-detection',
    status: 'completed',
    requires_approval: true,
    artifacts_generated: [],
    review_summary: reviewSummary,
    whats_next: whatsNext,
  };
}

registerStageHandler('workspace-detection', executeWorkspaceDetection);
