/**
 * Background Agent Feature
 *
 * Manages background tasks for the Olympus multi-agent system.
 * Provides concurrency control and task state management.
 *
 * Olympus background-agent feature for multi-agent orchestration.
 */

export * from './types.js';
export { BackgroundManager, getBackgroundManager, resetBackgroundManager } from './manager.js';
export { ConcurrencyManager } from './concurrency.js';
