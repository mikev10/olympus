import * as path from 'path';
import * as fs from 'fs-extra';
import { WorkflowStage } from './types.js';
import { WorkflowPhase } from './phase-types.js';

export type ArtifactType =
  | 'idea'
  | 'intent'
  | 'nfr'
  | 'unit'
  | 'bolt'
  | 'validation-report'
  | 'interfaces'
  | 'data-flow'
  | 'components'
  | 'deploy-guide'
  | 'runbook'
  | 'monitoring'
  | 'release-notes'
  | 'state'
  | 'audit'
  | 'analysis-plan'
  | 'current-state-analysis'
  | 'regression-baseline'
  | 'change-impact'
  | 'static-model'
  | 'dynamic-model';

/**
 * Ensures the workflow directory structure exists.
 * Creates:
 * - aidlc-docs/
 * - aidlc-docs/inception/
 * - aidlc-docs/construction/
 * - aidlc-docs/construction/design/
 * - aidlc-docs/operations/
 * - aidlc-docs/checkpoint.json (if not exists)
 *
 * Note: Per-unit directories (UNIT-001/, etc.) are created on-demand, not upfront.
 *
 * Idempotent - safe to call multiple times.
 * @throws Error if disk is full or permissions are denied
 */
export async function ensureWorkflowDir(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, 'aidlc-docs');
  const checkpointPath = path.join(workflowDir, 'checkpoint.json');

  try {
    // Create directories
    await fs.ensureDir(workflowDir);
    await fs.ensureDir(path.join(workflowDir, 'inception'));
    await fs.ensureDir(path.join(workflowDir, 'construction'));
    await fs.ensureDir(path.join(workflowDir, 'construction', 'design'));
    await fs.ensureDir(path.join(workflowDir, 'operations'));

    // Initialize checkpoint.json if it doesn't exist
    if (!await fs.pathExists(checkpointPath)) {
      await fs.writeJson(checkpointPath, {
        workflow_id: workflowId,
        current_stage: 'idea',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { spaces: 2 });
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to create workflow directory: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Attempted path: ${workflowDir}`);
      throw new Error(
        'Failed to create workflow directory: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to create workflow directory: Permission denied`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        `Failed to create workflow directory: Permission denied for ${workflowDir}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to create workflow directory: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        'Failed to create workflow directory: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to create workflow directory: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    console.error(`[Artifacts] Path: ${workflowDir}`);
    throw new Error(
      `Failed to create workflow directory for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Returns the file path for a given artifact type.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @param artifactType - Type of artifact (idea, intent, unit, bolt, etc.)
 * @param artifactId - Optional ID for unit/bolt/validation-report artifacts (required for certain types)
 * @param unitId - Optional unit ID (required for 'bolt' artifacts to determine parent unit directory)
 * @throws Error if artifactType is 'complete' (no artifact for complete stage)
 * @throws Error if required parameters are missing for specific artifact types
 */
export function getArtifactPath(
  projectPath: string,
  workflowId: string,
  artifactType: ArtifactType,
  artifactId?: string,
  unitId?: string
): string {
  const workflowDir = path.join(projectPath, 'aidlc-docs');

  // Mapping for artifact types to paths
  switch (artifactType) {
    case 'idea':
      return path.join(workflowDir, 'inception', 'idea.md');
    case 'intent':
      return path.join(workflowDir, 'inception', 'intent.md');
    case 'nfr':
      return path.join(workflowDir, 'inception', 'nfr.md');
    case 'unit':
      if (!artifactId) {
        throw new Error('artifactId is required for unit artifacts');
      }
      return path.join(workflowDir, 'construction', artifactId, 'spec.md');
    case 'bolt':
      if (!artifactId) {
        throw new Error('artifactId is required for bolt artifacts');
      }
      if (!unitId) {
        throw new Error('unitId is required for bolt artifacts');
      }
      return path.join(workflowDir, 'construction', unitId, `${artifactId}.md`);
    case 'validation-report':
      if (!artifactId) {
        throw new Error('artifactId is required for validation-report artifacts');
      }
      return path.join(workflowDir, 'construction', artifactId, 'validation-report.md');
    case 'interfaces':
      return path.join(workflowDir, 'construction', 'design', 'interfaces.json');
    case 'data-flow':
      return path.join(workflowDir, 'construction', 'design', 'data-flow.json');
    case 'components':
      return path.join(workflowDir, 'construction', 'design', 'components.json');
    case 'deploy-guide':
      return path.join(workflowDir, 'operations', 'deploy-guide.md');
    case 'runbook':
      return path.join(workflowDir, 'operations', 'runbook.md');
    case 'monitoring':
      return path.join(workflowDir, 'operations', 'monitoring.json');
    case 'release-notes':
      return path.join(workflowDir, 'operations', 'release-notes.md');
    case 'state':
      return path.join(workflowDir, 'state.md');
    case 'audit':
      return path.join(workflowDir, 'audit.md');
    case 'analysis-plan':
      return path.join(workflowDir, 'discovery', 'analysis-plan.md');
    case 'current-state-analysis':
      return path.join(workflowDir, 'discovery', 'current-state-analysis.md');
    case 'regression-baseline':
      return path.join(workflowDir, 'discovery', 'regression-baseline.md');
    case 'change-impact':
      return path.join(workflowDir, 'discovery', 'change-impact.md');
    case 'static-model':
      return path.join(workflowDir, 'discovery', 'static-model.md');
    case 'dynamic-model':
      return path.join(workflowDir, 'discovery', 'dynamic-model.md');
    default:
      throw new Error(`Unknown artifact type: ${artifactType}`);
  }
}

/**
 * Writes artifact content to the correct path for the given artifact type.
 * Creates parent directories if needed.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @param artifactType - Type of artifact to write
 * @param content - Content to write
 * @param artifactId - Optional ID for unit/bolt/validation-report artifacts
 * @param unitId - Optional unit ID (required for 'bolt' artifacts)
 * @throws Error if disk is full or permissions are denied
 */
export async function writeArtifact(
  projectPath: string,
  workflowId: string,
  artifactType: ArtifactType,
  content: string,
  artifactId?: string,
  unitId?: string
): Promise<void> {
  const artifactPath = getArtifactPath(projectPath, workflowId, artifactType, artifactId, unitId);

  try {
    await fs.ensureDir(path.dirname(artifactPath));
    await fs.writeFile(artifactPath, content, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to write ${artifactType} artifact: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to write ${artifactType} artifact: Disk is full. Please free up space and retry.`
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to write ${artifactType} artifact: Permission denied`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to write ${artifactType} artifact: Permission denied for ${artifactPath}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to write ${artifactType} artifact: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to write ${artifactType} artifact: Filesystem is read-only`
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to write ${artifactType} artifact: ${err.message}`);
    console.error(`[Artifacts] Path: ${artifactPath}`);
    throw new Error(
      `Failed to write ${artifactType} artifact: ${err.message}`
    );
  }
}

/**
 * Reads artifact content from the correct path for the given artifact type.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @param artifactType - Type of artifact to read
 * @param artifactId - Optional ID for unit/bolt/validation-report artifacts
 * @param unitId - Optional unit ID (required for 'bolt' artifacts)
 * @returns Content of the artifact, or null if the file doesn't exist
 * @throws Error if permissions are denied or file is corrupt
 */
export async function readArtifact(
  projectPath: string,
  workflowId: string,
  artifactType: ArtifactType,
  artifactId?: string,
  unitId?: string
): Promise<string | null> {
  const artifactPath = getArtifactPath(projectPath, workflowId, artifactType, artifactId, unitId);

  try {
    if (!await fs.pathExists(artifactPath)) {
      return null;
    }

    return await fs.readFile(artifactPath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // File not found is expected (return null)
    if (err.code === 'ENOENT') {
      return null;
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to read ${artifactType} artifact: Permission denied`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to read ${artifactType} artifact: Permission denied for ${artifactPath}`
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to read ${artifactType} artifact: ${err.message}`);
    console.error(`[Artifacts] Path: ${artifactPath}`);
    throw new Error(
      `Failed to read ${artifactType} artifact: ${err.message}`
    );
  }
}


/**
 * Links workflow artifacts to the master plan file.
 * Creates or updates .olympus/plans/{workflowId}-plan.md with references
 * to all structured workflow artifacts.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @throws Error if disk is full or permissions are denied
 *
 * @example
 * await linkMasterPlan('/path/to/project', 'wf-2024-01-15-user-auth');
 * // Creates/updates .olympus/plans/wf-2024-01-15-user-auth-plan.md
 */
export async function linkMasterPlan(
  projectPath: string,
  workflowId: string
): Promise<void> {
  const plansDir = path.join(projectPath, '.olympus', 'plans');
  const planPath = path.join(plansDir, `${workflowId}-plan.md`);

  try {
    await fs.ensureDir(plansDir);

  const artifactsSection = `## Structured Artifacts

This feature was developed using the structured workflow system:

### Inception Phase
- [Idea Document](aidlc-docs/inception/idea.md)
- [Intent Document](aidlc-docs/inception/intent.md)
- [Non-Functional Requirements](aidlc-docs/inception/nfr.md)

### Construction Phase
- [Units](aidlc-docs/construction/) - Per-unit directories (UNIT-001/, UNIT-002/, etc.)
- [Design Artifacts](aidlc-docs/construction/design/)

### Operations Phase
- [Deployment Guide](aidlc-docs/operations/deploy-guide.md)
- [Runbook](aidlc-docs/operations/runbook.md)
- [Monitoring Configuration](aidlc-docs/operations/monitoring.json)
- [Release Notes](aidlc-docs/operations/release-notes.md)

### Metadata
- [Workflow State](aidlc-docs/state.md)
- [Audit Log](aidlc-docs/audit.md)
- [Workflow Checkpoint](aidlc-docs/checkpoint.json)
- [Manifest](aidlc-docs/manifest.json)
`;

    let content = '';

    if (await fs.pathExists(planPath)) {
      // Read existing file
      content = await fs.readFile(planPath, 'utf-8');

      // Check if Structured Artifacts section exists
      const sectionRegex = /## Structured Artifacts[\s\S]*?(?=\n## |$)/;
      if (sectionRegex.test(content)) {
        // Replace existing section
        content = content.replace(sectionRegex, artifactsSection.trim());
      } else {
        // Append section at the end
        content = content.trim() + '\n\n' + artifactsSection;
      }
    } else {
      // Create new file with header
      content = `# Plan: ${workflowId}

${artifactsSection}`;
    }

    await fs.writeFile(planPath, content, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to link master plan: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Path: ${planPath}`);
      throw new Error(
        'Failed to link master plan: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to link master plan: Permission denied`);
      console.error(`[Artifacts] Path: ${planPath}`);
      throw new Error(
        `Failed to link master plan: Permission denied for ${planPath}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to link master plan: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${planPath}`);
      throw new Error(
        'Failed to link master plan: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to link master plan: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    console.error(`[Artifacts] Path: ${planPath}`);
    throw new Error(
      `Failed to link master plan for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Ensures the phase-based workflow directory structure exists.
 * Creates:
 * - aidlc-docs/
 * - aidlc-docs/inception/
 * - aidlc-docs/construction/
 * - aidlc-docs/construction/design/
 * - aidlc-docs/operations/
 *
 * Note: Per-unit directories (UNIT-001/, etc.) are created on-demand, not upfront.
 *
 * Idempotent - safe to call multiple times.
 * Does NOT create manifest.json (that's manifest.ts's job).
 * @throws Error if disk is full or permissions are denied
 */
export async function ensurePhaseWorkflowDir(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, 'aidlc-docs');

  try {
    // Create base workflow directory
    await fs.ensureDir(workflowDir);

    // Create Inception phase directory (idea.md and intent.md go directly in inception/)
    await fs.ensureDir(path.join(workflowDir, 'inception'));

    // Create Construction phase directories
    await fs.ensureDir(path.join(workflowDir, 'construction'));
    await fs.ensureDir(path.join(workflowDir, 'construction', 'design'));

    // Create Operations phase directory (all artifacts go directly in operations/)
    await fs.ensureDir(path.join(workflowDir, 'operations'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to create phase workflow directory: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Attempted path: ${workflowDir}`);
      throw new Error(
        'Failed to create phase workflow directory: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to create phase workflow directory: Permission denied`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        `Failed to create phase workflow directory: Permission denied for ${workflowDir}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to create phase workflow directory: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        'Failed to create phase workflow directory: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to create phase workflow directory: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    console.error(`[Artifacts] Path: ${workflowDir}`);
    throw new Error(
      `Failed to create phase workflow directory for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Checks if a workflow directory uses the legacy flat layout or the new phase-based layout.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @returns true if the workflow uses the legacy flat layout (in .olympus/workflow/{id}/),
 *          false if it uses the new phase-based layout (in aidlc-docs/)
 */
export async function isLegacyLayout(projectPath: string, workflowId: string): Promise<boolean> {
  const newWorkflowDir = path.join(projectPath, 'aidlc-docs');
  const oldWorkflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);

  try {
    // If aidlc-docs/ exists, it's the new layout
    if (await fs.pathExists(newWorkflowDir)) {
      return false;
    }

    // If only .olympus/workflow/{id}/ exists, it's legacy
    if (await fs.pathExists(oldWorkflowDir)) {
      return true;
    }

    // Neither exists, treat as legacy
    return true;
  } catch (error) {
    // If we can't read the directory, assume it's legacy
    return true;
  }
}

/**
 * Migrates a workflow from the legacy layout to the new phase-based layout.
 * Moves:
 * - idea.md -> inception/idea.md
 *
 * Preserves:
 * - checkpoint.json (moves to aidlc-docs/)
 * - manifest.json (moves to aidlc-docs/)
 *
 * Creates:
 * - aidlc-docs/inception/, aidlc-docs/construction/, and aidlc-docs/operations/ directories
 *
 * Idempotent - if already migrated (aidlc-docs/ exists), returns early without error.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @throws Error if disk is full, permissions are denied, or filesystem errors occur
 */
export async function migrateLayout(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, 'aidlc-docs');
  const visionDir = path.join(workflowDir, 'inception');

  try {
    // If already migrated, return early
    if (await fs.pathExists(visionDir)) {
      return;
    }

    // Create the phase-based directory structure
    await ensurePhaseWorkflowDir(projectPath, workflowId);

    // Move idea.md if it exists
    const ideaSource = path.join(workflowDir, 'idea.md');
    const ideaTarget = path.join(workflowDir, 'inception', 'idea.md');

    if (await fs.pathExists(ideaSource)) {
      await fs.move(ideaSource, ideaTarget, { overwrite: false });
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to migrate layout: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Workflow ID: ${workflowId}`);
      throw new Error(
        'Failed to migrate workflow layout: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to migrate layout: Permission denied`);
      console.error(`[Artifacts] Workflow ID: ${workflowId}`);
      throw new Error(
        `Failed to migrate workflow layout: Permission denied for ${workflowId}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to migrate layout: Read-only filesystem`);
      console.error(`[Artifacts] Workflow ID: ${workflowId}`);
      throw new Error(
        'Failed to migrate workflow layout: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to migrate layout: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    throw new Error(
      `Failed to migrate workflow layout for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Returns the file path for an artifact in the phase-based layout.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @param phase - Workflow phase ('discovery', 'inception', 'construction', or 'operations')
 * @param stage - Stage within the phase (e.g., 'idea', 'design', 'deploy')
 * @param filename - Name of the file
 * @returns Absolute path to the artifact file
 *
 * @example
 * getPhaseArtifactPath(p, id, 'inception', 'idea', 'idea.md')
 * // Returns: aidlc-docs/inception/idea.md
 *
 * getPhaseArtifactPath(p, id, 'construction', 'design', 'interfaces.json')
 * // Returns: aidlc-docs/construction/design/interfaces.json
 *
 * getPhaseArtifactPath(p, id, 'operations', 'deploy', 'deploy-guide.md')
 * // Returns: aidlc-docs/operations/deploy-guide.md
 */
export function getPhaseArtifactPath(
  projectPath: string,
  workflowId: string,
  phase: WorkflowPhase,
  stage: string,
  filename: string
): string {
  const workflowDir = path.join(projectPath, 'aidlc-docs');

  // Determine subdirectory structure based on stage
  // Only 'design' maps to subdirectory in construction phase (per-unit dirs are handled separately)
  const subdirStages = ['design'];

  if (subdirStages.includes(stage)) {
    // These stages map to subdirectories within construction/
    return path.join(workflowDir, phase, stage, filename);
  } else {
    // All other stages: files go directly in the phase directory
    return path.join(workflowDir, phase, filename);
  }
}

/**
 * Ensures the discovery directory exists for brownfield workflows.
 * Creates aidlc-docs/discovery/
 *
 * @param projectPath - Root path of the project
 */
export async function ensureDiscoveryDir(projectPath: string): Promise<void> {
  const discoveryDir = path.join(projectPath, 'aidlc-docs', 'discovery');
  await fs.ensureDir(discoveryDir);
}

/**
 * Writes content to the state.md file at the root of aidlc-docs/.
 *
 * @param projectPath - Root path of the project
 * @param content - Content to write to state.md
 */
export async function writeStateFile(projectPath: string, content: string): Promise<void> {
  const statePath = path.join(projectPath, 'aidlc-docs', 'state.md');
  await fs.ensureDir(path.dirname(statePath));
  await fs.writeFile(statePath, content, 'utf-8');
}

/**
 * Appends an entry to the audit.md file at the root of aidlc-docs/.
 * Creates the file with a header if it doesn't exist.
 *
 * @param projectPath - Root path of the project
 * @param entry - Entry to append to audit.md
 */
export async function appendAuditEntry(projectPath: string, entry: string): Promise<void> {
  const auditPath = path.join(projectPath, 'aidlc-docs', 'audit.md');
  await fs.ensureDir(path.dirname(auditPath));
  const exists = await fs.pathExists(auditPath);
  if (exists) {
    await fs.appendFile(auditPath, '\n' + entry, 'utf-8');
  } else {
    await fs.writeFile(auditPath, `# Audit Log\n\n${entry}`, 'utf-8');
  }
}
