/**
 * Ascent Checkpoint System
 *
 * Manages checkpoints for ascent tasks to enable safe resumption after max iterations.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { createHash } from 'crypto';
import type { AscentCheckpoint } from '../../shared/types.js';

// Re-export the type for convenience
export type { AscentCheckpoint } from '../../shared/types.js';

/**
 * Get the checkpoints directory path
 * @param testDir Optional test directory override for testing
 */
export function getCheckpointsDir(testDir?: string): string {
  if (testDir) {
    return testDir;
  }
  const cwd = process.cwd();
  return join(cwd, '.olympus', 'checkpoints');
}

/**
 * Ensure checkpoints directory exists
 * @param testDir Optional test directory override for testing
 */
function ensureCheckpointsDir(testDir?: string): void {
  const dir = getCheckpointsDir(testDir);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a hash of plan content for drift detection
 */
export function hashPlanContent(planContent: string): string {
  return createHash('sha256').update(planContent).digest('hex').substring(0, 16);
}

/**
 * Get current git SHA
 */
export function getGitSha(): string {
  try {
    const { execSync } = require('child_process');
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    return sha;
  } catch (error) {
    console.warn('Warning: Could not get git SHA:', error);
    return 'unknown';
  }
}

/**
 * Save a checkpoint for an ascent task
 * @param planName Name of the plan
 * @param state Checkpoint state
 * @param testDir Optional test directory override for testing
 */
export function saveCheckpoint(
  planName: string,
  state: Omit<AscentCheckpoint, 'planName' | 'timestamp'>,
  testDir?: string
): void {
  ensureCheckpointsDir(testDir);

  const checkpoint: AscentCheckpoint = {
    planName,
    timestamp: new Date().toISOString(),
    ...state
  };

  const filename = `${planName}-${Date.now()}.json`;
  const filepath = join(getCheckpointsDir(testDir), filename);

  writeFileSync(filepath, JSON.stringify(checkpoint, null, 2), 'utf-8');
  console.log(`Checkpoint saved: ${filepath}`);
}

/**
 * Load the most recent checkpoint for a plan
 * @param planName Name of the plan
 * @param testDir Optional test directory override for testing
 */
export function loadCheckpoint(planName: string, testDir?: string): AscentCheckpoint | null {
  const dir = getCheckpointsDir(testDir);

  if (!existsSync(dir)) {
    return null;
  }

  const checkpoints = listCheckpoints(planName, testDir);

  if (checkpoints.length === 0) {
    return null;
  }

  // Most recent is first in sorted list
  const latestFile = checkpoints[0];
  const filepath = join(dir, latestFile);

  try {
    const content = readFileSync(filepath, 'utf-8');
    return JSON.parse(content) as AscentCheckpoint;
  } catch (error) {
    console.error(`Error loading checkpoint ${latestFile}:`, error);
    return null;
  }
}

/**
 * List all checkpoint files for a plan, sorted by most recent first
 * @param planName Name of the plan
 * @param testDir Optional test directory override for testing
 */
export function listCheckpoints(planName: string, testDir?: string): string[] {
  const dir = getCheckpointsDir(testDir);

  if (!existsSync(dir)) {
    return [];
  }

  try {
    const files = readdirSync(dir);
    const checkpointFiles = files
      .filter(f => f.startsWith(`${planName}-`) && f.endsWith('.json'))
      .sort((a, b) => {
        // Extract timestamps from filenames
        const tsA = parseInt(a.split('-').pop()?.replace('.json', '') || '0');
        const tsB = parseInt(b.split('-').pop()?.replace('.json', '') || '0');
        return tsB - tsA; // Most recent first
      });

    return checkpointFiles;
  } catch (error) {
    console.error('Error listing checkpoints:', error);
    return [];
  }
}

/**
 * Validate a checkpoint for resumption
 * Returns warnings if git SHA or plan hash has changed
 */
export function validateCheckpoint(
  checkpoint: AscentCheckpoint,
  currentGitSha: string,
  currentPlanHash: string
): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (checkpoint.gitSha !== currentGitSha && checkpoint.gitSha !== 'unknown') {
    warnings.push(
      `WARNING: Git SHA has changed since checkpoint.\n` +
      `Checkpoint SHA: ${checkpoint.gitSha}\n` +
      `Current SHA: ${currentGitSha}\n` +
      `Code changes may have occurred.`
    );
  }

  if (checkpoint.planHash !== currentPlanHash) {
    warnings.push(
      `WARNING: Plan has been modified since checkpoint.\n` +
      `Checkpoint hash: ${checkpoint.planHash}\n` +
      `Current hash: ${currentPlanHash}\n` +
      `Plan drift detected - review changes before resuming.`
    );
  }

  return {
    valid: true,
    warnings
  };
}
