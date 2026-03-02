import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { detectBrownfield } from './discovery.js';
import { registerArtifact } from './manifest.js';
import type { PathwayType, WorkflowRoutingPlan, WorkflowRoutingStage, WorkflowPhase, RiskTier } from './phase-types.js';
import type { DepthAssessment } from './phase-types.js';

const PATHWAY_KEYWORDS: Array<{ pathway: PathwayType; keywords: string[] }> = [
  {
    pathway: 'bugfix',
    keywords: ['fix', 'bug', 'broken', 'regression', 'error', 'crash', 'issue', 'defect', 'patch'],
  },
  {
    pathway: 'optimization',
    keywords: ['optimize', 'performance', 'speed', 'cache', 'reduce', 'improve latency', 'memory', 'bottleneck'],
  },
  {
    pathway: 'brownfield-refactor',
    keywords: ['refactor', 'restructure', 'migrate', 'rewrite', 'reorganize', 'modernize', 'upgrade'],
  },
  {
    pathway: 'brownfield-enhancement',
    keywords: ['add', 'new', 'feature', 'implement', 'integrate', 'extend', 'support'],
  },
];

export async function detectPathway(projectPath: string, intentText: string): Promise<PathwayType> {
  const { isBrownfield } = await detectBrownfield(projectPath);

  if (!isBrownfield) {
    return 'greenfield';
  }

  const lowerIntent = intentText.toLowerCase();

  for (const { pathway, keywords } of PATHWAY_KEYWORDS) {
    for (const keyword of keywords) {
      if (lowerIntent.includes(keyword)) {
        return pathway;
      }
    }
  }

  return 'brownfield-enhancement';
}

export interface WorkflowRoutingOptions {
  projectPath: string;
  workflowId: string;
  intentText: string;
  depthAssessment: DepthAssessment;
  pathwayType: PathwayType;
  sourceFileCount: number;
}

interface PhaseConfig {
  discovery: boolean;
  inception: boolean;
  construction: boolean;
  operations: boolean;
}

function getPhaseConfig(pathway: PathwayType): PhaseConfig {
  switch (pathway) {
    case 'greenfield':
      return { discovery: false, inception: true, construction: true, operations: true };
    case 'brownfield-enhancement':
    case 'brownfield-refactor':
    case 'optimization':
      return { discovery: true, inception: true, construction: true, operations: true };
    case 'bugfix':
      return { discovery: false, inception: false, construction: true, operations: true };
  }
}

function getPhaseRationale(phase: WorkflowPhase, pathway: PathwayType, included: boolean): string {
  if (!included) {
    switch (phase) {
      case 'discovery':
        if (pathway === 'greenfield') return 'Greenfield project — no existing codebase to analyse';
        if (pathway === 'bugfix') return 'Bug fixes skip discovery to reduce overhead';
        return 'Not applicable for this pathway';
      case 'inception':
        if (pathway === 'bugfix') return 'Bug fixes proceed directly to construction';
        return 'Not applicable for this pathway';
      default:
        return 'Skipped for this pathway';
    }
  }

  switch (phase) {
    case 'discovery':
      return 'Brownfield project requires existing codebase analysis';
    case 'inception':
      return 'Requirements and depth assessment needed before construction';
    case 'construction':
      return 'Core implementation phase';
    case 'operations':
      return 'Deployment and monitoring artifacts required';
  }
}

function buildDefaultStagesForPhase(phase: WorkflowPhase, pathway: PathwayType): string[] {
  switch (phase) {
    case 'discovery':
      return ['brownfield-scan', 'analysis'];
    case 'inception':
      return [
        'workspace-detection',
        'reverse-engineering',
        'requirements-analysis',
        'user-stories',
        'workflow-planning',
        'application-design',
        'units-generation',
      ];
    case 'construction':
      if (pathway === 'bugfix') {
        return ['bolt-execution'];
      }
      return ['unit-decomposition', 'bolt-execution'];
    case 'operations':
      return ['deployment', 'monitoring'];
  }
}

function getStageRationale(phase: WorkflowPhase, stage: string, _pathway: PathwayType, depth: 'minimal' | 'standard' | 'comprehensive'): string {
  if (phase === 'construction' && stage === 'unit-decomposition' && depth === 'minimal') {
    return 'Skipped — minimal depth does not require unit decomposition';
  }
  const rationales: Record<string, string> = {
    'discovery:brownfield-scan': 'Scan existing source files for architectural understanding',
    'discovery:analysis': 'Analyse change impact and regression risk',
    'inception:intent': 'Capture structured problem statement and success criteria',
    'inception:depth-assessment': 'Score 6 factors to determine workflow depth',
    'inception:requirements': 'Classify non-functional requirements and constraints',
    'inception:workspace-detection': 'Auto-detect greenfield/brownfield and determine pathway type',
    'inception:reverse-engineering': 'Reverse-engineer existing codebase architecture (brownfield only)',
    'inception:requirements-analysis': 'Structured Q&A to capture functional and non-functional requirements',
    'inception:user-stories': 'Generate user personas and stories with Given/When/Then acceptance criteria',
    'inception:workflow-planning': 'Generate execution plan with Mermaid visualization and live checkboxes',
    'inception:application-design': 'High-level component identification, service boundaries, and dependencies',
    'inception:units-generation': 'Define units of work with inter-unit dependencies and story mapping',
    'construction:unit-decomposition': 'Break intent into implementable units',
    'construction:bolt-execution': 'Execute implementation bolts with validation gates',
    'operations:deployment': 'Generate deployment guide and release notes',
    'operations:monitoring': 'Configure monitoring, runbook, and observability',
  };
  return rationales[`${phase}:${stage}`] ?? 'Standard stage for this phase';
}

export async function generateWorkflowRouting(options: WorkflowRoutingOptions): Promise<WorkflowRoutingPlan> {
  const { pathwayType, depthAssessment, sourceFileCount } = options;
  const { recommended_depth, total_score, risk_tier } = depthAssessment;

  const phaseConfig = getPhaseConfig(pathwayType);
  const phases: Record<WorkflowPhase, { included: boolean; rationale: string }> = {
    discovery: {
      included: phaseConfig.discovery,
      rationale: getPhaseRationale('discovery', pathwayType, phaseConfig.discovery),
    },
    inception: {
      included: phaseConfig.inception,
      rationale: getPhaseRationale('inception', pathwayType, phaseConfig.inception),
    },
    construction: {
      included: phaseConfig.construction,
      rationale: getPhaseRationale('construction', pathwayType, phaseConfig.construction),
    },
    operations: {
      included: phaseConfig.operations,
      rationale: getPhaseRationale('operations', pathwayType, phaseConfig.operations),
    },
  };

  const allPhases: WorkflowPhase[] = ['discovery', 'inception', 'construction', 'operations'];
  const stages: WorkflowRoutingStage[] = [];

  for (const phase of allPhases) {
    if (!phaseConfig[phase]) continue;

    for (const stage of buildDefaultStagesForPhase(phase, pathwayType)) {
      const isUnitDecomposition = phase === 'construction' && stage === 'unit-decomposition';
      const isReverseEngineering = phase === 'inception' && stage === 'reverse-engineering';
      const isUserStories = phase === 'inception' && stage === 'user-stories';
      const isAppDesign = phase === 'inception' && stage === 'application-design';
      const isUnitsGeneration = phase === 'inception' && stage === 'units-generation';

      let included = true;
      if (isUnitDecomposition && recommended_depth === 'minimal') {
        included = false;
      }
      if (isReverseEngineering && pathwayType === 'greenfield') {
        included = false;
      }
      if ((isUserStories || isAppDesign) && (pathwayType === 'bugfix' || pathwayType === 'optimization')) {
        included = false;
      }
      if (isUnitsGeneration && recommended_depth === 'minimal') {
        included = false;
      }

      stages.push({
        phase,
        stage,
        included,
        rationale: getStageRationale(phase, stage, pathwayType, recommended_depth),
      });
    }
  }

  let estimated_bolts: number;
  if (pathwayType === 'bugfix') {
    estimated_bolts = 1;
  } else {
    switch (recommended_depth) {
      case 'minimal':
        estimated_bolts = 1;
        break;
      case 'standard':
        estimated_bolts = Math.min(10, Math.max(1, Math.ceil(sourceFileCount / 50)));
        break;
      case 'comprehensive':
        estimated_bolts = Math.min(20, Math.max(2, Math.ceil(sourceFileCount / 25)));
        break;
    }
  }

  const risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH' =
    total_score <= 10 ? 'LOW' : total_score <= 20 ? 'MEDIUM' : 'HIGH';

  return {
    pathway: pathwayType,
    risk_assessment,
    risk_tier: risk_tier.tier,
    phases,
    stages,
    estimated_bolts,
    estimated_depth: recommended_depth,
    generated_at: new Date().toISOString(),
    approved_at: null,
    approved_by: null,
  };
}

function renderPlanMarkdown(workflowId: string, plan: WorkflowRoutingPlan): string {
  const phaseOrder: WorkflowPhase[] = ['discovery', 'inception', 'construction', 'operations'];

  const phaseRows = phaseOrder
    .map((phase) => {
      const { included, rationale } = plan.phases[phase];
      return `| ${phase} | ${included ? 'yes' : 'no'} | ${rationale} |`;
    })
    .join('\n');

  const stageRows = plan.stages
    .map((s, i) => `| ${i + 1} | ${s.phase} | ${s.stage} | ${s.included ? 'yes' : 'no'} | ${s.rationale} |`)
    .join('\n');

  return `# Level 1 Plan: ${workflowId}

**Pathway:** ${plan.pathway}
**Risk Assessment:** ${plan.risk_assessment}
**Risk Tier:** ${plan.risk_tier}
**Estimated Bolts:** ${plan.estimated_bolts}
**Estimated Depth:** ${plan.estimated_depth}
**Generated:** ${plan.generated_at}
**Approved:** ${plan.approved_at ?? 'Pending'}

## Phase Overview

| Phase | Included | Rationale |
|-------|----------|-----------|
${phaseRows}

## Stage Details

| # | Phase | Stage | Included | Rationale |
|---|-------|-------|----------|-----------|
${stageRows}
`;
}

export async function writeWorkflowRoutingArtifact(
  projectPath: string,
  workflowId: string,
  plan: WorkflowRoutingPlan
): Promise<string> {
  const artifactDir = path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'plans');
  const artifactPath = path.join(artifactDir, 'workflow-routing.md');
  const relativePath = path.posix.join('aidlc-docs', workflowId, 'inception', 'plans', 'workflow-routing.md');

  try {
    await fs.mkdir(artifactDir, { recursive: true });
    const markdown = renderPlanMarkdown(workflowId, plan);
    const visualization = generatePlanVisualization(plan);
    const fullContent = markdown + '\n## Execution Plan Visualization\n\n' + visualization + '\n';
    await fs.writeFile(artifactPath, fullContent, 'utf-8');
  } catch (error) {
    console.error('[WorkflowRouting] Failed to write artifact:', error);
    throw error;
  }

  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
  registerArtifact(manifestPath, {
    id: `L1PLAN-${workflowId}`,
    type: 'WORKFLOW_ROUTING',
    phase: 'inception',
    stage: 'intent',
    path: relativePath,
    validation_passed: true,
    write_complete: true,
    checksum: null,
  });

  return relativePath;
}

function parsePhaseOverviewTable(content: string): Record<string, { included: boolean; rationale: string }> {
  const result: Record<string, { included: boolean; rationale: string }> = {};

  const tableMatch = content.match(/## Phase Overview[\s\S]*?\n\|[-| ]+\|\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (!tableMatch) return result;

  for (const row of tableMatch[1].trim().split('\n')) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 3) {
      const [phase, included, ...ratParts] = cells;
      result[phase] = { included: included.toLowerCase() === 'yes', rationale: ratParts.join(' | ') };
    }
  }

  return result;
}

function parseStageDetailsTable(content: string): WorkflowRoutingStage[] {
  const stages: WorkflowRoutingStage[] = [];

  const tableMatch = content.match(/## Stage Details[\s\S]*?\n\|[-| ]+\|\n([\s\S]*?)(?=\n## |\n# |$)/);
  if (!tableMatch) return stages;

  for (const row of tableMatch[1].trim().split('\n')) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length >= 5) {
      const [_num, phase, stage, included, ...ratParts] = cells;
      stages.push({
        phase: phase as WorkflowPhase,
        stage,
        included: included.toLowerCase() === 'yes',
        rationale: ratParts.join(' | '),
      });
    }
  }

  return stages;
}

export function loadWorkflowRouting(projectPath: string, workflowId: string): WorkflowRoutingPlan | null {
  const artifactPath = path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'plans', 'workflow-routing.md');

  if (!existsSync(artifactPath)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(artifactPath, 'utf-8');
  } catch (error) {
    console.error('[WorkflowRouting] Failed to read artifact:', error);
    return null;
  }

  try {
    const pathwayMatch = content.match(/\*\*Pathway:\*\*\s*(.+)/);
    const riskAssessmentMatch = content.match(/\*\*Risk Assessment:\*\*\s*(.+)/);
    const riskTierMatch = content.match(/\*\*Risk Tier:\*\*\s*(.+)/);
    const estimatedBoltsMatch = content.match(/\*\*Estimated Bolts:\*\*\s*(\d+)/);
    const estimatedDepthMatch = content.match(/\*\*Estimated Depth:\*\*\s*(.+)/);
    const generatedAtMatch = content.match(/\*\*Generated:\*\*\s*(.+)/);
    const approvedAtMatch = content.match(/\*\*Approved:\*\*\s*(.+)/);

    if (!pathwayMatch || !riskAssessmentMatch || !riskTierMatch || !estimatedBoltsMatch || !estimatedDepthMatch || !generatedAtMatch) {
      console.error('[WorkflowRouting] Missing required header fields');
      return null;
    }

    const approvedAtRaw = approvedAtMatch ? approvedAtMatch[1].trim() : 'Pending';
    const phasesRaw = parsePhaseOverviewTable(content);

    return {
      pathway: pathwayMatch[1].trim() as PathwayType,
      risk_assessment: riskAssessmentMatch[1].trim() as 'LOW' | 'MEDIUM' | 'HIGH',
      risk_tier: parseInt(riskTierMatch[1].trim(), 10) as RiskTier,
      estimated_bolts: parseInt(estimatedBoltsMatch[1].trim(), 10),
      estimated_depth: estimatedDepthMatch[1].trim() as 'minimal' | 'standard' | 'comprehensive',
      generated_at: generatedAtMatch[1].trim(),
      approved_at: approvedAtRaw === 'Pending' ? null : approvedAtRaw,
      approved_by: null,
      phases: {
        discovery: phasesRaw['discovery'] ?? { included: true, rationale: '' },
        inception: phasesRaw['inception'] ?? { included: true, rationale: '' },
        construction: phasesRaw['construction'] ?? { included: true, rationale: '' },
        operations: phasesRaw['operations'] ?? { included: true, rationale: '' },
      },
      stages: parseStageDetailsTable(content),
    };
  } catch (error) {
    console.error('[WorkflowRouting] Failed to parse artifact:', error);
    return null;
  }
}

export function isPhaseIncluded(plan: WorkflowRoutingPlan, phase: WorkflowPhase): boolean {
  return plan.phases[phase]?.included ?? true;
}

export function isStageIncluded(plan: WorkflowRoutingPlan, phase: WorkflowPhase, stage: string): boolean {
  const stageEntry = plan.stages.find((s) => s.phase === phase && s.stage === stage);
  return stageEntry?.included ?? true;
}

export const WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS = `A Level 1 Plan document must contain:
1. A header block with: Pathway, Risk Assessment, Risk Tier, Estimated Bolts, Estimated Depth, Generated date, Approved date
2. A "Phase Overview" table with columns: Phase | Included | Rationale — one row per phase (discovery, inception, construction, operations)
3. A "Stage Details" table with columns: # | Phase | Stage | Included | Rationale — one row per workflow stage
Pathway values: greenfield | brownfield-enhancement | brownfield-refactor | bugfix | optimization
Risk Assessment values: LOW | MEDIUM | HIGH
Estimated Depth values: minimal | standard | comprehensive`;

export function generatePlanVisualization(plan: WorkflowRoutingPlan): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart TD');
  lines.push('');

  lines.push('  classDef execute fill:#4CAF50,color:#fff,stroke:#388E3C');
  lines.push('  classDef skip fill:#BDBDBD,color:#424242,stroke:#9E9E9E');
  lines.push('  classDef conditional fill:#FFA726,color:#fff,stroke:#F57C00');
  lines.push('');

  const phaseOrder: WorkflowPhase[] = ['discovery', 'inception', 'construction', 'operations'];

  for (const phase of phaseOrder) {
    const phaseConfig = plan.phases[phase];
    const phaseId = phase.charAt(0).toUpperCase() + phase.slice(1);

    if (!phaseConfig.included) {
      const nodeId = `${phase}_skip`;
      lines.push(`  ${nodeId}["${phaseId} (SKIPPED)"]`);
      lines.push(`  class ${nodeId} skip`);
    } else {
      lines.push(`  subgraph ${phaseId}["${phaseId} Phase"]`);

      const phaseStages = plan.stages.filter((s) => s.phase === phase);
      for (const stage of phaseStages) {
        const stageId = `${phase}_${stage.stage.replace(/-/g, '_')}`;
        const label = stage.stage.replace(/-/g, ' ');

        if (stage.included) {
          lines.push(`    ${stageId}["${label}"]`);
          lines.push(`    class ${stageId} execute`);
        } else {
          lines.push(`    ${stageId}["${label} (SKIP)"]`);
          lines.push(`    class ${stageId} skip`);
        }
      }

      const stageIds = phaseStages.map((s) => `${phase}_${s.stage.replace(/-/g, '_')}`);
      for (let i = 0; i < stageIds.length - 1; i++) {
        lines.push(`    ${stageIds[i]} --> ${stageIds[i + 1]}`);
      }

      lines.push('  end');
    }
    lines.push('');
  }

  for (let i = 0; i < phaseOrder.length - 1; i++) {
    const currPhase = phaseOrder[i];
    const nextPhase = phaseOrder[i + 1];

    const currStages = plan.stages.filter((s) => s.phase === currPhase);
    const nextStages = plan.stages.filter((s) => s.phase === nextPhase);

    const currIncluded = plan.phases[currPhase].included;
    const nextIncluded = plan.phases[nextPhase].included;

    let fromId: string;
    let toId: string;

    if (currIncluded && currStages.length > 0) {
      fromId = `${currPhase}_${currStages[currStages.length - 1].stage.replace(/-/g, '_')}`;
    } else {
      fromId = `${currPhase}_skip`;
    }

    if (nextIncluded && nextStages.length > 0) {
      toId = `${nextPhase}_${nextStages[0].stage.replace(/-/g, '_')}`;
    } else {
      toId = `${nextPhase}_skip`;
    }

    if (!currIncluded || !nextIncluded) {
      lines.push(`  ${fromId} -.-> ${toId}`);
    } else {
      lines.push(`  ${fromId} --> ${toId}`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}
