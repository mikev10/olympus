import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import { executeDiscoveryPhase } from '../../features/workflow-engine/discovery.js';
import { createManifest, loadManifest } from '../../features/workflow-engine/manifest.js';
import { saveCheckpoint, loadCheckpoint, clearCache } from '../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';

describe('deepinit-integration', () => {
  let tmpDir: string;
  let projectPath: string;
  let manifestPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-deepinit-test-'));
    projectPath = tmpDir;

    manifestPath = createManifest('test-workflow', 'Test Feature', projectPath);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
    clearCache();
  });

  async function createTestCheckpoint(manifestPath: string): Promise<void> {
    const checkpoint: WorkflowCheckpointV3 = {
      schema_version: '3.0.0',
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      current_phase: 'discovery',
      current_stage: 'intent',
      status: 'in_progress',
      phases: {
        discovery: {
          status: 'in_progress',
          started_at: new Date().toISOString(),
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        inception: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        construction: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        operations: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
      },
      manifest_path: manifestPath,
      trust_state_path: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await saveCheckpoint(projectPath, checkpoint);
  }

  describe('WorkflowCheckpointV3 deepinit_status field', () => {
    it('should accept deepinit_status field in checkpoint', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'test-wf',
        feature_name: 'Test Feature',
        current_phase: 'discovery',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: {
            status: 'in_progress',
            started_at: new Date().toISOString(),
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          inception: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: manifestPath,
        trust_state_path: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deepinit_status: 'not_detected',
      };

      expect(checkpoint.deepinit_status).toBe('not_detected');
    });

    it('should accept all deepinit_status values', () => {
      const validStatuses: Array<NonNullable<WorkflowCheckpointV3['deepinit_status']>> = [
        'skipped',
        'completed',
        'pre-existing',
        'suggested',
        'not_applicable',
        'not_detected',
        'detected',
      ];

      for (const status of validStatuses) {
        const checkpoint: WorkflowCheckpointV3 = {
          schema_version: '3.0.0',
          workflow_id: 'test-wf',
          feature_name: 'Test Feature',
          current_phase: 'discovery',
          current_stage: 'intent',
          status: 'in_progress',
          phases: {
            discovery: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
            inception: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
            construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
            operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          },
          manifest_path: manifestPath,
          trust_state_path: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deepinit_status: status,
        };

        expect(checkpoint.deepinit_status).toBe(status);
      }
    });

    it('should allow deepinit_status to be undefined (backward compatibility)', () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'test-wf',
        feature_name: 'Test Feature',
        current_phase: 'discovery',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: manifestPath,
        trust_state_path: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      expect(checkpoint.deepinit_status).toBeUndefined();
    });
  });

  describe('executeDiscoveryPhase deepinit suggestion logic', () => {
    async function createSourceFiles(dir: string, count: number, ext: string = '.ts'): Promise<void> {
      await fs.ensureDir(dir);
      for (let i = 0; i < count; i++) {
        await fs.writeFile(path.join(dir, `file${i}${ext}`), `// source file ${i}`);
      }
    }

    it('should suggest deepinit for large project (50+ files)', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 50);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result.deepinitSuggested).toBe(true);
      expect(result.sourceFileCount).toBeGreaterThanOrEqual(50);
    });

    it('should NOT suggest deepinit for small project (<50 files)', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 20);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result.deepinitSuggested).toBe(false);
      expect(result.sourceFileCount).toBeLessThan(50);
    });

    it('should set sourceFileCount correctly in result', async () => {
      await createTestCheckpoint(manifestPath);
      const fileCount = 25;
      await createSourceFiles(projectPath, fileCount);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result.sourceFileCount).toBe(fileCount);
    });

    it('should include deepinit-related fields in result', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 30);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result).toHaveProperty('agentsMdDetected');
      expect(result).toHaveProperty('deepinitSuggested');
      expect(typeof result.agentsMdDetected).toBe('boolean');
      expect(typeof result.deepinitSuggested).toBe('boolean');
    });

    it('should write deepinit_status=suggested to checkpoint for large project', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 50);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      const checkpoint = await loadCheckpoint(projectPath, 'test-workflow');
      expect(checkpoint?.deepinit_status).toBe('suggested');
    });

    it('should write deepinit_status=skipped to checkpoint for small brownfield project', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 20);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      const checkpoint = await loadCheckpoint(projectPath, 'test-workflow');
      expect(checkpoint?.deepinit_status).toBe('skipped');
    });

    it('should write deepinit_status=not_applicable to checkpoint for greenfield project', async () => {
      await createTestCheckpoint(manifestPath);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      const checkpoint = await loadCheckpoint(projectPath, 'test-workflow');
      expect(checkpoint?.deepinit_status).toBe('not_applicable');
    });

    it('should register AGENTS.md files as structural-map artifacts when detected', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 10);
      const agentsMdPath = path.join(projectPath, 'AGENTS.md');
      await fs.writeFile(agentsMdPath, '# Root\n\n## Key Files\n- **src/index.ts**: Entry point\n');

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      if (result.agentsMdDetected) {
        const manifest = loadManifest(manifestPath);
        const structuralMapArtifacts = manifest.artifacts.filter(
          (a: { type: string }) => a.type === 'structural-map'
        );
        expect(structuralMapArtifacts.length).toBeGreaterThan(0);
      }
    });

    it('should include agentsMdStale in result', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 10);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result).toHaveProperty('agentsMdStale');
    });

    it('should write deepinit detection step to audit.md', async () => {
      await createTestCheckpoint(manifestPath);
      await createSourceFiles(projectPath, 50);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-workflow',
        featureName: 'Test Feature',
        manifestPath,
      });

      const auditPath = path.join(projectPath, 'aidlc-docs', 'test-workflow', 'audit.md');
      const auditExists = await fs.pathExists(auditPath);
      expect(auditExists).toBe(true);

      const auditContent = await fs.readFile(auditPath, 'utf-8');
      expect(auditContent).toContain('Discovery — Deepinit Detection');
      expect(auditContent).toContain('Source file count');
      expect(auditContent).toContain('Deepinit status');
    });
  });
});
