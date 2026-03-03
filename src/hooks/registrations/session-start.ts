/**
 * SessionStart Hook Registrations
 *
 * Hooks that fire when a new Claude Code session starts.
 */

import { registerHook } from '../registry.js';
import { readUltraworkState } from '../ultrawork-state/index.js';
import { checkIncompleteTodos } from '../todo-continuation/index.js';
import { generateLearnedContext, formatDiscoveries } from '../../learning/hooks/learned-context.js';
import { getDiscoveriesForInjection, markDiscoveryUseful } from '../../learning/discovery.js';
import { loadSessionState, saveSessionState, initializeTokenBudget } from '../../learning/session-state.js';
import { detectResumableWorkflows } from '../../features/workflow-engine/resume-detector.js';
import { generateWorkflowSummary, generateBoltExecutionPlan } from '../../features/workflow-engine/workflow-bridge.js';
import { loadTrustState } from '../../features/workflow-engine/trust.js';
import type { HookContext, HookResult } from '../types.js';

export function registerSessionStartHooks(): void {
  // Learned Context Injection (earliest priority - adds context before other hooks)
  registerHook({
    name: 'learnedContextInjection',
    event: 'SessionStart',
    priority: 5, // Early priority to add context before other hooks
    handler: (ctx: HookContext): HookResult => {
      if (!ctx.directory) {
        return { continue: true };
      }

      try {
        const learnedContext = generateLearnedContext(ctx.directory);
        const discoveries = getDiscoveriesForInjection(ctx.directory, 5);
        const discoveriesContext = formatDiscoveries(discoveries);

        // Mark injected discoveries as useful (verification loop)
        // Only mark discoveries that haven't been marked useful in the last 24 hours
        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        for (const discovery of discoveries) {
          try {
            const lastUseful = new Date(discovery.last_useful);
            if (lastUseful < oneDayAgo) {
              markDiscoveryUseful(discovery.id, ctx.directory);
            }
          } catch (error) {
            // Silently ignore verification failures - never block session start
            console.error('[Olympus Learning] Failed to mark discovery as useful:', error);
          }
        }

        const contextToInject = learnedContext + (discoveriesContext ? '\n\n' + discoveriesContext : '');

        if (contextToInject.trim()) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: contextToInject
            }
          };
        }
      } catch (error) {
        console.error('[Olympus Learning]', error);
      }

      return { continue: true };
    }
  });

  // Workflow Resume Detection (priority 8 - between learned context and session restore)
  registerHook({
    name: 'workflowResumeDetection',
    event: 'SessionStart',
    priority: 8,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        const directory = ctx.directory || process.cwd();
        const workflows = await detectResumableWorkflows(directory);

        if (workflows.length === 0) {
          return { continue: true };
        }

        const messages: string[] = [];

        for (const wf of workflows) {
          if (wf.status === 'awaiting_mode_selection') {
            messages.push(`[Active workflow: '${wf.featureName}' — awaiting execution mode selection.\nChoose: /ascent, /olympus, or /ultrawork to begin Construction]`);
          } else if (wf.status === 'awaiting_dev_review') {
            messages.push(`[Active workflow: '${wf.featureName}' — awaiting developer review (Risk Tier 3).\nReview the INTENT technical specification before proceeding to Construction.]`);
          } else {
            const boltProgress = wf.progress.total > 0 ? `, ${wf.progress.completed}/${wf.progress.total} BOLTs complete` : '';
            messages.push(`[Active workflow: '${wf.featureName}' — ${wf.currentPhase} phase${boltProgress}.\nResume with /plan or check status with /workflow-status]`);
          }
        }

        // Inject trust level
        const trustState = loadTrustState(directory);
        messages.push(`[Trust Level: ${trustState.current_level}]`);

        // Generate workflow summary for structured context
        const summary = await generateWorkflowSummary(directory);
        if (summary) {
          messages.push(summary);
        }

        // Generate bolt execution plan for structured context
        const executionPlan = await generateBoltExecutionPlan(directory);
        if (executionPlan) {
          messages.push(executionPlan);
        }

        // Handle mid-interview resume info
        for (const wf of workflows) {
          if (wf.interviewProgress) {
            messages.push(`[Interview in progress: ${wf.interviewProgress.stage} stage, ${wf.interviewProgress.questions_asked} questions asked${wf.interviewProgress.draft_artifact_path ? '. Draft artifact exists.' : ''}]`);
          }
        }

        if (messages.length > 0) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: messages.join('\n')
            }
          };
        }
      } catch (error) {
        console.error('[Olympus Resume Detection] Error:', error);
      }

      return { continue: true };
    }
  });

  // Session Start (restore persistent modes and pending tasks)
  registerHook({
    name: 'sessionStart',
    event: 'SessionStart',
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const sessionId = ctx.sessionId;
      const directory = ctx.directory || process.cwd();
      const messages: string[] = [];

      // Initialize token budget for this session
      try {
        const state = loadSessionState(directory, sessionId);
        if (!state.token_budget) {
          initializeTokenBudget(state, directory);
          saveSessionState(directory, state);
        }
      } catch (error) {
        console.error('[Olympus Learning] Failed to initialize token budget:', error);
        // Non-fatal - continue session start
      }

      // Check for active ultrawork state
      const ultraworkState = readUltraworkState(directory);
      if (ultraworkState?.active) {
        messages.push(`<session-restore>

[ULTRAWORK MODE RESTORED]

You have an active ultrawork session from ${ultraworkState.started_at}.
Original task: ${ultraworkState.original_prompt}

Continue working in ultrawork mode until all tasks are complete.

</session-restore>

---

`);
      }

      // Check for incomplete todos
      const todoResult = await checkIncompleteTodos(sessionId, directory);
      if (todoResult.count > 0) {
        messages.push(`<session-restore>

[PENDING TASKS DETECTED]

You have ${todoResult.count} incomplete tasks from a previous session.
Please continue working on these tasks.

</session-restore>

---

`);
      }

      if (messages.length > 0) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: messages.join('\n')
          }
        };
      }

      return { continue: true };
    }
  });
}
