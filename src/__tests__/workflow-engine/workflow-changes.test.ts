import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  assessChangeImpact,
  archiveArtifacts,
  resetStages,
  logChangeRequest,
  type WorkflowState,
  type ChangeRequest,
} from '../../features/workflow-engine/workflow-changes.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';

const TEST_DIR = '.test-workflow-changes';

const makeCheckpoint = (): WorkflowCheckpointV3 => ({
  schema_version: '3.0.0',
  workflow_id: 'wf-changes',
  feature_name: 'test-feature',
  current_phase: 'inception',
  current_stage: 'intent',
  status: 'in_progress',
  phases: {
    discovery: { status: 'complete', started_at: null, completed_at: '2026-01-01', gate_result: null, gate_bypassed: false, bypass_reason: null },
    inception: { status: 'in_progress', started_at: '2026-01-02', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
  },
  manifest_path: '',
  trust_state_path: '',
  created_at: '2026-01-01',
  updated_at: '2026-01-02',
});

const makeState = (): WorkflowState => ({
  checkpoint: makeCheckpoint(),
  completedStages: ['discovery', 'workspace-scan'],
  currentStage: 'intent',
});

describe('workflow-changes', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('assessChangeImpact', () => {
    it('add_skipped_phase has medium risk', () => {
      const impact = assessChangeImpact('add_skipped_phase', makeState());
      expect(impact.riskLevel).toBe('medium');
      expect(impact.cascadeRequired).toBe(false);
    });

    it('skip_planned_phase has high risk and cascade', () => {
      const impact = assessChangeImpact('skip_planned_phase', makeState());
      expect(impact.riskLevel).toBe('high');
      expect(impact.cascadeRequired).toBe(true);
    });

    it('restart_current_stage has low risk', () => {
      const impact = assessChangeImpact('restart_current_stage', makeState());
      expect(impact.riskLevel).toBe('low');
      expect(impact.cascadeRequired).toBe(false);
    });

    it('restart_previous_stage has high risk and cascade', () => {
      const impact = assessChangeImpact('restart_previous_stage', makeState());
      expect(impact.riskLevel).toBe('high');
      expect(impact.cascadeRequired).toBe(true);
    });

    it('change_depth has medium risk', () => {
      const impact = assessChangeImpact('change_depth', makeState());
      expect(impact.riskLevel).toBe('medium');
    });

    it('pause_workflow has low risk', () => {
      const impact = assessChangeImpact('pause_workflow', makeState());
      expect(impact.riskLevel).toBe('low');
      expect(impact.affectedStages).toHaveLength(0);
    });

    it('change_architecture has high risk and cascade', () => {
      const impact = assessChangeImpact('change_architecture', makeState());
      expect(impact.riskLevel).toBe('high');
      expect(impact.cascadeRequired).toBe(true);
    });

    it('add_remove_units has medium risk and cascade', () => {
      const impact = assessChangeImpact('add_remove_units', makeState());
      expect(impact.riskLevel).toBe('medium');
      expect(impact.cascadeRequired).toBe(true);
    });
  });

  describe('archiveArtifacts', () => {
    it('creates backup copies of artifacts', async () => {
      const stageDir = join(testDir, 'aidlc-docs', 'wf-001', 'requirements');
      fs.ensureDirSync(stageDir);
      fs.writeFileSync(join(stageDir, 'requirements.md'), '# Req', 'utf-8');
      const archived = await archiveArtifacts(testDir, 'wf-001', ['requirements']);
      expect(archived.length).toBeGreaterThan(0);
      expect(archived[0]).toContain('.backup.');
    });

    it('skips stages with no artifacts', async () => {
      const archived = await archiveArtifacts(testDir, 'wf-001', ['nonexistent-stage']);
      expect(archived).toHaveLength(0);
    });
  });

  describe('resetStages', () => {
    it('returns stages to reset', () => {
      const result = resetStages(testDir, 'wf-001', ['intent', 'requirements']);
      expect(result).toContain('intent');
      expect(result).toContain('requirements');
    });
  });

  describe('logChangeRequest', () => {
    it('logs change to audit.md', () => {
      const request: ChangeRequest = {
        type: 'restart_current_stage',
        description: 'User wants to redo requirements',
        requestedBy: 'human',
        timestamp: new Date().toISOString(),
      };
      logChangeRequest(testDir, 'wf-log-001', request);
      const auditPath = join(testDir, 'aidlc-docs', 'wf-log-001', 'audit.md');
      expect(fs.existsSync(auditPath)).toBe(true);
    });
  });
});
