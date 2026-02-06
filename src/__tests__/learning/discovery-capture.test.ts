import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock for homedir
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import { extractDiscovery, isDuplicate, inferCategory, jaccardSimilarity } from '../../learning/discovery-detector.js';
import { loadDiscoveryConfig } from '../../learning/config.js';
import { incrementDiscoveryCount, checkDiscoveryLimit, createSessionState } from '../../learning/session-state.js';
import { recordDiscovery } from '../../learning/discovery.js';
import type { SessionState } from '../../learning/types.js';

describe('Discovery Capture', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-discovery-capture-'));
    mockHomedir.value = tempDir;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('extractDiscovery', () => {
    it('should extract discovery from valid pending_completion', () => {
      const state = createSessionState('test-session') as SessionState;
      state.pending_completion = {
        claimed_at: new Date().toISOString(),
        task_description: 'Fix the authentication bug in login.ts where JWT tokens expire too early',
        agent_used: 'olympian',
      };

      const discovery = extractDiscovery(state, 'praise');

      expect(discovery).not.toBeNull();
      expect(discovery!.summary).toBeDefined();
      expect(discovery!.summary!.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(discovery!.details).toBe('Fix the authentication bug in login.ts where JWT tokens expire too early');
      expect(discovery!.agent_name).toBe('olympian');
      expect(discovery!.confidence).toBe(0.85); // praise confidence
      expect(discovery!.category).toBeDefined();
    });

    it('should return null when no pending_completion', () => {
      const state = createSessionState('test-session') as SessionState;
      state.pending_completion = null;

      const discovery = extractDiscovery(state, 'praise');
      expect(discovery).toBeNull();
    });

    it('should return null when pending_completion has no task_description', () => {
      const state = createSessionState('test-session') as SessionState;
      state.pending_completion = {
        claimed_at: new Date().toISOString(),
      };

      const discovery = extractDiscovery(state, 'praise');
      expect(discovery).toBeNull();
    });

    it('should set correct confidence for topic_change', () => {
      const state = createSessionState('test-session') as SessionState;
      state.pending_completion = {
        claimed_at: new Date().toISOString(),
        task_description: 'Refactor the user service',
        agent_used: 'olympian',
      };

      const discovery = extractDiscovery(state, 'topic_change');
      expect(discovery!.confidence).toBe(0.6);
    });

    it('should set correct confidence for problem_solved', () => {
      const state = createSessionState('test-session') as SessionState;
      state.pending_completion = {
        claimed_at: new Date().toISOString(),
        task_description: 'Debug the memory leak',
        agent_used: 'oracle',
      };

      const discovery = extractDiscovery(state, 'problem_solved');
      expect(discovery!.confidence).toBe(0.7);
    });

    it('should truncate long details at 2000 chars', () => {
      const state = createSessionState('test-session') as SessionState;
      state.pending_completion = {
        claimed_at: new Date().toISOString(),
        task_description: 'x'.repeat(3000),
        agent_used: 'olympian',
      };

      const discovery = extractDiscovery(state, 'praise');
      expect(discovery!.details!.length).toBeLessThanOrEqual(2003); // 2000 + '...'
    });
  });

  describe('inferCategory', () => {
    it('should infer workaround from keywords', () => {
      expect(inferCategory('Found a workaround for the build issue', 'olympian')).toBe('workaround');
    });

    it('should infer gotcha from keywords', () => {
      expect(inferCategory('This is a gotcha with async/await', 'oracle')).toBe('gotcha');
    });

    it('should infer performance from keywords', () => {
      expect(inferCategory('Performance issue with N+1 queries', 'oracle')).toBe('performance');
      expect(inferCategory('Query optimization needed', 'oracle')).toBe('performance');
    });

    it('should infer dependency from keywords', () => {
      expect(inferCategory('Package requires peer dependency React 18', 'olympian')).toBe('dependency');
    });

    it('should infer configuration from keywords', () => {
      expect(inferCategory('Environment variable DATABASE_URL must be set', 'olympian')).toBe('configuration');
      expect(inferCategory('Config file needs updating', 'olympian')).toBe('configuration');
    });

    it('should infer pattern from keywords', () => {
      expect(inferCategory('This codebase follows a pattern of kebab-case', 'explore')).toBe('pattern');
    });

    it('should default to technical_insight when no keywords match', () => {
      expect(inferCategory('Fixed the login bug in auth module', 'olympian')).toBe('technical_insight');
    });

    it('should be case insensitive', () => {
      expect(inferCategory('WORKAROUND for the issue', 'olympian')).toBe('workaround');
      expect(inferCategory('Performance OPTIMIZATION needed', 'oracle')).toBe('performance');
    });
  });

  describe('isDuplicate', () => {
    it('should detect exact match duplicate', () => {
      const projectPath = tempDir;

      // Record a discovery first
      recordDiscovery({
        category: 'technical_insight',
        summary: 'Fix auth bug',
        details: 'Fix the authentication bug in login.ts',
        agent_name: 'olympian',
        session_id: 'test-session',
        project_path: projectPath,
        confidence: 0.85,
        scope: 'project',
      });

      const candidate = {
        summary: 'Fix auth bug',
        details: 'Fix the authentication bug in login.ts',
      };

      expect(isDuplicate(candidate, projectPath, 7)).toBe(true);
    });

    it('should detect similar summary duplicate (Jaccard > 0.7)', () => {
      const projectPath = tempDir;

      recordDiscovery({
        category: 'technical_insight',
        summary: 'Fix the authentication bug in the login module',
        details: 'Different details here',
        agent_name: 'olympian',
        session_id: 'test-session',
        project_path: projectPath,
        confidence: 0.85,
        scope: 'project',
      });

      const candidate = {
        summary: 'Fix the authentication bug in the login module component',
        details: 'Completely different details',
      };

      expect(isDuplicate(candidate, projectPath, 7)).toBe(true);
    });

    it('should not flag unique discoveries as duplicates', () => {
      const projectPath = tempDir;

      recordDiscovery({
        category: 'workaround',
        summary: 'Build requires NODE_ENV',
        details: 'Must set NODE_ENV=development',
        agent_name: 'olympian',
        session_id: 'test-session',
        project_path: projectPath,
        confidence: 0.85,
        scope: 'project',
      });

      const candidate = {
        summary: 'Fix authentication bug in login module',
        details: 'JWT tokens expire too early in production',
      };

      expect(isDuplicate(candidate, projectPath, 7)).toBe(false);
    });

    it('should return false when no existing discoveries', () => {
      const candidate = {
        summary: 'New discovery',
        details: 'New details',
      };

      expect(isDuplicate(candidate, tempDir, 7)).toBe(false);
    });
  });

  describe('jaccardSimilarity', () => {
    it('should return 1 for identical strings', () => {
      expect(jaccardSimilarity('hello world test', 'hello world test')).toBe(1);
    });

    it('should return 0 for completely different strings', () => {
      expect(jaccardSimilarity('authentication login module', 'database query optimization')).toBe(0);
    });

    it('should return value between 0 and 1 for partial overlap', () => {
      const similarity = jaccardSimilarity(
        'fix authentication bug in login',
        'fix authorization bug in login'
      );
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it('should handle empty strings', () => {
      expect(jaccardSimilarity('', '')).toBe(1);
      expect(jaccardSimilarity('hello world test', '')).toBe(0);
      expect(jaccardSimilarity('', 'hello world test')).toBe(0);
    });
  });

  describe('Volume Limits', () => {
    it('should increment discovery count', () => {
      const state = createSessionState('test-session') as SessionState;
      incrementDiscoveryCount(state);
      expect(state.discovery_volume!.session_count).toBe(1);
      expect(state.discovery_volume!.daily_count).toBe(1);
    });

    it('should detect session limit exceeded', () => {
      const state = createSessionState('test-session') as SessionState;
      state.discovery_volume = {
        session_count: 5,
        daily_count: 5,
        daily_reset_at: new Date().toISOString(),
      };

      expect(checkDiscoveryLimit(state, { maxPerSession: 5, maxPerDay: 20 })).toBe(true);
    });

    it('should detect daily limit exceeded', () => {
      const state = createSessionState('test-session') as SessionState;
      state.discovery_volume = {
        session_count: 3,
        daily_count: 20,
        daily_reset_at: new Date().toISOString(),
      };

      expect(checkDiscoveryLimit(state, { maxPerSession: 5, maxPerDay: 20 })).toBe(true);
    });

    it('should allow discoveries within limits', () => {
      const state = createSessionState('test-session') as SessionState;
      state.discovery_volume = {
        session_count: 2,
        daily_count: 10,
        daily_reset_at: new Date().toISOString(),
      };

      expect(checkDiscoveryLimit(state, { maxPerSession: 5, maxPerDay: 20 })).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should return default config when no files exist', () => {
      const config = loadDiscoveryConfig(tempDir);
      expect(config.enabled).toBe(true);
      expect(config.minConfidence).toBe(0.6);
      expect(config.maxPerSession).toBe(5);
      expect(config.maxPerDay).toBe(20);
      expect(config.deduplicationWindowDays).toBe(7);
    });

    it('should validate bounds', () => {
      // Create config with out-of-range values
      const configDir = join(tempDir, '.olympus');
      mkdirSync(configDir, { recursive: true });
      const configPath = join(configDir, 'config.json');
      const fs = require('fs');
      fs.writeFileSync(configPath, JSON.stringify({
        autoDiscovery: {
          minConfidence: 2.0,  // Over 1
          maxPerSession: 0,    // Under 1
          maxPerDay: 300,      // Over 200
        }
      }));

      const config = loadDiscoveryConfig(tempDir);
      expect(config.minConfidence).toBe(1);
      expect(config.maxPerSession).toBe(1);
      expect(config.maxPerDay).toBe(200);
    });
  });
});
