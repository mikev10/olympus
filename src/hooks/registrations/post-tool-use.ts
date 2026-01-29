/**
 * PostToolUse Hook Registrations
 *
 * Hooks that fire after a tool is executed.
 * Can provide feedback, recovery guidance, or reminders.
 */

import { registerHook } from '../registry.js';
import { createEditErrorRecoveryHook } from '../edit-error-recovery/index.js';
import { createCommentCheckerHook } from '../comment-checker/index.js';
import { createContextLimitRecoveryHook } from '../context-window-limit-recovery/index.js';
import { createReadToolLimitRecoveryHook } from '../read-tool-limit-recovery/index.js';
import { createPreemptiveCompactionHook } from '../preemptive-compaction/index.js';
import { createAgentUsageReminderHook } from '../agent-usage-reminder/index.js';
import { createOlympusOrchestratorHook } from '../olympus-orchestrator/index.js';
import type { HookContext, HookResult } from '../types.js';

/**
 * Register all PostToolUse hooks.
 * Hooks are processed in priority order:
 * - 10: editErrorRecovery (edit tool errors)
 * - 20: commentChecker (write/edit/multiedit comment detection)
 * - 30: contextWindowLimitRecovery (all tools, context limit errors)
 * - 35: readToolLimitRecovery (read tool file size limit errors)
 * - 40: preemptiveCompaction (large output tools)
 * - 50: agentUsageReminder (search/fetch tools)
 * - 60: olympusOrchestratorPost (write/edit/bash/task tools)
 */
export function registerPostToolUseHooks(): void {
  const workDir = process.cwd();

  // 1. Edit Error Recovery - priority 10, matcher: edit
  const editErrorRecovery = createEditErrorRecoveryHook();
  registerHook({
    name: 'editErrorRecovery',
    event: 'PostToolUse',
    matcher: /^edit$/i,
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName || !ctx.toolOutput) {
        return { continue: true };
      }

      const output = editErrorRecovery.afterToolExecute(
        {
          tool: ctx.toolName,
          sessionId: ctx.sessionId || '',
          callId: '',
        },
        {
          title: '',
          output: String(ctx.toolOutput),
          metadata: undefined,
        }
      );

      if (output.output !== String(ctx.toolOutput)) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: output.output.substring(String(ctx.toolOutput).length)
          }
        };
      }

      return { continue: true };
    },
  });

  // 2. Comment Checker - priority 20, matcher: write/edit/multiedit
  const commentChecker = createCommentCheckerHook();
  registerHook({
    name: 'commentChecker',
    event: 'PostToolUse',
    matcher: /^(write|edit|multiedit)$/i,
    priority: 20,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName) {
        return { continue: true };
      }

      const message = commentChecker.postToolUse({
        tool_name: ctx.toolName,
        session_id: ctx.sessionId || '',
        tool_input: (ctx.toolInput as Record<string, unknown>) || {},
        tool_response: ctx.toolOutput ? String(ctx.toolOutput) : undefined,
      });

      if (message) {
        return {
          continue: true,
          message,
        };
      }

      return { continue: true };
    },
  });

  // 3. Context Window Limit Recovery - priority 30, all tools
  const contextLimitRecovery = createContextLimitRecoveryHook();
  registerHook({
    name: 'contextWindowLimitRecovery',
    event: 'PostToolUse',
    priority: 30,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName) {
        return { continue: true };
      }

      const message = contextLimitRecovery.postToolUse({
        tool_name: ctx.toolName,
        session_id: ctx.sessionId || '',
        tool_input: (ctx.toolInput as Record<string, unknown>) || {},
        tool_response: ctx.toolOutput ? String(ctx.toolOutput) : undefined,
      });

      if (message) {
        return {
          continue: true,
          message,
        };
      }

      return { continue: true };
    },
  });

  // 3.5. Read Tool Limit Recovery - priority 35, matcher: read
  const readToolLimitRecovery = createReadToolLimitRecoveryHook();
  registerHook({
    name: 'readToolLimitRecovery',
    event: 'PostToolUse',
    matcher: /^read$/i,
    priority: 35,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName || ctx.toolName.toLowerCase() !== 'read') {
        return { continue: true };
      }

      const message = readToolLimitRecovery.postToolUse({
        tool_name: ctx.toolName,
        session_id: ctx.sessionId || '',
        tool_input: (ctx.toolInput as Record<string, unknown>) || {},
        tool_response: ctx.toolOutput ? String(ctx.toolOutput) : undefined,
      });

      if (message) {
        return {
          continue: true,
          message,
        };
      }

      return { continue: true };
    },
  });

  // 4. Preemptive Compaction - priority 40, matcher: read/grep/glob/bash/webfetch
  const preemptiveCompaction = createPreemptiveCompactionHook();
  registerHook({
    name: 'preemptiveCompaction',
    event: 'PostToolUse',
    matcher: /^(read|grep|glob|bash|webfetch)$/i,
    priority: 40,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName) {
        return { continue: true };
      }

      const message = preemptiveCompaction.postToolUse({
        tool_name: ctx.toolName,
        session_id: ctx.sessionId || '',
        tool_input: (ctx.toolInput as Record<string, unknown>) || {},
        tool_response: ctx.toolOutput ? String(ctx.toolOutput) : undefined,
      });

      if (message) {
        return {
          continue: true,
          message,
        };
      }

      return { continue: true };
    },
  });

  // 5. Agent Usage Reminder - priority 50, matcher: read/grep/glob/edit/write
  const agentUsageReminder = createAgentUsageReminderHook();
  registerHook({
    name: 'agentUsageReminder',
    event: 'PostToolUse',
    matcher: /^(read|grep|glob|edit|write)$/i,
    priority: 50,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName) {
        return { continue: true };
      }

      const output = {
        title: '',
        output: ctx.toolOutput ? String(ctx.toolOutput) : '',
        metadata: undefined,
      };

      await agentUsageReminder['tool.execute.after'](
        {
          tool: ctx.toolName,
          sessionID: ctx.sessionId || '',
          callID: '',
        },
        output
      );

      // Check if output was modified (message appended)
      const originalOutput = ctx.toolOutput ? String(ctx.toolOutput) : '';
      if (output.output !== originalOutput) {
        return {
          continue: true,
          message: output.output.substring(originalOutput.length),
        };
      }

      return { continue: true };
    },
  });

  // 6. Olympus Orchestrator Post - priority 60, matcher: write/edit/bash/task
  const olympusOrchestrator = createOlympusOrchestratorHook(workDir);
  registerHook({
    name: 'olympusOrchestratorPost',
    event: 'PostToolUse',
    matcher: /^(write|edit|bash|task)$/i,
    priority: 60,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.toolName) {
        return { continue: true };
      }

      const result = olympusOrchestrator.postTool(
        ctx.toolName,
        (ctx.toolInput as Record<string, unknown>) || {},
        ctx.toolOutput ? String(ctx.toolOutput) : ''
      );

      if (!result.continue) {
        return {
          continue: false,
          stopReason: result.message,
        };
      }

      if (result.modifiedOutput) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: result.modifiedOutput
          }
        };
      }

      if (result.message) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUse',
            additionalContext: result.message
          }
        };
      }

      return { continue: true };
    },
  });
}
