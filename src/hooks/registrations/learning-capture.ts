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
 *
 * DEBUG MODE:
 * Enable comprehensive logging with: OLYMPUS_DEBUG_HOOKS=1
 * Logs are written to: ~/.claude/olympus/learning/hooks-debug.log
 * Includes: hook execution, context details, token calculations, state changes, errors
 */

import { registerHook } from '../registry.js';
import { estimateTokens, estimateTokensFromToolOutput } from '../../learning/token-estimator.js';
import { calculateCost } from '../../learning/pricing.js';
import { loadSessionState, saveSessionState } from '../../learning/session-state.js';
import { appendFeedback, updateAgentPerformance, loadFeedback } from '../../learning/storage.js';
import type { HookContext, HookResult } from '../types.js';
import type { SessionState, FeedbackEntry, TokenUsage, CostEstimate } from '../../learning/types.js';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Debug logging configuration
 */
const DEBUG_ENABLED = process.env.OLYMPUS_DEBUG_HOOKS === '1';
const DEBUG_LOG_PATH = path.join(os.homedir(), '.claude', 'olympus', 'learning', 'hooks-debug.log');

/**
 * Debug logging utility - writes to hooks-debug.log with timestamps
 */
function debugLog(hookName: string, message: string, data?: any): void {
  if (!DEBUG_ENABLED) {
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] [${hookName}] ${message}`;

    if (data !== undefined) {
      if (typeof data === 'object') {
        logEntry += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        logEntry += ` ${data}`;
      }
    }

    logEntry += '\n';

    // Ensure log directory exists
    const logDir = path.dirname(DEBUG_LOG_PATH);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Append to log file
    fs.appendFileSync(DEBUG_LOG_PATH, logEntry, 'utf8');
  } catch (error) {
    // Silent failure - logging should never break execution
    console.error('[Olympus Debug] Failed to write debug log:', error);
  }
}

/**
 * Log context details for debugging
 */
function logContext(hookName: string, ctx: HookContext): void {
  if (!DEBUG_ENABLED) {
    return;
  }

  debugLog(hookName, 'Context received', {
    directory: ctx.directory,
    sessionId: ctx.sessionId,
    hasPrompt: !!ctx.prompt,
    promptLength: ctx.prompt?.length || 0,
    hasMessage: !!ctx.message,
    messageModel: ctx.message?.model,
    toolName: ctx.toolName,
    hasToolOutput: !!ctx.toolOutput,
    toolOutputType: ctx.toolOutput ? typeof ctx.toolOutput : undefined,
    hasParts: !!ctx.parts,
    partsLength: ctx.parts?.length || 0,
  });
}

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
      input_tokens: 0,
      output_tokens: 0,
      warning_threshold: 1.5,
      warning_issued: false,
      started_at: new Date().toISOString(),
    };
  } else {
    // Ensure new fields exist (backward compatibility)
    if (state.token_budget.input_tokens === undefined) {
      state.token_budget.input_tokens = 0;
    }
    if (state.token_budget.output_tokens === undefined) {
      state.token_budget.output_tokens = 0;
    }
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
      debugLog('learningCapturePrompt', 'Hook fired');
      logContext('learningCapturePrompt', ctx);

      try {
        if (!ctx.directory) {
          debugLog('learningCapturePrompt', 'No directory in context - skipping');
          return { continue: true };
        }

        debugLog('learningCapturePrompt', 'Extracting prompt text');
        const promptText = getPromptText(ctx);
        if (!promptText) {
          debugLog('learningCapturePrompt', 'No prompt text extracted - skipping');
          return { continue: true };
        }

        debugLog('learningCapturePrompt', `Prompt text extracted (${promptText.length} chars)`);

        // Estimate input tokens (will be 0 if empty)
        debugLog('learningCapturePrompt', 'Estimating input tokens');
        const inputTokens = await estimateTokens(promptText);
        debugLog('learningCapturePrompt', `Estimated tokens: ${inputTokens}`);

        // Load session state
        debugLog('learningCapturePrompt', 'Loading session state', {
          directory: ctx.directory,
          sessionId: ctx.sessionId,
        });
        const state = loadSessionState(ctx.directory, ctx.sessionId);
        debugLog('learningCapturePrompt', 'Session state loaded', {
          hasTokenBudget: !!state.token_budget,
          currentUsage: state.token_budget?.current_usage,
          inputTokens: state.token_budget?.input_tokens,
          outputTokens: state.token_budget?.output_tokens,
        });

        ensureTokenBudget(state);
        debugLog('learningCapturePrompt', 'Token budget ensured');

        // Capture model identifier (Task #7)
        const modelId = getModelIdentifier(ctx);
        debugLog('learningCapturePrompt', `Model identifier: ${modelId || 'none'}`);
        if (modelId && state.token_budget) {
          state.token_budget.current_model = modelId;
          debugLog('learningCapturePrompt', `Model set in token budget: ${modelId}`);
        }

        // Accumulate input tokens (Task #8)
        if (state.token_budget) {
          const beforeInput = state.token_budget.input_tokens;
          const beforeUsage = state.token_budget.current_usage;

          state.token_budget.input_tokens += inputTokens;
          state.token_budget.current_usage += inputTokens;

          debugLog('learningCapturePrompt', 'Tokens accumulated', {
            addedTokens: inputTokens,
            inputTokens: { before: beforeInput, after: state.token_budget.input_tokens },
            currentUsage: { before: beforeUsage, after: state.token_budget.current_usage },
          });

          debugLog('learningCapturePrompt', 'Saving session state');
          saveSessionState(ctx.directory, state);
          debugLog('learningCapturePrompt', 'Session state saved successfully');
        } else {
          debugLog('learningCapturePrompt', 'WARNING: No token budget after ensure - this should not happen');
        }
      } catch (error) {
        // Silent failure - metrics should never break hooks
        debugLog('learningCapturePrompt', 'ERROR in handler', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        console.error('[Olympus Learning Capture] Error in prompt handler:', error);
      }

      debugLog('learningCapturePrompt', 'Hook completed');
      return { continue: true };
    }
  });

  // Hook 2: Capture tool executions
  registerHook({
    name: 'learningCaptureTool',
    event: 'PostToolUse',
    priority: 70, // Lower priority - passive capture
    handler: async (ctx: HookContext): Promise<HookResult> => {
      debugLog('learningCaptureTool', 'Hook fired');
      logContext('learningCaptureTool', ctx);

      try {
        if (!ctx.directory || !ctx.toolName) {
          debugLog('learningCaptureTool', 'Missing directory or toolName - skipping', {
            hasDirectory: !!ctx.directory,
            hasToolName: !!ctx.toolName,
          });
          return { continue: true };
        }

        debugLog('learningCaptureTool', `Processing tool: ${ctx.toolName}`);

        // Estimate output tokens from tool result
        debugLog('learningCaptureTool', 'Estimating output tokens from tool result');
        const outputTokens = ctx.toolOutput
          ? await estimateTokensFromToolOutput(ctx.toolOutput)
          : 0;
        debugLog('learningCaptureTool', `Estimated output tokens: ${outputTokens}`);

        // Load session state
        debugLog('learningCaptureTool', 'Loading session state', {
          directory: ctx.directory,
          sessionId: ctx.sessionId,
        });
        const state = loadSessionState(ctx.directory, ctx.sessionId);
        debugLog('learningCaptureTool', 'Session state loaded', {
          hasTokenBudget: !!state.token_budget,
          currentUsage: state.token_budget?.current_usage,
          inputTokens: state.token_budget?.input_tokens,
          outputTokens: state.token_budget?.output_tokens,
        });

        ensureTokenBudget(state);
        debugLog('learningCaptureTool', 'Token budget ensured');

        // Accumulate output tokens (Task #8)
        if (state.token_budget) {
          const beforeOutput = state.token_budget.output_tokens;
          const beforeUsage = state.token_budget.current_usage;

          state.token_budget.output_tokens += outputTokens;
          state.token_budget.current_usage += outputTokens;

          debugLog('learningCaptureTool', 'Tokens accumulated', {
            addedTokens: outputTokens,
            outputTokens: { before: beforeOutput, after: state.token_budget.output_tokens },
            currentUsage: { before: beforeUsage, after: state.token_budget.current_usage },
          });

          debugLog('learningCaptureTool', 'Saving session state');
          saveSessionState(ctx.directory, state);
          debugLog('learningCaptureTool', 'Session state saved successfully');
        } else {
          debugLog('learningCaptureTool', 'WARNING: No token budget after ensure - this should not happen');
        }
      } catch (error) {
        // Silent failure - metrics should never break hooks
        debugLog('learningCaptureTool', 'ERROR in handler', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        console.error('[Olympus Learning Capture] Error in tool use handler:', error);
      }

      debugLog('learningCaptureTool', 'Hook completed');
      return { continue: true };
    }
  });

  // Hook 3: Aggregate session totals on Stop
  registerHook({
    name: 'learningCaptureStop',
    event: 'Stop',
    priority: 90, // Run before cancellation detection (priority 100), after persistent mode (priority 10)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      debugLog('learningCaptureStop', 'Hook fired');
      logContext('learningCaptureStop', ctx);

      try {
        if (!ctx.directory) {
          debugLog('learningCaptureStop', 'No directory in context - skipping');
          return { continue: true };
        }

        // Load session state
        debugLog('learningCaptureStop', 'Loading session state', {
          directory: ctx.directory,
          sessionId: ctx.sessionId,
        });
        const state = loadSessionState(ctx.directory, ctx.sessionId);
        debugLog('learningCaptureStop', 'Session state loaded', {
          hasTokenBudget: !!state.token_budget,
          currentUsage: state.token_budget?.current_usage,
          inputTokens: state.token_budget?.input_tokens,
          outputTokens: state.token_budget?.output_tokens,
          currentModel: state.token_budget?.current_model,
        });

        // Skip if no token budget (backward compatibility)
        if (!state.token_budget) {
          debugLog('learningCaptureStop', 'No token budget in session state - skipping (backward compatibility)');
          return { continue: true };
        }

        const totalTokens = state.token_budget.current_usage;
        const inputTokens = state.token_budget.input_tokens || 0;
        const outputTokens = state.token_budget.output_tokens || 0;

        debugLog('learningCaptureStop', 'Token totals', {
          totalTokens,
          inputTokens,
          outputTokens,
        });

        // Only create entry if there's actual usage
        if (totalTokens === 0) {
          debugLog('learningCaptureStop', 'No token usage recorded - skipping feedback entry creation');
          return { continue: true };
        }

        // Get model identifier from session state (Task #9)
        const modelId = state.token_budget.current_model || 'unknown';
        debugLog('learningCaptureStop', `Using model identifier: ${modelId}`);

        // Create token usage object (Task #9)
        const tokenUsage: TokenUsage = {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
          estimated: true,
          model: modelId,
        };
        debugLog('learningCaptureStop', 'Token usage object created', tokenUsage);

        // Calculate cost estimate
        debugLog('learningCaptureStop', 'Calculating cost estimate');
        const costEstimate: CostEstimate = {
          input_cost: 0,
          output_cost: 0,
          total_cost: 0,
          pricing_version: '2025-01-01',
        };

        // Try to calculate cost if we have a valid model
        try {
          const cost = calculateCost(inputTokens, outputTokens, modelId);
          costEstimate.input_cost = cost.inputCost;
          costEstimate.output_cost = cost.outputCost;
          costEstimate.total_cost = cost.totalCost;
          costEstimate.pricing_version = cost.pricingVersion;
          debugLog('learningCaptureStop', 'Cost calculated successfully', {
            inputCost: cost.inputCost,
            outputCost: cost.outputCost,
            totalCost: cost.totalCost,
          });
        } catch (error) {
          debugLog('learningCaptureStop', 'Cost calculation failed (not critical)', {
            error: error instanceof Error ? error.message : String(error),
          });
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
        debugLog('learningCaptureStop', 'Feedback entry created', {
          id: feedbackEntry.id,
          sessionId: feedbackEntry.session_id,
          agentUsed: feedbackEntry.agent_used,
          totalCost: costEstimate.total_cost,
        });

        // Save feedback entry
        debugLog('learningCaptureStop', 'Appending feedback entry to storage');
        appendFeedback(feedbackEntry);
        debugLog('learningCaptureStop', 'Feedback entry saved successfully');

        // Update agent performance if agent was used
        if (state.pending_completion?.agent_used) {
          debugLog('learningCaptureStop', `Updating agent performance for: ${state.pending_completion.agent_used}`);
          const allFeedback = loadFeedback();
          updateAgentPerformance(state.pending_completion.agent_used, allFeedback);
          debugLog('learningCaptureStop', 'Agent performance updated successfully');
        } else {
          debugLog('learningCaptureStop', 'No agent used - skipping performance update');
        }

        // Reset token budget for next session
        debugLog('learningCaptureStop', 'Resetting token budget for next session');
        state.token_budget.current_usage = 0;
        state.token_budget.input_tokens = 0;
        state.token_budget.output_tokens = 0;
        state.token_budget.warning_issued = false;
        state.token_budget.started_at = new Date().toISOString();
        delete state.token_budget.current_model;

        debugLog('learningCaptureStop', 'Saving reset session state');
        saveSessionState(ctx.directory, state);
        debugLog('learningCaptureStop', 'Session state saved successfully');
      } catch (error) {
        // Silent failure - learning should never block
        debugLog('learningCaptureStop', 'ERROR in handler', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        console.error('[Olympus Learning Capture] Error in stop handler:', error);
      }

      debugLog('learningCaptureStop', 'Hook completed');
      return { continue: true };
    }
  });
}
