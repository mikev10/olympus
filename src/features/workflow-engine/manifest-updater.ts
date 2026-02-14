import * as fs from 'fs';
import * as path from 'path';
import { loadManifest } from './manifest.js';
import type { ManifestSchema } from './phase-types.js';

/**
 * Atomically updates a manifest file using a temp file + rename strategy.
 * Prevents corruption from concurrent writes during parallel BOLT execution.
 *
 * @param manifestPath - Absolute path to the manifest.json file
 * @param updater - Function that receives current manifest and returns updated manifest
 * @throws Error if manifest doesn't exist or write fails after retries
 */
export async function atomicManifestUpdate(
  manifestPath: string,
  updater: (manifest: ManifestSchema) => ManifestSchema
): Promise<void> {
  // Read current manifest
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at: ${manifestPath}`);
  }

  // Apply updater
  const updated = updater(manifest);

  // Write atomically with temp file
  const tempPath = `${manifestPath}.tmp`;
  const maxRetries = 3;
  const baseDelay = 100; // ms

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');

    // Attempt atomic rename with retry logic
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Atomic rename (atomic on POSIX, best-effort on Windows)
        fs.renameSync(tempPath, manifestPath);
        return; // Success
      } catch (err: any) {
        lastError = err;
        if (err.code === 'EPERM' || err.code === 'EACCES') {
          // Windows permission issue, retry with exponential backoff
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        // Non-retryable error or max retries reached
        throw err;
      }
    }

    // Max retries exhausted
    throw lastError || new Error('Atomic rename failed after retries');
  } catch (err: any) {
    // On Windows, if rename fails, fall back to direct write with retry
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      let lastError: Error = err;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2), 'utf-8');
          return; // Success
        } catch (writeErr: any) {
          lastError = writeErr;
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
      }
      throw lastError;
    }
    throw err;
  } finally {
    // Always clean up temp file
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Applies multiple updates to a manifest atomically in a single read-write cycle.
 * More efficient than multiple atomicManifestUpdate calls for bulk updates.
 *
 * @param manifestPath - Absolute path to the manifest.json file
 * @param updates - Array of updater functions to apply in sequence
 * @throws Error if manifest doesn't exist or write fails after retries
 */
export async function batchManifestUpdate(
  manifestPath: string,
  updates: Array<(manifest: ManifestSchema) => ManifestSchema>
): Promise<void> {
  // Read current manifest once
  const manifest = loadManifest(manifestPath);
  if (!manifest) {
    throw new Error(`Manifest not found at: ${manifestPath}`);
  }

  // Apply all updaters in sequence
  let updated = manifest;
  for (const updater of updates) {
    updated = updater(updated);
  }

  // Write atomically once
  const tempPath = `${manifestPath}.tmp`;
  const maxRetries = 3;
  const baseDelay = 100; // ms

  try {
    // Write to temp file
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');

    // Attempt atomic rename with retry logic
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Atomic rename (atomic on POSIX, best-effort on Windows)
        fs.renameSync(tempPath, manifestPath);
        return; // Success
      } catch (err: any) {
        lastError = err;
        if (err.code === 'EPERM' || err.code === 'EACCES') {
          // Windows permission issue, retry with exponential backoff
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        // Non-retryable error or max retries reached
        throw err;
      }
    }

    // Max retries exhausted
    throw lastError || new Error('Atomic rename failed after retries');
  } catch (err: any) {
    // On Windows, if rename fails, fall back to direct write with retry
    if (err.code === 'EPERM' || err.code === 'EACCES') {
      let lastError: Error = err;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          fs.writeFileSync(manifestPath, JSON.stringify(updated, null, 2), 'utf-8');
          return; // Success
        } catch (writeErr: any) {
          lastError = writeErr;
          if (attempt < maxRetries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
      }
      throw lastError;
    }
    throw err;
  } finally {
    // Always clean up temp file
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
