import * as path from 'path';
import * as fs from 'fs-extra';
import { WorkflowStage } from './types.js';

/**
 * Ensures the workflow directory structure exists.
 * Creates:
 * - .olympus/workflow/{workflowId}/
 * - .olympus/workflow/{workflowId}/intents/
 * - .olympus/workflow/{workflowId}/validation/
 * - .olympus/workflow/{workflowId}/checkpoint.json (if not exists)
 *
 * Idempotent - safe to call multiple times.
 */
export async function ensureWorkflowDir(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);
  const intentsDir = path.join(workflowDir, 'intents');
  const validationDir = path.join(workflowDir, 'validation');
  const checkpointPath = path.join(workflowDir, 'checkpoint.json');

  // Create directories
  await fs.ensureDir(workflowDir);
  await fs.ensureDir(intentsDir);
  await fs.ensureDir(validationDir);

  // Initialize checkpoint.json if it doesn't exist
  if (!await fs.pathExists(checkpointPath)) {
    await fs.writeJson(checkpointPath, {
      workflowId,
      currentStage: 'idea',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { spaces: 2 });
  }
}

/**
 * Returns the file path for a given workflow stage artifact.
 *
 * @throws Error if stage is 'complete' (no artifact for complete stage)
 * @throws Error if stage is 'intents' (intents is a directory, not a file)
 */
export function getArtifactPath(projectPath: string, workflowId: string, stage: WorkflowStage): string {
  if (stage === 'complete') {
    throw new Error('No artifact file for complete stage');
  }

  if (stage === 'intents') {
    throw new Error('Intents is a directory, not a single file. Use getIntentsDir() instead.');
  }

  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);

  const artifactMap: Record<Exclude<WorkflowStage, 'complete' | 'intents'>, string> = {
    'idea': 'idea.md',
    'prd': 'prd.md',
    'spec': 'spec.md',
  };

  const filename = artifactMap[stage as Exclude<WorkflowStage, 'complete' | 'intents'>];
  return path.join(workflowDir, filename);
}

/**
 * Writes artifact content to the correct path for the given stage.
 * Creates parent directories if needed.
 *
 * @throws Error if stage is 'intents' (use different function for multiple intent files)
 * @throws Error if stage is 'complete' (no artifact for complete stage)
 */
export async function writeArtifact(
  projectPath: string,
  workflowId: string,
  stage: WorkflowStage,
  content: string
): Promise<void> {
  if (stage === 'intents') {
    throw new Error('Cannot write single artifact for intents stage. Use writeIntentFile() instead.');
  }

  const artifactPath = getArtifactPath(projectPath, workflowId, stage);
  await fs.ensureDir(path.dirname(artifactPath));
  await fs.writeFile(artifactPath, content, 'utf-8');
}

/**
 * Reads artifact content from the correct path for the given stage.
 *
 * @returns Content of the artifact, or null if the file doesn't exist
 * @throws Error if stage is 'intents' (use different function to read multiple files)
 * @throws Error if stage is 'complete' (no artifact for complete stage)
 */
export async function readArtifact(
  projectPath: string,
  workflowId: string,
  stage: WorkflowStage
): Promise<string | null> {
  if (stage === 'intents') {
    throw new Error('Cannot read single artifact for intents stage. Use readIntentFiles() instead.');
  }

  const artifactPath = getArtifactPath(projectPath, workflowId, stage);

  if (!await fs.pathExists(artifactPath)) {
    return null;
  }

  return await fs.readFile(artifactPath, 'utf-8');
}
