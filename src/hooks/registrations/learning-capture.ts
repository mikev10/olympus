/**
 * Learning Capture Hook Registrations
 *
 * Captures token metrics data for the learning system by:
 * 1. UserPromptSubmit: Estimate input tokens and accumulate in session state
 * 2. PostToolUse: Estimate output tokens and accumulate in session state
 * 3. Stop: Aggregate session totals and save as a single FeedbackEntry
 *
 * ARCHITECTURE:
 * - High-frequency: Accumulate in SessionState.token_budget.current_usage during session
 * - Low-frequency: On Stop, create ONE FeedbackEntry with session totals
 * - Zero LLM calls - purely passive data collection
 * - Backward compatible: works with existing SessionState without token_budget
 */

import { registerHook } from '../registry.js';
import { estimateTokens, estimateTokensFromToolOutput } from '../../learning/token-estimator.js';
import { calculateCost } from '../../learning/pricing.js';
import { loadSessionState, saveSessionState } from '../../learning/session-state.js';
import { appendFeedback, updateAgentPerformance, loadFeedback } from '../../learning/storage.js';
import type { HookContext, HookResult } from '../types.js';
import type { SessionState, FeedbackEntry, TokenUsage, CostEstimate } from '../../learning/types.js';
import { randomUUID } from 'crypto';

/**
 * Extract prompt text from various input formats
 */
function getPromptText(ctx: HookContext): string {
  if (ctx.prompt) {
    return ctx.prompt;
  }
  if (ctx.message?.content) {
    return ctx.message.content;
  }
  if (ctx.parts) {
    return ctx.parts
      .filter(p => p.type === 'text' && p.text)
      .map(p => p.text)
      .join(' ');
  }
  return '';
}

/**
 * Extract model identifier from context
 */
function getModelIdentifier(ctx: HookContext): string | undefined {
  if (ctx.message?.model) {
    const { providerId, modelId } = ctx.message.model;
    if (providerId && modelId) {
      return `${providerId}/${modelId}`;
    }
    if (modelId) {
      return modelId;
    }
  }
  return undefined;
}

/**
 * Initialize token budget in session state if not present
 */
function ensureTokenBudget(state: SessionState, sessionBaseline: number = 10000): SessionState {
  if (!state.token_budget) {
    state.token_budget = {
      session_baseline: sessionBaseline,
      current_usage: 0,
      warning_threshold: 1.5,
      warning_issued: false,
      started_at: new Date().toISOString(),
    };
  }
  return state;
}

/**
 * Register learning capture hooks for token metrics
 */
export function registerLearningCaptureHooks(): void {
  // Hook 1: Capture user prompt submissions
  registerHook({
    name: 'learningCapturePrompt',
    event: 'UserPromptSubmit',
    priority: 110, // Low priority - passive capture, run after other hooks
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.directory) {
          return { continue: true };
        }

        const promptText = getPromptText(ctx);
        if (!promptText) {
          return { continue: true };
        }

        // Estimate input tokens (will be 0 if empty)
        const inputTokens = await estimateTokens(promptText);

        // Load session state
        const state = loadSessionState(ctx.directory, ctx.sessionId);
        ensureTokenBudget(state);

        // Accumulate input tokens
        if (state.token_budget) {
          state.token_budget.current_usage += inputTokens;
          saveSessionState(ctx.directory, state);
        }
      } catch (error) {
        // Silent failure - metrics should never break hooks
        console.error('[Olympus Learning Capture] Error in prompt handler:', error);
      }

      return { continue: true };
    }
  });

  // Hook 2: Capture tool executions
  registerHook({
    name: 'learningCaptureTool',
    event: 'PostToolUse',
    priority: 70, // Lower priority - passive capture
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.directory || !ctx.toolName) {
          return { continue: true };
        }

        // Estimate output tokens from tool result
        const outputTokens = ctx.toolOutput
          ? await estimateTokensFromToolOutput(ctx.toolOutput)
          : 0;

        // Load session state
        const state = loadSessionState(ctx.directory, ctx.sessionId);
        ensureTokenBudget(state);

        // Accumulate output tokens
        if (state.token_budget) {
          state.token_budget.current_usage += outputTokens;
          saveSessionState(ctx.directory, state);
        }
      } catch (error) {
        // Silent failure - metrics should never break hooks
        console.error('[Olympus Learning Capture] Error in tool use handler:', error);
      }

      return { continue: true };
    }
  });

  // Hook 3: Aggregate session totals on Stop
  registerHook({
    name: 'learningCaptureStop',
    event: 'Stop',
    priority: 90, // Run before cancellation detection (priority 100), after persistent mode (priority 10)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.directory) {
          return { continue: true };
        }

        // Load session state
        const state = loadSessionState(ctx.directory, ctx.sessionId);

        // Skip if no token budget (backward compatibility)
        if (!state.token_budget) {
          return { continue: true };
        }

        const totalTokens = state.token_budget.current_usage;

        // Only create entry if there's actual usage
        if (totalTokens === 0) {
          return { continue: true };
        }

        // Get model identifier (may not be available on Stop)
        const modelId = 'unknown'; // Stop event doesn't have model info

        // Create token usage object
        const tokenUsage: TokenUsage = {
          input_tokens: 0, // We tracked combined totals, not split
          output_tokens: 0,
          total_tokens: totalTokens,
          estimated: true,
          model: modelId,
        };

        // Calculate cost estimate
        const costEstimate: CostEstimate = {
          input_cost: 0,
          output_cost: 0,
          total_cost: 0,
          pricing_version: '2025-01-01',
        };

        // Try to calculate cost if we have a valid model
        try {
          const cost = calculateCost(0, totalTokens, modelId);
          costEstimate.input_cost = cost.inputCost;
          costEstimate.output_cost = cost.outputCost;
          costEstimate.total_cost = cost.totalCost;
          costEstimate.pricing_version = cost.pricingVersion;
        } catch (error) {
          // Cost calculation failed - not critical
        }

        // Create a single FeedbackEntry with aggregated session totals
        const feedbackEntry: FeedbackEntry = {
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          session_id: state.session_id,
          project_path: ctx.directory,
          event_type: 'success', // Default to success for normal session end
          user_message: 'Session completed',
          feedback_category: 'praise',
          confidence: 0.5, // Low confidence - automated entry
          token_usage: tokenUsage,
          cost_estimate: costEstimate,
          agent_used: state.pending_completion?.agent_used,
          original_task: state.pending_completion?.task_description,
        };

        // Save feedback entry
        appendFeedback(feedbackEntry);

        // Update agent performance if agent was used
        if (state.pending_completion?.agent_used) {
          const allFeedback = loadFeedback();
          updateAgentPerformance(state.pending_completion.agent_used, allFeedback);
        }

        // Reset token budget for next session
        state.token_budget.current_usage = 0;
        state.token_budget.warning_issued = false;
        state.token_budget.started_at = new Date().toISOString();
        saveSessionState(ctx.directory, state);
      } catch (error) {
        // Silent failure - learning should never block
        console.error('[Olympus Learning Capture] Error in stop handler:', error);
      }

      return { continue: true };
    }
  });
}
