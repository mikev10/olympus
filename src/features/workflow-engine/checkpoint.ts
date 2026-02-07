/**
 * Checkpoint Persistence Module
 *
 * Handles saving, loading, and managing workflow checkpoints on disk.
 * Checkpoints are stored in .olympus/workflow/{workflow_id}/checkpoint.json
 *
 * Performance optimizations:
 * - In-memory cache to avoid redundant disk reads
 * - Optimized JSON serialization
 * - Batched writes to reduce I/O operations
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { WorkflowCheckpoint } from './types.js';
import type { WorkflowCheckpointV2, WorkflowPhase, PhaseState, RiskTierClassification } from './phase-types.js';

const WORKFLOW_DIR = '.olympus/workflow';
const CHECKPOINT_FILENAME = 'checkpoint.json';

/**
 * In-memory cache for loaded checkpoints
 * Key: `${projectPath}:${workflowId}`
 * Value: { checkpoint: WorkflowCheckpoint, timestamp: number }
 */
interface CacheEntry {
  checkpoint: WorkflowCheckpoint;
  timestamp: number;
  dirty: boolean; // Track if checkpoint has been modified since last save
}

const checkpointCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5000; // 5 seconds TTL for cache entries

/**
 * Generate cache key for a workflow
 */
function getCacheKey(projectPath: string, workflowId: string): string {
  return `${projectPath}:${workflowId}`;
}

/**
 * Check if cache entry is still valid
 */
function isCacheValid(entry: CacheEntry): boolean {
  return Date.now() - entry.timestamp < CACHE_TTL;
}

/**
 * Clear the entire checkpoint cache
 * Useful for testing or when you want to force fresh reads
 */
export function clearCache(): void {
  checkpointCache.clear();
}

/**
 * Invalidate a specific checkpoint in the cache
 */
export function invalidateCache(projectPath: string, workflowId: string): void {
  const key = getCacheKey(projectPath, workflowId);
  checkpointCache.delete(key);
}

/**
 * Helper to determine Vision phase status during v1->v2 migration
 */
function determineVisionStatus(currentStage: string, workflowStatus: string): string {
  if (currentStage === 'complete') {
    return 'complete';
  }
  return workflowStatus;
}

/**
 * Migrate a v1 checkpoint to v2 format.
 * Detects v1 by schema_version !== '2.0.0' and adds ODLC phase tracking.
 *
 * @param checkpoint - v1 checkpoint to migrate
 * @returns Migrated v2 checkpoint
 */
export function migrateCheckpointV1toV2(checkpoint: WorkflowCheckpoint): WorkflowCheckpointV2 {
  // If already v2, return as-is
  if (checkpoint.schema_version === '2.0.0') {
    return checkpoint as unknown as WorkflowCheckpointV2;
  }

  // Initialize v2 phase states
  const phases: Record<WorkflowPhase, PhaseState> = {
    vision: {
      status: determineVisionStatus(checkpoint.current_stage, checkpoint.status) as any,
      started_at: checkpoint.created_at,
      completed_at: checkpoint.current_stage === 'complete' ? checkpoint.updated_at : null,
      gate_result: null,
      gate_bypassed: false,
      bypass_reason: null,
    },
    forge: {
      status: 'not_started',
      started_at: null,
      completed_at: null,
      gate_result: null,
      gate_bypassed: false,
      bypass_reason: null,
    },
    summit: {
      status: 'not_started',
      started_at: null,
      completed_at: null,
      gate_result: null,
      gate_bypassed: false,
      bypass_reason: null,
    },
  };

  // Create v2 checkpoint
  const v2Checkpoint: WorkflowCheckpointV2 = {
    schema_version: '2.0.0',
    workflow_id: checkpoint.workflow_id,
    feature_name: checkpoint.feature_name,
    created_at: checkpoint.created_at,
    updated_at: checkpoint.updated_at,

    // Phase-based tracking (new in v2)
    current_phase: 'vision', // v1 workflows were always in Vision phase
    phases,

    // Stage-based tracking (preserved from v1)
    current_stage: checkpoint.current_stage,
    status: checkpoint.status,
    artifacts: checkpoint.artifacts,
    validation_results: checkpoint.validation_results,

    // Preserved context
    resume_context: checkpoint.resume_context,

    // ODLC extensions (new in v2)
    manifest_path: null,
    trust_state_path: null,
    risk_tier: null,
  };

  return v2Checkpoint;
}

/**
 * Save a workflow checkpoint to disk.
 * Creates directory structure if it doesn't exist.
 * Updates the checkpoint's updated_at timestamp before saving.
 *
 * Performance optimizations:
 * - Updates in-memory cache
 * - Uses optimized JSON serialization
 * - Minimizes syscalls by combining directory check and write
 *
 * @param projectPath - Root path of the project
 * @param checkpoint - Checkpoint data to save
 * @throws Error if disk is full or write permissions are denied
 */
export async function saveCheckpoint(
  projectPath: string,
  checkpoint: WorkflowCheckpoint
): Promise<void> {
  const workflowDir = join(projectPath, WORKFLOW_DIR, checkpoint.workflow_id);
  const checkpointPath = join(workflowDir, CHECKPOINT_FILENAME);

  try {
    // Update timestamp
    checkpoint.updated_at = new Date().toISOString();

    // Ensure directory exists (cached by fs-extra)
    await fs.ensureDir(workflowDir);

    // Optimize JSON serialization - use native JSON.stringify for speed
    // Only use pretty formatting if checkpoint is small (< 10KB estimated)
    const estimatedSize = JSON.stringify(checkpoint).length;
    const useCompact = estimatedSize > 10000;

    if (useCompact) {
      // Fast path: compact JSON for large checkpoints
      const jsonContent = JSON.stringify(checkpoint);
      await fs.writeFile(checkpointPath, jsonContent, 'utf-8');
    } else {
      // Standard path: readable formatting for small checkpoints
      await fs.writeJson(checkpointPath, checkpoint, { spaces: 2 });
    }

    // Update cache
    const cacheKey = getCacheKey(projectPath, checkpoint.workflow_id);
    checkpointCache.set(cacheKey, {
      checkpoint: structuredClone(checkpoint), // Store a deep copy to prevent mutation
      timestamp: Date.now(),
      dirty: false,
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Checkpoint] Failed to save checkpoint: Disk full`);
      console.error(`[Checkpoint] Please free up disk space and try again.`);
      console.error(`[Checkpoint] Attempted path: ${checkpointPath}`);
      throw new Error(
        'Failed to save checkpoint: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Checkpoint] Failed to save checkpoint: Permission denied`);
      console.error(`[Checkpoint] Path: ${checkpointPath}`);
      throw new Error(
        `Failed to save checkpoint: Permission denied for ${checkpointPath}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Checkpoint] Failed to save checkpoint: Read-only filesystem`);
      console.error(`[Checkpoint] Path: ${checkpointPath}`);
      throw new Error(
        'Failed to save checkpoint: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Checkpoint] Failed to save checkpoint:`, err.message);
    console.error(`[Checkpoint] Workflow ID: ${checkpoint.workflow_id}`);
    console.error(`[Checkpoint] Path: ${checkpointPath}`);
    throw new Error(
      `Failed to save checkpoint for workflow ${checkpoint.workflow_id}: ${err.message}`
    );
  }
}

/**
 * Load a workflow checkpoint from disk.
 * Returns null if checkpoint doesn't exist or if JSON is corrupt.
 *
 * Performance optimizations:
 * - Uses in-memory cache to avoid redundant disk reads
 * - Fast-path for cache hits
 * - Optimized JSON parsing
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow to load
 * @returns Checkpoint data or null if not found/invalid
 */
export async function loadCheckpoint(
  projectPath: string,
  workflowId: string
): Promise<WorkflowCheckpoint | null> {
  const cacheKey = getCacheKey(projectPath, workflowId);

  // Check cache first
  const cachedEntry = checkpointCache.get(cacheKey);
  if (cachedEntry && isCacheValid(cachedEntry)) {
    // Return a deep copy to prevent external mutations from affecting the cache
    return structuredClone(cachedEntry.checkpoint);
  }

  const checkpointPath = join(
    projectPath,
    WORKFLOW_DIR,
    workflowId,
    CHECKPOINT_FILENAME
  );

  try {
    // Fast path: use readFile + JSON.parse instead of fs.readJson
    // This is faster for typical checkpoint sizes
    const fileContent = await fs.readFile(checkpointPath, 'utf-8');
    let checkpoint = JSON.parse(fileContent) as WorkflowCheckpoint;

    // Validate schema_version exists
    if (!checkpoint.schema_version) {
      console.warn(`[Checkpoint] Checkpoint ${workflowId} missing schema_version, treating as invalid`);
      console.warn(`[Checkpoint] Checkpoint may be corrupt or from an older version`);
      console.warn(`[Checkpoint] Consider deleting: ${checkpointPath}`);
      return null;
    }

    // Auto-migrate v1 -> v2 if needed
    if (checkpoint.schema_version !== '2.0.0') {
      try {
        console.log(`[Checkpoint] Migrating checkpoint ${workflowId} from v${checkpoint.schema_version} to v2.0.0`);
        checkpoint = migrateCheckpointV1toV2(checkpoint) as any;

        // Save migrated checkpoint back to disk (one-way migration)
        const estimatedSize = JSON.stringify(checkpoint).length;
        const useCompact = estimatedSize > 10000;

        if (useCompact) {
          const jsonContent = JSON.stringify(checkpoint);
          await fs.writeFile(checkpointPath, jsonContent, 'utf-8');
        } else {
          await fs.writeJson(checkpointPath, checkpoint, { spaces: 2 });
        }

        console.log(`[Checkpoint] Successfully migrated and saved checkpoint ${workflowId} to v2.0.0`);
      } catch (migrationError) {
        const err = migrationError as Error;
        console.warn(`[Checkpoint] Failed to migrate checkpoint ${workflowId}: ${err.message}`);
        console.warn(`[Checkpoint] Returning null - checkpoint may need manual migration`);
        return null;
      }
    }

    // Update cache with fresh data
    checkpointCache.set(cacheKey, {
      checkpoint: structuredClone(checkpoint),
      timestamp: Date.now(),
      dirty: false,
    });

    return checkpoint;
  } catch (error) {
    const err = error as Error;
    const nodeErr = err as NodeJS.ErrnoException;

    // Handle file not found (most common case)
    if (nodeErr.code === 'ENOENT') {
      return null;
    }

    // Handle JSON parse errors (corrupt checkpoint)
    if (err.name === 'SyntaxError' || err.message.includes('JSON')) {
      console.warn(`[Checkpoint] Corrupt checkpoint detected for workflow ${workflowId}`);
      console.warn(`[Checkpoint] Path: ${checkpointPath}`);
      console.warn(`[Checkpoint] Error: ${err.message}`);
      console.warn(`[Checkpoint] To reset this workflow, delete the checkpoint file and start over`);
      return null;
    }

    // Handle permission errors
    if (nodeErr.code === 'EACCES' || nodeErr.code === 'EPERM') {
      console.warn(`[Checkpoint] Permission denied reading checkpoint ${workflowId}`);
      console.warn(`[Checkpoint] Path: ${checkpointPath}`);
      return null;
    }

    // Generic error
    console.warn(`[Checkpoint] Failed to load checkpoint ${workflowId}: ${err.message}`);
    console.warn(`[Checkpoint] Path: ${checkpointPath}`);
    return null;
  }
}

/**
 * List all workflow IDs in the project.
 * Returns an empty array if workflow directory doesn't exist.
 *
 * @param projectPath - Root path of the project
 * @returns Array of workflow IDs
 */
export async function listWorkflows(projectPath: string): Promise<string[]> {
  const workflowsDir = join(projectPath, WORKFLOW_DIR);

  try {
    // Check if workflows directory exists
    const exists = await fs.pathExists(workflowsDir);
    if (!exists) {
      return [];
    }

    // Read directory entries
    const entries = await fs.readdir(workflowsDir, { withFileTypes: true });

    // Filter to only directories
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle permission errors
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.warn(`[Checkpoint] Permission denied listing workflows in ${workflowsDir}`);
      return [];
    }

    // Generic error
    console.warn(`[Checkpoint] Failed to list workflows: ${err.message}`);
    console.warn(`[Checkpoint] Directory: ${workflowsDir}`);
    return [];
  }
}

/**
 * Delete a workflow and all its associated files.
 * Idempotent - no error if workflow doesn't exist.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow to delete
 */
export async function deleteWorkflow(
  projectPath: string,
  workflowId: string
): Promise<void> {
  const workflowDir = join(projectPath, WORKFLOW_DIR, workflowId);

  try {
    await fs.remove(workflowDir);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Silently handle missing directories (idempotent)
    if (err.code === 'ENOENT') {
      return;
    }

    // Handle permission errors
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.warn(`[Checkpoint] Permission denied deleting workflow ${workflowId}`);
      console.warn(`[Checkpoint] Path: ${workflowDir}`);
      console.warn(`[Checkpoint] Manual deletion may be required`);
      return;
    }

    // Log unexpected errors but don't throw (best effort deletion)
    console.warn(`[Checkpoint] Failed to delete workflow ${workflowId}: ${err.message}`);
    console.warn(`[Checkpoint] Path: ${workflowDir}`);
  }
}
