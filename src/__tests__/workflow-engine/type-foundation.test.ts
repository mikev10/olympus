import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { loadCheckpoint, saveCheckpoint, clearCache } from '../../features/workflow-engine/checkpoint';
import type {
  ConstructionUnitProgress, GateResult, ContentCheck,
  SecurityFinding, SecurityScanResult, RecreationReadinessResult, QualityScorecardData
} from '../../features/workflow-engine/phase-types';

describe('Group 1D Type Foundation', () => {
  const testDir = path.join(process.cwd(), '.test-type-foundation');
  const workflowId = 'test-workflow';
  const aidlcDir = path.join(testDir, 'aidlc-docs', workflowId);

  beforeEach(() => {
    fs.mkdirSync(aidlcDir, { recursive: true });
    clearCache();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    clearCache();
  });

  describe('New interfaces compile and are usable', () => {
    it('ContentCheck interface is valid', () => {
      const check: ContentCheck = {
        name: 'test-check',
        passed: true,
        severity: 'info',
        remediation: 'No action needed',
      };
      expect(check.name).toBe('test-check');
      expect(check.passed).toBe(true);
    });

    it('SecurityFinding interface is valid', () => {
      const finding: SecurityFinding = {
        id: 'SEC-001',
        category: 'hardcoded-secret',
        severity: 'critical',
        message: 'AWS key detected',
        file: 'src/config.ts',
        line: 42,
      };
      expect(finding.category).toBe('hardcoded-secret');
    });

    it('SecurityScanResult interface is valid', () => {
      const result: SecurityScanResult = {
        status: 'completed',
        findings: [],
        scanned_files: 10,
        scan_duration_ms: 500,
        report_path: 'test/report.md',
      };
      expect(result.status).toBe('completed');
    });

    it('RecreationReadinessResult interface is valid', () => {
      const result: RecreationReadinessResult = {
        overall_score: 4.2,
        passed: true,
        mode: 'advisory',
        dimensions: {
          requirements_coverage: 4,
          data_model_completeness: 5,
          implementation_guidance: 4,
          test_coverage_documentation: 3,
          bootstrap_capability: 5,
        },
      };
      expect(result.passed).toBe(true);
    });

    it('QualityScorecardData interface is valid', () => {
      const data: QualityScorecardData = {
        tests_total: 100,
        tests_passed: 95,
        tests_failed: 5,
        coverage_percentage: 82.5,
        security_findings: { critical: 0, warning: 2, info: 5 },
        units_completed: 4,
        units_total: 4,
        regressions_count: 0,
        gate_bypass_count: 1,
        data_sources: { tests: 'connected', coverage: 'connected', security: 'pending' },
      };
      expect(data.tests_total).toBe(100);
    });

    it('GateResult accepts optional content_checks', () => {
      const gate: GateResult = {
        passed: true,
        approved_by: 'human',
        approved_at: new Date().toISOString(),
        feedback: null,
        verification: { conformance_score: 1, coverage_percentage: 100, missing_items: [], passed: true },
        validation: { alignment_score: 1, alignment_questions: [], passed: true },
        content_checks: [
          { name: 'user-stories', passed: true, severity: 'info' },
          { name: 'security-scan', passed: false, severity: 'error', remediation: 'Fix critical findings' },
        ],
      };
      expect(gate.content_checks).toHaveLength(2);
    });
  });

  describe('applyMigrations initializes new fields', () => {
    it('initializes Group 1D fields on old checkpoint units', async () => {
      const oldCheckpoint = {
        schema_version: '3.0.0',
        workflow_id: workflowId,
        feature_name: 'Test',
        current_phase: 'construction',
        current_stage: 'code-generation',
        status: 'in_progress',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        construction_units: {
          'u-001-test': {
            unitId: 'u-001-test',
            stages: {
              'functional-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null },
              'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'code-generation': { status: 'completed', artifact_path: null, completed_at: null },
              'test-generation': { status: 'not_started', artifact_path: null, completed_at: null },
            },
            code_plan_path: null,
            code_generation_status: 'completed',
          },
        },
      };

      fs.writeFileSync(
        path.join(aidlcDir, 'checkpoint.json'),
        JSON.stringify(oldCheckpoint, null, 2)
      );

      const loaded = await loadCheckpoint(testDir, workflowId);
      expect(loaded).not.toBeNull();

      const unit = loaded!.construction_units!['u-001-test'] as ConstructionUnitProgress;

      expect(unit.security_scan_status).toBe('not_started');
      expect(unit.security_findings_critical).toBe(0);
      expect(unit.security_findings_warning).toBe(0);
      expect(unit.security_findings_info).toBe(0);
      expect(unit.feature_doc_status).toBe('not_started');
      expect(unit.feature_doc_path).toBeNull();
      expect(unit.recreation_readiness_score).toBeNull();
      expect(unit.recreation_readiness_dimensions).toBeNull();
      expect(unit.adr_count).toBe(0);
      expect(unit.impact_scan_status).toBe('not_started');
    });

    it('does not overwrite existing values for new fields', async () => {
      const checkpoint = {
        schema_version: '3.0.0',
        workflow_id: workflowId,
        feature_name: 'Test',
        current_phase: 'construction',
        current_stage: 'code-generation',
        status: 'in_progress',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        construction_units: {
          'u-001-test': {
            unitId: 'u-001-test',
            stages: {
              'functional-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null },
              'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'code-generation': { status: 'completed', artifact_path: null, completed_at: null },
              'test-generation': { status: 'completed', artifact_path: null, completed_at: null },
            },
            code_plan_path: null,
            code_generation_status: 'completed',
            security_scan_status: 'completed',
            security_findings_critical: 2,
            feature_doc_status: 'completed',
            feature_doc_path: '/path/to/doc.md',
            recreation_readiness_score: 4.5,
            adr_count: 3,
          },
        },
      };

      fs.writeFileSync(
        path.join(aidlcDir, 'checkpoint.json'),
        JSON.stringify(checkpoint, null, 2)
      );

      const loaded = await loadCheckpoint(testDir, workflowId);
      const unit = loaded!.construction_units!['u-001-test'] as ConstructionUnitProgress;

      expect(unit.security_scan_status).toBe('completed');
      expect(unit.security_findings_critical).toBe(2);
      expect(unit.feature_doc_status).toBe('completed');
      expect(unit.feature_doc_path).toBe('/path/to/doc.md');
      expect(unit.recreation_readiness_score).toBe(4.5);
      expect(unit.adr_count).toBe(3);
    });
  });
});
