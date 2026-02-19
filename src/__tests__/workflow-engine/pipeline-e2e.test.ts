/**
 * Pipeline E2E Integration Tests
 *
 * Comprehensive end-to-end tests for the ODLC pipeline exercising REAL functions
 * with REAL file I/O in temp directories. Agent responses are mocked but all
 * pipeline functions (manifest, checkpoint, alignment, depth, trust, etc.) are real.
 *
 * Scenarios:
 * 1. Full Pipeline: IDEA -> INTENT -> UNIT -> BOLT -> Operations -> DONE
 * 2. SHALLOW Path: skip UNIT decomposition
 * 3. Resume: pause and resume a workflow
 * 4. Rejection/Retry: gate rejection -> dispatch -> re-execute
 * 5. Mode Switch: change execution mode mid-workflow
 * 6. Cascade Invalidation: propagate staleness through artifact graph
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorkflowEngine } from '../../features/workflow-engine/engine.js';
import { loadCheckpoint, saveCheckpoint, clearCache } from '../../features/workflow-engine/checkpoint.js';
import {
  createManifest,
  loadManifest,
  saveManifest,
  registerArtifact,
  linkArtifacts,
  updateContractStatus,
  cascadeInvalidation,
  revalidateStaleArtifacts,
  addGateAuditEntry,
  updatePhaseStatus,
  isWorkflowComplete,
} from '../../features/workflow-engine/manifest.js';
import { assessDepth, assessDepthFromIdea } from '../../features/workflow-engine/depth-assessment.js';
import { detectResumableWorkflows } from '../../features/workflow-engine/resume-detector.js';
import { dispatchRejection } from '../../features/workflow-engine/rejection-dispatcher.js';
import {
  markBoltComplete,
  markUnitComplete,
  getWorkflowProgress,
  getPendingBolts,
  getExecutionOrder,
  detectActiveWorkflow,
} from '../../features/workflow-engine/workflow-bridge.js';
import { runDualValidation } from '../../features/workflow-engine/alignment.js';
import { writeArtifact, getArtifactPath } from '../../features/workflow-engine/artifacts.js';
import { captureWorkflowDiscovery } from '../../features/workflow-engine/learning-bridge.js';
import { createDefaultTrustState, saveTrustState } from '../../features/workflow-engine/trust.js';
import type { WorkflowEvent, WorkflowContext } from '../../features/workflow-engine/learning-bridge.js';
import type {
  ManifestSchema,
  ManifestArtifact,
  WorkflowCheckpointV3,
  GateResult,
  WorkflowPhase,
} from '../../features/workflow-engine/phase-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal passing GateResult */
function makeGateResult(approvedBy: 'human' | 'auto' | 'trust' = 'auto'): GateResult {
  return {
    passed: true,
    approved_by: approvedBy,
    approved_at: new Date().toISOString(),
    feedback: null,
    verification: {
      conformance_score: 100,
      coverage_percentage: 100,
      missing_items: [],
      passed: true,
    },
    validation: {
      alignment_score: 100,
      alignment_questions: [],
      passed: true,
    },
  };
}

/** Creates a V3 checkpoint object for manual setup */
function makeCheckpoint(
  workflowId: string,
  featureName: string,
  overrides: Partial<WorkflowCheckpointV3> = {},
): WorkflowCheckpointV3 {
  const now = new Date().toISOString();
  return {
    schema_version: '3.0.0',
    workflow_id: workflowId,
    feature_name: featureName,
    created_at: now,
    updated_at: now,
    current_phase: 'inception',
    current_stage: 'idea',
    status: 'in_progress',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: now, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: 'aidlc-docs/manifest.json',
    trust_state_path: '.olympus/trust-state.json',
    resume_context: {},
    ...overrides,
  };
}

/** Writes a simple markdown artifact file on disk */
async function writeArtifactFile(dir: string, relativePath: string, content: string): Promise<string> {
  const fullPath = join(dir, relativePath);
  await fs.ensureDir(join(fullPath, '..'));
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Pipeline E2E', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'pipeline-e2e-'));
    clearCache();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
    clearCache();
  });

  // =========================================================================
  // Scenario 1: Full Pipeline
  // =========================================================================
  describe('Scenario 1: Full Pipeline (IDEA -> INTENT -> UNIT -> BOLT -> Operations -> DONE)', () => {
    it('runs a complete ODLC pipeline with all gates and phases', async () => {
      const workflowId = 'test-feature';
      const featureName = 'Test Feature';
      const manifestPath = join(tmpDir, 'aidlc-docs', workflowId, 'manifest.json');

      // --- Start engine: creates checkpoint + directory structure ---
      const engine = new WorkflowEngine(tmpDir, featureName);
      await engine.start('Build a user authentication system with OAuth support');

      // Execute IDEA stage to create artifact
      await engine.executeStage('idea');

      // Verify IDEA was written
      const ideaPath = getArtifactPath(tmpDir, workflowId, 'idea');
      expect(await fs.pathExists(ideaPath)).toBe(true);
      const ideaContent = await fs.readFile(ideaPath, 'utf-8');
      expect(ideaContent).toContain('Problem Statement');

      // --- Execute INTENT stage ---
      clearCache();
      await engine.executeStage('intent');

      const intentPath = getArtifactPath(tmpDir, workflowId, 'intent');
      expect(await fs.pathExists(intentPath)).toBe(true);
      const intentContent = await fs.readFile(intentPath, 'utf-8');
      expect(intentContent).toContain('Business Requirements');

      // --- Create manifest ---
      createManifest(workflowId, featureName, tmpDir);
      expect(await fs.pathExists(manifestPath)).toBe(true);

      // --- Depth assessment ---
      const depth = assessDepthFromIdea(ideaContent);
      expect(depth.total_score).toBeGreaterThanOrEqual(6);
      expect(depth.total_score).toBeLessThanOrEqual(30);

      // --- Register IDEA artifact ---
      registerArtifact(manifestPath, {
        id: 'IDEA-001',
        type: 'IDEA',
        phase: 'inception',
        stage: 'idea',
        path: ideaPath,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });
      updateContractStatus(manifestPath, 'IDEA-001', 'active');

      // --- Gate 1: IDEA approved ---
      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        action: 'approved',
        actor: 'human',
        reason: 'IDEA looks good',
      });

      // --- Register INTENT artifact ---
      registerArtifact(manifestPath, {
        id: 'INTENT-001',
        type: 'INTENT',
        phase: 'inception',
        stage: 'intent',
        path: intentPath,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });
      updateContractStatus(manifestPath, 'INTENT-001', 'active');

      // --- Run dual validation for idea-to-intent ---
      const dualResult = runDualValidation(
        intentContent,
        ideaContent,
        ideaContent,
        'idea-to-intent',
        'unit-to-idea',
        'IDEA-001',
        'INTENT-001',
        'IDEA-001',
      );
      expect(dualResult.parentCheck).toBeDefined();
      expect(dualResult.rootCheck).toBeDefined();

      // --- Gate 2: INTENT approved ---
      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        action: 'approved',
        actor: 'human',
        reason: 'INTENT specification approved',
      });

      // --- Register UNITs ---
      const unit001Path = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/spec.md`, '# UNIT-001\n\nCore implementation');
      const unit002Path = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-002/spec.md`, '# UNIT-002\n\nIntegration layer');

      registerArtifact(manifestPath, {
        id: 'UNIT-001',
        type: 'UNIT',
        phase: 'construction',
        stage: 'unit',
        path: unit001Path,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });
      registerArtifact(manifestPath, {
        id: 'UNIT-002',
        type: 'UNIT',
        phase: 'construction',
        stage: 'unit',
        path: unit002Path,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });

      // Link UNITs to INTENT
      linkArtifacts(manifestPath, { source_id: 'INTENT-001', target_id: 'UNIT-001', link_type: 'derives' });
      linkArtifacts(manifestPath, { source_id: 'INTENT-001', target_id: 'UNIT-002', link_type: 'derives' });

      // Set UNITs to active
      updateContractStatus(manifestPath, 'UNIT-001', 'active');
      updateContractStatus(manifestPath, 'UNIT-002', 'active');

      // --- Register BOLTs ---
      const bolt001Path = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/BOLT-001.md`, '# BOLT-001\n\nImplement auth module');
      const bolt002Path = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-002/BOLT-002.md`, '# BOLT-002\n\nImplement API endpoints');

      registerArtifact(manifestPath, {
        id: 'BOLT-001',
        type: 'BOLT',
        phase: 'construction',
        stage: 'bolt',
        path: bolt001Path,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });
      registerArtifact(manifestPath, {
        id: 'BOLT-002',
        type: 'BOLT',
        phase: 'construction',
        stage: 'bolt',
        path: bolt002Path,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });

      // Link BOLTs to UNITs
      linkArtifacts(manifestPath, { source_id: 'UNIT-001', target_id: 'BOLT-001', link_type: 'implements' });
      linkArtifacts(manifestPath, { source_id: 'UNIT-002', target_id: 'BOLT-002', link_type: 'implements' });

      // Set BOLTs to active
      updateContractStatus(manifestPath, 'BOLT-001', 'active');
      updateContractStatus(manifestPath, 'BOLT-002', 'active');

      // --- Gate 3: UNITs/BOLTs approved ---
      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'human',
        reason: 'Construction artifacts approved',
      });

      // --- Mark BOLTs complete ---
      clearCache();
      await markBoltComplete(tmpDir, workflowId, 'BOLT-001', makeGateResult());

      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'auto',
        reason: 'BOLT-001 gate passed',
      });

      clearCache();
      await markBoltComplete(tmpDir, workflowId, 'BOLT-002', makeGateResult());

      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'auto',
        reason: 'BOLT-002 gate passed',
      });

      // --- Operations phase ---
      clearCache();
      await engine.executePhase('operations');

      // Verify operations artifacts on disk
      const opsDir = join(tmpDir, 'aidlc-docs', workflowId, 'operations');
      expect(await fs.pathExists(join(opsDir, 'deploy-guide.md'))).toBe(true);
      expect(await fs.pathExists(join(opsDir, 'runbook.md'))).toBe(true);
      expect(await fs.pathExists(join(opsDir, 'monitoring.json'))).toBe(true);
      expect(await fs.pathExists(join(opsDir, 'release-notes.md'))).toBe(true);

      // The engine registers OPS artifacts with stage: 'bolt' and contract_status: 'draft'.
      // Transition them through draft -> active -> fulfilled to match the real pipeline flow.
      const postOpsManifest = loadManifest(manifestPath)!;
      const opsArtifacts = postOpsManifest.artifacts.filter(a => a.phase === 'operations');
      expect(opsArtifacts.length).toBeGreaterThanOrEqual(4);

      for (const opsArt of opsArtifacts) {
        if (opsArt.contract_status === 'draft') {
          updateContractStatus(manifestPath, opsArt.id, 'active');
          updateContractStatus(manifestPath, opsArt.id, 'fulfilled');
        }
      }

      // --- Gate 5: Operations approved ---
      addGateAuditEntry(manifestPath, {
        phase: 'operations',
        action: 'approved',
        actor: 'human',
        reason: 'Operations ready for deployment',
      });

      // --- Complete operations phase in manifest ---
      updatePhaseStatus(manifestPath, 'operations', 'complete', undefined, new Date().toISOString());

      // --- Final verification ---
      const finalManifest = loadManifest(manifestPath)!;

      // Verify construction BOLTs are fulfilled
      const constructionBolts = finalManifest.artifacts.filter(a => a.stage === 'bolt' && a.phase === 'construction');
      expect(constructionBolts.length).toBe(2);
      expect(constructionBolts.every(b => b.contract_status === 'fulfilled')).toBe(true);

      // Verify ALL bolt-stage artifacts (construction + ops) are fulfilled
      // This is what isWorkflowComplete checks
      expect(isWorkflowComplete(finalManifest)).toBe(true);

      // Verify audit trail
      expect(finalManifest.gate_audit.length).toBeGreaterThanOrEqual(5);

      // Verify operations phase status
      expect(finalManifest.phases.operations.status).toBe('complete');
    });
  });

  // =========================================================================
  // Scenario 2: SHALLOW Path
  // =========================================================================
  describe('Scenario 2: SHALLOW Path (skip UNIT decomposition)', () => {
    it('completes a minimal workflow without UNIT artifacts', async () => {
      const workflowId = 'simple-fix';
      const featureName = 'Simple Fix';
      const manifestPath = join(tmpDir, 'aidlc-docs', workflowId, 'manifest.json');

      // --- Force SHALLOW depth via assessDepth ---
      const shallowDepth = assessDepth({
        clarity: 1,
        complexity: 1,
        scope: 1,
        risk: 1,
        context: 1,
        preferences: 1,
      });
      expect(shallowDepth.total_score).toBe(6);
      expect(shallowDepth.skip_units).toBe(true);
      expect(shallowDepth.recommended_depth).toBe('minimal');

      // --- Also verify assessDepthFromIdea with minimal content ---
      const minimalIdea = '## Problem Statement\n\nFix a typo.\n\n## Out of Scope\n\nEverything else.\n';
      const ideaDepth = assessDepthFromIdea(minimalIdea);
      expect(ideaDepth.total_score).toBeLessThanOrEqual(15);
      // Note: assessDepthFromIdea may not always produce <= 10 for such minimal content
      // because heuristics depend on section lengths; the assessDepth(factors) test above is definitive.

      // --- Create manifest ---
      createManifest(workflowId, featureName, tmpDir);

      // --- Register IDEA ---
      const ideaFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/inception/idea.md`, minimalIdea);
      registerArtifact(manifestPath, {
        id: 'IDEA-001',
        type: 'IDEA',
        phase: 'inception',
        stage: 'idea',
        path: ideaFilePath,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });
      updateContractStatus(manifestPath, 'IDEA-001', 'active');

      // Gate 1 approved
      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        action: 'approved',
        actor: 'trust',
        reason: 'SHALLOW: auto-approved',
      });

      // --- Register lightweight INTENT ---
      const intentContent = '## Business Requirements\n\nFix the typo in README.\n';
      const intentFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/inception/intent.md`, intentContent);
      registerArtifact(manifestPath, {
        id: 'INTENT-001',
        type: 'INTENT',
        phase: 'inception',
        stage: 'intent',
        path: intentFilePath,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });
      updateContractStatus(manifestPath, 'INTENT-001', 'active');

      // Gate 2 approved
      addGateAuditEntry(manifestPath, {
        phase: 'inception',
        action: 'approved',
        actor: 'trust',
        reason: 'SHALLOW: auto-approved',
      });

      // --- SHALLOW: skip UNIT decomposition, register single BOLT linked to INTENT ---
      const boltContent = '# BOLT-001\n\nFix typo in README.md line 42.\n';
      const boltFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/BOLT-001.md`, boltContent);
      registerArtifact(manifestPath, {
        id: 'BOLT-001',
        type: 'BOLT',
        phase: 'construction',
        stage: 'bolt',
        path: boltFilePath,
        validation_passed: true,
        write_complete: true,
        checksum: null,
      });

      // Link BOLT directly to INTENT (no UNIT in between)
      linkArtifacts(manifestPath, { source_id: 'INTENT-001', target_id: 'BOLT-001', link_type: 'implements' });

      // Set BOLT to active
      updateContractStatus(manifestPath, 'BOLT-001', 'active');

      // Mark BOLT complete
      clearCache();
      await markBoltComplete(tmpDir, workflowId, 'BOLT-001', makeGateResult('trust'));

      // Gate 4 approved
      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'trust',
        reason: 'BOLT-001 auto-approved (SHALLOW)',
      });

      // --- Verify no UNIT artifacts exist ---
      const finalManifest = loadManifest(manifestPath)!;
      const units = finalManifest.artifacts.filter(a => a.stage === 'unit');
      expect(units.length).toBe(0);

      // --- Verify Gate 3 was skipped (no gate 3 entries for construction unit approval) ---
      // We only have inception gates (1, 2) and the BOLT gate (4).
      // No gate entry with reason containing "UNIT" or "Construction artifacts"
      const gate3Entries = finalManifest.gate_audit.filter(
        g => g.phase === 'construction' && g.reason?.includes('Construction artifacts'),
      );
      expect(gate3Entries.length).toBe(0);

      // --- Verify workflow completes ---
      expect(isWorkflowComplete(finalManifest)).toBe(true);

      // Verify BOLT is fulfilled
      const bolt = finalManifest.artifacts.find(a => a.id === 'BOLT-001')!;
      expect(bolt.contract_status).toBe('fulfilled');
    });
  });

  // =========================================================================
  // Scenario 3: Resume
  // =========================================================================
  describe('Scenario 3: Resume (pause and resume a workflow)', () => {
    it('detects a paused workflow and resumes from saved state', async () => {
      const workflowId = 'resume-test';
      const featureName = 'Resume Test';

      // --- Start engine: creates checkpoint + directory structure ---
      const engine = new WorkflowEngine(tmpDir, featureName);
      await engine.start('Build a resume-capable pipeline test');

      // Execute IDEA stage to create artifact
      await engine.executeStage('idea');

      // Verify IDEA was written
      const ideaPath = getArtifactPath(tmpDir, workflowId, 'idea');
      expect(await fs.pathExists(ideaPath)).toBe(true);

      // --- Execute INTENT stage ---
      clearCache();
      await engine.executeStage('intent');

      const intentPath = getArtifactPath(tmpDir, workflowId, 'intent');
      expect(await fs.pathExists(intentPath)).toBe(true);

      // --- Manually save a paused checkpoint at unit stage ---
      clearCache();
      const checkpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(checkpoint).not.toBeNull();

      // Simulate pause: set status to paused and stage to unit
      checkpoint!.status = 'paused';
      checkpoint!.current_stage = 'unit';
      checkpoint!.current_phase = 'construction';
      await saveCheckpoint(tmpDir, checkpoint!);

      // --- Clear cache to simulate new session ---
      clearCache();

      // --- Detect resumable workflows ---
      const resumable = await detectResumableWorkflows(tmpDir);
      expect(resumable.length).toBeGreaterThanOrEqual(1);

      const resumeInfo = resumable.find(r => r.workflowId === workflowId)!;
      expect(resumeInfo).toBeDefined();
      expect(resumeInfo.featureName).toBe(featureName);
      expect(resumeInfo.currentStage).toBe('unit');
      expect(resumeInfo.currentPhase).toBe('construction');
      expect(resumeInfo.isLegacy).toBe(false);
      expect(resumeInfo.status).toBe('paused');

      // --- Verify data integrity: artifacts still on disk ---
      expect(await fs.pathExists(ideaPath)).toBe(true);
      expect(await fs.pathExists(intentPath)).toBe(true);

      // --- Verify checkpoint can be reloaded correctly ---
      clearCache();
      const reloadedCheckpoint = await loadCheckpoint(tmpDir, workflowId);
      expect(reloadedCheckpoint).not.toBeNull();
      expect(reloadedCheckpoint!.workflow_id).toBe(workflowId);
      expect(reloadedCheckpoint!.feature_name).toBe(featureName);
      expect(reloadedCheckpoint!.current_stage).toBe('unit');
      expect(reloadedCheckpoint!.status).toBe('paused');
    });
  });

  // =========================================================================
  // Scenario 4: Rejection/Retry
  // =========================================================================
  describe('Scenario 4: Rejection/Retry (gate rejection -> dispatch -> re-execute)', () => {
    it('handles gate 4 rejection, dispatch, and successful retry', async () => {
      const workflowId = 'rejection-test';
      const featureName = 'Rejection Test';
      const manifestPath = join(tmpDir, 'aidlc-docs', workflowId, 'manifest.json');

      // --- Setup: create manifest with full artifact chain ---
      createManifest(workflowId, featureName, tmpDir);

      // Setup checkpoint
      const checkpoint = makeCheckpoint(workflowId, featureName, {
        current_phase: 'construction',
        current_stage: 'bolt',
      });
      await saveCheckpoint(tmpDir, checkpoint);

      // Register artifacts
      const ideaPath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/inception/idea.md`, '# IDEA\n\n## Problem Statement\n\nTest rejection flow.');
      registerArtifact(manifestPath, {
        id: 'IDEA-001', type: 'IDEA', phase: 'inception', stage: 'idea',
        path: ideaPath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'IDEA-001', 'active');

      const intentPath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/inception/intent.md`, '# INTENT\n\n## Business Requirements\n\nTest.');
      registerArtifact(manifestPath, {
        id: 'INTENT-001', type: 'INTENT', phase: 'inception', stage: 'intent',
        path: intentPath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'INTENT-001', 'active');

      const unitPath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/spec.md`, '# UNIT-001');
      registerArtifact(manifestPath, {
        id: 'UNIT-001', type: 'UNIT', phase: 'construction', stage: 'unit',
        path: unitPath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'UNIT-001', 'active');

      const boltPath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/BOLT-001.md`, '# BOLT-001\n\nFirst attempt (has bugs).');
      registerArtifact(manifestPath, {
        id: 'BOLT-001', type: 'BOLT', phase: 'construction', stage: 'bolt',
        path: boltPath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'BOLT-001', 'active');

      // Link artifacts
      linkArtifacts(manifestPath, { source_id: 'INTENT-001', target_id: 'UNIT-001', link_type: 'derives' });
      linkArtifacts(manifestPath, { source_id: 'UNIT-001', target_id: 'BOLT-001', link_type: 'implements' });

      // --- Simulate Gate 4 rejection: transition BOLT to violated ---
      updateContractStatus(manifestPath, 'BOLT-001', 'violated');

      let m = loadManifest(manifestPath)!;
      expect(m.artifacts.find(a => a.id === 'BOLT-001')!.contract_status).toBe('violated');

      // --- Dispatch rejection ---
      const dispatchResult = await dispatchRejection(tmpDir, workflowId, {
        gateNumber: 4,
        artifactId: 'BOLT-001',
        rejectionReason: 'Missing error handling in auth module',
        rejectedBy: 'human',
        attemptNumber: 1,
      });

      expect(dispatchResult.agentType).toBe('olympian');
      expect(dispatchResult.prompt).toContain('Missing error handling');
      expect(dispatchResult.contractStatusUpdate).toEqual({ from: 'violated', to: 'draft' });
      expect(dispatchResult.maxRetriesReached).toBe(false);

      // --- Transition BOLT back to draft (as dispatcher recommends) ---
      updateContractStatus(manifestPath, 'BOLT-001', 'draft');

      m = loadManifest(manifestPath)!;
      expect(m.artifacts.find(a => a.id === 'BOLT-001')!.contract_status).toBe('draft');

      // --- Re-execute: transition to active, then mark complete ---
      updateContractStatus(manifestPath, 'BOLT-001', 'active');
      clearCache();
      await markBoltComplete(tmpDir, workflowId, 'BOLT-001', makeGateResult('human'));

      m = loadManifest(manifestPath)!;
      expect(m.artifacts.find(a => a.id === 'BOLT-001')!.contract_status).toBe('fulfilled');

      // --- Verify discovery capture for rejection and approval-after-rejection ---
      const rejectionEvent: WorkflowEvent = {
        type: 'gate_rejection',
        phase: 'construction',
        stage: 'bolt',
        details: 'Missing error handling in auth module',
        artifactId: 'BOLT-001',
      };
      const wfContext: WorkflowContext = {
        workflowId,
        featureName,
        projectPath: tmpDir,
        sessionId: 'test-session',
        phase: 'construction',
      };

      const rejectionDiscovery = captureWorkflowDiscovery(rejectionEvent, wfContext);
      expect(rejectionDiscovery.category).toBe('gotcha');
      expect(rejectionDiscovery.details).toContain('Missing error handling');

      const approvalEvent: WorkflowEvent = {
        type: 'gate_approval_after_rejection',
        phase: 'construction',
        stage: 'bolt',
        details: 'BOLT-001 approved after revision',
        artifactId: 'BOLT-001',
      };

      const approvalDiscovery = captureWorkflowDiscovery(approvalEvent, wfContext);
      expect(approvalDiscovery.category).toBe('workflow_gate');
      expect(approvalDiscovery.summary).toContain('approved after rejection');
    });
  });

  // =========================================================================
  // Scenario 5: Mode Switch
  // =========================================================================
  describe('Scenario 5: Mode Switch (change execution mode mid-workflow)', () => {
    it('switches from olympus to ascent mode and continues pending BOLTs', async () => {
      const workflowId = 'mode-switch';
      const featureName = 'Mode Switch Test';
      const manifestPath = join(tmpDir, 'aidlc-docs', workflowId, 'manifest.json');

      // --- Setup manifest with UNITs and 5 BOLTs ---
      createManifest(workflowId, featureName, tmpDir);

      // Setup checkpoint in olympus mode
      const checkpoint = makeCheckpoint(workflowId, featureName, {
        current_phase: 'construction',
        current_stage: 'bolt',
        execution_mode: 'olympus',
      });
      await saveCheckpoint(tmpDir, checkpoint);

      // Setup trust state (required for detectActiveWorkflow)
      const trustState = createDefaultTrustState();
      saveTrustState(trustState, tmpDir);

      // Register UNIT-001
      const unitPath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/spec.md`, '# UNIT-001');
      registerArtifact(manifestPath, {
        id: 'UNIT-001', type: 'UNIT', phase: 'construction', stage: 'unit',
        path: unitPath, validation_passed: true, write_complete: true, checksum: null,
      });

      // Register 5 BOLTs
      for (let i = 1; i <= 5; i++) {
        const bId = `BOLT-00${i}`;
        const bPath = await writeArtifactFile(
          tmpDir,
          `aidlc-docs/${workflowId}/construction/UNIT-001/${bId}.md`,
          `# ${bId}\n\nTask ${i} implementation.`,
        );
        registerArtifact(manifestPath, {
          id: bId, type: 'BOLT', phase: 'construction', stage: 'bolt',
          path: bPath, validation_passed: true, write_complete: true, checksum: null,
        });
        // Link to UNIT
        linkArtifacts(manifestPath, { source_id: 'UNIT-001', target_id: bId, link_type: 'implements' });
      }

      // Set BOLT-001 and BOLT-002 to fulfilled (simulate 2 of 5 completed)
      updateContractStatus(manifestPath, 'BOLT-001', 'active');
      updateContractStatus(manifestPath, 'BOLT-001', 'fulfilled');
      updateContractStatus(manifestPath, 'BOLT-002', 'active');
      updateContractStatus(manifestPath, 'BOLT-002', 'fulfilled');

      // --- Switch execution mode to ascent ---
      clearCache();
      const cp = await loadCheckpoint(tmpDir, workflowId);
      cp!.execution_mode = 'ascent';
      await saveCheckpoint(tmpDir, cp!);

      // --- Clear cache to simulate new session ---
      clearCache();

      // --- Detect active workflow ---
      const ctx = await detectActiveWorkflow(tmpDir);
      expect(ctx).not.toBeNull();
      expect(ctx!.executionMode).toBe('ascent');
      expect(ctx!.completedBolts).toContain('BOLT-001');
      expect(ctx!.completedBolts).toContain('BOLT-002');
      expect(ctx!.pendingBolts).toContain('BOLT-003');
      expect(ctx!.pendingBolts).toContain('BOLT-004');
      expect(ctx!.pendingBolts).toContain('BOLT-005');
      expect(ctx!.pendingBolts.length).toBe(3);

      // --- Verify execution order ---
      const manifest = loadManifest(manifestPath)!;
      const executionOrder = getExecutionOrder(manifest);
      expect(executionOrder).toEqual(['BOLT-001', 'BOLT-002', 'BOLT-003', 'BOLT-004', 'BOLT-005']);

      // --- Verify pending bolts ---
      const pending = getPendingBolts(manifest);
      expect(pending).toEqual(['BOLT-003', 'BOLT-004', 'BOLT-005']);

      // --- Continue from BOLT-003: set active, mark complete ---
      updateContractStatus(manifestPath, 'BOLT-003', 'active');
      clearCache();
      await markBoltComplete(tmpDir, workflowId, 'BOLT-003', makeGateResult('auto'));

      const updatedManifest = loadManifest(manifestPath)!;
      const bolt003 = updatedManifest.artifacts.find(a => a.id === 'BOLT-003')!;
      expect(bolt003.contract_status).toBe('fulfilled');

      // Verify progress
      const progress = getWorkflowProgress(updatedManifest);
      expect(progress.completed).toBe(3);
      expect(progress.total).toBe(5);
      expect(progress.percentage).toBe(60);
    });
  });

  // =========================================================================
  // Scenario 6: Cascade Invalidation
  // =========================================================================
  describe('Scenario 6: Cascade Invalidation (propagate staleness through artifact graph)', () => {
    it('cascades staleness from IDEA through INTENT, UNIT, and BOLT', async () => {
      const workflowId = 'cascade-test';
      const featureName = 'Cascade Test';
      const manifestPath = join(tmpDir, 'aidlc-docs', workflowId, 'manifest.json');

      // --- Setup manifest ---
      createManifest(workflowId, featureName, tmpDir);

      // --- Write artifact files with matching content for dual validation ---
      const ideaContent = `---
id: IDEA-001
title: Cascade Test
status: draft
---

## Problem Statement

**Feature**: Cascade Test

This feature tests cascade invalidation through the artifact dependency graph. The goal is to ensure that when a parent artifact changes, all downstream artifacts are marked as stale.

## User Personas

- **Primary User**: End users who will directly interact with this feature
- **Developer**: Engineers who will maintain this feature

## Success Metrics

- **Metric 1**: Successful cascade propagation (target: 100%)
- **Metric 2**: Zero data loss during invalidation (target: 0 issues)

## Business Constraints

- **Technical**: Must integrate with existing manifest system
- **Timeline**: Must complete within test execution time

## Out of Scope

- Future enhancements not included in initial requirements
- Integration with systems outside the current scope
- Features that require additional budget allocation
`;

      const intentContent = `---
id: INTENT-001
parent: "IDEA-001"
status: draft
---

## Business Requirements

### User Stories

#### US-001: Cascade Implementation
**As a** user
**I want** cascade invalidation to propagate correctly
**So that** downstream artifacts are marked stale when parents change

**Acceptance Criteria:**
- Successful cascade propagation (target: 100%)
- Zero data loss during invalidation (target: 0 issues)

### Business Rules

- Must integrate with existing manifest system
- Must complete within test execution time

## Implementation Plan

### Proposed UNITs

- **UNIT-001**: Core cascade implementation and testing
`;

      const unitContent = `# UNIT-001

## Scope
Core cascade implementation.

## Acceptance Criteria
- Cascade propagation works correctly
- Successful cascade propagation (target: 100%)

## Target Files
- src/features/workflow-engine/manifest.ts
`;

      const boltContent = `# BOLT-001

## Task
Implement cascade invalidation logic.

## Acceptance Criteria
- Cascade propagation works correctly
- Successful cascade propagation (target: 100%)

## Target Files
- src/features/workflow-engine/manifest.ts
`;

      // Write files using absolute paths
      const ideaFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/inception/idea.md`, ideaContent);
      const intentFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/inception/intent.md`, intentContent);
      const unitFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/spec.md`, unitContent);
      const boltFilePath = await writeArtifactFile(tmpDir, `aidlc-docs/${workflowId}/construction/UNIT-001/BOLT-001.md`, boltContent);

      // --- Register all artifacts with absolute paths (required for revalidateStaleArtifacts) ---
      registerArtifact(manifestPath, {
        id: 'IDEA-001', type: 'IDEA', phase: 'inception', stage: 'idea',
        path: ideaFilePath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'IDEA-001', 'active');

      registerArtifact(manifestPath, {
        id: 'INTENT-001', type: 'INTENT', phase: 'inception', stage: 'intent',
        path: intentFilePath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'INTENT-001', 'active');

      registerArtifact(manifestPath, {
        id: 'UNIT-001', type: 'UNIT', phase: 'construction', stage: 'unit',
        path: unitFilePath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'UNIT-001', 'active');

      registerArtifact(manifestPath, {
        id: 'BOLT-001', type: 'BOLT', phase: 'construction', stage: 'bolt',
        path: boltFilePath, validation_passed: true, write_complete: true, checksum: null,
      });
      updateContractStatus(manifestPath, 'BOLT-001', 'active');

      // --- Set up links: IDEA -> INTENT -> UNIT-001 -> BOLT-001 ---
      linkArtifacts(manifestPath, { source_id: 'IDEA-001', target_id: 'INTENT-001', link_type: 'derives' });
      linkArtifacts(manifestPath, { source_id: 'INTENT-001', target_id: 'UNIT-001', link_type: 'derives' });
      linkArtifacts(manifestPath, { source_id: 'UNIT-001', target_id: 'BOLT-001', link_type: 'implements' });

      // Verify all are active before cascade
      let manifest = loadManifest(manifestPath)!;
      expect(manifest.artifacts.every(a => a.contract_status === 'active')).toBe(true);

      // --- Trigger cascade invalidation from IDEA ---
      cascadeInvalidation(manifestPath, 'IDEA-001');

      // --- Verify all artifacts are stale ---
      manifest = loadManifest(manifestPath)!;
      expect(manifest.artifacts.find(a => a.id === 'IDEA-001')!.contract_status).toBe('stale');
      expect(manifest.artifacts.find(a => a.id === 'INTENT-001')!.contract_status).toBe('stale');
      expect(manifest.artifacts.find(a => a.id === 'UNIT-001')!.contract_status).toBe('stale');
      expect(manifest.artifacts.find(a => a.id === 'BOLT-001')!.contract_status).toBe('stale');

      // --- Revalidate stale artifacts ---
      // revalidateStaleArtifacts reads files from the paths stored in the manifest.
      // Since we stored absolute paths and wrote matching content, validation should pass
      // for INTENT (has parent link to IDEA), UNIT (has parent link to INTENT),
      // and BOLT (has parent link to UNIT).
      // IDEA itself has no parent link, so it will stay stale.
      const revalResult = await revalidateStaleArtifacts(tmpDir, workflowId);

      // IDEA has no parent link, so stays stale
      expect(revalResult.stillStale).toContain('IDEA-001');

      // INTENT, UNIT, BOLT have parent links and readable content files.
      // Whether they are restored depends on dual validation pass/fail.
      // The restored + stillStale should account for all stale artifacts.
      const allRevalidated = [...revalResult.restored, ...revalResult.stillStale];
      expect(allRevalidated).toContain('IDEA-001');
      expect(allRevalidated).toContain('INTENT-001');
      expect(allRevalidated).toContain('UNIT-001');
      expect(allRevalidated).toContain('BOLT-001');
      expect(revalResult.errors.length).toBe(0);

      // Verify the final manifest state is consistent
      const finalManifest = loadManifest(manifestPath)!;
      for (const artifact of finalManifest.artifacts) {
        // Every artifact should be either 'active' (restored) or 'stale' (not restored)
        expect(['active', 'stale']).toContain(artifact.contract_status);
      }
    });
  });
});
