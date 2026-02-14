/**
 * Quality Gate Hooks Registration
 *
 * Implements Phase 4 (Quality Gates and Governance) of the ODLC workflow engine.
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
 * - Runs V&V placeholder checks (alignment engine coming in Phase 4.5)
 * - Auto-advances based on trust level and risk tier
 * - Records all gate decisions in manifest audit trail
 * - Supports bypass via --no-gates flag or config setting
 * - Fail-open on errors to prevent blocking legitimate work
 */

import { registerHook } from '../registry.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import {
  loadManifest,
  saveManifest,
  addGateAuditEntry,
  updateContractStatus,
  updatePhaseStatus,
} from '../../features/workflow-engine/manifest.js';
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

/**
 * V&V validation questions templates by transition type.
 * These questions guide human reviewers during gate approval.
 */
const VV_QUESTIONS: Record<string, AlignmentQuestion[]> = {
  inception: [
    {
      question: 'Does the PRD address all IDEA constraints?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Does the PRD solve the actual business problem?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Does the SPEC implement all PRD user stories?',
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: 'Do INTENTS cover all SPEC components?',
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
};

/**
 * Loads trust state from .olympus/trust-state.json.
 * Returns default state if file doesn't exist.
 *
 * @param projectPath - Absolute path to project root
 * @returns Trust state object
 */
function loadTrustState(projectPath: string): TrustState {
  try {
    const trustPath = join(projectPath, '.olympus', 'trust-state.json');
    if (fs.existsSync(trustPath)) {
      return fs.readJsonSync(trustPath) as TrustState;
    }
  } catch (error) {
    console.error('[Olympus Quality Gate] Failed to load trust state:', error);
  }

  // Default trust state
  return {
    current_level: 0 as TrustLevel,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
  };
}

/**
 * Saves trust state to .olympus/trust-state.json.
 *
 * @param projectPath - Absolute path to project root
 * @param state - Trust state to save
 */
function saveTrustState(projectPath: string, state: TrustState): void {
  try {
    const trustPath = join(projectPath, '.olympus', 'trust-state.json');
    fs.ensureDirSync(join(projectPath, '.olympus'));
    fs.writeJsonSync(trustPath, state, { spaces: 2 });
  } catch (error) {
    console.error('[Olympus Quality Gate] Failed to save trust state:', error);
  }
}

/**
 * Determines if a phase transition should auto-advance based on trust level and risk tier.
 *
 * Trust progression:
 * - Level 0: Never auto-advance (manual approval required)
 * - Level 1: Auto-advance Tier 1 only
 * - Level 2: Auto-advance Tier 1 and Tier 2
 * - Level 3: Auto-advance Tier 1 and Tier 2 (Tier 3 still requires approval)
 *
 * @param riskTier - Risk tier of the workflow (1=low, 2=medium, 3=high)
 * @param trustLevel - Current trust level (0-3)
 * @returns True if should auto-advance, false if manual approval needed
 */
function shouldAutoAdvance(riskTier: RiskTier, trustLevel: TrustLevel): boolean {
  if (trustLevel === 0) return false;
  if (trustLevel === 1) return riskTier === 1;
  if (trustLevel === 2) return riskTier <= 2;
  if (trustLevel === 3) return riskTier <= 2; // Tier 3 still needs approval even at Trust 3
  return false;
}

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
    // Legacy checkpoint - check if Inception is completing (intent stage complete)
    if (checkpoint.current_stage === 'intent' || checkpoint.current_stage === 'complete') {
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

  // Simple heuristic: Inception completes when intent stage is done
  if (
    currentPhase === 'inception' &&
    (checkpoint.current_stage === 'intent' || checkpoint.current_stage === 'complete')
  ) {
    return 'inception';
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
 * Runs V&V placeholder verification (alignment engine coming in Phase 4.5).
 * Records all gate decisions in manifest audit trail.
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
      checkpoint.risk_tier?.tier || manifest.risk_tier?.tier || 2; // Default tier 2

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
      return { continue: true };
    }

    // NOT auto-advancing - block for human review
    // Run V&V stub verification
    const verification: AlignmentVerificationResult = {
      conformance_score: 0,
      coverage_percentage: 0,
      missing_items: ['Alignment engine not yet available (Phase 4.5)'],
      passed: false,
    };

    // Create validation questions based on transition type
    const questions = VV_QUESTIONS[transitioningPhase] || [];
    const validation: AlignmentValidationResult = {
      alignment_score: 0,
      alignment_questions: questions,
      passed: false,
    };

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

    // Return with context injection to block and request approval
    const message = `STOP: Phase transition from ${transitioningPhase} requires approval.

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

      // Update artifact contract status to 'active'
      const phaseArtifacts = manifest.artifacts.filter((a) => a.phase === pendingPhase);
      for (const artifact of phaseArtifacts) {
        updateContractStatus(manifestPath, artifact.id, 'active');
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
      saveTrustState(ctx.directory, trustState);

      saveManifest(manifestPath, manifest);

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `Gate approved. Phase ${pendingPhase} transition approved. Proceeding to next phase.`,
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

      // Update artifact contract status to 'violated'
      const phaseArtifacts = manifest.artifacts.filter((a) => a.phase === pendingPhase);
      for (const artifact of phaseArtifacts) {
        updateContractStatus(manifestPath, artifact.id, 'violated', reason);
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
      saveTrustState(ctx.directory, trustState);

      saveManifest(manifestPath, manifest);

      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext: `Gate rejected. Reason: ${reason}. Revise artifacts before retrying.`,
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
