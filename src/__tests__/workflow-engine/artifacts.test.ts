import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import {
  ensureWorkflowDir,
  getArtifactPath,
  writeArtifact,
  readArtifact,
  ensureDiscoveryDir,
  writeStateFile,
  appendAuditEntry,
  ArtifactType,
} from '../../features/workflow-engine/artifacts.js';

describe('artifacts', () => {
  let tmpDir: string;
  let projectPath: string;
  const workflowId = 'test-workflow-123';

  beforeEach(async () => {
    // Create unique temporary directory for each test
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-artifacts-test-'));
    projectPath = tmpDir;
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.remove(tmpDir);
  });

  describe('ensureWorkflowDir', () => {
    it('should create full workflow directory structure', async () => {
      await ensureWorkflowDir(projectPath, workflowId);

      const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
      const inceptionDir = path.join(workflowDir, 'inception');
      const constructionDir = path.join(workflowDir, 'construction');
      const constructionDesignDir = path.join(workflowDir, 'construction', 'design');
      const operationsDir = path.join(workflowDir, 'operations');
      const checkpointPath = path.join(workflowDir, 'checkpoint.json');

      expect(await fs.pathExists(workflowDir)).toBe(true);
      expect(await fs.pathExists(inceptionDir)).toBe(true);
      expect(await fs.pathExists(constructionDir)).toBe(true);
      expect(await fs.pathExists(constructionDesignDir)).toBe(true);
      expect(await fs.pathExists(operationsDir)).toBe(true);
      expect(await fs.pathExists(checkpointPath)).toBe(true);

      // Verify checkpoint.json structure
      const checkpoint = await fs.readJson(checkpointPath);
      expect(checkpoint).toMatchObject({
        workflow_id: workflowId,
        current_stage: 'idea',
      });
      expect(checkpoint.created_at).toBeDefined();
      expect(checkpoint.updated_at).toBeDefined();
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      // Call ensureWorkflowDir twice
      await ensureWorkflowDir(projectPath, workflowId);

      const checkpointPath = path.join(projectPath, 'aidlc-docs', workflowId, 'checkpoint.json');
      const firstCheckpoint = await fs.readJson(checkpointPath);

      // Wait a bit to ensure timestamp would differ if file was rewritten
      await new Promise(resolve => setTimeout(resolve, 10));

      await ensureWorkflowDir(projectPath, workflowId);
      const secondCheckpoint = await fs.readJson(checkpointPath);

      // Checkpoint should not have been overwritten
      expect(secondCheckpoint).toEqual(firstCheckpoint);
    });

    it('should not create old directory structure', async () => {
      await ensureWorkflowDir(projectPath, workflowId);

      const workflowDir = path.join(projectPath, 'aidlc-docs', workflowId);
      const intentsDir = path.join(workflowDir, 'intents');
      const validationDir = path.join(workflowDir, 'validation');

      // Old directories should NOT exist
      expect(await fs.pathExists(intentsDir)).toBe(false);
      expect(await fs.pathExists(validationDir)).toBe(false);
    });
  });

  describe('getArtifactPath', () => {
    it('should return correct path for idea artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'idea.md');
      expect(getArtifactPath(projectPath, workflowId, 'idea')).toBe(expected);
    });

    it('should return correct path for intent artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'intent.md');
      expect(getArtifactPath(projectPath, workflowId, 'intent')).toBe(expected);
    });

    it('should return correct path for unit artifact with ID', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'UNIT-001', 'spec.md');
      expect(getArtifactPath(projectPath, workflowId, 'unit', 'UNIT-001')).toBe(expected);
    });

    it('should throw error for unit artifact without ID', () => {
      expect(() => getArtifactPath(projectPath, workflowId, 'unit')).toThrow(
        'artifactId is required for unit artifacts'
      );
    });

    it('should return correct path for bolt artifact with ID and unitId', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'UNIT-001', 'BOLT-001.md');
      expect(getArtifactPath(projectPath, workflowId, 'bolt', 'BOLT-001', 'UNIT-001')).toBe(expected);
    });

    it('should throw error for bolt artifact without ID', () => {
      expect(() => getArtifactPath(projectPath, workflowId, 'bolt')).toThrow(
        'artifactId is required for bolt artifacts'
      );
    });

    it('should throw error for bolt artifact without unitId', () => {
      expect(() => getArtifactPath(projectPath, workflowId, 'bolt', 'BOLT-001')).toThrow(
        'unitId is required for bolt artifacts'
      );
    });

    it('should return correct path for nfr artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'inception', 'nfr.md');
      expect(getArtifactPath(projectPath, workflowId, 'nfr')).toBe(expected);
    });

    it('should return correct path for validation-report artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'UNIT-001', 'validation-report.md');
      expect(getArtifactPath(projectPath, workflowId, 'validation-report', 'UNIT-001')).toBe(expected);
    });

    it('should return correct path for state artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'state.md');
      expect(getArtifactPath(projectPath, workflowId, 'state')).toBe(expected);
    });

    it('should return correct path for audit artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'audit.md');
      expect(getArtifactPath(projectPath, workflowId, 'audit')).toBe(expected);
    });

    it('should return correct path for interfaces artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'design', 'interfaces.json');
      expect(getArtifactPath(projectPath, workflowId, 'interfaces')).toBe(expected);
    });

    it('should return correct path for data-flow artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'design', 'data-flow.json');
      expect(getArtifactPath(projectPath, workflowId, 'data-flow')).toBe(expected);
    });

    it('should return correct path for components artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'design', 'components.json');
      expect(getArtifactPath(projectPath, workflowId, 'components')).toBe(expected);
    });

    it('should return correct path for deploy-guide artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'operations', 'deploy-guide.md');
      expect(getArtifactPath(projectPath, workflowId, 'deploy-guide')).toBe(expected);
    });

    it('should return correct path for runbook artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'operations', 'runbook.md');
      expect(getArtifactPath(projectPath, workflowId, 'runbook')).toBe(expected);
    });

    it('should return correct path for monitoring artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'operations', 'monitoring.json');
      expect(getArtifactPath(projectPath, workflowId, 'monitoring')).toBe(expected);
    });

    it('should return correct path for release-notes artifact', () => {
      const expected = path.join(projectPath, 'aidlc-docs', workflowId, 'operations', 'release-notes.md');
      expect(getArtifactPath(projectPath, workflowId, 'release-notes')).toBe(expected);
    });

    it('should handle cross-platform paths correctly', () => {
      // Test that path.join produces correct separators for the platform
      const artifactPath = getArtifactPath(projectPath, workflowId, 'idea');

      // Path should contain platform-specific separators
      expect(artifactPath).toContain('aidlc-docs');
      expect(artifactPath).toContain('inception');
      expect(artifactPath).toContain('idea.md');

      // Verify it's a valid path (no mixing of separators)
      const normalized = path.normalize(artifactPath);
      expect(artifactPath).toBe(normalized);
    });
  });

  describe('writeArtifact', () => {
    it('should write idea artifact content correctly', async () => {
      const content = '# Test Idea\n\nThis is a test idea document.';

      await writeArtifact(projectPath, workflowId, 'idea', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'idea');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should write intent artifact content correctly', async () => {
      const content = '# Intent\n\nThis is the intent document.';

      await writeArtifact(projectPath, workflowId, 'intent', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'intent');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should write unit artifact with ID', async () => {
      const content = '# Unit UNIT-001\n\nUnit implementation details.';

      await writeArtifact(projectPath, workflowId, 'unit', content, 'UNIT-001');

      const artifactPath = getArtifactPath(projectPath, workflowId, 'unit', 'UNIT-001');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should write bolt artifact with ID and unitId', async () => {
      const content = '# Bolt BOLT-001\n\nBolt execution plan.';

      await writeArtifact(projectPath, workflowId, 'bolt', content, 'BOLT-001', 'UNIT-001');

      const artifactPath = getArtifactPath(projectPath, workflowId, 'bolt', 'BOLT-001', 'UNIT-001');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should write design artifacts', async () => {
      const content = JSON.stringify({ interfaces: [] }, null, 2);

      await writeArtifact(projectPath, workflowId, 'interfaces', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'interfaces');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should write operations artifacts', async () => {
      const content = '# Deploy Guide\n\nDeployment instructions.';

      await writeArtifact(projectPath, workflowId, 'deploy-guide', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'deploy-guide');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should create parent directories if needed', async () => {
      // Don't call ensureWorkflowDir first
      const content = '# Intent Document';

      await writeArtifact(projectPath, workflowId, 'intent', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'intent');
      expect(await fs.pathExists(artifactPath)).toBe(true);

      const savedContent = await fs.readFile(artifactPath, 'utf-8');
      expect(savedContent).toBe(content);
    });

    it('should overwrite existing artifact', async () => {
      await writeArtifact(projectPath, workflowId, 'idea', 'First version');
      await writeArtifact(projectPath, workflowId, 'idea', 'Second version');

      const content = await readArtifact(projectPath, workflowId, 'idea');
      expect(content).toBe('Second version');
    });
  });

  describe('readArtifact', () => {
    it('should read idea artifact content correctly', async () => {
      const content = '# Idea\n\nDetailed idea here.';
      await writeArtifact(projectPath, workflowId, 'idea', content);

      const readContent = await readArtifact(projectPath, workflowId, 'idea');
      expect(readContent).toBe(content);
    });

    it('should read intent artifact content correctly', async () => {
      const content = '# Intent\n\nDetailed intent here.';
      await writeArtifact(projectPath, workflowId, 'intent', content);

      const readContent = await readArtifact(projectPath, workflowId, 'intent');
      expect(readContent).toBe(content);
    });

    it('should read unit artifact with ID', async () => {
      const content = '# Unit UNIT-001\n\nUnit details.';
      await writeArtifact(projectPath, workflowId, 'unit', content, 'UNIT-001');

      const readContent = await readArtifact(projectPath, workflowId, 'unit', 'UNIT-001');
      expect(readContent).toBe(content);
    });

    it('should read bolt artifact with ID and unitId', async () => {
      const content = '# Bolt BOLT-001\n\nBolt details.';
      await writeArtifact(projectPath, workflowId, 'bolt', content, 'BOLT-001', 'UNIT-001');

      const readContent = await readArtifact(projectPath, workflowId, 'bolt', 'BOLT-001', 'UNIT-001');
      expect(readContent).toBe(content);
    });

    it('should return null for missing file', async () => {
      const content = await readArtifact(projectPath, workflowId, 'idea');
      expect(content).toBeNull();
    });

    it('should return null for missing unit with ID', async () => {
      const content = await readArtifact(projectPath, workflowId, 'unit', 'UNIT-999');
      expect(content).toBeNull();
    });

    it('should handle UTF-8 content correctly', async () => {
      const content = '# Unicode Test\n\n✅ Checkmark\n🚀 Rocket\n日本語 Japanese';
      await writeArtifact(projectPath, workflowId, 'intent', content);

      const readContent = await readArtifact(projectPath, workflowId, 'intent');
      expect(readContent).toBe(content);
    });
  });

  describe('cross-platform path handling', () => {
    it('should handle Windows-style paths correctly', async () => {
      // Create a Windows-style path (even on Unix, path.join should normalize it)
      const windowsStylePath = 'C:\\Users\\Test\\Project';
      const artifactPath = getArtifactPath(windowsStylePath, workflowId, 'idea');

      // Verify path components are present
      expect(artifactPath).toContain('idea.md');
      expect(artifactPath).toContain('inception');

      // Path should be normalized for the platform
      const normalized = path.normalize(artifactPath);
      expect(artifactPath).toBe(normalized);
    });

    it('should handle Unix-style paths correctly', async () => {
      const unixStylePath = '/home/user/project';
      const artifactPath = getArtifactPath(unixStylePath, workflowId, 'intent');

      expect(artifactPath).toContain('intent.md');
      expect(artifactPath).toContain('inception');

      const normalized = path.normalize(artifactPath);
      expect(artifactPath).toBe(normalized);
    });

    it('should write and read across different path styles', async () => {
      // Use current tmpDir which works on any platform
      const content = 'Cross-platform test content';

      await writeArtifact(projectPath, workflowId, 'idea', content);
      const readContent = await readArtifact(projectPath, workflowId, 'idea');

      expect(readContent).toBe(content);
    });
  });

  describe('ensureDiscoveryDir', () => {
    it('should create discovery directory', async () => {
      await ensureDiscoveryDir(projectPath, workflowId);

      const discoveryDir = path.join(projectPath, 'aidlc-docs', workflowId, 'discovery');
      expect(await fs.pathExists(discoveryDir)).toBe(true);
    });

    it('should be idempotent', async () => {
      await ensureDiscoveryDir(projectPath, workflowId);
      await ensureDiscoveryDir(projectPath, workflowId);

      const discoveryDir = path.join(projectPath, 'aidlc-docs', workflowId, 'discovery');
      expect(await fs.pathExists(discoveryDir)).toBe(true);
    });
  });

  describe('writeStateFile', () => {
    it('should write state file to aidlc-docs/state.md', async () => {
      const content = '# State\n\nCurrent workflow state.';

      await writeStateFile(projectPath, workflowId, content);

      const statePath = path.join(projectPath, 'aidlc-docs', workflowId, 'state.md');
      const savedContent = await fs.readFile(statePath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should overwrite existing state file', async () => {
      await writeStateFile(projectPath, workflowId, 'First state');
      await writeStateFile(projectPath, workflowId, 'Second state');

      const statePath = path.join(projectPath, 'aidlc-docs', workflowId, 'state.md');
      const savedContent = await fs.readFile(statePath, 'utf-8');

      expect(savedContent).toBe('Second state');
    });
  });

  describe('appendAuditEntry', () => {
    it('should create audit.md with header on first call', async () => {
      await appendAuditEntry(projectPath, workflowId, 'First entry');

      const auditPath = path.join(projectPath, 'aidlc-docs', workflowId, 'audit.md');
      const content = await fs.readFile(auditPath, 'utf-8');

      expect(content).toContain('# Audit Log');
      expect(content).toContain('First entry');
    });

    it('should append entries without duplicating header', async () => {
      await appendAuditEntry(projectPath, workflowId, 'First entry');
      await appendAuditEntry(projectPath, workflowId, 'Second entry');

      const auditPath = path.join(projectPath, 'aidlc-docs', workflowId, 'audit.md');
      const content = await fs.readFile(auditPath, 'utf-8');

      expect(content).toContain('First entry');
      expect(content).toContain('Second entry');
      // Header should appear only once
      expect((content.match(/# Audit Log/g) || []).length).toBe(1);
    });

    it('should preserve existing entries when appending', async () => {
      await appendAuditEntry(projectPath, workflowId, 'Entry 1');
      await appendAuditEntry(projectPath, workflowId, 'Entry 2');
      await appendAuditEntry(projectPath, workflowId, 'Entry 3');

      const auditPath = path.join(projectPath, 'aidlc-docs', workflowId, 'audit.md');
      const content = await fs.readFile(auditPath, 'utf-8');

      expect(content).toContain('Entry 1');
      expect(content).toContain('Entry 2');
      expect(content).toContain('Entry 3');
    });
  });
});
