import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCache,
} from '../../features/workflow-engine/checkpoint.js';
import type {
  WorkflowCheckpointV3,
  ConstructionDesignStage,
  RegressionBaseline,
  RegressionCategory,
  RegressionReport,
  TestFrameworkInfo,
} from '../../features/workflow-engine/phase-types.js';

const makeMinimalCheckpoint = (overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 => ({
  schema_version: '3.0.0',
  workflow_id: 'test-infra-types',
  feature_name: 'test-feature',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-15T10:00:00Z',
  current_phase: 'construction',
  current_stage: 'code-generation',
  status: 'in_progress',
  phases: {
    discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    inception: { status: 'completed', started_at: '2024-01-15T10:00:00Z', completed_at: '2024-01-15T11:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
    construction: { status: 'in_progress', started_at: '2024-01-15T11:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
  },
  manifest_path: 'aidlc-docs/test-infra-types/manifest.json',
  trust_state_path: 'aidlc-docs/test-infra-types/trust.json',
  ...overrides,
});

describe('Test infrastructure types', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'test-infra-types-'));
  });

  afterEach(async () => {
    clearCache();
    await fs.remove(tmpDir);
  });

  describe('New type exports', () => {
    it('RegressionBaseline has correct shape', () => {
      const baseline: RegressionBaseline = {
        tests: [
          { name: 'it does a thing', filePath: 'src/foo.test.ts', status: 'passed', duration_ms: 42 },
          { name: 'it skips', filePath: 'src/bar.test.ts', status: 'skipped', duration_ms: 0 },
        ],
        captured_at: '2024-01-15T10:00:00Z',
        test_command: 'npm test',
        framework: 'vitest',
        total: 2,
        passed: 1,
        failed: 0,
        skipped: 1,
      };

      expect(baseline.tests).toHaveLength(2);
      expect(baseline.tests[0].status).toBe('passed');
      expect(baseline.tests[1].status).toBe('skipped');
      expect(baseline.captured_at).toBe('2024-01-15T10:00:00Z');
      expect(baseline.test_command).toBe('npm test');
      expect(baseline.framework).toBe('vitest');
      expect(baseline.total).toBe(2);
      expect(baseline.passed).toBe(1);
      expect(baseline.failed).toBe(0);
      expect(baseline.skipped).toBe(1);
    });

    it('RegressionCategory accepts all valid values', () => {
      const values: RegressionCategory[] = [
        'legitimate_regression',
        'intentional_change',
        'flaky',
        'pre_existing_failure',
      ];
      expect(values).toHaveLength(4);
      expect(values).toContain('legitimate_regression');
      expect(values).toContain('flaky');
    });

    it('RegressionReport has correct shape with failures array', () => {
      const report: RegressionReport = {
        workflow_id: 'wf-001',
        unit_id: 'UNIT-001',
        baseline_captured_at: '2024-01-15T10:00:00Z',
        compared_at: '2024-01-15T12:00:00Z',
        failures: [
          {
            test_name: 'it breaks',
            file_path: 'src/foo.test.ts',
            category: 'legitimate_regression',
            rationale: 'new code removed the feature',
          },
        ],
        total_regressions: 1,
        legitimate_regressions: 1,
      };

      expect(report.failures).toHaveLength(1);
      expect(report.failures[0].category).toBe('legitimate_regression');
      expect(report.total_regressions).toBe(1);
      expect(report.legitimate_regressions).toBe(1);
    });

    it('TestFrameworkInfo works with and without configPath', () => {
      const withConfig: TestFrameworkInfo = {
        name: 'vitest',
        testCommand: 'npm test',
        configPath: 'vitest.config.ts',
      };
      const withoutConfig: TestFrameworkInfo = {
        name: 'jest',
        testCommand: 'npx jest',
      };

      expect(withConfig.configPath).toBe('vitest.config.ts');
      expect(withoutConfig.configPath).toBeUndefined();
    });
  });

  describe('ConstructionDesignStage includes test-generation', () => {
    it('accepts test-generation as a valid stage value', () => {
      const stage: ConstructionDesignStage = 'test-generation';
      expect(stage).toBe('test-generation');
    });

    it('all stage values are assignable to ConstructionDesignStage', () => {
      const stages: ConstructionDesignStage[] = [
        'functional-design',
        'nfr-requirements',
        'nfr-design',
        'infrastructure-design',
        'code-generation',
        'test-generation',
      ];
      expect(stages).toHaveLength(6);
      expect(stages).toContain('test-generation');
    });
  });

  describe('Checkpoint migration — test-generation stage', () => {
    it('adds not_started for a unit with code_generation_status not completed', async () => {
      const checkpoint = makeMinimalCheckpoint({
        construction_units: {
          'UNIT-001': {
            unitId: 'UNIT-001',
            stages: {
              'functional-design': { status: 'completed', artifact_path: 'a.md', completed_at: '2024-01-15T10:00:00Z' },
              'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'in_progress', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            } as any,
            code_plan_path: null,
            code_generation_status: 'generating',
          },
        },
      });

      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const loaded = await loadCheckpoint(tmpDir, 'test-infra-types');
      expect(loaded).not.toBeNull();
      const unit = loaded!.construction_units!['UNIT-001'];
      expect(unit.stages['test-generation']).toBeDefined();
      expect(unit.stages['test-generation'].status).toBe('not_started');
      expect(unit.stages['test-generation'].artifact_path).toBeNull();
      expect(unit.stages['test-generation'].completed_at).toBeNull();
    });

    it('adds skipped for a unit with code_generation_status completed', async () => {
      const checkpoint = makeMinimalCheckpoint({
        construction_units: {
          'UNIT-002': {
            unitId: 'UNIT-002',
            stages: {
              'functional-design': { status: 'completed', artifact_path: 'b.md', completed_at: '2024-01-15T10:00:00Z' },
              'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'completed', artifact_path: 'code.md', completed_at: '2024-01-15T12:00:00Z' },
            } as any,
            code_plan_path: null,
            code_generation_status: 'completed',
          },
        },
      });

      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const loaded = await loadCheckpoint(tmpDir, 'test-infra-types');
      expect(loaded).not.toBeNull();
      const unit = loaded!.construction_units!['UNIT-002'];
      expect(unit.stages['test-generation'].status).toBe('skipped');
    });

    it('does not overwrite an existing test-generation stage', async () => {
      const checkpoint = makeMinimalCheckpoint({
        construction_units: {
          'UNIT-003': {
            unitId: 'UNIT-003',
            stages: {
              'functional-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
              'code-generation': { status: 'completed', artifact_path: 'c.md', completed_at: '2024-01-15T10:00:00Z' },
              'test-generation': { status: 'in_progress', artifact_path: 'tests.md', completed_at: null, failure_count: 0, last_error: null },
            },
            code_plan_path: null,
            code_generation_status: 'completed',
          },
        },
      });

      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const loaded = await loadCheckpoint(tmpDir, 'test-infra-types');
      expect(loaded).not.toBeNull();
      const unit = loaded!.construction_units!['UNIT-003'];
      expect(unit.stages['test-generation'].status).toBe('in_progress');
      expect(unit.stages['test-generation'].artifact_path).toBe('tests.md');
    });

    it('handles checkpoint without construction_units without error', async () => {
      const checkpoint = makeMinimalCheckpoint();
      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const loaded = await loadCheckpoint(tmpDir, 'test-infra-types');
      expect(loaded).not.toBeNull();
      expect(loaded!.construction_units).toBeUndefined();
    });
  });

  describe('WorkflowCheckpointV3 bug_description field', () => {
    it('round-trips bug_description through save and load', async () => {
      const checkpoint = makeMinimalCheckpoint({
        bug_description: 'Users see a 500 error when saving a workflow with no units defined.',
      });

      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const loaded = await loadCheckpoint(tmpDir, 'test-infra-types');
      expect(loaded).not.toBeNull();
      expect(loaded!.bug_description).toBe('Users see a 500 error when saving a workflow with no units defined.');
    });

    it('checkpoint without bug_description loads cleanly', async () => {
      const checkpoint = makeMinimalCheckpoint();
      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const loaded = await loadCheckpoint(tmpDir, 'test-infra-types');
      expect(loaded).not.toBeNull();
      expect(loaded!.bug_description).toBeUndefined();
    });
  });
});
