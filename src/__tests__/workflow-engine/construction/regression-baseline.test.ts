import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import {
  compareAgainstBaseline,
  captureBaseline,
  writeRegressionReport,
} from '../../../features/workflow-engine/construction/regression-baseline.js';
import type { RegressionBaseline, RegressionReport } from '../../../features/workflow-engine/phase-types.js';

const mockedExecSync = vi.mocked(execSync);

describe('regression-baseline.ts', () => {
  const testDir = path.join(process.cwd(), '.test-regression-baseline');
  const workflowId = 'wf-test-rbl';

  function constructionPath(...parts: string[]): string {
    return path.join(testDir, 'aidlc-docs', workflowId, 'construction', ...parts);
  }

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('compareAgainstBaseline', () => {
    function makeBaseline(tests: RegressionBaseline['tests']): RegressionBaseline {
      return {
        tests,
        captured_at: '2026-01-01T00:00:00.000Z',
        test_command: 'npm test',
        framework: 'vitest',
        total: tests.length,
        passed: tests.filter(t => t.status === 'passed').length,
        failed: tests.filter(t => t.status === 'failed').length,
        skipped: tests.filter(t => t.status === 'skipped').length,
      };
    }

    it('detects new failure when baseline was passing', () => {
      const baseline = makeBaseline([
        { name: 'test A', filePath: 'src/a.test.ts', status: 'passed', duration_ms: 10 },
      ]);
      const current = [
        { name: 'test A', filePath: 'src/a.test.ts', status: 'failed' as const, duration_ms: 10 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.new_failures).toHaveLength(1);
      expect(diff.new_failures[0].name).toBe('test A');
      expect(diff.new_passes).toHaveLength(0);
    });

    it('detects new failure when baseline was skipped', () => {
      const baseline = makeBaseline([
        { name: 'test B', filePath: 'src/b.test.ts', status: 'skipped', duration_ms: 0 },
      ]);
      const current = [
        { name: 'test B', filePath: 'src/b.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.new_failures).toHaveLength(1);
      expect(diff.new_failures[0].name).toBe('test B');
    });

    it('detects new pass (fix) when baseline was failing', () => {
      const baseline = makeBaseline([
        { name: 'test C', filePath: 'src/c.test.ts', status: 'failed', duration_ms: 20 },
      ]);
      const current = [
        { name: 'test C', filePath: 'src/c.test.ts', status: 'passed' as const, duration_ms: 20 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.new_passes).toHaveLength(1);
      expect(diff.new_passes[0].name).toBe('test C');
      expect(diff.new_failures).toHaveLength(0);
    });

    it('detects timing change when delta exceeds 100 ms', () => {
      const baseline = makeBaseline([
        { name: 'test D', filePath: 'src/d.test.ts', status: 'passed', duration_ms: 50 },
      ]);
      const current = [
        { name: 'test D', filePath: 'src/d.test.ts', status: 'passed' as const, duration_ms: 200 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.timing_changes).toHaveLength(1);
      expect(diff.timing_changes[0].delta_ms).toBe(150);
      expect(diff.timing_changes[0].before_ms).toBe(50);
      expect(diff.timing_changes[0].after_ms).toBe(200);
    });

    it('ignores timing change when delta is exactly 100 ms (threshold is >100)', () => {
      const baseline = makeBaseline([
        { name: 'test E', filePath: 'src/e.test.ts', status: 'passed', duration_ms: 100 },
      ]);
      const current = [
        { name: 'test E', filePath: 'src/e.test.ts', status: 'passed' as const, duration_ms: 200 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.timing_changes).toHaveLength(0);
    });

    it('does not add pre-existing failure to new_failures or new_passes', () => {
      const baseline = makeBaseline([
        { name: 'test F', filePath: 'src/f.test.ts', status: 'failed', duration_ms: 5 },
      ]);
      const current = [
        { name: 'test F', filePath: 'src/f.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.new_failures).toHaveLength(0);
      expect(diff.new_passes).toHaveLength(0);
    });

    it('adds unknown test with failed status to new_failures (no baseline entry)', () => {
      const baseline = makeBaseline([]);
      const current = [
        { name: 'brand new test', filePath: 'src/new.test.ts', status: 'failed' as const, duration_ms: 0 },
      ];
      const diff = compareAgainstBaseline(baseline, current);
      expect(diff.new_failures).toHaveLength(1);
      expect(diff.new_failures[0].name).toBe('brand new test');
    });

    it('computed_at is a valid ISO 8601 string', () => {
      const baseline = makeBaseline([]);
      const diff = compareAgainstBaseline(baseline, []);
      expect(() => new Date(diff.computed_at)).not.toThrow();
      expect(diff.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('completes 1000-test comparison in under 5 seconds', () => {
      const tests: RegressionBaseline['tests'] = Array.from({ length: 1000 }, (_, i) => ({
        name: `test-${i}`,
        filePath: `src/file-${i}.test.ts`,
        status: 'passed' as const,
        duration_ms: 10,
      }));
      const baseline = makeBaseline(tests);
      const current = tests.map((t, i) => ({
        ...t,
        status: (i % 10 === 0 ? 'failed' : 'passed') as 'passed' | 'failed' | 'skipped',
      }));

      const start = performance.now();
      compareAgainstBaseline(baseline, current);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(5000);
    });
  });

  describe('captureBaseline', () => {
    const plainTextOutput = [
      'PASS src/foo.test.ts',
      '✓ it does something (15ms)',
      '✓ it does another thing (8ms)',
      'FAIL src/bar.test.ts',
      '✗ it breaks here (3ms)',
    ].join('\n');

    it('writes regression-baseline.json to the correct path', async () => {
      mockedExecSync.mockReturnValue(plainTextOutput as unknown as Buffer);
      await captureBaseline(testDir, workflowId, 'npm test');
      const baselinePath = constructionPath('regression-baseline.json');
      const exists = await fs.pathExists(baselinePath);
      expect(exists).toBe(true);
    });

    it('returns RegressionBaseline with correct structure', async () => {
      mockedExecSync.mockReturnValue(plainTextOutput as unknown as Buffer);
      const baseline = await captureBaseline(testDir, workflowId, 'npm test');
      expect(baseline).toHaveProperty('tests');
      expect(baseline).toHaveProperty('captured_at');
      expect(baseline).toHaveProperty('test_command', 'npm test');
      expect(baseline).toHaveProperty('framework');
      expect(baseline).toHaveProperty('total');
      expect(baseline).toHaveProperty('passed');
      expect(baseline).toHaveProperty('failed');
      expect(baseline).toHaveProperty('skipped');
      expect(Array.isArray(baseline.tests)).toBe(true);
    });

    it('handles non-zero exit code gracefully (test runner throws with stdout on .stdout)', async () => {
      const error = Object.assign(new Error('Command failed'), { stdout: plainTextOutput, stderr: '' });
      mockedExecSync.mockImplementation(() => { throw error; });
      // Should not throw — non-zero exit is expected when some tests fail
      const baseline = await captureBaseline(testDir, workflowId, 'npm test');
      expect(baseline.tests.length).toBeGreaterThan(0);
    });

    it('detects vitest framework from command string', async () => {
      mockedExecSync.mockReturnValue('' as unknown as Buffer);
      const baseline = await captureBaseline(testDir, workflowId, 'npx vitest run');
      expect(baseline.framework).toBe('vitest');
    });

    it('detects jest framework from command string', async () => {
      mockedExecSync.mockReturnValue('' as unknown as Buffer);
      const baseline = await captureBaseline(testDir, workflowId, 'npx jest --ci');
      expect(baseline.framework).toBe('jest');
    });

    it('defaults to unknown framework when command is not recognized', async () => {
      mockedExecSync.mockReturnValue('' as unknown as Buffer);
      const baseline = await captureBaseline(testDir, workflowId, 'cargo test');
      expect(baseline.framework).toBe('unknown');
    });

    it('summary counts match the parsed test results', async () => {
      mockedExecSync.mockReturnValue(plainTextOutput as unknown as Buffer);
      const baseline = await captureBaseline(testDir, workflowId, 'npm test');
      expect(baseline.passed + baseline.failed + baseline.skipped).toBe(baseline.total);
      expect(baseline.passed).toBeGreaterThanOrEqual(0);
      expect(baseline.failed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('writeRegressionReport', () => {
    function makeReport(overrides: Partial<RegressionReport> = {}): RegressionReport {
      return {
        workflow_id: workflowId,
        unit_id: 'u-001-core',
        baseline_captured_at: '2026-01-01T00:00:00.000Z',
        compared_at: '2026-01-02T00:00:00.000Z',
        total_regressions: 2,
        legitimate_regressions: 1,
        failures: [
          {
            test_name: 'it should parse tokens',
            file_path: 'src/parser.test.ts',
            category: 'legitimate_regression',
            rationale: 'Test was passing in baseline',
          },
        ],
        ...overrides,
      };
    }

    it('creates the testing/ directory if it does not exist', async () => {
      await writeRegressionReport(testDir, workflowId, 'u-001-core', makeReport());
      const testingDir = path.join(
        testDir, 'aidlc-docs', workflowId, 'construction', 'u-001-core', 'testing'
      );
      const exists = await fs.pathExists(testingDir);
      expect(exists).toBe(true);
    });

    it('writes the markdown file at the expected path', async () => {
      await writeRegressionReport(testDir, workflowId, 'u-001-core', makeReport());
      const reportPath = path.join(
        testDir, 'aidlc-docs', workflowId, 'construction', 'u-001-core', 'testing', 'regression-report.md'
      );
      const exists = await fs.pathExists(reportPath);
      expect(exists).toBe(true);
    });

    it('file content includes workflow_id, unit_id, and failure count', async () => {
      const report = makeReport({ total_regressions: 3 });
      await writeRegressionReport(testDir, workflowId, 'u-001-core', report);
      const reportPath = path.join(
        testDir, 'aidlc-docs', workflowId, 'construction', 'u-001-core', 'testing', 'regression-report.md'
      );
      const content = await fs.readFile(reportPath, 'utf-8');
      expect(content).toContain(workflowId);
      expect(content).toContain('u-001-core');
      expect(content).toContain('3');
    });
  });
});
