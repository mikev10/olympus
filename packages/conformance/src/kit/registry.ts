/**
 * Registry evaluation: derives one of four states per invariant and per
 * capability claim, validates the records themselves, verifies external
 * assertions statically, and renders the report CI prints.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PENDING_BASELINE_FILE, type PendingBaseline } from './baseline.js';
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
import { workspacePackages, workspaceRoot } from './workspace.js';

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
  /** Structural defects: duplicate ids, unknown owners, missing states, broken external refs, a pending count over its baseline. Empty when the registry is sound. */
  readonly problems: readonly string[];
  readonly counts: {
    readonly asserted: number;
    readonly partial: number;
    readonly pending: number;
    readonly missing: number;
    readonly assertions: number;
    readonly external: number;
    readonly pendingEntries: number;
    /** Sum of the baseline over every entry that has one; undefined when no baseline was supplied. */
    readonly pendingBaseline: number | undefined;
  };
}

export interface EvaluateOptions {
  /** Workspace root used to verify external assertions. Defaults to the real one. */
  readonly root?: string;
  /**
   * The committed pending-count baseline (kit/baseline.ts). When supplied,
   * every entry must have one and no entry's pending count may exceed it.
   */
  readonly baseline?: PendingBaseline;
}

export function stateOf(entry: { assertions: readonly Assertion[]; pending: readonly PendingAssertion[] }): InvariantState {
  if (entry.assertions.length > 0) return entry.pending.length > 0 ? 'partial' : 'asserted';
  if (entry.pending.length > 0) return 'pending';
  return 'missing';
}

function isUnitId(value: string): value is UnitId {
  return Object.hasOwn(UNITS, value);
}

/**
 * Checks that an external assertion is real: its package is in the
 * workspace, its file exists, and the file names the assertion id. Returns a
 * problem description, or undefined when it verifies.
 */
export function verifyExternalAssertion(assertion: ExternalAssertion, root: string = workspaceRoot()): string | undefined {
  const pkg = workspacePackages(root).find((p) => p.name === assertion.package);
  if (pkg === undefined) return `${assertion.id}: package ${assertion.package} is not in the workspace`;
  const file = join(pkg.dir, assertion.file);
  if (!existsSync(file)) return `${assertion.id}: ${pkg.relativeDir}/${assertion.file} does not exist`;
  const text = readFileSync(file, 'utf8');
  if (!text.includes(`'${assertion.id}'`) && !text.includes(`"${assertion.id}"`)) {
    return `${assertion.id}: ${pkg.relativeDir}/${assertion.file} does not register that id`;
  }
  return undefined;
}

function validateEntry(
  ownerId: string,
  entry: { assertions: readonly Assertion[]; pending: readonly PendingAssertion[] },
  seen: Map<string, string>,
  problems: string[],
  root: string,
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
      const problem = verifyExternalAssertion(a, root);
      if (problem !== undefined) problems.push(problem);
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
  const root = options.root ?? workspaceRoot();
  const baseline = options.baseline;
  const problems: string[] = [];
  const seen = new Map<string, string>();

  const invariants: InvariantReport[] = [];
  for (const id of INVARIANT_IDS) {
    // The type makes this total; the check survives a cast.
    const entry: InvariantEntry | undefined = Object.hasOwn(registry.invariants, id) ? registry.invariants[id] : undefined;
    if (entry === undefined) {
      problems.push(`${id}: not registered`);
      invariants.push({ id, title: '', state: 'missing', assertions: [], pending: [], baseline: undefined });
      continue;
    }
    validateEntry(id, entry, seen, problems, root);
    const state = stateOf(entry);
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
    validateEntry(id, entry, seen, problems, root);
    const state = stateOf(entry);
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
    counts: {
      asserted: all.filter((r) => r.state === 'asserted').length,
      partial: all.filter((r) => r.state === 'partial').length,
      pending: all.filter((r) => r.state === 'pending').length,
      missing: all.filter((r) => r.state === 'missing').length,
      assertions: assertions.length,
      external: assertions.filter((a) => a.kind === 'external').length,
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
  lines.push(
    `Assertions: ${String(c.assertions)} (${String(c.external)} external)  asserted: ${String(c.asserted)}  partial: ${String(c.partial)}  pending: ${String(c.pending)}  missing: ${String(c.missing)}`,
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
