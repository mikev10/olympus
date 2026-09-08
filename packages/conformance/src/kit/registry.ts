/**
 * Registry evaluation: derives one of three states per invariant and per
 * capability claim, validates the records themselves, verifies external
 * assertions statically, and renders the report CI prints.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
}

export interface ClaimReport {
  readonly id: ClaimId;
  readonly state: InvariantState;
  readonly assertions: readonly Assertion[];
  readonly pending: readonly PendingAssertion[];
}

export interface RegistryEvaluation {
  readonly invariants: readonly InvariantReport[];
  readonly claims: readonly ClaimReport[];
  /** Structural defects: duplicate ids, unknown owners, missing states, broken external refs. Empty when the registry is sound. */
  readonly problems: readonly string[];
  readonly counts: {
    readonly asserted: number;
    readonly pending: number;
    readonly missing: number;
    readonly assertions: number;
    readonly external: number;
    readonly pendingEntries: number;
  };
}

export interface EvaluateOptions {
  /** Workspace root used to verify external assertions. Defaults to the real one. */
  readonly root?: string;
}

export function stateOf(entry: { assertions: readonly Assertion[]; pending: readonly PendingAssertion[] }): InvariantState {
  if (entry.assertions.length > 0) return 'asserted';
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

export function evaluateRegistry(registry: Registry, options: EvaluateOptions = {}): RegistryEvaluation {
  const root = options.root ?? workspaceRoot();
  const problems: string[] = [];
  const seen = new Map<string, string>();

  const invariants: InvariantReport[] = [];
  for (const id of INVARIANT_IDS) {
    // The type makes this total; the check survives a cast.
    const entry: InvariantEntry | undefined = Object.hasOwn(registry.invariants, id) ? registry.invariants[id] : undefined;
    if (entry === undefined) {
      problems.push(`${id}: not registered`);
      invariants.push({ id, title: '', state: 'missing', assertions: [], pending: [] });
      continue;
    }
    validateEntry(id, entry, seen, problems, root);
    const state = stateOf(entry);
    if (state === 'missing') problems.push(`${id}: missing (no assertion and no pending owner)`);
    invariants.push({ id, title: entry.title, state, assertions: entry.assertions, pending: entry.pending });
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
    claims.push({ id, state, assertions: entry.assertions, pending: entry.pending });
  }

  const all = [...invariants, ...claims];
  const assertions = all.flatMap((r) => r.assertions);
  return {
    invariants,
    claims,
    problems,
    counts: {
      asserted: all.filter((r) => r.state === 'asserted').length,
      pending: all.filter((r) => r.state === 'pending').length,
      missing: all.filter((r) => r.state === 'missing').length,
      assertions: assertions.length,
      external: assertions.filter((a) => a.kind === 'external').length,
      pendingEntries: all.reduce((n, r) => n + r.pending.length, 0),
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

/** The registry report: one line per invariant and claim, then every pending entry with its owner. */
export function formatReport(evaluation: RegistryEvaluation): string {
  const lines: string[] = [];
  lines.push('Conformance registry');
  lines.push('');
  lines.push('Invariants');
  for (const r of evaluation.invariants) {
    const detail = r.state === 'missing' ? 'MISSING' : summarizeLevels(r.assertions);
    const pending = r.pending.length > 0 ? `  pending ${String(r.pending.length)} -> ${[...new Set(r.pending.map((p) => p.owner))].join(', ')}` : '';
    lines.push(`  ${pad(r.id, 4)} ${pad(r.state, 9)} ${pad(r.title, 58)} ${detail}${pending}`);
  }
  lines.push('');
  lines.push('Capability claims');
  for (const r of evaluation.claims) {
    const detail = r.state === 'asserted' ? summarizeLevels(r.assertions) : r.state === 'pending' ? `-> ${[...new Set(r.pending.map((p) => p.owner))].join(', ')}` : 'MISSING';
    lines.push(`  ${pad(r.id, 30)} ${pad(r.state, 9)} ${detail}`);
  }
  lines.push('');
  const c = evaluation.counts;
  lines.push(`Assertions: ${String(c.assertions)} (${String(c.external)} external)  asserted: ${String(c.asserted)}  pending: ${String(c.pending)}  missing: ${String(c.missing)}`);
  lines.push('');
  lines.push(`Pending entries: ${String(c.pendingEntries)} (each names the unit that owes the assertion)`);
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
