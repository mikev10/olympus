import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  generateValidationReport,
  readValidationReport,
  getValidationReportPath,
  type BoltValidationData,
} from '../../features/workflow-engine/validation-report.js';

describe('validation-report', () => {
  const testDir = join(process.cwd(), '.test-validation-report');
  const projectPath = testDir;
  const workflowId = 'test-workflow';
  const unitId = 'UNIT-001';
  const reportPath = join(testDir, 'aidlc-docs', workflowId, 'construction', unitId, 'validation-report.md');

  beforeEach(() => {
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('generateValidationReport', () => {
    it('creates a new report with header when file does not exist', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      expect(fs.existsSync(reportPath)).toBe(true);
      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain(`# Validation Report: ${unitId}`);
      expect(content).toContain('## BOLT-001: Test BOLT');
    });

    it('appends BOLT section to existing report', () => {
      const firstBolt: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'First BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      const secondBolt: BoltValidationData = {
        boltId: 'BOLT-002',
        boltTitle: 'Second BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'auto-approved',
        dualValidation: { parentConformance: 88, rootConformance: 85 },
        riskTier: 1,
      };

      generateValidationReport(reportPath, unitId, firstBolt);
      generateValidationReport(reportPath, unitId, secondBolt);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('## BOLT-001: First BOLT');
      expect(content).toContain('## BOLT-002: Second BOLT');
    });

    it('records commands executed with exit codes and results', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [
          { command: 'npm test', exitCode: 0, result: 'passed' },
          { command: 'npm run build', exitCode: 0, result: 'success' },
        ],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Commands Executed');
      expect(content).toContain('`npm test` -> exit 0 (passed)');
      expect(content).toContain('`npm run build` -> exit 0 (success)');
    });

    it('records empty commands with "No commands recorded" message', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Commands Executed');
      expect(content).toContain('- No commands recorded');
    });

    it('records test results in a table format', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [
          { suite: 'auth', pass: 15, fail: 0, skip: 0 },
          { suite: 'api', pass: 22, fail: 1, skip: 2 },
        ],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Test Results');
      expect(content).toContain('| Suite | Pass | Fail | Skip |');
      expect(content).toContain('| auth | 15 | 0 | 0 |');
      expect(content).toContain('| api | 22 | 1 | 2 |');
    });

    it('records empty test results with placeholder row', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Test Results');
      expect(content).toContain('| - | - | - | - |');
    });

    it('records files changed with actions', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [
          { path: 'src/auth.ts', action: 'created' },
          { path: 'src/api.ts', action: 'modified' },
          { path: 'src/old.ts', action: 'deleted' },
        ],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Files Changed');
      expect(content).toContain('- src/auth.ts (created)');
      expect(content).toContain('- src/api.ts (modified)');
      expect(content).toContain('- src/old.ts (deleted)');
    });

    it('records empty files changed with "No files recorded" message', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Files Changed');
      expect(content).toContain('- No files recorded');
    });

    it('records gate approval evidence', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### Evidence');
      expect(content).toContain('Gate 4 approved by: human');
    });

    it('records dual validation conformance scores', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('Dual validation: 95% conformance (parent), 90% conformance (root)');
    });

    it('records risk tier', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 3,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('Risk tier: 3');
    });

    it('includes CI check results when provided', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
        ciCheckResults: [
          { name: 'lint', passed: true, details: 'All checks passed' },
          { name: 'security', passed: false, details: '1 vulnerability found' },
        ],
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).toContain('### CI Check Results');
      expect(content).toContain('- lint: PASS - All checks passed');
      expect(content).toContain('- security: FAIL - 1 vulnerability found');
    });

    it('omits CI check results section when not provided', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).not.toContain('### CI Check Results');
    });

    it('omits CI check results section when empty array provided', () => {
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
        ciCheckResults: [],
      };

      generateValidationReport(reportPath, unitId, boltData);

      const content = fs.readFileSync(reportPath, 'utf-8');
      expect(content).not.toContain('### CI Check Results');
    });

    it('creates directory structure if it does not exist', () => {
      const deepPath = join(testDir, 'aidlc-docs', workflowId, 'construction', 'UNIT-999', 'validation-report.md');
      const boltData: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'Test BOLT',
        commandsExecuted: [],
        testResults: [],
        filesChanged: [],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      expect(fs.existsSync(join(testDir, 'aidlc-docs', workflowId, 'construction', 'UNIT-999'))).toBe(false);

      generateValidationReport(deepPath, 'UNIT-999', boltData);

      expect(fs.existsSync(deepPath)).toBe(true);
      expect(fs.existsSync(join(testDir, 'aidlc-docs', workflowId, 'construction', 'UNIT-999'))).toBe(true);
    });

    it('accumulates multiple BOLT sections in the same report', () => {
      const bolt1: BoltValidationData = {
        boltId: 'BOLT-001',
        boltTitle: 'First BOLT',
        commandsExecuted: [{ command: 'npm test', exitCode: 0, result: 'passed' }],
        testResults: [{ suite: 'auth', pass: 10, fail: 0, skip: 0 }],
        filesChanged: [{ path: 'src/auth.ts', action: 'created' }],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 95, rootConformance: 90 },
        riskTier: 2,
      };

      const bolt2: BoltValidationData = {
        boltId: 'BOLT-002',
        boltTitle: 'Second BOLT',
        commandsExecuted: [{ command: 'npm run build', exitCode: 0, result: 'success' }],
        testResults: [{ suite: 'api', pass: 15, fail: 1, skip: 0 }],
        filesChanged: [{ path: 'src/api.ts', action: 'modified' }],
        gateApprovedBy: 'auto-approved',
        dualValidation: { parentConformance: 88, rootConformance: 85 },
        riskTier: 1,
      };

      const bolt3: BoltValidationData = {
        boltId: 'BOLT-003',
        boltTitle: 'Third BOLT',
        commandsExecuted: [{ command: 'npm run lint', exitCode: 0, result: 'passed' }],
        testResults: [{ suite: 'integration', pass: 20, fail: 0, skip: 2 }],
        filesChanged: [{ path: 'src/utils.ts', action: 'deleted' }],
        gateApprovedBy: 'human',
        dualValidation: { parentConformance: 92, rootConformance: 88 },
        riskTier: 3,
      };

      generateValidationReport(reportPath, unitId, bolt1);
      generateValidationReport(reportPath, unitId, bolt2);
      generateValidationReport(reportPath, unitId, bolt3);

      const content = fs.readFileSync(reportPath, 'utf-8');

      // Verify header appears only once
      const headerMatches = content.match(/# Validation Report: UNIT-001/g);
      expect(headerMatches?.length).toBe(1);

      // Verify all three BOLT sections are present
      expect(content).toContain('## BOLT-001: First BOLT');
      expect(content).toContain('`npm test` -> exit 0 (passed)');
      expect(content).toContain('| auth | 10 | 0 | 0 |');
      expect(content).toContain('- src/auth.ts (created)');
      expect(content).toContain('95% conformance (parent)');

      expect(content).toContain('## BOLT-002: Second BOLT');
      expect(content).toContain('`npm run build` -> exit 0 (success)');
      expect(content).toContain('| api | 15 | 1 | 0 |');
      expect(content).toContain('- src/api.ts (modified)');
      expect(content).toContain('88% conformance (parent)');

      expect(content).toContain('## BOLT-003: Third BOLT');
      expect(content).toContain('`npm run lint` -> exit 0 (passed)');
      expect(content).toContain('| integration | 20 | 0 | 2 |');
      expect(content).toContain('- src/utils.ts (deleted)');
      expect(content).toContain('92% conformance (parent)');
    });
  });

  describe('readValidationReport', () => {
    it('returns null when file does not exist', () => {
      const content = readValidationReport(reportPath);
      expect(content).toBeNull();
    });

    it('returns content when file exists', () => {
      const expectedContent = '# Validation Report: UNIT-001\n\nSome content here.\n';
      fs.ensureDirSync(join(testDir, 'aidlc-docs', workflowId, 'construction', unitId));
      fs.writeFileSync(reportPath, expectedContent, 'utf-8');

      const content = readValidationReport(reportPath);
      expect(content).toBe(expectedContent);
    });

    it('returns null on read errors', () => {
      const invalidPath = join(testDir, 'nonexistent', 'deeply', 'nested', 'path', 'report.md');
      const content = readValidationReport(invalidPath);
      expect(content).toBeNull();
    });
  });

  describe('getValidationReportPath', () => {
    it('constructs correct path for validation report', () => {
      const path = getValidationReportPath('/project/root', 'my-workflow', 'UNIT-001');
      expect(path).toBe(join('/project/root', 'aidlc-docs', 'my-workflow', 'construction', 'UNIT-001', 'validation-report.md'));
    });

    it('handles different unit IDs correctly', () => {
      const path1 = getValidationReportPath('/project', 'wf-001', 'UNIT-042');
      const path2 = getValidationReportPath('/project', 'wf-001', 'UNIT-999');

      expect(path1).toBe(join('/project', 'aidlc-docs', 'wf-001', 'construction', 'UNIT-042', 'validation-report.md'));
      expect(path2).toBe(join('/project', 'aidlc-docs', 'wf-001', 'construction', 'UNIT-999', 'validation-report.md'));
    });

    it('handles different project paths correctly', () => {
      const path1 = getValidationReportPath('/home/user/project', 'workflow-123', 'UNIT-001');
      const path2 = getValidationReportPath('C:\\Users\\Dev\\Project', 'workflow-123', 'UNIT-001');

      expect(path1).toBe(join('/home/user/project', 'aidlc-docs', 'workflow-123', 'construction', 'UNIT-001', 'validation-report.md'));
      expect(path2).toBe(join('C:\\Users\\Dev\\Project', 'aidlc-docs', 'workflow-123', 'construction', 'UNIT-001', 'validation-report.md'));
    });
  });
});
