import * as path from 'path';
import * as fs from 'fs-extra';
import type { WorkflowCheckpointV3, WorkflowPhase } from './phase-types.js';

const WORKFLOW_DIR = 'aidlc-docs';
const STATE_FILENAME = 'aidlc-state.md';

const PHASES: WorkflowPhase[] = ['discovery', 'inception', 'construction', 'operations'];

function buildPhaseProgress(checkpoint: WorkflowCheckpointV3): string {
  const lines: string[] = ['## Phase Progress'];

  for (const phase of PHASES) {
    const phaseState = checkpoint.phases[phase];
    let checkbox: string;
    let suffix: string;

    if (phaseState?.completed_at) {
      checkbox = '[x]';
      suffix = `(completed ${phaseState.completed_at})`;
    } else if (checkpoint.current_phase === phase) {
      checkbox = '[ ]';
      suffix = '(in progress)';
    } else {
      checkbox = '[ ]';
      suffix = '';
    }

    const label = phase.charAt(0).toUpperCase() + phase.slice(1);
    lines.push(`- ${checkbox} ${label} ${suffix}`.trimEnd());
  }

  return lines.join('\n');
}

export function generateStateFile(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): string {
  const filePath = path.join(projectPath, WORKFLOW_DIR, workflowId, STATE_FILENAME);

  try {
    const phaseProgress = buildPhaseProgress(checkpoint);

    const content = `# AIDLC Workflow State
**Project**: ${checkpoint.feature_name}
**Workflow ID**: ${workflowId}
**Current Phase**: ${checkpoint.current_phase}
**Current Stage**: ${checkpoint.current_stage}
**Pathway**: ${checkpoint.pathway_type ?? 'unknown'}
**Last Updated**: ${new Date().toISOString()}

${phaseProgress}

## Code Location
Application Code: ${projectPath} (NEVER in aidlc-docs/)
Documentation: ${WORKFLOW_DIR}/${workflowId}/
`;

    fs.ensureDirSync(path.join(projectPath, WORKFLOW_DIR, workflowId));
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (error) {
    console.error(`[StateFile] Failed to generate state file for workflow ${workflowId}:`, (error as Error).message);
  }

  return filePath;
}

export function updateStateFile(
  projectPath: string,
  workflowId: string,
  stage: string,
  status: 'completed' | 'in_progress' | 'skipped'
): void {
  const filePath = path.join(projectPath, WORKFLOW_DIR, workflowId, STATE_FILENAME);

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const stagePattern = new RegExp(`^(- \\[[ x\\-]\\] ${stage}.*)$`, 'im');

    let updated = raw;

    if (status === 'completed') {
      updated = updated.replace(stagePattern, (_match, _line) => {
        const base = _line.replace(/\[[ x\-]\]/, '[x]').replace(/\s*\(.*?\)\s*$/, '').replace(/\s*← CURRENT\s*$/, '');
        return `${base} (completed ${new Date().toISOString()})`;
      });
    } else if (status === 'in_progress') {
      updated = updated.replace(stagePattern, (_match, _line) => {
        const base = _line.replace(/\[[ x\-]\]/, '[ ]').replace(/\s*\(.*?\)\s*$/, '').replace(/\s*← CURRENT\s*$/, '');
        return `${base} ← CURRENT`;
      });
    } else if (status === 'skipped') {
      updated = updated.replace(stagePattern, (_match, _line) => {
        const base = _line.replace(/\[[ x\-]\]/, '[-]').replace(/\s*\(.*?\)\s*$/, '').replace(/\s*← CURRENT\s*$/, '');
        return `${base} (skipped)`;
      });
    }

    updated = updated.replace(
      /^\*\*Last Updated\*\*: .+$/m,
      `**Last Updated**: ${new Date().toISOString()}`
    );

    fs.writeFileSync(filePath, updated, 'utf-8');
  } catch (error) {
    console.error(`[StateFile] Failed to update state file for workflow ${workflowId}:`, (error as Error).message);
  }
}

export const STATE_FILE_RULES = `## State File Tracking Rules

IMMEDIATELY after completing ANY plan step:
1. Mark the step [x] in the plan file
2. Update aidlc-state.md stage progress in the SAME interaction
3. NO EXCEPTIONS: Every step completion MUST be tracked at BOTH levels
4. NEVER complete work without updating both plan checkboxes AND aidlc-state.md`;
