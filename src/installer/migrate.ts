/**
 * Hook Migration Utilities
 *
 * Handles migration from legacy individual hook files to the bundled system.
 */

import { existsSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/** Legacy hook files that should be removed when using bundled hooks */
const LEGACY_HOOK_FILES = [
  // Bash scripts
  'keyword-detector.sh',
  'stop-continuation.sh',
  'persistent-mode.sh',
  'session-start.sh',
  // Node.js scripts
  'keyword-detector.mjs',
  'stop-continuation.mjs',
  'persistent-mode.mjs',
  'session-start.mjs',
  // Bridge files
  'olympus-bridge.mjs',
  'hook-bridge.mjs'
];

/**
 * Get the hooks directory path
 */
function getHooksDir(): string {
  return join(homedir(), '.claude', 'hooks');
}

/**
 * Remove legacy hook files when migrating to bundled hooks.
 * Only removes files that are known legacy Olympus hooks.
 *
 * @returns Object with removed files and any errors
 */
export function migrateLegacyHooks(): { removed: string[]; errors: string[] } {
  const hooksDir = getHooksDir();
  const removed: string[] = [];
  const errors: string[] = [];

  if (!existsSync(hooksDir)) {
    return { removed, errors };
  }

  for (const file of LEGACY_HOOK_FILES) {
    const filePath = join(hooksDir, file);
    if (existsSync(filePath)) {
      try {
        unlinkSync(filePath);
        removed.push(file);
        console.log(`Removed legacy hook: ${file}`);
      } catch (err) {
        const errorMsg = `Failed to remove ${file}: ${err}`;
        errors.push(errorMsg);
        console.warn(errorMsg);
      }
    }
  }

  return { removed, errors };
}

/**
 * Check if legacy hooks exist that should be migrated
 *
 * @returns Array of legacy files found
 */
export function checkForLegacyHooks(): string[] {
  const hooksDir = getHooksDir();
  const found: string[] = [];

  if (!existsSync(hooksDir)) {
    return found;
  }

  for (const file of LEGACY_HOOK_FILES) {
    const filePath = join(hooksDir, file);
    if (existsSync(filePath)) {
      found.push(file);
    }
  }

  return found;
}

/**
 * Get list of all Olympus-related files in hooks directory
 *
 * @returns Array of Olympus hook files
 */
export function listOlympusHooks(): string[] {
  const hooksDir = getHooksDir();

  if (!existsSync(hooksDir)) {
    return [];
  }

  try {
    const files = readdirSync(hooksDir);
    return files.filter(f =>
      f.includes('olympus') ||
      LEGACY_HOOK_FILES.includes(f)
    );
  } catch {
    return [];
  }
}
