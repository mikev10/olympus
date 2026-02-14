import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { atomicManifestUpdate, batchManifestUpdate } from '../../features/workflow-engine/manifest-updater.js';
import type { ManifestSchema } from '../../features/workflow-engine/phase-types.js';

describe('manifest-updater', () => {
  let testDir: string;
  let manifestPath: string;

  const testManifest: ManifestSchema = {
    schema_version: '2.0.0',
    workflow_id: 'test-wf',
    feature_name: 'Test',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    depth_assessment: null,
    artifacts: [],
    links: [],
    risks: [],
    gate_audit: [],
    metrics: null,
    alignment_checks: [],
    risk_tier: null,
  };

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-updater-test-'));
    manifestPath = path.join(testDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(testManifest, null, 2), 'utf-8');
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('atomicManifestUpdate', () => {
    it('successfully reads, updates, and writes manifest atomically', async () => {
      await atomicManifestUpdate(manifestPath, (manifest) => ({
        ...manifest,
        feature_name: 'Updated Feature',
        updated_at: '2024-01-02T00:00:00Z',
      }));

      const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      expect(updated.feature_name).toBe('Updated Feature');
      expect(updated.updated_at).toBe('2024-01-02T00:00:00Z');
      expect(updated.workflow_id).toBe('test-wf');
    });

    it('temp file is cleaned up after successful write', async () => {
      const tempPath = `${manifestPath}.tmp`;

      await atomicManifestUpdate(manifestPath, (manifest) => ({
        ...manifest,
        feature_name: 'Updated',
      }));

      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('temp file is cleaned up after updater throws', async () => {
      const tempPath = `${manifestPath}.tmp`;

      try {
        await atomicManifestUpdate(manifestPath, () => {
          throw new Error('Updater error');
        });
      } catch {
        // Expected
      }

      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('throws when manifest does not exist', async () => {
      const nonexistentPath = path.join(testDir, 'missing.json');

      await expect(
        atomicManifestUpdate(nonexistentPath, (manifest) => manifest)
      ).rejects.toThrow(`Manifest not found at: ${nonexistentPath}`);
    });

    it('produces valid JSON after update', async () => {
      await atomicManifestUpdate(manifestPath, (manifest) => ({
        ...manifest,
        feature_name: 'JSON Check',
        artifacts: [
          {
            id: 'TEST-001',
            type: 'TEST',
            phase: 'inception' as const,
            stage: 'idea' as const,
            path: 'test/path.md',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
            validation_passed: true,
            write_complete: true,
            checksum: 'abc123',
            contract_status: 'active' as const,
            contract_version: 1,
            stale_reason: null,
          },
        ],
      }));

      // Should parse without error
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(content) as ManifestSchema;
      expect(parsed.feature_name).toBe('JSON Check');
      expect(parsed.artifacts).toHaveLength(1);
      expect(parsed.artifacts[0].id).toBe('TEST-001');
    });

    it('handles concurrent access simulation', async () => {
      const update1 = atomicManifestUpdate(manifestPath, (manifest) => ({
        ...manifest,
        feature_name: 'Update 1',
        updated_at: '2024-01-02T00:00:00Z',
      }));

      const update2 = atomicManifestUpdate(manifestPath, (manifest) => ({
        ...manifest,
        feature_name: 'Update 2',
        updated_at: '2024-01-03T00:00:00Z',
      }));

      await Promise.all([update1, update2]);

      // Final state should be valid (one of the two updates won)
      const final = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      expect(['Update 1', 'Update 2']).toContain(final.feature_name);
      expect(['2024-01-02T00:00:00Z', '2024-01-03T00:00:00Z']).toContain(final.updated_at);

      // File should not be corrupted
      expect(final.workflow_id).toBe('test-wf');
      expect(final.schema_version).toBe('2.0.0');
    });

    it('preserves all manifest fields through round-trip', async () => {
      const richManifest: ManifestSchema = {
        ...testManifest,
        depth_assessment: {
          total_score: 15,
          factors: {
            complexity: 3,
            team_size: 2,
            risk: 3,
            novelty: 2,
            dependencies: 3,
            scope: 2,
          },
          label: 'MEDIUM',
          risk_tier: 2,
        },
        risk_tier: {
          tier: 2,
          rationale: 'Moderate risk',
          factors: {
            reversibility: 'moderate',
            blast_radius: 'cross-cutting',
            data_sensitivity: 'internal',
            compliance_impact: 'minor',
          },
          override_reason: null,
        },
      };
      fs.writeFileSync(manifestPath, JSON.stringify(richManifest, null, 2), 'utf-8');

      await atomicManifestUpdate(manifestPath, (manifest) => ({
        ...manifest,
        feature_name: 'Round Trip',
      }));

      const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      expect(result.feature_name).toBe('Round Trip');
      expect(result.depth_assessment?.total_score).toBe(15);
      expect(result.risk_tier?.tier).toBe(2);
    });
  });

  describe('batchManifestUpdate', () => {
    it('applies multiple updaters in sequence', async () => {
      const updaters = [
        (m: ManifestSchema) => ({ ...m, feature_name: 'Step 1' }),
        (m: ManifestSchema) => ({ ...m, updated_at: '2024-01-02T00:00:00Z' }),
        (m: ManifestSchema) => ({ ...m, phases: { ...m.phases, discovery: { ...m.phases.discovery, status: 'in_progress' as const } } }),
      ];

      await batchManifestUpdate(manifestPath, updaters);

      const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      expect(updated.feature_name).toBe('Step 1');
      expect(updated.updated_at).toBe('2024-01-02T00:00:00Z');
      expect(updated.phases.discovery.status).toBe('in_progress');
    });

    it('applies all updates atomically (all or nothing)', async () => {
      // All 3 updaters applied in one write
      const updaters = [
        (m: ManifestSchema) => ({ ...m, feature_name: 'Batch 1' }),
        (m: ManifestSchema) => ({ ...m, updated_at: '2024-01-02T00:00:00Z' }),
        (m: ManifestSchema) => ({ ...m, workflow_id: 'batch-test' }),
      ];

      await batchManifestUpdate(manifestPath, updaters);

      const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      // All three updates should be present in the final result
      expect(result.feature_name).toBe('Batch 1');
      expect(result.updated_at).toBe('2024-01-02T00:00:00Z');
      expect(result.workflow_id).toBe('batch-test');
    });

    it('throws when manifest does not exist', async () => {
      const nonexistentPath = path.join(testDir, 'missing.json');

      await expect(
        batchManifestUpdate(nonexistentPath, [(m) => m])
      ).rejects.toThrow(`Manifest not found at: ${nonexistentPath}`);
    });

    it('temp file is cleaned up after batch update', async () => {
      const tempPath = `${manifestPath}.tmp`;

      await batchManifestUpdate(manifestPath, [
        (m) => ({ ...m, feature_name: 'Batch Updated' }),
      ]);

      expect(fs.existsSync(tempPath)).toBe(false);
    });

    it('preserves order of updates (last writer wins)', async () => {
      const updaters = [
        (m: ManifestSchema) => ({ ...m, feature_name: 'A' }),
        (m: ManifestSchema) => ({ ...m, feature_name: 'B' }),
        (m: ManifestSchema) => ({ ...m, feature_name: 'C' }),
      ];

      await batchManifestUpdate(manifestPath, updaters);

      const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      expect(updated.feature_name).toBe('C');
    });

    it('handles empty updaters array', async () => {
      await batchManifestUpdate(manifestPath, []);

      // Should still write (no-op but valid)
      const result = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestSchema;
      expect(result.feature_name).toBe('Test');
    });
  });
});
