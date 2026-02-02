/**
 * Token Metrics Hook Registrations
 *
 * Captures token usage metrics from Claude Code events.
 * Tracks prompts and tool executions for usage analysis.
 */

import { registerHook } from '../registry.js';
import { logTokenMetric } from '../../features/token-metrics/storage.js';
import { estimateTokens, estimateTokensFromToolOutput } from '../../features/token-metrics/token-estimator.js';
import type { HookContext, HookResult } from '../types.js';
import type { TokenMetricsEntry } from '../../features/token-metrics/types.js';

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
 * Register token metrics hooks
 */
export function registerTokenMetricsHooks(): void {
  // Hook 1: Capture user prompt submissions
  registerHook({
    name: 'tokenMetricsPrompt',
    event: 'UserPromptSubmit',
    priority: 110, // Low priority - passive capture, run after other hooks
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        const promptText = getPromptText(ctx);
        // Estimate input tokens (will be 0 if empty)
        const inputTokens = promptText ? await estimateTokens(promptText) : 0;
        const model = getModelIdentifier(ctx);

        // Create metrics entry
        const entry: TokenMetricsEntry = {
          timestamp: new Date().toISOString(),
          session_id: ctx.sessionId || 'unknown',
          event_type: 'prompt',
          input_tokens: inputTokens,
          model,
          project_path: ctx.directory,
        };

        // Log to storage (fire-and-forget) - always log for complete session tracking
        logTokenMetric(entry, ctx.directory).catch(err => {
          // Silent failure - metrics should never block execution
          console.error('[Olympus Token Metrics] Failed to log prompt metric:', err);
        });
      } catch (error) {
        // Silent failure - metrics should never break hooks
        console.error('[Olympus Token Metrics] Error in prompt handler:', error);
      }

      return { continue: true };
    }
  });

  // Hook 2: Capture tool executions
  registerHook({
    name: 'tokenMetricsToolUse',
    event: 'PostToolUse',
    priority: 70, // Lower priority - passive capture
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.toolName) {
          return { continue: true };
        }

        // Estimate output tokens from tool result
        const outputTokens = ctx.toolOutput
          ? await estimateTokensFromToolOutput(ctx.toolOutput)
          : 0;

        const model = getModelIdentifier(ctx);

        // Create metrics entry
        const entry: TokenMetricsEntry = {
          timestamp: new Date().toISOString(),
          session_id: ctx.sessionId || 'unknown',
          event_type: 'tool_use',
          output_tokens: outputTokens,
          model,
          tool_name: ctx.toolName,
          project_path: ctx.directory,
        };

        // Log to storage (fire-and-forget)
        logTokenMetric(entry, ctx.directory).catch(err => {
          // Silent failure - metrics should never block execution
          console.error('[Olympus Token Metrics] Failed to log tool metric:', err);
        });
      } catch (error) {
        // Silent failure - metrics should never break hooks
        console.error('[Olympus Token Metrics] Error in tool use handler:', error);
      }

      return { continue: true };
    }
  });
}
