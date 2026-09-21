/**
 * Registry evaluation: derives one of four states per invariant and per
 * capability claim, validates the records themselves, refuses external
 * assertions, and renders the report CI prints.
 */
import { PENDING_BASELINE_FILE, type PendingBaseline } from './baseline.js';
import { reconcileExternalAssertion, type ReconciliationVerdict } from './reconcile.js';
import {
  INVARIANT_IDS,
  UNITS,
  type Assertion,
  type ClaimEntry,
  type ClaimId,
  type ExternalAssertion,
  type InvariantEntry,
  type InvariantId,
  type InvariantState,
  type PendingAssertion,
  type Registry,
  type UnitId,
} from './types.js';

/**
 * Identity at runtime; the parameter type does the work. `invariants` is a
 * total record over InvariantId, so omitting an invariant or naming one that
 * does not exist is a compile error before the meta-test ever runs.
 */
export function defineRegistry(registry: Registry): Registry {
  return registry;
}

export interface InvariantReport {
  readonly id: InvariantId;
  readonly title: string;
  readonly state: InvariantState;
  readonly assertions: readonly Assertion[];
  readonly pending: readonly PendingAssertion[];
  /** The pending count the baseline allows; undefined when no baseline was supplied or it has no entry. */
  readonly baseline: number | undefined;
}

export interface ClaimReport {
  readonly id: ClaimId;
  readonly state: InvariantState;
  readonly assertions: readonly Assertion[];
  readonly pending: readonly PendingAssertion[];
  /** The pending count the baseline allows; undefined when no baseline was supplied or it has no entry. */
  readonly baseline: number | undefined;
}

export interface RegistryEvaluation {
  readonly invariants: readonly InvariantReport[];
  readonly claims: readonly ClaimReport[];
  /** Structural defects: duplicate ids, unknown owners, missing states, an unreconciled external assertion, a pending count over its baseline. Empty when the registry is sound. */
  readonly problems: readonly string[];
  /** One verdict per external assertion, keyed by assertion id. */
  readonly external: ReadonlyMap<string, ReconciliationVerdict>;
  readonly counts: {
    readonly asserted: number;
    readonly partial: number;
    readonly pending: number;
    readonly missing: number;
    readonly assertions: number;
    readonly external: number;
    /** External assertions reconciled against a passing test in the owning package's own run. */
    readonly externalAccepted: number;
    readonly pendingEntries: number;
    /** Sum of the baseline over every entry that has one; undefined when no baseline was supplied. */
    readonly pendingBaseline: number | undefined;
  };
}

/** Decides whether one external assertion ran and passed. Injectable so the kit's own tests need no sibling package. */
export type ExternalReconciler = (assertion: ExternalAssertion) => ReconciliationVerdict;

export interface EvaluateOptions {
  /**
   * The committed pending-count baseline (kit/baseline.ts). When supplied,
   * every entry must have one and no entry's pending count may exceed it.
   */
  readonly baseline?: PendingBaseline;
  /**
   * How an external assertion is reconciled against the owning package's own
   * test run. Defaults to the real one, which reads that package's run report:
   * an evaluation that took no reconciler would otherwise accept an external
   * assertion on the strength of nothing, which is the state this option
   * exists to end.
   */
  readonly reconcile?: ExternalReconciler;
}

/**
 * Live assertions are the local ones plus every external one reconciled
 * against a passing test in the owning package's own run. An external
 * assertion that was not reconciled is not coverage and does not count.
 */
export function stateOf(
  entry: { assertions: readonly Assertion[]; pending: readonly PendingAssertion[] },
  accepted: ReadonlySet<string> = new Set(),
): InvariantState {
  const live = entry.assertions.some((a) => a.kind === 'local' || accepted.has(a.id));
  if (live) return entry.pending.length > 0 ? 'partial' : 'asserted';
  if (entry.pending.length > 0) return 'pending';
  return 'missing';
}

function isUnitId(value: string): value is UnitId {
  return Object.hasOwn(UNITS, value);
}

/**
 * The assertion that had to land before an external assertion could be
 * accepted: reconciling the ids the registry lists against the tests the
 * owning package actually ran and passed. Paid by P5 in `kit/reconcile.ts`.
 * The id is still named on every refusal, so a rejected external assertion
 * points at the mechanism that rejected it.
 */
export const EXTERNAL_RECONCILIATION_ID = 'I8.external-assertion-execution-reconciled';

function validateEntry(
  ownerId: string,
  entry: { assertions: readonly Assertion[]; pending: readonly PendingAssertion[] },
  seen: Map<string, string>,
  problems: string[],
  external: Map<string, ReconciliationVerdict>,
  reconcile: ExternalReconciler,
): void {
  const prefix = `${ownerId}.`;
  const belongs = (id: string): boolean => id === ownerId || id.startsWith(prefix);
  for (const a of entry.assertions) {
    if (!belongs(a.id)) problems.push(`${ownerId}: assertion ${a.id} does not carry the ${ownerId} prefix`);
    const previous = seen.get(a.id);
    if (previous !== undefined) problems.push(`${a.id}: registered twice (${previous} and ${ownerId})`);
    seen.set(a.id, ownerId);
    if (a.title.trim() === '') problems.push(`${a.id}: empty title`);
    if (a.kind === 'external') {
      const verdict = reconcile(a);
      external.set(a.id, verdict);
      if (!verdict.ok) problems.push(`${verdict.detail} (${EXTERNAL_RECONCILIATION_ID}: ${verdict.refusal})`);
    }
  }
  for (const p of entry.pending) {
    if (!belongs(p.id)) problems.push(`${ownerId}: pending ${p.id} does not carry the ${ownerId} prefix`);
    const previous = seen.get(p.id);
    if (previous !== undefined) problems.push(`${p.id}: registered twice (${previous} and ${ownerId})`);
    seen.set(p.id, ownerId);
    if (!isUnitId(p.owner)) problems.push(`${p.id}: owner ${String(p.owner)} is not a unit`);
    if (p.reason.trim() === '') problems.push(`${p.id}: pending without a reason`);
  }
}

/**
 * The ratchet for one entry: its baseline, with a problem when the entry has
 * no baseline or its pending count exceeds it. A count below the baseline is
 * allowed; the report shows the delta.
 */
function ratchet(
  id: string,
  section: Readonly<Record<string, number>> | undefined,
  pendingCount: number,
  problems: string[],
): number | undefined {
  if (section === undefined) return undefined;
  if (!Object.hasOwn(section, id)) {
    problems.push(`${id}: no entry in ${PENDING_BASELINE_FILE}`);
    return undefined;
  }
  const allowed = section[id];
  if (allowed === undefined) return undefined;
  if (pendingCount > allowed) {
    problems.push(
      `${id}: pending count ${String(pendingCount)} exceeds baseline ${String(allowed)}; raise it deliberately in ${PENDING_BASELINE_FILE}`,
    );
  }
  return allowed;
}

export function evaluateRegistry(registry: Registry, options: EvaluateOptions = {}): RegistryEvaluation {
  const baseline = options.baseline;
  const reconcile = options.reconcile ?? reconcileExternalAssertion;
  const problems: string[] = [];
  const seen = new Map<string, string>();
  const external = new Map<string, ReconciliationVerdict>();
  /** The ids reconciled so far. An entry's own externals are resolved before its state is derived. */
  const accepted = (): ReadonlySet<string> =>
    new Set([...external].filter(([, verdict]) => verdict.ok).map(([id]) => id));

  const invariants: InvariantReport[] = [];
  for (const id of INVARIANT_IDS) {
    // The type makes this total; the check survives a cast.
    const entry: InvariantEntry | undefined = Object.hasOwn(registry.invariants, id) ? registry.invariants[id] : undefined;
    if (entry === undefined) {
      problems.push(`${id}: not registered`);
      invariants.push({ id, title: '', state: 'missing', assertions: [], pending: [], baseline: undefined });
      continue;
    }
    validateEntry(id, entry, seen, problems, external, reconcile);
    const state = stateOf(entry, accepted());
    if (state === 'missing') problems.push(`${id}: missing (no assertion and no pending owner)`);
    const allowed = ratchet(id, baseline?.invariants, entry.pending.length, problems);
    invariants.push({ id, title: entry.title, state, assertions: entry.assertions, pending: entry.pending, baseline: allowed });
  }
  for (const key of Object.keys(registry.invariants)) {
    if (!INVARIANT_IDS.includes(key as InvariantId)) problems.push(`${key}: not an invariant`);
  }

  const claims: ClaimReport[] = [];
  for (const [id, entry] of Object.entries(registry.claims) as Array<[ClaimId, ClaimEntry]>) {
    if (!id.startsWith('driver.') && !id.startsWith('sandbox.')) problems.push(`${id}: not a capability claim`);
    validateEntry(id, entry, seen, problems, external, reconcile);
    const state = stateOf(entry, accepted());
    if (state === 'missing') problems.push(`${id}: missing (no assertion and no pending owner)`);
    const allowed = ratchet(id, baseline?.claims, entry.pending.length, problems);
    claims.push({ id, state, assertions: entry.assertions, pending: entry.pending, baseline: allowed });
  }

  if (baseline !== undefined) {
    for (const key of Object.keys(baseline.invariants)) {
      if (!Object.hasOwn(registry.invariants, key)) problems.push(`${key}: in ${PENDING_BASELINE_FILE} but not in the registry`);
    }
    for (const key of Object.keys(baseline.claims)) {
      if (!Object.hasOwn(registry.claims, key)) problems.push(`${key}: in ${PENDING_BASELINE_FILE} but not in the registry`);
    }
  }

  const all = [...invariants, ...claims];
  const assertions = all.flatMap((r) => r.assertions);
  return {
    invariants,
    claims,
    problems,
    external,
    counts: {
      asserted: all.filter((r) => r.state === 'asserted').length,
      partial: all.filter((r) => r.state === 'partial').length,
      pending: all.filter((r) => r.state === 'pending').length,
      missing: all.filter((r) => r.state === 'missing').length,
      assertions: assertions.length,
      external: assertions.filter((a) => a.kind === 'external').length,
      externalAccepted: [...external.values()].filter((v) => v.ok).length,
      pendingEntries: all.reduce((n, r) => n + r.pending.length, 0),
      pendingBaseline: baseline === undefined ? undefined : all.reduce((n, r) => n + (r.baseline ?? 0), 0),
    },
  };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

function summarizeLevels(assertions: readonly Assertion[]): string {
  const counts = new Map<string, number>();
  for (const a of assertions) counts.set(a.level, (counts.get(a.level) ?? 0) + 1);
  return [...counts.entries()].map(([level, n]) => `${String(n)} ${level}`).join(', ');
}

/** `(baseline 2)`, `(baseline 2, -1)`, or `(baseline 2, +1 EXCEEDS)`; empty when there is no baseline. */
function baselineNote(pendingCount: number, baseline: number | undefined): string {
  if (baseline === undefined) return '';
  const delta = pendingCount - baseline;
  if (delta === 0) return ` (baseline ${String(baseline)})`;
  const sign = delta > 0 ? '+' : '';
  return ` (baseline ${String(baseline)}, ${sign}${String(delta)}${delta > 0 ? ' EXCEEDS' : ''})`;
}

/** The pending column: count, owners, and the baseline delta; empty when nothing is or was owed. */
function pendingColumn(r: { readonly pending: readonly PendingAssertion[]; readonly baseline: number | undefined }): string {
  const n = r.pending.length;
  if (n === 0 && (r.baseline === undefined || r.baseline === 0)) return '';
  const owners = n > 0 ? ` -> ${[...new Set(r.pending.map((p) => p.owner))].join(', ')}` : '';
  return `  pending ${String(n)}${owners}${baselineNote(n, r.baseline)}`;
}

/** The registry report: one line per invariant and claim, then every pending entry with its owner. */
export function formatReport(evaluation: RegistryEvaluation): string {
  const lines: string[] = [];
  lines.push('Conformance registry');
  lines.push('');
  lines.push('Invariants');
  for (const r of evaluation.invariants) {
    const detail = r.state === 'missing' ? 'MISSING' : summarizeLevels(r.assertions);
    lines.push(`  ${pad(r.id, 4)} ${pad(r.state, 9)} ${pad(r.title, 58)} ${detail}${pendingColumn(r)}`);
  }
  lines.push('');
  lines.push('Capability claims');
  for (const r of evaluation.claims) {
    const detail = r.state === 'missing' ? 'MISSING' : summarizeLevels(r.assertions);
    lines.push(`  ${pad(r.id, 30)} ${pad(r.state, 9)} ${detail}${pendingColumn(r)}`);
  }
  lines.push('');
  const c = evaluation.counts;
  const externalNote =
    c.external === 0 ? '' : ` (${String(c.external)} external, ${String(c.externalAccepted)} reconciled)`;
  lines.push(
    `Assertions: ${String(c.assertions)}${externalNote}  asserted: ${String(c.asserted)}  partial: ${String(c.partial)}  pending: ${String(c.pending)}  missing: ${String(c.missing)}`,
  );
  lines.push('');
  lines.push(`Pending entries: ${String(c.pendingEntries)}${baselineNote(c.pendingEntries, c.pendingBaseline)}; each names the unit that owes the assertion`);
  const pending = [...evaluation.invariants, ...evaluation.claims].flatMap((r) => r.pending);
  for (const p of pending) {
    lines.push(`  ${pad(p.owner, 3)} ${pad(p.id, 38)} ${p.reason}`);
  }
  if (evaluation.problems.length > 0) {
    lines.push('');
    lines.push('Problems');
    for (const p of evaluation.problems) lines.push(`  ${p}`);
  }
  return lines.join('\n');
}
