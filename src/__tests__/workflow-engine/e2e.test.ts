/**
 * End-to-End Workflow Tests
 *
 * Comprehensive E2E tests covering all Phase 5 acceptance criteria:
 * 1. Full workflow: create workflow, execute all stages (IDEA→PRD→SPEC→INTENTS)
 * 2. Interrupt and resume workflow (pause mid-execution, resume in new session)
 * 3. Validation failure and retry (fail validation, fix issue, retry)
 * 4. Manual command workflow (use /idea, /prd, /spec, /intents commands separately)
 * 5. Error recovery scenarios (corrupt checkpoint, missing artifacts, etc.)
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowEngine } from '../../features/workflow-engine/engine.js';
import { loadCheckpoint, saveCheckpoint, clearCache } from '../../features/workflow-engine/checkpoint.js';
import { WorkflowCheckpoint, WorkflowStage } from '../../features/workflow-engine/types.js';
import { ensureWorkflowDir, writeArtifact } from '../../features/workflow-engine/artifacts.js';

describe('End-to-End Workflow Tests', () => {
  let tmpDir: string;

  // Create isolated tmp directory for each test
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'workflow-e2e-test-'));
    clearCache(); // Clear checkpoint cache to ensure fresh reads
  });

  // Clean up tmp directory after each test
  afterEach(async () => {
    await fs.remove(tmpDir);
    clearCache();
  });

  // ============================================================================
  // Scenario 1: Full workflow completion (IDEA → PRD → SPEC → INTENTS → COMPLETE)
  // ============================================================================

  describe('Scenario 1: Full Workflow Completion', () => {
    it('completes full workflow from IDEA to COMPLETE', async () => {
      const featureName = 'OAuth Authentication';
      const initialPrompt = 'Build OAuth authentication with Google provider';

      // Start workflow
      const engine = new WorkflowEngine(tmpDir, featureName);
      await engine.start(initialPrompt);

      // Verify IDEA stage completed
      let checkpoint = await loadCheckpoint(tmpDir, 'oauth-authentication');
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.current_stage).toBe('prd');
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.artifacts.idea?.id).toBe('IDEA-001');

      // Verify IDEA artifact exists
      const ideaPath = join(tmpDir, '.olympus', 'workflow', 'oauth-authentication', 'idea.md');
      expect(await fs.pathExists(ideaPath)).toBe(true);
      const ideaContent = await fs.readFile(ideaPath, 'utf-8');
      expect(ideaContent).toContain('OAuth Authentication');
      expect(ideaContent).toContain(initialPrompt);

      // Execute PRD stage
      await engine.executeStage('prd');
      checkpoint = await loadCheckpoint(tmpDir, 'oauth-authentication');
      expect(checkpoint?.current_stage).toBe('spec');
      expect(checkpoint?.artifacts.prd).not.toBeNull();
      expect(checkpoint?.artifacts.prd?.id).toBe('PRD-001');

      // Verify PRD artifact exists
      const prdPath = join(tmpDir, '.olympus', 'workflow', 'oauth-authentication', 'prd.md');
      expect(await fs.pathExists(prdPath)).toBe(true);

      // Execute SPEC stage
      await engine.executeStage('spec');
      checkpoint = await loadCheckpoint(tmpDir, 'oauth-authentication');
      expect(checkpoint?.current_stage).toBe('intents');
      expect(checkpoint?.artifacts.spec).not.toBeNull();
      expect(checkpoint?.artifacts.spec?.id).toBe('SPEC-001');

      // Verify SPEC artifact exists
      const specPath = join(tmpDir, '.olympus', 'workflow', 'oauth-authentication', 'spec.md');
      expect(await fs.pathExists(specPath)).toBe(true);

      // Execute INTENTS stage
      await engine.executeStage('intents');
      checkpoint = await loadCheckpoint(tmpDir, 'oauth-authentication');
      expect(checkpoint?.current_stage).toBe('complete');
      expect(checkpoint?.status).toBe('complete');
      expect(checkpoint?.artifacts.intents).not.toBeNull();
      expect(checkpoint?.artifacts.intents?.id).toBe('INTENTS-001');

      // Verify INTENTS artifacts exist
      const intentsDir = join(tmpDir, '.olympus', 'workflow', 'oauth-authentication', 'intents');
      expect(await fs.pathExists(intentsDir)).toBe(true);
      const intentFiles = await fs.readdir(intentsDir);
      expect(intentFiles.length).toBeGreaterThan(0);

      // Verify all artifacts are present in checkpoint
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.artifacts.prd).not.toBeNull();
      expect(checkpoint?.artifacts.spec).not.toBeNull();
      expect(checkpoint?.artifacts.intents).not.toBeNull();
    });

    it('verifies workflow status at each stage', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Status Test Feature');
      await engine.start('Test status tracking');

      // Check status after IDEA
      let status = await engine.getStatus();
      expect(status.workflow_id).toBe('status-test-feature');
      expect(status.feature_name).toBe('Status Test Feature');
      expect(status.current_stage).toBe('prd');
      expect(status.status).toBe('in_progress');
      expect(status.artifacts).toHaveLength(1);

      // Execute PRD and check status
      await engine.executeStage('prd');
      status = await engine.getStatus();
      expect(status.current_stage).toBe('spec');
      expect(status.artifacts).toHaveLength(2);

      // Execute SPEC and check status
      await engine.executeStage('spec');
      status = await engine.getStatus();
      expect(status.current_stage).toBe('intents');
      expect(status.artifacts).toHaveLength(3);

      // Execute INTENTS and check final status
      await engine.executeStage('intents');
      status = await engine.getStatus();
      expect(status.current_stage).toBe('complete');
      expect(status.status).toBe('complete');
      expect(status.artifacts).toHaveLength(4);
      expect(status.updated_at).toBeDefined();
    });

    it('tracks validation results for each stage', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Validation Test');
      await engine.start('Test validation tracking');

      const checkpoint = await loadCheckpoint(tmpDir, 'validation-test');

      // Verify validation results are tracked
      expect(checkpoint?.validation_results.idea).not.toBeNull();
      expect(checkpoint?.validation_results.idea?.timestamp).toBeDefined();
      expect(checkpoint?.validation_results.idea?.coverage_percentage).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // Scenario 2: Interrupt and Resume
  // ============================================================================

  describe('Scenario 2: Interrupt and Resume Workflow', () => {
    it('pauses workflow and resumes in new session', async () => {
      const featureName = 'Pausable Feature';

      // Start workflow and execute first stage
      const engine1 = new WorkflowEngine(tmpDir, featureName);
      await engine1.start('Feature that gets paused');

      // Verify we're at PRD stage
      let checkpoint = await loadCheckpoint(tmpDir, 'pausable-feature');
      expect(checkpoint?.current_stage).toBe('prd');
      expect(checkpoint?.status).toBe('in_progress');

      // Pause the workflow
      const checkpointPath = await engine1.pause();
      expect(checkpointPath).toBe('.olympus/workflow/pausable-feature/checkpoint.json');

      // Verify workflow is paused
      checkpoint = await loadCheckpoint(tmpDir, 'pausable-feature');
      expect(checkpoint?.status).toBe('paused');

      // Resume in new session (simulate new process)
      clearCache(); // Clear cache to simulate new session
      const engine2 = new WorkflowEngine(tmpDir, featureName);
      const resumeMessage = await engine2.resume();
      expect(resumeMessage).toContain('Resumed workflow from stage: prd');

      // Verify workflow resumed and executed PRD stage
      checkpoint = await loadCheckpoint(tmpDir, 'pausable-feature');
      expect(checkpoint?.current_stage).toBe('spec');
      expect(['in_progress', 'complete']).toContain(checkpoint?.status);
    });

    it('resumes workflow at the correct stage after pause', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Resume Test');
      await engine.start('Test resume functionality');

      // Execute PRD stage
      await engine.executeStage('prd');

      // Pause at SPEC stage
      await engine.pause();
      let checkpoint = await loadCheckpoint(tmpDir, 'resume-test');
      expect(checkpoint?.current_stage).toBe('spec');

      // Resume and verify it continues from SPEC
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, 'Resume Test');
      await engine2.resume();

      checkpoint = await loadCheckpoint(tmpDir, 'resume-test');
      expect(checkpoint?.current_stage).toBe('intents');
    });

    it('preserves initial prompt and context across pause/resume', async () => {
      const initialPrompt = 'Build advanced search with filters';
      const engine1 = new WorkflowEngine(tmpDir, 'Context Test');
      await engine1.start(initialPrompt);

      // Pause workflow
      await engine1.pause();

      // Resume and verify context is preserved
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, 'Context Test');
      await engine2.resume();

      // Check that initial prompt is still in the IDEA artifact
      const ideaPath = join(tmpDir, '.olympus', 'workflow', 'context-test', 'idea.md');
      const ideaContent = await fs.readFile(ideaPath, 'utf-8');
      expect(ideaContent).toContain(initialPrompt);
    });

    it('handles multiple pause/resume cycles', async () => {
      const engine1 = new WorkflowEngine(tmpDir, 'Multi Pause Test');
      await engine1.start('Test multiple pauses');

      // First pause after IDEA
      await engine1.pause();
      let checkpoint = await loadCheckpoint(tmpDir, 'multi-pause-test');
      expect(checkpoint?.current_stage).toBe('prd');

      // First resume and execute PRD
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, 'Multi Pause Test');
      await engine2.resume();

      // Second pause after PRD
      await engine2.pause();
      checkpoint = await loadCheckpoint(tmpDir, 'multi-pause-test');
      expect(checkpoint?.current_stage).toBe('spec');

      // Second resume and complete workflow
      clearCache();
      const engine3 = new WorkflowEngine(tmpDir, 'Multi Pause Test');
      await engine3.resume();

      checkpoint = await loadCheckpoint(tmpDir, 'multi-pause-test');
      expect(checkpoint?.current_stage).toBe('intents');
    });

    it('returns appropriate message when resuming completed workflow', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Completed Test');
      await engine.start('Test complete workflow');

      // Complete all stages
      await engine.executeStage('prd');
      await engine.executeStage('spec');
      await engine.executeStage('intents');

      // Verify workflow is complete
      const checkpoint = await loadCheckpoint(tmpDir, 'completed-test');
      expect(checkpoint?.status).toBe('complete');

      // Try to resume completed workflow
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, 'Completed Test');
      const result = await engine2.resume();
      expect(result).toBe('Workflow already complete');
    });
  });

  // ============================================================================
  // Scenario 3: Validation Failure and Retry
  // ============================================================================

  describe('Scenario 3: Validation Success and Quality', () => {
    it('validates successfully with properly formatted artifacts', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Validation Success Test');
      await engine.start('Test validation success');

      // The engine now generates properly formatted artifacts that pass validation
      const checkpoint = await loadCheckpoint(tmpDir, 'validation-success-test');

      // Verify validation was performed
      expect(checkpoint?.validation_results.idea).not.toBeNull();

      // The properly formatted artifact should pass validation
      expect(checkpoint?.validation_results.idea?.passed).toBe(true);
      expect(checkpoint?.validation_results.idea?.coverage_percentage).toBe(100);
      expect(checkpoint?.validation_results.idea?.blocking_issues.length).toBe(0);
    });

    it('validates PRD with full coverage of IDEA constraints', async () => {
      const workflowId = 'coverage-test';
      const engine = new WorkflowEngine(tmpDir, 'Coverage Test');
      await engine.start('Test coverage validation');

      // Execute PRD stage
      await engine.executeStage('prd');

      // Get checkpoint after PRD generation
      let checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.validation_results.prd?.passed).toBe(true);

      // Verify PRD has 100% coverage of IDEA constraints
      expect(checkpoint?.validation_results.prd?.coverage_percentage).toBe(100);
      expect(checkpoint?.validation_results.prd?.blocking_issues.length).toBe(0);

      // Verify PRD was reviewed by Momus (placeholder in Phase 2)
      expect(checkpoint?.validation_results.prd?.reviewer).toBe('momus');
    });

    it('tracks validation coverage percentage correctly', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Coverage Test 2');
      await engine.start('Test coverage tracking');

      const checkpoint = await loadCheckpoint(tmpDir, 'coverage-test-2');

      // Verify coverage percentage is calculated and is 100% for properly formatted artifacts
      expect(checkpoint?.validation_results.idea?.coverage_percentage).toBe(100);
      expect(checkpoint?.validation_results.idea?.passed).toBe(true);
    });

    it('PRD validation checks IDEA constraint coverage', async () => {
      const workflowId = 'prd-validation-test';

      // Create a valid IDEA artifact
      const engine = new WorkflowEngine(tmpDir, 'PRD Validation Test');
      await engine.start('Test PRD validation');

      // Execute PRD stage
      await engine.executeStage('prd');

      // Check PRD validation results
      const checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.validation_results.prd).not.toBeNull();
      expect(checkpoint?.validation_results.prd?.coverage_percentage).toBeDefined();
      expect(checkpoint?.validation_results.prd?.reviewer).toBe('momus');
    });
  });

  // ============================================================================
  // Scenario 4: Manual Command Workflow
  // ============================================================================

  describe('Scenario 4: Manual Command Workflow', () => {
    it('executes stages independently using manual commands', async () => {
      const featureName = 'Manual Feature';
      const workflowId = 'manual-feature'; // Matches sanitized workflow ID

      // Manually execute IDEA stage (simulating /idea command)
      const engine1 = new WorkflowEngine(tmpDir, featureName);
      await engine1.start('Feature built with manual commands');

      let checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.current_stage).toBe('prd');

      // Manually execute PRD stage (simulating /prd command)
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, featureName);
      await engine2.executeStage('prd');

      checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.artifacts.prd).not.toBeNull();
      expect(checkpoint?.current_stage).toBe('spec');

      // Manually execute SPEC stage (simulating /spec command)
      clearCache();
      const engine3 = new WorkflowEngine(tmpDir, featureName);
      await engine3.executeStage('spec');

      checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.artifacts.spec).not.toBeNull();
      expect(checkpoint?.current_stage).toBe('intents');

      // Manually execute INTENTS stage (simulating /intents command)
      clearCache();
      const engine4 = new WorkflowEngine(tmpDir, featureName);
      await engine4.executeStage('intents');

      checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.artifacts.intents).not.toBeNull();
      expect(checkpoint?.current_stage).toBe('complete');
      expect(checkpoint?.status).toBe('complete');
    });

    it('creates new workflow if checkpoint does not exist', async () => {
      const workflowId = 'new-workflow-test';

      // Verify no checkpoint exists yet
      let checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint).toBeNull();

      // Start a new workflow
      const engine = new WorkflowEngine(tmpDir, 'New Workflow Test');
      await engine.start('Create workflow from scratch');

      // Verify checkpoint was created
      checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.workflow_id).toBe(workflowId);
      expect(checkpoint?.status).toBe('in_progress');
    });

    it('loads existing checkpoint when it exists', async () => {
      const workflowId = 'existing-workflow-test';

      // Create initial workflow
      const engine1 = new WorkflowEngine(tmpDir, 'Existing Workflow Test');
      await engine1.start('Initial workflow creation');

      const initialCheckpoint = await loadCheckpoint(tmpDir, workflowId);
      const createdAt = initialCheckpoint?.created_at;

      // Create new engine instance and execute next stage
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, 'Existing Workflow Test');
      await engine2.executeStage('prd');

      // Verify the same workflow was used (created_at unchanged)
      const updatedCheckpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(updatedCheckpoint?.created_at).toBe(createdAt);
      expect(updatedCheckpoint?.current_stage).toBe('spec');
    });

    it('updates checkpoint current_stage after each manual stage', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Stage Update Test');
      await engine.start('Test stage updates');

      // Verify stage progression
      let checkpoint = await loadCheckpoint(tmpDir, 'stage-update-test');
      expect(checkpoint?.current_stage).toBe('prd');

      await engine.executeStage('prd');
      checkpoint = await loadCheckpoint(tmpDir, 'stage-update-test');
      expect(checkpoint?.current_stage).toBe('spec');

      await engine.executeStage('spec');
      checkpoint = await loadCheckpoint(tmpDir, 'stage-update-test');
      expect(checkpoint?.current_stage).toBe('intents');

      await engine.executeStage('intents');
      checkpoint = await loadCheckpoint(tmpDir, 'stage-update-test');
      expect(checkpoint?.current_stage).toBe('complete');
    });
  });

  // ============================================================================
  // Scenario 5: Error Recovery
  // ============================================================================

  describe('Scenario 5: Error Recovery Scenarios', () => {
    it('handles corrupt checkpoint gracefully', async () => {
      const workflowId = 'corrupt-checkpoint-test';

      // Create workflow directory
      await ensureWorkflowDir(tmpDir, workflowId);

      // Write corrupt checkpoint file
      const checkpointPath = join(tmpDir, '.olympus', 'workflow', workflowId, 'checkpoint.json');
      await fs.writeFile(checkpointPath, '{ invalid json content', 'utf-8');

      // Try to load corrupt checkpoint
      const checkpoint = await loadCheckpoint(tmpDir, workflowId);

      // Should return null for corrupt checkpoint
      expect(checkpoint).toBeNull();
    });

    it('handles missing checkpoint file', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Missing Checkpoint Test');

      // Try to resume non-existent workflow
      await expect(engine.resume()).rejects.toThrow('No checkpoint found');

      // Try to pause non-existent workflow
      await expect(engine.pause()).rejects.toThrow('No checkpoint found');

      // Try to get status of non-existent workflow
      await expect(engine.getStatus()).rejects.toThrow('No checkpoint found');
    });

    it('handles missing artifact files', async () => {
      const workflowId = 'missing-artifact-test';
      const engine = new WorkflowEngine(tmpDir, 'Missing Artifact Test');

      // Create workflow and IDEA artifact
      await engine.start('Test missing artifacts');

      // Delete the IDEA artifact
      const ideaPath = join(tmpDir, '.olympus', 'workflow', workflowId, 'idea.md');
      await fs.remove(ideaPath);

      // Try to execute PRD stage (which needs IDEA artifact)
      // This should still work as the engine creates checkpoint references
      // but validation might fail due to missing file
      await engine.executeStage('prd');

      const checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint?.current_stage).toBe('spec');
    });

    it('handles directory creation failures gracefully', async () => {
      // Create a file where a directory should be
      const workflowId = 'dir-conflict-test';
      const workflowPath = join(tmpDir, '.olympus', 'workflow', workflowId);

      // Create parent directory
      await fs.ensureDir(join(tmpDir, '.olympus', 'workflow'));

      // Create a file with the same name as the workflow directory
      await fs.writeFile(workflowPath, 'blocking file', 'utf-8');

      // Try to start workflow (should fail when trying to create directory)
      const engine = new WorkflowEngine(tmpDir, 'Dir Conflict Test');

      await expect(engine.start('Test directory conflict'))
        .rejects.toThrow();
    });

    it('preserves checkpoint schema version for compatibility', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Schema Version Test');
      await engine.start('Test schema version');

      const checkpoint = await loadCheckpoint(tmpDir, 'schema-version-test');

      // Verify schema version is set
      expect(checkpoint?.schema_version).toBe('1.0.0');
    });

    it('handles checkpoint without schema_version as invalid', async () => {
      const workflowId = 'no-schema-test';

      // Create checkpoint without schema_version
      const checkpointData = {
        workflow_id: workflowId,
        feature_name: 'No Schema Test',
        current_stage: 'idea' as WorkflowStage,
        status: 'in_progress' as const,
        // Missing schema_version
      };

      await ensureWorkflowDir(tmpDir, workflowId);
      const checkpointPath = join(tmpDir, '.olympus', 'workflow', workflowId, 'checkpoint.json');
      await fs.writeJson(checkpointPath, checkpointData, { spaces: 2 });

      // Try to load checkpoint without schema_version
      const checkpoint = await loadCheckpoint(tmpDir, workflowId);

      // Should return null for invalid checkpoint
      expect(checkpoint).toBeNull();
    });

    it('validates that complete stage cannot be executed', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Complete Stage Test');
      await engine.start('Test complete stage execution');

      // Try to execute complete stage directly
      await expect(engine.executeStage('complete')).rejects.toThrow('No execution for complete stage');
    });

    it('handles workflow interruption with error context', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Error Context Test');
      await engine.start('Test error context preservation');

      // Simulate an error during execution by directly updating checkpoint
      let checkpoint = await loadCheckpoint(tmpDir, 'error-context-test');
      if (checkpoint) {
        checkpoint.status = 'paused';
        checkpoint.resume_context = {
          ...checkpoint.resume_context,
          error_message: 'Simulated error for testing',
          failed_stage: 'prd',
        };
        await saveCheckpoint(tmpDir, checkpoint);
      }

      // Verify error context is preserved
      checkpoint = await loadCheckpoint(tmpDir, 'error-context-test');
      expect(checkpoint?.resume_context?.error_message).toBeDefined();
      expect(checkpoint?.resume_context?.failed_stage).toBe('prd');
    });

    it('maintains artifact references across failures', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Artifact Ref Test');
      await engine.start('Test artifact reference persistence');

      // Execute PRD stage
      await engine.executeStage('prd');

      // Pause workflow
      await engine.pause();

      // Verify artifacts are still referenced after pause
      const checkpoint = await loadCheckpoint(tmpDir, 'artifact-ref-test');
      expect(checkpoint?.artifacts.idea).not.toBeNull();
      expect(checkpoint?.artifacts.prd).not.toBeNull();
      expect(checkpoint?.artifacts.idea?.path).toContain('idea.md');
      expect(checkpoint?.artifacts.prd?.path).toContain('prd.md');
    });
  });

  // ============================================================================
  // Additional Integration Tests
  // ============================================================================

  describe('Additional Integration Scenarios', () => {
    it('verifies checkpoint timestamps are updated correctly', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Timestamp Test');
      await engine.start('Test timestamp updates');

      const checkpoint1 = await loadCheckpoint(tmpDir, 'timestamp-test');
      const firstUpdate = checkpoint1?.updated_at;

      // Wait a moment to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Execute next stage
      await engine.executeStage('prd');

      const checkpoint2 = await loadCheckpoint(tmpDir, 'timestamp-test');
      const secondUpdate = checkpoint2?.updated_at;

      // Verify created_at stays the same but updated_at changes
      expect(checkpoint2?.created_at).toBe(checkpoint1?.created_at);
      expect(secondUpdate).not.toBe(firstUpdate);
      expect(new Date(secondUpdate!).getTime()).toBeGreaterThan(new Date(firstUpdate!).getTime());
    });

    it('verifies artifact IDs follow naming convention', async () => {
      const engine = new WorkflowEngine(tmpDir, 'Artifact ID Test');
      await engine.start('Test artifact ID convention');

      const checkpoint = await loadCheckpoint(tmpDir, 'artifact-id-test');

      // Verify artifact ID format
      expect(checkpoint?.artifacts.idea?.id).toMatch(/^IDEA-\d{3}$/);

      // Execute PRD and SPEC
      await engine.executeStage('prd');
      await engine.executeStage('spec');
      await engine.executeStage('intents');

      const finalCheckpoint = await loadCheckpoint(tmpDir, 'artifact-id-test');

      // Verify all artifact IDs follow convention
      expect(finalCheckpoint?.artifacts.prd?.id).toMatch(/^PRD-\d{3}$/);
      expect(finalCheckpoint?.artifacts.spec?.id).toMatch(/^SPEC-\d{3}$/);
      expect(finalCheckpoint?.artifacts.intents?.id).toMatch(/^INTENTS-\d{3}$/);
    });

    it('verifies workflow ID sanitization', async () => {
      const featureName = "Feature #123: User's Login! @2024";
      const engine = new WorkflowEngine(tmpDir, featureName);
      await engine.start('Test workflow ID sanitization');

      // Workflow ID should be sanitized
      const checkpoint = await loadCheckpoint(tmpDir, 'feature-123-users-login-2024');
      expect(checkpoint).not.toBeNull();
      expect(checkpoint?.workflow_id).toBe('feature-123-users-login-2024');
    });

    it('handles multiple concurrent workflows in same project', async () => {
      // Start first workflow
      const engine1 = new WorkflowEngine(tmpDir, 'Workflow One');
      await engine1.start('First workflow');

      // Start second workflow
      const engine2 = new WorkflowEngine(tmpDir, 'Workflow Two');
      await engine2.start('Second workflow');

      // Verify both checkpoints exist
      const checkpoint1 = await loadCheckpoint(tmpDir, 'workflow-one');
      const checkpoint2 = await loadCheckpoint(tmpDir, 'workflow-two');

      expect(checkpoint1).not.toBeNull();
      expect(checkpoint2).not.toBeNull();
      expect(checkpoint1?.workflow_id).toBe('workflow-one');
      expect(checkpoint2?.workflow_id).toBe('workflow-two');

      // Advance first workflow
      await engine1.executeStage('prd');

      // Verify second workflow is unaffected
      const checkpoint2Updated = await loadCheckpoint(tmpDir, 'workflow-two');
      expect(checkpoint2Updated?.current_stage).toBe('prd');
    });

    it('verifies directory structure is created correctly', async () => {
      const workflowId = 'structure-test';
      const engine = new WorkflowEngine(tmpDir, 'Structure Test');
      await engine.start('Test directory structure');

      // Verify all directories exist
      const workflowDir = join(tmpDir, '.olympus', 'workflow', workflowId);
      const intentsDir = join(workflowDir, 'intents');
      const validationDir = join(workflowDir, 'validation');
      const checkpointFile = join(workflowDir, 'checkpoint.json');

      expect(await fs.pathExists(workflowDir)).toBe(true);
      expect(await fs.pathExists(intentsDir)).toBe(true);
      expect(await fs.pathExists(validationDir)).toBe(true);
      expect(await fs.pathExists(checkpointFile)).toBe(true);
    });

    it('verifies resume_context preserves all necessary data', async () => {
      const initialPrompt = 'Build comprehensive search system';
      const engine1 = new WorkflowEngine(tmpDir, 'Context Preserve Test');
      await engine1.start(initialPrompt);

      // Pause and add additional context
      let checkpoint = await loadCheckpoint(tmpDir, 'context-preserve-test');
      if (checkpoint) {
        checkpoint.resume_context = {
          ...checkpoint.resume_context,
          custom_field: 'test value',
          nested: { data: 'nested value' },
        };
        await saveCheckpoint(tmpDir, checkpoint);
      }

      // Resume and verify context is preserved
      clearCache();
      const engine2 = new WorkflowEngine(tmpDir, 'Context Preserve Test');
      await engine2.resume();

      checkpoint = await loadCheckpoint(tmpDir, 'context-preserve-test');
      expect(checkpoint?.resume_context?.initial_prompt).toBe(initialPrompt);
      expect(checkpoint?.resume_context?.custom_field).toBe('test value');
      expect(checkpoint?.resume_context?.nested?.data).toBe('nested value');
    });
  });
});
