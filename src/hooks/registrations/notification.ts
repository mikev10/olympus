/**
 * Notification Hook Registrations
 *
 * Hooks that fire when notifications are received (e.g., background task completion).
 */

import { registerHook } from '../registry.js';
import { processBackgroundNotification } from '../background-notification/index.js';
import type { HookContext, HookResult } from '../types.js';
import type { BackgroundNotificationHookInput } from '../background-notification/types.js';

export function registerNotificationHooks(): void {
  // Background Notification (surface background task results)
  registerHook({
    name: 'backgroundNotification',
    event: 'Notification',
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      // Map HookContext to BackgroundNotificationHookInput
      const input: BackgroundNotificationHookInput = {
        sessionId: ctx.sessionId,
        directory: ctx.directory,
        event: ctx.event ? {
          type: ctx.event.type,
          properties: ctx.event.properties as Record<string, unknown> | undefined
        } : undefined,
      };

      // Process the notification
      const result = await processBackgroundNotification(input);

      // Map BackgroundNotificationHookOutput to HookResult
      return {
        continue: result.continue,
        hookSpecificOutput: result.message ? {
          hookEventName: 'Notification',
          additionalContext: result.message
        } : undefined
      };
    },
  });
}
