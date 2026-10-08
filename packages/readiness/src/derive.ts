/**
 * The derivation: probe results in, a ceiling and the probe that holds it out.
 * Total over the probe set, with no defaulting rule left implicit (R1 §4):
 *
 *   L0  a Build system or Testing probe in L0_PROBES is not `supported`
 *   L1  those hold, and coverage or tamper analysis is not `supported`
 *   L1  those hold, and an `integrate` probe is not `supported`
 *   L2  every ceiling-bearing probe is `supported`
 *   L3  never; `ScanLevel` cannot carry it
 *
 * Only `supported` passes. `absent` and `indeterminate` derive identically
 * (I5); a probe missing from the results is treated as not supported and
 * named, never skipped.
 */
import { L0_PROBES, L1_PROBES, L2_PROBES } from './probes.js';
import type { HeldBy, ProbeId, ProbeResult, ScanLevel } from './types.js';

export interface Derivation {
  readonly level: ScanLevel;
  readonly heldBy: HeldBy;
}

export function deriveCeiling(results: readonly ProbeResult[]): Derivation {
  // Every result for the probe must pass, so a duplicate cannot outvote a gap.
  const supported = (id: ProbeId): boolean => {
    const mine = results.filter((r) => r.probe === id);
    return mine.length > 0 && mine.every((r) => r.outcome === 'supported');
  };
  const firstGap = (ids: readonly ProbeId[]): ProbeId | undefined => ids.find((id) => !supported(id));

  const l0 = firstGap(L0_PROBES);
  if (l0 !== undefined) return { level: 0, heldBy: { kind: 'probe', probe: l0 } };
  const l1 = firstGap([...L1_PROBES, ...L2_PROBES]);
  if (l1 !== undefined) return { level: 1, heldBy: { kind: 'probe', probe: l1 } };
  return { level: 2, heldBy: { kind: 'scan-limit' } };
}
