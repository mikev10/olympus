/**
 * Hook Router
 *
 * Routes hook events to registered handlers with timeout protection,
 * error isolation, and config-based enable/disable.
 */

import type { HookContext, HookResult, HookEvent } from './types.js';
import { getHooksForEvent } from './registry.js';
import { loadConfig } from '../config/loader.js';
import type { PluginConfig } from '../shared/types.js';

/**
 * Get hook timeout from config (default 100ms).
 */
function getHookTimeout(config: PluginConfig): number {
  // Look for hooks.timeout or default to 100ms
  const hooksConfig = (config as Record<string, unknown>).hooks as Record<string, unknown> | undefined;
  if (hooksConfig && typeof hooksConfig.timeoutMs === 'number') {
    return hooksConfig.timeoutMs;
  }
  return 100;
}

/**
 * Check if a specific hook is enabled in config.
 */
function isHookEnabled(config: PluginConfig, hookName: string): boolean {
  const hooksConfig = (config as Record<string, unknown>).hooks as Record<string, unknown> | undefined;

  // Check global hooks.enabled flag
  if (hooksConfig && typeof hooksConfig.enabled === 'boolean' && !hooksConfig.enabled) {
    return false;
  }

  // Check hook-specific config
  if (hooksConfig && hookName in hooksConfig) {
    const hookConfig = hooksConfig[hookName];
    if (typeof hookConfig === 'object' && hookConfig !== null) {
      const enabled = (hookConfig as Record<string, unknown>).enabled;
      if (typeof enabled === 'boolean') {
        return enabled;
      }
    }
  }

  // Default to enabled
  return true;
}

/**
 * Execute a function with timeout protection.
 *
 * @param fn - Function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @returns Result or null if timed out
 */
async function executeWithTimeout<T>(
  fn: () => Promise<T> | T,
  timeoutMs: number
): Promise<T | null> {
  return Promise.race([
    Promise.resolve(fn()),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs))
  ]);
}

/**
 * Check if a tool name matches a hook matcher.
 *
 * @param matcher - String or RegExp matcher
 * @param toolName - Tool name to match
 * @returns Whether the tool matches
 */
function matchesTool(matcher: string | RegExp | undefined, toolName: string | undefined): boolean {
  if (!matcher || !toolName) return true;

  const regex = typeof matcher === 'string'
    ? new RegExp(matcher, 'i')
    : matcher;

  return regex.test(toolName);
}

/**
 * Route a hook event to all registered handlers.
 *
 * Execution:
 * - Hooks are executed in priority order (lower first)
 * - Each hook has a configurable timeout (default 100ms)
 * - Failed hooks are logged and skipped (graceful degradation)
 * - Messages from all hooks are aggregated
 *
 * @param event - The hook event type
 * @param context - Context for the event
 * @returns Aggregated result from all hooks
 */
export async function routeHook(
  event: HookEvent,
  context: HookContext
): Promise<HookResult> {
  const config = loadConfig();
  const hooks = getHooksForEvent(event);
  const hookTimeout = getHookTimeout(config);

  // Aggregate results
  let shouldContinue = true;
  const messages: string[] = [];
  let reason: string | undefined;
  let modifiedInput = context.toolInput;
  let modifiedMessages = context.messages;

  for (const hook of hooks) {
    // Check if hook is globally or specifically disabled
    if (!isHookEnabled(config, hook.name)) {
      continue;
    }

    // Check matcher for tool hooks
    if (!matchesTool(hook.matcher, context.toolName)) {
      continue;
    }

    try {
      const result = await executeWithTimeout(
        () => hook.handler({
          ...context,
          toolInput: modifiedInput,
          messages: modifiedMessages
        }),
        hookTimeout
      );

      if (result === null) {
        console.error(`[hook-router] ${hook.name} timed out after ${hookTimeout}ms`);
        continue;
      }

      // Handle continue=false (block action)
      if (!result.continue) {
        shouldContinue = false;
        reason = result.stopReason;
      }

      // Collect message if present (legacy format)
      if (result.message) {
        messages.push(result.message);
      }

      // Collect additionalContext from new format
      if (result.hookSpecificOutput?.additionalContext) {
        messages.push(result.hookSpecificOutput.additionalContext);
      }

      // Update modified input for subsequent hooks
      if (result.modifiedInput !== undefined) {
        modifiedInput = result.modifiedInput;
      }

      // Update modified messages (for future use)
      if (result.modifiedMessages !== undefined) {
        modifiedMessages = result.modifiedMessages;
      }
    } catch (error) {
      // Log error and continue to next hook (graceful degradation)
      console.error(`[hook-router] ${hook.name} error:`, error);
    }
  }

  return {
    continue: shouldContinue,
    message: messages.length > 0 ? messages.join('\n\n---\n\n') : undefined,
    stopReason: reason,
    modifiedInput: modifiedInput !== context.toolInput ? modifiedInput : undefined,
    modifiedMessages: modifiedMessages !== context.messages ? modifiedMessages : undefined
  };
}

/**
 * Route a hook event and return just the continue decision.
 * Convenience method for simple blocking checks.
 *
 * @param event - The hook event type
 * @param context - Context for the event
 * @returns Whether to continue
 */
export async function shouldContinue(
  event: HookEvent,
  context: HookContext
): Promise<boolean> {
  const result = await routeHook(event, context);
  return result.continue;
}
