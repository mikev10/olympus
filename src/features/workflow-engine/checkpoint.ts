/**
 * Checkpoint Persistence Module
 *
 * Handles saving, loading, and managing workflow checkpoints on disk.
 * Checkpoints are stored in aidlc-docs/checkpoint.json
 *
 * Performance optimizations:
 * - In-memory cache to avoid redundant disk reads
 * - Optimized JSON serialization
 * - Batched writes to reduce I/O operations
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import type { WorkflowCheckpointV3 } from './phase-types.js';

const WORKFLOW_DIR = 'aidlc-docs';
const CHECKPOINT_FILENAME = 'checkpoint.json';

/**
 * In-memory cache for loaded checkpoints
 * Key: `${projectPath}:${workflowId}`
 * Value: { checkpoint: WorkflowCheckpointV3, timestamp: number }
 */
interface CacheEntry {
  checkpoint: WorkflowCheckpointV3;
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
 * Check if a checkpoint is using a legacy schema (v1 or v2).
 *
 * @param data - Checkpoint data to check
 * @returns true if checkpoint is v1 or v2, false otherwise
 */
export function isLegacyCheckpoint(data: any): boolean {
  if (!data || typeof data !== 'object' || !data.schema_version) {
    return false;
  }
  return data.schema_version === '1.0.0' || data.schema_version === '2.0.0';
}

/**
 * Archive a legacy workflow by moving its directory to .olympus/archive/.
 * This preserves the workflow data while marking it as legacy/inactive.
 * Uses the old .olympus/workflow path since it's specifically for archiving legacy workflows.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow to archive
 */
export async function archiveLegacyWorkflow(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = join(projectPath, '.olympus', 'workflow', workflowId);
  const archiveDir = join(projectPath, '.olympus/archive', workflowId);

  try {
    // Check if source exists
    const exists = await fs.pathExists(workflowDir);
    if (!exists) {
      return; // No-op if workflow doesn't exist
    }

    // Ensure archive directory parent exists
    await fs.ensureDir(join(projectPath, '.olympus/archive'));

    // Move workflow to archive
    await fs.move(workflowDir, archiveDir, { overwrite: true });

    console.log(`[Checkpoint] Archived legacy workflow ${workflowId} to ${archiveDir}`);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Checkpoint] Failed to archive workflow ${workflowId}: ${err.message}`);
  }
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
  checkpoint: WorkflowCheckpointV3
): Promise<void> {
  const workflowDir = join(projectPath, WORKFLOW_DIR);
  const checkpointPath = join(workflowDir, CHECKPOINT_FILENAME);

  try {
    // Update timestamp and schema version
    checkpoint.updated_at = new Date().toISOString();
    checkpoint.schema_version = '3.0.0';

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
 * Returns null if checkpoint doesn't exist, is corrupt, or uses a legacy schema (v1/v2).
 *
 * Performance optimizations:
 * - Uses in-memory cache to avoid redundant disk reads
 * - Fast-path for cache hits
 * - Optimized JSON parsing
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow to load
 * @returns Checkpoint data or null if not found/invalid/legacy
 */
export async function loadCheckpoint(
  projectPath: string,
  workflowId: string
): Promise<WorkflowCheckpointV3 | null> {
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
    CHECKPOINT_FILENAME
  );

  try {
    // Fast path: use readFile + JSON.parse instead of fs.readJson
    // This is faster for typical checkpoint sizes
    const fileContent = await fs.readFile(checkpointPath, 'utf-8');
    const checkpoint = JSON.parse(fileContent);

    // Validate schema_version exists
    if (!checkpoint.schema_version) {
      console.warn(`[Checkpoint] Checkpoint ${workflowId} missing schema_version, treating as invalid`);
      console.warn(`[Checkpoint] Checkpoint may be corrupt or from an older version`);
      console.warn(`[Checkpoint] Consider deleting: ${checkpointPath}`);
      return null;
    }

    // Check if legacy checkpoint (v1 or v2)
    if (isLegacyCheckpoint(checkpoint)) {
      console.warn(`[Checkpoint] Legacy checkpoint detected (${checkpoint.schema_version}): ${workflowId}`);
      console.warn(`[Checkpoint] Legacy checkpoints are no longer supported. Please archive or recreate this workflow.`);
      console.warn(`[Checkpoint] Path: ${checkpointPath}`);
      return null;
    }

    // Validate it's v3
    if (checkpoint.schema_version !== '3.0.0') {
      console.warn(`[Checkpoint] Unknown checkpoint schema version ${checkpoint.schema_version} for workflow ${workflowId}`);
      console.warn(`[Checkpoint] Expected 3.0.0`);
      return null;
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
 * Since there's no longer a directory per workflow, this checks if aidlc-docs/checkpoint.json exists
 * and returns the workflow_id from it.
 *
 * @param projectPath - Root path of the project
 * @returns Array of workflow IDs (single workflow or empty)
 */
export async function listWorkflows(projectPath: string): Promise<string[]> {
  const checkpointPath = join(projectPath, WORKFLOW_DIR, CHECKPOINT_FILENAME);

  try {
    // Check if checkpoint exists
    const exists = await fs.pathExists(checkpointPath);
    if (!exists) {
      return [];
    }

    // Read checkpoint and extract workflow_id
    const content = await fs.readFile(checkpointPath, 'utf-8');
    const checkpoint = JSON.parse(content);

    if (checkpoint.workflow_id) {
      return [checkpoint.workflow_id];
    }

    return [];
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle permission errors
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.warn(`[Checkpoint] Permission denied reading checkpoint in ${checkpointPath}`);
      return [];
    }

    // Generic error
    console.warn(`[Checkpoint] Failed to list workflows: ${err.message}`);
    console.warn(`[Checkpoint] Path: ${checkpointPath}`);
    return [];
  }
}

/**
 * Delete a workflow and all its associated files.
 * Deletes the entire aidlc-docs/ directory.
 * Idempotent - no error if workflow doesn't exist.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow to delete (kept for API compatibility)
 */
export async function deleteWorkflow(
  projectPath: string,
  workflowId: string
): Promise<void> {
  const workflowDir = join(projectPath, WORKFLOW_DIR);

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
