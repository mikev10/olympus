/**
 * Readiness: what one repository at one commit can support, as an autonomy
 * ceiling the policy engine enforces, derived from probes that ran.
 *
 * Every type here is the runtime's record of an observation. None has a field
 * a model or a driver writes (I2): a probe's outcome is computed from what the
 * runtime saw, and `collectedBy` is the literal that says so.
 */
import type { AutonomyLevel } from '@olympus-ai/core';

/**
 * The levels a scan can derive. L3 is absent from the type, not merely from
 * the derivation: the M3 canary owns L3, and no scan grants it.
 */
export type ScanLevel = Exclude<AutonomyLevel, 3>;

/** `indeterminate` is a probe that could not be executed. It derives exactly as `absent` does (I5). */
export type ProbeOutcome = 'supported' | 'absent' | 'indeterminate';

/** Groups probes in a report. A pillar carries no weight of its own; only a probe can hold a ceiling. */
export type Pillar =
  | 'build-system'
  | 'testing'
  | 'security-and-governance'
  | 'style-and-validation'
  | 'dev-environment'
  | 'documentation'
  | 'code-quality';

export type ProbeId =
  | 'build.pinned-manifest'
  | 'build.install'
  | 'build.clean'
  | 'testing.adapter'
  | 'testing.enumerate'
  | 'testing.green-at-base'
  | 'testing.coverage'
  | 'testing.tamper-analysis'
  | 'integrate.protected-paths'
  | 'integrate.secret-scan'
  | 'integrate.branch-protection'
  | 'style.lint'
  | 'style.format'
  | 'style.typecheck'
  | 'dev.cold-provision'
  | 'docs.agent-instructions'
  | 'quality.file-size';

/**
 * What a probe observed, and how. An executed probe that ran carries its exit
 * code and a hash of its output; one the sandbox stopped (a timeout, an output
 * overrun, a provisioning failure) carries why, and no exit code, because it
 * has none.
 */
export type ProbeEvidence =
  | {
    readonly via: 'executed';
    readonly argv: readonly string[];
    readonly image: string;
    readonly run:
      | { readonly kind: 'exited'; readonly exitCode: number; readonly durationMs: number; readonly outputSha256: string }
      | { readonly kind: 'stopped'; readonly reason: string; readonly durationMs: number };
  }
  | { readonly via: 'static'; readonly read: string }
  | { readonly via: 'checker'; readonly checker: string }
  | { readonly via: 'not-run'; readonly because: ProbeId };

export interface ProbeResult {
  readonly probe: ProbeId;
  readonly pillar: Pillar;
  readonly ceilingBearing: boolean;
  readonly outcome: ProbeOutcome;
  /** Why the outcome is what it is, in words a maintainer can act on. */
  readonly detail: string;
  readonly evidence: ProbeEvidence;
  readonly collectedBy: 'runtime';
}

/** What holds a scanned ceiling where it is: one probe, or the rule that no scan grants L3. */
export type HeldBy =
  | { readonly kind: 'probe'; readonly probe: ProbeId }
  | { readonly kind: 'scan-limit' };

/**
 * The fourth term of the effective-level formula. Never optional: a run on an
 * unscanned repository carries `not-scanned`, which leaves the other three
 * terms as they are and is visible as absence rather than vanishing inside a
 * comparison (I4, R1 §4).
 */
export type ReadinessCeiling =
  | { readonly kind: 'scanned'; readonly level: ScanLevel; readonly heldBy: HeldBy; readonly commit: string }
  | { readonly kind: 'not-scanned' };

export interface ReadinessReport {
  /** The full object name of the commit scanned. */
  readonly commit: string;
  readonly ceiling: Extract<ReadinessCeiling, { kind: 'scanned' }>;
  /** Every probe, in derivation order. */
  readonly probes: readonly ProbeResult[];
  /** Tree entries the scan could not reproduce in its copy, e.g. submodules, each named. */
  readonly skipped: readonly string[];
  readonly collectedBy: 'runtime';
}
