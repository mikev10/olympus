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
import { WorkflowEngine } from '../../features/workflow-engine/engine.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import {
  buildStructuredWorkflowPrompt,
  buildWorkflowResumptionPrompt
} from '../../features/workflow-engine/hooks.js';
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
  // Structured Workflow Detector (priority 8 - before keyword detector)
  registerHook({
    name: 'structuredWorkflowDetector',
    event: 'UserPromptSubmit',
    priority: 8,
    handler: async (ctx: HookContext): Promise<HookResult> => {
      const promptText = getPromptText(ctx);
      if (!promptText || !ctx.directory) {
        return { continue: true };
      }

      // Match patterns
      // /plan {feature} - excludes subcommands like "continue", "--abort", "--help"
      const planMatch = promptText.match(/^\/plan\s+(?!continue\b|--)([\s\S]+?)$/i);
      const continueMatch = promptText.match(/^\/plan\s+continue$/i);

      // Handle /plan {feature}
      if (planMatch) {
        let featureName = planMatch[1].trim();

        // Strip --structured flag if present (backward compatibility)
        featureName = featureName.replace(/\s+--structured\s*/i, '').trim();

        // Extract --depth flag
        let depthOverride: string | undefined;
        const depthFlagMatch = featureName.match(/\s+--depth\s+(shallow|medium|deep)\s*$/i);
        if (depthFlagMatch) {
          depthOverride = depthFlagMatch[1].toLowerCase();
          featureName = featureName.replace(depthFlagMatch[0], '').trim();
        }

        // Extract --brownfield or --greenfield flag
        let projectType: string | undefined;
        const projectTypeMatch = featureName.match(/\s+--(brownfield|greenfield)\s*$/i);
        if (projectTypeMatch) {
          projectType = projectTypeMatch[1].toLowerCase();
          featureName = featureName.replace(projectTypeMatch[0], '').trim();
        }

        // Validate feature name
        // Reject if too long (likely assistant output, not a real feature name)
        if (featureName.length > 120) {
          console.error('[Structured Workflow] Feature name too long, likely not a real feature name:', featureName.substring(0, 50) + '...');
          return { continue: true };
        }

        // Reject if it looks like a sentence/conversation rather than a feature name
        // Real feature names don't typically contain common sentence patterns
        const sentencePatterns = /\b(lets|let's|please|proceed|creating|we should|i want to|i need to|going to)\b/i;
        if (sentencePatterns.test(featureName)) {
          console.error('[Structured Workflow] Feature name looks like conversational text, skipping:', featureName.substring(0, 50) + '...');
          return { continue: true };
        }

        try {
          // Create new workflow engine instance
          const engine = new WorkflowEngine(ctx.directory, featureName);

          // Start the workflow (creates checkpoint and initializes)
          await engine.start(featureName);

          // Load the checkpoint to get the initial state (use same slugify as engine.ts)
          const workflowId = featureName
            .toLowerCase()
            .replace(/\.[a-z]{1,4}$/, '')
            .replace(/[_\s]+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
          const checkpoint = await loadCheckpoint(ctx.directory, workflowId);

          if (!checkpoint) {
            return { continue: true };
          }

          // Build the structured workflow prompt
          const workflowPrompt = buildStructuredWorkflowPrompt(featureName, checkpoint);

          // Inject workflow context hint
          const contextHint = `[Workflow: ${workflowId} | Phase: ${checkpoint.current_phase || 'inception'} | Stage: ${checkpoint.current_stage || 'intent'}]`;
          let additionalContext = `${contextHint}\n\n${workflowPrompt}`;

          // Add depth override if specified
          if (depthOverride) {
            additionalContext += `\n\nDepth override: ${depthOverride}`;
          }

          // Add project type if specified
          if (projectType) {
            additionalContext += `\n\nProject type: ${projectType}`;
          }

          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext
            }
          };
        } catch (error) {
          console.error('[Structured Workflow]', error);
          return { continue: true };
        }
      }

      // Handle /plan continue
      if (continueMatch) {
        try {
          // Find active workflows
          const workflows = await listWorkflows(ctx.directory);

          if (workflows.length === 0) {
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'UserPromptSubmit',
                additionalContext: 'No active workflows found. Use `/plan {feature}` to start a new workflow.'
              }
            };
          }

          // Load the most recent workflow (for now, just use the first one)
          // TODO: In the future, handle multiple workflows more intelligently
          const workflowId = workflows[0];
          const checkpoint = await loadCheckpoint(ctx.directory, workflowId);

          if (!checkpoint) {
            return { continue: true };
          }

          // Build the resumption prompt
          const resumptionPrompt = buildWorkflowResumptionPrompt(checkpoint.feature_name, checkpoint);

          // Inject workflow context hint
          const contextHint = `[Workflow: ${workflowId} | Phase: ${checkpoint.current_phase || 'inception'} | Stage: ${checkpoint.current_stage || 'intent'}]`;
          const additionalContext = `${contextHint}\n\n${resumptionPrompt}`;

          return {
            continue: true,
            hookSpecificOutput: {
              hookEventName: 'UserPromptSubmit',
              additionalContext
            }
          };
        } catch (error) {
          console.error('[Workflow Resume]', error);
          return { continue: true };
        }
      }

      // No pattern matched, continue normally
      return { continue: true };
    }
  });

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
