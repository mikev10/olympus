/**
 * The pure parts of verification, each over facts the runtime collected: the
 * task's own diff, the tree the checks ran over, and the result the driver
 * returned. The line (`line.ts`) sequences them; nothing here reads a claim
 * as anything but a claim (I2).
 */
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import picomatch from 'picomatch';
import { buildAdapterSet, type TestFrameworkAdapter } from '@olympus-ai/adapters';
import type { AgentClaim } from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { DiffEntry } from '@olympus-ai/vault';
import type { RequestProblem } from './validate.js';

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
 * The base's test framework: the one every suite check runs, from the
 * base's own install, at the base run and at `verify` alike. The change
 * cannot replace it, since nothing a task writes under `node_modules` is
 * carried (D-R15-05). Null when the base declares no framework this runtime
 * supports, which admission refuses for any suite check (D-R15-04).
 */
export async function suiteRunner(base: string): Promise<TestFrameworkAdapter | null> {
  try {
    return (await buildAdapterSet(base, { provider: null, coverage: null })).test;
  } catch {
    return null;
  }
}

/**
 * The argument vector a check runs: the pinned one, or for a suite check the
 * base framework's own invocation over the check's tests, or over every
 * configured suite for a unit check. Admission refused a suite check with no
 * runner, so a null here is a run admitted on a base that has since changed.
 */
export function commandOf(check: CheckSpec, runner: TestFrameworkAdapter | null): readonly [string, ...string[]] {
  if (check.kind !== 'acceptance' && check.kind !== 'unit') return check.command;
  if (runner === null) throw new Error(`the base declares no supported test framework, so ${check.kind} check ${check.id} has no runner to start`);
  return runner.invocation(check.kind === 'acceptance' ? check.tests : null);
}

/**
 * Why a suite check cannot start in `tree`, or undefined when it can. The
 * runner is the base's install; with none there, `node` exits 1 for a module
 * it cannot find, which a check declared `'fails'` would read as a
 * reproduction. A test that never ran did not fail (I5).
 */
export async function runnerMissing(check: CheckSpec, runner: TestFrameworkAdapter | null, tree: string): Promise<string | undefined> {
  if (check.kind !== 'acceptance' && check.kind !== 'unit') return undefined;
  if (runner === null) return `the base declares no supported test framework, so ${check.kind} check ${check.id} has no runner`;
  const facts = await stat(join(tree, ...runner.runner.split('/'))).catch(() => null);
  return facts?.isFile() === true ? undefined : `${runner.stack}'s runner is not installed at ${runner.runner}, so the check cannot start`;
}

/**
 * Why the suite checks cannot be bound to the base, as admission refuses
 * them (D-R15-04): a suite check over a base with no supported test
 * framework, or one whose runner is not installed there; a named test that
 * is not an admitted acceptance test, so nothing locks it; or a set of named
 * tests the runner would not run exactly, because one is not a suite it
 * loads or because its selection rule takes in a suite nobody named. Read
 * from the snapshot, which is the tree every check runs over.
 */
export async function suiteBindingProblems(checks: readonly CheckSpec[], base: string, admittedTests: readonly string[]): Promise<RequestProblem[]> {
  const problems: RequestProblem[] = [];
  const suiteChecks = checks.filter((c) => c.kind === 'acceptance' || c.kind === 'unit');
  if (suiteChecks.length === 0) return problems;
  const runner = await suiteRunner(base);
  const admitted = new Set(admittedTests);
  for (const [i, check] of checks.entries()) {
    if (check.kind !== 'acceptance' && check.kind !== 'unit') continue;
    const at = `manifest.checks[${String(i)}]`;
    const missing = await runnerMissing(check, runner, base);
    if (missing !== undefined) {
      problems.push({ path: at, code: 'unbound', message: `${at}: ${missing}; a suite check runs the base's own test framework or nothing` });
      continue;
    }
    if (check.kind !== 'acceptance' || runner === null) continue;
    check.tests.forEach((test, j) => {
      if (!admitted.has(test)) {
        problems.push({ path: `${at}.tests[${String(j)}]`, code: 'unbound', message: `${at}.tests[${String(j)}]: '${test}' is not an admitted acceptance test, so nothing locks what the check runs` });
      }
    });
    let selected: string[];
    try {
      selected = await runner.selectSuites(base, check.tests);
    } catch (error) {
      problems.push({ path: `${at}.tests`, code: 'unbound', message: `${at}.tests: ${runner.stack} cannot say which suites it would run: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const chosen = new Set(selected);
    const unloaded = check.tests.filter((test) => !chosen.has(test));
    const extra = selected.filter((suite) => !check.tests.includes(suite));
    if (unloaded.length > 0) {
      problems.push({ path: `${at}.tests`, code: 'unbound', message: `${at}.tests: ${runner.stack} does not run ${unloaded.join(', ')} as a suite here, so its failure would reproduce nothing` });
    }
    if (extra.length > 0) {
      problems.push({ path: `${at}.tests`, code: 'unbound', message: `${at}.tests: ${runner.stack} would also run ${extra.join(', ')}, which the check does not name; a check runs exactly the tests it names` });
    }
  }
  return problems;
}

/**
 * The suite count a check's result records. For a suite check it is what the
 * runner was made to load, by its own selection rule over the tree it ran
 * in: an acceptance check's named tests that the runner selects, or every
 * suite a unit check's runner is configured to run (D-R15-04). A behavioral
 * check that pins `expectedSuiteCount` records the tree's count; any other
 * check, none. A null fails a check that requires a count: a tree whose
 * suites cannot be enumerated is not a tree whose suites passed (`gate.ts`).
 */
export async function suitesRun(check: CheckSpec, runner: TestFrameworkAdapter | null, tree: string): Promise<number | null> {
  try {
    if (check.kind === 'acceptance') {
      if (runner === null) return null;
      const named = new Set<string>(check.tests);
      return (await runner.selectSuites(tree, check.tests)).filter((suite) => named.has(suite)).length;
    }
    if (check.kind === 'unit') return runner === null ? null : (await runner.enumerateSuites(tree)).length;
  } catch {
    return null;
  }
  return check.expectedSuiteCount !== undefined ? countSuites(tree) : null;
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
