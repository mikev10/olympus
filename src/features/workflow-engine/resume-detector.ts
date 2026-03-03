/**
 * Resume Detector
 *
 * Detects resumable workflows in the current project path.
 * Used by session-start hook to inject workflow context hints
 * and by /plan command for resume flow.
 *
 * Checks:
 * 1. aidlc-docs/ for v3 checkpoints (current format)
 */

import * as path from 'path';
import { loadCheckpoint, listWorkflows } from './checkpoint.js';
import { loadManifest } from './manifest.js';
import { getWorkflowProgress } from './workflow-bridge.js';
import type { WorkflowPhase, ManifestSchema } from './phase-types.js';
import type { WorkflowStage } from './types.js';

export interface ResumeInfo {
  workflowId: string;
  featureName: string;
  currentPhase: WorkflowPhase;
  currentStage: WorkflowStage;
  progress: { completed: number; total: number };
  lastActivity: string; // ISO date
  status?: string;
  interviewProgress?: {
    stage: 'idea' | 'intent';
    questions_asked: number;
    draft_artifact_path?: string;
  };
}

/**
 * Detect all resumable workflows in the given project path.
 * Checks aidlc-docs/ for v3 checkpoints.
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
        status: checkpoint.status,
        interviewProgress: checkpoint.interview_progress,
      });
    }
  } catch (error) {
    console.error('[ResumeDetector] Error checking aidlc-docs:', error);
  }

  return results;
}
