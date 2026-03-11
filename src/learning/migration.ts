import { existsSync, unlinkSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getLearningDir, readJsonFile, writeJsonFile } from './storage.js';
import type { UserPreferences, ExplicitRule } from './types.js';

interface MigrationResult {
  skipped: boolean;
  filesDeleted: string[];
  preferencesMigrated: boolean;
  errors: string[];
}

export function isMigrated(): boolean {
  return existsSync(join(getLearningDir(), '.migrated-v5'));
}

export function setMigrated(): void {
  writeFileSync(join(getLearningDir(), '.migrated-v5'), new Date().toISOString(), 'utf-8');
}

export function migrateToProjectScoped(): MigrationResult {
  if (isMigrated()) {
    return { skipped: true, filesDeleted: [], preferencesMigrated: false, errors: [] };
  }

  const result: MigrationResult = {
    skipped: false,
    filesDeleted: [],
    preferencesMigrated: false,
    errors: [],
  };

  try {
    const learningDir = getLearningDir();

    const filesToDelete = ['feedback-log.jsonl', 'session-summaries.jsonl', 'agent-performance.json'];
    for (const filename of filesToDelete) {
      try {
        unlinkSync(join(learningDir, filename));
        result.filesDeleted.push(filename);
      } catch (err: unknown) {
        const nodeError = err as NodeJS.ErrnoException;
        if (nodeError.code !== 'ENOENT') {
          result.errors.push(`Failed to delete ${filename}: ${nodeError.message}`);
        }
      }
    }

    try {
      const archivePattern = /^(feedback-log|session-summaries)\..+\.old\.jsonl$/;
      const entries = readdirSync(learningDir);
      for (const entry of entries) {
        if (archivePattern.test(entry)) {
          try {
            unlinkSync(join(learningDir, entry));
            result.filesDeleted.push(entry);
          } catch {
            // Silent failure on archive deletion
          }
        }
      }
    } catch {
      // Silent failure if directory can't be read
    }

    const prefsPath = join(learningDir, 'user-preferences.json');
    const prefs = readJsonFile<UserPreferences | null>(prefsPath, null);
    if (prefs !== null && Array.isArray(prefs.explicit_rules)) {
      try {
        const migratedRules: ExplicitRule[] = [];
        for (const entry of prefs.explicit_rules) {
          if (typeof entry === 'string') {
            migratedRules.push({ rule: entry });
          } else if (entry && typeof (entry as ExplicitRule).rule === 'string') {
            migratedRules.push(entry as ExplicitRule);
          }
          // Otherwise skip
        }
        const migratedPrefs: UserPreferences = { ...prefs, explicit_rules: migratedRules };
        writeJsonFile(prefsPath, migratedPrefs);
        result.preferencesMigrated = true;
      } catch (err: unknown) {
        const nodeError = err as NodeJS.ErrnoException;
        result.errors.push(`Failed to migrate user-preferences.json: ${nodeError.message}`);
      }
    }

    setMigrated();
  } catch (err: unknown) {
    const nodeError = err as NodeJS.ErrnoException;
    result.errors.push(`Migration error: ${nodeError.message}`);
    // Still try to write the flag
    try {
      setMigrated();
    } catch {
      // Ignore
    }
  }

  return result;
}
