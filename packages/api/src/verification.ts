/**
 * The pure parts of verification, each over facts the runtime collected: the
 * task's own diff, the tree the checks ran over, and the result the driver
 * returned. The line (`line.ts`) sequences them; nothing here reads a claim
 * as anything but a claim (I2).
 */
import picomatch from 'picomatch';
import { buildAdapterSet } from '@olympus-ai/adapters';
import type { AgentClaim } from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { DiffEntry } from '@olympus-ai/vault';
import { SUITE_KINDS } from './gate.js';

/**
 * Where the claim and the evidence differ. Only the claim's file list is
 * compared: it is the one part of a claim with a fact to compare against, and
 * the narrative is model text that is never parsed.
 */
export function claimEvidenceDiff(claim: AgentClaim, own: readonly DiffEntry[]): string[] {
  const claimed = new Set(claim.filesChanged.map(normaliseClaimedPath));
  const changed = new Set(own.map((entry) => entry.path));
  const differences: string[] = [];
  for (const path of [...claimed].sort()) {
    if (!changed.has(path)) differences.push(`claimed but not in the diff: ${path}`);
  }
  for (const path of [...changed].sort()) {
    if (!claimed.has(path)) differences.push(`in the diff but not claimed: ${path}`);
  }
  return differences;
}

/** A claimed path as the diff spells one: workspace-relative, POSIX separators, no leading `./` or `/workspace/`. */
function normaliseClaimedPath(path: string): string {
  let p = path.replace(/\\/g, '/');
  if (p.startsWith('/workspace/')) p = p.slice('/workspace/'.length);
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

/**
 * The paths of a task's own diff that no grant covers. A path must match both
 * the role's `writableGlobs` and the station's `workspaceGlobs`: either list
 * alone is a grant the other did not make (I4). An empty list grants nothing.
 */
export function writesOutsideGrant(own: readonly DiffEntry[], roleGlobs: readonly string[], stationGlobs: readonly string[]): string[] {
  const matcher = (globs: readonly string[]): ((path: string) => boolean) =>
    globs.length === 0 ? () => false : picomatch([...globs], { dot: true });
  const role = matcher(roleGlobs);
  const station = matcher(stationGlobs);
  return own.filter((entry) => !(role(entry.path) && station(entry.path))).map((entry) => entry.path);
}

/**
 * The number of suites in the verified tree, counted on the host by the
 * adapters from files alone, or null when the tree's stack has no test
 * adapter or its suites cannot be enumerated. Never read from a test runner's
 * output: that is written by the code under test (I5).
 */
export async function countSuites(tree: string): Promise<number | null> {
  try {
    const set = await buildAdapterSet(tree, { provider: null, coverage: null });
    if (set.test === null) return null;
    return (await set.test.enumerateSuites(tree)).length;
  } catch {
    return null;
  }
}

/**
 * The suite count a check's result records. A null here fails a suite check,
 * and any check that pins `expectedSuiteCount`: a tree whose suites cannot be
 * enumerated is not a tree whose suites passed (`gate.ts`).
 */
export function suiteCountFor(check: CheckSpec, counted: number | null): number | null {
  return SUITE_KINDS.has(check.kind) || check.expectedSuiteCount !== undefined ? counted : null;
}

const RESULT_KEYS = ['claim', 'contractVersion', 'events', 'model', 'taskId', 'usage'] as const;
const CLAIM_KEYS = ['filesChanged', 'narrative'] as const;
const MODEL_KEYS = ['family', 'model', 'provider', 'version'] as const;
const USAGE_KEYS = ['cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'inputTokens', 'outputTokens', 'wallClockMs'] as const;

function extraKeys(value: unknown, allowed: readonly string[], at: string): string[] {
  if (typeof value !== 'object' || value === null) return [`${at} is not an object`];
  const keys = Reflect.ownKeys(value).map(String);
  const problems = keys.filter((key) => !allowed.includes(key)).map((key) => `${at}.${key} is not a field of the contract`);
  for (const key of allowed) if (!keys.includes(key)) problems.push(`${at}.${key} is missing`);
  return problems;
}

/**
 * I2: a driver's result holds the contract's keys and no others, at every
 * level the runtime reads. The types stop a fresh literal naming `status`,
 * and nothing stops a value built first, cast, or produced by JavaScript from
 * carrying one (D-F3-22), so the check is made on the value at the boundary.
 */
export function taskResultProblems(value: unknown): string[] {
  const problems = extraKeys(value, RESULT_KEYS, 'result');
  if (typeof value !== 'object' || value === null) return problems;
  const r = value as Record<string, unknown>;
  problems.push(...extraKeys(r.claim, CLAIM_KEYS, 'result.claim'));
  problems.push(...extraKeys(r.model, MODEL_KEYS, 'result.model'));
  problems.push(...extraKeys(r.usage, USAGE_KEYS, 'result.usage'));
  if (!Array.isArray(r.events)) problems.push('result.events is not an array');
  return problems;
}
