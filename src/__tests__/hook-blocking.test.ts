/**
 * Integration Tests for Hook Blocking System
 *
 * Tests the complete flow: session state tracking, hook blocking logic,
 * and violation logging.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionState } from '../features/session-state/index.js';
import {
  processOrchestratorPreTool,
  isAllowedPath,
  isTestFile,
  calculateLinesChanged,
} from '../hooks/olympus-orchestrator/index.js';

describe('Hook Blocking Integration', () => {
  describe('Path Filtering', () => {
    describe('isAllowedPath', () => {
      it('should allow .olympus/ paths', () => {
        expect(isAllowedPath('.olympus/plans/test.md')).toBe(true);
        expect(isAllowedPath('.olympus/logs/violations.jsonl')).toBe(true);
        expect(isAllowedPath('C:\\Users\\project\\.olympus\\file.txt')).toBe(true);
      });

      it('should block non-.olympus/ paths', () => {
        expect(isAllowedPath('src/index.ts')).toBe(false);
        expect(isAllowedPath('package.json')).toBe(false);
        expect(isAllowedPath('README.md')).toBe(false);
      });

      it('should allow empty paths', () => {
        expect(isAllowedPath('')).toBe(true);
        expect(isAllowedPath(undefined as any)).toBe(true);
      });
    });

    describe('isTestFile', () => {
      it('should recognize test files', () => {
        expect(isTestFile('src/index.test.ts')).toBe(true);
        expect(isTestFile('src/utils.spec.ts')).toBe(true);
        expect(isTestFile('src/__tests__/integration.ts')).toBe(true);
        expect(isTestFile('tests/unit.test.js')).toBe(true);
      });

      it('should not recognize non-test files', () => {
        expect(isTestFile('src/index.ts')).toBe(false);
        expect(isTestFile('src/utils.ts')).toBe(false);
        expect(isTestFile('package.json')).toBe(false);
      });

      it('should handle Windows paths', () => {
        expect(isTestFile('src\\__tests__\\file.ts')).toBe(true);
        expect(isTestFile('C:\\project\\src\\test.spec.ts')).toBe(true);
      });

      it('should handle empty paths', () => {
        expect(isTestFile('')).toBe(false);
        expect(isTestFile(undefined as any)).toBe(false);
      });
    });
  });

  describe('calculateLinesChanged', () => {
    it('should calculate lines for Edit tool', () => {
      const toolInput = {
        old_string: 'line1\nline2\nline3',
        new_string: 'line1\nline2\nline3\nline4\nline5',
      };

      const lines = calculateLinesChanged('Edit', toolInput);
      expect(lines).toBe(2); // |5 - 3| = 2
    });

    it('should calculate lines for Write tool', () => {
      const toolInput = {
        content: 'line1\nline2\nline3\nline4\nline5',
      };

      const lines = calculateLinesChanged('Write', toolInput);
      expect(lines).toBe(5);
    });

    it('should handle empty input', () => {
      expect(calculateLinesChanged('Edit', {})).toBe(0);
      expect(calculateLinesChanged('Write', {})).toBe(0);
      expect(calculateLinesChanged('Edit', undefined)).toBe(0);
    });

    it('should handle single line', () => {
      const toolInput = {
        old_string: 'line1',
        new_string: 'line1\nline2',
      };

      const lines = calculateLinesChanged('Edit', toolInput);
      expect(lines).toBe(1);
    });
  });

  describe('Verification Edit Detection', () => {
    let sessionState: SessionState;

    beforeEach(() => {
      sessionState = new SessionState();
    });

    it('should allow small edits on recent task files', () => {
      // Record a task that modified files
      sessionState.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['src/index.ts', 'src/utils.ts'],
        taskId: 'task-1',
      });

      // Small edit should be allowed
      expect(sessionState.isVerificationEdit('src/index.ts', 5)).toBe(true);
      expect(sessionState.isVerificationEdit('src/utils.ts', 9)).toBe(true);
    });

    it('should block large edits on recent task files', () => {
      sessionState.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['src/index.ts'],
        taskId: 'task-1',
      });

      // Large edit should be blocked
      expect(sessionState.isVerificationEdit('src/index.ts', 10)).toBe(false);
      expect(sessionState.isVerificationEdit('src/index.ts', 50)).toBe(false);
    });

    it('should block edits on non-recent files', () => {
      sessionState.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['src/index.ts'],
        taskId: 'task-1',
      });

      // Edit on different file should be blocked
      expect(sessionState.isVerificationEdit('src/other.ts', 5)).toBe(false);
    });

    it('should track files across multiple tasks', () => {
      sessionState.recordTaskCompletion({
        timestamp: 1,
        filesModified: ['file1.ts'],
        taskId: 'task-1',
      });

      sessionState.recordTaskCompletion({
        timestamp: 2,
        filesModified: ['file2.ts'],
        taskId: 'task-2',
      });

      sessionState.recordTaskCompletion({
        timestamp: 3,
        filesModified: ['file3.ts'],
        taskId: 'task-3',
      });

      // All files from last 3 tasks should be tracked
      expect(sessionState.isVerificationEdit('file1.ts', 5)).toBe(true);
      expect(sessionState.isVerificationEdit('file2.ts', 5)).toBe(true);
      expect(sessionState.isVerificationEdit('file3.ts', 5)).toBe(true);
    });

    it('should evict files from old tasks', () => {
      // Record 4 tasks, pushing the first one out
      sessionState.recordTaskCompletion({
        timestamp: 1,
        filesModified: ['old-file.ts'],
        taskId: 'task-1',
      });

      sessionState.recordTaskCompletion({
        timestamp: 2,
        filesModified: ['file2.ts'],
        taskId: 'task-2',
      });

      sessionState.recordTaskCompletion({
        timestamp: 3,
        filesModified: ['file3.ts'],
        taskId: 'task-3',
      });

      sessionState.recordTaskCompletion({
        timestamp: 4,
        filesModified: ['file4.ts'],
        taskId: 'task-4',
      });

      // Old file should no longer be tracked
      expect(sessionState.isVerificationEdit('old-file.ts', 5)).toBe(false);

      // New files should be tracked
      expect(sessionState.isVerificationEdit('file2.ts', 5)).toBe(true);
      expect(sessionState.isVerificationEdit('file3.ts', 5)).toBe(true);
      expect(sessionState.isVerificationEdit('file4.ts', 5)).toBe(true);
    });
  });

  describe('Hard Blocking Scenarios', () => {
    it('should allow .olympus/ path edits', () => {
      const result = processOrchestratorPreTool({
        toolName: 'Edit',
        toolInput: {
          filePath: '.olympus/plans/test.md',
          old_string: 'old',
          new_string: 'new',
        },
      });

      expect(result.continue).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('should allow test file creation', () => {
      const result = processOrchestratorPreTool({
        toolName: 'Write',
        toolInput: {
          filePath: 'src/__tests__/new-test.test.ts',
          content: 'test content',
        },
      });

      expect(result.continue).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('should block direct source file edits', () => {
      const result = processOrchestratorPreTool({
        toolName: 'Edit',
        toolInput: {
          filePath: 'src/index.ts',
          old_string: 'old code',
          new_string: 'new code',
        },
      });

      expect(result.continue).toBe(false);
      expect(result.message).toContain('HARD BLOCK');
      expect(result.message).toContain('DELEGATION REQUIRED');
    });

    it('should block Write tool on source files', () => {
      const result = processOrchestratorPreTool({
        toolName: 'Write',
        toolInput: {
          filePath: 'src/new-file.ts',
          content: 'new file content',
        },
      });

      expect(result.continue).toBe(false);
      expect(result.message).toContain('HARD BLOCK');
    });

    it('should allow non-write/edit tools', () => {
      const result = processOrchestratorPreTool({
        toolName: 'Read',
        toolInput: {
          filePath: 'src/index.ts',
        },
      });

      expect(result.continue).toBe(true);
      expect(result.message).toBeUndefined();
    });

    it('should handle missing file path', () => {
      const result = processOrchestratorPreTool({
        toolName: 'Edit',
        toolInput: {},
      });

      expect(result.continue).toBe(true);
      expect(result.message).toBeUndefined();
    });
  });

  describe('Complete Flow', () => {
    it('should block, then allow verification edit after task completion', () => {
      const sessionState = new SessionState();

      // Initial edit attempt should be blocked
      let result = processOrchestratorPreTool({
        toolName: 'Edit',
        toolInput: {
          filePath: 'src/index.ts',
          old_string: 'old',
          new_string: 'new code\nmore code',
        },
      });

      expect(result.continue).toBe(false);

      // Record task completion that modified the file
      sessionState.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['src/index.ts'],
        taskId: 'task-1',
      });

      // Small verification edit should be allowed
      expect(sessionState.isVerificationEdit('src/index.ts', 3)).toBe(true);
    });

    it('should maintain session state across multiple tasks', () => {
      const sessionState = new SessionState();

      // Complete task 1
      sessionState.recordTaskCompletion({
        timestamp: 1,
        filesModified: ['src/components.ts'],
        taskId: 'task-1',
      });

      // Complete task 2
      sessionState.recordTaskCompletion({
        timestamp: 2,
        filesModified: ['src/hooks.ts'],
        taskId: 'task-2',
      });

      // Both files should allow verification edits
      expect(sessionState.isVerificationEdit('src/components.ts', 5)).toBe(true);
      expect(sessionState.isVerificationEdit('src/hooks.ts', 5)).toBe(true);

      // Unrelated file should still be blocked
      expect(sessionState.isVerificationEdit('src/other.ts', 5)).toBe(false);
    });
  });
});
