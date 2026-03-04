import * as fs from 'fs-extra';
import { join } from 'path';
import { loadWorkflowRouting } from '../../workflow-routing.js';
import type { WorkflowRoutingPlan } from '../../phase-types.js';
import { registerStageHandler } from '../orchestrator.js';
import type { InceptionStageResult } from '../orchestrator.js';
import type { WorkflowCheckpointV3 } from '../../phase-types.js';

async function executeWorkflowPlanning(
  projectPath: string,
  workflowId: string,
  checkpoint: WorkflowCheckpointV3
): Promise<InceptionStageResult> {
  const inceptionDir = join(projectPath, 'aidlc-docs', workflowId, 'inception');
  const plansDir = join(inceptionDir, 'plans');
  await fs.ensureDir(plansDir);

  let intentContent = '';
  let requirementsContent = '';
  let storiesContent = '';
  try { intentContent = await fs.readFile(join(inceptionDir, 'intent.md'), 'utf-8'); } catch {}
  try { requirementsContent = await fs.readFile(join(inceptionDir, 'requirements.md'), 'utf-8'); } catch {}
  try { storiesContent = await fs.readFile(join(inceptionDir, 'stories.md'), 'utf-8'); } catch {}

  void intentContent;
  void requirementsContent;
  void storiesContent;

  const routingPlan = loadWorkflowRouting(projectPath, workflowId);

  const executionPlan = generateExecutionPlan(checkpoint, routingPlan);
  const executionPlanPath = join(plansDir, 'execution-plan.md');
  await fs.writeFile(executionPlanPath, executionPlan, 'utf-8');

  const artifactPaths = [executionPlanPath];

  if (routingPlan) {
    const routingPath = join(plansDir, 'workflow-routing.md');
    const routingDoc = generateRoutingDocument(routingPlan);
    await fs.writeFile(routingPath, routingDoc, 'utf-8');
    artifactPaths.push(routingPath);
  }

  return {
    stage: 'workflow-planning',
    status: 'review_required',
    requires_approval: true,
    artifacts_generated: artifactPaths,
    review_summary: [
      '## REVIEW REQUIRED',
      '',
      'Execution plan generated with:',
      '- Change impact assessment',
      '- Risk assessment',
      '- Mermaid workflow visualization',
      '- Phase-by-phase checklist with live checkboxes',
      '- Per-step rationale',
      '',
      `Plan file: ${executionPlanPath}`,
    ].join('\n'),
    whats_next: [
      "## WHAT'S NEXT",
      '',
      'Review the execution plan. Once approved, proceed to application design.',
    ].join('\n'),
  };
}

export function generateExecutionPlan(
  checkpoint: WorkflowCheckpointV3,
  routingPlan: WorkflowRoutingPlan | null
): string {
  const lines: string[] = [];
  const now = new Date().toISOString();
  const pathwayType = checkpoint.pathway_type ?? 'greenfield';
  const stages = checkpoint.inception_stages;

  lines.push('# Execution Plan\n');
  lines.push(`Generated: ${now}`);
  lines.push(`Pathway: ${pathwayType}`);
  lines.push(`Workflow: ${checkpoint.workflow_id}\n`);

  lines.push('## Change Impact Assessment\n');
  if (routingPlan) {
    lines.push(`- Risk Assessment: ${routingPlan.risk_assessment}`);
    lines.push(`- Risk Tier: ${routingPlan.risk_tier}`);
    lines.push(`- Estimated Depth: ${routingPlan.estimated_depth}`);
    lines.push(`- Estimated Code Generations: ${routingPlan.estimated_code_generations}`);
  } else {
    lines.push('- Risk Assessment: MEDIUM (default)');
    lines.push('- Estimated Depth: standard');
  }
  lines.push('');

  lines.push('## Risk Assessment\n');
  lines.push('| Factor | Level |');
  lines.push('|--------|-------|');
  lines.push(`| Rollback Complexity | ${pathwayType === 'greenfield' ? 'Low' : 'Medium'} |`);
  lines.push(`| Testing Complexity | ${routingPlan?.risk_assessment === 'HIGH' ? 'High' : 'Medium'} |`);
  lines.push(`| Risk Tier | ${routingPlan?.risk_tier ?? 2} |`);
  lines.push('');

  lines.push('## Workflow Visualization\n');
  lines.push('```mermaid');
  lines.push('graph LR');

  const allStages = [
    { id: 'WD', name: 'Workspace Detection', phase: 'inception' },
    { id: 'RE', name: 'Reverse Engineering', phase: 'inception' },
    { id: 'RA', name: 'Requirements Analysis', phase: 'inception' },
    { id: 'US', name: 'User Stories', phase: 'inception' },
    { id: 'WP', name: 'Workflow Planning', phase: 'inception' },
    { id: 'AD', name: 'Application Design', phase: 'inception' },
    { id: 'UG', name: 'Units Generation', phase: 'inception' },
    { id: 'CG', name: 'Code Generation', phase: 'construction' },
    { id: 'BT', name: 'Build and Test', phase: 'construction' },
  ];

  const stageKeys: Record<string, string> = {
    'WD': 'workspace-detection',
    'RE': 'reverse-engineering',
    'RA': 'requirements-analysis',
    'US': 'user-stories',
    'WP': 'workflow-planning',
    'AD': 'application-design',
    'UG': 'units-generation',
  };

  for (const s of allStages) {
    const stageKey = stageKeys[s.id];
    const stageState = stageKey && stages ? stages[stageKey as keyof typeof stages] : undefined;
    let style = '';

    if (stageState?.status === 'completed') {
      style = ':::completed';
    } else if (stageState?.status === 'skipped') {
      style = ':::skipped';
    } else if (stageState?.status === 'in_progress') {
      style = ':::active';
    }

    if (s.id === 'CG' || s.id === 'BT') {
      style = ':::always';
    }

    lines.push(`  ${s.id}["${s.name}"]${style}`);
  }

  lines.push('  WD --> RE --> RA --> US --> WP --> AD --> UG --> CG --> BT');

  lines.push('  classDef completed fill:#4CAF50,color:white');
  lines.push('  classDef skipped fill:#9E9E9E,color:white');
  lines.push('  classDef active fill:#2196F3,color:white');
  lines.push('  classDef always fill:#FF9800,color:white');
  lines.push('```\n');

  lines.push('## Phase Checklist\n');
  lines.push('### Inception\n');

  const inceptionStages = [
    { key: 'workspace-detection', name: 'Workspace Detection' },
    { key: 'reverse-engineering', name: 'Reverse Engineering' },
    { key: 'requirements-analysis', name: 'Requirements Analysis' },
    { key: 'user-stories', name: 'User Stories' },
    { key: 'workflow-planning', name: 'Workflow Planning' },
    { key: 'application-design', name: 'Application Design' },
    { key: 'units-generation', name: 'Units Generation' },
  ];

  for (const s of inceptionStages) {
    const state = stages?.[s.key as keyof typeof stages];
    const checked = state?.status === 'completed' ? 'x' : ' ';
    const skipNote = state?.status === 'skipped' ? ' *(skipped)*' : '';
    lines.push(`- [${checked}] ${s.name}${skipNote}`);
  }

  lines.push('');
  lines.push('### Construction\n');
  lines.push('- [ ] Code Generation **[ALWAYS]**');
  lines.push('- [ ] Build and Test **[ALWAYS]**');
  lines.push('');

  lines.push('## Per-Step Rationale\n');
  for (const s of inceptionStages) {
    const state = stages?.[s.key as keyof typeof stages];
    if (state?.status === 'skipped') {
      lines.push(`- **${s.name}**: SKIPPED — ${state.skip_reason ?? 'excluded by routing'}`);
    } else {
      lines.push(`- **${s.name}**: INCLUDED — required for ${pathwayType} pathway`);
    }
  }
  lines.push('- **Code Generation**: ALWAYS — mandatory step, cannot be skipped');
  lines.push('- **Build and Test**: ALWAYS — mandatory step, cannot be skipped');
  lines.push('');

  lines.push('## Success Criteria\n');
  lines.push(`- Primary Goal: ${checkpoint.feature_name}`);
  lines.push('- Key Deliverables: All inception artifacts, approved execution plan');
  lines.push('- Quality Gates: Each stage passes review before advancing');
  lines.push('');

  return lines.join('\n');
}

export function generateRoutingDocument(plan: WorkflowRoutingPlan): string {
  const lines: string[] = [];
  lines.push('# Workflow Routing\n');
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Pathway: ${plan.pathway}`);
  lines.push(`Risk: ${plan.risk_assessment} (Tier ${plan.risk_tier})`);
  lines.push(`Depth: ${plan.estimated_depth}`);
  lines.push(`Code Generations: ${plan.estimated_code_generations}\n`);

  lines.push('## Stages\n');
  for (const stage of plan.stages) {
    const status = stage.included ? 'INCLUDED' : 'SKIPPED';
    lines.push(`- [${stage.phase}] ${stage.stage}: ${status} — ${stage.rationale}`);
  }
  lines.push('');

  return lines.join('\n');
}

registerStageHandler('workflow-planning', executeWorkflowPlanning);
export { executeWorkflowPlanning };
