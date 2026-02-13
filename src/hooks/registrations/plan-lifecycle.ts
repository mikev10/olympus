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
}
