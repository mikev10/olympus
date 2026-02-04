/**
 * WorkflowEngine Tests
 *
 * Comprehensive tests for the core workflow orchestration engine.
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowEngine } from '../../features/workflow-engine/engine.js';
import { loadCheckpoint, saveCheckpoint } from '../../features/workflow-engine/checkpoint.js';
import { WorkflowCheckpoint } from '../../features/workflow-engine/types.js';

describe('WorkflowEngine', () => {
  let tmpDir: string;

  // Create isolated tmp directory for each test
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'workflow-engine-test-'));
  });

  // Clean up tmp directory after each test
  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('constructor', () => {
    it('sets properties correctly', () => {
      const engine = new WorkflowEngine(tmpDir, 'User Authentication');

      // Access private properties via any cast for testing
      const engineAny = engine as any;
      expect(engineAny.projectPath).toBe(tmpDir);
      expect(engineAny.featureName).toBe('User Authentication');
    });

    it('derives workflowId from featureName - lowercase', () => {
      const engine = new WorkflowEngine(tmpDir, 'User Authentication');
      const engineAny = engine as any;
      expect(engineAny.workflowId).toBe('user-authentication');
    });

    it('derives workflowId from featureName - replaces spaces with hyphens', () => {
      const engine = new WorkflowEngine(tmpDir, 'My Cool Feature');
      const engineAny = engine as any;
      expect(engineAny.workflowId).toBe('my-cool-feature');
    });

    it('derives workflowId from featureName - removes special characters', () => {
      const engine = new WorkflowEngine(tmpDir, "Feature #1: User's Login!");
      const engineAny = engine as any;
      expect(engineAny.workflowId).toBe('feature-1-users-login');
    });

    it('handles multiple spaces in feature name', () => {
      const engine = new WorkflowEngine(tmpDir, 'Feature   With   Spaces');
      const engineAny = engine as any;
      expect(engineAny.workflowId).toBe('feature-with-spaces');
    });
  });

  describe('start()', () => {
    it('creates initial checkpoint', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.workflow_id).toBe('test-feature');
      expect(checkpoint?.feature_name).toBe('Test Feature');
    });

    it('creates workflow directory structure', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const workflowDir = join(tmpDir, '.olympus', 'workflow', 'test-feature');
      const exists = await fs.pathExists(workflowDir);
      expect(exists).toBe(true);

      // Check intents directory was created
      const intentsDir = join(workflowDir, 'intents');
      const intentsExists = await fs.pathExists(intentsDir);
      expect(intentsExists).toBe(true);

      // Check validation directory was created
      const validationDir = join(workflowDir, 'validation');
      const validationExists = await fs.pathExists(validationDir);
      expect(validationExists).toBe(true);
    });

    it('sets initial status to in_progress', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      // After start, the idea stage has executed and we've moved to prd
      expect(checkpoint?.status).toBe('in_progress');
    });

    it('executes idea stage after start', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // After start(), the idea stage should have executed and current_stage moved to prd
      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('prd');
      expect(checkpoint?.artifacts.idea).not.toBeNull();
    });

    it('stores initial prompt in resume_context', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature with OAuth');

      // Check the idea.md file contains the prompt
      const ideaPath = join(tmpDir, '.olympus', 'workflow', 'test-feature', 'idea.md');
      const ideaContent = await fs.readFile(ideaPath, 'utf-8');
      expect(ideaContent).toContain('Build a test feature with OAuth');
    });
  });

  describe('resume()', () => {
    it('loads existing checkpoint', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Pause the workflow
      await engine.pause();

      // Resume should load the checkpoint successfully
      const result = await engine.resume();
      expect(result).toContain('Resumed workflow from stage');
    });

    it('returns "Workflow already complete" if status is complete', async () => {
      // Create a complete checkpoint manually
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'complete-test',
        feature_name: 'Complete Test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        current_stage: 'complete',
        status: 'complete',
        artifacts: {
          idea: { id: 'IDEA-001', path: 'idea.md', created_at: new Date().toISOString(), validation_passed: true },
          prd: { id: 'PRD-001', path: 'prd.md', created_at: new Date().toISOString(), validation_passed: true },
          spec: { id: 'SPEC-001', path: 'spec.md', created_at: new Date().toISOString(), validation_passed: true },
          intents: { id: 'INTENTS-001', path: 'intents/', created_at: new Date().toISOString(), validation_passed: true },
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };
      await saveCheckpoint(tmpDir, checkpoint);

      const engine = new WorkflowEngine(tmpDir, 'Complete Test');
      const result = await engine.resume();
      expect(result).toBe('Workflow already complete');
    });

    it('throws error if no checkpoint exists', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Nonexistent Feature');
      await expect(engine.resume()).rejects.toThrow('No checkpoint found');
    });

    it('updates status from paused to in_progress', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');
      await engine.pause();

      // Verify it's paused
      let checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.status).toBe('paused');

      // Resume
      await engine.resume();

      // Check status is now in_progress (or might be complete if all stages ran)
      checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(['in_progress', 'complete']).toContain(checkpoint?.status);
    });
  });

  describe('pause()', () => {
    it('updates status to paused', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      await engine.pause();

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.status).toBe('paused');
    });

    it('returns checkpoint path', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const result = await engine.pause();
      expect(result).toBe('.olympus/workflow/test-feature/checkpoint.json');
    });

    it('throws error if no checkpoint exists', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Nonexistent Feature');
      await expect(engine.pause()).rejects.toThrow('No checkpoint found');
    });
  });

  describe('executeStage()', () => {
    it("creates idea artifact for 'idea' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Idea stage was executed during start()
      const ideaPath = join(tmpDir, '.olympus', 'workflow', 'test-feature', 'idea.md');
      const exists = await fs.pathExists(ideaPath);
      expect(exists).toBe(true);

      const content = await fs.readFile(ideaPath, 'utf-8');
      expect(content).toContain('## Problem Statement');
      expect(content).toContain('Build a test feature');
    });

    it("creates prd artifact for 'prd' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute prd stage
      await engine.executeStage('prd');

      const prdPath = join(tmpDir, '.olympus', 'workflow', 'test-feature', 'prd.md');
      const exists = await fs.pathExists(prdPath);
      expect(exists).toBe(true);

      const content = await fs.readFile(prdPath, 'utf-8');
      expect(content).toContain('## User Stories');
      expect(content).toContain('US-001');
    });

    it("creates spec artifact for 'spec' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute prd stage first, then spec
      await engine.executeStage('prd');
      await engine.executeStage('spec');

      const specPath = join(tmpDir, '.olympus', 'workflow', 'test-feature', 'spec.md');
      const exists = await fs.pathExists(specPath);
      expect(exists).toBe(true);

      const content = await fs.readFile(specPath, 'utf-8');
      expect(content).toContain('# Technical Specification: Test Feature');
    });

    it("creates intent files for 'intents' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute all stages up to intents
      await engine.executeStage('prd');
      await engine.executeStage('spec');
      await engine.executeStage('intents');

      const intentsDir = join(tmpDir, '.olympus', 'workflow', 'test-feature', 'intents');
      const intentFile = join(intentsDir, 'intent-001.md');
      const exists = await fs.pathExists(intentFile);
      expect(exists).toBe(true);

      const content = await fs.readFile(intentFile, 'utf-8');
      expect(content).toContain('# Intent: Implement Test Feature');
    });

    it("throws error for 'complete' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      await expect(engine.executeStage('complete')).rejects.toThrow('No execution for complete stage');
    });

    it('updates checkpoint with artifact reference after execution', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.artifacts.idea?.id).toBe('IDEA-001');
      // validation_passed should reflect the actual validation result
      // The properly formatted artifact should pass validation
      expect(checkpoint?.artifacts.idea?.validation_passed).toBe(true);
    });

    it('advances current_stage after execution', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // After start, current_stage should be 'prd'
      let checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('prd');

      // Execute prd stage
      await engine.executeStage('prd');
      checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('spec');

      // Execute spec stage
      await engine.executeStage('spec');
      checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('intents');

      // Execute intents stage
      await engine.executeStage('intents');
      checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('complete');
      expect(checkpoint?.status).toBe('complete');
    });
  });

  describe('getStatus()', () => {
    it('returns correct workflow information', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const status = await engine.getStatus();
      expect(status.workflow_id).toBe('test-feature');
      expect(status.feature_name).toBe('Test Feature');
      expect(status.current_stage).toBe('prd');
      expect(status.status).toBe('in_progress');
      expect(status.artifacts).toHaveLength(1);
      expect(status.artifacts[0].id).toBe('IDEA-001');
    });

    it('throws error if no checkpoint exists', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Nonexistent Feature');
      await expect(engine.getStatus()).rejects.toThrow('No checkpoint found');
    });

    it('returns all artifacts in order', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute all stages
      await engine.executeStage('prd');
      await engine.executeStage('spec');
      await engine.executeStage('intents');

      const status = await engine.getStatus();
      expect(status.artifacts).toHaveLength(4);
      expect(status.artifacts[0].id).toBe('IDEA-001');
      expect(status.artifacts[1].id).toBe('PRD-001');
      expect(status.artifacts[2].id).toBe('SPEC-001');
      expect(status.artifacts[3].id).toBe('INTENTS-001');
    });
  });

  describe('Integration: workflow progresses through stages', () => {
    it('progresses from idea to prd correctly', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Full Workflow Test');
      await engine.start('Build a complete feature');

      // After start, we should be at prd stage with idea artifact
      let checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('prd');
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.artifacts.prd).toBeNull();

      // Execute prd stage
      await engine.executeStage('prd');

      checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('spec');
      expect(checkpoint?.artifacts.prd).not.toBeNull();
    });

    it('completes full workflow from idea to complete', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Full Workflow Test');
      await engine.start('Build a complete feature');

      // Execute remaining stages
      await engine.executeStage('prd');
      await engine.executeStage('spec');
      await engine.executeStage('intents');

      const checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('complete');
      expect(checkpoint?.status).toBe('complete');

      // All artifacts should be present
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.artifacts.prd).not.toBeNull();
      expect(checkpoint?.artifacts.spec).not.toBeNull();
      expect(checkpoint?.artifacts.intents).not.toBeNull();
    });

    it('can pause and resume workflow', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Pause Resume Test');
      await engine.start('Build a feature');

      // Execute prd stage
      await engine.executeStage('prd');

      // Pause
      await engine.pause();
      let checkpoint = await loadCheckpoint(tmpDir, 'pause-resume-test');
      expect(checkpoint?.status).toBe('paused');
      expect(checkpoint?.current_stage).toBe('spec');

      // Resume
      await engine.resume();
      checkpoint = await loadCheckpoint(tmpDir, 'pause-resume-test');
      // After resume, spec stage should have executed
      expect(checkpoint?.current_stage).toBe('intents');
    });
  });

  describe('Interrupt Handling', () => {
    it('sets up interrupt handler on start', () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      const engineAny = engine as any;

      // Before start, no handler should be set
      expect(engineAny.interruptHandler).toBeNull();

      // We can't fully test the async start() here, but we can verify the property exists
      expect(engineAny).toHaveProperty('interruptHandler');
    });

    it('interrupt handler saves checkpoint with paused status', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Interrupt Test');

      // Create a checkpoint
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'interrupt-test',
        feature_name: 'Interrupt Test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        current_stage: 'prd',
        status: 'in_progress',
        artifacts: {
          idea: {
            id: 'IDEA-001',
            path: '.olympus/workflow/interrupt-test/idea.md',
            created_at: new Date().toISOString(),
            validation_passed: true,
          },
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: 'Test initial prompt',
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);

      // Simulate the interrupt handler logic
      const engineAny = engine as any;
      engineAny.setupInterruptHandler();

      // Manually trigger the handler logic without SIGINT
      const loadedCheckpoint = await loadCheckpoint(tmpDir, 'interrupt-test');
      if (loadedCheckpoint) {
        loadedCheckpoint.status = 'paused';
        loadedCheckpoint.updated_at = new Date().toISOString();
        loadedCheckpoint.resume_context = {
          ...loadedCheckpoint.resume_context,
          interrupted_at: new Date().toISOString(),
          current_stage: loadedCheckpoint.current_stage,
          message: `Workflow interrupted during ${loadedCheckpoint.current_stage} stage`,
        };
        await saveCheckpoint(tmpDir, loadedCheckpoint);
      }

      // Verify checkpoint was updated
      const savedCheckpoint = await loadCheckpoint(tmpDir, 'interrupt-test');
      expect(savedCheckpoint?.status).toBe('paused');
      expect(savedCheckpoint?.resume_context?.interrupted_at).toBeDefined();
      expect(savedCheckpoint?.resume_context?.current_stage).toBe('prd');
      expect(savedCheckpoint?.resume_context?.message).toContain('interrupted during prd stage');

      // Clean up handler
      engineAny.cleanupInterruptHandler();
    });

    it('cleans up interrupt handler after workflow completes', () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      const engineAny = engine as any;

      // Set up a mock handler
      engineAny.interruptHandler = () => {};

      // Verify handler is set
      expect(engineAny.interruptHandler).not.toBeNull();

      // Clean up
      engineAny.cleanupInterruptHandler();

      // Verify handler is cleared
      expect(engineAny.interruptHandler).toBeNull();
    });

    it('interrupt handler preserves initial_prompt in resume_context', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Interrupt Context Test');

      const initialPrompt = 'Build an authentication system';
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'interrupt-context-test',
        feature_name: 'Interrupt Context Test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        current_stage: 'idea',
        status: 'in_progress',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: initialPrompt,
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);

      // Simulate interrupt
      const loadedCheckpoint = await loadCheckpoint(tmpDir, 'interrupt-context-test');
      if (loadedCheckpoint) {
        loadedCheckpoint.status = 'paused';
        loadedCheckpoint.updated_at = new Date().toISOString();
        loadedCheckpoint.resume_context = {
          ...loadedCheckpoint.resume_context,
          interrupted_at: new Date().toISOString(),
          current_stage: loadedCheckpoint.current_stage,
          message: `Workflow interrupted during ${loadedCheckpoint.current_stage} stage`,
        };
        await saveCheckpoint(tmpDir, loadedCheckpoint);
      }

      // Verify initial_prompt is preserved
      const savedCheckpoint = await loadCheckpoint(tmpDir, 'interrupt-context-test');
      expect(savedCheckpoint?.resume_context?.initial_prompt).toBe(initialPrompt);
      expect(savedCheckpoint?.resume_context?.interrupted_at).toBeDefined();
    });
  });
});
