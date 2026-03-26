import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { UnitStageRunner } from '../../../features/workflow-engine/construction/unit-stage-runner.js';

describe('UnitStageRunner', () => {
  const testDir = path.join(process.cwd(), '.test-unit-stage-runner');
  const workflowId = 'wf-runner-001';

  function aidlcPath(...parts: string[]): string {
    return path.join(testDir, 'aidlc-docs', workflowId, ...parts);
  }

  async function createUnitSpec(unitId: string, title = 'Test Unit'): Promise<void> {
    const specPath = aidlcPath('construction', unitId, 'spec.md');
    await fs.ensureDir(path.dirname(specPath));
    await fs.writeFile(specPath, [
      '---',
      `id: ${unitId}`,
      `title: ${title}`,
      'status: pending',
      'estimated_effort: 3',
      '---',
      '',
      '## Goal',
      'Implement the core functionality for this unit.',
      '',
      '## Acceptance Criteria',
      '- Feature works end to end',
      '- All edge cases handled',
      '',
      '## Scope & Responsibility',
      'Handles the primary business logic for this domain.',
    ].join('\n'), 'utf-8');
  }

  beforeEach(async () => {
    await fs.ensureDir(testDir);
  });

  afterEach(async () => {
    await fs.remove(testDir);
  });

  describe('SHALLOW depth', () => {
    it('returns progress with all stages marked skipped', async () => {
      const unitId = 'UNIT-001';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent content');

      const allStages = Object.values(progress.stages);
      expect(allStages.every(s => s.status === 'skipped')).toBe(true);
    });

    it('does not create any artifact files', async () => {
      const unitId = 'UNIT-002';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'SHALLOW', 'Intent content');

      const unitDir = aidlcPath('construction', unitId);
      const exists = await fs.pathExists(path.join(unitDir, 'functional-design.md'));
      expect(exists).toBe(false);
      const existsNfr = await fs.pathExists(path.join(unitDir, 'nfr-requirements.md'));
      expect(existsNfr).toBe(false);
    });

    it('returns code_plan_path as null and code_generation_status as not_started', async () => {
      const unitId = 'UNIT-003';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent content');

      expect(progress.code_plan_path).toBeNull();
      expect(progress.code_generation_status).toBe('not_started');
    });

    it('returns progress with correct unitId', async () => {
      const unitId = 'UNIT-004';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent content');

      expect(progress.unitId).toBe(unitId);
    });

    it('sets artifact_path and completed_at to null for all skipped stages', async () => {
      const unitId = 'UNIT-005';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent content');

      for (const stage of Object.values(progress.stages)) {
        expect(stage.artifact_path).toBeNull();
        expect(stage.completed_at).toBeNull();
      }
    });
  });

  describe('MEDIUM depth', () => {
    it('creates functional-design.md', async () => {
      const unitId = 'UNIT-010';
      await createUnitSpec(unitId, 'Auth Service');
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Build an auth service');

      const artifactPath = aidlcPath('construction', unitId, 'functional-design.md');
      expect(await fs.pathExists(artifactPath)).toBe(true);
    });

    it('creates nfr-requirements.md', async () => {
      const unitId = 'UNIT-011';
      await createUnitSpec(unitId, 'Auth Service');
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Build an auth service');

      const artifactPath = aidlcPath('construction', unitId, 'nfr-requirements.md');
      expect(await fs.pathExists(artifactPath)).toBe(true);
    });

    it('does not create nfr-design.md', async () => {
      const unitId = 'UNIT-012';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const artifactPath = aidlcPath('construction', unitId, 'nfr-design.md');
      expect(await fs.pathExists(artifactPath)).toBe(false);
    });

    it('does not create infrastructure-design.md', async () => {
      const unitId = 'UNIT-013';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const artifactPath = aidlcPath('construction', unitId, 'infrastructure-design.md');
      expect(await fs.pathExists(artifactPath)).toBe(false);
    });

    it('marks functional-design and nfr-requirements as completed', async () => {
      const unitId = 'UNIT-014';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      expect(progress.stages['functional-design'].status).toBe('completed');
      expect(progress.stages['nfr-requirements'].status).toBe('completed');
    });

    it('marks nfr-design and infrastructure-design as skipped', async () => {
      const unitId = 'UNIT-015';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      expect(progress.stages['nfr-design'].status).toBe('skipped');
      expect(progress.stages['infrastructure-design'].status).toBe('skipped');
    });

    it('creates audit.md', async () => {
      const unitId = 'UNIT-016';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const auditPath = aidlcPath('audit.md');
      expect(await fs.pathExists(auditPath)).toBe(true);
    });
  });

  describe('DEEP depth', () => {
    it('creates functional-design.md', async () => {
      const unitId = 'UNIT-020';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'DEEP', 'Full intent content');

      expect(await fs.pathExists(aidlcPath('construction', unitId, 'functional-design.md'))).toBe(true);
    });

    it('creates nfr-requirements.md', async () => {
      const unitId = 'UNIT-021';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'DEEP', 'Full intent content');

      expect(await fs.pathExists(aidlcPath('construction', unitId, 'nfr-requirements.md'))).toBe(true);
    });

    it('creates nfr-design.md', async () => {
      const unitId = 'UNIT-022';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'DEEP', 'Full intent content');

      expect(await fs.pathExists(aidlcPath('construction', unitId, 'nfr-design.md'))).toBe(true);
    });

    it('creates infrastructure-design.md', async () => {
      const unitId = 'UNIT-023';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'DEEP', 'Full intent content');

      expect(await fs.pathExists(aidlcPath('construction', unitId, 'infrastructure-design.md'))).toBe(true);
    });

    it('marks all four design stages as completed', async () => {
      const unitId = 'UNIT-024';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'DEEP', 'Full intent content');

      expect(progress.stages['functional-design'].status).toBe('completed');
      expect(progress.stages['nfr-requirements'].status).toBe('completed');
      expect(progress.stages['nfr-design'].status).toBe('completed');
      expect(progress.stages['infrastructure-design'].status).toBe('completed');
    });

    it('marks code-generation as skipped', async () => {
      const unitId = 'UNIT-025';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'DEEP', 'Full intent content');

      expect(progress.stages['code-generation'].status).toBe('skipped');
    });
  });

  describe('progress tracking', () => {
    it('sets artifact_path for completed stages', async () => {
      const unitId = 'UNIT-030';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      expect(progress.stages['functional-design'].artifact_path).not.toBeNull();
      expect(progress.stages['nfr-requirements'].artifact_path).not.toBeNull();
    });

    it('artifact_path for functional-design points to functional-design.md', async () => {
      const unitId = 'UNIT-031';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      expect(progress.stages['functional-design'].artifact_path).toContain('functional-design.md');
    });

    it('sets completed_at for completed stages', async () => {
      const unitId = 'UNIT-032';
      await createUnitSpec(unitId);
      const before = new Date();
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const after = new Date();
      const completedAt = progress.stages['functional-design'].completed_at;
      expect(completedAt).not.toBeNull();
      const ts = new Date(completedAt!);
      expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    it('sets artifact_path to null for skipped stages', async () => {
      const unitId = 'UNIT-033';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      expect(progress.stages['nfr-design'].artifact_path).toBeNull();
      expect(progress.stages['infrastructure-design'].artifact_path).toBeNull();
    });

    it('returns correct ConstructionUnitProgress shape with all 6 stage keys', async () => {
      const unitId = 'UNIT-034';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent');

      const expectedStages = ['functional-design', 'nfr-requirements', 'nfr-design', 'infrastructure-design', 'code-generation'];
      for (const stage of expectedStages) {
        expect(progress.stages).toHaveProperty(stage);
        expect(progress.stages[stage as keyof typeof progress.stages]).toHaveProperty('status');
        expect(progress.stages[stage as keyof typeof progress.stages]).toHaveProperty('artifact_path');
        expect(progress.stages[stage as keyof typeof progress.stages]).toHaveProperty('completed_at');
      }
    });
  });

  describe('audit trail', () => {
    it('creates audit.md when it does not exist (MEDIUM)', async () => {
      const unitId = 'UNIT-040';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const auditPath = aidlcPath('audit.md');
      expect(await fs.pathExists(auditPath)).toBe(true);
    });

    it('audit.md contains the unitId', async () => {
      const unitId = 'UNIT-041';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const auditPath = aidlcPath('audit.md');
      const content = await fs.readFile(auditPath, 'utf-8');
      expect(content).toContain(unitId);
    });

    it('audit.md contains completed stage artifact paths', async () => {
      const unitId = 'UNIT-042';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      const auditPath = aidlcPath('audit.md');
      const content = await fs.readFile(auditPath, 'utf-8');
      expect(content).toContain('functional-design');
      expect(content).toContain('nfr-requirements');
    });

    it('appends to existing audit.md on second run', async () => {
      const unitId1 = 'UNIT-043';
      const unitId2 = 'UNIT-044';
      await createUnitSpec(unitId1);
      await createUnitSpec(unitId2);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId1, 'MEDIUM', 'Intent');
      await runner.executeForUnit(unitId2, 'MEDIUM', 'Intent');

      const auditPath = aidlcPath('audit.md');
      const content = await fs.readFile(auditPath, 'utf-8');
      expect(content).toContain(unitId1);
      expect(content).toContain(unitId2);
    });

    it('does not create audit.md for SHALLOW depth', async () => {
      const unitId = 'UNIT-045';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      await runner.executeForUnit(unitId, 'SHALLOW', 'Intent');

      const auditPath = aidlcPath('audit.md');
      expect(await fs.pathExists(auditPath)).toBe(false);
    });
  });

  describe('failure tracking', () => {
    it('initializes failure_count to 0 for all stages', async () => {
      const unitId = 'UNIT-050';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent');

      for (const stage of Object.values(progress.stages)) {
        expect(stage.failure_count).toBe(0);
      }
    });

    it('initializes last_error to null for all stages', async () => {
      const unitId = 'UNIT-051';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'SHALLOW', 'Intent');

      for (const stage of Object.values(progress.stages)) {
        expect(stage.last_error).toBeNull();
      }
    });

    it('last_error is null when no failure occurs', async () => {
      const unitId = 'UNIT-052';
      await createUnitSpec(unitId);
      const runner = new UnitStageRunner(testDir, workflowId);

      const progress = await runner.executeForUnit(unitId, 'MEDIUM', 'Intent');

      expect(progress.stages['functional-design'].last_error).toBeNull();
      expect(progress.stages['functional-design'].failure_count).toBe(0);
    });
  });
});
