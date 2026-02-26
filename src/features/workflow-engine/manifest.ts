/**
 * ODLC Artifact Manifest System
 *
 * Formal artifact tracking, versioning, and alignment verification for the
 * Olympus Development Life Cycle (ODLC) workflow engine.
 *
 * Key responsibilities:
 * - Create and manage manifest.json files
 * - Register and track artifacts with checksums
 * - Detect stale artifacts and cascade invalidation
 * - Link artifacts and manage dependency graphs
 * - Track alignment checks and gate audits
 * - Support manifest recovery when corrupted
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { createHash } from 'crypto';
import type {
  WorkflowPhase,
  ManifestSchema,
  ManifestArtifact,
  ArtifactLink,
  GateAuditEntry,
  PhaseState,
  AlignmentCheck,
  AlignmentVerificationResult,
  AlignmentValidationResult,
  RiskTierClassification,
  RiskEntry,
  DepthAssessment,
  MethodologyMetrics,
} from './phase-types.js';
import type { WorkflowStatus, WorkflowStage } from './types.js';

/**
 * Normalizes path separators to forward slashes for Windows compatibility.
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Creates initial phase state for a phase.
 */
function createInitialPhaseState(): PhaseState {
  return {
    status: 'not_started',
    started_at: null,
    completed_at: null,
    gate_result: null,
    gate_bypassed: false,
    bypass_reason: null,
  };
}

/**
 * Creates a new manifest.json at aidlc-docs/manifest.json.
 * Initializes with schema version 2.0.0 and empty structures.
 *
 * @param workflowId - Unique workflow identifier
 * @param featureName - Human-readable feature name
 * @param projectPath - Absolute path to project root
 * @returns Path to created manifest.json
 */
export function createManifest(
  workflowId: string,
  featureName: string,
  projectPath: string
): string {
  const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
  const manifestPath = path.join(workflowDir, 'manifest.json');

  try {
    fs.ensureDirSync(workflowDir);

    const now = new Date().toISOString();
    const manifest: ManifestSchema = {
      schema_version: '2.0.0',
      workflow_id: workflowId,
      feature_name: featureName,
      created_at: now,
      updated_at: now,
      phases: {
        discovery: createInitialPhaseState(),
        inception: createInitialPhaseState(),
        construction: createInitialPhaseState(),
        operations: createInitialPhaseState(),
      },
      depth_assessment: null,
      artifacts: [],
      links: [],
      risks: [],
      gate_audit: [],
      metrics: null,
      alignment_checks: [],
      risk_tier: null,
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    return manifestPath;
  } catch (error) {
    console.error(`Failed to create manifest at ${manifestPath}:`, error);
    throw error;
  }
}

/**
 * Loads and parses manifest.json from disk.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @returns Parsed manifest or null if not found/corrupt
 */
export function loadManifest(manifestPath: string): ManifestSchema | null {
  try {
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content) as ManifestSchema;
    return manifest;
  } catch (error) {
    console.error(`Failed to load manifest at ${manifestPath}:`, error);
    return null;
  }
}

/**
 * Writes manifest to disk with updated_at timestamp.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param manifest - Manifest object to save
 */
export function saveManifest(manifestPath: string, manifest: ManifestSchema): void {
  try {
    manifest.updated_at = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (error) {
    console.error(`Failed to save manifest at ${manifestPath}:`, error);
    throw error;
  }
}

/**
 * Computes SHA-256 checksum of file content.
 *
 * @param filePath - Absolute path to file
 * @returns Hex string checksum or null if file doesn't exist
 */
export function computeChecksum(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath);
    const hash = createHash('sha256');
    hash.update(content);
    return hash.digest('hex');
  } catch (error) {
    console.error(`Failed to compute checksum for ${filePath}:`, error);
    return null;
  }
}

/**
 * Registers or updates an artifact in the manifest.
 * If artifact with same ID exists: increments contract_version and updates fields.
 * If new: initializes with contract_version 1, status 'draft'.
 * Auto-computes checksum if file exists on disk.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifact - Artifact to register (without timestamps/contract fields)
 */
export function registerArtifact(
  manifestPath: string,
  artifact: Omit<
    ManifestArtifact,
    'created_at' | 'updated_at' | 'contract_version' | 'contract_status' | 'stale_reason'
  >
): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      throw new Error(`Manifest not found at ${manifestPath}`);
    }

    const now = new Date().toISOString();
    const normalizedPath = normalizePath(artifact.path);
    const existingIndex = manifest.artifacts.findIndex((a) => a.id === artifact.id);

    // Compute checksum if file exists
    const checksum = computeChecksum(artifact.path);

    if (existingIndex >= 0) {
      // Update existing artifact
      const existing = manifest.artifacts[existingIndex];
      manifest.artifacts[existingIndex] = {
        ...existing,
        ...artifact,
        path: normalizedPath,
        updated_at: now,
        contract_version: existing.contract_version + 1,
        checksum,
      };
    } else {
      // Create new artifact
      const newArtifact: ManifestArtifact = {
        ...artifact,
        path: normalizedPath,
        created_at: now,
        updated_at: now,
        contract_version: 1,
        contract_status: 'draft',
        stale_reason: null,
        checksum,
      };
      manifest.artifacts.push(newArtifact);
    }

    saveManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`Failed to register artifact in ${manifestPath}:`, error);
    throw error;
  }
}

/**
 * Links two artifacts in the manifest dependency graph.
 * Validates both artifacts exist. No duplicate links.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param link - Link definition
 */
export function linkArtifacts(manifestPath: string, link: ArtifactLink): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      throw new Error(`Manifest not found at ${manifestPath}`);
    }

    // Validate both artifacts exist
    const sourceExists = manifest.artifacts.some((a) => a.id === link.source_id);
    const targetExists = manifest.artifacts.some((a) => a.id === link.target_id);

    if (!sourceExists) {
      throw new Error(`Source artifact not found: ${link.source_id}`);
    }
    if (!targetExists) {
      throw new Error(`Target artifact not found: ${link.target_id}`);
    }

    // Check for duplicate link
    const duplicateExists = manifest.links.some(
      (l) =>
        l.source_id === link.source_id &&
        l.target_id === link.target_id &&
        l.link_type === link.link_type
    );

    if (!duplicateExists) {
      manifest.links.push(link);
      saveManifest(manifestPath, manifest);
    }
  } catch (error) {
    console.error(`Failed to link artifacts in ${manifestPath}:`, error);
    throw error;
  }
}

/**
 * Detects artifacts whose checksums have changed compared to stored values.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @returns Array of artifact IDs with changed checksums
 */
export function detectStaleArtifacts(manifestPath: string): string[] {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      return [];
    }

    const staleIds: string[] = [];

    for (const artifact of manifest.artifacts) {
      if (artifact.checksum && artifact.write_complete) {
        const currentChecksum = computeChecksum(artifact.path);
        if (currentChecksum && currentChecksum !== artifact.checksum) {
          staleIds.push(artifact.id);
        }
      }
    }

    return staleIds;
  } catch (error) {
    console.error(`Failed to detect stale artifacts in ${manifestPath}:`, error);
    return [];
  }
}

/**
 * Cascades invalidation when an artifact changes.
 * Marks the changed artifact and all downstream artifacts as 'stale'.
 * Follows the link graph recursively.
 * Uses state machine validation to only transition valid artifacts.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param changedArtifactId - ID of artifact that changed
 */
export function cascadeInvalidation(manifestPath: string, changedArtifactId: string): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      return;
    }

    const visited = new Set<string>();
    const toProcess: string[] = [changedArtifactId];

    while (toProcess.length > 0) {
      const currentId = toProcess.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      // Mark artifact as stale using in-memory transition helper
      const artifact = manifest.artifacts.find((a) => a.id === currentId);
      if (artifact) {
        const reason =
          currentId === changedArtifactId
            ? 'Artifact content was modified'
            : `Parent artifact ${currentId} was modified`;
        applyStaleTransitionInMemory(artifact, reason);
      }

      // Find downstream artifacts (where current is source)
      const downstreamLinks = manifest.links.filter((l) => l.source_id === currentId);
      for (const link of downstreamLinks) {
        if (!visited.has(link.target_id)) {
          toProcess.push(link.target_id);
        }
      }
    }

    saveManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`Failed to cascade invalidation in ${manifestPath}:`, error);
  }
}

/**
 * Runs an alignment check between two artifacts.
 * Creates placeholder check - real computation will be in alignment engine (Phase 4.5).
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param sourceId - Source artifact ID
 * @param targetId - Target artifact ID
 */
export function runAlignmentCheck(
  manifestPath: string,
  sourceId: string,
  targetId: string
): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      return;
    }

    const now = new Date().toISOString();

    const verification: AlignmentVerificationResult = {
      conformance_score: 0,
      coverage_percentage: 0,
      missing_items: [],
      passed: false,
    };

    const validation: AlignmentValidationResult = {
      alignment_score: 0,
      alignment_questions: [],
      passed: false,
    };

    const check: AlignmentCheck = {
      source_artifact_id: sourceId,
      target_artifact_id: targetId,
      verification,
      validation,
      alignment_passed: false,
      checked_at: now,
    };

    manifest.alignment_checks.push(check);
    saveManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`Failed to run alignment check in ${manifestPath}:`, error);
  }
}

/**
 * Recovers manifest from workflow directory when manifest.json is corrupt/missing.
 * Scans for artifact files and builds fresh manifest.
 *
 * @param projectPath - Absolute path to project root
 * @param workflowId - Workflow ID
 * @returns Recovered manifest or null if recovery fails
 */
export function recoverManifest(
  projectPath: string,
  workflowId: string
): ManifestSchema | null {
  try {
    const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
    if (!fs.existsSync(workflowDir)) {
      return null;
    }

    const now = new Date().toISOString();
    const manifest: ManifestSchema = {
      schema_version: '2.0.0',
      workflow_id: workflowId,
      feature_name: 'Recovered Workflow',
      created_at: now,
      updated_at: now,
      phases: {
        discovery: createInitialPhaseState(),
        inception: createInitialPhaseState(),
        construction: createInitialPhaseState(),
        operations: createInitialPhaseState(),
      },
      depth_assessment: null,
      artifacts: [],
      links: [],
      risks: [],
      gate_audit: [],
      metrics: null,
      alignment_checks: [],
      risk_tier: null,
    };

    // Scan for artifact files (basic recovery - looks for common patterns)
    const files = fs.readdirSync(workflowDir, { recursive: true, withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && file.name !== 'manifest.json') {
        const filePath = path.join(file.path, file.name);
        const relativePath = path.relative(workflowDir, filePath);
        const normalizedPath = normalizePath(filePath);

        // Basic artifact registration - phase/stage detection would need more logic
        const artifact: ManifestArtifact = {
          id: `recovered-${Date.now()}-${manifest.artifacts.length}`,
          type: path.extname(file.name) || 'unknown',
          phase: 'inception',
          stage: 'intent',
          path: normalizedPath,
          created_at: now,
          updated_at: now,
          validation_passed: null,
          write_complete: true,
          checksum: computeChecksum(filePath),
          contract_status: 'draft',
          contract_version: 1,
          stale_reason: null,
        };

        manifest.artifacts.push(artifact);
      }
    }

    return manifest;
  } catch (error) {
    console.error(`Failed to recover manifest for workflow ${workflowId}:`, error);
    return null;
  }
}

/**
 * Updates phase status in manifest.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param phase - Phase to update
 * @param status - New status
 * @param startedAt - Optional started_at timestamp
 * @param completedAt - Optional completed_at timestamp
 */
export function updatePhaseStatus(
  manifestPath: string,
  phase: WorkflowPhase,
  status: WorkflowStatus,
  startedAt?: string,
  completedAt?: string
): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      return;
    }

    manifest.phases[phase].status = status;
    if (startedAt !== undefined) {
      manifest.phases[phase].started_at = startedAt;
    }
    if (completedAt !== undefined) {
      manifest.phases[phase].completed_at = completedAt;
    }

    saveManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`Failed to update phase status in ${manifestPath}:`, error);
  }
}

/**
 * Adds a gate audit entry to the manifest.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param entry - Gate audit entry (timestamp added automatically)
 */
export function addGateAuditEntry(
  manifestPath: string,
  entry: Omit<GateAuditEntry, 'timestamp'>
): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      return;
    }

    const auditEntry: GateAuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };

    manifest.gate_audit.push(auditEntry);
    saveManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`Failed to add gate audit entry in ${manifestPath}:`, error);
  }
}

/**
 * Gets an artifact by ID from manifest.
 *
 * @param manifest - Manifest schema
 * @param id - Artifact ID
 * @returns Artifact or undefined if not found
 */
export function getArtifactById(
  manifest: ManifestSchema,
  id: string
): ManifestArtifact | undefined {
  return manifest.artifacts.find((a) => a.id === id);
}

/**
 * Gets all artifacts for a specific phase.
 *
 * @param manifest - Manifest schema
 * @param phase - Workflow phase
 * @returns Array of artifacts in that phase
 */
export function getArtifactsByPhase(
  manifest: ManifestSchema,
  phase: WorkflowPhase
): ManifestArtifact[] {
  return manifest.artifacts.filter((a) => a.phase === phase);
}

/**
 * Updates an artifact's contract status by delegating to the state machine.
 * Silently handles errors (missing manifest, missing artifact, invalid transitions).
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifactId - Artifact ID
 * @param status - New contract status
 * @param staleReason - Required if status is 'stale'
 */
export function updateContractStatus(
  manifestPath: string,
  artifactId: string,
  status: ManifestArtifact['contract_status'],
  staleReason?: string
): void {
  try {
    switch (status) {
      case 'draft':
        transitionToDraft(manifestPath, artifactId);
        break;
      case 'active':
        transitionToActive(manifestPath, artifactId);
        break;
      case 'fulfilled':
        transitionToFulfilled(manifestPath, artifactId);
        break;
      case 'violated':
        transitionToViolated(manifestPath, artifactId);
        break;
      case 'stale':
        if (!staleReason) {
          throw new Error('staleReason is required when setting status to "stale"');
        }
        transitionToStale(manifestPath, artifactId, staleReason);
        break;
    }
  } catch (error) {
    console.error(`Failed to update contract status in ${manifestPath}:`, error);
  }
}

/**
 * Returns all UNIT artifacts from manifest.
 *
 * @param manifest - Manifest schema
 * @returns Array of UNIT-stage artifacts
 */
export function getUnitArtifacts(manifest: ManifestSchema): ManifestArtifact[] {
  return manifest.artifacts.filter((a) => a.stage === 'unit');
}

/**
 * Returns all BOLT artifacts, optionally filtered by parent UNIT.
 *
 * @param manifest - Manifest schema
 * @param unitId - Optional UNIT ID to filter by
 * @returns Array of BOLT-stage artifacts
 */
export function getBoltArtifacts(manifest: ManifestSchema, unitId?: string): ManifestArtifact[] {
  const bolts = manifest.artifacts.filter((a) => a.stage === 'bolt');
  if (unitId) {
    // Filter by parent link: check manifest.links for link from unitId to bolt
    const boltIdsForUnit = new Set(
      manifest.links
        .filter((l) => l.source_id === unitId && (l.link_type === 'derives' || l.link_type === 'implements'))
        .map((l) => l.target_id)
    );
    return bolts.filter((b) => boltIdsForUnit.has(b.id));
  }
  return bolts;
}

/**
 * Returns BOLTs filtered by contract status.
 *
 * @param manifest - Manifest schema
 * @param status - Contract status to filter by
 * @returns Array of BOLT artifacts with matching status
 */
export function getBoltsByStatus(
  manifest: ManifestSchema,
  status: ManifestArtifact['contract_status']
): ManifestArtifact[] {
  return manifest.artifacts.filter((a) => a.stage === 'bolt' && a.contract_status === status);
}

/**
 * Returns true when ALL BOLT contracts have status 'fulfilled'.
 * Returns false if no BOLTs exist.
 *
 * @param manifest - Manifest schema
 * @returns true if all BOLTs are fulfilled, false otherwise
 */
export function isWorkflowComplete(manifest: ManifestSchema): boolean {
  const bolts = manifest.artifacts.filter((a) => a.stage === 'bolt');
  if (bolts.length === 0) return false;
  return bolts.every((b) => b.contract_status === 'fulfilled');
}

/**
 * Helper for applying stale transition in-memory during cascade.
 * Returns true if transition was applied, false if skipped.
 * During cascade, we mark artifacts as stale regardless of current state,
 * except if they're already stale or violated (already invalidated).
 *
 * NOTE: This allows fulfilled -> stale transitions ONLY during cascade invalidation.
 * This is a special exception to the normal state machine rules.
 *
 * @param artifact - Artifact to transition
 * @param reason - Reason for staleness
 * @returns true if transition applied, false if skipped
 */
function applyStaleTransitionInMemory(artifact: ManifestArtifact, reason: string): boolean {
  // Skip if already stale or violated (already invalidated)
  if (artifact.contract_status === 'stale' || artifact.contract_status === 'violated') {
    return false;
  }
  // NOTE: Allows fulfilled -> stale transition during cascade (special exception)
  artifact.contract_status = 'stale';
  artifact.stale_reason = reason;
  if (!artifact.statusHistory) artifact.statusHistory = [];
  artifact.statusHistory.push({ status: 'stale', timestamp: new Date().toISOString() });
  return true;
}

/**
 * Transitions artifact to 'draft' status.
 * Valid from: violated, stale
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifactId - Artifact ID to transition
 */
export function transitionToDraft(manifestPath: string, artifactId: string): void {
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found in manifest`);
  }

  // Valid from: violated, stale
  if (artifact.contract_status !== 'violated' && artifact.contract_status !== 'stale') {
    throw new Error(`Cannot transition from '${artifact.contract_status}' to 'draft'`);
  }

  artifact.contract_status = 'draft';
  artifact.stale_reason = null;
  if (!artifact.statusHistory) artifact.statusHistory = [];
  artifact.statusHistory.push({ status: 'draft', timestamp: new Date().toISOString() });

  saveManifest(manifestPath, manifest);
}

/**
 * Transitions artifact to 'active' status.
 * Valid from: draft, stale
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifactId - Artifact ID to transition
 */
export function transitionToActive(manifestPath: string, artifactId: string): void {
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found in manifest`);
  }

  // Valid from: draft, stale
  if (artifact.contract_status !== 'draft' && artifact.contract_status !== 'stale') {
    throw new Error(`Cannot transition from '${artifact.contract_status}' to 'active'`);
  }

  artifact.contract_status = 'active';
  artifact.stale_reason = null;
  if (!artifact.statusHistory) artifact.statusHistory = [];
  artifact.statusHistory.push({ status: 'active', timestamp: new Date().toISOString() });

  saveManifest(manifestPath, manifest);
}

/**
 * Transitions artifact to 'fulfilled' status.
 * Valid from: active ONLY
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifactId - Artifact ID to transition
 */
export function transitionToFulfilled(manifestPath: string, artifactId: string): void {
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found in manifest`);
  }

  // Valid from: active ONLY
  if (artifact.contract_status !== 'active') {
    throw new Error(`Cannot transition from '${artifact.contract_status}' to 'fulfilled'`);
  }

  artifact.contract_status = 'fulfilled';
  artifact.stale_reason = null;
  if (!artifact.statusHistory) artifact.statusHistory = [];
  artifact.statusHistory.push({ status: 'fulfilled', timestamp: new Date().toISOString() });

  saveManifest(manifestPath, manifest);
}

/**
 * Transitions artifact to 'violated' status.
 * Valid from: active ONLY
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifactId - Artifact ID to transition
 */
export function transitionToViolated(manifestPath: string, artifactId: string): void {
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found in manifest`);
  }

  // Valid from: active ONLY
  if (artifact.contract_status !== 'active') {
    throw new Error(`Cannot transition from '${artifact.contract_status}' to 'violated'`);
  }

  artifact.contract_status = 'violated';
  artifact.stale_reason = null;
  if (!artifact.statusHistory) artifact.statusHistory = [];
  artifact.statusHistory.push({ status: 'violated', timestamp: new Date().toISOString() });

  saveManifest(manifestPath, manifest);
}

/**
 * Transitions artifact to 'stale' status.
 * Valid from: active, fulfilled
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param artifactId - Artifact ID to transition
 * @param reason - Reason for staleness
 */
export function transitionToStale(manifestPath: string, artifactId: string, reason: string): void {
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const artifact = manifest.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    throw new Error(`Artifact ${artifactId} not found in manifest`);
  }

  // Valid from: active, fulfilled
  if (artifact.contract_status !== 'active' && artifact.contract_status !== 'fulfilled') {
    throw new Error(`Cannot transition from '${artifact.contract_status}' to 'stale'`);
  }

  artifact.contract_status = 'stale';
  artifact.stale_reason = reason;
  if (!artifact.statusHistory) artifact.statusHistory = [];
  artifact.statusHistory.push({ status: 'stale', timestamp: new Date().toISOString() });

  saveManifest(manifestPath, manifest);
}

/**
 * Result of revalidating stale artifacts.
 */
export interface RevalidationResult {
  restored: string[];   // artifact IDs restored to 'active'
  stillStale: string[]; // artifact IDs remaining stale
  errors: string[];     // any errors during revalidation
}

/**
 * Revalidates all stale artifacts against their parent and root INTENT artifacts.
 * Runs dual validation (parent + root checks) for each stale artifact.
 * If both checks pass, the artifact is restored to 'active' status.
 * If either check fails, the artifact remains 'stale'.
 *
 * @param projectPath - Absolute path to project root
 * @param workflowId - Workflow ID (unused but kept for API consistency)
 * @returns RevalidationResult with restored, stillStale, and errors arrays
 */
export async function revalidateStaleArtifacts(
  projectPath: string,
  workflowId: string
): Promise<RevalidationResult> {
  const result: RevalidationResult = { restored: [], stillStale: [], errors: [] };

  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    result.errors.push('Manifest not found');
    return result;
  }

  // Find all stale artifacts
  const staleArtifacts = manifest.artifacts.filter((a) => a.contract_status === 'stale');

  for (const artifact of staleArtifacts) {
    try {
      // Find the parent artifact via links
      const parentLink = manifest.links.find((l) => l.target_id === artifact.id);
      if (!parentLink) {
        result.stillStale.push(artifact.id);
        continue;
      }

      const parentArtifact = manifest.artifacts.find((a) => a.id === parentLink.source_id);
      if (!parentArtifact) {
        result.stillStale.push(artifact.id);
        continue;
      }

      // Find root INTENT artifact
      const intentArtifact = manifest.artifacts.find((a) => a.stage === 'intent');
      if (!intentArtifact) {
        result.stillStale.push(artifact.id);
        continue;
      }

      // Read artifact contents
      const artifactContent = fs.existsSync(artifact.path)
        ? fs.readFileSync(artifact.path, 'utf-8')
        : null;
      const parentContent = fs.existsSync(parentArtifact.path)
        ? fs.readFileSync(parentArtifact.path, 'utf-8')
        : null;
      const intentContent = fs.existsSync(intentArtifact.path)
        ? fs.readFileSync(intentArtifact.path, 'utf-8')
        : null;

      if (!artifactContent || !parentContent || !intentContent) {
        result.stillStale.push(artifact.id);
        continue;
      }

      // Determine transition types based on artifact stage
      const { runDualValidation } = await import('./alignment.js');
      let transition: 'intent-to-unit' | 'unit-to-bolt';
      let rootTransition: 'unit-to-intent' | 'bolt-to-intent';

      if (artifact.stage === 'unit') {
        transition = 'intent-to-unit';
        rootTransition = 'unit-to-intent';
      } else if (artifact.stage === 'bolt') {
        transition = 'unit-to-bolt';
        rootTransition = 'bolt-to-intent';
      } else {
        result.stillStale.push(artifact.id);
        continue;
      }

      // Run dual validation
      const dualResult = runDualValidation(
        artifactContent,
        parentContent,
        intentContent,
        transition,
        rootTransition,
        parentArtifact.id,
        artifact.id,
        intentArtifact.id
      );

      if (dualResult.passed) {
        // Restore to active status
        artifact.contract_status = 'active';
        artifact.stale_reason = null;
        if (!artifact.statusHistory) artifact.statusHistory = [];
        artifact.statusHistory.push({ status: 'active', timestamp: new Date().toISOString() });
        result.restored.push(artifact.id);
      } else {
        result.stillStale.push(artifact.id);
      }
    } catch (error) {
      result.errors.push(`Error revalidating ${artifact.id}: ${error}`);
      result.stillStale.push(artifact.id);
    }
  }

  // Save updated manifest
  saveManifest(manifestPath, manifest);

  return result;
}
