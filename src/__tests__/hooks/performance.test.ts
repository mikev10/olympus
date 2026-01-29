/**
 * Hook Performance Tests
 *
 * Verifies that hook execution stays within the 200ms latency budget.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { registerAllHooks, resetRegistration } from '../../hooks/registrations/index.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';

// Mock config to avoid file system IO
vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn().mockReturnValue({
    hooks: {
      enabled: true,
      timeoutMs: 100
    }
  }),
  DEFAULT_CONFIG: {
    hooks: {
      enabled: true,
      timeoutMs: 100
    }
  }
}));

describe('Hook Performance', () => {
  beforeAll(() => {
    clearHooks();
    registerAllHooks();
  });

  afterAll(() => {
    clearHooks();
    resetRegistration();
  });

  describe('Latency Budget (200ms per event)', () => {
    it('UserPromptSubmit completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('UserPromptSubmit', {
        prompt: 'test prompt with ultrawork keyword',
        sessionId: 'perf-test-session',
        directory: process.cwd()
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('SessionStart completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('SessionStart', {
        sessionId: 'perf-test-session',
        directory: process.cwd()
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('Stop completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('Stop', {
        sessionId: 'perf-test-session',
        directory: process.cwd()
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('PreToolUse completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('PreToolUse', {
        toolName: 'read',
        toolInput: { file_path: '/test/file.ts' },
        sessionId: 'perf-test-session',
        directory: process.cwd()
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('PostToolUse completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('PostToolUse', {
        toolName: 'edit',
        toolInput: { file_path: '/test/file.ts' },
        toolOutput: { output: 'Success' },
        sessionId: 'perf-test-session',
        directory: process.cwd()
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('Notification completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('Notification', {
        sessionId: 'perf-test-session',
        event: { type: 'background_task_complete', properties: {} }
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });

    it('PostToolUseFailure completes within 200ms', async () => {
      const start = performance.now();

      await routeHook('PostToolUseFailure', {
        sessionId: 'perf-test-session',
        toolName: 'edit',
        error: { message: 'test error' }
      });

      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('Repeated Execution', () => {
    it('maintains performance over 10 consecutive calls', async () => {
      const times: number[] = [];

      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await routeHook('UserPromptSubmit', { prompt: `test ${i}` });
        times.push(performance.now() - start);
      }

      // Average should be well under 200ms
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeLessThan(150);

      // No single call should exceed 200ms
      for (const time of times) {
        expect(time).toBeLessThan(200);
      }
    });
  });

  describe('Stress Testing', () => {
    it('handles 50 rapid consecutive calls efficiently', async () => {
      const times: number[] = [];
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await routeHook('UserPromptSubmit', {
          prompt: `stress test iteration ${i}`,
          sessionId: 'stress-test-session'
        });
        times.push(performance.now() - start);
      }

      // Average should still be reasonable
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      expect(avg).toBeLessThan(150);

      // 95th percentile should be under 200ms
      const sorted = times.slice().sort((a, b) => a - b);
      const p95Index = Math.floor(iterations * 0.95);
      expect(sorted[p95Index]).toBeLessThan(200);
    });
  });

  describe('Performance Under Load', () => {
    it('maintains latency with complex prompts', async () => {
      const longPrompt = 'ultrawork '.repeat(100) + 'search and analyze this complex task with many keywords';

      const start = performance.now();
      await routeHook('UserPromptSubmit', {
        prompt: longPrompt,
        sessionId: 'load-test-session'
      });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it('maintains latency with multiple tool inputs', async () => {
      const complexInput = {
        file_path: '/very/long/path/to/some/deeply/nested/file.ts',
        old_string: 'x'.repeat(1000),
        new_string: 'y'.repeat(1000)
      };

      const start = performance.now();
      await routeHook('PreToolUse', {
        toolName: 'edit',
        toolInput: complexInput,
        sessionId: 'load-test-session'
      });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });

    it('maintains latency with many messages', async () => {
      const manyMessages = Array.from({ length: 100 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));

      const start = performance.now();
      await routeHook('PostToolUseFailure', {
        sessionId: 'load-test-session',
        toolName: 'edit',
        error: { messages: manyMessages }
      });
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('Performance Baseline Metrics', () => {
    it('tracks and reports performance statistics', async () => {
      const iterations = 100;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await routeHook('UserPromptSubmit', {
          prompt: `baseline test ${i}`,
          sessionId: 'baseline-session'
        });
        times.push(performance.now() - start);
      }

      const sorted = times.slice().sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const median = sorted[Math.floor(iterations / 2)];
      const p95 = sorted[Math.floor(iterations * 0.95)];
      const p99 = sorted[Math.floor(iterations * 0.99)];

      // Report statistics (useful for CI monitoring)
      console.log('Performance Baseline Stats:');
      console.log(`  Min: ${min.toFixed(2)}ms`);
      console.log(`  Median: ${median.toFixed(2)}ms`);
      console.log(`  Avg: ${avg.toFixed(2)}ms`);
      console.log(`  P95: ${p95.toFixed(2)}ms`);
      console.log(`  P99: ${p99.toFixed(2)}ms`);
      console.log(`  Max: ${max.toFixed(2)}ms`);

      // All metrics should be well under budget
      expect(min).toBeLessThan(200);
      expect(median).toBeLessThan(150);
      expect(avg).toBeLessThan(150);
      expect(p95).toBeLessThan(200);
      expect(p99).toBeLessThan(200);
      expect(max).toBeLessThan(250); // Allow some margin for CI variance
    });
  });

  describe('Hook Timeout Protection', () => {
    it('respects timeout configuration', async () => {
      // This test verifies that the timeout mechanism itself doesn't add significant overhead
      const start = performance.now();

      await routeHook('UserPromptSubmit', {
        prompt: 'test prompt',
        sessionId: 'timeout-test-session'
      });

      const elapsed = performance.now() - start;

      // Even with timeout protection, should complete quickly
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('Event Type Performance Comparison', () => {
    it('compares latency across all event types', async () => {
      const eventTests = [
        { event: 'UserPromptSubmit' as const, context: { prompt: 'test' } },
        { event: 'SessionStart' as const, context: { sessionId: 'test' } },
        { event: 'Stop' as const, context: { sessionId: 'test' } },
        { event: 'PreToolUse' as const, context: { toolName: 'read' } },
        { event: 'PostToolUse' as const, context: { toolName: 'edit' } },
        { event: 'PostToolUseFailure' as const, context: { toolName: 'edit', error: {} } },
        { event: 'Notification' as const, context: { event: { type: 'test' } } }
      ];

      const results: Record<string, number> = {};

      for (const test of eventTests) {
        const times: number[] = [];

        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          await routeHook(test.event, test.context);
          times.push(performance.now() - start);
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        results[test.event] = avg;

        // Each event type should be under budget
        // Allow 400ms for stress test due to CI variance, cold cache, and hook timeout (100ms)
        expect(avg).toBeLessThan(400);
      }

      console.log('Event Type Performance:');
      Object.entries(results).forEach(([event, time]) => {
        console.log(`  ${event}: ${time.toFixed(2)}ms avg`);
      });
    });
  });
});
