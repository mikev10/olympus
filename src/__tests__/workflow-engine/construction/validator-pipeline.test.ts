import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  runValidationPipeline,
  shouldSkipValidator,
  applyAllowFailures,
  updateCheckpointForValidator,
} from '../../../features/workflow-engine/construction/validators/pipeline.js';
import type { ValidatorName, ValidatorFn, ValidatorConfig, PipelineResult } from '../../../features/workflow-engine/construction/validators/types.js';
import type { ValidatorResult } from '../../../features/workflow-engine/phase-types.js';
import { saveCheckpoint } from '../../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3 } from '../../../features/workflow-engine/phase-types.js';

const testDir = path.join(process.cwd(), '.test-validator-pipeline');

function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    timeoutBudgetMs: 5000,
    allowFailures: false,
    workflowDepth: 2,
    unitId: 'UNIT-001',
    unitFiles: [],
    apiSurfaceFiles: [],
    projectPath: testDir,
    workflowId: 'wf-pipeline-test',
    ...overrides,
  };
}

function passingValidator(name: string): ValidatorFn {
  return async (_config) => ({
    status: 'passed',
    findings: [],
    artifactPath: `artifacts/${name}.json`,
  });
}

function failingValidator(message: string): ValidatorFn {
  return async (_config) => ({
    status: 'failed',
    findings: [{ id: 'f1', severity: 'error', category: 'test', message }],
    artifactPath: '',
  });
}

function throwingValidator(message: string): ValidatorFn {
  return async (_config) => {
    throw new Error(message);
  };
}

function slowValidator(delayMs: number): ValidatorFn {
  return async (_config) => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return { status: 'passed', findings: [], artifactPath: '' };
  };
}

function makeCheckpointV3(workflowId: string): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: workflowId,
    feature_name: 'test-feature',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: `aidlc-docs/${workflowId}/manifest.json`,
    trust_state_path: `aidlc-docs/${workflowId}/trust.json`,
    construction_units: {
      'UNIT-001': {
        unitId: 'UNIT-001',
        stages: {
          'functional-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          'code-generation': { status: 'completed', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          'test-generation': { status: 'completed', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        },
        code_plan_path: null,
        code_generation_status: 'completed',
      },
    },
  };
}

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.remove(testDir);
});

describe('runValidationPipeline', () => {
  it('runs all 5 validators when all are provided and returns results in order', async () => {
    const validators = new Map<ValidatorName, ValidatorFn>([
      ['quality', passingValidator('quality')],
      ['mutation', passingValidator('mutation')],
      ['traceability', passingValidator('traceability')],
      ['contract', passingValidator('contract')],
      ['coverage', passingValidator('coverage')],
    ]);

    const result = await runValidationPipeline(validators, makeConfig());

    expect(result.results).toHaveLength(5);
    expect(result.results.map(r => r.validator)).toEqual([
      'quality', 'mutation', 'traceability', 'contract', 'coverage',
    ]);
    for (const r of result.results) {
      expect(r.result.status).toBe('passed');
    }
  });

  it('runs only validators present in the map (partial execution)', async () => {
    const validators = new Map<ValidatorName, ValidatorFn>([
      ['quality', passingValidator('quality')],
      ['traceability', passingValidator('traceability')],
      ['coverage', passingValidator('coverage')],
    ]);

    const result = await runValidationPipeline(validators, makeConfig());

    expect(result.results).toHaveLength(3);
    expect(result.results.map(r => r.validator)).toEqual(['quality', 'traceability', 'coverage']);
  });

  it('enforces pipeline order regardless of Map insertion order', async () => {
    const validators = new Map<ValidatorName, ValidatorFn>([
      ['coverage', passingValidator('coverage')],
      ['quality', passingValidator('quality')],
      ['contract', passingValidator('contract')],
    ]);

    const result = await runValidationPipeline(validators, makeConfig());

    expect(result.results.map(r => r.validator)).toEqual(['quality', 'contract', 'coverage']);
  });

  it('catches a throwing validator, logs error finding, and continues with remaining validators', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const validators = new Map<ValidatorName, ValidatorFn>([
      ['quality', throwingValidator('quality exploded')],
      ['traceability', passingValidator('traceability')],
    ]);

    const result = await runValidationPipeline(validators, makeConfig());

    expect(result.results).toHaveLength(2);
    const qualityResult = result.results.find(r => r.validator === 'quality')!;
    expect(qualityResult.result.status).toBe('failed');
    expect(qualityResult.result.findings[0].category).toBe('runtime-error');
    expect(qualityResult.result.findings[0].message).toContain('quality exploded');

    const traceResult = result.results.find(r => r.validator === 'traceability')!;
    expect(traceResult.result.status).toBe('passed');

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('returns timeout status when validator exceeds budget', async () => {
    const validators = new Map<ValidatorName, ValidatorFn>([
      ['quality', slowValidator(200)],
    ]);

    const result = await runValidationPipeline(validators, makeConfig({ timeoutBudgetMs: 50 }));

    expect(result.results).toHaveLength(1);
    expect(result.results[0].result.status).toBe('timeout');
    expect(result.results[0].result.findings[0].category).toBe('timeout');
  });

  it('returns empty results when no validators are provided', async () => {
    const result = await runValidationPipeline(new Map(), makeConfig());
    expect(result.results).toHaveLength(0);
  });
});

describe('shouldSkipValidator', () => {
  it('does not skip quality validator regardless of unit files', () => {
    const r = shouldSkipValidator('quality', makeConfig({ unitFiles: [] }));
    expect(r.skip).toBe(false);
  });

  it('does not skip traceability validator', () => {
    const r = shouldSkipValidator('traceability', makeConfig({ unitFiles: [] }));
    expect(r.skip).toBe(false);
  });

  it('does not skip coverage validator', () => {
    const r = shouldSkipValidator('coverage', makeConfig({ unitFiles: [] }));
    expect(r.skip).toBe(false);
  });

  it('skips mutation when unit files contain no critical keywords', () => {
    const r = shouldSkipValidator('mutation', makeConfig({ unitFiles: ['src/logger.ts', 'src/formatter.ts'] }));
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/critical-path keywords/);
  });

  it('does not skip mutation when a unit file contains a critical keyword', () => {
    const r = shouldSkipValidator('mutation', makeConfig({ unitFiles: ['src/auth-service.ts'] }));
    expect(r.skip).toBe(false);
  });

  it('does not skip mutation when file contains "payment"', () => {
    const r = shouldSkipValidator('mutation', makeConfig({ unitFiles: ['src/payment-processor.ts'] }));
    expect(r.skip).toBe(false);
  });

  it('skips contract when no API surface files', () => {
    const r = shouldSkipValidator('contract', makeConfig({ apiSurfaceFiles: [] }));
    expect(r.skip).toBe(true);
    expect(r.reason).toMatch(/API surface/);
  });

  it('does not skip contract when API surface files are present', () => {
    const r = shouldSkipValidator('contract', makeConfig({ apiSurfaceFiles: ['src/routes.ts'] }));
    expect(r.skip).toBe(false);
  });
});

describe('applyAllowFailures', () => {
  it('upgrades a failed result to passed and downgrades all findings to info', () => {
    const input: ValidatorResult = {
      status: 'failed',
      findings: [
        { id: 'f1', severity: 'error', category: 'quality', message: 'bad' },
        { id: 'f2', severity: 'warning', category: 'coverage', message: 'low' },
      ],
      artifactPath: 'some/path',
    };

    const output = applyAllowFailures(input);

    expect(output.status).toBe('passed');
    expect(output.findings).toHaveLength(2);
    expect(output.findings[0].severity).toBe('info');
    expect(output.findings[1].severity).toBe('info');
    expect(output.artifactPath).toBe('some/path');
  });

  it('leaves a passing result unchanged in status', () => {
    const input: ValidatorResult = {
      status: 'passed',
      findings: [],
      artifactPath: 'ok',
    };
    const output = applyAllowFailures(input);
    expect(output.status).toBe('passed');
    expect(output.findings).toHaveLength(0);
  });

  it('does not mutate the original result', () => {
    const input: ValidatorResult = {
      status: 'warned',
      findings: [{ id: 'f1', severity: 'warning', category: 'test', message: 'x' }],
      artifactPath: '',
    };
    const output = applyAllowFailures(input);
    expect(input.status).toBe('warned');
    expect(input.findings[0].severity).toBe('warning');
    expect(output.status).toBe('passed');
    expect(output.findings[0].severity).toBe('info');
  });
});

describe('updateCheckpointForValidator', () => {
  const workflowId = 'wf-pipeline-test';

  it('updates quality_validation_status when validator is quality', async () => {
    const checkpoint = makeCheckpointV3(workflowId);
    await saveCheckpoint(testDir, checkpoint);

    await updateCheckpointForValidator(testDir, workflowId, 'UNIT-001', 'quality', 'completed');

    const { loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['UNIT-001'].quality_validation_status).toBe('completed');
  });

  it('updates traceability_status when validator is traceability', async () => {
    const checkpoint = makeCheckpointV3(workflowId);
    await saveCheckpoint(testDir, checkpoint);

    await updateCheckpointForValidator(testDir, workflowId, 'UNIT-001', 'traceability', 'in_progress');

    const { loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['UNIT-001'].traceability_status).toBe('in_progress');
  });

  it('updates contract_validation_status when validator is contract', async () => {
    const checkpoint = makeCheckpointV3(workflowId);
    await saveCheckpoint(testDir, checkpoint);

    await updateCheckpointForValidator(testDir, workflowId, 'UNIT-001', 'contract', 'skipped');

    const { loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['UNIT-001'].contract_validation_status).toBe('skipped');
  });

  it('updates coverage_status and coverage_percentage when validator is coverage', async () => {
    const checkpoint = makeCheckpointV3(workflowId);
    await saveCheckpoint(testDir, checkpoint);

    await updateCheckpointForValidator(testDir, workflowId, 'UNIT-001', 'coverage', 'completed', 87.5);

    const { loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['UNIT-001'].coverage_status).toBe('completed');
    expect(loaded?.construction_units?.['UNIT-001'].coverage_percentage).toBe(87.5);
  });

  it('does nothing when checkpoint does not exist', async () => {
    await expect(
      updateCheckpointForValidator(testDir, 'nonexistent-wf', 'UNIT-001', 'quality', 'completed')
    ).resolves.not.toThrow();
  });

  it('does nothing when unit does not exist in checkpoint', async () => {
    const checkpoint = makeCheckpointV3(workflowId);
    await saveCheckpoint(testDir, checkpoint);

    await expect(
      updateCheckpointForValidator(testDir, workflowId, 'UNIT-999', 'quality', 'completed')
    ).resolves.not.toThrow();
  });
});
