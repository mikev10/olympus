/**
 * Tamper analysis: the runtime's reading of what a task did to the tests
 * that judge it (I3), over two trees the runtime owns — the tree the task was
 * handed and the tree its checks ran over. Pure over those trees: it parses
 * through the adapters and executes nothing (I1), and it reads the diff the
 * runtime collected, never the driver's account of it (I2).
 *
 * A finding decides nothing alone. The line records each kind as a violation,
 * carries the report in the task's evidence bundle, and escalates the
 * `integrate` exit to a human; nothing here passes or fails a task.
 *
 * Lives in `api` for P6's reason: `adapters` depends on `integrity`, so an
 * analysis in `integrity` that reads through the adapters would close a cycle.
 */
import { relative } from 'node:path';
import picomatch from 'picomatch';
import { buildAdapterSet, diffTrees, VCS_DIRECTORIES, type Assertion, type TestFrameworkAdapter } from '@olympus-ai/adapters';
import type { RunState, TaskId, VaultRef } from '@olympus-ai/core';
import type { TamperReport } from '@olympus-ai/integrity';
import type { EvidenceBundle } from '@olympus-ai/vault';

export interface TamperOptions {
  /** The policy's protected paths: in-repo files whose change escalates rather than fails. */
  readonly protectedPaths: readonly string[];
  /** Where a pinned coverage check's report is, or null when the manifest pins none (A-P7-02). */
  readonly coverage: { readonly report: string; readonly sourceRoot: string } | null;
  /** The pinned checks' argument vectors: a file one names is what that check runs, and a change to it a touch. */
  readonly commands: ReadonlyArray<readonly string[]>;
}

const SNAPSHOT = /(?:^|\/)__snapshots__\/|\.snap$/;

function skipDirectory(name: string): boolean {
  return name === 'node_modules' || VCS_DIRECTORIES.has(name);
}

/** An assertion as a reader would write it, with its line: `line 3: expect(x).toBe(5)`. */
function spell(a: Assertion): string {
  const [subject = '', ...rest] = a.args;
  const call = a.operator.endsWith('()') ? `${a.operator.slice(0, -2)}(${rest.join(', ')})` : `${a.operator} ${rest.join(', ')}`;
  return `line ${String(a.line)}: expect(${subject}).${call}`;
}

function key(a: Assertion): string {
  return [a.operator, ...a.args, a.tolerance === undefined ? '' : String(a.tolerance)].join('\u0000');
}

/**
 * Every token of the pinned argument vectors that could name a file in the
 * tree, spelled as a tree-relative path. An element is split on whitespace,
 * quotes, and `=`, so `sh -c "node scripts/run.mjs"` and
 * `--config=ci.config.ts` name their files too; a token that names nothing
 * in the diff costs nothing, and one missed is a dispatch left unprotected.
 */
function commandPaths(commands: ReadonlyArray<readonly string[]>): Set<string> {
  const paths = new Set<string>();
  for (const argv of commands) {
    for (const token of argv.flatMap((arg) => arg.split(/[\s="'`]+/))) {
      const path = token.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
      if (path !== '' && !path.startsWith('/') && !path.startsWith('-')) paths.add(path);
    }
  }
  return paths;
}

/** Removes and returns one entry equal to `value`, or undefined when the multiset holds none. */
function take<T>(pool: T[], match: (item: T) => boolean): T | undefined {
  const index = pool.findIndex(match);
  return index === -1 ? undefined : pool.splice(index, 1)[0];
}

/**
 * The `before` side of a weakened or widened assertion. The adapter's
 * comparison returns the new form; the old one is the unpaired `before`
 * assertion on the same subject, same file first and then nearest line —
 * the rule the comparison itself pairs by.
 */
function formerOf(after: Assertion, unpaired: Assertion[]): Assertion | undefined {
  const candidates = unpaired.filter((b) => b.args[0] === after.args[0]);
  candidates.sort((x, y) => (x.file === after.file ? 0 : 1) - (y.file === after.file ? 0 : 1) || Math.abs(x.line - after.line) - Math.abs(y.line - after.line));
  const [best] = candidates;
  if (best !== undefined) take(unpaired, (b) => b === best);
  return best;
}

interface TestFile {
  readonly rel: string;
  readonly abs: string;
}

async function read<T>(files: readonly TestFile[], parse: (abs: string) => Promise<T[]>): Promise<Array<{ file: string; item: T }>> {
  const out: Array<{ file: string; item: T }> = [];
  for (const f of files) for (const item of await parse(f.abs)) out.push({ file: f.rel, item });
  return out;
}

async function testFindings(test: TestFrameworkAdapter, base: string, head: string, changed: ReadonlySet<string>): Promise<Pick<TamperReport, 'assertionsWeakened' | 'skipMarkersAdded' | 'testsDeleted'>> {
  const listed = async (root: string): Promise<TestFile[]> =>
    (await test.enumerateSuites(root)).map((abs) => ({ abs, rel: relative(root, abs).replaceAll('\\', '/') }));
  const [baseTests, headTests] = await Promise.all([listed(base), listed(head)]);
  const baseSet = new Set(baseTests.map((f) => f.rel));
  const headSet = new Set(headTests.map((f) => f.rel));
  // A file unchanged and a test on both sides contributes the same to each side, so only the rest
  // is read. A file that stopped being a test, by a config change, is read on the side it still is.
  const before = baseTests.filter((f) => changed.has(f.rel) || !headSet.has(f.rel));
  const after = headTests.filter((f) => changed.has(f.rel) || !baseSet.has(f.rel));

  const withFile = (entries: Array<{ file: string; item: Assertion }>): Assertion[] => entries.map(({ file, item }) => ({ ...item, file }));
  const was = withFile(await read(before, (abs) => test.parseAssertions(abs)));
  const now = withFile(await read(after, (abs) => test.parseAssertions(abs)));
  const delta = test.compareAssertions(was, now);
  const unpaired = [...was];
  for (const a of now) take(unpaired, (b) => key(b) === key(a) && b.file === a.file);
  for (const a of now) take(unpaired, (b) => key(b) === key(a));
  const former = (a: Assertion): string => {
    const b = formerOf(a, unpaired);
    return b === undefined ? '(no assertion on this subject before)' : spell(b);
  };
  const assertionsWeakened: TamperReport['assertionsWeakened'] = [
    ...[...delta.weakened, ...delta.toleranceWidened].map((a) => ({ file: a.file, before: former(a), after: spell(a) })),
    ...delta.removed.map((b) => ({ file: b.file, before: spell(b), after: '(removed)' })),
  ];

  // A marker pairs within its file, and across files only from a file that left the tests to one
  // that joined them — a rename or a move. Between two files that both survive, a marker is not the
  // same marker: `.only` moved from one to the other focuses a different set of tests.
  const markersBefore = await read(before, (abs) => test.detectSkipMarkers(abs));
  const markersAfter = await read(after, (abs) => test.detectSkipMarkers(abs));
  const unmatched = markersAfter.filter((m) => take(markersBefore, (b) => b.file === m.file && b.item === m.item) === undefined);
  const skipMarkersAdded: TamperReport['skipMarkersAdded'] = unmatched
    .filter((m) => baseSet.has(m.file) || take(markersBefore, (b) => !headSet.has(b.file) && b.item === m.item) === undefined)
    .map(({ file, item }) => ({ file, marker: item }));

  // Cases pair by title wherever they went, so a move or a rename that keeps a case loses nothing.
  const casesAfter = (await read(after, (abs) => test.enumerateCases(abs))).map((c) => c.item);
  const testsDeleted: string[] = [];
  for (const { file, item } of await read(before, (abs) => test.enumerateCases(abs))) {
    if (take(casesAfter, (c) => c === item) === undefined) testsDeleted.push(`${file}: ${item}`);
  }
  return { assertionsWeakened, skipMarkersAdded, testsDeleted };
}

/**
 * The report for one task: `base` is the tree it was handed, `head` the tree
 * its checks ran over. The adapter set is built from `base`, which the task
 * did not write, so a task cannot turn its own analysis off by editing the
 * manifest that selects it; that edit is itself a protected-path touch.
 *
 * A stack with no test adapter reports no test findings: the gap is the
 * unavailable `test` control, which admission records and which refuses L3.
 * An adapter that cannot read a file refuses, and the refusal propagates;
 * it is never an empty finding (I5).
 */
export async function analyzeTamper(base: string, head: string, options: TamperOptions): Promise<TamperReport> {
  const set = await buildAdapterSet(base, { provider: null, coverage: options.coverage });
  if (options.coverage !== null && set.coverage === null) {
    throw new Error(`tamper: a coverage check is pinned, and the stack ${set.stack} has no coverage adapter to read its report`);
  }
  const changes = await diffTrees(base, head, () => true, { skipDirectory });
  const changed = new Set(changes.map((c) => c.path));

  const isProtected = options.protectedPaths.length === 0 ? () => false : picomatch([...options.protectedPaths], { dot: true });
  const touched = new Set(changes.map((c) => c.path).filter((p) => isProtected(p)));
  // A config file changes what a pinned command dispatches to — a package.json script, a runner
  // config — without touching the command, the suite count, or a locked test.
  if (set.manifest !== null) for (const path of await set.manifest.detectConfigChanges(base, head)) touched.add(path);
  // So does a file the pinned command names: `node scripts/check.mjs` runs whatever that file says.
  const named = commandPaths(options.commands);
  for (const path of changed) if (named.has(path)) touched.add(path);

  const tests = set.test === null
    ? { assertionsWeakened: [], skipMarkersAdded: [], testsDeleted: [] }
    : await testFindings(set.test, base, head, changed);
  return {
    ...tests,
    snapshotsRegenerated: changes.map((c) => c.path).filter((p) => SNAPSHOT.test(p)),
    coverageDelta: set.coverage === null ? null : await set.coverage.changedLineCoverage(base, head),
    protectedPathsTouched: [...touched].sort(),
  };
}

/** Every finding but the protected paths, one line each, as the gate and the review seat read them. */
export function tamperFindings(report: TamperReport): string[] {
  return [
    ...report.assertionsWeakened.map((w) => `assertion weakened in ${w.file}: ${w.before} -> ${w.after}`),
    ...report.skipMarkersAdded.map((m) => `skip marker added in ${m.file}: ${m.marker}`),
    ...report.testsDeleted.map((t) => `test deleted: ${t}`),
    ...report.snapshotsRegenerated.map((s) => `snapshot regenerated: ${s}`),
  ];
}

export interface Escalations {
  readonly protectedPathsTouched: readonly string[];
  readonly tamperFindings: readonly string[];
}

/**
 * What the accepted work escalates: the reports of the latest bundle of each
 * task run state records as passed. Derived from the Vault alone, so a
 * resumed run escalates exactly as one that never stopped.
 */
export async function acceptedEscalations(state: RunState, bundleAt: (ref: VaultRef) => Promise<EvidenceBundle>): Promise<Escalations> {
  const latest = new Map<TaskId, EvidenceBundle>();
  for (const ref of state.evidenceRefs) {
    const bundle = await bundleAt(ref);
    latest.set(bundle.taskId, bundle);
  }
  const touched = new Set<string>();
  const findings: string[] = [];
  for (const [taskId, bundle] of latest) {
    if (!Object.hasOwn(state.tasks, taskId) || state.tasks[taskId] !== 'passed') continue;
    for (const path of bundle.tamper.protectedPathsTouched) touched.add(path);
    findings.push(...tamperFindings(bundle.tamper));
  }
  return { protectedPathsTouched: [...touched].sort(), tamperFindings: findings };
}
