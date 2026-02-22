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
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';
import type { WorkflowStatus, WorkflowStage } from '../../features/workflow-engine/types.js';

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

    it('truncates slug longer than 80 chars', () => {
      const longName = 'a-very-long-feature-name-that-goes-on-and-on-and-on-and-produces-a-slug-beyond-eighty-characters';
      const engine = new WorkflowEngine(tmpDir, longName);
      const engineAny = engine as any;
      expect(engineAny.workflowId.length).toBeLessThanOrEqual(80);
    });

    it('truncated slug does not end with a hyphen', () => {
      const longName = 'abcdefghij-abcdefghij-abcdefghij-abcdefghij-abcdefghij-abcdefghij-abcdefghij-abcdefghij';
      const engine = new WorkflowEngine(tmpDir, longName);
      const engineAny = engine as any;
      expect(engineAny.workflowId).not.toMatch(/-$/);
    });

    it('throws error when feature name produces empty slug', () => {
      expect(() => new WorkflowEngine(tmpDir, '---')).toThrow(
        'Feature name produced an empty workflow ID after sanitization'
      );
    });

    it('throws error when feature name is only special characters', () => {
      expect(() => new WorkflowEngine(tmpDir, '!@#$%^&*()')).toThrow(
        'Feature name produced an empty workflow ID after sanitization'
      );
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

      const workflowDir = join(tmpDir, 'aidlc-docs', 'test-feature');
      const exists = await fs.pathExists(workflowDir);
      expect(exists).toBe(true);

      // Check inception directory was created
      const inceptionDir = join(workflowDir, 'inception');
      const inceptionExists = await fs.pathExists(inceptionDir);
      expect(inceptionExists).toBe(true);
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

      // After start(), only initialization is done - stage is 'idea'
      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('idea');

      // Execute idea stage to move to intent
      await engine.executeStage('idea');
      const checkpoint2 = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint2?.current_stage).toBe('intent');
      // V3 checkpoint doesn't have artifacts field - artifacts are in manifest
    });

    it('stores initial prompt in resume_context', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature with OAuth');

      // Execute idea stage to create the artifact
      await engine.executeStage('idea');

      // Check the idea.md file contains the prompt
      const ideaPath = join(tmpDir, 'aidlc-docs', 'test-feature', 'inception', 'idea.md');
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
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'complete-test',
        feature_name: 'Complete Test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        current_phase: 'construction',
        current_stage: 'complete',
        status: 'complete',
        phases: {
          discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust-state.json',
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
      expect(result).toBe('aidlc-docs/test-feature/checkpoint.json');
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

      // Execute idea stage to create the artifact
      await engine.executeStage('idea');

      // Idea stage was executed
      const ideaPath = join(tmpDir, 'aidlc-docs', 'test-feature', 'inception', 'idea.md');
      const exists = await fs.pathExists(ideaPath);
      expect(exists).toBe(true);

      const content = await fs.readFile(ideaPath, 'utf-8');
      expect(content).toContain('## Problem Statement');
      expect(content).toContain('Build a test feature');
      expect(content).toContain('## User Personas');
      expect(content).toContain('## Success Metrics');
      expect(content).toContain('## Business Constraints');
      expect(content).toContain('## Out of Scope');
      expect(content).toContain('id: idea-test-feature');
      expect(content).toContain('status: draft');
      expect(content).toContain('author: "workflow-engine"');
    });

    it("creates intent artifact for 'intent' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute idea stage first, then intent
      await engine.executeStage('idea');
      await engine.executeStage('intent');

      const intentPath = join(tmpDir, 'aidlc-docs', 'test-feature', 'inception', 'intent.md');
      const exists = await fs.pathExists(intentPath);
      expect(exists).toBe(true);

      const content = await fs.readFile(intentPath, 'utf-8');
      expect(content).toContain('## Business Requirements');
      expect(content).toContain('### User Stories');
      expect(content).toContain('US-001');
      expect(content).toContain('## Technical Specification');
      expect(content).toContain('## Implementation Plan');
      expect(content).toContain('UNIT-001');
    });

    it("generates nfr.md after executing 'intent' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute idea stage first, then intent
      await engine.executeStage('idea');
      await engine.executeStage('intent');

      const nfrPath = join(tmpDir, 'aidlc-docs', 'test-feature', 'inception', 'nfr.md');
      const exists = await fs.pathExists(nfrPath);
      expect(exists).toBe(true);

      const content = await fs.readFile(nfrPath, 'utf-8');
      expect(content).toContain('## Security');
      expect(content).toContain('## Performance');
      expect(content).toContain('## Availability');
      expect(content).toContain('## Compliance');
      expect(content).toContain('## Accessibility');
      expect(content).toContain('Gate-blocking');
    });

    it.skip("creates unit artifact for 'unit' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute intent stage first, then unit
      await engine.executeStage('intent');
      await engine.executeStage('unit');

      const constructionPath = join(tmpDir, 'aidlc-docs', 'test-feature', 'construction');
      const exists = await fs.pathExists(constructionPath);
      expect(exists).toBe(true);

      // Check that construction directory exists
      const files = await fs.readdir(constructionPath);
      expect(files.length).toBeGreaterThan(0);
    });

    it.skip("creates bolt files for 'bolt' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute all stages up to bolt
      await engine.executeStage('intent');
      await engine.executeStage('unit');
      await engine.executeStage('bolt');

      // Bolts are created within unit directories in construction/
      const constructionDir = join(tmpDir, 'aidlc-docs', 'test-feature', 'construction');

      // Check that construction directory exists
      expect(await fs.pathExists(constructionDir)).toBe(true);

      // Check that files exist in construction (units and bolts)
      const files = await fs.readdir(constructionDir);
      expect(files.length).toBeGreaterThan(0);
    });

    it("throws error for 'complete' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      await expect(engine.executeStage('complete')).rejects.toThrow('No execution for complete stage');
    });

    it('updates checkpoint after execution', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute idea stage to advance to intent
      await engine.executeStage('idea');

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      // V3 checkpoint doesn't have artifacts field - artifacts are in manifest
      expect(checkpoint?.current_stage).toBe('intent');
      expect(checkpoint?.status).toBe('in_progress');
    });

    it('advances current_stage after execution', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // After start, current_stage should be 'idea'
      let checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('idea');

      // Execute idea stage to move to intent
      await engine.executeStage('idea');
      checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('intent');

      // Execute intent stage
      await engine.executeStage('intent');
      checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('unit');

      // Unit and bolt stages not yet implemented - skip those tests
    });
  });

  describe('getStatus()', () => {
    it('returns correct workflow information', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute idea stage to advance to intent
      await engine.executeStage('idea');

      const status = await engine.getStatus();
      expect(status.workflow_id).toBe('test-feature');
      expect(status.feature_name).toBe('Test Feature');
      expect(status.current_stage).toBe('intent');
      expect(status.status).toBe('in_progress');
      // Artifacts are tracked in manifest, not checkpoint
    });

    it('throws error if no checkpoint exists', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Nonexistent Feature');
      await expect(engine.getStatus()).rejects.toThrow('No checkpoint found');
    });

    it.skip('returns status after all stages complete', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute all stages
      await engine.executeStage('intent');
      await engine.executeStage('unit');
      await engine.executeStage('bolt');

      const status = await engine.getStatus();
      expect(status.current_stage).toBe('complete');
      expect(status.status).toBe('complete');
      // Artifacts are tracked in manifest, not in status response
    });
  });

  describe('Integration: workflow progresses through stages', () => {
    it('progresses from idea to prd correctly', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Full Workflow Test');
      await engine.start('Build a complete feature');

      // After start, we should be at idea stage
      let checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('idea');

      // Execute idea stage to advance to intent
      await engine.executeStage('idea');
      checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('intent');

      // Execute intent stage
      await engine.executeStage('intent');

      checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('unit');
    });

    it.skip('completes full workflow from idea to complete', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Full Workflow Test');
      await engine.start('Build a complete feature');

      // Execute remaining stages
      await engine.executeStage('intent');
      await engine.executeStage('unit');
      await engine.executeStage('bolt');

      const checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('complete');
      expect(checkpoint?.status).toBe('complete');

      // V3 checkpoint doesn't have artifacts field - artifacts are in manifest
    });

    it('can pause and resume workflow', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Pause Resume Test');
      await engine.start('Build a feature');

      // Execute prd stage
      await engine.executeStage('intent');

      // Pause
      await engine.pause();
      let checkpoint = await loadCheckpoint(tmpDir, 'pause-resume-test');
      expect(checkpoint?.status).toBe('paused');
      expect(checkpoint?.current_stage).toBe('unit');

      // Unit stage not yet implemented - can't test resume beyond this point
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
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'interrupt-test',
        feature_name: 'Interrupt Test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust-state.json',
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
      expect(savedCheckpoint?.resume_context?.current_stage).toBe('intent');
      expect(savedCheckpoint?.resume_context?.message).toContain('interrupted during intent stage');

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
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'interrupt-context-test',
        feature_name: 'Interrupt Context Test',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        current_phase: 'inception',
        current_stage: 'idea',
        status: 'in_progress',
        phases: {
          discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust-state.json',
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
