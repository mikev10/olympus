/**
 * PostToolUseFailure Hook Registrations
 *
 * Hooks that fire after a tool execution fails.
 * Used for error recovery, particularly for session-related errors
 * like thinking block order and empty message errors.
 */

import { registerHook } from '../registry.js';
import { createSessionRecoveryHook, isRecoverableError } from '../session-recovery/index.js';
import type { HookContext, HookResult } from '../types.js';

/**
 * Register all PostToolUseFailure hooks.
 */
export function registerPostToolUseFailureHooks(): void {
  const sessionRecovery = createSessionRecoveryHook();

  // Session Recovery - handles thinking block errors, empty message errors, etc.
  registerHook({
    name: 'sessionRecovery',
    event: 'PostToolUseFailure',
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      // Check if we have error information
      const error = ctx.error || ctx.toolOutput;

      if (!error) {
        return { continue: true };
      }

      // Check if this is a recoverable error
      if (!sessionRecovery.isRecoverable(error)) {
        return { continue: true };
      }

      // Attempt recovery
      const result = await sessionRecovery.onError({
        session_id: ctx.sessionId || 'default',
        error: error,
        message: undefined, // We don't have the failed message in this context
      });

      if (result.attempted && result.success) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUseFailure',
            additionalContext: result.message || `[session-recovery] Recovered from ${result.errorType} error. Please retry.`
          }
        };
      }

      if (result.attempted && !result.success) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'PostToolUseFailure',
            additionalContext: `[session-recovery] Attempted recovery for ${result.errorType} but could not fix automatically. You may need to restart the session.`
          }
        };
      }

      return { continue: true };
    },
  });
}
