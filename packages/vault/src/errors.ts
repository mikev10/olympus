import type { NoRunState } from './types.js';

/**
 * Whether a `readRunState` failure means the store holds no state for the run.
 * The only failure that does; anything else is a fault, and a reader that took
 * it for absence would drop the run's recorded evidence and spend (I5).
 */
export function isNoRunState(error: unknown): error is NoRunState {
  return error instanceof Error && (error as Partial<NoRunState>).code === 'no-run-state';
}
