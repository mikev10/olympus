/**
 * Workflow Engine Performance Benchmarks
 *
 * Tests performance requirements for checkpoint operations:
 * - Checkpoint save < 50ms
 * - Checkpoint load < 50ms
 * - Validation runs efficiently
 * - Memory usage < 50MB for large workflows
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveCheckpoint,
  loadCheckpoint,
  clearCache,
} from '../../features/workflow-engine/checkpoint.js';
import { validateIdea, validatePrd, clearFileCache } from '../../features/workflow-engine/validation.js';
import { WorkflowCheckpoint } from '../../features/workflow-engine/types.js';

describe('Workflow Engine Performance', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'perf-test-'));
    // Clear caches before each test
    clearCache();
    clearFileCache();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  /**
   * Helper to create a realistic checkpoint with complex data
   */
  function createComplexCheckpoint(workflowId: string): WorkflowCheckpoint {
    return {
      schema_version: '1.0.0',
      workflow_id: workflowId,
      feature_name: `Test Feature ${workflowId}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_stage: 'prd',
      status: 'in_progress',
      artifacts: {
        idea: {
          id: 'IDEA-001',
          path: `.olympus/workflow/${workflowId}/idea.md`,
          created_at: new Date().toISOString(),
          validation_passed: true,
        },
        prd: null,
        spec: null,
        intents: null,
        complete: null,
      },
      validation_results: {
        idea: {
          passed: true,
          coverage_percentage: 100,
          blocking_issues: [],
          reviewer: 'momus',
          timestamp: new Date().toISOString(),
        },
        prd: null,
        spec: null,
        intents: null,
        complete: null,
      },
      resume_context: {
        initial_prompt: 'This is a test prompt with some context data that would be typical in a real workflow execution.',
        additional_data: Array(100).fill('context data').join(' '), // Simulate larger context
      },
    };
  }

  /**
   * Helper to measure execution time
   */
  async function measureTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }

  describe('Checkpoint Save Performance', () => {
    it('saves checkpoint in < 50ms (typical case)', async () => {
      const checkpoint = createComplexCheckpoint('perf-save-1');

      const { duration } = await measureTime(() => saveCheckpoint(tmpDir, checkpoint));

      console.log(`[PERF] Checkpoint save: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50);
    });

    it('saves checkpoint in < 50ms (cached directory)', async () => {
      const checkpoint1 = createComplexCheckpoint('perf-save-2');
      await saveCheckpoint(tmpDir, checkpoint1); // First save creates directory

      const checkpoint2 = createComplexCheckpoint('perf-save-2');
      const { duration } = await measureTime(() => saveCheckpoint(tmpDir, checkpoint2));

      console.log(`[PERF] Checkpoint save (cached dir): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50);
    });

    it('handles large checkpoint data efficiently', async () => {
      const checkpoint = createComplexCheckpoint('perf-save-large');
      // Add large resume context
      checkpoint.resume_context = {
        initial_prompt: 'Large context test',
        large_data: Array(1000).fill('x'.repeat(100)).join('\n'), // ~100KB of data
      };

      const { duration } = await measureTime(() => saveCheckpoint(tmpDir, checkpoint));

      console.log(`[PERF] Large checkpoint save: ${duration.toFixed(2)}ms`);
      // Large checkpoints may take longer, but should still be reasonable
      expect(duration).toBeLessThan(200);
    });

    it('batch saves multiple checkpoints efficiently', async () => {
      const checkpoints = Array.from({ length: 10 }, (_, i) =>
        createComplexCheckpoint(`perf-batch-${i}`)
      );

      const { duration } = await measureTime(async () => {
        await Promise.all(checkpoints.map(cp => saveCheckpoint(tmpDir, cp)));
      });

      const avgDuration = duration / checkpoints.length;
      console.log(`[PERF] Batch save (10 checkpoints): ${duration.toFixed(2)}ms total, ${avgDuration.toFixed(2)}ms avg`);
      expect(avgDuration).toBeLessThan(50);
    });
  });

  describe('Checkpoint Load Performance', () => {
    it('loads checkpoint in < 50ms (cold cache)', async () => {
      const checkpoint = createComplexCheckpoint('perf-load-1');
      await saveCheckpoint(tmpDir, checkpoint);
      clearCache(); // Clear cache to simulate cold load

      const { duration } = await measureTime(() => loadCheckpoint(tmpDir, 'perf-load-1'));

      console.log(`[PERF] Checkpoint load (cold): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(50);
    });

    it('loads checkpoint in < 10ms (warm cache)', async () => {
      const checkpoint = createComplexCheckpoint('perf-load-2');
      await saveCheckpoint(tmpDir, checkpoint);

      // First load to warm cache
      await loadCheckpoint(tmpDir, 'perf-load-2');

      // Second load should be fast (cache hit)
      const { duration } = await measureTime(() => loadCheckpoint(tmpDir, 'perf-load-2'));

      console.log(`[PERF] Checkpoint load (warm): ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(10);
    });

    it('loads large checkpoint efficiently', async () => {
      const checkpoint = createComplexCheckpoint('perf-load-large');
      checkpoint.resume_context = {
        initial_prompt: 'Large context test',
        large_data: Array(1000).fill('x'.repeat(100)).join('\n'), // ~100KB of data
      };
      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();

      const { duration } = await measureTime(() => loadCheckpoint(tmpDir, 'perf-load-large'));

      console.log(`[PERF] Large checkpoint load: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });

    it('handles missing checkpoint efficiently', async () => {
      const { result, duration } = await measureTime(() =>
        loadCheckpoint(tmpDir, 'nonexistent-workflow')
      );

      console.log(`[PERF] Missing checkpoint check: ${duration.toFixed(2)}ms`);
      expect(result).toBeNull();
      expect(duration).toBeLessThan(20); // Should fail fast
    });

    it('batch loads multiple checkpoints efficiently', async () => {
      const checkpoints = Array.from({ length: 10 }, (_, i) =>
        createComplexCheckpoint(`perf-batch-load-${i}`)
      );
      await Promise.all(checkpoints.map(cp => saveCheckpoint(tmpDir, cp)));
      clearCache(); // Clear cache to simulate cold loads

      const { duration } = await measureTime(async () => {
        await Promise.all(
          checkpoints.map(cp => loadCheckpoint(tmpDir, cp.workflow_id))
        );
      });

      const avgDuration = duration / checkpoints.length;
      console.log(`[PERF] Batch load (10 checkpoints): ${duration.toFixed(2)}ms total, ${avgDuration.toFixed(2)}ms avg`);
      expect(avgDuration).toBeLessThan(50);
    });
  });

  describe('Validation Performance', () => {
    beforeEach(async () => {
      // Create test artifacts
      const workflowDir = join(tmpDir, '.olympus/workflow/perf-validate');
      await fs.ensureDir(workflowDir);
    });

    it('validates IDEA artifact in < 100ms', async () => {
      const ideaPath = join(tmpDir, '.olympus/workflow/perf-validate/idea.md');
      const ideaContent = `---
risk_tier: medium
---

## Problem Statement
This is a test problem statement with sufficient detail.

## Business Context
Business context with relevant information about the feature.

## Success Metrics
- Metric 1: Measure this thing
- Metric 2: Measure that thing
- Metric 3: Measure another thing

## Constraints
- Constraint 1: Must work within this limitation
- Constraint 2: Must satisfy this requirement

## Solution Approach
High-level approach to solving the problem.
`;
      await fs.writeFile(ideaPath, ideaContent);

      const { duration } = await measureTime(() => validateIdea(ideaPath));

      console.log(`[PERF] IDEA validation: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });

    it('validates PRD artifact in < 100ms', async () => {
      const ideaPath = join(tmpDir, '.olympus/workflow/perf-validate/idea.md');
      const prdPath = join(tmpDir, '.olympus/workflow/perf-validate/prd.md');

      const ideaContent = `---
risk_tier: medium
---

## Constraints
- Constraint 1
- Constraint 2
- Constraint 3
`;
      await fs.writeFile(ideaPath, ideaContent);

      const prdContent = `## User Stories

### US-001: First story
Description of first story

### US-002: Second story
Description of second story

### US-003: Third story
Description of third story

## Requirement Coverage
| Constraint | User Story | Status |
|------------|------------|--------|
| Constraint 1 | US-001 | Covered |
| Constraint 2 | US-002 | Covered |
| Constraint 3 | US-003 | Covered |
`;
      await fs.writeFile(prdPath, prdContent);

      const { duration } = await measureTime(() => validatePrd(prdPath, ideaPath));

      console.log(`[PERF] PRD validation: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(100);
    });

    it('caches file reads during validation', async () => {
      const ideaPath = join(tmpDir, '.olympus/workflow/perf-validate/idea.md');
      const ideaContent = `---
risk_tier: medium
---

## Problem Statement
Test content

## Business Context
Test content

## Success Metrics
- Metric 1
- Metric 2

## Constraints
- Constraint 1

## Solution Approach
Test content
`;
      await fs.writeFile(ideaPath, ideaContent);

      // First validation (cold cache)
      const { duration: duration1 } = await measureTime(() => validateIdea(ideaPath));

      // Second validation (warm cache)
      const { duration: duration2 } = await measureTime(() => validateIdea(ideaPath));

      console.log(`[PERF] IDEA validation cold: ${duration1.toFixed(2)}ms, warm: ${duration2.toFixed(2)}ms`);
      expect(duration2).toBeLessThan(duration1); // Warm should be faster
      expect(duration2).toBeLessThan(50); // Warm should be very fast
    });
  });

  describe('Memory Usage', () => {
    it('maintains reasonable memory usage for large workflows', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create and save 100 complex checkpoints
      const checkpoints = Array.from({ length: 100 }, (_, i) =>
        createComplexCheckpoint(`memory-test-${i}`)
      );

      await Promise.all(checkpoints.map(cp => saveCheckpoint(tmpDir, cp)));

      // Load all checkpoints
      await Promise.all(
        checkpoints.map(cp => loadCheckpoint(tmpDir, cp.workflow_id))
      );

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`[PERF] Memory increase for 100 workflows: ${memoryIncrease.toFixed(2)} MB`);
      expect(memoryIncrease).toBeLessThan(50); // Should stay under 50MB
    });

    it('cache cleanup prevents memory leaks', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create many checkpoints to fill cache
      for (let i = 0; i < 1000; i++) {
        const checkpoint = createComplexCheckpoint(`leak-test-${i}`);
        await saveCheckpoint(tmpDir, checkpoint);
      }

      // Clear cache
      clearCache();
      clearFileCache();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`[PERF] Memory increase after cache clear: ${memoryIncrease.toFixed(2)} MB`);
      // After clearing cache, memory should not grow indefinitely
      expect(memoryIncrease).toBeLessThan(100);
    });
  });

  describe('End-to-End Performance', () => {
    it('completes full checkpoint lifecycle in < 150ms', async () => {
      const checkpoint = createComplexCheckpoint('e2e-perf');

      const { duration } = await measureTime(async () => {
        // Save
        await saveCheckpoint(tmpDir, checkpoint);
        // Load
        await loadCheckpoint(tmpDir, 'e2e-perf');
        // Update
        checkpoint.current_stage = 'spec';
        await saveCheckpoint(tmpDir, checkpoint);
        // Load again
        await loadCheckpoint(tmpDir, 'e2e-perf');
      });

      console.log(`[PERF] Full checkpoint lifecycle: ${duration.toFixed(2)}ms`);
      expect(duration).toBeLessThan(150);
    });

    it('handles concurrent checkpoint operations efficiently', async () => {
      const operations = Array.from({ length: 20 }, (_, i) => {
        const checkpoint = createComplexCheckpoint(`concurrent-${i}`);
        return async () => {
          await saveCheckpoint(tmpDir, checkpoint);
          await loadCheckpoint(tmpDir, checkpoint.workflow_id);
          checkpoint.current_stage = 'spec';
          await saveCheckpoint(tmpDir, checkpoint);
        };
      });

      const { duration } = await measureTime(async () => {
        await Promise.all(operations.map(op => op()));
      });

      const avgDuration = duration / operations.length;
      console.log(`[PERF] Concurrent ops (20 workflows): ${duration.toFixed(2)}ms total, ${avgDuration.toFixed(2)}ms avg`);
      expect(avgDuration).toBeLessThan(100);
    });
  });
});
