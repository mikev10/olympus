import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { ConstructionExecutor } from '../../../features/workflow-engine/construction/executor.js';
import { saveCheckpoint, loadCheckpoint } from '../../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3, ConstructionUnitProgress } from '../../../features/workflow-engine/phase-types.js';

const TEST_DIR = path.join(process.cwd(), '.test-smoke-build');
const WORKFLOW_ID = 'smoke-build-001';

function makeCheckpoint(units: Record<string, Partial<ConstructionUnitProgress>>): WorkflowCheckpointV3 {
  const construction_units: Record<string, ConstructionUnitProgress> = {};
  for (const [id, partial] of Object.entries(units)) {
    construction_units[id] = {
      unitId: id,
      stages: {
        'functional-design': { status: 'completed', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'nfr-requirements': { status: 'completed', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'code-generation': { status: 'completed', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'test-generation': { status: 'completed', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
      },
      code_plan_path: null,
      code_generation_status: 'completed',
      ...partial,
    };
  }

  return {
    schema_version: '3.0.0',
    workflow_id: WORKFLOW_ID,
    feature_name: 'smoke-test',
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {} as any,
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    construction_units,
  };
}

describe('executeSmokeTest', () => {
  beforeEach(async () => {
    await fs.ensureDir(TEST_DIR);
  });

  afterEach(async () => {
    await fs.remove(TEST_DIR);
  });

  it('returns not_run when no checkpoint exists', async () => {
    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    const result = await executor.executeSmokeTest();
    expect(result.status).toBe('not_run');
    expect(result.reportPath).toBeNull();
  });

  it('returns not_run when no construction units exist', async () => {
    const cp = makeCheckpoint({});
    await saveCheckpoint(TEST_DIR, cp);
    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    const result = await executor.executeSmokeTest();
    expect(result.status).toBe('not_run');
  });

  it('returns passed when all unit tests pass', async () => {
    const cp = makeCheckpoint({
      'unit-001': { tests_total: 5, tests_passed: 5, tests_failed: 0 },
      'unit-002': { tests_total: 3, tests_passed: 3, tests_failed: 0 },
    });
    await saveCheckpoint(TEST_DIR, cp);

    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    const result = await executor.executeSmokeTest();

    expect(result.status).toBe('passed');
    expect(result.reportPath).toBeTruthy();

    const reportExists = await fs.pathExists(result.reportPath!);
    expect(reportExists).toBe(true);

    const content = await fs.readFile(result.reportPath!, 'utf-8');
    expect(content).toContain('PASSED');
    expect(content).toContain('Total Tests | 8');
    expect(content).toContain('unit-001');
    expect(content).toContain('unit-002');
  });

  it('returns failed when any unit has test failures', async () => {
    const cp = makeCheckpoint({
      'unit-001': { tests_total: 5, tests_passed: 5, tests_failed: 0 },
      'unit-002': { tests_total: 3, tests_passed: 1, tests_failed: 2, regressions_count: 1, flaky_count: 1 },
    });
    await saveCheckpoint(TEST_DIR, cp);

    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    const result = await executor.executeSmokeTest();

    expect(result.status).toBe('failed');
    expect(result.reportPath).toBeTruthy();
  });

  it('writes smoke_test to checkpoint', async () => {
    const cp = makeCheckpoint({
      'unit-001': { tests_total: 10, tests_passed: 8, tests_failed: 2, regressions_count: 1, flaky_count: 1 },
    });
    await saveCheckpoint(TEST_DIR, cp);

    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    await executor.executeSmokeTest();

    const updated = await loadCheckpoint(TEST_DIR, WORKFLOW_ID);
    expect(updated).toBeTruthy();
    expect(updated!.smoke_test).toBeTruthy();
    expect(updated!.smoke_test!.status).toBe('failed');
    expect(updated!.smoke_test!.tests_total).toBe(10);
    expect(updated!.smoke_test!.tests_passed).toBe(8);
    expect(updated!.smoke_test!.tests_failed).toBe(2);
    expect(updated!.smoke_test!.regressions_total).toBe(1);
    expect(updated!.smoke_test!.flaky_total).toBe(1);
    expect(updated!.smoke_test!.units_tested).toBe(1);
    expect(updated!.smoke_test!.units_passed).toBe(0);
    expect(updated!.smoke_test!.report_path).toBeTruthy();
    expect(updated!.smoke_test!.completed_at).toBeTruthy();
  });

  it('writes report to build-and-test/test-report.md', async () => {
    const cp = makeCheckpoint({
      'unit-001': { tests_total: 5, tests_passed: 5, tests_failed: 0 },
    });
    await saveCheckpoint(TEST_DIR, cp);

    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    const result = await executor.executeSmokeTest();

    const expectedPath = path.join(TEST_DIR, 'aidlc-docs', WORKFLOW_ID, 'construction', 'build-and-test', 'test-report.md');
    expect(result.reportPath).toBe(expectedPath);
    expect(await fs.pathExists(expectedPath)).toBe(true);
  });

  it('aggregates regression and flaky counts across units', async () => {
    const cp = makeCheckpoint({
      'unit-001': { tests_total: 5, tests_passed: 3, tests_failed: 2, regressions_count: 2, flaky_count: 0 },
      'unit-002': { tests_total: 3, tests_passed: 2, tests_failed: 1, regressions_count: 0, flaky_count: 1 },
    });
    await saveCheckpoint(TEST_DIR, cp);

    const executor = new ConstructionExecutor(TEST_DIR, WORKFLOW_ID);
    await executor.executeSmokeTest();

    const updated = await loadCheckpoint(TEST_DIR, WORKFLOW_ID);
    expect(updated!.smoke_test!.regressions_total).toBe(2);
    expect(updated!.smoke_test!.flaky_total).toBe(1);
  });
});
