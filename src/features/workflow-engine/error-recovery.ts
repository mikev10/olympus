import * as path from 'path';
import * as fs from 'fs-extra';
import { appendToAudit } from './audit-generator.js';
import type { AuditTimelineEntry } from './audit-generator.js';

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface WorkflowError {
  message: string;
  code?: string;
  stage?: string;
  artifactPath?: string;
  isCorrupted?: boolean;
  isMissing?: boolean;
}

export interface RecoveryResult {
  success: boolean;
  action: string;
  details: string;
  recoveredFrom?: string;
  artifactsBackedUp?: string[];
}

export const ERROR_LOG_FORMAT = `### Error [{severity}] {timestamp}
**Stage:** {stage}
**Error:** {message}
**Code:** {code}
**Recovery Action:** {action}
`;

export const RECOVERY_LOG_FORMAT = `### Recovery {timestamp}
**Type:** {recoveryType}
**Action:** {action}
**Result:** {result}
**Details:** {details}
`;

function logRecovery(
  projectPath: string,
  workflowId: string,
  action: string,
  details: string
): void {
  const entry: AuditTimelineEntry = {
    timestamp: new Date().toISOString(),
    phase: 'recovery',
    action,
    actor: 'system',
    reason: details,
  };
  appendToAudit(projectPath, workflowId, entry);
}

export function assessErrorSeverity(error: WorkflowError): ErrorSeverity {
  try {
    if (error.isCorrupted) return 'critical';
    if (error.code === 'ENOSPC' || error.code === 'EROFS') return 'critical';

    if (error.isMissing) return 'high';
    if (error.code === 'EACCES' || error.code === 'EPERM') return 'high';

    if (!error.stage) return 'low';

    return 'medium';
  } catch (err) {
    console.error('assessErrorSeverity: unexpected error', err);
    return 'medium';
  }
}

export async function recoverPartialCompletion(
  projectPath: string,
  workflowId: string
): Promise<RecoveryResult> {
  try {
    const statePath = path.join(projectPath, 'aidlc-docs', workflowId, 'aidlc-state.md');

    if (await fs.pathExists(statePath)) {
      const content = await fs.readFile(statePath, 'utf-8');
      const lines = content.split('\n');

      let lastCompleted: string | null = null;
      let resumeAt: string | null = null;

      for (const line of lines) {
        const completedMatch = line.match(/^\s*-\s*\[x\]\s+(.+)/i);
        if (completedMatch) {
          lastCompleted = completedMatch[1].trim();
        }
      }

      for (const line of lines) {
        const pendingMatch = line.match(/^\s*-\s*\[ \]\s+(.+)/i);
        if (pendingMatch) {
          resumeAt = pendingMatch[1].trim();
          break;
        }
      }

      const details = resumeAt
        ? `Last completed: "${lastCompleted ?? 'none'}". Resume at: "${resumeAt}".`
        : `All steps appear completed. Last completed: "${lastCompleted ?? 'none'}".`;

      logRecovery(projectPath, workflowId, 'partial_completion_recovery', details);

      return {
        success: true,
        action: 'partial_completion_recovery',
        details,
        recoveredFrom: statePath,
      };
    }

    const checkpointPath = path.join(projectPath, 'aidlc-docs', workflowId, 'checkpoint.json');
    if (await fs.pathExists(checkpointPath)) {
      const checkpoint = await fs.readJson(checkpointPath);
      const phase: string = checkpoint.phase ?? 'unknown';
      const stage: string = checkpoint.stage ?? 'unknown';
      const details = `Recovered from checkpoint.json — phase: "${phase}", stage: "${stage}".`;

      logRecovery(projectPath, workflowId, 'partial_completion_recovery_checkpoint', details);

      return {
        success: true,
        action: 'partial_completion_recovery_checkpoint',
        details,
        recoveredFrom: checkpointPath,
      };
    }

    const details = 'No state file or checkpoint found. Cannot determine resume point.';
    logRecovery(projectPath, workflowId, 'partial_completion_recovery_failed', details);

    return {
      success: false,
      action: 'partial_completion_recovery_failed',
      details,
    };
  } catch (error) {
    console.error(`recoverPartialCompletion failed for workflow ${workflowId}:`, error);
    return {
      success: false,
      action: 'partial_completion_recovery_error',
      details: `Error during recovery: ${String(error)}`,
    };
  }
}

export async function recoverCorruptedState(
  projectPath: string,
  workflowId: string
): Promise<RecoveryResult> {
  try {
    const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
    const checkpointPath = path.join(workflowDir, 'checkpoint.json');
    const backedUpFiles: string[] = [];

    if (await fs.pathExists(checkpointPath)) {
      const backupPath = `${checkpointPath}.backup.${Date.now()}`;
      await fs.copy(checkpointPath, backupPath);
      backedUpFiles.push(backupPath);
    }

    const foundArtifacts: string[] = [];
    if (await fs.pathExists(workflowDir)) {
      const entries = await fs.readdir(workflowDir);
      for (const entry of entries) {
        foundArtifacts.push(entry);
      }
    }

    const manifestPath = path.join(workflowDir, 'manifest.json');
    let manifestInfo = 'No manifest found.';
    if (await fs.pathExists(manifestPath)) {
      try {
        const manifest = await fs.readJson(manifestPath);
        const featureName: string = manifest.feature_name ?? 'unknown';
        const phase: string = manifest.current_phase ?? 'unknown';
        manifestInfo = `Manifest found — feature: "${featureName}", phase: "${phase}".`;
      } catch {
        manifestInfo = 'Manifest found but could not be parsed.';
      }
    }

    const details = [
      backedUpFiles.length > 0
        ? `Backed up checkpoint to: ${backedUpFiles.join(', ')}.`
        : 'No checkpoint found to back up.',
      `Artifacts in workflow directory: ${foundArtifacts.length > 0 ? foundArtifacts.join(', ') : 'none'}.`,
      manifestInfo,
      'User action required to restore or recreate missing state.',
    ].join(' ');

    logRecovery(projectPath, workflowId, 'corrupted_state_recovery', details);

    return {
      success: true,
      action: 'corrupted_state_recovery',
      details,
      artifactsBackedUp: backedUpFiles,
    };
  } catch (error) {
    console.error(`recoverCorruptedState failed for workflow ${workflowId}:`, error);
    return {
      success: false,
      action: 'corrupted_state_recovery_error',
      details: `Error during corrupted state recovery: ${String(error)}`,
    };
  }
}

const REGENERATABLE_TYPES = new Set(['AUDIT', 'REPORT', 'SUMMARY', 'RETRO']);

export async function recoverMissingArtifacts(
  projectPath: string,
  workflowId: string
): Promise<RecoveryResult> {
  try {
    const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
    const manifestPath = path.join(workflowDir, 'manifest.json');

    if (!(await fs.pathExists(manifestPath))) {
      const details = 'manifest.json not found — cannot determine expected artifacts.';
      logRecovery(projectPath, workflowId, 'missing_artifacts_recovery_failed', details);
      return {
        success: false,
        action: 'missing_artifacts_recovery_failed',
        details,
      };
    }

    const manifest = await fs.readJson(manifestPath);
    const artifacts: Array<{ id: string; path: string; type?: string }> =
      manifest.artifacts ?? [];

    const missingRegeneratable: string[] = [];
    const missingNonRegeneratable: string[] = [];

    for (const artifact of artifacts) {
      if (!artifact.path) continue;
      const exists = await fs.pathExists(artifact.path);
      if (!exists) {
        const artifactType: string = (artifact.type ?? '').toUpperCase();
        if (REGENERATABLE_TYPES.has(artifactType)) {
          missingRegeneratable.push(artifact.id);
        } else {
          missingNonRegeneratable.push(artifact.id);
        }
      }
    }

    const detailParts: string[] = [];
    if (missingRegeneratable.length > 0) {
      detailParts.push(
        `Regeneratable missing artifacts (${missingRegeneratable.length}): ${missingRegeneratable.join(', ')}.`
      );
    }
    if (missingNonRegeneratable.length > 0) {
      detailParts.push(
        `Non-regeneratable missing artifacts requiring user input (${missingNonRegeneratable.length}): ${missingNonRegeneratable.join(', ')}.`
      );
    }
    if (detailParts.length === 0) {
      detailParts.push('All expected artifacts are present on disk.');
    }

    const details = detailParts.join(' ');
    logRecovery(projectPath, workflowId, 'missing_artifacts_recovery', details);

    return {
      success: true,
      action: 'missing_artifacts_recovery',
      details,
    };
  } catch (error) {
    console.error(`recoverMissingArtifacts failed for workflow ${workflowId}:`, error);
    return {
      success: false,
      action: 'missing_artifacts_recovery_error',
      details: `Error during missing artifact recovery: ${String(error)}`,
    };
  }
}

export async function handleUserRestart(
  projectPath: string,
  workflowId: string,
  stage: string
): Promise<RecoveryResult> {
  try {
    const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
    const backedUpFiles: string[] = [];

    if (await fs.pathExists(workflowDir)) {
      const entries = await fs.readdir(workflowDir);

      for (const entry of entries) {
        if (entry.toLowerCase().includes(stage.toLowerCase())) {
          const srcPath = path.join(workflowDir, entry);
          const backupPath = path.join(workflowDir, `${entry}.backup.${Date.now()}`);
          await fs.copy(srcPath, backupPath);
          backedUpFiles.push(backupPath);
        }
      }
    }

    const details =
      backedUpFiles.length > 0
        ? `Backed up ${backedUpFiles.length} artifact(s) for stage "${stage}": ${backedUpFiles.join(', ')}.`
        : `No artifacts found for stage "${stage}" to back up.`;

    logRecovery(projectPath, workflowId, `stage_restart:${stage}`, details);

    return {
      success: true,
      action: `stage_restart:${stage}`,
      details,
      artifactsBackedUp: backedUpFiles,
    };
  } catch (error) {
    console.error(`handleUserRestart failed for workflow ${workflowId}, stage ${stage}:`, error);
    return {
      success: false,
      action: `stage_restart_error:${stage}`,
      details: `Error during stage restart: ${String(error)}`,
    };
  }
}

export function handleUserSkip(
  projectPath: string,
  workflowId: string,
  stage: string
): RecoveryResult {
  try {
    const timestamp = new Date().toISOString();
    const entry: AuditTimelineEntry = {
      timestamp,
      phase: stage,
      action: 'stage_skipped',
      actor: 'human',
      reason: `Stage "${stage}" was skipped by user request.`,
    };
    appendToAudit(projectPath, workflowId, entry);

    return {
      success: true,
      action: 'stage_skipped',
      details: `Stage "${stage}" skipped at ${timestamp}.`,
    };
  } catch (error) {
    console.error(`handleUserSkip failed for workflow ${workflowId}, stage ${stage}:`, error);
    return {
      success: false,
      action: 'stage_skip_error',
      details: `Error recording stage skip: ${String(error)}`,
    };
  }
}
