/**
 * Hook Bundle Integration Tests
 *
 * Tests that the bundled hook file can be built and executed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '..', '..', '..');
const BUNDLE_PATH = join(PROJECT_ROOT, 'dist', 'hooks', 'olympus-hooks.cjs');

/**
 * Execute bundle with stdin input (cross-platform)
 */
function execBundleWithInput(event: string, input: string, timeout = 5000): { stdout: string; stderr: string; error?: Error } {
  try {
    const result = spawnSync('node', [BUNDLE_PATH, `--event=${event}`], {
      input,
      encoding: 'utf-8',
      timeout,
      cwd: PROJECT_ROOT,
      shell: true
    });
    return { stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    return { stdout: '', stderr: '', error: error as Error };
  }
}

describe('Hook Bundle', () => {
  describe('Bundle File', () => {
    it('bundle file exists', () => {
      // Skip if bundle doesn't exist (CI might not have built it)
      if (!existsSync(BUNDLE_PATH)) {
        console.log('Bundle not found, skipping bundle tests. Run npm run build:hooks first.');
        return;
      }
      expect(existsSync(BUNDLE_PATH)).toBe(true);
    });

    it('bundle size is reasonable (<500KB)', () => {
      if (!existsSync(BUNDLE_PATH)) {
        console.log('Bundle not found, skipping size test.');
        return;
      }

      const stats = statSync(BUNDLE_PATH);
      const sizeKB = stats.size / 1024;

      console.log(`Bundle size: ${sizeKB.toFixed(2)} KB`);
      expect(sizeKB).toBeLessThan(500);
    });
  });

  describe('Bundle Execution', () => {
    it('can be executed without import errors', { timeout: 10000 }, () => {
      if (!existsSync(BUNDLE_PATH)) {
        console.log('Bundle not found, skipping execution test.');
        return;
      }

      const { stdout, stderr } = execBundleWithInput('UserPromptSubmit', '{}');

      // Import errors should fail the test
      expect(stderr).not.toContain('Cannot find module');
      expect(stderr).not.toContain('SyntaxError');
      expect(stderr).not.toContain('is not defined');

      // Should return valid JSON
      if (stdout.trim()) {
        const parsed = JSON.parse(stdout.trim());
        expect(parsed).toHaveProperty('continue');
      }
    });

    it('returns valid JSON for all event types', { timeout: 60000 }, () => {
      if (!existsSync(BUNDLE_PATH)) {
        console.log('Bundle not found, skipping event types test.');
        return;
      }

      const events = [
        'UserPromptSubmit',
        'SessionStart',
        'Stop',
        'PreToolUse',
        'PostToolUse',
        'PostToolUseFailure',
        'Notification'
      ];

      for (const event of events) {
        const { stdout, stderr } = execBundleWithInput(event, '{"sessionId":"test"}');

        // Import errors should fail
        expect(stderr).not.toContain('Cannot find module');
        expect(stderr).not.toContain('SyntaxError');

        // Should return valid JSON
        if (stdout.trim()) {
          const parsed = JSON.parse(stdout.trim());
          expect(parsed).toHaveProperty('continue');
        }
      }
    });

    it('handles missing event argument gracefully', () => {
      if (!existsSync(BUNDLE_PATH)) {
        console.log('Bundle not found, skipping error handling test.');
        return;
      }

      try {
        execSync(`echo '{}' | node "${BUNDLE_PATH}"`, {
          encoding: 'utf-8',
          timeout: 5000,
          cwd: PROJECT_ROOT
        });
        // Should fail without --event
        expect(true).toBe(false); // Force fail if we get here
      } catch (error: any) {
        // Expected to fail with usage message
        const stderr = error.stderr?.toString() || '';
        expect(stderr).toContain('--event');
      }
    });
  });
});
