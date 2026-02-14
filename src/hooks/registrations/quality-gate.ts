/**
 * Quality Gate Hooks Registration
 *
 * Implements quality gates and governance for the ODLC workflow engine.
 * Provides two critical hooks:
 * 1. qualityGateBlocker (PostToolUse): Detects phase transitions and blocks for approval
 * 2. qualityGateApprover (UserPromptSubmit): Processes approve/reject commands
 *
 * These hooks enforce quality gates between workflow phases, ensuring alignment
 * verification and validation before allowing transitions. Supports trust-based
 * auto-advance and gate bypass via flags/config.
 *
 * Key behaviors:
 * - Detects Inception→Construction and Construction→Operations transitions
 * - Runs V&V alignment checks via the alignment engine
 * - Auto-advances based on trust level and risk tier
 * - Records all gate decisions in manifest audit trail
 * - Supports bypass via --no-gates flag or config setting
 * - Enforces Momus review for Risk Tier 3 Inception gates
 * - Persists checkpoint after gate decisions
 * - Fail-open on errors to prevent blocking legitimate work
 */

import { registerHook } from '../registry.js';
import { loadCheckpoint, listWorkflows, saveCheckpoint } from '../../features/workflow-engine/checkpoint.js';
import { assessDepthFromIdea, getDepthQuestionLimits } from '../../features/workflow-engine/depth-assessment.js';
import {
  loadManifest,
  saveManifest,
  addGateAuditEntry,
  updateContractStatus,
  updatePhaseStatus,
} from '../../features/workflow-engine/manifest.js';
import { loadTrustState, saveTrustState, shouldAutoAdvance } from '../../features/workflow-engine/trust.js';
import { computeVerification, generateValidationQuestions, runDualValidation } from '../../features/workflow-engine/alignment.js';
import { presentGate3, presentGate4, presentGate5, getGate3TrustBehavior, getGate4TrustBehavior, findParentUnit } from '../../features/workflow-engine/gate-presenter.js';
import { generateValidationReport, getValidationReportPath } from '../../features/workflow-engine/validation-report.js';
import type {
  WorkflowPhase,
  TrustState,
  TrustLevel,
  RiskTier,
  AlignmentVerificationResult,
  AlignmentValidationResult,
  AlignmentQuestion,
  GateResult,
  ManifestSchema,
} from '../../features/workflow-engine/phase-types.js';
import type { HookContext, HookResult } from '../types.js';
import * as fs from 'fs-extra';
import { join } from 'path';
import { readFileSync } from 'fs';

/**
 * V&V validation questions templates by transition type.
 * These questions guide human reviewers during gate approval.
 */
const VV_QUESTIONS: Record<string, AlignmentQuestion[]> = {
  inception: [
    {
      question: 'Does the INTENT address all IDEA constraints?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Does the INTENT solve the actual business problem defined in the IDEA?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Are NFRs properly derived from IDEA constraints?',
      answer: null,
      answered_by: null,
      passed: null,
    },
  ],
  construction: [
    {
      question: 'Do UNITS cover all INTENT acceptance criteria?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Does DESIGN address all UNIT requirements?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Does BUILD satisfy DESIGN contracts?',
      answer: null,
      answered_by: null,
      passed: null,
    },
  ],
  operations: [
    {
      question: 'Does the deployment guide cover all components?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Does the monitoring config capture key metrics?',
      answer: null,
      answered_by: null,
      passed: null,
    },
  ],
  gate3: [
    {
      question: 'Do UNITs cover all INTENT acceptance criteria?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Is the decomposition granularity appropriate?',
      answer: null,
      answered_by: null,
      passed: null,
    },
  ],
  gate4: [
    {
      question: 'Does the BOLT implementation satisfy its acceptance criteria?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Are all tests passing?',
      answer: null,
      answered_by: null,
      passed: null,
    },
  ],
};

/**
 * Finds the active workflow with a running checkpoint.
 * Prefers the most recently updated non-complete workflow.
 *
 * @param projectPath - Absolute path to project root
 * @returns Workflow ID, checkpoint, and manifest path, or null if none found
 */
async function findActiveWorkflow(
  projectPath: string
): Promise<{ workflowId: string; checkpoint: any; manifestPath: string } | null> {
  try {
    const workflows = await listWorkflows(projectPath);
    if (workflows.length === 0) return null;

    let bestMatch: {
      workflowId: string;
      checkpoint: any;
      manifestPath: string;
      updatedAt: string;
    } | null = null;

    for (const workflowId of workflows) {
      const checkpoint = await loadCheckpoint(projectPath, workflowId);
      if (!checkpoint || checkpoint.status === 'complete') continue;

      const manifestPath =
        (checkpoint as any).manifest_path ||
        join(projectPath, '.olympus', 'workflow', workflowId, 'manifest.json');

      if (!bestMatch || checkpoint.updated_at > bestMatch.updatedAt) {
        bestMatch = {
          workflowId,
          checkpoint,
          manifestPath,
          updatedAt: checkpoint.updated_at,
        };
      }
    }

    if (!bestMatch) return null;
    return {
      workflowId: bestMatch.workflowId,
      checkpoint: bestMatch.checkpoint,
      manifestPath: bestMatch.manifestPath,
    };
  } catch (error) {
    console.error('[Olympus Quality Gate] Failed to find active workflow:', error);
    return null;
  }
}

/**
 * Detects if a Task completion represents a phase transition.
 * Checks if the current phase is completing based on checkpoint state.
 *
 * @param checkpoint - Workflow checkpoint
 * @param manifest - Manifest schema (nullable)
 * @returns Phase that is transitioning, or null if no transition
 */
function detectPhaseTransition(
  checkpoint: any,
  manifest: ManifestSchema | null
): WorkflowPhase | null {
  // Check if the current phase is completing
  const currentPhase = (checkpoint as any).current_phase as WorkflowPhase | undefined;

  if (!currentPhase) {
    // Legacy checkpoint - check if Inception stage gates are needed
    if (checkpoint.current_stage === 'idea' || checkpoint.current_stage === 'intent' || checkpoint.current_stage === 'complete') {
      return 'inception';
    }
    return null;
  }

  // Check manifest phase status
  if (manifest) {
    const phaseState = manifest.phases[currentPhase];
    if (phaseState && phaseState.status === 'in_progress') {
      // Check if the phase gate hasn't been processed yet
      if (
        !phaseState.gate_result ||
        (phaseState.gate_result && !phaseState.gate_result.passed && phaseState.gate_result.approved_by === null)
      ) {
        // Don't re-trigger if gate is already pending
        if (phaseState.gate_result && phaseState.gate_result.approved_by === null) {
          return null; // Gate already pending
        }
        return currentPhase;
      }
    }
  }

  // Inception has stage-level gates: Gate 1 after IDEA, Gate 2 after INTENT
  if (
    currentPhase === 'inception' &&
    (checkpoint.current_stage === 'idea' || checkpoint.current_stage === 'intent' || checkpoint.current_stage === 'complete')
  ) {
    return 'inception';
  }

  // Gate 3: Construction phase, unit stage - fires after UNIT decomposition completes
  if (currentPhase === 'construction' && checkpoint.current_stage === 'unit') {
    return 'construction';
  }

  // Gate 4: Construction phase, bolt stage with active bolt - fires after BOLT execution
  if (currentPhase === 'construction' && checkpoint.current_stage === 'bolt' && checkpoint.active_bolt_id) {
    return 'construction';
  }

  // Gate 5: Operations phase - placeholder for release review (wired in Task 3.7)
  if (currentPhase === 'operations') {
    return 'operations';
  }

  return null;
}

/**
 * Checks if quality gates are disabled via config.
 *
 * @param projectPath - Absolute path to project root
 * @returns True if gates are disabled in config
 */
function isGatesDisabled(projectPath: string): boolean {
  try {
    const configPath = join(projectPath, '.olympus', 'config.json');
    if (fs.existsSync(configPath)) {
      const config = fs.readJsonSync(configPath);
      if (config?.workflow?.qualityGates?.enabled === false) return true;
      if (config?.hooks?.qualityGate?.enabled === false) return true;
    }
  } catch {
    // Config parse error - default to gates enabled
  }
  return false;
}

/**
 * Finds a pending gate in the manifest.
 *
 * @param manifest - Manifest schema
 * @returns Phase with pending gate, or null if none found
 */
function findPendingGate(manifest: ManifestSchema): WorkflowPhase | null {
  for (const phase of ['discovery', 'inception', 'construction', 'operations'] as WorkflowPhase[]) {
    const phaseState = manifest.phases[phase];
    if (
      phaseState.gate_result &&
      !phaseState.gate_result.passed &&
      phaseState.gate_result.approved_by === null
    ) {
      return phase;
    }
  }
  return null;
}

/**
 * Extracts prompt text from various context formats.
 *
 * @param ctx - Hook context
 * @returns Extracted prompt text
 */
function getPromptText(ctx: HookContext): string {
  if (ctx.prompt) return ctx.prompt;
  if (ctx.message?.content) return ctx.message.content;
  if (ctx.parts)
    return ctx.parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join(' ');
  return '';
}

/**
 * Quality Gate Blocker Hook (PostToolUse, priority 80)
 *
 * Detects phase transitions when Task tool completes and either:
 * 1. Auto-advances if trust level permits (based on risk tier)
 * 2. Blocks and requests human approval via context injection
 *
 * Runs V&V alignment checks for verification and validation.
 * Records all gate decisions in manifest audit trail.
 * Persists checkpoint after gate decisions.
 * Enforces Momus review for Risk Tier 3 Inception gates.
 *
 * Always fails open on errors to prevent blocking legitimate work.
 *
 * @param ctx - Hook context with tool execution result
 * @returns Hook result with potential gate blocking message
 */
async function qualityGateBlocker(ctx: HookContext): Promise<HookResult> {
  try {
    // Only process Task tool completions
    if (ctx.toolName !== 'Task') {
      return { continue: true };
    }

    // Guard: require directory and session ID
    if (!ctx.directory || !ctx.sessionId) {
      return { continue: true };
    }

    // Find active workflow
    const activeWorkflow = await findActiveWorkflow(ctx.directory);
    if (!activeWorkflow) {
      return { continue: true };
    }

    const { workflowId, checkpoint, manifestPath } = activeWorkflow;

    // Load manifest (fail open if corrupted)
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      console.error('[Olympus Quality Gate] Manifest corrupted or missing - failing open');
      return { continue: true };
    }

    // Detect phase transition
    const transitioningPhase = detectPhaseTransition(checkpoint, manifest);
    if (!transitioningPhase) {
      return { continue: true };
    }

    // Check trust-based auto-advance
    const trustState = loadTrustState(ctx.directory);
    const riskTier: RiskTier =
      (typeof checkpoint.risk_tier === 'number' ? checkpoint.risk_tier : checkpoint.risk_tier?.tier) ||
      manifest.risk_tier?.tier || 2; // Default tier 2

    // Risk Tier 3 Momus review enforcement for inception phase
    if (riskTier === 3 && transitioningPhase === 'inception') {
      const hasMomusReview = manifest.artifacts.some(
        (a) => a.type?.toLowerCase().includes('momus') || a.type?.toLowerCase() === 'momus-review'
      );
      if (!hasMomusReview) {
        // Block gate transition - Momus review required
        manifest.phases[transitioningPhase].gate_result = {
          passed: false,
          approved_by: null,
          approved_at: null,
          feedback: 'Momus review required for Risk Tier 3',
          verification: {
            conformance_score: 0,
            coverage_percentage: 0,
            missing_items: ['Momus review artifact missing'],
            passed: false,
          },
          validation: {
            alignment_score: 0,
            alignment_questions: [],
            passed: false,
          },
        };
        saveManifest(manifestPath, manifest);
        await saveCheckpoint(ctx.directory, checkpoint);

        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `[BLOCKING - Acknowledgment Required] BLOCKED: Risk Tier 3 requires Momus review before INTENT approval. Run /review to invoke Momus.\n\n[GATE_PENDING]`,
          },
        };
      }
    }

    // --- Gate 3: Construction phase, unit stage ---
    if (transitioningPhase === 'construction' && checkpoint.current_stage === 'unit') {
      const gate3Behavior = getGate3TrustBehavior(trustState.current_level, riskTier);

      if (gate3Behavior === 'auto-advance' && riskTier !== 3) {
        // Auto-advance: record audit, save, return silently
        addGateAuditEntry(manifestPath, {
          phase: 'construction',
          action: 'approved',
          actor: 'trust',
          reason: `Gate 3 auto-advanced by Trust Level ${trustState.current_level} for Tier ${riskTier}`,
        });

        const now = new Date().toISOString();
        manifest.phases.construction.gate_result = {
          passed: true,
          approved_by: 'trust',
          approved_at: now,
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

        // Set reviewedBy on UNIT artifacts
        for (const artifact of manifest.artifacts) {
          if (artifact.stage === 'unit') {
            artifact.reviewedBy = 'auto-approved';
          }
        }

        saveManifest(manifestPath, manifest);
        await saveCheckpoint(ctx.directory, checkpoint);
        return { continue: true };
      }

      // Blocking: present Gate 3
      let verification: AlignmentVerificationResult;
      try {
        const inceptionDir = join(ctx.directory, 'aidlc-docs', workflowId, 'inception');
        const ideaContent = readFileSync(join(inceptionDir, 'idea.md'), 'utf-8');
        // Find a UNIT spec to validate against
        const unitArtifacts = manifest.artifacts.filter(a => a.stage === 'unit');
        const unitContent = unitArtifacts.length > 0
          ? readFileSync(join(ctx.directory, unitArtifacts[0].path), 'utf-8')
          : '';

        const dualResult = runDualValidation(
          unitContent,      // artifact
          ideaContent,      // parent (IDEA for unit check)
          ideaContent,      // root
          'intent-to-unit', // transition (parent transition type)
          'unit-to-idea',   // root check
          'idea',           // sourceId
          unitArtifacts[0]?.id || 'unit',  // targetId
          'idea'            // rootId
        );
        verification = {
          conformance_score: dualResult.parentCheck.verification.conformance_score,
          coverage_percentage: dualResult.parentCheck.verification.coverage_percentage,
          missing_items: dualResult.parentCheck.verification.missing_items,
          passed: dualResult.passed,
        };
      } catch {
        verification = {
          conformance_score: 0,
          coverage_percentage: 0,
          missing_items: ['Could not read construction artifacts for alignment check'],
          passed: false,
        };
      }

      const questions = VV_QUESTIONS['gate3'] || [];
      const validation: AlignmentValidationResult = {
        alignment_score: 0,
        alignment_questions: questions,
        passed: false,
      };

      const presentations = presentGate3(manifest, trustState.current_level);
      const reviewContent = presentations.map(p => p.reviewContent).join('\n\n');

      manifest.phases.construction.gate_result = {
        passed: false,
        approved_by: null,
        approved_at: null,
        feedback: null,
        verification,
        validation,
      };

      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'trust',
        reason: `Gate 3 pending review`,
      });

      saveManifest(manifestPath, manifest);
      await saveCheckpoint(ctx.directory, checkpoint);

      const devPrefix = riskTier === 3 ? '[BLOCKING - Acknowledgment Required] ' : '';
      const message = `${devPrefix}STOP: Gate 3 (UNIT decomposition review) requires approval.

${reviewContent}

VERIFICATION: ${verification.conformance_score}% conformance, ${verification.coverage_percentage}% coverage.
Missing: ${verification.missing_items.join(', ')}

VALIDATION: Review alignment questions:
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

Type "approve" to proceed or "reject <reason>" to block.

[GATE_PENDING]`;

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: message,
        },
      };
    }

    // --- Gate 4: Construction phase, bolt stage ---
    if (transitioningPhase === 'construction' && checkpoint.current_stage === 'bolt' && checkpoint.active_bolt_id) {
      const boltId = checkpoint.active_bolt_id;
      const gate4Behavior = getGate4TrustBehavior(trustState.current_level, riskTier);

      // Run V&V dual validation for bolt-to-idea
      let verification: AlignmentVerificationResult;
      try {
        const inceptionDir = join(ctx.directory, 'aidlc-docs', workflowId, 'inception');
        const ideaContent = readFileSync(join(inceptionDir, 'idea.md'), 'utf-8');
        const boltArtifact = manifest.artifacts.find(a => a.id === boltId);
        const boltContent = boltArtifact
          ? readFileSync(join(ctx.directory, boltArtifact.path), 'utf-8')
          : '';

        const dualResult = runDualValidation(
          boltContent,      // artifact
          ideaContent,      // parent
          ideaContent,      // root
          'unit-to-bolt',   // transition (parent transition type)
          'bolt-to-idea',   // root check
          'idea',           // sourceId
          boltId,           // targetId
          'idea'            // rootId
        );
        verification = {
          conformance_score: dualResult.parentCheck.verification.conformance_score,
          coverage_percentage: dualResult.parentCheck.verification.coverage_percentage,
          missing_items: dualResult.parentCheck.verification.missing_items,
          passed: dualResult.passed,
        };
      } catch {
        verification = {
          conformance_score: 0,
          coverage_percentage: 0,
          missing_items: ['Could not read BOLT artifacts for alignment check'],
          passed: false,
        };
      }

      const questions = VV_QUESTIONS['gate4'] || [];
      const validation: AlignmentValidationResult = {
        alignment_score: 0,
        alignment_questions: questions,
        passed: false,
      };

      // Gate 4 trust-adaptive behavior (Tier 3 always blocking)
      if (gate4Behavior === 'notification-only' && riskTier !== 3) {
        // Notification-only: auto-advance but record audit
        addGateAuditEntry(manifestPath, {
          phase: 'construction',
          action: 'approved',
          actor: 'trust',
          reason: `Gate 4 notification-only for BOLT ${boltId} at Trust Level ${trustState.current_level}`,
        });

        const now = new Date().toISOString();
        manifest.phases.construction.gate_result = {
          passed: true,
          approved_by: 'trust',
          approved_at: now,
          feedback: null,
          verification,
          validation,
        };

        // Set reviewedBy on the BOLT artifact
        const boltArtifact = manifest.artifacts.find(a => a.id === boltId);
        if (boltArtifact) {
          boltArtifact.reviewedBy = 'auto-approved';
        }

        // Mark BOLT contract as fulfilled
        updateContractStatus(manifestPath, boltId, 'fulfilled');

        // Generate validation report after Gate 4 auto-advance
        try {
          const parentUnitId = findParentUnit(manifest, boltId);
          if (parentUnitId && ctx.directory) {
            const reportPath = getValidationReportPath(ctx.directory, parentUnitId);
            generateValidationReport(reportPath, parentUnitId, {
              boltId,
              boltTitle: boltArtifact?.type || 'auto-approved',
              commandsExecuted: [],
              testResults: [],
              filesChanged: [],
              gateApprovedBy: 'auto-approved',
              dualValidation: {
                parentConformance: verification.conformance_score,
                rootConformance: 0,
              },
              riskTier,
            });
          }
        } catch (error) {
          console.error('[Olympus Quality Gate] Failed to generate validation report:', error);
          // Fail-open: don't block approval if report generation fails
        }

        saveManifest(manifestPath, manifest);
        await saveCheckpoint(ctx.directory, checkpoint);

        // Check if all BOLTs are now fulfilled → auto-transition to Operations
        let autoTransitionMessage = '';
        try {
          const { isWorkflowComplete } = await import('../../features/workflow-engine/manifest.js');
          const refreshedManifest = loadManifest(manifestPath);
          if (refreshedManifest && isWorkflowComplete(refreshedManifest)) {
            checkpoint.current_phase = 'operations' as WorkflowPhase;
            checkpoint.current_stage = 'bolt'; // Per Decision 12: stage stays 'bolt' during Operations
            updatePhaseStatus(manifestPath, 'construction', 'complete');
            updatePhaseStatus(manifestPath, 'operations', 'in_progress');
            await saveCheckpoint(ctx.directory, checkpoint);
            autoTransitionMessage = ' All BOLTs fulfilled — auto-transitioning to Operations phase.';
            console.log('[Olympus Quality Gate] All BOLTs fulfilled — auto-transitioning to Operations phase');
          }
        } catch (error) {
          console.error('[Olympus Quality Gate] Failed to check workflow completion:', error);
        }

        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: `Gate 4 (BOLT ${boltId} review): Auto-approved at Trust Level ${trustState.current_level}. Notification only.${autoTransitionMessage}`,
          },
        };
      }

      // Present Gate 4 (blocking or summary-review)
      let presentation;
      try {
        presentation = presentGate4(manifest, boltId, trustState.current_level, riskTier);
      } catch {
        // Fail open if BOLT artifact not found
        return { continue: true };
      }

      manifest.phases.construction.gate_result = {
        passed: false,
        approved_by: null,
        approved_at: null,
        feedback: null,
        verification,
        validation,
      };

      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'trust',
        reason: `Gate 4 pending review for BOLT ${boltId}`,
      });

      saveManifest(manifestPath, manifest);
      await saveCheckpoint(ctx.directory, checkpoint);

      const devPrefix = riskTier === 3 ? '[BLOCKING - Acknowledgment Required] ' : '';
      const reviewType = gate4Behavior === 'summary-review' ? ' (Summary Review)' : '';
      const message = `${devPrefix}STOP: Gate 4 (BOLT ${boltId} review)${reviewType} requires approval.

${presentation.reviewContent}

VERIFICATION: ${verification.conformance_score}% conformance, ${verification.coverage_percentage}% coverage.
Missing: ${verification.missing_items.join(', ')}

VALIDATION: Review alignment questions:
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

Type "approve" to proceed or "reject <reason>" to block.

[GATE_PENDING]`;

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: message,
        },
      };
    }

    // --- Gate 5: Operations phase (placeholder) ---
    if (transitioningPhase === 'operations') {
      let presentation;
      try {
        presentation = presentGate5(manifest, trustState.current_level);
      } catch {
        // Fail open
        return { continue: true };
      }

      const questions = VV_QUESTIONS['operations'] || [];
      const verification: AlignmentVerificationResult = {
        conformance_score: 0,
        coverage_percentage: 0,
        missing_items: ['Release review pending'],
        passed: false,
      };
      const validation: AlignmentValidationResult = {
        alignment_score: 0,
        alignment_questions: questions,
        passed: false,
      };

      manifest.phases.operations.gate_result = {
        passed: false,
        approved_by: null,
        approved_at: null,
        feedback: null,
        verification,
        validation,
      };

      saveManifest(manifestPath, manifest);
      await saveCheckpoint(ctx.directory, checkpoint);

      const message = `[BLOCKING - Acknowledgment Required] STOP: Gate 5 (Release review) requires approval.

${presentation.reviewContent}

VALIDATION: Review alignment questions:
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

Type "approve" to proceed or "reject <reason>" to block.

[GATE_PENDING]`;

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'PostToolUse',
          additionalContext: message,
        },
      };
    }

    // --- Inception gates (Gate 1 / Gate 2) and generic phase gates ---
    if (shouldAutoAdvance(riskTier, trustState.current_level)) {
      // Auto-advance: record gate approval and continue
      addGateAuditEntry(manifestPath, {
        phase: transitioningPhase,
        action: 'approved',
        actor: 'trust',
        reason: `Auto-advanced by Trust Level ${trustState.current_level} for Tier ${riskTier}`,
      });

      const now = new Date().toISOString();
      manifest.phases[transitioningPhase].gate_result = {
        passed: true,
        approved_by: 'trust',
        approved_at: now,
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

      saveManifest(manifestPath, manifest);
      await saveCheckpoint(ctx.directory, checkpoint);
      return { continue: true };
    }

    // NOT auto-advancing - block for human review
    // Run V&V alignment checks
    let verification: AlignmentVerificationResult;
    let questions: AlignmentQuestion[];

    if (transitioningPhase === 'inception') {
      try {
        const inceptionDir = join(ctx.directory, 'aidlc-docs', workflowId, 'inception');
        const ideaContent = readFileSync(join(inceptionDir, 'idea.md'), 'utf-8');

        if (checkpoint.current_stage === 'intent' || checkpoint.current_stage === 'complete') {
          // Gate 2: INTENT exists, run dual validation against IDEA
          const intentContent = readFileSync(join(inceptionDir, 'intent.md'), 'utf-8');
          const dualResult = runDualValidation(
            intentContent,    // artifact
            ideaContent,      // parent
            ideaContent,      // root (same as parent for inception)
            'idea-to-intent', // transition
            'unit-to-idea',   // root transition (closest available)
            'idea',           // sourceId
            'intent',         // targetId
            'idea'            // rootId
          );
          verification = {
            conformance_score: dualResult.parentCheck.verification.conformance_score,
            coverage_percentage: dualResult.parentCheck.verification.coverage_percentage,
            missing_items: dualResult.parentCheck.verification.missing_items,
            passed: dualResult.passed,
          };
          questions = generateValidationQuestions('idea-to-intent');
        } else {
          // Gate 1: Only IDEA exists, do structural verification
          verification = computeVerification(ideaContent, ideaContent, 'idea-to-intent');
          questions = VV_QUESTIONS[transitioningPhase] || [];
        }
      } catch {
        // Fail-open fallback
        verification = {
          conformance_score: 0,
          coverage_percentage: 0,
          missing_items: ['Could not read inception artifacts for alignment check'],
          passed: false,
        };
        questions = VV_QUESTIONS[transitioningPhase] || [];
      }
    } else {
      // For other phases, use VV_QUESTIONS fallback
      verification = {
        conformance_score: 0,
        coverage_percentage: 0,
        missing_items: ['Alignment check not yet implemented for this phase'],
        passed: false,
      };
      questions = VV_QUESTIONS[transitioningPhase] || [];
    }

    const validation: AlignmentValidationResult = {
      alignment_score: 0,
      alignment_questions: questions,
      passed: false,
    };

    // Check for DEEP depth without Metis consultation
    let depthWarning = '';
    if (transitioningPhase === 'inception') {
      const depthScore = checkpoint.depth_score || manifest.depth_assessment?.total_score;
      if (depthScore && depthScore >= 21) {
        const hasMetisArtifact = manifest.artifacts.some(
          (a) => a.type?.toLowerCase().includes('metis')
        );
        if (!hasMetisArtifact) {
          depthWarning = '\n\nWARNING: DEEP workflow without Metis consultation detected. Metis blind-spot analysis is strongly recommended for complex workflows.';
        }
      }
    }

    // Store gate request in manifest
    manifest.phases[transitioningPhase].gate_result = {
      passed: false,
      approved_by: null,
      approved_at: null,
      feedback: null,
      verification,
      validation,
    };

    saveManifest(manifestPath, manifest);
    await saveCheckpoint(ctx.directory, checkpoint);

    // Return with context injection to block and request approval
    const devPrefix = riskTier === 3 ? '[BLOCKING - Acknowledgment Required] ' : '';
    const gateLabel = checkpoint.current_stage === 'idea' ? 'Gate 1 (IDEA review)' :
                      checkpoint.current_stage === 'intent' ? 'Gate 2 (INTENT review)' :
                      `${transitioningPhase} transition`;
    const message = `${devPrefix}STOP: ${gateLabel} requires approval.

VERIFICATION: ${verification.conformance_score}% conformance, ${verification.coverage_percentage}% coverage.
Missing: ${verification.missing_items.join(', ')}

VALIDATION: Review alignment questions:
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

Type "approve" to proceed or "reject <reason>" to block.${depthWarning}

[GATE_PENDING]`;

    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    };
  } catch (error) {
    console.error('[Olympus Quality Gate] Error in qualityGateBlocker:', error);
    return { continue: true }; // Fail open
  }
}

/**
 * Quality Gate Approver Hook (UserPromptSubmit, priority 12)
 *
 * Checks for pending gate approvals in user prompts.
 * Processes "approve" and "reject <reason>" commands.
 * Supports gate bypass via --no-gates flag or config setting.
 *
 * On approval:
 * - Marks gate as passed in manifest
 * - Updates artifact contract status to 'active'
 * - Records approval in audit trail
 * - Increments trust transition count
 *
 * On rejection:
 * - Marks gate as failed in manifest
 * - Updates artifact contract status to 'violated'
 * - Records rejection in audit trail
 * - Increments trust rejection count
 *
 * Always fails open on errors.
 *
 * @param ctx - Hook context with user prompt
 * @returns Hook result with approval/rejection message or pass-through
 */
async function qualityGateApprover(ctx: HookContext): Promise<HookResult> {
  try {
    const promptText = getPromptText(ctx);

    // Guard: require directory
    if (!ctx.directory) {
      return { continue: true };
    }

    // Check for --no-gates flag or config bypass
    if (promptText.includes('--no-gates') || isGatesDisabled(ctx.directory)) {
      const activeWorkflow = await findActiveWorkflow(ctx.directory);
      if (activeWorkflow) {
        const { manifestPath } = activeWorkflow;
        const manifest = loadManifest(manifestPath);
        if (manifest) {
          // Find pending gate and bypass it
          const pendingPhase = findPendingGate(manifest);
          if (pendingPhase) {
            const actor = promptText.includes('--no-gates') ? 'flag' : 'config';
            addGateAuditEntry(manifestPath, {
              phase: pendingPhase,
              action: 'bypassed',
              actor,
              reason: actor === 'flag' ? '--no-gates flag detected' : 'Quality gates disabled in config',
            });

            // Clear gate and mark as bypassed
            manifest.phases[pendingPhase].gate_result = null;
            manifest.phases[pendingPhase].gate_bypassed = true;
            manifest.phases[pendingPhase].bypass_reason =
              actor === 'flag' ? '--no-gates flag' : 'Config disabled';

            saveManifest(manifestPath, manifest);
            await saveCheckpoint(ctx.directory, activeWorkflow.checkpoint);
          }
        }
      }
      return { continue: true };
    }

    // Check if prompt starts with "approve" (case-insensitive)
    if (promptText.trim().toLowerCase().startsWith('approve')) {
      const activeWorkflow = await findActiveWorkflow(ctx.directory);
      if (!activeWorkflow) {
        return { continue: true };
      }

      const { manifestPath } = activeWorkflow;
      const manifest = loadManifest(manifestPath);
      if (!manifest) {
        return { continue: true };
      }

      const pendingPhase = findPendingGate(manifest);
      if (!pendingPhase) {
        return { continue: true };
      }

      // Mark gate as approved
      const now = new Date().toISOString();
      if (manifest.phases[pendingPhase].gate_result) {
        manifest.phases[pendingPhase].gate_result!.passed = true;
        manifest.phases[pendingPhase].gate_result!.approved_by = 'human';
        manifest.phases[pendingPhase].gate_result!.approved_at = now;
      }

      const { checkpoint } = activeWorkflow;

      // Construction gate-specific approval handling
      if (pendingPhase === 'construction') {
        if (checkpoint.current_stage === 'bolt' && checkpoint.active_bolt_id) {
          // Gate 4 approval: mark BOLT as fulfilled, set reviewedBy
          const boltId = checkpoint.active_bolt_id;
          updateContractStatus(manifestPath, boltId, 'fulfilled');

          // Set reviewedBy on the BOLT artifact
          const boltArtifact = manifest.artifacts.find(a => a.id === boltId);
          if (boltArtifact) {
            boltArtifact.reviewedBy = 'human';
          }

          // Generate validation report after Gate 4 approval
          try {
            const parentUnitId = findParentUnit(manifest, boltId);
            if (parentUnitId) {
              const reportPath = getValidationReportPath(ctx.directory, parentUnitId);
              const riskTier: RiskTier =
                (typeof checkpoint.risk_tier === 'number' ? checkpoint.risk_tier : checkpoint.risk_tier?.tier) ||
                manifest.risk_tier?.tier || 2;
              generateValidationReport(reportPath, parentUnitId, {
                boltId,
                boltTitle: boltArtifact?.type || boltId,
                commandsExecuted: [],  // Will be populated by CI pipeline (Task 3.5b)
                testResults: [],        // Will be populated by CI pipeline (Task 3.5b)
                filesChanged: [],       // Will be populated by CI pipeline (Task 3.5b)
                gateApprovedBy: 'human',
                dualValidation: {
                  parentConformance: manifest.phases.construction.gate_result?.verification?.conformance_score ?? 0,
                  rootConformance: 0,  // Root conformance from dual validation
                },
                riskTier,
              });
            }
          } catch (error) {
            console.error('[Olympus Quality Gate] Failed to generate validation report:', error);
            // Fail-open: don't block approval if report generation fails
          }

          // Check if all BOLTs are now fulfilled → auto-transition to Operations
          try {
            const { isWorkflowComplete } = await import('../../features/workflow-engine/manifest.js');
            const refreshedManifest = loadManifest(manifestPath);
            if (refreshedManifest && isWorkflowComplete(refreshedManifest)) {
              // All BOLTs fulfilled — transition to Operations phase
              checkpoint.current_phase = 'operations' as WorkflowPhase;
              checkpoint.current_stage = 'bolt'; // Per Decision 12: stage stays 'bolt' during Operations
              updatePhaseStatus(manifestPath, 'construction', 'complete');
              updatePhaseStatus(manifestPath, 'operations', 'in_progress');
              await saveCheckpoint(ctx.directory, checkpoint);
              console.log('[Olympus Quality Gate] All BOLTs fulfilled — auto-transitioning to Operations phase');
            }
          } catch (error) {
            console.error('[Olympus Quality Gate] Failed to check workflow completion:', error);
            // Fail-open: don't block if completion check fails
          }
        } else if (checkpoint.current_stage === 'unit') {
          // Gate 3 approval: mark UNIT contracts as active, set reviewedBy
          const unitArtifacts = manifest.artifacts.filter(a => a.stage === 'unit');
          for (const artifact of unitArtifacts) {
            updateContractStatus(manifestPath, artifact.id, 'active');
            artifact.reviewedBy = 'human';
          }
        }
      } else {
        // Non-construction: update artifact contract status to 'active'
        const phaseArtifacts = manifest.artifacts.filter((a) => a.phase === pendingPhase);
        for (const artifact of phaseArtifacts) {
          updateContractStatus(manifestPath, artifact.id, 'active');
        }
      }

      // Add gate audit entry
      addGateAuditEntry(manifestPath, {
        phase: pendingPhase,
        action: 'approved',
        actor: 'human',
        reason: null,
      });

      // Record transition for trust evaluation
      const trustState = loadTrustState(ctx.directory);
      trustState.total_transitions += 1;
      if (trustState.total_transitions > 0) {
        trustState.rejection_rate = trustState.rejection_count / trustState.total_transitions;
      }
      saveTrustState(trustState, ctx.directory);

      saveManifest(manifestPath, manifest);
      await saveCheckpoint(ctx.directory, activeWorkflow.checkpoint);

      // Reset gate_result so next stage gate can fire (Gate 1 → Gate 2 within inception)
      // The audit trail preserves the approval record
      if (manifest.phases[pendingPhase].gate_result?.passed) {
        manifest.phases[pendingPhase].gate_result = null;
        saveManifest(manifestPath, manifest);
      }

      // Add depth-aware guidance
      let depthGuidance = '';
      const depthScore = activeWorkflow.checkpoint.depth_score;
      if (depthScore && depthScore <= 10) {
        depthGuidance = ' SHALLOW depth: Skip UNIT decomposition, proceed directly to single BOLT generation.';
      } else if (depthScore && depthScore >= 21) {
        depthGuidance = ' DEEP depth: Full UNIT + BOLT decomposition with design artifacts required.';
      }

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `Gate approved. Phase ${pendingPhase} transition approved. Proceeding to next phase.${depthGuidance}`,
        },
      };
    }

    // Check if prompt starts with "reject" (case-insensitive)
    if (promptText.trim().toLowerCase().startsWith('reject')) {
      const activeWorkflow = await findActiveWorkflow(ctx.directory);
      if (!activeWorkflow) {
        return { continue: true };
      }

      const { manifestPath } = activeWorkflow;
      const manifest = loadManifest(manifestPath);
      if (!manifest) {
        return { continue: true };
      }

      const pendingPhase = findPendingGate(manifest);
      if (!pendingPhase) {
        return { continue: true };
      }

      // Extract reason from prompt after "reject"
      const reason = promptText.trim().substring(6).trim() || 'No reason provided';

      // Mark gate as rejected
      if (manifest.phases[pendingPhase].gate_result) {
        manifest.phases[pendingPhase].gate_result!.passed = false;
        manifest.phases[pendingPhase].gate_result!.feedback = reason;
      }

      const { checkpoint } = activeWorkflow;

      // Construction gate-specific rejection handling
      let rejectionFeedback = '';
      if (pendingPhase === 'construction') {
        if (checkpoint.current_stage === 'bolt' && checkpoint.active_bolt_id) {
          // Gate 4 rejection: mark BOLT as violated
          const boltId = checkpoint.active_bolt_id;
          updateContractStatus(manifestPath, boltId, 'violated', reason);
          rejectionFeedback = `The reviewer rejected ${boltId}: ${reason}. Revise and re-submit.`;
        } else if (checkpoint.current_stage === 'unit') {
          // Gate 3 rejection: mark UNIT artifacts as violated
          const unitArtifacts = manifest.artifacts.filter(a => a.stage === 'unit');
          for (const artifact of unitArtifacts) {
            updateContractStatus(manifestPath, artifact.id, 'violated', reason);
          }
          rejectionFeedback = `The reviewer rejected UNIT decomposition: ${reason}. Revise and re-submit.`;
        } else {
          // Generic construction rejection
          const phaseArtifacts = manifest.artifacts.filter((a) => a.phase === pendingPhase);
          for (const artifact of phaseArtifacts) {
            updateContractStatus(manifestPath, artifact.id, 'violated', reason);
          }
        }
      } else {
        // Non-construction: update artifact contract status to 'violated'
        const phaseArtifacts = manifest.artifacts.filter((a) => a.phase === pendingPhase);
        for (const artifact of phaseArtifacts) {
          updateContractStatus(manifestPath, artifact.id, 'violated', reason);
        }
      }

      // Add gate audit entry
      addGateAuditEntry(manifestPath, {
        phase: pendingPhase,
        action: 'rejected',
        actor: 'human',
        reason,
      });

      // Record rejection for trust evaluation
      const trustState = loadTrustState(ctx.directory);
      trustState.rejection_count += 1;
      trustState.total_transitions += 1;
      if (trustState.total_transitions > 0) {
        trustState.rejection_rate = trustState.rejection_count / trustState.total_transitions;
      }
      saveTrustState(trustState, ctx.directory);

      saveManifest(manifestPath, manifest);
      await saveCheckpoint(ctx.directory, activeWorkflow.checkpoint);

      const feedbackMessage = rejectionFeedback
        ? rejectionFeedback
        : `Gate rejected. Reason: ${reason}. Revise artifacts before retrying.`;

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: feedbackMessage,
        },
      };
    }

    // No approve/reject detected - pass through
    return { continue: true };
  } catch (error) {
    console.error('[Olympus Quality Gate] Error in qualityGateApprover:', error);
    return { continue: true }; // Fail open
  }
}

/**
 * Registers quality gate hooks with the hook router.
 * Called from registerAllHooks() in index.ts.
 */
export function registerQualityGateHooks(): void {
  // Hook 1: Blocker (PostToolUse, priority 80)
  registerHook({
    name: 'qualityGateBlocker',
    event: 'PostToolUse',
    priority: 80,
    matcher: 'task',
    handler: qualityGateBlocker,
  });

  // Hook 2: Approver (UserPromptSubmit, priority 12)
  registerHook({
    name: 'qualityGateApprover',
    event: 'UserPromptSubmit',
    priority: 12,
    handler: qualityGateApprover,
  });
}
