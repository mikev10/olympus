/**
 * Tests for executeTestGeneration() on ConstructionExecutor.
 *
 * Groups:
 * 1. State transitions
 * 2. Engine gating
 * 3. Artifact creation
 * 4. Checkpoint persistence
 * 5. SHALLOW depth integration (express bolt path)
 * 6. Framework detection
 * 7. Validation pipeline integration
 * 8. Smoke test coverage report
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  ConstructionExecutor,
} from '../../../features/workflow-engine/construction/executor.js';

const { loadCheckpoint: mockLoadCheckpoint, saveCheckpoint: mockSaveCheckpoint } = vi.hoisted(() => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
}));

vi.mock('../../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: mockLoadCheckpoint,
  saveCheckpoint: mockSaveCheckpoint,
  clearCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

const mockRunValidationPipeline = vi.hoisted(() => vi.fn());
const mockShouldSkipValidator = vi.hoisted(() => vi.fn());
const mockUpdateCheckpointForValidator = vi.hoisted(() => vi.fn());
const mockCreateQualityValidator = vi.hoisted(() => vi.fn());
const mockCreateMutationValidator = vi.hoisted(() => vi.fn());
const mockCreateTraceabilityValidator = vi.hoisted(() => vi.fn());
const mockCreateContractValidator = vi.hoisted(() => vi.fn());
const mockCreateCoverageValidator = vi.hoisted(() => vi.fn());

vi.mock('../../../features/workflow-engine/construction/validators/index.js', () => ({
  runValidationPipeline: mockRunValidationPipeline,
  shouldSkipValidator: mockShouldSkipValidator,
  updateCheckpointForValidator: mockUpdateCheckpointForValidator,
  createQualityValidator: mockCreateQualityValidator,
  createMutationValidator: mockCreateMutationValidator,
  createTraceabilityValidator: mockCreateTraceabilityValidator,
  createContractValidator: mockCreateContractValidator,
  createCoverageValidator: mockCreateCoverageValidator,
}));

describe('ConstructionExecutor.executeTestGeneration()', () => {
  const testDir = path.join(process.cwd(), '.test-test-generation');
  const workflowId = 'tg-workflow';
  const unitId = 'UNIT-001-feature';

  function makeCheckpoint(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: '3.0.0',
      workflow_id: workflowId,
      feature_name: 'Test Feature',
      current_phase: 'construction',
      current_stage: 'code-generation',
      status: 'active',
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      construction_units: {},
      ...overrides,
    };
  }

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    mockLoadCheckpoint.mockReset();
    mockSaveCheckpoint.mockReset();
    mockSaveCheckpoint.mockResolvedValue(undefined);

    mockRunValidationPipeline.mockReset();
    mockShouldSkipValidator.mockReset();
    mockUpdateCheckpointForValidator.mockReset();
    mockCreateQualityValidator.mockReset();
    mockCreateMutationValidator.mockReset();
    mockCreateTraceabilityValidator.mockReset();
    mockCreateContractValidator.mockReset();
    mockCreateCoverageValidator.mockReset();

    const passedResult = { status: 'passed', findings: [], artifactPath: '/fake' };
    mockCreateQualityValidator.mockReturnValue(() => Promise.resolve(passedResult));
    mockCreateMutationValidator.mockReturnValue(() => Promise.resolve(passedResult));
    mockCreateTraceabilityValidator.mockReturnValue(() => Promise.resolve(passedResult));
    mockCreateContractValidator.mockReturnValue(() => Promise.resolve(passedResult));
    mockCreateCoverageValidator.mockReturnValue(() => Promise.resolve({ ...passedResult, coverage_percentage: 85.2 }));
    mockShouldSkipValidator.mockReturnValue({ skip: false });
    mockRunValidationPipeline.mockResolvedValue({ results: [
      { validator: 'quality', result: passedResult },
      { validator: 'traceability', result: passedResult },
      { validator: 'coverage', result: { ...passedResult, coverage_percentage: 85.2 } },
    ] });
    mockUpdateCheckpointForValidator.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('Group 1: state transitions', () => {
    it('sets test-generation stage to in_progress then completed on success with allowFailures', async () => {
      const statusHistory: string[] = [];
      mockSaveCheckpoint.mockImplementation((_projectPath: string, cp: any) => {
        const unit = cp.construction_units?.[unitId];
        if (unit?.stages?.['test-generation']?.status) {
          statusHistory.push(unit.stages['test-generation'].status);
        }
        return Promise.resolve();
      });
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(statusHistory).toContain('in_progress');
      expect(statusHistory[statusHistory.length - 1]).toBe('completed');
      expect(result.status).toBe('completed');
    });

    it('sets test_generation_status to completed on success', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true });

      const lastSave = mockSaveCheckpoint.mock.calls[mockSaveCheckpoint.mock.calls.length - 1][1];
      expect(lastSave.construction_units[unitId].test_generation_status).toBe('completed');
    });

    it('sets test_framework from package.json detection', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());
      await fs.writeJson(path.join(testDir, 'package.json'), {
        devDependencies: { vitest: '^1.0.0' },
      });

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true });

      const lastSave = mockSaveCheckpoint.mock.calls[mockSaveCheckpoint.mock.calls.length - 1][1];
      expect(lastSave.construction_units[unitId].test_framework).toBe('vitest');
    });

    it('populates tests_total, tests_passed, tests_failed on the unit progress', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true });

      const lastSave = mockSaveCheckpoint.mock.calls[mockSaveCheckpoint.mock.calls.length - 1][1];
      const unit = lastSave.construction_units[unitId];
      expect(unit.tests_total).toBeDefined();
      expect(unit.tests_passed).toBeDefined();
      expect(unit.tests_failed).toBeDefined();
    });
  });

  describe('Group 2: engine gating', () => {
    it('returns status blocked with blockingReason when tests_total === 0', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId);

      expect(result.status).toBe('blocked');
      expect(result.blockingReason).toContain('No tests detected');
    });

    it('returns status blocked with blockingReason when tests_failed > 0 (via allowFailures override check)', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId);

      expect(result.status).toBe('blocked');
      expect(result.blockingReason).toBeDefined();
    });

    it('returns status completed when allowFailures is true even with tests_total === 0', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.status).toBe('completed');
      expect(result.blockingReason).toBeUndefined();
    });

    it('returns status completed when allowFailures is true even with tests_failed > 0 (gating bypassed)', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.status).toBe('completed');
    });
  });

  describe('Group 3: artifact creation', () => {
    it('writes test-report.md to the correct path', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      const expectedPath = path.join(testDir, 'aidlc-docs', workflowId, 'construction', unitId, 'testing', 'test-report.md');
      expect(result.reportPath).toBe(expectedPath);
      expect(await fs.pathExists(expectedPath)).toBe(true);
    });

    it('test-report.md contains ## Files in Scope section', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      const content = await fs.readFile(result.reportPath, 'utf-8');
      expect(content).toContain('## Files in Scope');
    });

    it('test-report.md contains ## Test Results section', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      const content = await fs.readFile(result.reportPath, 'utf-8');
      expect(content).toContain('## Test Results');
    });
  });

  describe('Group 4: checkpoint persistence', () => {
    it('saves updated construction_units[unitId] to checkpoint after completion', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true });

      const lastSave = mockSaveCheckpoint.mock.calls[mockSaveCheckpoint.mock.calls.length - 1][1];
      expect(lastSave.construction_units).toBeDefined();
      expect(lastSave.construction_units[unitId]).toBeDefined();
      expect(lastSave.construction_units[unitId].stages['test-generation']).toBeDefined();
    });

    it('initializes construction_units if missing from checkpoint', async () => {
      const checkpoint = makeCheckpoint();
      delete (checkpoint as any).construction_units;
      mockLoadCheckpoint.mockResolvedValue(checkpoint);

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true });

      const firstSave = mockSaveCheckpoint.mock.calls[0][1];
      expect(firstSave.construction_units).toBeDefined();
      expect(firstSave.construction_units[unitId]).toBeDefined();
    });
  });

  describe('Group 5: SHALLOW depth integration (express bolt path)', () => {
    async function createIntentFile(title: string, effort: number): Promise<void> {
      const intentDir = path.join(testDir, 'aidlc-docs', workflowId, 'inception');
      await fs.ensureDir(intentDir);
      await fs.writeFile(
        path.join(intentDir, 'intent.md'),
        `---
id: intent-${workflowId}
title: "${title}"
status: pending
estimated_effort: ${effort}
---

# Intent: ${title}

## Business Requirements
Implement ${title}

## Acceptance Criteria
- [ ] Feature complete
`
      );
    }

    it('execute() with depth SHALLOW returns passed: true via express bolt pipeline', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      await createIntentFile('Quick Fix', 2);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
    });

    it('SHALLOW returns passed: false when no checkpoint exists', async () => {
      mockLoadCheckpoint.mockResolvedValue(null);

      await createIntentFile('No Checkpoint', 2);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(false);
      expect(result.blocking_issues).toContain('No checkpoint found for SHALLOW construction');
    });
  });

  describe('Group 6: framework detection', () => {
    it('detects vitest from package.json devDependencies', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());
      await fs.writeJson(path.join(testDir, 'package.json'), {
        devDependencies: { vitest: '^1.0.0' },
      });

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.test_framework).toBe('vitest');
    });

    it('detects jest from package.json dependencies', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());
      await fs.writeJson(path.join(testDir, 'package.json'), {
        dependencies: { jest: '^29.0.0' },
      });

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.test_framework).toBe('jest');
    });

    it('falls back to unknown when no known framework found', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());
      await fs.writeJson(path.join(testDir, 'package.json'), {
        devDependencies: { typescript: '^5.0.0' },
      });

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.test_framework).toBe('unknown');
    });

    it('falls back to unknown when package.json does not exist', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.test_framework).toBe('unknown');
    });
  });

  describe('Group 7: currentResults and regression analysis', () => {
    const makeBaseline = (tests: Array<{ name: string; status: 'passed' | 'failed' | 'skipped' }>) => ({
      tests: tests.map(t => ({ name: t.name, filePath: 'src/foo.test.ts', status: t.status, duration_ms: 10 })),
      captured_at: '2026-01-01T00:00:00.000Z',
      test_command: 'npm test',
      framework: 'vitest',
      total: tests.length,
      passed: tests.filter(t => t.status === 'passed').length,
      failed: tests.filter(t => t.status === 'failed').length,
      skipped: tests.filter(t => t.status === 'skipped').length,
    });

    it('reflects actual currentResults in tests_total, tests_passed, tests_failed', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const currentResults = [
        { name: 'test A', filePath: 'src/a.test.ts', status: 'passed' as const, duration_ms: 5 },
        { name: 'test B', filePath: 'src/b.test.ts', status: 'passed' as const, duration_ms: 5 },
        { name: 'test C', filePath: 'src/c.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults });

      expect(result.tests_total).toBe(3);
      expect(result.tests_passed).toBe(2);
      expect(result.tests_failed).toBe(1);
    });

    it('returns regressions_count: 0 and flaky_count: 0 when no currentResults provided', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true });

      expect(result.regressions_count).toBe(0);
      expect(result.flaky_count).toBe(0);
    });

    it('blocks with legitimate regression message when baseline exists and a previously passing test now fails', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const baselineDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      await fs.ensureDir(baselineDir);
      await fs.writeJson(
        path.join(baselineDir, 'regression-baseline.json'),
        makeBaseline([{ name: 'test A', status: 'passed' }])
      );

      const currentResults = [
        { name: 'test A', filePath: 'src/a.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { currentResults });

      expect(result.status).toBe('blocked');
      expect(result.blockingReason).toContain('legitimate regression');
      expect(result.regressions_count).toBe(1);
    });

    it('does not block when baseline exists and only flaky failures are found', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const baselineDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      await fs.ensureDir(baselineDir);
      await fs.writeJson(
        path.join(baselineDir, 'regression-baseline.json'),
        makeBaseline([{ name: 'pre-existing failure', status: 'failed' }])
      );

      const currentResults = [
        { name: 'pre-existing failure', filePath: 'src/a.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { currentResults });

      expect(result.status).toBe('completed');
      expect(result.regressions_count).toBe(0);
    });

    it('blocks with generic failure message when no baseline and tests fail', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const currentResults = [
        { name: 'test A', filePath: 'src/a.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { currentResults });

      expect(result.status).toBe('blocked');
      expect(result.blockingReason).toContain('test(s) failed');
      expect(result.blockingReason).not.toContain('legitimate regression');
    });

    it('writes regressions_count and flaky_count to checkpoint', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const baselineDir = path.join(testDir, 'aidlc-docs', workflowId, 'construction');
      await fs.ensureDir(baselineDir);
      await fs.writeJson(
        path.join(baselineDir, 'regression-baseline.json'),
        makeBaseline([{ name: 'test A', status: 'passed' }])
      );

      const currentResults = [
        { name: 'test A', filePath: 'src/a.test.ts', status: 'failed' as const, duration_ms: 5 },
      ];

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { currentResults, allowFailures: true });

      const lastSave = mockSaveCheckpoint.mock.calls[mockSaveCheckpoint.mock.calls.length - 1][1];
      const unit = lastSave.construction_units[unitId];
      expect(unit.regressions_count).toBe(1);
      expect(unit.flaky_count).toBe(0);
    });
  });

  describe('Group 8: validation pipeline integration', () => {
    const passingResults = [
      { name: 'test1', filePath: 'test.ts', status: 'passed' as const, duration_ms: 10 },
    ];

    it('calls runValidationPipeline when test generation completes', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      expect(mockRunValidationPipeline).toHaveBeenCalledTimes(1);
    });

    it('does not call runValidationPipeline when status is blocked', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId);

      expect(mockRunValidationPipeline).not.toHaveBeenCalled();
    });

    it('returns validationPipeline in result when pipeline runs', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      expect(result.validationPipeline).toBeDefined();
      expect(Array.isArray(result.validationPipeline?.results)).toBe(true);
    });

    it('calls updateCheckpointForValidator for each pipeline result', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      expect(mockUpdateCheckpointForValidator).toHaveBeenCalledTimes(3);
    });

    it('sets status to blocked when a validator fails and allowFailures is false', async () => {
      const failedResult = { status: 'failed', findings: [], artifactPath: '/fake' };
      mockRunValidationPipeline.mockResolvedValue({ results: [
        { validator: 'quality', result: { status: 'passed', findings: [], artifactPath: '/fake' } },
        { validator: 'contract', result: failedResult },
      ] });
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { currentResults: passingResults });

      expect(result.status).toBe('blocked');
      expect(result.blockingReason).toContain('contract');
    });

    it('does not block when validator fails but allowFailures is true', async () => {
      const failedResult = { status: 'failed', findings: [], artifactPath: '/fake' };
      mockRunValidationPipeline.mockResolvedValue({ results: [
        { validator: 'quality', result: { status: 'passed', findings: [], artifactPath: '/fake' } },
        { validator: 'contract', result: failedResult },
      ] });
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      expect(result.status).toBe('completed');
    });

    it('pipeline failure is non-fatal', async () => {
      mockRunValidationPipeline.mockRejectedValue(new Error('pipeline exploded'));
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      const result = await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      expect(result.status).toBe('completed');
      expect(result.validationPipeline).toBeUndefined();
    });

    it('passes coverage_percentage to updateCheckpointForValidator for coverage validator', async () => {
      const covResult = { status: 'passed', findings: [], artifactPath: '/fake', coverage_percentage: 91.5 };
      mockRunValidationPipeline.mockResolvedValue({ results: [
        { validator: 'coverage', result: covResult },
      ] });
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      const coverageCall = mockUpdateCheckpointForValidator.mock.calls.find(
        (c: unknown[]) => c[3] === 'coverage'
      );
      expect(coverageCall).toBeDefined();
      expect(coverageCall![5]).toBe(91.5);
    });

    it('passes criticalGapCount from findings to updateCheckpointForValidator', async () => {
      const covResult = {
        status: 'passed',
        findings: [
          { category: 'uncovered-critical-file', file: 'src/a.ts', message: 'missing' },
          { category: 'uncovered-critical-file', file: 'src/b.ts', message: 'missing' },
          { category: 'low-coverage', file: 'src/c.ts', message: 'low' },
        ],
        artifactPath: '/fake',
        coverage_percentage: 55.0,
      };
      mockRunValidationPipeline.mockResolvedValue({ results: [
        { validator: 'coverage', result: covResult },
      ] });
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeTestGeneration(unitId, { allowFailures: true, currentResults: passingResults });

      const coverageCall = mockUpdateCheckpointForValidator.mock.calls.find(
        (c: unknown[]) => c[3] === 'coverage'
      );
      expect(coverageCall).toBeDefined();
      expect(coverageCall![6]).toBe(2);
    });
  });

  describe('Group 9: smoke test coverage report', () => {
    it('executeSmokeTest writes coverage-report.md', async () => {
      mockLoadCheckpoint.mockResolvedValue(makeCheckpoint({
        construction_units: {
          'u-alpha': {
            unit_id: 'u-alpha',
            status: 'active',
            stages: {},
            tests_total: 10,
            tests_passed: 10,
            tests_failed: 0,
            coverage_percentage: 88.0,
            critical_gap_count: 1,
          },
          'u-beta': {
            unit_id: 'u-beta',
            status: 'active',
            stages: {},
            tests_total: 5,
            tests_passed: 4,
            tests_failed: 1,
            coverage_percentage: 72.5,
            critical_gap_count: 3,
          },
        },
      }));

      const executor = new ConstructionExecutor(testDir, workflowId);
      await executor.executeSmokeTest();

      const coverageReportPath = path.join(
        testDir, 'aidlc-docs', workflowId, 'construction', 'build-and-test', 'coverage-report.md'
      );
      expect(await fs.pathExists(coverageReportPath)).toBe(true);

      const content = await fs.readFile(coverageReportPath, 'utf-8');
      expect(content).toContain('Workflow Coverage Report');
      expect(content).toContain('u-alpha');
      expect(content).toContain('u-beta');
    });
  });
});
