/**
 * The runtime assertions P7 owes: tamper analysis over the two trees a task
 * was handed and verified in, what the line records from it, and the
 * escalation it raises. Registered under I3 (`i3.ts`).
 *
 * Each runs the control beside the case: the same trees or the same run with
 * the one change removed, so no assertion passes on an analysis that reports
 * everything.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { StationContractTable, TaskRequest } from '@olympus-ai/core';
import type { IntegrityViolation, TamperReport } from '@olympus-ai/integrity';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_REVIEW, linePolicy, withLine, writeManifest, type LineRig } from './line.js';
import { bundles, inTask, runHello, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');

const PASSING = { id: 'passes', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };

const PACKAGE = JSON.stringify({ name: 'fixture', version: '0.0.0', scripts: { test: 'vitest run' }, devDependencies: { vitest: '4.1.11' } });
const SUM_TEST = [
  "import { expect, test } from 'vitest';",
  "test('adds', () => {",
  '  expect(1 + 4).toBe(5);',
  '});',
  '',
].join('\n');

function isEmpty(report: TamperReport): boolean {
  return report.assertionsWeakened.length === 0 && report.skipMarkersAdded.length === 0 && report.testsDeleted.length === 0
    && report.snapshotsRegenerated.length === 0 && report.protectedPathsTouched.length === 0;
}

/** Two throwaway trees for the pure analysis, removed afterwards. */
async function withTrees(base: Record<string, string>, head: Record<string, string>, body: (base: string, head: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'p7-trees-'));
  try {
    for (const [tree, files] of [['base', base], ['head', head]] as const) {
      for (const [path, text] of Object.entries(files)) {
        const file = join(root, tree, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, text);
      }
    }
    await body(join(root, 'base'), join(root, 'head'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** The hello run over a vitest repository, with the task doing `change` to its workspace. */
async function runVitest(rig: LineRig, change: Record<string, string>) {
  await writeFile(join(rig.dirs.artifacts, 'package.json'), PACKAGE);
  await mkdir(join(rig.dirs.artifacts, 'src'), { recursive: true });
  await writeFile(join(rig.dirs.artifacts, 'src', 'sum.test.ts'), SUM_TEST);
  await writeManifest(rig.dirs, [PASSING]);
  const during = async (sandbox: SandboxProvider, req: TaskRequest): Promise<void> => {
    await inTask(sandbox, req, writes(change));
  };
  const run = await runHello(rig, { during });
  const [bundle] = await bundles(run.vault, run.state);
  if (bundle === undefined) throw new Error('I3: the run wrote no evidence bundle, so there is no tamper report to read');
  return { ...run, report: bundle.tamper };
}

function kinds(violations: readonly IntegrityViolation[]): string[] {
  const tamperKinds = new Set(['assertion-weakened', 'skip-marker', 'protected-path']);
  return violations.filter((v) => tamperKinds.has(v.kind)).map((v) => v.kind);
}

/** The reviewer's context, where the evidence facts reach the seat. */
function reviewContext(requests: readonly TaskRequest[]): string {
  const seat = requests.find((r) => r.taskId === HELLO_REVIEW);
  if (seat === undefined) throw new Error('I3: no review seat ran, so what it was shown cannot be read');
  return seat.stablePrefix;
}

export const CASE_SET_REDUCTION_IS_A_DELETION: LocalAssertion = runtime({
  id: 'I3.case-set-reduction-is-a-deletion',
  title:
    'a test file renamed while dropping three of its four cases reports those three as deleted, by name; the same rename keeping all four reports none; `expect(x).toBe(5)` changed to `expect(x).toBeTruthy()` is reported weakened with its before and after',
  run: async () => {
    const { analyzeTamper } = await api();
    const four = ["import { test, expect } from 'vitest';", ...['a', 'b', 'c', 'd'].map((n) => `test('${n}', () => { expect(${n}).toBe(1); });`)].join('\n');
    const one = ["import { test, expect } from 'vitest';", "test('a', () => { expect(a).toBe(1); });"].join('\n');
    await withTrees({ 'package.json': PACKAGE, 'src/old.test.ts': four }, { 'package.json': PACKAGE, 'src/new.test.ts': one }, async (base, head) => {
      const report = await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [] });
      const deleted = [...report.testsDeleted].sort();
      if (JSON.stringify(deleted) !== JSON.stringify(['src/old.test.ts: b', 'src/old.test.ts: c', 'src/old.test.ts: d'])) {
        throw new Error(`I3: a rename that dropped three cases reported ${JSON.stringify(deleted)} as deleted, not the three cases by name`);
      }
    });
    await withTrees({ 'package.json': PACKAGE, 'src/old.test.ts': four }, { 'package.json': PACKAGE, 'src/moved/new.test.ts': four }, async (base, head) => {
      const report = await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [] });
      if (!isEmpty(report)) throw new Error(`I3 control: a rename that kept every case reported ${JSON.stringify(report)}`);
    });
    await withTrees({ 'package.json': PACKAGE, 'src/x.test.ts': SUM_TEST.replace('1 + 4', 'x') }, { 'package.json': PACKAGE, 'src/x.test.ts': SUM_TEST.replace('1 + 4', 'x').replace('toBe(5)', 'toBeTruthy()') }, async (base, head) => {
      const report = await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [] });
      const [weakened] = report.assertionsWeakened;
      if (weakened?.file !== 'src/x.test.ts' || !weakened.before.includes('.toBe(5)') || !weakened.after.includes('.toBeTruthy()')) {
        throw new Error(`I3: toBe(5) changed to toBeTruthy() was reported as ${JSON.stringify(report.assertionsWeakened)}`);
      }
    });
  },
});

export const TAMPER_FINDING_ESCALATES_INTEGRATE: LocalAssertion = runtime({
  id: 'I3.tamper-finding-escalates-integrate',
  title:
    "a task that weakens an assertion in its own copy has the weakening in its evidence bundle's tamper report, recorded as an assertion-weakened violation that does not halt the run, and shown to the review seat; the same run writing an unrelated file reports nothing; and a transition out of integrate with a finding needs a human approval under a contract table whose integrate floor is auto, where the same transition without one advances",
  run: async () => {
    await withLine('p7-i3-weaken-', async (rig) => {
      const { report, violations, state, requests } = await runVitest(rig, { 'src/sum.test.ts': SUM_TEST.replace('toBe(5)', 'toBeTruthy()') });
      if (!report.assertionsWeakened.some((w) => w.file === 'src/sum.test.ts')) {
        throw new Error(`I3: a weakened assertion is not in the evidence's tamper report: ${JSON.stringify(report)}`);
      }
      if (!kinds(violations).includes('assertion-weakened')) throw new Error('I3: a weakened assertion was not recorded as an assertion-weakened violation');
      if (state.violations.length > 0) throw new Error('I3: a tamper finding halted the run; it escalates, and the call is a human\'s');
      if (!reviewContext(requests).includes('src/sum.test.ts')) throw new Error('I3: the review seat was not shown the tamper finding');
    });
    await withLine('p7-i3-weaken-control-', async (rig) => {
      const { report, violations } = await runVitest(rig, { 'src/ok.ts': 'export const ok = 1;\n' });
      if (!isEmpty(report)) throw new Error(`I3 control: an unrelated write reported ${JSON.stringify(report)}`);
      if (kinds(violations).length > 0) throw new Error(`I3 control: an unrelated write recorded ${kinds(violations).join(', ')}`);
    });
    const { STATION_CONTRACTS, transition } = await import('@olympus-ai/core');
    const integrate = STATION_CONTRACTS.integrate;
    const contracts: StationContractTable = { ...STATION_CONTRACTS, integrate: { ...integrate, exitGate: { ...integrate.exitGate, approval: 'auto' } } };
    const policy = await linePolicy({ ['integrate:1' as never]: 'auto' });
    const input = { from: 'integrate', to: 'observe', level: 1, policy, tampered: [], grants: [], protectedPathsTouched: [], contracts } as const;
    const escalated = transition({ ...input, tamperFindings: ['assertion weakened: src/sum.test.ts'] });
    if (escalated.ok || escalated.reason !== 'approval-required') {
      throw new Error(`I3: a finding left integrate's exit ${escalated.ok ? 'open' : escalated.reason}, not requiring a human`);
    }
    const clean = transition({ ...input, tamperFindings: [] });
    if (!clean.ok) throw new Error(`I3 control: integrate's exit with no finding was refused as ${clean.reason}`);
  },
});

export const SKIP_MARKER_IS_A_FINDING: LocalAssertion = runtime({
  id: 'I3.skip-marker-is-a-finding',
  title:
    "a task that turns `test('adds', …)` into `test.skip('adds', …)` has the marker in its evidence bundle's tamper report, naming the file, recorded as a skip-marker violation that does not halt the run",
  run: async () => {
    await withLine('p7-i3-skip-', async (rig) => {
      const { report, violations, state } = await runVitest(rig, { 'src/sum.test.ts': SUM_TEST.replace("test('adds'", "test.skip('adds'") });
      if (!report.skipMarkersAdded.some((m) => m.file === 'src/sum.test.ts' && m.marker.startsWith('test.skip'))) {
        throw new Error(`I3: an added test.skip is not in the tamper report: ${JSON.stringify(report.skipMarkersAdded)}`);
      }
      if (!kinds(violations).includes('skip-marker')) throw new Error('I3: an added skip marker was not recorded as a skip-marker violation');
      if (state.violations.length > 0) throw new Error('I3: a skip marker halted the run');
    });
  },
});

export const CHECK_DISPATCH_NOT_WRITABLE_BY_THE_TASK: LocalAssertion = runtime({
  id: 'I3.check-dispatch-not-writable-by-the-task',
  title:
    "a task that rewrites the package.json test script a pinned command dispatches through has package.json in its report's protectedPathsTouched, though the policy's protected paths do not name it, and records a protected-path violation; the same run writing an unrelated file names nothing. A script the pinned argument vector names by path is protected the same way: rewriting it is a touch when a command names it, and not when none does",
  run: async () => {
    await withLine('p7-i3-dispatch-', async (rig) => {
      const rewritten = JSON.stringify({ ...(JSON.parse(PACKAGE) as object), scripts: { test: 'node -e "process.exit(0)"' } });
      const { report, violations } = await runVitest(rig, { 'package.json': rewritten });
      if (!report.protectedPathsTouched.includes('package.json')) {
        throw new Error(`I3: a rewritten test script is not a protected-path touch: ${JSON.stringify(report.protectedPathsTouched)}`);
      }
      if (!kinds(violations).includes('protected-path')) throw new Error('I3: a rewritten test script was not recorded as a protected-path violation');
    });
    await withLine('p7-i3-dispatch-control-', async (rig) => {
      const { report } = await runVitest(rig, { 'src/ok.ts': 'export const ok = 1;\n' });
      if (report.protectedPathsTouched.length > 0) throw new Error(`I3 control: an unrelated write touched ${report.protectedPathsTouched.join(', ')}`);
    });
    const { analyzeTamper } = await api();
    await withTrees({ 'scripts/check.mjs': 'run()\n' }, { 'scripts/check.mjs': 'process.exit(0)\n' }, async (base, head) => {
      const named = await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [['node', 'scripts/check.mjs']] });
      if (!named.protectedPathsTouched.includes('scripts/check.mjs')) {
        throw new Error(`I3: a rewritten script the pinned command runs is not a protected-path touch: ${JSON.stringify(named.protectedPathsTouched)}`);
      }
      const unnamed = await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [] });
      if (unnamed.protectedPathsTouched.length > 0) throw new Error(`I3 control: a script no command names touched ${unnamed.protectedPathsTouched.join(', ')}`);
    });
  },
});

