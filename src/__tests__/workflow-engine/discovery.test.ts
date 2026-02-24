import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import {
  SOURCE_EXTENSIONS,
  DISCOVERY_ARTIFACTS,
  detectBrownfield,
  shouldRunDiscovery,
  getDiscoveryTemplate,
  executeDiscoveryPhase,
  approveDiscoveryGate,
  rejectDiscoveryGate,
} from '../../features/workflow-engine/discovery.js';
import { createManifest } from '../../features/workflow-engine/manifest.js';
import { saveCheckpoint, clearCache } from '../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';

describe('discovery', () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-discovery-test-'));
    projectPath = tmpDir;
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
    clearCache();
  });

  /**
   * Helper function to create source files in test directories
   */
  async function createSourceFiles(dir: string, count: number, ext: string = '.ts'): Promise<void> {
    await fs.ensureDir(dir);
    for (let i = 0; i < count; i++) {
      await fs.writeFile(path.join(dir, `file${i}${ext}`), `// source file ${i}`);
    }
  }

  /**
   * Helper function to create config files (should not be counted)
   */
  async function createConfigFiles(dir: string, count: number): Promise<void> {
    await fs.ensureDir(dir);
    const configExts = ['.json', '.yaml', '.yml', '.toml', '.xml', '.lock', '.env', '.md'];
    for (let i = 0; i < count; i++) {
      const ext = configExts[i % configExts.length];
      await fs.writeFile(path.join(dir, `config${i}${ext}`), `# config file ${i}`);
    }
  }

  /**
   * Helper function to create a valid V3 checkpoint
   */
  async function createTestCheckpoint(manifestPath: string): Promise<void> {
    const checkpoint: WorkflowCheckpointV3 = {
      schema_version: '3.0.0',
      workflow_id: 'test-wf',
      feature_name: 'Test Feature',
      current_phase: 'discovery',
      current_stage: 'idea',
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

  describe('SOURCE_EXTENSIONS', () => {
    it('should export array of source file extensions', () => {
      expect(SOURCE_EXTENSIONS).toBeDefined();
      expect(Array.isArray(SOURCE_EXTENSIONS)).toBe(true);
      expect(SOURCE_EXTENSIONS.length).toBeGreaterThan(0);
    });

    it('should include common source extensions', () => {
      expect(SOURCE_EXTENSIONS).toContain('.ts');
      expect(SOURCE_EXTENSIONS).toContain('.tsx');
      expect(SOURCE_EXTENSIONS).toContain('.js');
      expect(SOURCE_EXTENSIONS).toContain('.jsx');
      expect(SOURCE_EXTENSIONS).toContain('.py');
      expect(SOURCE_EXTENSIONS).toContain('.go');
      expect(SOURCE_EXTENSIONS).toContain('.rs');
    });
  });

  describe('DISCOVERY_ARTIFACTS', () => {
    it('should export array of 6 artifact types', () => {
      expect(DISCOVERY_ARTIFACTS).toBeDefined();
      expect(Array.isArray(DISCOVERY_ARTIFACTS)).toBe(true);
      expect(DISCOVERY_ARTIFACTS.length).toBe(7);
    });

    it('should include all expected artifact types', () => {
      expect(DISCOVERY_ARTIFACTS).toContain('analysis-plan');
      expect(DISCOVERY_ARTIFACTS).toContain('current-state-analysis');
      expect(DISCOVERY_ARTIFACTS).toContain('regression-baseline');
      expect(DISCOVERY_ARTIFACTS).toContain('change-impact');
      expect(DISCOVERY_ARTIFACTS).toContain('static-model');
      expect(DISCOVERY_ARTIFACTS).toContain('dynamic-model');
      expect(DISCOVERY_ARTIFACTS).toContain('workspace-scan');
    });
  });

  describe('detectBrownfield', () => {
    it('should return isBrownfield=true when 3+ source files exist', async () => {
      await createSourceFiles(projectPath, 5);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(true);
      expect(result.sourceFileCount).toBe(5);
    });

    it('should return isBrownfield=false when fewer than 3 source files exist', async () => {
      await createSourceFiles(projectPath, 2);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should return isBrownfield=false for empty directory', async () => {
      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(0);
    });

    it('should ignore config files', async () => {
      await createConfigFiles(projectPath, 10);
      await createSourceFiles(projectPath, 2);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2); // Only source files counted
    });

    it('should ignore dotfiles', async () => {
      await createSourceFiles(projectPath, 2);
      await fs.writeFile(path.join(projectPath, '.hidden.ts'), '// dotfile');
      await fs.writeFile(path.join(projectPath, '.eslintrc.js'), 'module.exports = {}');

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2); // Dotfiles not counted
    });

    it('should skip node_modules directory', async () => {
      await createSourceFiles(projectPath, 2);
      const nodeModulesPath = path.join(projectPath, 'node_modules');
      await createSourceFiles(nodeModulesPath, 100);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should skip .git directory', async () => {
      await createSourceFiles(projectPath, 2);
      const gitPath = path.join(projectPath, '.git');
      await createSourceFiles(gitPath, 50);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should skip dist directory', async () => {
      await createSourceFiles(projectPath, 2);
      const distPath = path.join(projectPath, 'dist');
      await createSourceFiles(distPath, 50);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should skip build directory', async () => {
      await createSourceFiles(projectPath, 2);
      const buildPath = path.join(projectPath, 'build');
      await createSourceFiles(buildPath, 50);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should skip .olympus directory', async () => {
      await createSourceFiles(projectPath, 2);
      const olympusPath = path.join(projectPath, '.olympus');
      await createSourceFiles(olympusPath, 50);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should skip aidlc-docs directory', async () => {
      await createSourceFiles(projectPath, 2);
      const aidlcPath = path.join(projectPath, 'aidlc-docs');
      await createSourceFiles(aidlcPath, 50);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(false);
      expect(result.sourceFileCount).toBe(2);
    });

    it('should count files recursively in subdirectories', async () => {
      await createSourceFiles(projectPath, 1);
      const srcPath = path.join(projectPath, 'src');
      await createSourceFiles(srcPath, 2);
      const featuresPath = path.join(srcPath, 'features');
      await createSourceFiles(featuresPath, 3);

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(true);
      expect(result.sourceFileCount).toBe(6); // 1 + 2 + 3
    });

    it('should count different source file extensions', async () => {
      await createSourceFiles(projectPath, 2, '.ts');
      await createSourceFiles(projectPath, 1, '.py');
      await createSourceFiles(projectPath, 1, '.go');

      const result = await detectBrownfield(projectPath);

      expect(result.isBrownfield).toBe(true);
      expect(result.sourceFileCount).toBe(4);
    });

    it('should return accurate sourceFileCount', async () => {
      await createSourceFiles(projectPath, 15);

      const result = await detectBrownfield(projectPath);

      expect(result.sourceFileCount).toBe(15);
    });
  });

  describe('shouldRunDiscovery', () => {
    it('should return false when greenfieldFlag is true', async () => {
      await createSourceFiles(projectPath, 10); // Even with source files

      const result = await shouldRunDiscovery({
        projectPath,
        greenfieldFlag: true,
      });

      expect(result).toBe(false);
    });

    it('should return false when depthLevel is shallow', async () => {
      await createSourceFiles(projectPath, 10); // Even with source files

      const result = await shouldRunDiscovery({
        projectPath,
        depthLevel: 'shallow',
      });

      expect(result).toBe(false);
    });

    it('should return true when brownfieldFlag is true', async () => {
      // Even with no source files
      const result = await shouldRunDiscovery({
        projectPath,
        brownfieldFlag: true,
      });

      expect(result).toBe(true);
    });

    it('should return true when auto-detection finds 3+ source files', async () => {
      await createSourceFiles(projectPath, 5);

      const result = await shouldRunDiscovery({
        projectPath,
      });

      expect(result).toBe(true);
    });

    it('should return false when auto-detection finds <3 source files', async () => {
      await createSourceFiles(projectPath, 2);

      const result = await shouldRunDiscovery({
        projectPath,
      });

      expect(result).toBe(false);
    });

    it('should honor brownfieldFlag over auto-detection', async () => {
      await createSourceFiles(projectPath, 1); // <3 files

      const result = await shouldRunDiscovery({
        projectPath,
        brownfieldFlag: true,
      });

      expect(result).toBe(true);
    });

    it('should honor greenfieldFlag over brownfieldFlag', async () => {
      // Greenfield takes precedence
      const result = await shouldRunDiscovery({
        projectPath,
        greenfieldFlag: true,
        brownfieldFlag: true,
      });

      expect(result).toBe(false);
    });

    it('should honor depthLevel shallow over brownfieldFlag', async () => {
      const result = await shouldRunDiscovery({
        projectPath,
        depthLevel: 'shallow',
        brownfieldFlag: true,
      });

      expect(result).toBe(false);
    });

    it('should allow discovery with medium depth', async () => {
      await createSourceFiles(projectPath, 5);

      const result = await shouldRunDiscovery({
        projectPath,
        depthLevel: 'medium',
      });

      expect(result).toBe(true);
    });

    it('should allow discovery with deep depth', async () => {
      await createSourceFiles(projectPath, 5);

      const result = await shouldRunDiscovery({
        projectPath,
        depthLevel: 'deep',
      });

      expect(result).toBe(true);
    });
  });

  describe('getDiscoveryTemplate', () => {
    it('should return non-empty string for analysis-plan', () => {
      const template = getDiscoveryTemplate('analysis-plan', 'Test Feature');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
    });

    it('should return non-empty string for current-state-analysis', () => {
      const template = getDiscoveryTemplate('current-state-analysis', 'Test Feature');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
    });

    it('should return non-empty string for regression-baseline', () => {
      const template = getDiscoveryTemplate('regression-baseline', 'Test Feature');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
    });

    it('should return non-empty string for change-impact', () => {
      const template = getDiscoveryTemplate('change-impact', 'Test Feature');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
    });

    it('should return non-empty string for static-model', () => {
      const template = getDiscoveryTemplate('static-model', 'Test Feature');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
    });

    it('should return non-empty string for dynamic-model', () => {
      const template = getDiscoveryTemplate('dynamic-model', 'Test Feature');

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template.length).toBeGreaterThan(0);
    });

    it('should include feature name in all templates', () => {
      const featureName = 'User Authentication System';

      for (const artifactType of DISCOVERY_ARTIFACTS) {
        if (artifactType === 'workspace-scan') continue;
        const template = getDiscoveryTemplate(artifactType, featureName);
        expect(template).toContain(featureName);
      }
    });

    it('should start with markdown heading for all templates', () => {
      for (const artifactType of DISCOVERY_ARTIFACTS) {
        if (artifactType === 'workspace-scan') continue;
        const template = getDiscoveryTemplate(artifactType, 'Test Feature');
        expect(template.trimStart().startsWith('#')).toBe(true);
      }
    });
  });

  describe('executeDiscoveryPhase', () => {
    it('should create 6 discovery artifact files', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result.completed).toBe(false);
      expect(result.gateRequired).toBe(true);
      expect(result.artifactsGenerated.length).toBe(6);

      // Verify all artifacts exist on disk
      for (const artifactPath of result.artifactsGenerated) {
        const exists = await fs.pathExists(artifactPath);
        expect(exists).toBe(true);
      }
    });

    it('should create artifacts in aidlc-docs/discovery/', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      for (const artifactPath of result.artifactsGenerated) {
        expect(artifactPath).toContain('aidlc-docs');
        expect(artifactPath).toContain('discovery');
      }
    });

    it('should populate artifacts with template content', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'My Cool Feature',
        manifestPath,
      });

      // Check first artifact has template content
      const firstArtifactPath = result.artifactsGenerated[0];
      const content = await fs.readFile(firstArtifactPath, 'utf-8');

      expect(content).toContain('My Cool Feature');
      expect(content.length).toBeGreaterThan(0);
    });

    it('should register all 6 artifacts in manifest', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      const manifestContent = await fs.readJson(manifestPath);
      const discoveryArtifacts = manifestContent.artifacts.filter(
        (a: any) => a.phase === 'discovery'
      );

      expect(discoveryArtifacts.length).toBe(6);
    });

    it('should mark discovery phase as complete in manifest', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      const manifestContent = await fs.readJson(manifestPath);

      expect(manifestContent.phases.discovery.status).toBe('blocked');
    });

    it('should return correct sourceFileCount', async () => {
      await createSourceFiles(projectPath, 8);

      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      const result = await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      expect(result.sourceFileCount).toBe(8);
    });

    it('should update checkpoint to inception phase', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      const checkpointPath = path.join(projectPath, 'aidlc-docs', 'test-wf', 'checkpoint.json');
      const checkpointContent = await fs.readJson(checkpointPath);

      expect(checkpointContent.current_phase).toBe('discovery');
      expect(checkpointContent.phases.discovery.status).toBe('blocked');
    });

    it('should handle execution without errors', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      await expect(
        executeDiscoveryPhase({
          projectPath,
          workflowId: 'test-wf',
          featureName: 'Test Feature',
          manifestPath,
        })
      ).resolves.not.toThrow();
    });

    it('should create discovery directory if it does not exist', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);

      const discoveryPath = path.join(projectPath, 'aidlc-docs', 'test-wf', 'discovery');
      const existsBefore = await fs.pathExists(discoveryPath);
      expect(existsBefore).toBe(false);

      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      const existsAfter = await fs.pathExists(discoveryPath);
      expect(existsAfter).toBe(true);
    });
  });

  describe('approveDiscoveryGate', () => {
    it('should mark discovery phase as complete in manifest', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);
      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      await approveDiscoveryGate({
        projectPath,
        workflowId: 'test-wf',
        manifestPath,
      });

      const manifestContent = await fs.readJson(manifestPath);
      expect(manifestContent.phases.discovery.status).toBe('complete');
      expect(manifestContent.phases.discovery.completed_at).not.toBeNull();
    });

    it('should update checkpoint to inception phase', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);
      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      await approveDiscoveryGate({
        projectPath,
        workflowId: 'test-wf',
        manifestPath,
      });

      const checkpointPath = path.join(projectPath, 'aidlc-docs', 'test-wf', 'checkpoint.json');
      const checkpointContent = await fs.readJson(checkpointPath);
      expect(checkpointContent.current_phase).toBe('inception');
      expect(checkpointContent.phases.discovery.status).toBe('complete');
    });

    it('should record gate audit entry', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);
      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      await approveDiscoveryGate({
        projectPath,
        workflowId: 'test-wf',
        manifestPath,
        feedback: 'Looks good',
      });

      const manifestContent = await fs.readJson(manifestPath);
      const gateEntry = manifestContent.gate_audit.find(
        (e: any) => e.phase === 'discovery' && e.action === 'approved'
      );
      expect(gateEntry).toBeDefined();
      expect(gateEntry.actor).toBe('human');
      expect(gateEntry.reason).toBe('Looks good');
    });
  });

  describe('rejectDiscoveryGate', () => {
    it('should mark discovery phase as paused in manifest', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);
      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      await rejectDiscoveryGate({
        projectPath,
        workflowId: 'test-wf',
        manifestPath,
        feedback: 'Needs more analysis',
      });

      const manifestContent = await fs.readJson(manifestPath);
      expect(manifestContent.phases.discovery.status).toBe('paused');
    });

    it('should keep checkpoint in discovery phase', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);
      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      await rejectDiscoveryGate({
        projectPath,
        workflowId: 'test-wf',
        manifestPath,
      });

      const checkpointPath = path.join(projectPath, 'aidlc-docs', 'test-wf', 'checkpoint.json');
      const checkpointContent = await fs.readJson(checkpointPath);
      expect(checkpointContent.current_phase).toBe('discovery');
      expect(checkpointContent.phases.discovery.status).toBe('paused');
    });

    it('should record rejection gate audit entry', async () => {
      const manifestPath = createManifest('test-wf', 'Test Feature', projectPath);
      await createTestCheckpoint(manifestPath);
      await executeDiscoveryPhase({
        projectPath,
        workflowId: 'test-wf',
        featureName: 'Test Feature',
        manifestPath,
      });

      await rejectDiscoveryGate({
        projectPath,
        workflowId: 'test-wf',
        manifestPath,
        feedback: 'Needs more analysis',
      });

      const manifestContent = await fs.readJson(manifestPath);
      const gateEntry = manifestContent.gate_audit.find(
        (e: any) => e.phase === 'discovery' && e.action === 'rejected'
      );
      expect(gateEntry).toBeDefined();
      expect(gateEntry.actor).toBe('human');
      expect(gateEntry.reason).toBe('Needs more analysis');
    });
  });
});
