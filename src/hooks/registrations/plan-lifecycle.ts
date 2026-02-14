/**
 * Plan Lifecycle Hook Registration
 *
 * Tracks plan creation, revision, review, and completion events
 * to capture planning insights as discoveries.
 *
 * Hooks:
 * 1. PostToolUse (Write): Detects plan file writes to .olympus/plans/*.md
 * 2. PostToolUse (Task/momus): Captures Momus review outcomes
 * 3. UserPromptSubmit: Detects /complete-plan skill invocations
 * 4. PreToolUse (Task/prometheus): Injects plan learnings into Prometheus context
 */

import { registerHook } from '../registry.js';
import { loadSessionState, saveSessionState } from '../../learning/session-state.js';
import { detectPlanFileChange, parseMomusReviewOutput, createPlanningDiscovery, formatPlanLearnings } from '../../learning/plan-tracker.js';
import { recordDiscovery } from '../../learning/discovery.js';
import { getDiscoveriesForInjection } from '../../learning/discovery.js';
import { loadDiscoveryConfig } from '../../learning/config.js';
import { loadManifest, saveManifest } from '../../features/workflow-engine/manifest.js';
import { loadCheckpoint, saveCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import * as path from 'path';
import type { HookContext, HookResult } from '../types.js';

/**
 * Register all plan lifecycle hooks
 */
export function registerPlanLifecycleHooks(): void {
  // Hook 1: Monitor plan file writes
  registerHook({
    name: 'planFileMonitor',
    event: 'PostToolUse',
    priority: 75, // After learning capture tool (70), before budget (80+)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        // Only process Write tool
        if (ctx.toolName !== 'Write') {
          return { continue: true };
        }

        if (!ctx.directory || !ctx.sessionId) {
          return { continue: true };
        }

        // Check if config is enabled
        const config = loadDiscoveryConfig(ctx.directory);
        if (!config.enabled) {
          return { continue: true };
        }

        // Extract file path from tool input
        const toolInput = ctx.toolInput as Record<string, unknown> | undefined;
        const filePath = toolInput?.file_path as string | undefined;

        if (!filePath) {
          return { continue: true };
        }

        // Check if it's a plan file (.olympus/plans/*.md)
        const normalizedPath = filePath.replace(/\\/g, '/');
        if (!normalizedPath.includes('.olympus/plans/') || !normalizedPath.endsWith('.md')) {
          return { continue: true };
        }

        // Detect plan file change
        const event = detectPlanFileChange(ctx.directory, filePath, ctx.sessionId);
        if (!event) {
          return { continue: true };
        }

        // For revisions, create a discovery (revisions indicate planning quality issues)
        if (event.event_type === 'plan_revised' && event.revision_count && event.revision_count >= 2) {
          const discovery = createPlanningDiscovery(
            event,
            [`Plan revised ${event.revision_count} times - may indicate unclear requirements`],
            ctx.directory
          );
          if (discovery.summary && discovery.details) {
            recordDiscovery({
              ...discovery,
              project_path: ctx.directory,
              session_id: ctx.sessionId,
              category: discovery.category || 'planning_insight',
              summary: discovery.summary,
              details: discovery.details,
              agent_name: discovery.agent_name || 'prometheus',
              confidence: discovery.confidence || 0.7,
              scope: 'project',
            });
          }
        }
      } catch (error) {
        // Silent failure
        console.error('[Olympus Plan Lifecycle] Error in plan file monitor:', error);
      }

      return { continue: true };
    }
  });

  // Hook 2: Monitor Momus review outcomes
  registerHook({
    name: 'momusReviewTracker',
    event: 'PostToolUse',
    priority: 76,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (ctx.toolName !== 'Task') {
          return { continue: true };
        }

        if (!ctx.directory || !ctx.sessionId) {
          return { continue: true };
        }

        const config = loadDiscoveryConfig(ctx.directory);
        if (!config.enabled) {
          return { continue: true };
        }

        // Check if this was a momus task
        const toolInput = ctx.toolInput as Record<string, unknown> | undefined;
        const subagentType = toolInput?.subagent_type as string | undefined;

        if (subagentType !== 'momus') {
          return { continue: true };
        }

        // Parse the review output
        const toolOutput = ctx.toolOutput;
        const outputStr = typeof toolOutput === 'string'
          ? toolOutput
          : JSON.stringify(toolOutput || '');

        const reviewResult = parseMomusReviewOutput(outputStr);

        // Only create discoveries for failures with specific, actionable issues
        if (!reviewResult.passed && reviewResult.issues.length > 0) {
          // Skip generic "Plan requires revision" - not actionable
          const hasSpecificIssues = reviewResult.issues.some(
            issue => issue !== 'Plan requires revision' && issue.length > 10
          );

          if (!hasSpecificIssues) {
            return { continue: true };
          }

          // Extract plan file path from the Momus task prompt
          const taskPrompt = (toolInput?.prompt as string) || '';
          const planPathMatch = taskPrompt.match(/\.olympus\/plans\/([\w-]+\.md)/);
          const planPath = planPathMatch ? planPathMatch[0] : 'unknown-plan';
          const planFilename = planPathMatch ? planPathMatch[1] : 'unknown-plan';

          const event = {
            event_type: 'plan_review_failed' as const,
            plan_path: planPath,
            plan_summary: `Momus review failed with ${reviewResult.issues.length} issues`,
            failure_reasons: reviewResult.issues,
            reviewer: 'momus' as const,
            session_id: ctx.sessionId,
            timestamp: new Date().toISOString(),
          };

          const discovery = createPlanningDiscovery(event, reviewResult.issues, ctx.directory);
          if (discovery.summary && discovery.details) {
            recordDiscovery({
              ...discovery,
              project_path: ctx.directory,
              session_id: ctx.sessionId,
              category: 'planning_insight',
              summary: discovery.summary,
              details: discovery.details,
              agent_name: 'momus',
              confidence: 0.9,
              scope: 'project',
            });
          }
        }
      } catch (error) {
        console.error('[Olympus Plan Lifecycle] Error in Momus review tracker:', error);
      }

      return { continue: true };
    }
  });

  // Hook 3: Detect /complete-plan invocations
  registerHook({
    name: 'completePlanTracker',
    event: 'UserPromptSubmit',
    priority: 115, // After auto-slash-command expansion, very passive
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.directory || !ctx.sessionId) {
          return { continue: true };
        }

        const config = loadDiscoveryConfig(ctx.directory);
        if (!config.enabled) {
          return { continue: true };
        }

        // Detect /complete-plan via expanded prompt markers
        const prompt = ctx.prompt || '';
        const parts = ctx.parts || [];
        const fullText = parts.map(p => p.text || '').join(' ') || prompt;

        // Check for the expanded complete-plan skill markers
        const isCompletePlan = fullText.includes('[PLAN COMPLETION MODE - VERIFICATION REQUIRED]');

        if (!isCompletePlan) {
          return { continue: true };
        }

        // Store the completion attempt in session state for later detection
        const state = loadSessionState(ctx.directory, ctx.sessionId);

        // Mark that a plan completion is in progress
        // The Stop hook will later determine if it succeeded or failed
        if (!state.pending_completion) {
          state.pending_completion = {
            claimed_at: new Date().toISOString(),
            task_description: 'plan_completion_verification',
            agent_used: 'complete-plan',
          };
          saveSessionState(ctx.directory, state);
        }
      } catch (error) {
        console.error('[Olympus Plan Lifecycle] Error in complete-plan tracker:', error);
      }

      return { continue: true };
    }
  });

  // Hook 4: Inject plan learnings into Prometheus context
  registerHook({
    name: 'prometheusLearningsInjection',
    event: 'PreToolUse',
    priority: 55, // After agent-tracking (50), before budget tracking (70)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (ctx.toolName !== 'Task') {
          return { continue: true };
        }

        if (!ctx.directory) {
          return { continue: true };
        }

        // Check if this is a Prometheus task
        const toolInput = ctx.toolInput as Record<string, unknown> | undefined;
        const subagentType = toolInput?.subagent_type as string | undefined;

        if (subagentType !== 'prometheus') {
          return { continue: true };
        }

        // Get planning insights
        const allDiscoveries = getDiscoveriesForInjection(ctx.directory, 20);
        const planningInsights = allDiscoveries.filter(d => d.category === 'planning_insight');

        if (planningInsights.length === 0) {
          return { continue: true };
        }

        // Format plan learnings for injection
        const learningsText = formatPlanLearnings(planningInsights.slice(0, 5));

        if (learningsText) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              additionalContext: learningsText,
            },
          };
        }
      } catch (error) {
        console.error('[Olympus Plan Lifecycle] Error in Prometheus learnings injection:', error);
      }

      return { continue: true };
    }
  });

  // Hook 5: Track workflow phase transitions
  registerHook({
    name: 'workflowPhaseTransitionTracker',
    event: 'PostToolUse',
    priority: 83, // After workflow-transition messages (82)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        // Only process Write or Task tool calls (state-changing operations)
        if (ctx.toolName !== 'Write' && ctx.toolName !== 'Task') {
          return { continue: true };
        }

        if (!ctx.directory || !ctx.sessionId) {
          return { continue: true };
        }

        const directory = ctx.directory;

        // Load manifest
        const manifestPath = path.join(directory, 'aidlc-docs', 'manifest.json');
        const manifest = loadManifest(manifestPath);
        if (!manifest) {
          return { continue: true };
        }

        // Load checkpoint
        const workflowIds = await listWorkflows(directory);
        if (workflowIds.length === 0) {
          return { continue: true };
        }
        const checkpoint = await loadCheckpoint(directory, workflowIds[0]);
        if (!checkpoint) {
          return { continue: true };
        }

        // Load session state for tracking
        const state = loadSessionState(directory, ctx.sessionId);

        // Determine current phase from checkpoint
        const currentPhase = checkpoint.current_phase;
        const lastTrackedPhase = (state as any).last_tracked_phase as string | undefined;

        // Detect phase transition
        if (lastTrackedPhase && lastTrackedPhase !== currentPhase) {
          const now = new Date().toISOString();

          // Record transition in manifest gate_audit
          manifest.gate_audit.push({
            phase: currentPhase,
            timestamp: now,
            action: 'approved',
            actor: 'trust',
            reason: `Phase transition: ${lastTrackedPhase} -> ${currentPhase}`,
          });

          // Update phase states in manifest
          const previousPhase = lastTrackedPhase as 'discovery' | 'inception' | 'construction' | 'operations';
          if (manifest.phases[previousPhase]) {
            manifest.phases[previousPhase].status = 'complete';
            manifest.phases[previousPhase].completed_at = now;
          }
          if (manifest.phases[currentPhase]) {
            if (manifest.phases[currentPhase].status === 'not_started') {
              manifest.phases[currentPhase].status = 'in_progress';
              manifest.phases[currentPhase].started_at = now;
            }
          }

          // Save manifest
          saveManifest(manifestPath, manifest);

          // Check if workflow is complete (Operations -> complete)
          if (checkpoint.status === 'complete' || checkpoint.current_stage === 'complete') {
            manifest.phases.operations.status = 'complete';
            manifest.phases.operations.completed_at = now;
            saveManifest(manifestPath, manifest);
          }

          // Update session state
          (state as any).last_tracked_phase = currentPhase;
          saveSessionState(directory, state);

          // Build transition message
          const phaseNames: Record<string, string> = {
            discovery: 'Discovery',
            inception: 'Inception',
            construction: 'Construction',
            operations: 'Operations',
          };
          const fromName = phaseNames[lastTrackedPhase] || lastTrackedPhase;
          const toName = phaseNames[currentPhase] || currentPhase;

          let transitionMessage = `Phase transition: ${fromName} → ${toName}`;
          if (currentPhase === 'operations') {
            transitionMessage += '\n→ Generating deployment artifacts...';
          }

          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: `<phase-transition>\n${transitionMessage}\n</phase-transition>`,
            },
          };
        }

        // Track current phase if not yet tracked
        if (!lastTrackedPhase) {
          (state as any).last_tracked_phase = currentPhase;
          saveSessionState(directory, state);
        }

        // Handle workflow completion
        if (checkpoint.status === 'complete' && manifest.phases.operations.status !== 'complete') {
          const now = new Date().toISOString();
          manifest.phases.operations.status = 'complete';
          manifest.phases.operations.completed_at = now;
          saveManifest(manifestPath, manifest);

          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'PostToolUse',
              additionalContext: '<phase-transition>\n✓ Workflow complete! All phases finished.\n</phase-transition>',
            },
          };
        }
      } catch (error) {
        console.error('[Olympus Plan Lifecycle] Error in phase transition tracker:', error);
      }

      return { continue: true };
    }
  });
}
