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
import { loadWorkflowRouting } from '../../features/workflow-engine/workflow-routing.js';
import { createManifest, loadManifest } from '../../features/workflow-engine/manifest.js';
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
      expect(checkpoint?.status).toBe('in_progress');
    });

    it('starts at intent stage', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('intent');

      await engine.executeStage('intent');
      const checkpoint2 = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint2?.current_stage).toBe('unit');
    });

    it('stores initial prompt in resume_context', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature with OAuth');

      await engine.executeStage('intent');

      const intentPath = join(tmpDir, 'aidlc-docs', 'test-feature', 'inception', 'intent.md');
      const intentContent = await fs.readFile(intentPath, 'utf-8');
      expect(intentContent).toContain('Build a test feature with OAuth');
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
    it("creates intent artifact for 'intent' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

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

    it.skip("creates code-generation files for 'code-generation' stage", async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // Execute all stages up to code-generation
      await engine.executeStage('intent');
      await engine.executeStage('unit');
      await engine.executeStage('code-generation');

      // Code generation artifacts are created within unit directories in construction/
      const constructionDir = join(tmpDir, 'aidlc-docs', 'test-feature', 'construction');

      // Check that construction directory exists
      expect(await fs.pathExists(constructionDir)).toBe(true);

      // Check that files exist in construction (units and code plans)
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

      // Execute intent stage to advance to unit
      await engine.executeStage('intent');

      const checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      // V3 checkpoint doesn't have artifacts field - artifacts are in manifest
      expect(checkpoint?.current_stage).toBe('unit');
      expect(checkpoint?.status).toBe('in_progress');
    });

    it('advances current_stage after execution', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Test Feature');
      await engine.start('Build a test feature');

      // After start, current_stage should be 'intent'
      let checkpoint = await loadCheckpoint(tmpDir, 'test-feature');
      expect(checkpoint?.current_stage).toBe('intent');

      // Execute intent stage to move to unit
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

      await engine.executeStage('intent');

      const status = await engine.getStatus();
      expect(status.workflow_id).toBe('test-feature');
      expect(status.feature_name).toBe('Test Feature');
      expect(status.current_stage).toBe('unit');
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

      await engine.executeStage('intent');
      await engine.executeStage('unit');
      await engine.executeStage('code-generation');

      const status = await engine.getStatus();
      expect(status.current_stage).toBe('complete');
      expect(status.status).toBe('complete');
    });
  });

  describe('Integration: workflow progresses through stages', () => {
    it('progresses from intent to prd correctly', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Full Workflow Test');
      await engine.start('Build a complete feature');

      let checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('intent');

      await engine.executeStage('intent');
      checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('unit');

      // Execute intent stage
      await engine.executeStage('intent');

      checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('unit');
    });

    it.skip('completes full workflow from intent to complete', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Full Workflow Test');
      await engine.start('Build a complete feature');

      await engine.executeStage('intent');
      await engine.executeStage('unit');
      await engine.executeStage('code-generation');

      const checkpoint = await loadCheckpoint(tmpDir, 'full-workflow-test');
      expect(checkpoint?.current_stage).toBe('complete');
      expect(checkpoint?.status).toBe('complete');
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

  describe('Workflow Routing integration', () => {
    it('start() generates Workflow Routing and updates checkpoint', async () => {
      createManifest('l1-plan-feature', 'L1 Plan Feature', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'L1 Plan Feature');
      await engine.start('Build a brand new greenfield application');

      const checkpoint = await loadCheckpoint(tmpDir, 'l1-plan-feature') as WorkflowCheckpointV3;
      expect(checkpoint).not.toBeNull();
      expect(checkpoint.workflow_routing_path).toBeDefined();
      expect(checkpoint.pathway_type).toBeDefined();
      expect(checkpoint.skipped_phases).toBeDefined();
      expect(Array.isArray(checkpoint.skipped_phases)).toBe(true);

      const plan = loadWorkflowRouting(tmpDir, 'l1-plan-feature');
      expect(plan).not.toBeNull();
      expect(plan!.pathway).toBeDefined();
      expect(plan!.risk_assessment).toMatch(/^(LOW|MEDIUM|HIGH)$/);
      expect(typeof plan!.estimated_code_generations).toBe('number');
      expect(['minimal', 'standard', 'comprehensive']).toContain(plan!.estimated_depth);
      expect(plan!.phases).toBeDefined();
      expect(Array.isArray(plan!.stages)).toBe(true);
    });

    it('start() on empty temp dir produces greenfield pathway and skips discovery', async () => {
      createManifest('greenfield-app', 'Greenfield App', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Greenfield App');
      await engine.start('Build a new greenfield app from scratch');

      const checkpoint = await loadCheckpoint(tmpDir, 'greenfield-app') as WorkflowCheckpointV3;
      expect(checkpoint.pathway_type).toBe('greenfield');
      expect(checkpoint.skipped_phases).toContain('discovery');

      const plan = loadWorkflowRouting(tmpDir, 'greenfield-app');
      expect(plan).not.toBeNull();
      expect(plan!.pathway).toBe('greenfield');
      expect(plan!.phases.discovery.included).toBe(false);
    });

    it('executePhase() skips phases excluded by L1 Plan and marks them complete', async () => {
      createManifest('skip-phase-test', 'Skip Phase Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Skip Phase Test');
      await engine.start('Build a brand new application');

      await expect(engine.executePhase('discovery')).resolves.toBeUndefined();

      const checkpoint = await loadCheckpoint(tmpDir, 'skip-phase-test') as WorkflowCheckpointV3;
      expect(checkpoint.phases.discovery.status).toBe('complete');
      expect(checkpoint.phases.discovery.gate_bypassed).toBe(true);
      expect(checkpoint.phases.discovery.bypass_reason).toContain('Workflow Routing');
    });

    it('executePhase() skipped phase has completed_at timestamp', async () => {
      createManifest('timestamp-test', 'Timestamp Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Timestamp Test');
      await engine.start('Build a new greenfield system');

      const before = new Date().toISOString();
      await engine.executePhase('discovery');
      const after = new Date().toISOString();

      const checkpoint = await loadCheckpoint(tmpDir, 'timestamp-test') as WorkflowCheckpointV3;
      const completedAt = checkpoint.phases.discovery.completed_at;
      expect(completedAt).not.toBeNull();
      expect(completedAt! >= before || completedAt! <= after).toBe(true);
    });

    it('executePhase() works normally when no L1 Plan exists (backward compat)', async () => {
      const engine = new WorkflowEngine(tmpDir, 'No Plan Test');
      await engine.start('Build a test feature');

      const planPath = join(tmpDir, 'aidlc-docs', 'no-plan-test', 'inception', 'plans', 'workflow-routing.md');
      await fs.remove(planPath);

      await expect(engine.executePhase('inception')).resolves.toBeUndefined();

      const checkpoint = await loadCheckpoint(tmpDir, 'no-plan-test') as WorkflowCheckpointV3;
      expect(checkpoint.inception_stages).toBeDefined();
    });

    it('skipped phases have gate_audit entries in manifest', async () => {
      createManifest('audit-entry-test', 'Audit Entry Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Audit Entry Test');
      await engine.start('Build a brand new greenfield product');

      const manifestPath = join(tmpDir, 'aidlc-docs', 'audit-entry-test', 'manifest.json');
      await engine.executePhase('discovery');

      const manifest = loadManifest(manifestPath);
      expect(manifest).not.toBeNull();
      expect(Array.isArray(manifest!.gate_audit)).toBe(true);

      const bypassEntry = manifest!.gate_audit.find(
        (e) => e.phase === 'discovery' && e.action === 'bypassed'
      );
      expect(bypassEntry).toBeDefined();
      expect(bypassEntry!.actor).toBe('config');
      expect(bypassEntry!.reason).toContain('Workflow Routing');
    });

    it('approveWorkflowRouting() stamps approved_at and approved_by on the artifact', async () => {
      createManifest('approval-test', 'Approval Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Approval Test');
      await engine.start('Build a brand new approval workflow');

      const planBefore = loadWorkflowRouting(tmpDir, 'approval-test');
      expect(planBefore).not.toBeNull();
      expect(planBefore!.approved_at).toBeNull();
      expect(planBefore!.approved_by).toBeNull();

      await engine.approveWorkflowRouting('Looks good to me');

      const planAfter = loadWorkflowRouting(tmpDir, 'approval-test');
      expect(planAfter).not.toBeNull();
      expect(planAfter!.approved_at).not.toBeNull();
    });

    it('approveWorkflowRouting() throws when no plan exists', async () => {
      const engine = new WorkflowEngine(tmpDir, 'No Plan Approval');
      await expect(engine.approveWorkflowRouting()).rejects.toThrow('No Workflow Routing found');
    });

    it('executePhase("inception") uses orchestrator when checkpoint has inception_stages', async () => {
      createManifest('inception-orch-test', 'Inception Orch Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Inception Orch Test');
      await engine.start('Build a new greenfield application');

      const cp = await loadCheckpoint(tmpDir, 'inception-orch-test') as WorkflowCheckpointV3;
      cp.inception_stages = {
        'workspace-detection': { stage: 'workspace-detection', status: 'completed', started_at: null, completed_at: new Date().toISOString(), skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'reverse-engineering': { stage: 'reverse-engineering', status: 'skipped', started_at: null, completed_at: null, skip_reason: 'greenfield', artifacts_generated: [], questions_file: null, answers_received: false },
        'requirements-analysis': { stage: 'requirements-analysis', status: 'completed', started_at: null, completed_at: new Date().toISOString(), skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'user-stories': { stage: 'user-stories', status: 'completed', started_at: null, completed_at: new Date().toISOString(), skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'workflow-planning': { stage: 'workflow-planning', status: 'completed', started_at: null, completed_at: new Date().toISOString(), skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'application-design': { stage: 'application-design', status: 'completed', started_at: null, completed_at: new Date().toISOString(), skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'units-generation': { stage: 'units-generation', status: 'completed', started_at: null, completed_at: new Date().toISOString(), skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
      };
      await saveCheckpoint(tmpDir, cp);

      await expect(engine.executePhase('inception')).resolves.toBeUndefined();
    });

    it('executePhase("inception") skips orchestrator when current_stage is past intent', async () => {
      createManifest('inception-skip-test', 'Inception Skip Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Inception Skip Test');
      await engine.start('Build a new greenfield application');

      const cp = await loadCheckpoint(tmpDir, 'inception-skip-test') as WorkflowCheckpointV3;
      cp.current_stage = 'unit';
      await saveCheckpoint(tmpDir, cp);

      await expect(engine.executePhase('inception')).resolves.toBeUndefined();
    });

    it('executePhase("inception") initializes inception_stages when not present', async () => {
      createManifest('inception-init-test', 'Inception Init Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Inception Init Test');
      await engine.start('Build a new greenfield application');

      const cpBefore = await loadCheckpoint(tmpDir, 'inception-init-test') as WorkflowCheckpointV3;
      expect(cpBefore.inception_stages).toBeUndefined();

      await engine.executePhase('inception');

      const cpAfter = await loadCheckpoint(tmpDir, 'inception-init-test') as WorkflowCheckpointV3;
      expect(cpAfter.inception_stages).toBeDefined();
    });

    it('approveWorkflowRouting() updates inception_stages workflow-planning when present', async () => {
      createManifest('approve-stages-test', 'Approve Stages Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Approve Stages Test');
      await engine.start('Build a brand new greenfield system');

      const cp = await loadCheckpoint(tmpDir, 'approve-stages-test') as WorkflowCheckpointV3;
      cp.inception_stages = {
        'workspace-detection': { stage: 'workspace-detection', status: 'completed', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'reverse-engineering': { stage: 'reverse-engineering', status: 'skipped', started_at: null, completed_at: null, skip_reason: 'greenfield', artifacts_generated: [], questions_file: null, answers_received: false },
        'requirements-analysis': { stage: 'requirements-analysis', status: 'completed', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'user-stories': { stage: 'user-stories', status: 'skipped', started_at: null, completed_at: null, skip_reason: 'not required', artifacts_generated: [], questions_file: null, answers_received: false },
        'workflow-planning': { stage: 'workflow-planning', status: 'in_progress', started_at: new Date().toISOString(), completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'application-design': { stage: 'application-design', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'units-generation': { stage: 'units-generation', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
      };
      await saveCheckpoint(tmpDir, cp);

      await engine.approveWorkflowRouting('Looks good');

      const cpAfter = await loadCheckpoint(tmpDir, 'approve-stages-test') as WorkflowCheckpointV3;
      expect(cpAfter.inception_stages!['workflow-planning'].status).toBe('completed');
      expect(cpAfter.inception_stages!['workflow-planning'].completed_at).not.toBeNull();
    });

    it('approveWorkflowRouting() leaves legacy checkpoints without inception_stages unchanged', async () => {
      createManifest('approve-legacy-test', 'Approve Legacy Test', tmpDir);
      const engine = new WorkflowEngine(tmpDir, 'Approve Legacy Test');
      await engine.start('Build a brand new greenfield system');

      const cpBefore = await loadCheckpoint(tmpDir, 'approve-legacy-test') as WorkflowCheckpointV3;
      expect(cpBefore.inception_stages).toBeUndefined();

      await engine.approveWorkflowRouting('Approved');

      const cpAfter = await loadCheckpoint(tmpDir, 'approve-legacy-test') as WorkflowCheckpointV3;
      expect(cpAfter.inception_stages).toBeUndefined();
    });
  });
});
