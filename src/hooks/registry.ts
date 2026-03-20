/**
 * Hook Registry
 *
 * Central registry for all hooks. Hooks are organized by event type
 * and sorted by priority (lower runs first).
 *
 * Reserved priority ranges (do NOT reuse without updating this table):
 *
 *  Priority  Owner / Purpose
 *  --------  -------------------------------------------------------
 *   5        SessionStart — early session initialization
 *  10        SessionStart — standard session initialization
 *  50        AgentTracking — PreToolUse, tracks Task tool invocations
 *  70        LearningTool — discovery capture, tool-use learning
 *  75        PlanLifecycle — plan creation events
 *  76        PlanLifecycle — plan completion events
 *  84-86     Test infrastructure (Group 1A) — reserved for U-002/U-003
 *  90        LearningStop — session-end learning flush
 *  92        DiscoveryCapture — PostToolUse discovery events
 * 110        CompletePlan — plan completion and archival hook
 * 115        CompletePlan — final plan state persistence
 *
 * Available gaps: 77-83, 87-89
 */

import type { HookDefinition, HookEvent } from './types.js';

/** Map of event type to registered hooks */
const hooks: Map<HookEvent, HookDefinition[]> = new Map();

/**
 * Register a hook with the registry.
 * Hooks are sorted by priority after registration.
 *
 * @param hook - The hook definition to register
 */
export function registerHook(hook: HookDefinition): void {
  const eventHooks = hooks.get(hook.event) || [];
  eventHooks.push(hook);
  // Sort by priority (lower first, default 100)
  eventHooks.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  hooks.set(hook.event, eventHooks);
}

/**
 * Get all hooks registered for a specific event.
 *
 * @param event - The event type to get hooks for
 * @returns Array of hooks sorted by priority
 */
export function getHooksForEvent(event: HookEvent): HookDefinition[] {
  return hooks.get(event) || [];
}

/**
 * Get all registered hooks across all events.
 *
 * @returns Flat array of all hooks
 */
export function getAllHooks(): HookDefinition[] {
  return Array.from(hooks.values()).flat();
}

/**
 * Clear all registered hooks.
 * Primarily used for testing.
 */
export function clearHooks(): void {
  hooks.clear();
}

/**
 * Get the count of hooks by event type.
 *
 * @returns Map of event type to hook count
 */
export function getHookCounts(): Map<HookEvent, number> {
  const counts = new Map<HookEvent, number>();
  for (const [event, eventHooks] of hooks) {
    counts.set(event, eventHooks.length);
  }
  return counts;
}
