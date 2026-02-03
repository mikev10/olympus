/**
 * Budget Warning Hook Registration
 *
 * Monitors token usage and issues informational warnings when session
 * exceeds expected baseline. Non-blocking - continues regardless.
 */

import { registerHook } from '../registry.js';
import type { HookContext, HookResult } from '../types.js';
import {
  loadSessionState,
  saveSessionState,
  shouldIssueWarning,
  markWarningIssued,
  updateTokenBudget
} from '../../learning/session-state.js';
import { safeTokenTotal } from '../../learning/utils.js';
import type { FeedbackEntry } from '../../learning/types.js';

export function registerBudgetWarningHook(): void {
  registerHook({
    name: 'budgetWarning',
    event: 'PostToolUse',
    priority: 90, // Run late to ensure token data is available
    handler: (ctx: HookContext): HookResult => {
      if (!ctx.directory) {
        return { continue: true };
      }

      try {
        // Load session state
        const state = loadSessionState(ctx.directory, ctx.sessionId);

        // Extract token usage from tool output if available
        // Tool output may contain token_usage data from subagent invocations
        let tokensUsed = 0;
        if (ctx.toolOutput && typeof ctx.toolOutput === 'object') {
          const output = ctx.toolOutput as Record<string, unknown>;
          if (output.token_usage && typeof output.token_usage === 'object') {
            const tokenUsage = output.token_usage as { total_tokens?: number };
            tokensUsed = tokenUsage.total_tokens ?? 0;
          }
        }

        // Update token budget if tokens were used
        if (tokensUsed > 0) {
          updateTokenBudget(state, tokensUsed);
        }

        // Check if warning should be issued
        if (shouldIssueWarning(state)) {
          const budget = state.token_budget!;
          const currentK = (budget.current_usage / 1000).toFixed(1);
          const baselineK = (budget.session_baseline / 1000).toFixed(0);
          const ratio = (budget.current_usage / budget.session_baseline).toFixed(2);

          // Mark warning as issued
          markWarningIssued(state);
          saveSessionState(ctx.directory, state);

          // Return informational warning (non-blocking)
          return {
            continue: true, // Always continue - this is informational only
            message: `[TOKEN AWARENESS] Session at ${currentK}k tokens (${ratio}x baseline of ${baselineK}k).
This is informational - continue if task requires it.
Consider: delegate to subagent, break into smaller tasks.`
          };
        }

        // Save updated state
        saveSessionState(ctx.directory, state);

        return { continue: true };
      } catch (error) {
        console.error('[Olympus Learning] Budget warning error:', error);
        return { continue: true }; // Never block on errors
      }
    }
  });
}
