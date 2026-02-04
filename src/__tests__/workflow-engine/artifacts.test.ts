import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import {
  ensureWorkflowDir,
  getArtifactPath,
  writeArtifact,
  readArtifact,
} from '../../features/workflow-engine/artifacts.js';
import { WorkflowStage } from '../../features/workflow-engine/types.js';

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

      const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);
      const intentsDir = path.join(workflowDir, 'intents');
      const validationDir = path.join(workflowDir, 'validation');
      const checkpointPath = path.join(workflowDir, 'checkpoint.json');

      expect(await fs.pathExists(workflowDir)).toBe(true);
      expect(await fs.pathExists(intentsDir)).toBe(true);
      expect(await fs.pathExists(validationDir)).toBe(true);
      expect(await fs.pathExists(checkpointPath)).toBe(true);

      // Verify checkpoint.json structure
      const checkpoint = await fs.readJson(checkpointPath);
      expect(checkpoint).toMatchObject({
        workflowId,
        currentStage: 'idea',
      });
      expect(checkpoint.createdAt).toBeDefined();
      expect(checkpoint.updatedAt).toBeDefined();
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      // Call ensureWorkflowDir twice
      await ensureWorkflowDir(projectPath, workflowId);

      const checkpointPath = path.join(projectPath, '.olympus', 'workflow', workflowId, 'checkpoint.json');
      const firstCheckpoint = await fs.readJson(checkpointPath);

      // Wait a bit to ensure timestamp would differ if file was rewritten
      await new Promise(resolve => setTimeout(resolve, 10));

      await ensureWorkflowDir(projectPath, workflowId);
      const secondCheckpoint = await fs.readJson(checkpointPath);

      // Checkpoint should not have been overwritten
      expect(secondCheckpoint).toEqual(firstCheckpoint);
    });
  });

  describe('getArtifactPath', () => {
    it('should return correct path for idea stage', () => {
      const expected = path.join(projectPath, '.olympus', 'workflow', workflowId, 'idea.md');
      expect(getArtifactPath(projectPath, workflowId, 'idea')).toBe(expected);
    });

    it('should return correct path for prd stage', () => {
      const expected = path.join(projectPath, '.olympus', 'workflow', workflowId, 'prd.md');
      expect(getArtifactPath(projectPath, workflowId, 'prd')).toBe(expected);
    });

    it('should return correct path for spec stage', () => {
      const expected = path.join(projectPath, '.olympus', 'workflow', workflowId, 'spec.md');
      expect(getArtifactPath(projectPath, workflowId, 'spec')).toBe(expected);
    });

    it('should throw error for complete stage', () => {
      expect(() => getArtifactPath(projectPath, workflowId, 'complete')).toThrow(
        'No artifact file for complete stage'
      );
    });

    it('should throw error for intents stage', () => {
      expect(() => getArtifactPath(projectPath, workflowId, 'intents')).toThrow(
        'Intents is a directory'
      );
    });

    it('should handle cross-platform paths correctly', () => {
      // Test that path.join produces correct separators for the platform
      const artifactPath = getArtifactPath(projectPath, workflowId, 'idea');

      // Path should contain platform-specific separators
      expect(artifactPath).toContain('.olympus');
      expect(artifactPath).toContain('workflow');
      expect(artifactPath).toContain(workflowId);
      expect(artifactPath).toContain('idea.md');

      // Verify it's a valid path (no mixing of separators)
      const normalized = path.normalize(artifactPath);
      expect(artifactPath).toBe(normalized);
    });
  });

  describe('writeArtifact', () => {
    it('should write artifact content correctly', async () => {
      const content = '# Test Idea\n\nThis is a test idea document.';

      await writeArtifact(projectPath, workflowId, 'idea', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'idea');
      const savedContent = await fs.readFile(artifactPath, 'utf-8');

      expect(savedContent).toBe(content);
    });

    it('should create parent directories if needed', async () => {
      // Don't call ensureWorkflowDir first
      const content = '# PRD Document';

      await writeArtifact(projectPath, workflowId, 'prd', content);

      const artifactPath = getArtifactPath(projectPath, workflowId, 'prd');
      expect(await fs.pathExists(artifactPath)).toBe(true);

      const savedContent = await fs.readFile(artifactPath, 'utf-8');
      expect(savedContent).toBe(content);
    });

    it('should throw error for intents stage', async () => {
      await expect(
        writeArtifact(projectPath, workflowId, 'intents', 'content')
      ).rejects.toThrow('Cannot write single artifact for intents stage');
    });

    it('should throw error for complete stage', async () => {
      await expect(
        writeArtifact(projectPath, workflowId, 'complete', 'content')
      ).rejects.toThrow('No artifact file for complete stage');
    });

    it('should overwrite existing artifact', async () => {
      await writeArtifact(projectPath, workflowId, 'spec', 'First version');
      await writeArtifact(projectPath, workflowId, 'spec', 'Second version');

      const content = await readArtifact(projectPath, workflowId, 'spec');
      expect(content).toBe('Second version');
    });
  });

  describe('readArtifact', () => {
    it('should read artifact content correctly', async () => {
      const content = '# Specification\n\nDetailed spec here.';
      await writeArtifact(projectPath, workflowId, 'spec', content);

      const readContent = await readArtifact(projectPath, workflowId, 'spec');
      expect(readContent).toBe(content);
    });

    it('should return null for missing file', async () => {
      const content = await readArtifact(projectPath, workflowId, 'idea');
      expect(content).toBeNull();
    });

    it('should throw error for intents stage', async () => {
      await expect(
        readArtifact(projectPath, workflowId, 'intents')
      ).rejects.toThrow('Cannot read single artifact for intents stage');
    });

    it('should throw error for complete stage', async () => {
      await expect(
        readArtifact(projectPath, workflowId, 'complete')
      ).rejects.toThrow('No artifact file for complete stage');
    });

    it('should handle UTF-8 content correctly', async () => {
      const content = '# Unicode Test\n\n✅ Checkmark\n🚀 Rocket\n日本語 Japanese';
      await writeArtifact(projectPath, workflowId, 'prd', content);

      const readContent = await readArtifact(projectPath, workflowId, 'prd');
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
      expect(artifactPath).toContain(workflowId);

      // Path should be normalized for the platform
      const normalized = path.normalize(artifactPath);
      expect(artifactPath).toBe(normalized);
    });

    it('should handle Unix-style paths correctly', async () => {
      const unixStylePath = '/home/user/project';
      const artifactPath = getArtifactPath(unixStylePath, workflowId, 'prd');

      expect(artifactPath).toContain('prd.md');
      expect(artifactPath).toContain(workflowId);

      const normalized = path.normalize(artifactPath);
      expect(artifactPath).toBe(normalized);
    });

    it('should write and read across different path styles', async () => {
      // Use current tmpDir which works on any platform
      const content = 'Cross-platform test content';

      await writeArtifact(projectPath, workflowId, 'spec', content);
      const readContent = await readArtifact(projectPath, workflowId, 'spec');

      expect(readContent).toBe(content);
    });
  });
});
