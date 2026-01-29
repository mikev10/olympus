/**
 * UserPromptSubmit Hook Registrations
 *
 * Hooks that fire when the user submits a prompt.
 */

import { registerHook } from '../registry.js';
import { detectKeywordsWithType, removeCodeBlocks } from '../keyword-detector/index.js';
import { createAutoSlashCommandHook } from '../auto-slash-command/index.js';
import { createThinkModeHook } from '../think-mode/index.js';
import { activateUltrawork } from '../ultrawork-state/index.js';
import {
  ULTRAWORK_MESSAGE,
  ULTRATHINK_MESSAGE,
  SEARCH_MESSAGE,
  ANALYZE_MESSAGE
} from '../../installer/hooks.js';
import { handleRevisionDetection } from '../../learning/hooks/revision-detector.js';
import { handleSuccessDetection } from '../../learning/hooks/success-detector.js';
import type { HookContext, HookResult } from '../types.js';

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

export function registerUserPromptSubmitHooks(): void {
  // Keyword Detector (highest priority - activates modes)
  registerHook({
    name: 'keywordDetector',
    event: 'UserPromptSubmit',
    priority: 10,
    handler: (ctx: HookContext): HookResult => {
      const promptText = getPromptText(ctx);
      if (!promptText) {
        return { continue: true };
      }

      const cleanedText = removeCodeBlocks(promptText);
      const keywords = detectKeywordsWithType(cleanedText);

      if (keywords.length === 0) {
        return { continue: true };
      }

      const hasUltrawork = keywords.some(k => k.type === 'ultrawork');
      const hasUltrathink = keywords.some(k => k.type === 'ultrathink');
      const hasSearch = keywords.some(k => k.type === 'search');
      const hasAnalyze = keywords.some(k => k.type === 'analyze');

      if (hasUltrawork) {
        activateUltrawork(promptText, ctx.sessionId, ctx.directory || process.cwd());
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: ULTRAWORK_MESSAGE
          }
        };
      }

      if (hasUltrathink) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: ULTRATHINK_MESSAGE
          }
        };
      }

      if (hasSearch) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: SEARCH_MESSAGE
          }
        };
      }

      if (hasAnalyze) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: ANALYZE_MESSAGE
          }
        };
      }

      return { continue: true };
    }
  });

  // Auto Slash Command (expand custom slash commands)
  registerHook({
    name: 'autoSlashCommand',
    event: 'UserPromptSubmit',
    priority: 20,
    handler: (ctx: HookContext): HookResult => {
      if (!ctx.parts) {
        return { continue: true };
      }

      const hook = createAutoSlashCommandHook();
      const result = hook.processMessage(
        { sessionId: ctx.sessionId || '' },
        ctx.parts
      );

      if (result.detected && result.injectedMessage) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: result.injectedMessage
          }
        };
      }
      return { continue: true };
    }
  });

  // Think Mode (activate extended thinking)
  registerHook({
    name: 'thinkMode',
    event: 'UserPromptSubmit',
    priority: 30,
    handler: (ctx: HookContext): HookResult => {
      if (!ctx.message || !ctx.parts) {
        return { continue: true };
      }

      const hook = createThinkModeHook();
      const sessionId = ctx.sessionId || 'default';

      // Build ThinkModeInput with proper types
      const thinkModeInput = {
        parts: ctx.parts,
        message: {
          model: ctx.message.model && ctx.message.model.providerId && ctx.message.model.modelId
            ? { providerId: ctx.message.model.providerId, modelId: ctx.message.model.modelId }
            : undefined
        }
      };

      const state = hook.processChatParams(sessionId, thinkModeInput);

      if (state.requested && state.modelSwitched) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: '[Think Mode Activated] Switched to high-reasoning model variant.'
          }
        };
      }

      return { continue: true };
    }
  });

  // Learning: Revision and Success Detection (lowest priority - passive capture)
  registerHook({
    name: 'learningFeedbackCapture',
    event: 'UserPromptSubmit',
    priority: 100, // Runs last - passive capture
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const promptText = getPromptText(ctx);
      if (!promptText || !ctx.directory) {
        return { continue: true };
      }

      // Fire-and-forget - don't block the conversation
      Promise.resolve().then(async () => {
        try {
          await handleRevisionDetection({
            prompt: promptText,
            directory: ctx.directory,
            sessionId: ctx.sessionId,
          });
          await handleSuccessDetection({
            prompt: promptText,
            directory: ctx.directory,
            sessionId: ctx.sessionId,
          });
        } catch (error) {
          // Silent failure - learning should never block
          console.error('[Olympus Learning]', error);
        }
      });

      return { continue: true };
    }
  });
}
