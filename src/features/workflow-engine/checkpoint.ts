/**
 * Checkpoint Persistence Module
 *
 * Handles saving, loading, and managing workflow checkpoints on disk.
 * Checkpoints are stored in .olympus/workflow/{workflow_id}/checkpoint.json
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { WorkflowCheckpoint } from './types.js';

const WORKFLOW_DIR = '.olympus/workflow';
const CHECKPOINT_FILENAME = 'checkpoint.json';

/**
 * Save a workflow checkpoint to disk.
 * Creates directory structure if it doesn't exist.
 * Updates the checkpoint's updated_at timestamp before saving.
 *
 * @param projectPath - Root path of the project
 * @param checkpoint - Checkpoint data to save
 */
export async function saveCheckpoint(
  projectPath: string,
  checkpoint: WorkflowCheckpoint
): Promise<void> {
  const workflowDir = join(projectPath, WORKFLOW_DIR, checkpoint.workflow_id);
  const checkpointPath = join(workflowDir, CHECKPOINT_FILENAME);

  // Update timestamp
  checkpoint.updated_at = new Date().toISOString();

  // Ensure directory exists
  await fs.ensureDir(workflowDir);

  // Write checkpoint with readable formatting
  await fs.writeJson(checkpointPath, checkpoint, { spaces: 2 });
}

/**
 * Load a workflow checkpoint from disk.
 * Returns null if checkpoint doesn't exist or if JSON is corrupt.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow to load
 * @returns Checkpoint data or null if not found/invalid
 */
export async function loadCheckpoint(
  projectPath: string,
  workflowId: string
): Promise<WorkflowCheckpoint | null> {
  const checkpointPath = join(
    projectPath,
    WORKFLOW_DIR,
    workflowId,
    CHECKPOINT_FILENAME
  );

  try {
    // Check if file exists
    const exists = await fs.pathExists(checkpointPath);
    if (!exists) {
      return null;
    }

    // Read and parse JSON
    const checkpoint = await fs.readJson(checkpointPath);

    // Validate schema_version exists
    if (!checkpoint.schema_version) {
      console.warn(`Checkpoint ${workflowId} missing schema_version`);
      return null;
    }

    return checkpoint as WorkflowCheckpoint;
  } catch (error) {
    // Handle corrupt JSON gracefully
    console.warn(`Failed to load checkpoint ${workflowId}:`, (error as Error).message);
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
    console.warn('Failed to list workflows:', (error as Error).message);
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
    // Silently handle missing directories (idempotent)
    // Only log unexpected errors
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Failed to delete workflow ${workflowId}:`, (error as Error).message);
    }
  }
}
