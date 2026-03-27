import type { PathwayType, BoltSpec, HierarchicalNode, WorkflowCheckpointV3 } from '../phase-types.js';
import { slugifyBoltName } from '../construction/decomposition.js';

/**
 * Determines whether a workflow is eligible for express bolt execution.
 *
 * Express bolts skip the elaboration stage entirely, suitable for
 * low-complexity or bugfix workflows.
 *
 * @param depthTarget - Depth score (1-11 scale)
 * @param pathway - The workflow pathway type
 * @returns true if depth_target <= 4 OR pathway is 'bugfix'
 */
export function isExpressBoltEligible(depthTarget: number, pathway: PathwayType): boolean {
  return depthTarget <= 4 || pathway === 'bugfix';
}

/**
 * Creates a single BoltSpec from a unit node for express execution.
 *
 * The bolt is configured with express_mode=true so the elaboration
 * stage is skipped during execution.
 *
 * @param unit - The transient HierarchicalNode representing the work
 * @param intent - Raw intent content (used for scope description)
 * @param checkpoint - Current workflow checkpoint (used to compute global bolt index)
 * @returns A fully-formed BoltSpec ready for registration and execution
 */
export function createExpressBolt(
  unit: HierarchicalNode,
  intent: string,
  checkpoint: WorkflowCheckpointV3
): BoltSpec {
  const existingBolts = checkpoint.construction_bolts
    ? Object.keys(checkpoint.construction_bolts).length
    : 0;
  const globalIndex = existingBolts + 1;

  const boltId = slugifyBoltName(unit.title, globalIndex);

  // Extract acceptance_criteria from unit if present (duck-typed)
  const unitAny = unit as any;
  const acceptanceCriteria: string[] =
    Array.isArray(unitAny.acceptance_criteria) && unitAny.acceptance_criteria.length > 0
      ? unitAny.acceptance_criteria
      : ['Implement as described in intent'];

  // Extract target_files from unit if present
  const targetFiles: string[] =
    Array.isArray(unitAny.target_files) ? unitAny.target_files : [];

  const bolt: BoltSpec = {
    id: boltId,
    type: 'bolt',
    title: unit.title,
    parent_id: unit.id,
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: unit.estimated_effort,
    parent_unit_id: unit.id,
    sequence: 1,
    scope: intent.substring(0, 500) || unit.title,
    acceptance_criteria: acceptanceCriteria,
    target_files: targetFiles,
    dependencies: [],
    requires_bolts: [],
    enables_bolts: [],
    requires_units: [],
    blocked: false,
    depth_target: 1,
    express_mode: true,
    estimated_effort_hours: unit.estimated_effort,
    requirements: [],
    stories: [],
    docs_impact: ['none'],
  };

  return bolt;
}
