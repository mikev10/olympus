import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { isMigrated, setMigrated, migrateToProjectScoped } from '../migration.js';

const TEST_DIR = join(process.cwd(), '.test-migration-' + Date.now());

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_DIR;
});

afterEach(() => {
  delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('isMigrated', () => {
  it('returns false when no flag file exists', () => {
    expect(isMigrated()).toBe(false);
  });

  it('returns true when .migrated-v5 exists', () => {
    writeFileSync(join(TEST_DIR, '.migrated-v5'), new Date().toISOString(), 'utf-8');
    expect(isMigrated()).toBe(true);
  });
});

describe('migrateToProjectScoped', () => {
  it('returns skipped when already migrated', () => {
    writeFileSync(join(TEST_DIR, '.migrated-v5'), new Date().toISOString(), 'utf-8');
    const result = migrateToProjectScoped();
    expect(result.skipped).toBe(true);
    expect(result.filesDeleted).toHaveLength(0);
  });

  it('deletes feedback-log.jsonl', () => {
    writeFileSync(join(TEST_DIR, 'feedback-log.jsonl'), '{}', 'utf-8');
    const result = migrateToProjectScoped();
    expect(result.filesDeleted).toContain('feedback-log.jsonl');
    expect(existsSync(join(TEST_DIR, 'feedback-log.jsonl'))).toBe(false);
  });

  it('deletes session-summaries.jsonl', () => {
    writeFileSync(join(TEST_DIR, 'session-summaries.jsonl'), '{}', 'utf-8');
    const result = migrateToProjectScoped();
    expect(result.filesDeleted).toContain('session-summaries.jsonl');
    expect(existsSync(join(TEST_DIR, 'session-summaries.jsonl'))).toBe(false);
  });

  it('deletes agent-performance.json', () => {
    writeFileSync(join(TEST_DIR, 'agent-performance.json'), '{}', 'utf-8');
    const result = migrateToProjectScoped();
    expect(result.filesDeleted).toContain('agent-performance.json');
    expect(existsSync(join(TEST_DIR, 'agent-performance.json'))).toBe(false);
  });

  it('deletes .old.jsonl archive files', () => {
    const archiveName = 'feedback-log.2026-01-01T12-00-00-000Z.old.jsonl';
    writeFileSync(join(TEST_DIR, archiveName), '{}', 'utf-8');
    const result = migrateToProjectScoped();
    expect(result.filesDeleted).toContain(archiveName);
    expect(existsSync(join(TEST_DIR, archiveName))).toBe(false);
  });

  it('migrates user-preferences.json explicit_rules from string[] to ExplicitRule[]', () => {
    const prefs = {
      verbosity: 'unknown',
      autonomy: 'unknown',
      explanation_depth: 'unknown',
      explicit_rules: ['Always: use TypeScript', 'Never: use var'],
      inferred_preferences: [],
      recurring_corrections: [],
      last_updated: new Date().toISOString(),
    };
    writeFileSync(join(TEST_DIR, 'user-preferences.json'), JSON.stringify(prefs), 'utf-8');

    const result = migrateToProjectScoped();
    expect(result.preferencesMigrated).toBe(true);

    const updated = JSON.parse(
      require('fs').readFileSync(join(TEST_DIR, 'user-preferences.json'), 'utf-8')
    );
    expect(updated.explicit_rules[0]).toEqual({ rule: 'Always: use TypeScript' });
    expect(updated.explicit_rules[1]).toEqual({ rule: 'Never: use var' });
  });

  it('preserves verbosity and autonomy in user-preferences.json', () => {
    const prefs = {
      verbosity: 'concise',
      autonomy: 'just_do_it',
      explanation_depth: 'minimal',
      explicit_rules: [],
      inferred_preferences: ['some pref'],
      recurring_corrections: [],
      last_updated: new Date().toISOString(),
    };
    writeFileSync(join(TEST_DIR, 'user-preferences.json'), JSON.stringify(prefs), 'utf-8');

    migrateToProjectScoped();

    const updated = JSON.parse(
      require('fs').readFileSync(join(TEST_DIR, 'user-preferences.json'), 'utf-8')
    );
    expect(updated.verbosity).toBe('concise');
    expect(updated.autonomy).toBe('just_do_it');
  });

  it('handles missing user-preferences.json gracefully', () => {
    const result = migrateToProjectScoped();
    expect(result.preferencesMigrated).toBe(false);
    expect(result.errors).toHaveLength(0);
  });

  it('is idempotent — second run returns skipped: true', () => {
    migrateToProjectScoped();
    const second = migrateToProjectScoped();
    expect(second.skipped).toBe(true);
  });

  it('writes .migrated-v5 flag', () => {
    migrateToProjectScoped();
    expect(existsSync(join(TEST_DIR, '.migrated-v5'))).toBe(true);
  });
});
