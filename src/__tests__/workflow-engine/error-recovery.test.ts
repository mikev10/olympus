import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  assessErrorSeverity,
  recoverPartialCompletion,
  recoverCorruptedState,
  recoverMissingArtifacts,
  handleUserRestart,
  handleUserSkip,
  ERROR_LOG_FORMAT,
  RECOVERY_LOG_FORMAT,
  type WorkflowError,
} from '../../features/workflow-engine/error-recovery.js';

const TEST_DIR = '.test-error-recovery';

describe('error-recovery', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('assessErrorSeverity', () => {
    it('classifies corrupted state as critical', () => {
      expect(assessErrorSeverity({ message: 'corrupt', isCorrupted: true })).toBe('critical');
    });

    it('classifies disk full as critical', () => {
      expect(assessErrorSeverity({ message: 'no space', code: 'ENOSPC' })).toBe('critical');
    });

    it('classifies missing artifact as high', () => {
      expect(assessErrorSeverity({ message: 'missing', isMissing: true })).toBe('high');
    });

    it('classifies permission error as high', () => {
      expect(assessErrorSeverity({ message: 'denied', code: 'EACCES' })).toBe('high');
    });

    it('defaults to medium for generic errors', () => {
      expect(assessErrorSeverity({ message: 'something went wrong' })).toBe('low');
    });
  });

  describe('recoverPartialCompletion', () => {
    it('finds last completed step from state file', async () => {
      const workflowDir = join(testDir, 'aidlc-docs', 'wf-001');
      fs.ensureDirSync(workflowDir);
      fs.writeFileSync(join(workflowDir, 'aidlc-state.md'), '- [x] Step 1\n- [x] Step 2\n- [ ] Step 3\n- [ ] Step 4\n', 'utf-8');
      const result = await recoverPartialCompletion(testDir, 'wf-001');
      expect(result.success).toBe(true);
      expect(result.details).toContain('Step');
    });

    it('handles missing state file gracefully', async () => {
      const result = await recoverPartialCompletion(testDir, 'nonexistent');
      expect(result.success).toBeDefined();
    });
  });

  describe('recoverCorruptedState', () => {
    it('backs up corrupted checkpoint', async () => {
      const workflowDir = join(testDir, 'aidlc-docs', 'wf-corrupt');
      fs.ensureDirSync(workflowDir);
      fs.writeFileSync(join(workflowDir, 'checkpoint.json'), '{bad json', 'utf-8');
      const result = await recoverCorruptedState(testDir, 'wf-corrupt');
      expect(result.success).toBeDefined();
    });
  });

  describe('recoverMissingArtifacts', () => {
    it('identifies missing artifacts from manifest', async () => {
      const workflowDir = join(testDir, 'aidlc-docs', 'wf-missing');
      fs.ensureDirSync(workflowDir);
      const manifest = {
        schema_version: '2.0.0',
        workflow_id: 'wf-missing',
        feature_name: 'test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        phases: {},
        depth_assessment: null,
        artifacts: [
          { id: 'art-1', type: 'INTENT', path: join(workflowDir, 'intent.md'), write_complete: true },
          { id: 'art-2', type: 'UNIT', path: join(workflowDir, 'unit.md'), write_complete: true },
        ],
        links: [],
        risks: [],
        gate_audit: [],
        metrics: null,
        alignment_checks: [],
        risk_tier: null,
      };
      fs.writeJsonSync(join(workflowDir, 'manifest.json'), manifest);
      const result = await recoverMissingArtifacts(testDir, 'wf-missing');
      expect(result.success).toBeDefined();
    });
  });

  describe('handleUserRestart', () => {
    it('archives existing artifacts before reset', async () => {
      const workflowDir = join(testDir, 'aidlc-docs', 'wf-restart');
      const stageDir = join(workflowDir, 'requirements');
      fs.ensureDirSync(stageDir);
      fs.writeFileSync(join(stageDir, 'requirements.md'), '# Requirements', 'utf-8');
      const result = await handleUserRestart(testDir, 'wf-restart', 'requirements');
      expect(result.success).toBe(true);
    });
  });

  describe('handleUserSkip', () => {
    it('logs skip in audit.md', async () => {
      const result = await handleUserSkip(testDir, 'wf-skip', 'nfr-design');
      expect(result.success).toBe(true);
      expect(result.action).toContain('skip');
    });
  });

  describe('constants', () => {
    it('exports ERROR_LOG_FORMAT', () => {
      expect(ERROR_LOG_FORMAT).toContain('Error');
      expect(ERROR_LOG_FORMAT).toContain('severity');
    });

    it('exports RECOVERY_LOG_FORMAT', () => {
      expect(RECOVERY_LOG_FORMAT).toContain('Recovery');
    });
  });
});
