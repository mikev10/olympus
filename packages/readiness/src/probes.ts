/**
 * The probe set: each probe's pillar and whether it bears on the ceiling.
 * Adding a probe means naming both here, and a ceiling-bearing probe needs a
 * registry assertion that fails when it is deleted (I8,
 * `I8.ceiling-bearing-probe-has-an-assertion`).
 */
import type { Pillar, ProbeId } from './types.js';

export interface ProbeDefinition {
  readonly id: ProbeId;
  readonly pillar: Pillar;
  readonly ceilingBearing: boolean;
}

/**
 * Every probe, in derivation order. A ceiling is held by the first probe in
 * this order that is not `supported` among those its tier reads, so the order
 * is part of the derivation, not presentation: the more fundamental gap is
 * named first.
 */
export const PROBES: readonly ProbeDefinition[] = [
  { id: 'build.pinned-manifest', pillar: 'build-system', ceilingBearing: true },
  { id: 'build.install', pillar: 'build-system', ceilingBearing: true },
  { id: 'build.clean', pillar: 'build-system', ceilingBearing: true },
  { id: 'testing.adapter', pillar: 'testing', ceilingBearing: true },
  { id: 'testing.enumerate', pillar: 'testing', ceilingBearing: true },
  { id: 'testing.green-at-base', pillar: 'testing', ceilingBearing: true },
  { id: 'testing.coverage', pillar: 'testing', ceilingBearing: true },
  { id: 'testing.tamper-analysis', pillar: 'testing', ceilingBearing: true },
  { id: 'integrate.protected-paths', pillar: 'security-and-governance', ceilingBearing: true },
  { id: 'integrate.secret-scan', pillar: 'security-and-governance', ceilingBearing: true },
  { id: 'integrate.branch-protection', pillar: 'security-and-governance', ceilingBearing: true },
  { id: 'style.lint', pillar: 'style-and-validation', ceilingBearing: false },
  { id: 'style.format', pillar: 'style-and-validation', ceilingBearing: false },
  { id: 'style.typecheck', pillar: 'style-and-validation', ceilingBearing: false },
  { id: 'dev.cold-provision', pillar: 'dev-environment', ceilingBearing: false },
  { id: 'docs.agent-instructions', pillar: 'documentation', ceilingBearing: false },
  { id: 'quality.file-size', pillar: 'code-quality', ceilingBearing: false },
];

/** Below L1: a repository that cannot be built clean or has no derivable status supports manual work only. */
export const L0_PROBES: readonly ProbeId[] = [
  'build.pinned-manifest',
  'build.install',
  'build.clean',
  'testing.adapter',
  'testing.enumerate',
  'testing.green-at-base',
];

/** Below L2: the line cannot measure coverage or detect a weakened suite. */
export const L1_PROBES: readonly ProbeId[] = ['testing.coverage', 'testing.tamper-analysis'];

/** Below L2 as well: autonomous merge with no backstop at `integrate`. */
export const L2_PROBES: readonly ProbeId[] = [
  'integrate.protected-paths',
  'integrate.secret-scan',
  'integrate.branch-protection',
];

/** The probes the derivation reads. Exactly those declared ceiling-bearing. */
export const CEILING_BEARING: readonly ProbeId[] = PROBES.filter((p) => p.ceilingBearing).map((p) => p.id);

export function definitionOf(id: ProbeId): ProbeDefinition {
  const found = PROBES.find((p) => p.id === id);
  if (found === undefined) throw new Error(`readiness: ${id} is not a declared probe`);
  return found;
}
