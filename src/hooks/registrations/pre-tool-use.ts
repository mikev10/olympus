/**
 * PreToolUse Hook Registrations
 *
 * Hooks that fire before a tool is executed.
 * Can inject context or modify tool input.
 */

import { registerHook } from '../registry.js';
import { createRulesInjectorHook } from '../rules-injector/index.js';
import { createDirectoryReadmeInjectorHook } from '../directory-readme-injector/index.js';
import { nonInteractiveEnvHook } from '../non-interactive-env/index.js';
import { createOlympusOrchestratorHook } from '../olympus-orchestrator/index.js';
import type { HookContext, HookResult } from '../types.js';

/**
 * Extract file path from tool input
 */
function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  return (obj.file_path || obj.filePath || obj.path || obj.file) as string | null;
}

/**
 * Register all PreToolUse hooks
 */
export function registerPreToolUseHooks(): void {
  // Rules Injector (inject project/user rules for file operations)
  registerHook({
    name: 'rulesInjector',
    event: 'PreToolUse',
    priority: 10,
    matcher: /^(read|edit|write|glob|grep)$/i,
    handler: (ctx: HookContext): HookResult => {
      const hook = createRulesInjectorHook(ctx.directory || process.cwd());
      const filePath = extractFilePath(ctx.toolInput);
      if (!filePath) return { continue: true };

      const message = hook.processToolExecution(
        ctx.toolName!,
        filePath,
        ctx.sessionId || 'default'
      );

      return {
        continue: true,
        hookSpecificOutput: message ? {
          hookEventName: 'PreToolUse',
          additionalContext: message
        } : undefined
      };
    }
  });

  // Directory README Injector (inject README context for directories)
  registerHook({
    name: 'directoryReadmeInjector',
    event: 'PreToolUse',
    priority: 20,
    matcher: /^(read|edit|write|glob|grep|bash)$/i,
    handler: (ctx: HookContext): HookResult => {
      const hook = createDirectoryReadmeInjectorHook(ctx.directory || process.cwd());
      const filePath = extractFilePath(ctx.toolInput);
      if (!filePath) return { continue: true };

      const message = hook.processToolExecution(
        ctx.toolName!,
        filePath,
        ctx.sessionId || 'default'
      );

      return {
        continue: true,
        hookSpecificOutput: message ? {
          hookEventName: 'PreToolUse',
          additionalContext: message
        } : undefined
      };
    }
  });

  // Non-Interactive Environment (add -y flags to commands)
  registerHook({
    name: 'nonInteractiveEnv',
    event: 'PreToolUse',
    priority: 30,
    matcher: /^bash$/i,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const commandInput = ctx.toolInput as { command?: string };
      if (!commandInput?.command) return { continue: true };

      try {
        if (!nonInteractiveEnvHook.beforeCommand) return { continue: true };
        const result = await nonInteractiveEnvHook.beforeCommand(commandInput.command);

        return {
          continue: true,
          hookSpecificOutput: result.warning ? {
            hookEventName: 'PreToolUse',
            additionalContext: result.warning
          } : undefined,
          modifiedInput: result.command !== commandInput.command
            ? { ...commandInput, command: result.command }
            : undefined
        };
      } catch (error) {
        console.error('[nonInteractiveEnv] Error:', error);
        return { continue: true };
      }
    }
  });

  // Olympus Orchestrator (pre-tool checks for delegation reminders)
  registerHook({
    name: 'olympusOrchestratorPre',
    event: 'PreToolUse',
    priority: 40,
    matcher: /^(write|edit|bash|task)$/i,
    handler: (ctx: HookContext): HookResult => {
      const hook = createOlympusOrchestratorHook(ctx.directory || process.cwd());
      const result = hook.preTool(ctx.toolName!, ctx.toolInput as Record<string, unknown>);
      return result;
    }
  });
}
