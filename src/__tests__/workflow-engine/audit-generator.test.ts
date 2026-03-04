import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import {
  generateAuditDocument,
  renderAuditMarkdown,
  writeAuditArtifact,
  appendToAudit,
  type AuditDocument,
  type AuditTimelineEntry,
} from '../../features/workflow-engine/audit-generator.js';
import {
  createManifest,
  loadManifest,
  addGateAuditEntry,
  registerArtifact,
  linkArtifacts,
} from '../../features/workflow-engine/manifest.js';
import {
  saveTrustState,
  createDefaultTrustState,
} from '../../features/workflow-engine/trust.js';

const TEST_DIR_NAME = '.test-audit-generator';

describe('audit-generator', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR_NAME);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('generateAuditDocument', () => {
    it('returns empty audit when manifest does not exist', () => {
      const result = generateAuditDocument(testDir, 'nonexistent-workflow-id');

      expect(result.workflowId).toBe('nonexistent-workflow-id');
      expect(result.timeline).toEqual([]);
      expect(result.traceabilityMatrix).toEqual([]);
      expect(result.trustHistory).toEqual([]);
      expect(result.cascadeEvents).toEqual([]);
    });

    it('builds timeline from manifest gate_audit entries', () => {
      const workflowId = 'wf-timeline';
      const manifestPath = createManifest(workflowId, 'Timeline Feature', testDir);

      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        action: 'approved',
        actor: 'human',
        reason: 'Looks good',
      });
      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'rejected',
        actor: 'human',
        reason: 'Missing details',
      });

      const result = generateAuditDocument(testDir, workflowId);

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].phase).toBe('inception');
      expect(result.timeline[1].phase).toBe('construction');
    });

    it('timeline is chronologically sorted', () => {
      const workflowId = 'wf-sort';
      const manifestPath = createManifest(workflowId, 'Sort Feature', testDir);

      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      raw.gate_audit = [
        {
          phase: 'construction',
          timestamp: '2024-01-02T00:00:00.000Z',
          action: 'approved',
          actor: 'human',
          reason: null,
        },
        {
          phase: 'inception',
          timestamp: '2024-01-01T00:00:00.000Z',
          action: 'approved',
          actor: 'human',
          reason: null,
        },
      ];
      fs.writeFileSync(manifestPath, JSON.stringify(raw, null, 2), 'utf-8');

      const result = generateAuditDocument(testDir, workflowId);

      expect(result.timeline).toHaveLength(2);
      expect(result.timeline[0].phase).toBe('inception');
      expect(result.timeline[0].timestamp).toBe('2024-01-01T00:00:00.000Z');
      expect(result.timeline[1].phase).toBe('construction');
      expect(result.timeline[1].timestamp).toBe('2024-01-02T00:00:00.000Z');
    });

    it('traceability matrix populated from manifest links', () => {
      const workflowId = 'wf-traceability';
      const manifestPath = createManifest(workflowId, 'Traceability Feature', testDir);
      const workflowDir = join(testDir, 'aidlc-docs', workflowId);

      fs.writeFileSync(join(workflowDir, 'intent.md'), '# Intent', 'utf-8');
      fs.writeFileSync(join(workflowDir, 'unit.md'), '# Unit', 'utf-8');
      fs.writeFileSync(join(workflowDir, 'bolt.md'), '# Bolt', 'utf-8');

      registerArtifact(manifestPath, {
        id: 'intent-1',
        type: 'INTENT',
        phase: 'inception',
        stage: 'intent',
        path: join(workflowDir, 'intent.md'),
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'unit-1',
        type: 'UNIT',
        phase: 'construction',
        stage: 'unit',
        path: join(workflowDir, 'unit.md'),
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      registerArtifact(manifestPath, {
        id: 'bolt-1',
        type: 'BOLT',
        phase: 'construction',
        stage: 'code-generation',
        path: join(workflowDir, 'bolt.md'),
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });

      linkArtifacts(manifestPath, {
        source_id: 'intent-1',
        target_id: 'unit-1',
        link_type: 'derives',
      });

      linkArtifacts(manifestPath, {
        source_id: 'unit-1',
        target_id: 'bolt-1',
        link_type: 'implements',
      });

      const result = generateAuditDocument(testDir, workflowId);

      expect(result.traceabilityMatrix).toHaveLength(1);
      const entry = result.traceabilityMatrix[0];
      expect(entry.intentId).toBe('intent-1');
      expect(entry.unitIds).toContain('unit-1');
      expect(entry.codeGenerationIds).toContain('bolt-1');
    });

    it('empty manifest produces valid but sparse audit document', () => {
      const workflowId = 'wf-empty';
      createManifest(workflowId, 'Empty Feature', testDir);

      const result = generateAuditDocument(testDir, workflowId);

      expect(result.timeline).toEqual([]);
      expect(result.traceabilityMatrix).toEqual([]);
      expect(result.trustHistory).toEqual([]);
      expect(result.cascadeEvents).toEqual([]);
      expect(Array.isArray(result.retroInsights)).toBe(true);
    });
  });

  describe('renderAuditMarkdown', () => {
    it('renders valid markdown with all sections', () => {
      const audit: AuditDocument = {
        workflowId: 'wf-render',
        featureName: 'Render Feature',
        generatedAt: new Date().toISOString(),
        timeline: [
          {
            timestamp: '2024-01-01T00:00:00.000Z',
            phase: 'inception',
            action: 'approved',
            actor: 'human',
            reason: 'LGTM',
          },
        ],
        traceabilityMatrix: [
          {
            intentId: 'intent-1',
            unitIds: ['unit-1'],
            codeGenerationIds: ['bolt-1'],
            codeFiles: [],
          },
        ],
        trustHistory: [
          {
            from: 0,
            to: 1,
            reason: 'Threshold met',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
        cascadeEvents: [
          {
            artifactId: 'unit-1',
            previousStatus: 'active',
            newStatus: 'stale',
            reason: 'Parent changed',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
        retroInsights: ['Reduce rework by validating earlier'],
      };

      const md = renderAuditMarkdown(audit);

      expect(md).toContain('# Audit Report');
      expect(md).toContain('## Timeline');
      expect(md).toContain('## Traceability Matrix');
      expect(md).toContain('## Trust History');
      expect(md).toContain('## Cascade Events');
      expect(md).toContain('## Retrospective Insights');
    });

    it('renders placeholder text for empty sections', () => {
      const audit: AuditDocument = {
        workflowId: 'wf-empty',
        featureName: 'Empty Feature',
        generatedAt: new Date().toISOString(),
        timeline: [],
        traceabilityMatrix: [],
        trustHistory: [],
        cascadeEvents: [],
        retroInsights: [],
      };

      const md = renderAuditMarkdown(audit);

      expect(md).toContain('No gate decisions recorded');
      expect(md).toContain('No traceability data available');
      expect(md).toContain('No trust level changes recorded');
      expect(md).toContain('No cascade invalidation events recorded');
      expect(md).toContain('No retrospective insights available');
    });
  });

  describe('writeAuditArtifact', () => {
    it('writes audit.md to correct path', async () => {
      const workflowId = 'wf-write';
      createManifest(workflowId, 'Write Feature', testDir);

      const audit: AuditDocument = {
        workflowId,
        featureName: 'Write Feature',
        generatedAt: new Date().toISOString(),
        timeline: [],
        traceabilityMatrix: [],
        trustHistory: [],
        cascadeEvents: [],
        retroInsights: [],
      };

      const auditPath = await writeAuditArtifact(testDir, workflowId, audit);
      const expectedPath = join(testDir, 'aidlc-docs', workflowId, 'audit.md');

      expect(fs.existsSync(expectedPath)).toBe(true);
      expect(auditPath).toBe(expectedPath);
    });

    it('registers artifact in manifest', async () => {
      const workflowId = 'wf-register';
      const manifestPath = createManifest(workflowId, 'Register Feature', testDir);

      const audit: AuditDocument = {
        workflowId,
        featureName: 'Register Feature',
        generatedAt: new Date().toISOString(),
        timeline: [],
        traceabilityMatrix: [],
        trustHistory: [],
        cascadeEvents: [],
        retroInsights: [],
      };

      await writeAuditArtifact(testDir, workflowId, audit);

      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();
      const auditArtifact = manifest!.artifacts.find((a) => a.type === 'AUDIT');
      expect(auditArtifact).toBeDefined();
    });
  });

  describe('appendToAudit', () => {
    it('creates file when missing', () => {
      const workflowId = 'wf-append-create';
      const entry: AuditTimelineEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        phase: 'inception',
        action: 'approved',
        actor: 'human',
        reason: 'Initial approval',
      };

      appendToAudit(testDir, workflowId, entry);

      const auditPath = join(testDir, 'aidlc-docs', workflowId, 'audit.md');
      expect(fs.existsSync(auditPath)).toBe(true);

      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('2024-01-01T00:00:00.000Z');
      expect(content).toContain('inception');
    });

    it('appends to existing file', () => {
      const workflowId = 'wf-append-existing';
      const workflowDir = join(testDir, 'aidlc-docs', workflowId);
      fs.ensureDirSync(workflowDir);

      const auditPath = join(workflowDir, 'audit.md');
      fs.writeFileSync(auditPath, '# Audit Report\n\n## Timeline\n\n', 'utf-8');

      const entry1: AuditTimelineEntry = {
        timestamp: '2024-01-01T00:00:00.000Z',
        phase: 'inception',
        action: 'approved',
        actor: 'human',
        reason: 'First entry',
      };
      const entry2: AuditTimelineEntry = {
        timestamp: '2024-01-02T00:00:00.000Z',
        phase: 'construction',
        action: 'rejected',
        actor: 'human',
        reason: 'Second entry',
      };

      appendToAudit(testDir, workflowId, entry1);
      appendToAudit(testDir, workflowId, entry2);

      const content = fs.readFileSync(auditPath, 'utf-8');
      expect(content).toContain('First entry');
      expect(content).toContain('Second entry');
      expect(content).toContain('inception');
      expect(content).toContain('construction');
    });
  });

  describe('generateAuditDocument — trust history', () => {
    it('includes trust level changes from trust-state.json', () => {
      const workflowId = 'wf-trust';
      createManifest(workflowId, 'Trust Feature', testDir);

      const trustState = createDefaultTrustState();
      trustState.level_history = [
        {
          from: 0,
          to: 1,
          reason: 'Qualification threshold met',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
      ];
      saveTrustState(trustState, testDir);

      const result = generateAuditDocument(testDir, workflowId);

      expect(result.trustHistory).toHaveLength(1);
      expect(result.trustHistory[0].from).toBe(0);
      expect(result.trustHistory[0].to).toBe(1);
      expect(result.trustHistory[0].reason).toBe('Qualification threshold met');
    });

    it('retroInsights is an array', () => {
      const workflowId = 'wf-retro';
      createManifest(workflowId, 'Retro Feature', testDir);

      const result = generateAuditDocument(testDir, workflowId);

      expect(Array.isArray(result.retroInsights)).toBe(true);
    });
  });
});
