import * as path from 'path';
import * as fs from 'fs-extra';
import type { WorkflowCheckpointV3, WorkflowPhase, InceptionStage } from './phase-types.js';

const WORKFLOW_DIR = 'aidlc-docs';
const STATE_FILENAME = 'aidlc-state.md';

const PHASES: WorkflowPhase[] = ['discovery', 'inception', 'construction', 'operations'];

const INCEPTION_STAGE_ORDER: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'user-stories',
  'workflow-planning',
  'application-design',
  'units-generation',
];

function toTitleCase(kebab: string): string {
  return kebab
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function deriveTitle(featureName: string): string {
  const title = featureName
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  return title.length > 80 ? title.substring(0, 77) + '...' : title;
}

function buildInceptionSubStages(checkpoint: WorkflowCheckpointV3): string[] {
  const { inception_stages, current_inception_stage } = checkpoint;
  if (!inception_stages) return [];

  const lines: string[] = [];
  for (const stage of INCEPTION_STAGE_ORDER) {
    const stageState = inception_stages[stage];
    if (!stageState) continue;

    const label = toTitleCase(stage);
    const isCurrent = current_inception_stage === stage;

    let checkbox: string;
    let suffix: string;

    if (stageState.status === 'completed') {
      checkbox = '[x]';
      suffix = stageState.completed_at ? `(completed ${stageState.completed_at})` : '(completed)';
    } else if (stageState.status === 'skipped') {
      checkbox = '[ ]';
      suffix = stageState.skip_reason ? `(skipped -- ${stageState.skip_reason})` : '(skipped)';
    } else {
      checkbox = '[ ]';
      suffix = '';
    }

    let line = `  - ${checkbox} ${label} ${suffix}`.trimEnd();
    if (isCurrent) {
      line += ' <- CURRENT';
    }
    lines.push(line);
  }
  return lines;
}

function buildPhaseProgress(checkpoint: WorkflowCheckpointV3): string {
  const lines: string[] = ['## Progress'];

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

    if (phase === 'inception' && checkpoint.inception_stages) {
      const subLines = buildInceptionSubStages(checkpoint);
      lines.push(...subLines);
    }
  }

  return lines.join('\n');
}

function buildUnitsSection(checkpoint: WorkflowCheckpointV3): string {
  const lines: string[] = ['## Units of Work'];

  if (!checkpoint.construction_units || Object.keys(checkpoint.construction_units).length === 0) {
    lines.push('');
    lines.push('_No units defined yet. Populated during Units Generation._');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('| Unit | Status |');
  lines.push('|------|--------|');
  for (const [key, unit] of Object.entries(checkpoint.construction_units)) {
    let statusText = unit.code_generation_status;
    if (unit.recreation_readiness_score != null && unit.recreation_readiness_score > 0) {
      statusText += ` | Readiness: ${unit.recreation_readiness_score}/5.0`;
    }
    lines.push(`| ${key} | ${statusText} |`);
  }
  return lines.join('\n');
}

function buildArtifactsSection(
  projectPath: string,
  workflowId: string
): string {
  const lines: string[] = ['## Key Artifacts', ''];
  lines.push('| Artifact | Path | Status |');
  lines.push('|----------|------|--------|');

  const workflowDir = path.join(projectPath, WORKFLOW_DIR, workflowId);
  const artifacts = [
    { name: 'Intent Analysis', path: 'inception/intent.md' },
    { name: 'Requirements', path: 'inception/requirements/requirements.md' },
    { name: 'NFR', path: 'inception/requirements/nfr.md' },
    { name: 'User Stories', path: 'inception/user-stories/stories.md' },
    { name: 'Personas', path: 'inception/user-stories/personas.md' },
    { name: 'Workflow Plan', path: 'inception/workflow-plan.md' },
    { name: 'Unit Definitions', path: 'inception/units/unit-of-work.md' },
    { name: 'Dependency Matrix', path: 'inception/units/unit-of-work-dependency.md' },
  ];

  for (const artifact of artifacts) {
    const exists = fs.existsSync(path.join(workflowDir, artifact.path));
    lines.push(`| ${artifact.name} | ${artifact.path} | ${exists ? 'created' : 'pending'} |`);
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
    const title = deriveTitle(checkpoint.feature_name);
    const phaseProgress = buildPhaseProgress(checkpoint);
    const unitsSection = buildUnitsSection(checkpoint);
    const artifactsSection = buildArtifactsSection(projectPath, workflowId);

    const content = `# ${title}

| Field | Value |
|-------|-------|
| **Workflow ID** | ${workflowId} |
| **Status** | ${checkpoint.status} |
| **Phase** | ${checkpoint.current_phase} |
| **Stage** | ${checkpoint.current_stage} |
| **Pathway** | ${checkpoint.pathway_type ?? 'unknown'} |
| **Created** | ${checkpoint.created_at ?? new Date().toISOString()} |
| **Last Updated** | ${new Date().toISOString()} |${checkpoint.archived_at ? `
| **Archived** | ${checkpoint.archived_at} |
| **Location** | ${checkpoint.archived_path} |` : ''}

## Summary

${checkpoint.feature_name}

${phaseProgress}

${unitsSection}

${artifactsSection}

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

    // Update Last Updated - handle both table format and plain format
    const tableLastUpdated = /\| \*\*Last Updated\*\* \| .+? \|/;
    const plainLastUpdated = /^\*\*Last Updated\*\*: .+$/m;

    if (tableLastUpdated.test(updated)) {
      updated = updated.replace(tableLastUpdated, `| **Last Updated** | ${new Date().toISOString()} |`);
    } else {
      updated = updated.replace(plainLastUpdated, `**Last Updated**: ${new Date().toISOString()}`);
    }

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
