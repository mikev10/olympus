import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateDeployGuide,
  generateRunbook,
  generateMonitoringConfig,
  generateReleaseNotes,
  generateCostAnalysis,
  generateOperationsArtifacts,
} from '../../../features/workflow-engine/operations/templates.js';
import type { OperationsContext } from '../../../features/workflow-engine/operations/templates.js';
import type { ManifestSchema, ManifestArtifact, RiskEntry, GateAuditEntry } from '../../../features/workflow-engine/phase-types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Helper to create a minimal valid manifest
function createTestManifest(overrides: Partial<ManifestSchema> = {}): ManifestSchema {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-feature',
    feature_name: 'Test Feature',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    phases: {
      discovery: { status: 'complete', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:30:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'complete', started_at: '2024-01-01T00:30:00Z', completed_at: '2024-01-01T01:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'complete', started_at: '2024-01-01T01:00:00Z', completed_at: '2024-01-01T02:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'in_progress', started_at: '2024-01-01T02:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    depth_assessment: null,
    artifacts: [],
    links: [],
    risks: [],
    gate_audit: [],
    metrics: null,
    alignment_checks: [],
    risk_tier: null,
    ...overrides,
  };
}

function createTestContext(overrides: Partial<OperationsContext> = {}): OperationsContext {
  return {
    workflowId: 'test-feature',
    featureName: 'Test Feature',
    manifest: createTestManifest(),
    specContent: null,
    buildLogContent: null,
    depthLevel: 'MEDIUM' as const,
    ...overrides,
  };
}

describe('Operations Templates', () => {
  describe('generateDeployGuide', () => {
    it('should generate valid deploy guide markdown', () => {
      const context = createTestContext();
      const guide = generateDeployGuide(context);

      expect(guide).toContain('---');
      expect(guide).toContain('id: DEPLOY-GUIDE-001');
      expect(guide).toContain('phase: operations');
      expect(guide).toContain('stage: deploy');
    });

    it('should include feature name and workflow ID', () => {
      const context = createTestContext({
        featureName: 'My Awesome Feature',
        workflowId: 'awesome-123',
      });
      const guide = generateDeployGuide(context);

      expect(guide).toContain('My Awesome Feature');
      expect(guide).toContain('awesome-123');
      expect(guide).toContain('# Deployment Guide: My Awesome Feature');
    });

    it('should include artifact counts from manifest', () => {
      const artifacts: ManifestArtifact[] = [
        {
          id: 'VIS-001',
          type: 'INTENT',
          phase: 'inception',
          stage: 'discover',
          path: '/path/to/intent.md',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          validation_passed: true,
          write_complete: true,
          checksum: 'abc123',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
        {
          id: 'VIS-002',
          type: 'PRD',
          phase: 'inception',
          stage: 'define',
          path: '/path/to/prd.md',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          validation_passed: true,
          write_complete: true,
          checksum: 'def456',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
        {
          id: 'FOR-001',
          type: 'UNITS',
          phase: 'construction',
          stage: 'unit',
          path: '/path/to/units.md',
          created_at: '2024-01-01T01:00:00Z',
          updated_at: '2024-01-01T01:00:00Z',
          validation_passed: true,
          write_complete: true,
          checksum: 'ghi789',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ artifacts }),
      });
      const guide = generateDeployGuide(context);

      expect(guide).toContain('Generated from 3 artifacts (2 Inception, 1 Construction)');
    });

    it('should handle null manifest gracefully', () => {
      const context = createTestContext({ manifest: null });
      const guide = generateDeployGuide(context);

      expect(guide).toContain('Generated from 0 artifacts (0 Inception, 0 Construction)');
      expect(guide).toContain('Test Feature');
    });

    it('should include standard deployment sections', () => {
      const context = createTestContext();
      const guide = generateDeployGuide(context);

      expect(guide).toContain('## Pre-Deployment Checklist');
      expect(guide).toContain('## Deployment Steps');
      expect(guide).toContain('### 1. Pre-Deployment');
      expect(guide).toContain('### 2. Deployment Execution');
      expect(guide).toContain('### 3. Post-Deployment');
      expect(guide).toContain('## Rollback Procedure');
      expect(guide).toContain('## Environment Configuration');
    });

    it('should include timestamp in frontmatter', () => {
      const context = createTestContext();
      const guide = generateDeployGuide(context);

      expect(guide).toMatch(/created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('should include generated by footer', () => {
      const context = createTestContext();
      const guide = generateDeployGuide(context);

      expect(guide).toContain('*Generated by Operations Phase Templates*');
    });
  });

  describe('generateRunbook', () => {
    it('should generate valid runbook markdown', () => {
      const context = createTestContext();
      const runbook = generateRunbook(context);

      expect(runbook).toContain('---');
      expect(runbook).toContain('id: RUNBOOK-001');
      expect(runbook).toContain('phase: operations');
      expect(runbook).toContain('stage: deploy');
    });

    it('should include feature name and workflow ID', () => {
      const context = createTestContext({
        featureName: 'Payment Service',
        workflowId: 'payment-001',
      });
      const runbook = generateRunbook(context);

      expect(runbook).toContain('# Runbook: Payment Service');
      expect(runbook).toContain('**Feature**: Payment Service');
      expect(runbook).toContain('**Workflow ID**: payment-001');
    });

    it('should include common operations section', () => {
      const context = createTestContext();
      const runbook = generateRunbook(context);

      expect(runbook).toContain('## Common Operations');
      expect(runbook).toContain('### Health Check');
      expect(runbook).toContain('### Log Access');
      expect(runbook).toContain('### Restart Procedure');
    });

    it('should include troubleshooting sections', () => {
      const context = createTestContext();
      const runbook = generateRunbook(context);

      expect(runbook).toContain('## Troubleshooting');
      expect(runbook).toContain('### High Error Rate');
      expect(runbook).toContain('### High Latency');
      expect(runbook).toContain('### Service Unavailable');
    });

    it('should include workflow ID in log paths', () => {
      const context = createTestContext({ workflowId: 'my-service' });
      const runbook = generateRunbook(context);

      expect(runbook).toContain('/var/log/service/my-service.log');
    });

    it('should include escalation path', () => {
      const context = createTestContext();
      const runbook = generateRunbook(context);

      expect(runbook).toContain('## Escalation Path');
      expect(runbook).toContain('| Level | Contact | Response Time |');
    });

    it('should include maintenance windows', () => {
      const context = createTestContext();
      const runbook = generateRunbook(context);

      expect(runbook).toContain('## Maintenance Windows');
      expect(runbook).toContain('Tuesdays 2-4 AM UTC');
    });

    it('should include timestamp in frontmatter', () => {
      const context = createTestContext();
      const runbook = generateRunbook(context);

      expect(runbook).toMatch(/created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });
  });

  describe('generateMonitoringConfig', () => {
    it('should generate valid JSON', () => {
      const context = createTestContext();
      const config = generateMonitoringConfig(context);

      expect(() => JSON.parse(config)).not.toThrow();
    });

    it('should include basic metadata', () => {
      const context = createTestContext({
        featureName: 'API Gateway',
        workflowId: 'gateway-123',
      });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.id).toBe('MONITORING-001');
      expect(config.feature).toBe('gateway-123');
      expect(config.feature_name).toBe('API Gateway');
      expect(config.phase).toBe('operations');
      expect(config.stage).toBe('monitor');
    });

    it('should use risk tier 3 thresholds for high-risk features', () => {
      const context = createTestContext({
        manifest: createTestManifest({
          risk_tier: {
            tier: 3,
            rationale: 'System-wide impact',
            factors: {
              reversibility: 'difficult',
              blast_radius: 'system-wide',
              data_sensitivity: 'user-facing',
              compliance_impact: 'major',
            },
            override_reason: null,
          },
        }),
      });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.risk_tier).toBe(3);
      expect(config.health_checks.interval_seconds).toBe(30); // Strictest
      expect(config.alerts[0].threshold).toBe(0.5); // Error rate: 0.5%
      expect(config.alerts[1].threshold).toBe(500); // Latency: 500ms
      expect(config.logging.level).toBe('debug');
      expect(config.logging.retention_days).toBe(90);
    });

    it('should use risk tier 2 thresholds for moderate-risk features', () => {
      const context = createTestContext({
        manifest: createTestManifest({
          risk_tier: {
            tier: 2,
            rationale: 'Moderate impact',
            factors: {
              reversibility: 'moderate',
              blast_radius: 'cross-cutting',
              data_sensitivity: 'internal',
              compliance_impact: 'minor',
            },
            override_reason: null,
          },
        }),
      });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.risk_tier).toBe(2);
      expect(config.health_checks.interval_seconds).toBe(60); // Moderate
      expect(config.alerts[0].threshold).toBe(1); // Error rate: 1%
      expect(config.alerts[1].threshold).toBe(1000); // Latency: 1000ms
      expect(config.logging.level).toBe('info');
      expect(config.logging.retention_days).toBe(60);
    });

    it('should use risk tier 1 thresholds for low-risk features', () => {
      const context = createTestContext({
        manifest: createTestManifest({
          risk_tier: {
            tier: 1,
            rationale: 'Low impact',
            factors: {
              reversibility: 'easy',
              blast_radius: 'isolated',
              data_sensitivity: 'none',
              compliance_impact: 'none',
            },
            override_reason: null,
          },
        }),
      });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.risk_tier).toBe(1);
      expect(config.health_checks.interval_seconds).toBe(120); // Relaxed
      expect(config.alerts[0].threshold).toBe(2); // Error rate: 2%
      expect(config.alerts[1].threshold).toBe(2000); // Latency: 2000ms
      expect(config.logging.level).toBe('info');
      expect(config.logging.retention_days).toBe(30);
    });

    it('should default to tier 2 when no risk_tier in manifest', () => {
      const context = createTestContext({
        manifest: createTestManifest({ risk_tier: null }),
      });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.risk_tier).toBe(2);
      expect(config.health_checks.interval_seconds).toBe(60);
      expect(config.alerts[0].threshold).toBe(1);
      expect(config.alerts[1].threshold).toBe(1000);
    });

    it('should default to tier 2 when manifest is null', () => {
      const context = createTestContext({ manifest: null });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.risk_tier).toBe(2);
      expect(config.health_checks.interval_seconds).toBe(60);
    });

    it('should include health check configuration', () => {
      const context = createTestContext();
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.health_checks).toBeDefined();
      expect(config.health_checks.endpoint).toBe('/health');
      expect(config.health_checks.timeout_seconds).toBe(5);
      expect(config.health_checks.unhealthy_threshold).toBe(3);
    });

    it('should include multiple alert configurations', () => {
      const context = createTestContext({ workflowId: 'api-service' });
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.alerts).toHaveLength(3);
      expect(config.alerts[0].name).toBe('api-service-error-rate');
      expect(config.alerts[0].metric).toBe('error_rate_percent');
      expect(config.alerts[0].severity).toBe('critical');
      expect(config.alerts[1].name).toBe('api-service-latency-p99');
      expect(config.alerts[1].metric).toBe('latency_p99_ms');
      expect(config.alerts[1].severity).toBe('warning');
      expect(config.alerts[2].name).toBe('api-service-availability');
      expect(config.alerts[2].metric).toBe('availability_percent');
      expect(config.alerts[2].comparison).toBe('less_than');
    });

    it('should include dashboard configuration', () => {
      const context = createTestContext();
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.dashboards).toBeDefined();
      expect(config.dashboards.overview).toBeDefined();
      expect(config.dashboards.overview.panels).toHaveLength(4);
      expect(config.dashboards.overview.panels[0].title).toBe('Request Rate');
      expect(config.dashboards.overview.panels[1].title).toBe('Error Rate');
      expect(config.dashboards.overview.panels[2].title).toBe('Latency (p50/p95/p99)');
      expect(config.dashboards.overview.panels[3].title).toBe('Availability');
    });

    it('should include logging configuration', () => {
      const context = createTestContext();
      const config = JSON.parse(generateMonitoringConfig(context));

      expect(config.logging).toBeDefined();
      expect(config.logging.structured).toBe(true);
    });
  });

  describe('generateReleaseNotes', () => {
    it('should generate valid release notes markdown', () => {
      const context = createTestContext();
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('---');
      expect(notes).toContain('id: RELEASE-NOTES-001');
      expect(notes).toContain('phase: operations');
      expect(notes).toContain('stage: deploy');
    });

    it('should include feature name and workflow ID', () => {
      const context = createTestContext({
        featureName: 'User Authentication',
        workflowId: 'auth-v2',
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('# Release Notes: User Authentication');
      expect(notes).toContain('**Feature**: User Authentication');
      expect(notes).toContain('**Workflow ID**: auth-v2');
    });

    it('should include artifact counts', () => {
      const artifacts: ManifestArtifact[] = [
        {
          id: 'VIS-001',
          type: 'INTENT',
          phase: 'inception',
          stage: 'discover',
          path: '/path/to/intent.md',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          validation_passed: true,
          write_complete: true,
          checksum: 'abc123',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
        {
          id: 'FOR-001',
          type: 'UNITS',
          phase: 'construction',
          stage: 'unit',
          path: '/path/to/units.md',
          created_at: '2024-01-01T01:00:00Z',
          updated_at: '2024-01-01T01:00:00Z',
          validation_passed: true,
          write_complete: true,
          checksum: 'def456',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ artifacts }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('**Total Artifacts**: 2');
      expect(notes).toContain('### Inception Phase (1 artifacts)');
      expect(notes).toContain('### Construction Phase (1 artifacts)');
    });

    it('should list artifacts with details', () => {
      const artifacts: ManifestArtifact[] = [
        {
          id: 'VIS-001',
          type: 'INTENT',
          phase: 'inception',
          stage: 'discover',
          path: '/path/to/intent.md',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          validation_passed: true,
          write_complete: true,
          checksum: 'abc123',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ artifacts }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('## Artifacts');
      expect(notes).toContain('- **VIS-001** (inception/discover): active');
    });

    it('should handle empty artifacts list', () => {
      const context = createTestContext({
        manifest: createTestManifest({ artifacts: [] }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('- No artifacts registered');
    });

    it('should include risk status', () => {
      const risks: RiskEntry[] = [
        {
          id: 'RISK-001',
          description: 'Database migration failure',
          likelihood: 'low',
          impact: 'high',
          mitigation: 'Backup and rollback plan',
          status: 'open',
          owner: 'team-lead',
        },
        {
          id: 'RISK-002',
          description: 'Performance degradation',
          likelihood: 'medium',
          impact: 'medium',
          mitigation: 'Load testing',
          status: 'mitigated',
          owner: 'devops',
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ risks }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('## Risk Status');
      expect(notes).toContain('- **Open Risks**: 1');
      expect(notes).toContain('- **Mitigated Risks**: 1');
      expect(notes).toContain('- **Total Risks**: 2');
    });

    it('should list open risks with details', () => {
      const risks: RiskEntry[] = [
        {
          id: 'RISK-001',
          description: 'Database migration failure',
          likelihood: 'low',
          impact: 'high',
          mitigation: 'Backup and rollback plan',
          status: 'open',
          owner: 'team-lead',
        },
        {
          id: 'RISK-002',
          description: 'API rate limiting',
          likelihood: 'high',
          impact: 'medium',
          mitigation: 'Circuit breaker pattern',
          status: 'open',
          owner: 'backend-team',
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ risks }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('### Open Risks');
      expect(notes).toContain('- **RISK-001**: Database migration failure (low/high)');
      expect(notes).toContain('- **RISK-002**: API rate limiting (high/medium)');
    });

    it('should not show open risks section when all risks are mitigated', () => {
      const risks: RiskEntry[] = [
        {
          id: 'RISK-001',
          description: 'Security vulnerability',
          likelihood: 'medium',
          impact: 'high',
          mitigation: 'Patched',
          status: 'mitigated',
          owner: 'security-team',
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ risks }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).not.toContain('### Open Risks');
      expect(notes).toContain('- **Open Risks**: 0');
    });

    it('should include gate audit counts', () => {
      const gateAudit: GateAuditEntry[] = [
        {
          phase: 'inception',
          timestamp: '2024-01-01T00:00:00Z',
          action: 'approved',
          actor: 'human',
          reason: null,
        },
        {
          phase: 'construction',
          timestamp: '2024-01-01T01:00:00Z',
          action: 'approved',
          actor: 'trust',
          reason: null,
        },
      ];
      const context = createTestContext({
        manifest: createTestManifest({ gate_audit: gateAudit }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('**Quality Gates Passed**: 2');
      expect(notes).toContain('- **Gates Passed**: 2');
    });

    it('should handle null manifest gracefully', () => {
      const context = createTestContext({ manifest: null });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('**Total Artifacts**: 0');
      expect(notes).toContain('- No artifacts registered');
      expect(notes).toContain('- **Open Risks**: 0');
      expect(notes).toContain('**Quality Gates Passed**: 0');
      expect(notes).toContain('**Risk Tier**: Not assessed');
    });

    it('should include risk tier when available', () => {
      const context = createTestContext({
        manifest: createTestManifest({
          risk_tier: {
            tier: 3,
            rationale: 'High impact',
            factors: {
              reversibility: 'difficult',
              blast_radius: 'system-wide',
              data_sensitivity: 'user-facing',
              compliance_impact: 'major',
            },
            override_reason: null,
          },
        }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('**Risk Tier**: 3');
    });

    it('should show "Not assessed" when risk_tier is null', () => {
      const context = createTestContext({
        manifest: createTestManifest({ risk_tier: null }),
      });
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('**Risk Tier**: Not assessed');
    });

    it('should include known issues section', () => {
      const context = createTestContext();
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('## Known Issues');
      expect(notes).toContain('Operations phase is documentation-only in v1');
    });

    it('should include upgrade notes', () => {
      const context = createTestContext();
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('## Upgrade Notes');
      expect(notes).toContain('No migration from previous versions required');
    });

    it('should format date correctly', () => {
      const context = createTestContext();
      const notes = generateReleaseNotes(context);

      expect(notes).toMatch(/\*\*Date\*\*: \d{4}-\d{2}-\d{2}/);
    });

    it('should include AIDLC methodology reference', () => {
      const context = createTestContext();
      const notes = generateReleaseNotes(context);

      expect(notes).toContain('AIDLC (Inception → Construction → Operations)');
      expect(notes).toContain('AI-Driven Development Life Cycle (AIDLC) methodology');
    });
  });

  describe('generateCostAnalysis', () => {
    it('should generate valid cost analysis markdown', () => {
      const context = createTestContext();
      const cost = generateCostAnalysis(context);

      expect(cost).toContain('---');
      expect(cost).toContain('id: COST-001');
      expect(cost).toContain('phase: operations');
    });

    it('should include workflow metrics table', () => {
      const artifacts: ManifestArtifact[] = [
        {
          id: 'UNIT-001', type: 'UNIT', phase: 'construction', stage: 'unit',
          path: '/path/to/unit.md', created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z', validation_passed: true,
          write_complete: true, checksum: 'abc', contract_status: 'fulfilled',
          contract_version: 1, stale_reason: null,
        },
        {
          id: 'BOLT-001', type: 'BOLT', phase: 'construction', stage: 'code-generation',
          path: '/path/to/bolt.md', created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z', validation_passed: true,
          write_complete: true, checksum: 'def', contract_status: 'fulfilled',
          contract_version: 1, stale_reason: null,
        },
        {
          id: 'BOLT-002', type: 'BOLT', phase: 'construction', stage: 'code-generation',
          path: '/path/to/bolt2.md', created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z', validation_passed: true,
          write_complete: true, checksum: 'ghi', contract_status: 'fulfilled',
          contract_version: 1, stale_reason: null,
        },
      ];
      const context = createTestContext({ manifest: createTestManifest({ artifacts }) });
      const cost = generateCostAnalysis(context);

      expect(cost).toContain('| Total UNITs | 1 |');
      expect(cost).toContain('| Total Code Generations | 2 |');
      expect(cost).toContain('| Total Artifacts | 3 |');
    });

    it('should include rejection analysis', () => {
      const gateAudit: GateAuditEntry[] = [
        { phase: 'construction', timestamp: '2024-01-01T00:00:00Z', action: 'rejected', actor: 'human', reason: 'Incomplete tests' },
        { phase: 'construction', timestamp: '2024-01-01T01:00:00Z', action: 'approved', actor: 'human', reason: null },
      ];
      const context = createTestContext({ manifest: createTestManifest({ gate_audit: gateAudit }) });
      const cost = generateCostAnalysis(context);

      expect(cost).toContain('| Gate Rejections | 1 |');
      expect(cost).toContain('Incomplete tests');
      expect(cost).toContain('1 rejection cycle(s)');
    });

    it('should show zero rework when no rejections', () => {
      const context = createTestContext({ manifest: createTestManifest({ gate_audit: [] }) });
      const cost = generateCostAnalysis(context);

      expect(cost).toContain('zero rework cycles');
    });

    it('should handle null manifest', () => {
      const context = createTestContext({ manifest: null });
      const cost = generateCostAnalysis(context);

      expect(cost).toContain('| Total UNITs | 0 |');
      expect(cost).toContain('| Total Code Generations | 0 |');
    });

    it('should include generated by footer', () => {
      const context = createTestContext();
      const cost = generateCostAnalysis(context);

      expect(cost).toContain('*Generated by Operations Phase Templates*');
    });
  });

  describe('generateOperationsArtifacts', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-test-'));
      const aidlcDir = path.join(tmpDir, 'aidlc-docs');
      fs.mkdirSync(aidlcDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should generate all 5 artifacts for MEDIUM depth', async () => {
      const context = createTestContext({ depthLevel: 'MEDIUM' });
      const result = await generateOperationsArtifacts(context, tmpDir);

      expect(result.artifactsGenerated).toHaveLength(5);
      expect(result.artifactsGenerated).toContain('release-notes.md');
      expect(result.artifactsGenerated).toContain('deploy-guide.md');
      expect(result.artifactsGenerated).toContain('runbook.md');
      expect(result.artifactsGenerated).toContain('monitoring.json');
      expect(result.artifactsGenerated).toContain('cost.md');

      // Verify files exist on disk
      const opsDir = path.join(tmpDir, 'aidlc-docs', 'test-feature', 'operations');
      for (const file of result.artifactsGenerated) {
        expect(fs.existsSync(path.join(opsDir, file))).toBe(true);
      }
    });

    it('should generate all 5 artifacts for DEEP depth', async () => {
      const context = createTestContext({ depthLevel: 'DEEP' });
      const result = await generateOperationsArtifacts(context, tmpDir);

      expect(result.artifactsGenerated).toHaveLength(5);
    });

    it('should generate only release-notes.md for SHALLOW depth', async () => {
      const context = createTestContext({ depthLevel: 'SHALLOW' });
      const result = await generateOperationsArtifacts(context, tmpDir);

      expect(result.artifactsGenerated).toHaveLength(1);
      expect(result.artifactsGenerated).toEqual(['release-notes.md']);

      // Verify ONLY release-notes exists
      const opsDir = path.join(tmpDir, 'aidlc-docs', 'test-feature', 'operations');
      expect(fs.existsSync(path.join(opsDir, 'release-notes.md'))).toBe(true);
      expect(fs.existsSync(path.join(opsDir, 'deploy-guide.md'))).toBe(false);
      expect(fs.existsSync(path.join(opsDir, 'runbook.md'))).toBe(false);
      expect(fs.existsSync(path.join(opsDir, 'monitoring.json'))).toBe(false);
      expect(fs.existsSync(path.join(opsDir, 'cost.md'))).toBe(false);
    });

    it('should create operations directory', async () => {
      const context = createTestContext();
      const result = await generateOperationsArtifacts(context, tmpDir);

      expect(result.operationsDir).toBe(path.join(tmpDir, 'aidlc-docs', 'test-feature', 'operations'));
      expect(fs.existsSync(result.operationsDir)).toBe(true);
    });

    it('should write valid content to files', async () => {
      const context = createTestContext({ featureName: 'My Feature' });
      await generateOperationsArtifacts(context, tmpDir);

      const opsDir = path.join(tmpDir, 'aidlc-docs', 'test-feature', 'operations');
      const releaseNotes = fs.readFileSync(path.join(opsDir, 'release-notes.md'), 'utf-8');
      expect(releaseNotes).toContain('My Feature');

      const costAnalysis = fs.readFileSync(path.join(opsDir, 'cost.md'), 'utf-8');
      expect(costAnalysis).toContain('My Feature');
    });

    it('should default to MEDIUM when depthLevel not set', async () => {
      const context = { ...createTestContext() };
      delete (context as any).depthLevel;
      const result = await generateOperationsArtifacts(context as any, tmpDir);

      // MEDIUM generates all 5 artifacts
      expect(result.artifactsGenerated).toHaveLength(5);
    });
  });
});
