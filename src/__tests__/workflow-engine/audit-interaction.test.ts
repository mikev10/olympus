import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  appendInteraction,
  logApprovalPrompt,
  logApprovalResponse,
  type AuditInteraction,
} from '../../features/workflow-engine/audit-generator.js';

const TEST_DIR = '.test-audit-interaction';

describe('audit-interaction', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('appendInteraction', () => {
    it('creates audit.md if it does not exist', () => {
      const workflowId = 'wf-int-001';
      const interaction: AuditInteraction = {
        timestamp: new Date().toISOString(),
        stage: 'requirements',
        interactionType: 'user_input',
        content: 'User provided requirements details',
        context: 'Requirements gathering phase',
      };
      appendInteraction(testDir, workflowId, interaction);
      const auditPath = join(testDir, 'aidlc-docs', workflowId, 'audit.md');
      expect(fs.existsSync(auditPath)).toBe(true);
      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('user_input');
      expect(content).toContain('User provided requirements details');
    });

    it('appends to existing audit.md', () => {
      const workflowId = 'wf-int-002';
      const auditDir = join(testDir, 'aidlc-docs', workflowId);
      fs.ensureDirSync(auditDir);
      fs.writeFileSync(join(auditDir, 'audit.md'), '# Existing Audit\n', 'utf-8');

      appendInteraction(testDir, workflowId, {
        timestamp: '2026-02-23T00:00:00.000Z',
        stage: 'intent',
        interactionType: 'ai_prompt',
        content: 'AI asked a question',
        context: 'Intent stage',
      });
      const content = fs.readFileSync(join(auditDir, 'audit.md'), 'utf-8');
      expect(content).toContain('# Existing Audit');
      expect(content).toContain('AI asked a question');
    });

    it('never overwrites existing content', () => {
      const workflowId = 'wf-int-003';
      appendInteraction(testDir, workflowId, {
        timestamp: '2026-01-01T00:00:00.000Z',
        stage: 'intent',
        interactionType: 'user_input',
        content: 'First entry',
        context: 'First',
      });
      appendInteraction(testDir, workflowId, {
        timestamp: '2026-01-02T00:00:00.000Z',
        stage: 'intent',
        interactionType: 'user_input',
        content: 'Second entry',
        context: 'Second',
      });
      const auditPath = join(testDir, 'aidlc-docs', workflowId, 'audit.md');
      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('First entry');
      expect(content).toContain('Second entry');
    });
  });

  describe('logApprovalPrompt', () => {
    it('logs approval prompt before asking', () => {
      const workflowId = 'wf-approval-001';
      logApprovalPrompt(testDir, workflowId, 'requirements', 'Do you approve the requirements?');
      const auditPath = join(testDir, 'aidlc-docs', workflowId, 'audit.md');
      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('approval_request');
      expect(content).toContain('Do you approve the requirements?');
    });
  });

  describe('logApprovalResponse', () => {
    it('logs approval response after receiving', () => {
      const workflowId = 'wf-approval-002';
      logApprovalResponse(testDir, workflowId, 'requirements', 'Approved with minor changes');
      const auditPath = join(testDir, 'aidlc-docs', workflowId, 'audit.md');
      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('approval_response');
      expect(content).toContain('Approved with minor changes');
    });
  });
});
