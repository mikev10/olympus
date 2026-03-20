/**
 * Tests for executeTestGeneration() on ConstructionExecutor.
 *
 * Groups:
 * 1. State transitions
 * 2. Engine gating
 * 3. Artifact creation
 * 4. Checkpoint persistence
 * 5. executeShallow() integration
 * 6. Framework detection
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

describe('ConstructionExecutor.executeTestGeneration()', () => {
  const testDir = path.join(process.cwd(), '.test-test-generation');
  const workflowId = 'tg-workflow';
  const unitId = 'u-001-feature';

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

  describe('Group 5: executeShallow() integration', () => {
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

    it('execute() with depth SHALLOW calls executeTestGeneration for shallow-impl unit', async () => {
      mockLoadCheckpoint.mockResolvedValue(null);

      await createIntentFile('Quick Fix', 2);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const spy = vi.spyOn(executor, 'executeTestGeneration');
      spy.mockResolvedValue({
        status: 'completed',
        unitId: 'shallow-impl',
        tests_total: 0,
        tests_passed: 0,
        tests_failed: 0,
        test_framework: 'unknown',
        reportPath: '/fake/path',
      });

      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
      expect(spy).toHaveBeenCalledWith('shallow-impl');
    });

    it('SHALLOW result is passed: true even if executeTestGeneration throws', async () => {
      mockLoadCheckpoint.mockResolvedValue(null);

      await createIntentFile('Resilient Feature', 2);

      const executor = new ConstructionExecutor(testDir, workflowId);
      const spy = vi.spyOn(executor, 'executeTestGeneration');
      spy.mockRejectedValue(new Error('test generation exploded'));

      const result = await executor.execute(undefined, { depth: 'SHALLOW' });

      expect(result.passed).toBe(true);
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
});
