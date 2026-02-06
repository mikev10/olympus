/**
 * Agent Tracking Hook Registration
 *
 * Captures Task tool usage to populate agent_used field in the learning system.
 *
 * FLOW:
 * 1. PreToolUse event fires when Task tool is about to be used
 * 2. Extract subagent_type (agent name) and prompt (task description)
 * 3. Call markCompletionClaim() to populate session state
 * 4. Save state so data persists for later feedback entry creation
 *
 * DEBUG MODE:
 * Enable comprehensive logging with: OLYMPUS_DEBUG_HOOKS=1
 * Logs are written to: ~/.claude/olympus/learning/hooks-debug.log
 */

import { registerHook } from '../registry.js';
import { loadSessionState, saveSessionState, markCompletionClaim } from '../../learning/session-state.js';
import type { HookContext, HookResult } from '../types.js';
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
 * Register agent tracking hook
 */
export function registerAgentTrackingHook(): void {
  registerHook({
    name: 'agentTracking',
    event: 'PreToolUse',
    priority: 50, // Run before budget tracking (priority 70)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      debugLog('agentTracking', 'Hook fired');
      debugLog('agentTracking', 'Context received', {
        directory: ctx.directory,
        sessionId: ctx.sessionId,
        toolName: ctx.toolName,
        hasToolInput: !!ctx.toolInput,
      });

      // Declare routing recommendation at top scope for visibility throughout handler
      let routingRecommendation: string | null = null;

      try {
        // Only process Task tool invocations
        if (ctx.toolName !== 'Task') {
          debugLog('agentTracking', `Skipping non-Task tool: ${ctx.toolName}`);
          return { continue: true };
        }

        debugLog('agentTracking', 'Task tool detected - processing');

        // Validate context
        if (!ctx.directory) {
          debugLog('agentTracking', 'No directory in context - skipping');
          return { continue: true };
        }

        if (!ctx.sessionId) {
          debugLog('agentTracking', 'No sessionId in context - skipping');
          return { continue: true };
        }

        if (!ctx.toolInput) {
          debugLog('agentTracking', 'No toolInput in context - skipping');
          return { continue: true };
        }

        // Extract agent information from toolInput
        const toolInput = ctx.toolInput as Record<string, unknown>;
        const subagentType = toolInput.subagent_type;
        const prompt = toolInput.prompt;

        debugLog('agentTracking', 'Tool input extracted', {
          subagentType,
          hasPrompt: !!prompt,
          promptLength: typeof prompt === 'string' ? prompt.length : 0,
        });

        // Defensive: ensure we have the required fields
        if (!subagentType || typeof subagentType !== 'string') {
          debugLog('agentTracking', 'Missing or invalid subagent_type - skipping');
          return { continue: true };
        }

        if (!prompt || typeof prompt !== 'string') {
          debugLog('agentTracking', 'Missing or invalid prompt - skipping');
          return { continue: true };
        }

        // Load session state
        debugLog('agentTracking', 'Loading session state', {
          directory: ctx.directory,
          sessionId: ctx.sessionId,
        });
        const state = loadSessionState(ctx.directory, ctx.sessionId);
        debugLog('agentTracking', 'Session state loaded', {
          sessionId: state.session_id,
          hasPendingCompletion: !!state.pending_completion,
        });

        // Check for routing recommendation (non-critical, wrapped for 100ms timeout)
        try {
          const { getRoutingRecommendation } = await import('../../learning/routing.js');
          routingRecommendation = getRoutingRecommendation(subagentType, prompt);
          if (routingRecommendation) {
            debugLog('agentTracking', 'Routing recommendation generated', {
              recommendation: routingRecommendation,
            });
          }
        } catch {
          // Silent failure - routing is non-critical
        }

        // Mark completion claim with agent and task info
        debugLog('agentTracking', 'Marking completion claim', {
          agent: subagentType,
          taskLength: prompt.length,
        });
        markCompletionClaim(state, prompt, subagentType);
        debugLog('agentTracking', 'Completion claim marked', {
          claimedAt: state.pending_completion?.claimed_at,
          agentUsed: state.pending_completion?.agent_used,
        });

        // Accumulate agents_used in token_budget
        if (state.token_budget) {
          if (!state.token_budget.agents_used) {
            state.token_budget.agents_used = [];
          }
          if (!state.token_budget.agents_used.includes(subagentType)) {
            state.token_budget.agents_used.push(subagentType);
          }
          debugLog('agentTracking', 'Agents accumulated', {
            agents_used: state.token_budget.agents_used,
          });
        }

        // Save session state to persist the data
        debugLog('agentTracking', 'Saving session state');
        saveSessionState(ctx.directory, state);
        debugLog('agentTracking', 'Session state saved successfully');
      } catch (error) {
        // Silent failure - tracking should never break hooks
        debugLog('agentTracking', 'ERROR in handler', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        console.error('[Olympus Agent Tracking] Error in handler:', error);
      }

      debugLog('agentTracking', 'Hook completed');
      if (routingRecommendation) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            additionalContext: routingRecommendation,
          },
        };
      }
      return { continue: true };
    }
  });
}
