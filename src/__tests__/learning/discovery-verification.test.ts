import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Hoisted mock
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

import {
  recordDiscovery,
  markDiscoveryUseful,
  readDiscoveries,
} from '../../learning/discovery.js';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import { registerSessionStartHooks } from '../../hooks/registrations/session-start.js';
import type { HookContext } from '../../hooks/types.js';
import type { AgentDiscovery } from '../../learning/types.js';

describe('discovery verification loop', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'olympus-verification-test-'));
    mockHomedir.value = tempDir;
    clearHooks();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    clearHooks();
  });

  describe('markDiscoveryUseful', () => {
    it('increments verification_count on project discovery', () => {
      const discovery = recordDiscovery({
        category: 'pattern',
        summary: 'Test pattern',
        details: 'Pattern details',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      expect(discovery.verification_count).toBe(0);

      markDiscoveryUseful(discovery.id, tempDir);

      const updated = readDiscoveries(tempDir);
      const found = updated.project_discoveries.find(d => d.id === discovery.id);

      expect(found).toBeDefined();
      expect(found!.verification_count).toBe(1);
    });

    it('increments verification_count on global discovery', () => {
      const discovery = recordDiscovery({
        category: 'pattern',
        summary: 'Global pattern',
        details: 'Pattern details',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'global',
      });

      expect(discovery.verification_count).toBe(0);

      markDiscoveryUseful(discovery.id, tempDir);

      const updated = readDiscoveries(tempDir);
      const found = updated.global_discoveries.find(d => d.id === discovery.id);

      expect(found).toBeDefined();
      expect(found!.verification_count).toBe(1);
    });

    it('updates last_useful timestamp', () => {
      const discovery = recordDiscovery({
        category: 'gotcha',
        summary: 'Test gotcha',
        details: 'Gotcha details',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.8,
        scope: 'project',
      });

      const originalLastUseful = new Date(discovery.last_useful);

      // Wait a small amount to ensure timestamp difference
      const waitMs = 10;
      const waitUntil = Date.now() + waitMs;
      while (Date.now() < waitUntil) {
        // busy wait
      }

      markDiscoveryUseful(discovery.id, tempDir);

      const updated = readDiscoveries(tempDir);
      const found = updated.project_discoveries.find(d => d.id === discovery.id);

      expect(found).toBeDefined();
      const updatedLastUseful = new Date(found!.last_useful);
      expect(updatedLastUseful.getTime()).toBeGreaterThan(originalLastUseful.getTime());
    });

    it('handles multiple increments correctly', () => {
      const discovery = recordDiscovery({
        category: 'workaround',
        summary: 'Build workaround',
        details: 'Workaround details',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      markDiscoveryUseful(discovery.id, tempDir);
      markDiscoveryUseful(discovery.id, tempDir);
      markDiscoveryUseful(discovery.id, tempDir);

      const updated = readDiscoveries(tempDir);
      const found = updated.project_discoveries.find(d => d.id === discovery.id);

      expect(found).toBeDefined();
      expect(found!.verification_count).toBe(3);
    });

    it('does not error on non-existent discovery', () => {
      expect(() => {
        markDiscoveryUseful('non-existent-id', tempDir);
      }).not.toThrow();
    });

    it('preserves other discovery fields', () => {
      const discovery = recordDiscovery({
        category: 'performance',
        summary: 'Performance tip',
        details: 'Performance details',
        agent_name: 'test-agent',
        session_id: 'test-session',
        project_path: tempDir,
        confidence: 0.95,
        scope: 'project',
        tags: ['optimization', 'cache'],
      });

      markDiscoveryUseful(discovery.id, tempDir);

      const updated = readDiscoveries(tempDir);
      const found = updated.project_discoveries.find(d => d.id === discovery.id);

      expect(found).toBeDefined();
      expect(found!.category).toBe('performance');
      expect(found!.summary).toBe('Performance tip');
      expect(found!.details).toBe('Performance details');
      expect(found!.agent_name).toBe('test-agent');
      expect(found!.confidence).toBe(0.95);
      expect(found!.tags).toEqual(['optimization', 'cache']);
    });
  });

  describe('SessionStart hook verification', () => {
    it('marks injected discoveries as useful', () => {
      // Create discoveries with old last_useful timestamps
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

      const discovery1 = recordDiscovery({
        category: 'pattern',
        summary: 'Pattern 1',
        details: 'Details 1',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      const discovery2 = recordDiscovery({
        category: 'gotcha',
        summary: 'Gotcha 1',
        details: 'Details 2',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.85,
        scope: 'project',
      });

      // Manually update last_useful to be 2 days ago
      const filePath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const updated = lines.map(line => {
        const d = JSON.parse(line) as AgentDiscovery;
        d.last_useful = twoDaysAgo;
        return JSON.stringify(d);
      });
      writeFileSync(filePath, updated.join('\n') + '\n', 'utf-8');

      // Register hooks and trigger SessionStart
      registerSessionStartHooks();

      const ctx: HookContext = {
        event: 'SessionStart',
        sessionId: 'test-session',
        directory: tempDir,
      };

      const hooks = getHooksForEvent('SessionStart');
      const learnedContextHook = hooks.find(h => h.name === 'learnedContextInjection');

      expect(learnedContextHook).toBeDefined();

      // Execute the hook
      learnedContextHook.handler(ctx);

      // Verify discoveries were marked as useful
      const discoveries = readDiscoveries(tempDir);

      // Both discoveries should have verification_count = 1
      const found1 = discoveries.project_discoveries.find(d => d.id === discovery1.id);
      const found2 = discoveries.project_discoveries.find(d => d.id === discovery2.id);

      expect(found1).toBeDefined();
      expect(found2).toBeDefined();
      expect(found1!.verification_count).toBe(1);
      expect(found2!.verification_count).toBe(1);
    });

    it('throttles verification to 24-hour window', () => {
      // Create a discovery with recent last_useful timestamp
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const discovery = recordDiscovery({
        category: 'pattern',
        summary: 'Recent pattern',
        details: 'Details',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      // Manually update last_useful to 1 hour ago and set verification_count
      const filePath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      const updated = lines.map(line => {
        const d = JSON.parse(line) as AgentDiscovery;
        d.last_useful = oneHourAgo;
        d.verification_count = 5;
        return JSON.stringify(d);
      });
      writeFileSync(filePath, updated.join('\n') + '\n', 'utf-8');

      // Register hooks and trigger SessionStart
      registerSessionStartHooks();

      const ctx: HookContext = {
        event: 'SessionStart',
        sessionId: 'test-session',
        directory: tempDir,
      };

      const hooks = getHooksForEvent('SessionStart');
      const learnedContextHook = hooks.find(h => h.name === 'learnedContextInjection');

      expect(learnedContextHook).toBeDefined();

      // Execute the hook
      learnedContextHook.handler(ctx);

      // Verify discovery was NOT marked (still has verification_count = 5)
      const discoveries = readDiscoveries(tempDir);
      const found = discoveries.project_discoveries.find(d => d.id === discovery.id);

      expect(found).toBeDefined();
      expect(found!.verification_count).toBe(5); // Should not increment
    });

    it('does not block session start on verification failure', () => {
      // Create a discovery
      recordDiscovery({
        category: 'pattern',
        summary: 'Pattern',
        details: 'Details',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      // Delete the discoveries file to cause an error during verification
      const filePath = join(tempDir, '.olympus', 'learning', 'discoveries.jsonl');
      rmSync(filePath, { force: true });

      // Register hooks and trigger SessionStart
      registerSessionStartHooks();

      const ctx: HookContext = {
        event: 'SessionStart',
        sessionId: 'test-session',
        directory: tempDir,
      };

      const hooks = getHooksForEvent('SessionStart');
      const learnedContextHook = hooks.find(h => h.name === 'learnedContextInjection');

      expect(learnedContextHook).toBeDefined();

      // Execute the hook - should not throw
      expect(() => {
        learnedContextHook.handler(ctx);
      }).not.toThrow();
    });

    it('handles directory without discoveries gracefully', () => {
      // Don't create any discoveries

      // Register hooks and trigger SessionStart
      registerSessionStartHooks();

      const ctx: HookContext = {
        event: 'SessionStart',
        sessionId: 'test-session',
        directory: tempDir,
      };

      const hooks = getHooksForEvent('SessionStart');
      const learnedContextHook = hooks.find(h => h.name === 'learnedContextInjection');

      expect(learnedContextHook).toBeDefined();

      // Execute the hook - should not throw
      expect(() => {
        learnedContextHook.handler(ctx);
      }).not.toThrow();
    });
  });

  describe('most_useful sorting', () => {
    it('ranks discoveries by verification_count', () => {
      const d1 = recordDiscovery({
        category: 'pattern',
        summary: 'Pattern 1',
        details: 'Details 1',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      const d2 = recordDiscovery({
        category: 'gotcha',
        summary: 'Gotcha 1',
        details: 'Details 2',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      const d3 = recordDiscovery({
        category: 'workaround',
        summary: 'Workaround 1',
        details: 'Details 3',
        agent_name: 'test',
        session_id: 'test',
        project_path: tempDir,
        confidence: 0.9,
        scope: 'project',
      });

      // Give different verification counts
      markDiscoveryUseful(d2.id, tempDir);
      markDiscoveryUseful(d2.id, tempDir);
      markDiscoveryUseful(d2.id, tempDir); // d2 has 3

      markDiscoveryUseful(d3.id, tempDir); // d3 has 1

      // d1 has 0

      const summary = readDiscoveries(tempDir);

      expect(summary.most_useful).toHaveLength(3);
      expect(summary.most_useful[0].id).toBe(d2.id); // 3 verifications
      expect(summary.most_useful[1].id).toBe(d3.id); // 1 verification
      expect(summary.most_useful[2].id).toBe(d1.id); // 0 verifications
    });
  });
});
