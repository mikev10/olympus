/**
 * The refusal an adapter set imposes: L3 needs every control, and a set that
 * lacks any is refused there, naming each. It refuses or allows; it never
 * hands back a lower level, because a caller that asked for L3 and silently
 * received L2 would proceed believing it had what it asked for (I5).
 *
 * Wiring this into run admission is owed to P6
 * (`I5.adapter-refusal-enforced-at-admission`); until then it is the rule,
 * asserted on its own.
 */
import type { AutonomyLevel } from '@olympus-ai/core';
import { missingControls } from './detect.js';
import type { AdapterSet } from './types.js';

export type AdapterAdmission =
  | { readonly ok: true; readonly level: AutonomyLevel }
  | {
    readonly ok: false;
    readonly reason: 'controls-unavailable';
    readonly requested: AutonomyLevel;
    /** Every control the set lacks, whether or not the set's own `unavailableControls()` admitted it. */
    readonly unavailable: readonly string[];
    readonly message: string;
  };

const LEVELS: readonly number[] = [0, 1, 2, 3];

export function adapterAdmission(set: AdapterSet, requested: AutonomyLevel): AdapterAdmission {
  // The parameter type is erased at run time, and a value that is not a level must not be compared as one.
  if (!LEVELS.includes(requested)) {
    throw new Error(`adapters: ${String(requested)} is not an autonomy level; refused rather than compared`);
  }
  if (requested < 3) return { ok: true, level: requested };
  const unavailable = [...new Set([...set.unavailableControls(), ...missingControls(set)])].sort();
  if (unavailable.length === 0) return { ok: true, level: requested };
  return {
    ok: false,
    reason: 'controls-unavailable',
    requested,
    unavailable,
    message: `L3 requires every control, and the ${set.stack} adapter set lacks ${unavailable.join(', ')}`,
  };
}
