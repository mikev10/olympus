import * as path from 'path';
import * as fs from 'fs-extra';
import { appendToAudit } from './audit-generator.js';
import type { AuditTimelineEntry } from './audit-generator.js';
import type { WorkflowCheckpointV3, WorkflowPhase } from './phase-types.js';

export type ChangeType =
  | 'add_skipped_phase'
  | 'skip_planned_phase'
  | 'restart_current_stage'
  | 'restart_previous_stage'
  | 'change_depth'
  | 'pause_workflow'
  | 'change_architecture'
  | 'add_remove_units';

export interface ChangeRequest {
  type: ChangeType;
  description: string;
  requestedBy: string;
  timestamp: string;
  targetPhase?: WorkflowPhase;
  targetStage?: string;
  newDepth?: string;
}

export interface ChangeImpact {
  changeType: ChangeType;
  affectedStages: string[];
  affectedArtifacts: string[];
  cascadeRequired: boolean;
  cascadeDescription: string;
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
}

export interface WorkflowState {
  checkpoint: WorkflowCheckpointV3;
  completedStages: string[];
  currentStage: string;
}

export function assessChangeImpact(changeType: ChangeType, currentState: WorkflowState): ChangeImpact {
  const { completedStages, currentStage } = currentState;

  switch (changeType) {
    case 'add_skipped_phase': {
      const skippedPhases = currentState.checkpoint.skipped_phases ?? [];
      const affectedStages = skippedPhases.map((p) => p as string);
      return {
        changeType,
        affectedStages,
        affectedArtifacts: ['phase-artifacts', 'manifest'],
        cascadeRequired: false,
        cascadeDescription: 'Downstream artifacts should be verified for compatibility after phase insertion',
        riskLevel: 'medium',
        recommendation: 'Execute the added phase, then verify downstream artifacts still valid',
      };
    }

    case 'skip_planned_phase': {
      const affectedStages = [...completedStages, currentStage];
      return {
        changeType,
        affectedStages,
        affectedArtifacts: ['phase-artifacts', 'manifest', 'gate-audit'],
        cascadeRequired: true,
        cascadeDescription: 'Downstream stages may depend on outputs from the skipped phase',
        riskLevel: 'high',
        recommendation: 'Verify no downstream stages depend on outputs from the skipped phase',
      };
    }

    case 'restart_current_stage': {
      return {
        changeType,
        affectedStages: [currentStage],
        affectedArtifacts: [`${currentStage}-artifacts`],
        cascadeRequired: false,
        cascadeDescription: 'Only the current stage is affected; no downstream cascade needed',
        riskLevel: 'low',
        recommendation: 'Archive current artifacts, re-execute stage',
      };
    }

    case 'restart_previous_stage': {
      const targetStage = currentState.checkpoint.current_stage as string;
      const targetIndex = completedStages.indexOf(targetStage);
      const affectedStages = targetIndex >= 0
        ? [...completedStages.slice(targetIndex), currentStage]
        : [targetStage, currentStage];
      return {
        changeType,
        affectedStages,
        affectedArtifacts: affectedStages.map((s) => `${s}-artifacts`),
        cascadeRequired: true,
        cascadeDescription: 'All stages from target through current stage must be re-executed',
        riskLevel: 'high',
        recommendation: 'Archive ALL affected artifacts, re-execute from target stage through current',
      };
    }

    case 'change_depth': {
      const affectedStages = [currentStage];
      return {
        changeType,
        affectedStages,
        affectedArtifacts: ['depth-assessment', 'remaining-stage-artifacts'],
        cascadeRequired: false,
        cascadeDescription: 'Depth change affects approach for remaining stages only',
        riskLevel: 'medium',
        recommendation: 'Update depth level, adjust approach for remaining stages',
      };
    }

    case 'pause_workflow': {
      return {
        changeType,
        affectedStages: [],
        affectedArtifacts: ['checkpoint'],
        cascadeRequired: false,
        cascadeDescription: 'No cascade required; workflow state is preserved at pause point',
        riskLevel: 'low',
        recommendation: 'Complete current step, save state, pause',
      };
    }

    case 'change_architecture': {
      const constructionStages = [...completedStages, currentStage].filter(
        (s) => s === 'unit' || s === 'code-generation' || s === 'intent'
      );
      return {
        changeType,
        affectedStages: constructionStages,
        affectedArtifacts: constructionStages.map((s) => `${s}-artifacts`).concat(['manifest', 'alignment-checks']),
        cascadeRequired: true,
        cascadeDescription: 'Architecture change cascades through all construction-phase artifacts',
        riskLevel: 'high',
        recommendation: 'Assess progress impact, may need to restart from design stages',
      };
    }

    case 'add_remove_units': {
      return {
        changeType,
        affectedStages: ['unit', 'code-generation'],
        affectedArtifacts: ['unit-of-work', 'unit-artifacts', 'code-generation-artifacts'],
        cascadeRequired: true,
        cascadeDescription: 'Adding or removing units cascades to all dependent code generation stages',
        riskLevel: 'medium',
        recommendation: 'Update unit-of-work.md, reset affected units',
      };
    }

    default: {
      return {
        changeType,
        affectedStages: [],
        affectedArtifacts: [],
        cascadeRequired: false,
        cascadeDescription: 'Unknown change type — no impact assessed',
        riskLevel: 'low',
        recommendation: 'Review change type and assess manually',
      };
    }
  }
}

export async function archiveArtifacts(
  projectPath: string,
  workflowId: string,
  affectedStages: string[]
): Promise<string[]> {
  const archived: string[] = [];
  const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
  const timestamp = Date.now();

  try {
    for (const stage of affectedStages) {
      const stageDir = path.join(workflowDir, stage);
      const stageDirExists = await fs.pathExists(stageDir);

      if (!stageDirExists) {
        // Also check for flat files named after the stage directly in the workflow dir
        const stageFile = path.join(workflowDir, `${stage}.md`);
        const stageFileExists = await fs.pathExists(stageFile);
        if (!stageFileExists) continue;

        const backupPath = `${stageFile}.backup.${timestamp}`;
        await fs.copy(stageFile, backupPath);
        archived.push(backupPath);
        continue;
      }

      let files: string[] = [];
      try {
        files = await fs.readdir(stageDir);
      } catch {
        continue;
      }

      for (const file of files) {
        // Skip files that are already backups
        if (file.includes('.backup.')) continue;

        const filePath = path.join(stageDir, file);
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) continue;

        const backupPath = `${filePath}.backup.${timestamp}`;
        await fs.copy(filePath, backupPath);
        archived.push(backupPath);
      }
    }
  } catch (error) {
    console.error(`Failed to archive artifacts for workflow ${workflowId}:`, error);
  }

  return archived;
}

/**
 * Metadata function that returns the list of stages requiring reset.
 * Actual checkpoint update is the responsibility of the caller.
 */
export function resetStages(
  _projectPath: string,
  _workflowId: string,
  stages: string[]
): string[] {
  return stages;
}

export function logChangeRequest(
  projectPath: string,
  workflowId: string,
  request: ChangeRequest
): void {
  try {
    const phase: string = request.targetPhase ?? 'change';

    const entry: AuditTimelineEntry = {
      timestamp: request.timestamp,
      phase,
      action: `change_request:${request.type}`,
      actor: request.requestedBy,
      reason: request.description,
    };

    appendToAudit(projectPath, workflowId, entry);
  } catch (error) {
    console.error(`Failed to log change request for workflow ${workflowId}:`, error);
  }
}
