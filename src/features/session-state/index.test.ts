/**
 * Tests for Session State Tracking
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionState, TaskCompletion } from './index.js';

describe('SessionState', () => {
  let state: SessionState;

  beforeEach(() => {
    state = new SessionState();
  });

  describe('recordTaskCompletion', () => {
    it('should record a single task completion', () => {
      const completion: TaskCompletion = {
        timestamp: Date.now(),
        filesModified: ['src/index.ts'],
        taskId: 'task-1',
      };

      state.recordTaskCompletion(completion);

      expect(state.trackedCount).toBe(1);
      expect(state.getRecentTasks()).toEqual([completion]);
    });

    it('should record multiple task completions', () => {
      const completion1: TaskCompletion = {
        timestamp: Date.now(),
        filesModified: ['src/index.ts'],
        taskId: 'task-1',
      };

      const completion2: TaskCompletion = {
        timestamp: Date.now() + 1000,
        filesModified: ['src/utils.ts'],
        taskId: 'task-2',
      };

      state.recordTaskCompletion(completion1);
      state.recordTaskCompletion(completion2);

      expect(state.trackedCount).toBe(2);
      expect(state.getRecentTasks()).toEqual([completion2, completion1]);
    });

    it('should maintain maximum of 3 tasks', () => {
      const tasks: TaskCompletion[] = [
        { timestamp: 1, filesModified: ['file1.ts'], taskId: 'task-1' },
        { timestamp: 2, filesModified: ['file2.ts'], taskId: 'task-2' },
        { timestamp: 3, filesModified: ['file3.ts'], taskId: 'task-3' },
        { timestamp: 4, filesModified: ['file4.ts'], taskId: 'task-4' },
      ];

      for (const task of tasks) {
        state.recordTaskCompletion(task);
      }

      expect(state.trackedCount).toBe(3);
      const recent = state.getRecentTasks();
      expect(recent).toHaveLength(3);
      expect(recent[0].taskId).toBe('task-4'); // Most recent
      expect(recent[1].taskId).toBe('task-3');
      expect(recent[2].taskId).toBe('task-2');
      // task-1 should be evicted
    });

    it('should add new tasks to the front', () => {
      const task1: TaskCompletion = {
        timestamp: 1,
        filesModified: ['file1.ts'],
        taskId: 'task-1',
      };

      const task2: TaskCompletion = {
        timestamp: 2,
        filesModified: ['file2.ts'],
        taskId: 'task-2',
      };

      state.recordTaskCompletion(task1);
      state.recordTaskCompletion(task2);

      const recent = state.getRecentTasks();
      expect(recent[0]).toEqual(task2); // Most recent first
      expect(recent[1]).toEqual(task1);
    });
  });

  describe('isVerificationEdit', () => {
    beforeEach(() => {
      state.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['src/index.ts', 'src/utils.ts'],
        taskId: 'task-1',
      });
    });

    it('should return true for small edit on recent task file', () => {
      expect(state.isVerificationEdit('src/index.ts', 5)).toBe(true);
      expect(state.isVerificationEdit('src/utils.ts', 9)).toBe(true);
    });

    it('should return false for large edit on recent task file', () => {
      expect(state.isVerificationEdit('src/index.ts', 10)).toBe(false);
      expect(state.isVerificationEdit('src/index.ts', 100)).toBe(false);
    });

    it('should return false for small edit on non-recent file', () => {
      expect(state.isVerificationEdit('src/other.ts', 5)).toBe(false);
    });

    it('should return false for file not modified by any task', () => {
      expect(state.isVerificationEdit('new-file.ts', 3)).toBe(false);
    });

    it('should check across multiple recent tasks', () => {
      state.recordTaskCompletion({
        timestamp: Date.now() + 1000,
        filesModified: ['src/components.ts'],
        taskId: 'task-2',
      });

      state.recordTaskCompletion({
        timestamp: Date.now() + 2000,
        filesModified: ['src/hooks.ts'],
        taskId: 'task-3',
      });

      // All files from last 3 tasks should be considered
      expect(state.isVerificationEdit('src/hooks.ts', 5)).toBe(true);
      expect(state.isVerificationEdit('src/components.ts', 5)).toBe(true);
      expect(state.isVerificationEdit('src/index.ts', 5)).toBe(true);
    });

    it('should not consider files from evicted tasks', () => {
      // Add 3 more tasks, pushing task-1 out
      state.recordTaskCompletion({
        timestamp: Date.now() + 1000,
        filesModified: ['file2.ts'],
        taskId: 'task-2',
      });

      state.recordTaskCompletion({
        timestamp: Date.now() + 2000,
        filesModified: ['file3.ts'],
        taskId: 'task-3',
      });

      state.recordTaskCompletion({
        timestamp: Date.now() + 3000,
        filesModified: ['file4.ts'],
        taskId: 'task-4',
      });

      // Original files should no longer be considered
      expect(state.isVerificationEdit('src/index.ts', 5)).toBe(false);
      expect(state.isVerificationEdit('src/utils.ts', 5)).toBe(false);

      // New files should be considered
      expect(state.isVerificationEdit('file2.ts', 5)).toBe(true);
      expect(state.isVerificationEdit('file3.ts', 5)).toBe(true);
      expect(state.isVerificationEdit('file4.ts', 5)).toBe(true);
    });

    it('should handle boundary case of exactly 10 lines', () => {
      expect(state.isVerificationEdit('src/index.ts', 9)).toBe(true);
      expect(state.isVerificationEdit('src/index.ts', 10)).toBe(false);
    });
  });

  describe('getRecentTaskFiles', () => {
    it('should return empty array when no tasks', () => {
      expect(state.getRecentTaskFiles()).toEqual([]);
    });

    it('should return files from single task', () => {
      state.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['file1.ts', 'file2.ts'],
        taskId: 'task-1',
      });

      const files = state.getRecentTaskFiles();
      expect(files).toContain('file1.ts');
      expect(files).toContain('file2.ts');
    });

    it('should return deduplicated files from multiple tasks', () => {
      state.recordTaskCompletion({
        timestamp: 1,
        filesModified: ['file1.ts', 'file2.ts'],
        taskId: 'task-1',
      });

      state.recordTaskCompletion({
        timestamp: 2,
        filesModified: ['file2.ts', 'file3.ts'], // file2.ts repeated
        taskId: 'task-2',
      });

      const files = state.getRecentTaskFiles();
      expect(files).toHaveLength(3);
      expect(files).toContain('file1.ts');
      expect(files).toContain('file2.ts');
      expect(files).toContain('file3.ts');
    });

    it('should only include files from last 3 tasks', () => {
      state.recordTaskCompletion({
        timestamp: 1,
        filesModified: ['old-file.ts'],
        taskId: 'task-1',
      });

      state.recordTaskCompletion({
        timestamp: 2,
        filesModified: ['file2.ts'],
        taskId: 'task-2',
      });

      state.recordTaskCompletion({
        timestamp: 3,
        filesModified: ['file3.ts'],
        taskId: 'task-3',
      });

      state.recordTaskCompletion({
        timestamp: 4,
        filesModified: ['file4.ts'],
        taskId: 'task-4',
      });

      const files = state.getRecentTaskFiles();
      expect(files).not.toContain('old-file.ts');
      expect(files).toContain('file2.ts');
      expect(files).toContain('file3.ts');
      expect(files).toContain('file4.ts');
    });
  });

  describe('clear', () => {
    it('should clear all tracked tasks', () => {
      state.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['file1.ts'],
        taskId: 'task-1',
      });

      state.recordTaskCompletion({
        timestamp: Date.now(),
        filesModified: ['file2.ts'],
        taskId: 'task-2',
      });

      expect(state.trackedCount).toBe(2);

      state.clear();

      expect(state.trackedCount).toBe(0);
      expect(state.getRecentTasks()).toEqual([]);
      expect(state.getRecentTaskFiles()).toEqual([]);
    });
  });
});
