import { describe, it, expect } from 'vitest';
import {
  categorizeFailure,
  checkFlakyThreshold,
  buildRegressionSummary,
} from '../../../features/workflow-engine/construction/regression-categorizer.js';
import type { RegressionCategory } from '../../../features/workflow-engine/phase-types.js';

describe('regression-categorizer.ts', () => {
  describe('categorizeFailure', () => {
    it('returns pre_existing_failure when baseline status is failed, regardless of reruns', () => {
      const result = categorizeFailure('test A', { status: 'failed' }, [{ status: 'passed' }]);
      expect(result).toBe('pre_existing_failure');
    });

    it('returns pre_existing_failure when baseline status is failed and reruns all failed', () => {
      const result = categorizeFailure('test B', { status: 'failed' }, [{ status: 'failed' }, { status: 'failed' }]);
      expect(result).toBe('pre_existing_failure');
    });

    it('returns flaky when baseline was passing and at least one rerun passed', () => {
      const result = categorizeFailure('test C', { status: 'passed' }, [{ status: 'passed' }]);
      expect(result).toBe('flaky');
    });

    it('returns legitimate_regression when baseline was passing and all reruns failed', () => {
      const result = categorizeFailure('test D', { status: 'passed' }, [{ status: 'failed' }, { status: 'failed' }]);
      expect(result).toBe('legitimate_regression');
    });

    it('returns intentional_change when baseline is null and all reruns failed', () => {
      const result = categorizeFailure('test E', null, [{ status: 'failed' }]);
      expect(result).toBe('intentional_change');
    });

    it('returns flaky when baseline is null and at least one rerun passed', () => {
      const result = categorizeFailure('test F', null, [{ status: 'failed' }, { status: 'passed' }]);
      expect(result).toBe('flaky');
    });

    it('returns legitimate_regression when baseline was skipped and all reruns failed', () => {
      const result = categorizeFailure('test G', { status: 'skipped' }, [{ status: 'failed' }]);
      expect(result).toBe('legitimate_regression');
    });

    it('returns legitimate_regression when baseline was passing and reruns array is empty', () => {
      const result = categorizeFailure('test H', { status: 'passed' }, []);
      expect(result).toBe('legitimate_regression');
    });
  });

  describe('checkFlakyThreshold', () => {
    it('returns false for empty input', () => {
      expect(checkFlakyThreshold([])).toBe(false);
    });

    it('returns false when no failures are flaky', () => {
      const categories: RegressionCategory[] = ['legitimate_regression', 'pre_existing_failure'];
      expect(checkFlakyThreshold(categories)).toBe(false);
    });

    it('returns false when flaky ratio is exactly 20% (threshold is strictly greater than)', () => {
      const categories: RegressionCategory[] = ['flaky', 'legitimate_regression', 'legitimate_regression', 'legitimate_regression', 'legitimate_regression'];
      expect(checkFlakyThreshold(categories)).toBe(false);
    });

    it('returns true when flaky ratio exceeds 20%', () => {
      const categories: RegressionCategory[] = ['flaky', 'flaky', 'legitimate_regression', 'legitimate_regression', 'legitimate_regression'];
      expect(checkFlakyThreshold(categories)).toBe(true);
    });

    it('returns true when all failures are flaky', () => {
      const categories: RegressionCategory[] = ['flaky', 'flaky', 'flaky'];
      expect(checkFlakyThreshold(categories)).toBe(true);
    });
  });

  describe('buildRegressionSummary', () => {
    const noFailures: Array<{ test_name: string; file_path: string }> = [];

    it('counts only legitimate_regression in regressions_count', () => {
      const categories: RegressionCategory[] = ['legitimate_regression', 'legitimate_regression', 'flaky'];
      const result = buildRegressionSummary(noFailures, categories);
      expect(result.regressions_count).toBe(2);
    });

    it('counts only flaky in flaky_count', () => {
      const categories: RegressionCategory[] = ['flaky', 'legitimate_regression', 'pre_existing_failure'];
      const result = buildRegressionSummary(noFailures, categories);
      expect(result.flaky_count).toBe(1);
    });

    it('excludes pre_existing_failure and intentional_change from both counts', () => {
      const categories: RegressionCategory[] = ['pre_existing_failure', 'intentional_change'];
      const result = buildRegressionSummary(noFailures, categories);
      expect(result.regressions_count).toBe(0);
      expect(result.flaky_count).toBe(0);
    });

    it('returns zero counts for empty input', () => {
      const result = buildRegressionSummary([], []);
      expect(result.regressions_count).toBe(0);
      expect(result.flaky_count).toBe(0);
    });
  });
});
