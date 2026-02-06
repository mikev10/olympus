/**
 * Discovery Capture Hook Registration
 *
 * Automatically captures discoveries from successful agent tasks.
 * Fires on Stop event at priority 92 (after learning-capture at 90).
 *
 * FLOW:
 * 1. Stop event fires
 * 2. Load config - skip if auto-discovery disabled
 * 3. Load session state - check volume limits
 * 4. Check for pending_completion (set by agent-tracking.ts)
 * 5. Detect success signals from recent prompts
 * 6. Extract discovery from task context
 * 7. Check deduplication
 * 8. Record discovery if all checks pass
 */

import { registerHook } from '../registry.js';
import { loadSessionState, saveSessionState, hasPendingCompletion, incrementDiscoveryCount, checkDiscoveryLimit } from '../../learning/session-state.js';
import { loadDiscoveryConfig } from '../../learning/config.js';
import { extractDiscovery, isDuplicate } from '../../learning/discovery-detector.js';
import { recordDiscovery } from '../../learning/discovery.js';
import type { HookContext, HookResult } from '../types.js';
import type { DetectionMethod } from '../../learning/discovery-detector.js';

/**
 * Register discovery capture hooks
 */
export function registerDiscoveryCaptureHooks(): void {
  registerHook({
    name: 'discoveryCapture',
    event: 'Stop',
    priority: 92, // After learning-capture (90), before cancellation (100)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.directory) {
          return { continue: true };
        }

        // Load config - skip if disabled
        const config = loadDiscoveryConfig(ctx.directory);
        if (!config.enabled) {
          return { continue: true };
        }

        // Load session state
        const state = loadSessionState(ctx.directory, ctx.sessionId);

        // Check volume limits
        if (checkDiscoveryLimit(state, config)) {
          return { continue: true };
        }

        // Check for pending completion (set by agent-tracking.ts)
        if (!hasPendingCompletion(state)) {
          return { continue: true };
        }

        // Detect success signal from recent prompts
        const detectionMethod = detectSuccessSignal(state);
        if (!detectionMethod) {
          return { continue: true };
        }

        // Extract discovery from task context
        const discovery = extractDiscovery(state, detectionMethod);
        if (!discovery) {
          return { continue: true };
        }

        // Check minimum confidence threshold
        if ((discovery.confidence || 0) < config.minConfidence) {
          return { continue: true };
        }

        // Check deduplication
        if (isDuplicate(discovery, ctx.directory, config.deduplicationWindowDays)) {
          return { continue: true };
        }

        // Record the discovery
        recordDiscovery({
          ...discovery,
          project_path: ctx.directory,
          session_id: state.session_id,
          category: discovery.category || 'technical_insight',
          summary: discovery.summary || '',
          details: discovery.details || '',
          agent_name: discovery.agent_name || 'unknown',
          confidence: discovery.confidence || 0.6,
          scope: 'project',
        });

        // Increment volume counter
        incrementDiscoveryCount(state);
        saveSessionState(ctx.directory, state);
      } catch (error) {
        // Silent failure - discovery capture should never break hooks
        console.error('[Olympus Discovery Capture] Error:', error);
      }

      return { continue: true };
    }
  });
}

/**
 * Detect success signal from session state.
 * Checks recent prompts for praise patterns or topic change.
 */
function detectSuccessSignal(state: import('../../learning/types.js').SessionState): DetectionMethod | null {
  const recentPrompts = state.recent_prompts || [];

  if (recentPrompts.length === 0) {
    return null;
  }

  // Check most recent prompt for praise
  const latestPrompt = recentPrompts[0];
  if (latestPrompt?.detected_feedback === 'praise') {
    return 'praise';
  }

  // Check for topic change (compare latest prompt to task description)
  if (latestPrompt?.prompt && state.pending_completion?.task_description) {
    const similarity = computeJaccardSimilarity(
      latestPrompt.prompt,
      state.pending_completion.task_description
    );
    if (similarity < 0.2) {
      return 'topic_change';
    }
  }

  return null;
}

/**
 * Simple Jaccard similarity for topic change detection.
 * Mirrors the implementation in success-detector.ts.
 */
function computeJaccardSimilarity(a: string, b: string): number {
  const extractKeywords = (text: string): Set<string> => {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 3)
    );
  };

  const setA = extractKeywords(a);
  const setB = extractKeywords(b);

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return union.size > 0 ? intersection.size / union.size : 0;
}
