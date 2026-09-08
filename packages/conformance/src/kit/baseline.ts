/**
 * The pending-count baseline: the ratchet. A committed table of how many
 * pending entries each invariant and each capability claim may carry. The
 * registry evaluation fails when any count exceeds its baseline, so owed work
 * cannot accumulate behind a passing check. A decrease is always allowed and
 * is reported as a delta. Raising a number is a deliberate edit to the
 * committed file, reviewable in a diff, never a side effect of adding an
 * entry.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INVARIANT_IDS, type InvariantId } from './types.js';
import { conformanceRoot } from './workspace.js';

/** Workspace-relative path of the committed baseline, for messages. */
export const PENDING_BASELINE_FILE = 'packages/conformance/pending-baseline.json';

export interface PendingBaseline {
  /** Allowed pending count per invariant id. */
  readonly invariants: Readonly<Record<string, number>>;
  /** Allowed pending count per claim id. */
  readonly claims: Readonly<Record<string, number>>;
}

/** Absolute path of the committed baseline. */
export function pendingBaselinePath(): string {
  return join(conformanceRoot(), 'pending-baseline.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readCounts(
  section: unknown,
  name: string,
  keyProblem: (key: string) => string | undefined,
): Record<string, number> {
  if (!isRecord(section)) throw new Error(`${PENDING_BASELINE_FILE}: ${name} is not an object`);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(section)) {
    const problem = keyProblem(key);
    if (problem !== undefined) throw new Error(`${PENDING_BASELINE_FILE}: ${problem}`);
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error(`${PENDING_BASELINE_FILE}: ${key}: ${JSON.stringify(value)} is not a non-negative integer`);
    }
    out[key] = value;
  }
  return out;
}

/** The document's keys: the two sections, plus a comment for the person editing it. */
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['$comment', 'invariants', 'claims']);

/** Parses the baseline document; throws on anything but the exact shape. */
export function parsePendingBaseline(text: string): PendingBaseline {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${PENDING_BASELINE_FILE}: not an object`);
  for (const key of Object.keys(parsed)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`${PENDING_BASELINE_FILE}: unknown key '${key}'`);
  }
  if (!('invariants' in parsed)) throw new Error(`${PENDING_BASELINE_FILE}: no invariants section`);
  if (!('claims' in parsed)) throw new Error(`${PENDING_BASELINE_FILE}: no claims section`);
  return {
    invariants: readCounts(parsed.invariants, 'invariants', (key) =>
      INVARIANT_IDS.includes(key as InvariantId) ? undefined : `'${key}' is not an invariant`,
    ),
    claims: readCounts(parsed.claims, 'claims', (key) =>
      key.startsWith('driver.') || key.startsWith('sandbox.') ? undefined : `'${key}' is not a capability claim`,
    ),
  };
}

/** Reads the committed baseline. A missing file is an error, never an empty baseline. */
export function readPendingBaseline(file: string = pendingBaselinePath()): PendingBaseline {
  if (!existsSync(file)) {
    throw new Error(`conformance: ${PENDING_BASELINE_FILE} not found at ${file}; the pending ratchet has no baseline`);
  }
  return parsePendingBaseline(readFileSync(file, 'utf8'));
}
