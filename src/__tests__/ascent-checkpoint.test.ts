import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  validateCheckpoint,
  hashPlanContent,
  getGitSha
} from '../features/ascent-checkpoint/index.js';
import { existsSync, mkdirSync, rmSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { AscentCheckpoint } from '../shared/types.js';

describe('Ascent Checkpoint System', () => {
  const testCheckpointsDir = join(process.cwd(), '.olympus-test', 'checkpoints');

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(testCheckpointsDir)) {
      rmSync(testCheckpointsDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(testCheckpointsDir)) {
      rmSync(testCheckpointsDir, { recursive: true, force: true });
    }
  });

  describe('hashPlanContent', () => {
    it('should generate consistent hash for same content', () => {
      const content = 'Test plan content';
      const hash1 = hashPlanContent(content);
      const hash2 = hashPlanContent(content);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
    });

    it('should generate different hashes for different content', () => {
      const content1 = 'Plan version 1';
      const content2 = 'Plan version 2';

      const hash1 = hashPlanContent(content1);
      const hash2 = hashPlanContent(content2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('getGitSha', () => {
    it('should return a git SHA or unknown', () => {
      const sha = getGitSha();

      // Should be either a valid SHA (40 hex chars) or 'unknown'
      expect(sha === 'unknown' || /^[a-f0-9]{40}$/i.test(sha)).toBe(true);
    });
  });

  describe('saveCheckpoint', () => {
    it('should create checkpoints directory if it does not exist', () => {
      expect(existsSync(testCheckpointsDir)).toBe(false);

      saveCheckpoint('test-plan', {
        gitSha: 'abc123',
        planHash: 'hash123',
        iterationCount: 50,
        tasks: []
      }, testCheckpointsDir);

      expect(existsSync(testCheckpointsDir)).toBe(true);
    });

    it('should save checkpoint with correct structure', () => {
      const checkpoint = {
        gitSha: 'abc123def456',
        planHash: 'plan-hash-123',
        iterationCount: 75,
        tasks: [
          { id: 'task-1', status: 'completed' as const, description: 'First task' },
          { id: 'task-2', status: 'in_progress' as const, description: 'Second task' }
        ]
      };

      saveCheckpoint('my-plan', checkpoint, testCheckpointsDir);

      const files = readdirSync(testCheckpointsDir);
      expect(files.length).toBe(1);
      expect(files[0]).toMatch(/^my-plan-\d+\.json$/);

      const loaded = loadCheckpoint('my-plan', testCheckpointsDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.planName).toBe('my-plan');
      expect(loaded?.gitSha).toBe('abc123def456');
      expect(loaded?.iterationCount).toBe(75);
      expect(loaded?.tasks).toHaveLength(2);
      expect(loaded?.timestamp).toBeDefined();
    });

    it('should allow multiple checkpoints for same plan', () => {
      saveCheckpoint('plan-a', {
        gitSha: 'sha1',
        planHash: 'hash1',
        iterationCount: 10,
        tasks: []
      }, testCheckpointsDir);

      // Wait a bit to ensure different timestamp
      const now = Date.now();
      while (Date.now() === now) {
        // Busy wait
      }

      saveCheckpoint('plan-a', {
        gitSha: 'sha2',
        planHash: 'hash2',
        iterationCount: 20,
        tasks: []
      }, testCheckpointsDir);

      const checkpoints = listCheckpoints('plan-a', testCheckpointsDir);
      expect(checkpoints.length).toBe(2);
    });
  });

  describe('loadCheckpoint', () => {
    it('should return null if no checkpoints exist', () => {
      const loaded = loadCheckpoint('nonexistent-plan', testCheckpointsDir);
      expect(loaded).toBeNull();
    });

    it('should load the most recent checkpoint', () => {
      const now = Date.now();

      // Create checkpoints directory
      mkdirSync(testCheckpointsDir, { recursive: true });

      // Save older checkpoint
      const older: AscentCheckpoint = {
        planName: 'plan-b',
        timestamp: new Date(now - 10000).toISOString(),
        gitSha: 'old-sha',
        planHash: 'old-hash',
        iterationCount: 10,
        tasks: []
      };
      writeFileSync(
        join(testCheckpointsDir, `plan-b-${now - 10000}.json`),
        JSON.stringify(older),
        'utf-8'
      );

      // Save newer checkpoint
      const newer: AscentCheckpoint = {
        planName: 'plan-b',
        timestamp: new Date(now).toISOString(),
        gitSha: 'new-sha',
        planHash: 'new-hash',
        iterationCount: 50,
        tasks: []
      };
      writeFileSync(
        join(testCheckpointsDir, `plan-b-${now}.json`),
        JSON.stringify(newer),
        'utf-8'
      );

      const loaded = loadCheckpoint('plan-b', testCheckpointsDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.gitSha).toBe('new-sha');
      expect(loaded?.iterationCount).toBe(50);
    });

    it('should handle corrupted checkpoint files gracefully', () => {
      mkdirSync(testCheckpointsDir, { recursive: true });

      // Write invalid JSON
      writeFileSync(
        join(testCheckpointsDir, 'plan-c-123456.json'),
        'invalid json {{{',
        'utf-8'
      );

      const loaded = loadCheckpoint('plan-c', testCheckpointsDir);
      expect(loaded).toBeNull();
    });
  });

  describe('listCheckpoints', () => {
    it('should return empty array if directory does not exist', () => {
      const checkpoints = listCheckpoints('any-plan', testCheckpointsDir);
      expect(checkpoints).toEqual([]);
    });

    it('should list only checkpoints for specified plan', () => {
      mkdirSync(testCheckpointsDir, { recursive: true });

      // Create checkpoints for different plans
      writeFileSync(join(testCheckpointsDir, 'plan-a-100.json'), '{}', 'utf-8');
      writeFileSync(join(testCheckpointsDir, 'plan-a-200.json'), '{}', 'utf-8');
      writeFileSync(join(testCheckpointsDir, 'plan-b-100.json'), '{}', 'utf-8');
      writeFileSync(join(testCheckpointsDir, 'other-file.txt'), 'text', 'utf-8');

      const planACheckpoints = listCheckpoints('plan-a', testCheckpointsDir);
      expect(planACheckpoints).toHaveLength(2);
      expect(planACheckpoints.every(f => f.startsWith('plan-a-'))).toBe(true);

      const planBCheckpoints = listCheckpoints('plan-b', testCheckpointsDir);
      expect(planBCheckpoints).toHaveLength(1);
    });

    it('should sort checkpoints by most recent first', () => {
      mkdirSync(testCheckpointsDir, { recursive: true });

      writeFileSync(join(testCheckpointsDir, 'plan-x-100.json'), '{}', 'utf-8');
      writeFileSync(join(testCheckpointsDir, 'plan-x-300.json'), '{}', 'utf-8');
      writeFileSync(join(testCheckpointsDir, 'plan-x-200.json'), '{}', 'utf-8');

      const checkpoints = listCheckpoints('plan-x', testCheckpointsDir);
      expect(checkpoints).toEqual([
        'plan-x-300.json',
        'plan-x-200.json',
        'plan-x-100.json'
      ]);
    });
  });

  describe('validateCheckpoint', () => {
    const checkpoint: AscentCheckpoint = {
      planName: 'test-plan',
      timestamp: new Date().toISOString(),
      gitSha: 'abc123',
      planHash: 'hash456',
      iterationCount: 50,
      tasks: []
    };

    it('should validate checkpoint with no changes', () => {
      const result = validateCheckpoint(checkpoint, 'abc123', 'hash456');

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn if git SHA changed', () => {
      const result = validateCheckpoint(checkpoint, 'different-sha', 'hash456');

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Git SHA has changed');
      expect(result.warnings[0]).toContain('abc123');
      expect(result.warnings[0]).toContain('different-sha');
    });

    it('should not warn if checkpoint SHA is unknown', () => {
      const unknownCheckpoint = { ...checkpoint, gitSha: 'unknown' };
      const result = validateCheckpoint(unknownCheckpoint, 'any-sha', 'hash456');

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn if plan hash changed', () => {
      const result = validateCheckpoint(checkpoint, 'abc123', 'different-hash');

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Plan has been modified');
      expect(result.warnings[0]).toContain('hash456');
      expect(result.warnings[0]).toContain('different-hash');
    });

    it('should warn for both git SHA and plan hash changes', () => {
      const result = validateCheckpoint(checkpoint, 'new-sha', 'new-hash');

      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toContain('Git SHA has changed');
      expect(result.warnings[1]).toContain('Plan has been modified');
    });
  });

  describe('Integration test', () => {
    it('should handle full checkpoint lifecycle', () => {
      // 1. Save initial checkpoint
      saveCheckpoint('integration-test', {
        gitSha: getGitSha(),
        planHash: hashPlanContent('Plan content v1'),
        iterationCount: 25,
        tasks: [
          { id: '1', status: 'completed', description: 'Task 1' },
          { id: '2', status: 'in_progress', description: 'Task 2' },
          { id: '3', status: 'pending', description: 'Task 3' }
        ]
      }, testCheckpointsDir);

      // 2. List checkpoints
      const checkpoints = listCheckpoints('integration-test', testCheckpointsDir);
      expect(checkpoints).toHaveLength(1);

      // 3. Load checkpoint
      const loaded = loadCheckpoint('integration-test', testCheckpointsDir);
      expect(loaded).not.toBeNull();
      expect(loaded?.planName).toBe('integration-test');
      expect(loaded?.iterationCount).toBe(25);
      expect(loaded?.tasks).toHaveLength(3);

      // 4. Validate checkpoint
      const validation = validateCheckpoint(
        loaded!,
        loaded!.gitSha,
        loaded!.planHash
      );
      expect(validation.valid).toBe(true);
      expect(validation.warnings).toHaveLength(0);

      // 5. Save another checkpoint (progress)
      saveCheckpoint('integration-test', {
        gitSha: getGitSha(),
        planHash: hashPlanContent('Plan content v1'),
        iterationCount: 50,
        tasks: [
          { id: '1', status: 'completed', description: 'Task 1' },
          { id: '2', status: 'completed', description: 'Task 2' },
          { id: '3', status: 'in_progress', description: 'Task 3' }
        ]
      }, testCheckpointsDir);

      // 6. Verify most recent is loaded
      const latest = loadCheckpoint('integration-test', testCheckpointsDir);
      expect(latest?.iterationCount).toBe(50);
      expect(latest?.tasks[1].status).toBe('completed');

      // 7. List all checkpoints
      const allCheckpoints = listCheckpoints('integration-test', testCheckpointsDir);
      expect(allCheckpoints).toHaveLength(2);
    });
  });
});
