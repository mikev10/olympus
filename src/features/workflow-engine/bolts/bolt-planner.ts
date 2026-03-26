import fs from 'fs-extra';
import path from 'path';
import type {
  BoltSpec,
  BoltStageProgress,
  ConstructionBoltProgress,
  WorkflowCheckpointV3,
  HierarchicalNode,
} from '../phase-types.js';
import { BoltSpecValidator } from './bolt-spec-validator.js';
import type { ValidationContext } from './bolt-spec-validator.js';
import { slugifyBoltName } from '../construction/decomposition.js';

export interface CoverageResult {
  coverage_percent: number;
  uncovered_criteria: string[];
  passed: boolean;
  requiresAcknowledgment: boolean;
}

export type BoltPlannerErrorCode =
  | 'AGENT_PARSE_FAILURE'
  | 'COVERAGE_HARD_BLOCK'
  | 'ARTIFACT_WRITE_FAILURE'
  | 'CHECKPOINT_UPDATE_FAILURE';

export class BoltPlannerError extends Error {
  readonly code: BoltPlannerErrorCode;

  constructor(code: BoltPlannerErrorCode, message: string) {
    super(message);
    this.name = 'BoltPlannerError';
    this.code = code;
  }
}

export function validateBoltCoverage(
  unitCriteria: string[],
  bolts: BoltSpec[]
): CoverageResult {
  if (unitCriteria.length === 0) {
    return {
      coverage_percent: 100,
      uncovered_criteria: [],
      passed: true,
      requiresAcknowledgment: false,
    };
  }

  const boltCriteriaPool: string[] = [];
  for (const bolt of bolts) {
    for (const criterion of bolt.acceptance_criteria) {
      boltCriteriaPool.push(criterion.toLowerCase());
    }
  }

  const uncovered: string[] = [];
  let coveredCount = 0;

  for (const unitCriterion of unitCriteria) {
    const lowerCriterion = unitCriterion.toLowerCase();
    const isCovered = boltCriteriaPool.some((bc) => bc.includes(lowerCriterion));
    if (isCovered) {
      coveredCount++;
    } else {
      uncovered.push(unitCriterion);
    }
  }

  const coverage_percent = Math.round((coveredCount / unitCriteria.length) * 100);

  if (coverage_percent >= 95) {
    return {
      coverage_percent,
      uncovered_criteria: uncovered,
      passed: true,
      requiresAcknowledgment: false,
    };
  }

  if (coverage_percent >= 80) {
    return {
      coverage_percent,
      uncovered_criteria: uncovered,
      passed: true,
      requiresAcknowledgment: true,
    };
  }

  return {
    coverage_percent,
    uncovered_criteria: uncovered,
    passed: false,
    requiresAcknowledgment: false,
  };
}

export async function writeBoltArtifacts(
  bolts: BoltSpec[],
  projectPath: string,
  workflowId: string
): Promise<void> {
  try {
    for (const bolt of bolts) {
      const boltDir = path.join(
        projectPath,
        'aidlc-docs',
        workflowId,
        'construction',
        'bolts',
        bolt.id
      );
      await fs.ensureDir(boltDir);

      const frontmatter = [
        '---',
        `id: ${bolt.id}`,
        `title: "${bolt.title}"`,
        `parent_unit_id: ${bolt.parent_unit_id}`,
        `sequence: ${bolt.sequence}`,
        `depth_target: ${bolt.depth_target}`,
        `express_mode: ${bolt.express_mode}`,
        `estimated_effort_hours: ${bolt.estimated_effort_hours}`,
        '---',
      ].join('\n');

      const acList = bolt.acceptance_criteria.map((c) => `- ${c}`).join('\n');
      const filesList =
        bolt.target_files.length > 0
          ? bolt.target_files.map((f) => `- ${f}`).join('\n')
          : 'None';
      const depsList =
        bolt.dependencies.length > 0
          ? bolt.dependencies.map((d) => `- ${d}`).join('\n')
          : 'None';

      const specContent = [
        frontmatter,
        '',
        `# ${bolt.title}`,
        '',
        '## Scope',
        '',
        bolt.scope,
        '',
        '## Acceptance Criteria',
        '',
        acList,
        '',
        '## Target Files',
        '',
        filesList,
        '',
        '## Dependencies',
        '',
        depsList,
        '',
      ].join('\n');

      await fs.writeFile(path.join(boltDir, 'spec.md'), specContent, 'utf-8');
    }

    if (bolts.length > 0) {
      const parentUnitId = bolts[0].parent_unit_id;
      const planDir = path.join(
        projectPath,
        'aidlc-docs',
        workflowId,
        'construction',
        'plans'
      );
      await fs.ensureDir(planDir);

      const summaryLines = [
        `# Bolt Plan: ${parentUnitId}`,
        '',
        `Generated: ${new Date().toISOString()}`,
        '',
        '## Bolts',
        '',
      ];
      for (const bolt of bolts) {
        summaryLines.push(
          `### ${bolt.id}: ${bolt.title}`,
          '',
          `- **Sequence**: ${bolt.sequence}`,
          `- **Depth**: ${bolt.depth_target}`,
          `- **Express**: ${bolt.express_mode}`,
          `- **Effort**: ${bolt.estimated_effort_hours}h`,
          ''
        );
      }

      await fs.writeFile(
        path.join(planDir, `${parentUnitId}-bolt-plan.md`),
        summaryLines.join('\n'),
        'utf-8'
      );
    }
  } catch (error) {
    throw new BoltPlannerError(
      'ARTIFACT_WRITE_FAILURE',
      `Failed to write bolt artifacts: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function createInitialStageProgress(): BoltStageProgress {
  return {
    status: 'not_started',
    started_at: null,
    completed_at: null,
    failure_count: 0,
    last_error: null,
    artifact_path: null,
  };
}

export function registerBoltsInCheckpoint(
  bolts: BoltSpec[],
  checkpoint: WorkflowCheckpointV3
): void {
  if (!checkpoint.construction_bolts) {
    checkpoint.construction_bolts = {};
  }

  for (const bolt of bolts) {
    const progress: ConstructionBoltProgress = {
      bolt_id: bolt.id,
      parent_unit_id: bolt.parent_unit_id,
      status: 'planned',
      stages: {
        elaboration: createInitialStageProgress(),
        code_generation: createInitialStageProgress(),
        build_and_test: createInitialStageProgress(),
        review: createInitialStageProgress(),
      },
      failure_count: 0,
      last_error: null,
      review_score: null,
      acknowledged_by: null,
      acknowledged_at: null,
    };
    checkpoint.construction_bolts[bolt.id] = progress;
  }
}

const MAX_BOLTS_PER_UNIT = 8;

export function buildDecompositionPrompt(
  unit: HierarchicalNode,
  intent: string,
  depth: number
): string {
  const intentSummary = intent.length > 500 ? intent.substring(0, 500) + '...' : intent;
  const acSection =
    'acceptance_criteria' in unit && Array.isArray((unit as any).acceptance_criteria)
      ? (unit as any).acceptance_criteria.map((c: string) => `- ${c}`).join('\n')
      : '(none provided)';

  return [
    'You are decomposing a construction unit into sequential bolts (small executable work items).',
    '',
    `## Unit: ${unit.id}`,
    `**Title**: ${unit.title}`,
    `**Estimated effort**: ${unit.estimated_effort} hours`,
    '',
    '### Acceptance Criteria',
    acSection,
    '',
    '### Intent Summary',
    intentSummary,
    '',
    `### Depth Level: ${depth} (1-11 scale)`,
    '',
    '### Decomposition Rules',
    `- Maximum ${MAX_BOLTS_PER_UNIT} bolts per unit`,
    '- Each bolt must cover at least one acceptance criterion',
    '- Bolts are executed sequentially',
    '- Each bolt must specify target_files',
    '- Achieve >= 95% acceptance criteria coverage across all bolts',
    '',
    '### Required Output Format',
    'Return a JSON array of bolt objects. Each object must have:',
    '- `title` (string): Short descriptive name',
    '- `scope` (string): What this bolt accomplishes',
    '- `acceptance_criteria` (string[]): Verifiable outcomes (min 1)',
    '- `target_files` (string[]): Relative file paths to modify/create',
    '- `dependencies` (string[]): IDs of preceding bolts (or empty array)',
    '- `estimated_effort_hours` (number): Estimated duration in hours',
    '',
    'Return ONLY the JSON array, no other text.',
  ].join('\n');
}

interface RawBoltFromAgent {
  title: string;
  scope: string;
  acceptance_criteria: string[];
  target_files: string[];
  dependencies: string[];
  estimated_effort_hours: number;
}

export function parseAgentResponse(
  response: string,
  unit: HierarchicalNode,
  startIndex: number,
  depth: number
): BoltSpec[] {
  let rawBolts: RawBoltFromAgent[];

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in response');
    }
    rawBolts = JSON.parse(jsonMatch[0]);
  } catch (error) {
    throw new BoltPlannerError(
      'AGENT_PARSE_FAILURE',
      `Failed to parse agent response as JSON array: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!Array.isArray(rawBolts)) {
    throw new BoltPlannerError(
      'AGENT_PARSE_FAILURE',
      'Agent response parsed but is not an array'
    );
  }

  const expressMode = depth <= 4;

  const bolts: BoltSpec[] = rawBolts.map((raw, i) => {
    const globalIndex = startIndex + i;
    const id = slugifyBoltName(raw.title || '', globalIndex);

    return {
      id,
      type: 'bolt' as const,
      title: raw.title || 'Untitled Bolt',
      parent_id: unit.id,
      children_ids: [],
      status: 'pending' as const,
      assigned_agent: null,
      estimated_effort: raw.estimated_effort_hours || 0,
      parent_unit_id: unit.id,
      sequence: i + 1,
      scope: raw.scope || '',
      acceptance_criteria: raw.acceptance_criteria || [],
      target_files: raw.target_files || [],
      dependencies: raw.dependencies || [],
      depth_target: depth,
      express_mode: expressMode,
      estimated_effort_hours: raw.estimated_effort_hours || 0,
    };
  });

  const existingBoltsTotal = startIndex - 1;
  for (let i = 0; i < bolts.length; i++) {
    const context: ValidationContext = {
      existing_bolts_in_unit: i,
      existing_bolts_total: existingBoltsTotal + i,
    };
    BoltSpecValidator.validate(bolts[i], context);
  }

  return bolts;
}

export async function planBoltsForUnit(
  unit: HierarchicalNode,
  intent: string,
  depth: number,
  checkpoint: WorkflowCheckpointV3,
  projectPath: string,
  workflowId: string
): Promise<{ bolts: BoltSpec[]; coverage: CoverageResult }> {
  const startIndex = Object.keys(checkpoint.construction_bolts ?? {}).length + 1;

  const prompt = buildDecompositionPrompt(unit, intent, depth);

  void prompt;
  void startIndex;

  throw new BoltPlannerError(
    'AGENT_PARSE_FAILURE',
    'planBoltsForUnit is a coordination entry point. Use buildDecompositionPrompt + parseAgentResponse + writeBoltArtifacts + registerBoltsInCheckpoint individually.'
  );
}

export async function finalizeBoltPlan(
  bolts: BoltSpec[],
  unit: HierarchicalNode,
  checkpoint: WorkflowCheckpointV3,
  projectPath: string,
  workflowId: string
): Promise<{ bolts: BoltSpec[]; coverage: CoverageResult }> {
  const unitCriteria: string[] =
    'acceptance_criteria' in unit && Array.isArray((unit as any).acceptance_criteria)
      ? (unit as any).acceptance_criteria
      : [];

  const coverage = validateBoltCoverage(unitCriteria, bolts);

  if (!coverage.passed) {
    throw new BoltPlannerError(
      'COVERAGE_HARD_BLOCK',
      `Bolt coverage is ${coverage.coverage_percent}% (below 80% threshold). Uncovered: ${coverage.uncovered_criteria.join(', ')}`
    );
  }

  await writeBoltArtifacts(bolts, projectPath, workflowId);
  registerBoltsInCheckpoint(bolts, checkpoint);

  return { bolts, coverage };
}

export const BoltPlanner = {
  buildDecompositionPrompt,
  parseAgentResponse,
  validateBoltCoverage,
  writeBoltArtifacts,
  registerBoltsInCheckpoint,
  planBoltsForUnit,
  finalizeBoltPlan,
};
