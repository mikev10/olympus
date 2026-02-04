import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';
import {
  generateDependencyGraph,
  validateDependencyGraph,
  getExecutionOrder,
  linkMasterPlan,
} from '../../features/workflow-engine/index.js';
import { IntentTask } from '../../features/workflow-engine/types.js';

describe('Dependency Graph', () => {
  describe('generateDependencyGraph', () => {
    it('should create nodes from tasks', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Auth',
          estimated_effort: 3,
          dependencies: [],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Auth',
          estimated_effort: 2,
          dependencies: ['A'],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes[0]).toEqual({
        id: 'A',
        title: 'Task A',
        component: 'Auth',
        estimated_effort: 3,
      });
      expect(graph.nodes[1]).toEqual({
        id: 'B',
        title: 'Task B',
        component: 'Auth',
        estimated_effort: 2,
      });
    });

    it('should create edges from dependencies', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Auth',
          estimated_effort: 3,
          dependencies: [],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Auth',
          estimated_effort: 2,
          dependencies: ['A'],
        },
        {
          id: 'C',
          title: 'Task C',
          component: 'DB',
          estimated_effort: 5,
          dependencies: ['A', 'B'],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(graph.edges).toHaveLength(3);
      expect(graph.edges).toContainEqual({ from: 'A', to: 'B' });
      expect(graph.edges).toContainEqual({ from: 'A', to: 'C' });
      expect(graph.edges).toContainEqual({ from: 'B', to: 'C' });
    });
  });

  describe('validateDependencyGraph', () => {
    it('should pass for valid graph', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Auth',
          estimated_effort: 3,
          dependencies: [],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Auth',
          estimated_effort: 2,
          dependencies: ['A'],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(() => validateDependencyGraph(graph)).not.toThrow();
    });

    it('should detect circular dependencies', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Test',
          estimated_effort: 1,
          dependencies: ['B'],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Test',
          estimated_effort: 1,
          dependencies: ['C'],
        },
        {
          id: 'C',
          title: 'Task C',
          component: 'Test',
          estimated_effort: 1,
          dependencies: ['A'],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(() => validateDependencyGraph(graph)).toThrow(/Circular dependency detected/);
    });

    it('should detect duplicate node IDs', () => {
      const graph = {
        nodes: [
          {
            id: 'A',
            title: 'Task A',
            component: 'Test',
            estimated_effort: 1,
          },
          {
            id: 'A',
            title: 'Task A Duplicate',
            component: 'Test',
            estimated_effort: 2,
          },
        ],
        edges: [],
      };

      expect(() => validateDependencyGraph(graph)).toThrow(/Duplicate node ID detected: A/);
    });

    it('should detect edges referencing non-existent nodes', () => {
      const graph = {
        nodes: [
          {
            id: 'A',
            title: 'Task A',
            component: 'Test',
            estimated_effort: 1,
          },
        ],
        edges: [{ from: 'A', to: 'B' }],
      };

      expect(() => validateDependencyGraph(graph)).toThrow(
        /Edge references non-existent node: B/
      );
    });
  });

  describe('getExecutionOrder', () => {
    it('should return topological sort for simple graph', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Auth',
          estimated_effort: 3,
          dependencies: [],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Auth',
          estimated_effort: 2,
          dependencies: ['A'],
        },
        {
          id: 'C',
          title: 'Task C',
          component: 'DB',
          estimated_effort: 5,
          dependencies: ['A'],
        },
      ];

      const graph = generateDependencyGraph(tasks);
      const order = getExecutionOrder(graph);

      expect(order).toHaveLength(3);
      expect(order[0]).toBe('A');
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
    });

    it('should handle complex dependency chains', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Auth',
          estimated_effort: 3,
          dependencies: [],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Auth',
          estimated_effort: 2,
          dependencies: ['A'],
        },
        {
          id: 'C',
          title: 'Task C',
          component: 'DB',
          estimated_effort: 5,
          dependencies: ['A'],
        },
        {
          id: 'D',
          title: 'Task D',
          component: 'API',
          estimated_effort: 4,
          dependencies: ['B', 'C'],
        },
      ];

      const graph = generateDependencyGraph(tasks);
      const order = getExecutionOrder(graph);

      expect(order).toHaveLength(4);
      expect(order[0]).toBe('A');
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
      expect(order.indexOf('A')).toBeLessThan(order.indexOf('C'));
      expect(order.indexOf('B')).toBeLessThan(order.indexOf('D'));
      expect(order.indexOf('C')).toBeLessThan(order.indexOf('D'));
    });

    it('should throw error for graphs with cycles', () => {
      const tasks: IntentTask[] = [
        {
          id: 'A',
          title: 'Task A',
          component: 'Test',
          estimated_effort: 1,
          dependencies: ['B'],
        },
        {
          id: 'B',
          title: 'Task B',
          component: 'Test',
          estimated_effort: 1,
          dependencies: ['A'],
        },
      ];

      const graph = generateDependencyGraph(tasks);

      expect(() => getExecutionOrder(graph)).toThrow(/graph contains cycles/);
    });
  });

  describe('linkMasterPlan', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'olympus-dep-graph-test-'));
    });

    afterEach(async () => {
      await fs.remove(tmpDir);
    });

    it('should create new plan file with artifacts section', async () => {
      await linkMasterPlan(tmpDir, 'test-workflow-001');

      const planPath = path.join(tmpDir, '.olympus', 'plans', 'test-workflow-001-plan.md');
      expect(await fs.pathExists(planPath)).toBe(true);

      const content = await fs.readFile(planPath, 'utf-8');
      expect(content).toContain('# Plan: test-workflow-001');
      expect(content).toContain('## Structured Artifacts');
      expect(content).toContain('[IDEA Artifact]');
      expect(content).toContain('[PRD Artifact]');
      expect(content).toContain('[SPEC Artifact]');
      expect(content).toContain('[Intent Files]');
      expect(content).toContain('[Dependency Graph]');
      expect(content).toContain('[Workflow Checkpoint]');
    });

    it('should update existing plan file without artifacts section', async () => {
      const plansDir = path.join(tmpDir, '.olympus', 'plans');
      await fs.ensureDir(plansDir);

      const planPath = path.join(plansDir, 'test-workflow-002-plan.md');
      const existingContent = '# My Existing Plan\n\nSome content here.\n\n## Other Section\n\nMore content.';
      await fs.writeFile(planPath, existingContent, 'utf-8');

      await linkMasterPlan(tmpDir, 'test-workflow-002');

      const updatedContent = await fs.readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('My Existing Plan');
      expect(updatedContent).toContain('Other Section');
      expect(updatedContent).toContain('## Structured Artifacts');
    });

    it('should replace existing artifacts section', async () => {
      const plansDir = path.join(tmpDir, '.olympus', 'plans');
      await fs.ensureDir(plansDir);

      const planPath = path.join(plansDir, 'test-workflow-003-plan.md');
      const existingContent = `# Plan

## Structured Artifacts

Old artifacts section.

## Next Section

More content.`;
      await fs.writeFile(planPath, existingContent, 'utf-8');

      await linkMasterPlan(tmpDir, 'test-workflow-003');

      const updatedContent = await fs.readFile(planPath, 'utf-8');
      expect(updatedContent).toContain('[IDEA Artifact]');
      expect(updatedContent).not.toContain('Old artifacts section');
      expect(updatedContent).toContain('## Next Section');
    });
  });
});
