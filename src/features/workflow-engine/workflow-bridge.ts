/**
 * Workflow Bridge
 *
 * Glue layer connecting execution modes (/ascent, /olympus, /ultrawork)
 * to the manifest/checkpoint system. Provides context detection, bolt/unit
 * lifecycle management, progress tracking, and execution plan generation
 * for the ODLC 4-stage pipeline (idea -> intent -> unit -> bolt -> complete).
 */

import * as path from 'path';
import * as fs from 'fs-extra';
import type {
  WorkflowPhase,
  ManifestSchema,
  WorkflowCheckpointV3,
  GateResult,
  ManifestArtifact,
} from './phase-types.js';
import type { WorkflowStage } from './types.js';
import {
  loadManifest,
  saveManifest,
  getBoltArtifacts,
  getUnitArtifacts,
  getBoltsByStatus,
  isWorkflowComplete as manifestIsWorkflowComplete,
  transitionToActive,
  transitionToFulfilled,
} from './manifest.js';
import { loadCheckpoint, saveCheckpoint, listWorkflows } from './checkpoint.js';
import { loadTrustState } from './trust.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowBridgeContext {
  workflowId: string;
  featureName: string;
  currentPhase: WorkflowPhase;
  currentStage: WorkflowStage;
  manifest: ManifestSchema;
  checkpoint: WorkflowCheckpointV3;
  trustLevel: number;
  riskTier: number;
  depthScore: number;
  pendingBolts: string[];
  completedBolts: string[];
  pendingUnits: string[];
  executionMode: string;
}

// ============================================================================
// Core Detection
// ============================================================================

/**
 * Detects an active workflow in the given project path.
 * Loads manifest, checkpoint, and trust state to build a WorkflowBridgeContext.
 *
 * @param projectPath - Absolute path to the project root
 * @returns WorkflowBridgeContext if active workflow exists, null otherwise
 */
export async function detectActiveWorkflow(
  projectPath: string
): Promise<WorkflowBridgeContext | null> {
  try {
    // Get workflow IDs from checkpoint to find the manifest
    const workflowIds = await listWorkflows(projectPath);
    if (workflowIds.length === 0) {
      return null;
    }

    const workflowId = workflowIds[0];
    const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      return null;
    }

    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) {
      return null;
    }

    // Load trust state
    const trustState = loadTrustState(projectPath);

    // Build pending/completed bolt lists
    const pending = getPendingBolts(manifest);
    const completedBoltArtifacts = getBoltsByStatus(manifest, 'fulfilled');
    const completed = completedBoltArtifacts.map((b) => b.id);

    // Build pending units list
    const unitArtifacts = getUnitArtifacts(manifest);
    const pendingUnits = unitArtifacts
      .filter((u) => u.contract_status !== 'fulfilled')
      .map((u) => u.id);

    return {
      workflowId: checkpoint.workflow_id,
      featureName: checkpoint.feature_name,
      currentPhase: checkpoint.current_phase,
      currentStage: checkpoint.current_stage,
      manifest,
      checkpoint,
      trustLevel: trustState.current_level,
      riskTier: checkpoint.risk_tier ?? 0,
      depthScore: checkpoint.depth_score ?? 0,
      pendingBolts: pending,
      completedBolts: completed,
      pendingUnits,
      executionMode: checkpoint.execution_mode ?? 'manual',
    };
  } catch (error) {
    console.error('[WorkflowBridge] Failed to detect active workflow:', error);
    return null;
  }
}

// ============================================================================
// Bolt/Unit Queries
// ============================================================================

/**
 * Returns IDs of BOLT artifacts where contract_status is not 'fulfilled'.
 *
 * @param manifest - The manifest schema to query
 * @returns Array of BOLT artifact IDs that are not yet fulfilled
 */
export function getPendingBolts(manifest: ManifestSchema): string[] {
  const allBolts = getBoltArtifacts(manifest);
  return allBolts
    .filter((b) => b.contract_status !== 'fulfilled')
    .map((b) => b.id);
}

/**
 * Returns BOLT IDs in dependency order.
 * UNITs are ordered by their ID, BOLTs within each UNIT are ordered by their ID.
 * Orphan BOLTs (no parent UNIT link) are appended at the end.
 *
 * @param manifest - The manifest schema to query
 * @returns Array of BOLT artifact IDs in execution order
 */
export function getExecutionOrder(manifest: ManifestSchema): string[] {
  const units = getUnitArtifacts(manifest);
  const allBolts = getBoltArtifacts(manifest);

  // Sort units by ID
  const sortedUnits = [...units].sort((a, b) => a.id.localeCompare(b.id));

  const orderedBoltIds: string[] = [];
  const assignedBoltIds = new Set<string>();

  // Walk units in order, then bolts within each unit in order
  for (const unit of sortedUnits) {
    const unitBolts = getBoltArtifacts(manifest, unit.id);
    const sortedBolts = [...unitBolts].sort((a, b) => a.id.localeCompare(b.id));
    for (const bolt of sortedBolts) {
      orderedBoltIds.push(bolt.id);
      assignedBoltIds.add(bolt.id);
    }
  }

  // Append orphan bolts (those not linked to any unit)
  const orphanBolts = allBolts
    .filter((b) => !assignedBoltIds.has(b.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const bolt of orphanBolts) {
    orderedBoltIds.push(bolt.id);
  }

  return orderedBoltIds;
}

// ============================================================================
// Bolt/Unit Lifecycle
// ============================================================================

/**
 * Marks a BOLT as complete (fulfilled) and updates checkpoint state.
 * Transitions the BOLT artifact to 'fulfilled', sets executedBy/reviewedBy,
 * and advances active_bolt_id to the next pending BOLT.
 *
 * @param projectPath - Absolute path to the project root
 * @param workflowId - The workflow ID
 * @param boltId - The BOLT artifact ID to mark complete
 * @param gateResult - The gate review result
 */
export async function markBoltComplete(
  projectPath: string,
  workflowId: string,
  boltId: string,
  gateResult: GateResult
): Promise<void> {
  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
  let manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  let artifact = manifest.artifacts.find((a) => a.id === boltId);
  if (!artifact) {
    throw new Error(`BOLT artifact ${boltId} not found in manifest`);
  }

  // Use state machine for transitions: draft -> active -> fulfilled
  if (artifact.contract_status === 'draft') {
    transitionToActive(manifestPath, boltId);
  }

  // Reload manifest after potential active transition
  manifest = loadManifest(manifestPath)!;
  artifact = manifest.artifacts.find((a) => a.id === boltId)!;

  if (artifact.contract_status === 'active') {
    transitionToFulfilled(manifestPath, boltId);
  } else if (artifact.contract_status !== 'fulfilled') {
    throw new Error(
      `Cannot transition BOLT ${boltId} from '${artifact.contract_status}' to 'fulfilled'`
    );
  }

  // Reload manifest to set audit trail fields
  manifest = loadManifest(manifestPath)!;
  artifact = manifest.artifacts.find((a) => a.id === boltId)!;
  artifact.executedBy = gateResult.approved_by ?? null;
  artifact.reviewedBy = gateResult.approved_by ?? null;
  saveManifest(manifestPath, manifest);

  // Update checkpoint: advance active_bolt_id to next pending bolt
  const checkpoint = await loadCheckpoint(projectPath, workflowId);
  if (checkpoint) {
    const pending = getPendingBolts(manifest);
    const executionOrder = getExecutionOrder(manifest);
    // Find the first pending bolt in execution order
    const nextBolt = executionOrder.find((id) => pending.includes(id));
    checkpoint.active_bolt_id = nextBolt ?? undefined;
    await saveCheckpoint(projectPath, checkpoint);
  }
}

/**
 * Marks a UNIT as complete (fulfilled) and updates checkpoint state.
 * Transitions the UNIT artifact to 'fulfilled' and advances active_unit_id.
 *
 * @param projectPath - Absolute path to the project root
 * @param workflowId - The workflow ID
 * @param unitId - The UNIT artifact ID to mark complete
 */
export async function markUnitComplete(
  projectPath: string,
  workflowId: string,
  unitId: string
): Promise<void> {
  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
  let manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  let artifact = manifest.artifacts.find((a) => a.id === unitId);
  if (!artifact) {
    throw new Error(`UNIT artifact ${unitId} not found in manifest`);
  }

  // Use state machine for transitions — each call loads/saves internally, requiring reloads
  if (artifact.contract_status === 'draft') {
    transitionToActive(manifestPath, unitId);
  }

  manifest = loadManifest(manifestPath)!;
  artifact = manifest.artifacts.find((a) => a.id === unitId)!;

  if (artifact.contract_status === 'active') {
    transitionToFulfilled(manifestPath, unitId);
  } else if (artifact.contract_status !== 'fulfilled') {
    throw new Error(
      `Cannot transition UNIT ${unitId} from '${artifact.contract_status}' to 'fulfilled'`
    );
  }

  manifest = loadManifest(manifestPath)!;
  saveManifest(manifestPath, manifest);

  // Update checkpoint: advance active_unit_id to next pending unit
  const checkpoint = await loadCheckpoint(projectPath, workflowId);
  if (checkpoint) {
    const units = getUnitArtifacts(manifest);
    const pendingUnits = units
      .filter((u) => u.contract_status !== 'fulfilled')
      .sort((a, b) => a.id.localeCompare(b.id));
    checkpoint.active_unit_id = pendingUnits.length > 0 ? pendingUnits[0].id : undefined;
    await saveCheckpoint(projectPath, checkpoint);
  }
}

// ============================================================================
// Workflow Status
// ============================================================================

/**
 * Re-export isWorkflowComplete from manifest.ts.
 * Returns true when ALL BOLT contracts have status 'fulfilled'.
 * Returns false if no BOLTs exist.
 */
export const isWorkflowComplete = manifestIsWorkflowComplete;

/**
 * Returns progress counts for BOLT artifacts in the workflow.
 *
 * @param manifest - The manifest schema to query
 * @returns Object with completed count, total count, and percentage
 */
export function getWorkflowProgress(manifest: ManifestSchema): {
  completed: number;
  total: number;
  percentage: number;
} {
  const allBolts = getBoltArtifacts(manifest);
  const total = allBolts.length;
  if (total === 0) {
    return { completed: 0, total: 0, percentage: 0 };
  }
  const completed = allBolts.filter((b) => b.contract_status === 'fulfilled').length;
  const percentage = Math.round((completed / total) * 100);
  return { completed, total, percentage };
}

// ============================================================================
// Summary / Plan Generation
// ============================================================================

/**
 * Reads the title (first heading) from a bolt spec file.
 * Falls back to the artifact ID if the file doesn't exist or has no heading.
 *
 * @param filePath - Absolute path to the bolt spec file
 * @param fallbackId - The artifact ID to use as fallback
 * @returns The title string
 */
function readBoltTitle(filePath: string, fallbackId: string): string {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackId;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return trimmed.slice(2).trim();
      }
    }
    return fallbackId;
  } catch {
    return fallbackId;
  }
}

/**
 * Finds the parent UNIT ID for a given BOLT by checking manifest links.
 *
 * @param manifest - The manifest schema
 * @param boltId - The BOLT artifact ID
 * @returns The parent UNIT ID or null if not linked
 */
function findParentUnitId(manifest: ManifestSchema, boltId: string): string | null {
  const link = manifest.links.find(
    (l) =>
      l.target_id === boltId &&
      (l.link_type === 'derives' || l.link_type === 'implements')
  );
  return link?.source_id ?? null;
}

/**
 * Suggests an agent based on the bolt spec path.
 * If path contains UI/component keywords, suggests frontend-engineer; else olympian.
 *
 * @param boltPath - The artifact path
 * @returns Suggested agent name
 */
function suggestAgent(boltPath: string): string {
  const lower = boltPath.toLowerCase();
  const frontendKeywords = ['ui', 'component', 'frontend', 'style', 'css', 'layout', 'page', 'view'];
  for (const kw of frontendKeywords) {
    if (lower.includes(kw)) {
      return 'frontend-engineer';
    }
  }
  return 'olympian';
}

/**
 * Generates a human-readable workflow summary.
 * Returns empty string if no active workflow is found.
 *
 * @param projectPath - Absolute path to the project root
 * @returns Formatted summary text
 */
export async function generateWorkflowSummary(projectPath: string): Promise<string> {
  try {
    const ctx = await detectActiveWorkflow(projectPath);
    if (!ctx) {
      return '';
    }

    const progress = getWorkflowProgress(ctx.manifest);
    const allBolts = getBoltArtifacts(ctx.manifest);

    // Build pending bolts section
    const pendingLines: string[] = [];
    for (const boltId of ctx.pendingBolts) {
      const bolt = allBolts.find((b) => b.id === boltId);
      if (!bolt) continue;
      const parentUnitId = findParentUnitId(ctx.manifest, boltId);
      const specPath = parentUnitId
        ? path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', parentUnitId, `${boltId}.md`)
        : path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', `${boltId}.md`);
      const title = readBoltTitle(specPath, boltId);
      const unitSuffix = parentUnitId ? ` (${parentUnitId})` : '';
      pendingLines.push(`- ${boltId} "${title}"${unitSuffix}`);
    }

    // Build completed bolts section
    const completedLines: string[] = [];
    for (const boltId of ctx.completedBolts) {
      const bolt = allBolts.find((b) => b.id === boltId);
      if (!bolt) continue;
      const parentUnitId = findParentUnitId(ctx.manifest, boltId);
      const specPath = parentUnitId
        ? path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', parentUnitId, `${boltId}.md`)
        : path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', `${boltId}.md`);
      const title = readBoltTitle(specPath, boltId);
      completedLines.push(`- ${boltId} "${title}" done`);
    }

    const lines: string[] = [
      '## Active Workflow',
      `Workflow: ${ctx.featureName} (${ctx.workflowId})`,
      `Phase: ${ctx.currentPhase} | Stage: ${ctx.currentStage}`,
      `Trust: Level ${ctx.trustLevel} | Risk: Tier ${ctx.riskTier} | Depth: ${ctx.depthScore}`,
      `Mode: ${ctx.executionMode}`,
      '',
      '### Progress',
      `BOLTs: ${progress.completed}/${progress.total} (${progress.percentage}%)`,
    ];

    if (pendingLines.length > 0) {
      lines.push('', '### Pending BOLTs:');
      lines.push(...pendingLines);
    }

    if (completedLines.length > 0) {
      lines.push('', '### Completed BOLTs:');
      lines.push(...completedLines);
    }

    return lines.join('\n');
  } catch (error) {
    console.error('[WorkflowBridge] Failed to generate workflow summary:', error);
    return '';
  }
}

/**
 * Generates a structured bolt execution plan.
 * Returns empty string if no active workflow is found.
 *
 * @param projectPath - Absolute path to the project root
 * @returns Formatted execution plan text
 */
export async function generateBoltExecutionPlan(projectPath: string): Promise<string> {
  try {
    const ctx = await detectActiveWorkflow(projectPath);
    if (!ctx) {
      return '';
    }

    const allBolts = getBoltArtifacts(ctx.manifest);
    const executionOrder = getExecutionOrder(ctx.manifest);
    const pendingSet = new Set(ctx.pendingBolts);
    const units = getUnitArtifacts(ctx.manifest);

    // Build pending bolts section (in execution order)
    const pendingLines: string[] = [];
    let idx = 1;
    for (const boltId of executionOrder) {
      if (!pendingSet.has(boltId)) continue;
      const bolt = allBolts.find((b) => b.id === boltId);
      if (!bolt) continue;

      const parentUnitId = findParentUnitId(ctx.manifest, boltId);
      const specPath = parentUnitId
        ? path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', parentUnitId, `${boltId}.md`)
        : path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', `${boltId}.md`);
      const title = readBoltTitle(specPath, boltId);
      const agent = suggestAgent(bolt.path);

      let unitLabel = '';
      if (parentUnitId) {
        const unitArtifact = units.find((u) => u.id === parentUnitId);
        const unitSpecPath = path.join(
          projectPath,
          'aidlc-docs',
          ctx.workflowId,
          'construction',
          parentUnitId,
          'spec.md'
        );
        const unitTitle = readBoltTitle(unitSpecPath, parentUnitId);
        unitLabel = ` (${parentUnitId}: ${unitTitle})`;
      }

      pendingLines.push(`${idx}. ${boltId} "${title}"${unitLabel}`);
      pendingLines.push(`   Agent: ${agent} | Files: ${bolt.path}`);
      idx++;
    }

    // Build completed bolts section
    const completedLines: string[] = [];
    for (const boltId of ctx.completedBolts) {
      const bolt = allBolts.find((b) => b.id === boltId);
      if (!bolt) continue;
      const parentUnitId = findParentUnitId(ctx.manifest, boltId);
      const specPath = parentUnitId
        ? path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', parentUnitId, `${boltId}.md`)
        : path.join(projectPath, 'aidlc-docs', ctx.workflowId, 'construction', `${boltId}.md`);
      const title = readBoltTitle(specPath, boltId);
      completedLines.push(`- ${boltId} "${title}" done (fulfilled)`);
    }

    const lines: string[] = [
      '## Workflow Execution Plan',
      `Workflow: ${ctx.featureName} (${ctx.workflowId})`,
      `Phase: ${ctx.currentPhase} | Trust: Level ${ctx.trustLevel} | Risk: Tier ${ctx.riskTier}`,
    ];

    if (pendingLines.length > 0) {
      lines.push('', '### Pending BOLTs (execute in this order):');
      lines.push(...pendingLines);
    }

    if (completedLines.length > 0) {
      lines.push('', '### Completed BOLTs:');
      lines.push(...completedLines);
    }

    lines.push('', '### Instructions:');
    lines.push(
      'For each pending BOLT: read its spec file, dispatch to the listed agent, then present Gate 4 review.'
    );

    return lines.join('\n');
  } catch (error) {
    console.error('[WorkflowBridge] Failed to generate bolt execution plan:', error);
    return '';
  }
}
