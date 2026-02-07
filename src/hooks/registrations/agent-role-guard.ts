/**
 * Agent Role Guard Hook Registration
 *
 * Enforces read-only restrictions on agents that should not write files.
 * Runs at priority 5 (earliest) to block write attempts before execution.
 *
 * FLOW:
 * 1. PreToolUse event fires for write/edit/multiedit/bash tools
 * 2. Load session state to get most recently tracked agent
 * 3. Check if agent is read-only (explore, librarian, oracle, etc.)
 * 4. If read-only: block write/edit/multiedit, check bash for write patterns
 * 5. If not read-only or no agent context: allow operation
 *
 * PRIORITY:
 * Runs at priority 5 (BEFORE agent-tracking at priority 50).
 * This means the agent name comes from the PREVIOUS Task invocation stored
 * in session state, not the current one. This is correct behavior since
 * subagents use tools within their Task execution scope.
 */

import { registerHook } from '../registry.js';
import { isReadOnlyAgent, BASH_WRITE_PATTERNS } from '../constants.js';
import { loadSessionState } from '../../learning/session-state.js';
import type { HookContext, HookResult } from '../types.js';

/**
 * Register agent role guard hook
 */
export function registerAgentRoleGuardHook(): void {
  registerHook({
    name: 'agentRoleGuard',
    event: 'PreToolUse',
    priority: 5, // Run before agent-tracking (priority 50)
    matcher: 'write|edit|multiedit|bash',
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        // Validate context - no directory or session ID means no agent context
        if (!ctx.directory || !ctx.sessionId) {
          return { continue: true };
        }

        // Load session state to get most recently tracked agent
        const state = loadSessionState(ctx.directory, ctx.sessionId);

        // Get agent name from pending completion (set by agent-tracking)
        const agentName = state.pending_completion?.agent_used;

        // No agent name = no agent context, allow operation
        if (!agentName) {
          return { continue: true };
        }

        // Check if agent is read-only
        if (!isReadOnlyAgent(agentName)) {
          return { continue: true };
        }

        // Agent is read-only - enforce restrictions
        const toolName = ctx.toolName;

        // Block write/edit/multiedit operations for read-only agents
        if (toolName === 'write' || toolName === 'edit' || toolName === 'multiedit') {
          return {
            continue: false,
            stopReason: `Agent "${agentName}" is read-only and cannot perform ${toolName} operations. Use an agent like "olympian" or "frontend-engineer" for file modifications.`,
          };
        }

        // For bash commands, check if the command performs write operations
        if (toolName === 'bash') {
          const toolInput = ctx.toolInput as Record<string, unknown> | undefined;
          const command = toolInput?.command;

          if (typeof command === 'string' && BASH_WRITE_PATTERNS.test(command)) {
            return {
              continue: false,
              stopReason: `Agent "${agentName}" is read-only and cannot execute bash commands that modify files. Detected write operation in: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`,
            };
          }
        }

        // Bash command passed check or no write patterns detected - allow
        return { continue: true };
      } catch (error) {
        // Silent failure - role enforcement should never break hooks
        console.error('[Olympus Agent Role Guard] Error in handler:', error);
        return { continue: true };
      }
    }
  });
}
