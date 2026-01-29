/**
 * Stop Hook Registrations
 *
 * Hooks that fire when Claude Code is about to stop/idle.
 * These hooks can prevent stopping if work remains.
 */

import { registerHook } from '../registry.js';
import { checkPersistentModes, createHookOutput } from '../persistent-mode/index.js';
import { handleCancellationDetection } from '../../learning/hooks/cancellation-detector.js';
import type { HookContext, HookResult } from '../types.js';

export function registerStopHooks(): void {
  // Persistent Mode (unified handler for ascent, ultrawork, todos)
  registerHook({
    name: 'persistentMode',
    event: 'Stop',
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const sessionId = ctx.sessionId;
      const directory = ctx.directory || process.cwd();

      const result = await checkPersistentModes(sessionId, directory);
      const output = createHookOutput(result);

      return {
        continue: output.continue,
        message: output.message,
        stopReason: output.stopReason
      };
    }
  });

  // Learning: Cancellation Detection (lowest priority - passive capture)
  registerHook({
    name: 'learningCancellationCapture',
    event: 'Stop',
    priority: 100, // Runs last - passive capture
    handler: async (ctx: HookContext): Promise<HookResult> => {
      if (!ctx.directory) {
        return { continue: true };
      }

      // Fire-and-forget
      Promise.resolve().then(async () => {
        try {
          await handleCancellationDetection({
            directory: ctx.directory,
            sessionId: ctx.sessionId,
          });
        } catch (error) {
          console.error('[Olympus Learning]', error);
        }
      });

      return { continue: true };
    }
  });
}
