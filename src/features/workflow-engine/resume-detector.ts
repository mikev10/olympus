/**
 * Resume Detector
 *
 * Detects resumable workflows in the current project path.
 * Used by session-start hook to inject workflow context hints
 * and by /plan command for resume flow.
 *
 * Checks:
 * 1. aidlc-docs/ for v3 checkpoints (current format)
 * 2. .olympus/workflow/ for legacy v1/v2 checkpoints
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import { loadCheckpoint, listWorkflows, isLegacyCheckpoint } from './checkpoint.js';
import { loadManifest } from './manifest.js';
import { getWorkflowProgress } from './workflow-bridge.js';
import { STAGE_PHASE_MAP } from './phase-types.js';
import type { WorkflowPhase, ManifestSchema } from './phase-types.js';
import type { WorkflowStage } from './types.js';

export interface ResumeInfo {
  workflowId: string;
  featureName: string;
  currentPhase: WorkflowPhase;
  currentStage: WorkflowStage;
  progress: { completed: number; total: number };
  lastActivity: string; // ISO date
  isLegacy: boolean; // v1/v2 checkpoint
  status?: string;
  interviewProgress?: {
    stage: 'idea' | 'intent';
    questions_asked: number;
    draft_artifact_path?: string;
  };
}

/**
 * Detect all resumable workflows in the given project path.
 * Checks both aidlc-docs/ (v3) and .olympus/workflow/ (legacy).
 *
 * @param projectPath - Absolute path to the project root
 * @returns Array of ResumeInfo for all detected workflows
 */
export async function detectResumableWorkflows(projectPath: string): Promise<ResumeInfo[]> {
  const results: ResumeInfo[] = [];

  // 1. Check for current v3 workflows in aidlc-docs/
  try {
    const workflowIds = await listWorkflows(projectPath);
    for (const wfId of workflowIds) {
      const checkpoint = await loadCheckpoint(projectPath, wfId);
      if (!checkpoint) continue;

      // Skip completed or archived workflows
      if (checkpoint.status === 'complete' || checkpoint.status === 'archived') continue;

      // Load manifest for progress info
      const manifestPath = path.join(projectPath, 'aidlc-docs', wfId, 'manifest.json');
      const manifest = loadManifest(manifestPath);
      let progress = { completed: 0, total: 0 };
      if (manifest) {
        progress = getWorkflowProgress(manifest);
      }

      results.push({
        workflowId: checkpoint.workflow_id,
        featureName: checkpoint.feature_name,
        currentPhase: checkpoint.current_phase,
        currentStage: checkpoint.current_stage,
        progress,
        lastActivity: checkpoint.updated_at,
        isLegacy: false,
        status: checkpoint.status,
        interviewProgress: checkpoint.interview_progress,
      });
    }
  } catch (error) {
    console.error('[ResumeDetector] Error checking aidlc-docs:', error);
  }

  // 2. Check for legacy workflows in .olympus/workflow/
  try {
    const legacyDir = path.join(projectPath, '.olympus', 'workflow');
    if (await fs.pathExists(legacyDir)) {
      const entries = await fs.readdir(legacyDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const checkpointPath = path.join(legacyDir, entry.name, 'checkpoint.json');
        if (!(await fs.pathExists(checkpointPath))) continue;

        try {
          const data = await fs.readJson(checkpointPath);
          if (!isLegacyCheckpoint(data)) continue;

          // Map old stage names to new ones
          const stageMap: Record<string, WorkflowStage> = {
            'idea': 'idea',
            'prd': 'intent',
            'spec': 'unit',
            'intents': 'bolt',
            'complete': 'complete',
          };
          const stage = stageMap[data.current_stage] || 'idea';
          const phase = (STAGE_PHASE_MAP[stage] === 'complete' ? 'operations' : STAGE_PHASE_MAP[stage]) as WorkflowPhase;

          results.push({
            workflowId: data.workflow_id || entry.name,
            featureName: data.feature_name || entry.name,
            currentPhase: phase,
            currentStage: stage,
            progress: { completed: 0, total: 0 },
            lastActivity: data.updated_at || new Date().toISOString(),
            isLegacy: true,
            status: data.status,
          });
        } catch {
          // Skip unparseable checkpoint files
        }
      }
    }
  } catch (error) {
    console.error('[ResumeDetector] Error checking legacy workflows:', error);
  }

  return results;
}
