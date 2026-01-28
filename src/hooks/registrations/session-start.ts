/**
 * SessionStart Hook Registrations
 *
 * Hooks that fire when a new Claude Code session starts.
 */

import { registerHook } from '../registry.js';
import { readUltraworkState } from '../ultrawork-state/index.js';
import { checkIncompleteTodos } from '../todo-continuation/index.js';
import { generateLearnedContext, formatDiscoveries } from '../../learning/hooks/learned-context.js';
import { getDiscoveriesForInjection } from '../../learning/discovery.js';
import type { HookContext, HookResult } from '../types.js';

export function registerSessionStartHooks(): void {
  // Learned Context Injection (earliest priority - adds context before other hooks)
  registerHook({
    name: 'learnedContextInjection',
    event: 'SessionStart',
    priority: 5, // Early priority to add context before other hooks
    handler: (ctx: HookContext): HookResult => {
      if (!ctx.directory) {
        return { continue: true };
      }

      try {
        const learnedContext = generateLearnedContext(ctx.directory);
        const discoveries = getDiscoveriesForInjection(ctx.directory, 5);
        const discoveriesContext = formatDiscoveries(discoveries);

        const contextToInject = learnedContext + (discoveriesContext ? '\n\n' + discoveriesContext : '');

        if (contextToInject.trim()) {
          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'SessionStart',
              additionalContext: contextToInject
            }
          };
        }
      } catch (error) {
        console.error('[Olympus Learning]', error);
      }

      return { continue: true };
    }
  });

  // Session Start (restore persistent modes and pending tasks)
  registerHook({
    name: 'sessionStart',
    event: 'SessionStart',
    priority: 10,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const sessionId = ctx.sessionId;
      const directory = ctx.directory || process.cwd();
      const messages: string[] = [];

      // Check for active ultrawork state
      const ultraworkState = readUltraworkState(directory);
      if (ultraworkState?.active) {
        messages.push(`<session-restore>

[ULTRAWORK MODE RESTORED]

You have an active ultrawork session from ${ultraworkState.started_at}.
Original task: ${ultraworkState.original_prompt}

Continue working in ultrawork mode until all tasks are complete.

</session-restore>

---

`);
      }

      // Check for incomplete todos
      const todoResult = await checkIncompleteTodos(sessionId, directory);
      if (todoResult.count > 0) {
        messages.push(`<session-restore>

[PENDING TASKS DETECTED]

You have ${todoResult.count} incomplete tasks from a previous session.
Please continue working on these tasks.

</session-restore>

---

`);
      }

      if (messages.length > 0) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: messages.join('\n')
          }
        };
      }

      return { continue: true };
    }
  });
}
