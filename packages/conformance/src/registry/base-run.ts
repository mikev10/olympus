/**
 * R15: every check that declares what it does on the base runs over it at
 * the `test-design` exit, before any driver is invoked, and the exit is
 * refused unless each does there what the locked manifest declares
 * (D-A-BF-01, D-R15-01, D-R15-02).
 *
 * The hello fixture's `hello-written` check is a behavioral check declared
 * `'fails'`: the base has no `hello.txt`, and the rig's builder writes one
 * (`doingTheWork`). The assertions here make it an acceptance check, the
 * kind that must declare, over a workspace given a suite (`withSuite`).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EnforcementDecision, Vault, BaseRunRecord, EvidenceBundle } from '@olympus-ai/vault';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');

const COMPILES = { id: 'hello-exit-zero', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };
/** Builds the name rather than spelling it, which would make the file a protected path (D-R15-03). */
const READS_HELLO = "process.exit(require('node:fs').existsSync(['hello', 'txt'].join('.')) ? 0 : 1)";
/** The fixture's reproduction as an acceptance check: absent on the base, written by the build. */
const REPRODUCES = { id: 'hello-written', kind: 'acceptance', onBase: 'fails', command: ['node', '-e', READS_HELLO], required: true, timeoutMs: 10_000 };

/** A provider that counts what it provisions, so an assertion can see whether a check ran again. */
async function counting(): Promise<{ provider: SandboxProvider; provisioned: () => number }> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  let n = 0;
  const provider = new Proxy(inner, {
    get(target, key, receiver) {
      if (key === 'provision') {
        return async (...args: Parameters<SandboxProvider['provision']>) => {
          n += 1;
          return target.provision(...args);
        };
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  return { provider, provisioned: () => n };
}

async function decisionsOf(vault: Vault, rig: LineRig): Promise<EnforcementDecision[]> {
  return Promise.all((await vault.readDecisions(rig.runId)).map((ref) => readRecord<EnforcementDecision>(vault, ref)));
}

/**
 * The fixture declares no test framework, so its reproduction is behavioral
 * (D-R15-02). An acceptance check is a suite check and needs suites the
 * adapters can count, so an assertion about one gives the workspace a vitest
 * manifest and one test file.
 */
async function withSuite(rig: LineRig): Promise<void> {
  await writeFile(join(rig.dirs.artifacts, 'package.json'), JSON.stringify({ name: 'hello', private: true, devDependencies: { vitest: '4.1.11' } }));
  await writeFile(join(rig.dirs.artifacts, 'hello.test.mjs'), "import { test } from 'vitest';\ntest('hello', () => {});\n");
}

/** Runs the fixture with `checks` as its manifest and returns the refusal, the driver's requests, and the components. */
async function refusedAtTestDesign(rig: LineRig, checks: readonly unknown[], context: string) {
  const { startRun } = await api();
  await withSuite(rig);
  await writeManifest(rig.dirs, checks);
  const driver = await stubDriver();
  const components = await rig.components({ driver, reviewer: driver });
  const refusal = refusalOf(await startRun(await rig.request(components)), context);
  if (refusal.at !== 'test-design' || refusal.transition.reason !== 'base-mismatch') {
    throw new Error(`${context}: the run stopped at ${refusal.at} as '${refusal.transition.reason}', not at the test-design exit as base-mismatch`);
  }
  if (driver.requests.length !== 0) throw new Error(`${context}: the driver was invoked ${String(driver.requests.length)} times before the base was judged`);
  return { refusal: refusal.transition, components };
}

export const PASSING_ON_THE_BASE_REFUSES: LocalAssertion = runtime({
  id: 'I3.acceptance-check-must-fail-on-the-base',
  title:
    "an acceptance check declared 'fails' that exits 0 over the base refuses the test-design exit as base-mismatch before any driver is invoked, naming the check, its declaration, and its exit code, and the line records the refusal; so does one declared 'passes' that does not, while the fixture's own manifest crosses the exit: a gate the change could not fail proves nothing about the change",
  run: async () => {
    await withLine('r15-i3-passes-', async (rig) => {
      const vacuous = { ...REPRODUCES, command: ['node', '-e', 'process.exit(0)'] };
      const { refusal, components } = await refusedAtTestDesign(rig, [COMPILES, vacuous], 'I3 vacuous');
      const named = refusal.mismatched.map((m) => `${m.checkId}:${m.declared}:${String(m.exitCode)}:${m.cause}`);
      if (JSON.stringify(named) !== '["hello-written:fails:0:contrary"]') throw new Error(`I3: the refusal named ${JSON.stringify(named)}`);
      const recorded = (await decisionsOf(components.vault, rig)).filter(
        (d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'base-mismatch',
      );
      if (recorded.length !== 1 || recorded[0]?.decision.decidedBy !== 'line' || recorded[0].station !== 'test-design' || recorded[0].taskId !== null) {
        throw new Error(`I3: the base-mismatch refusal was recorded as ${JSON.stringify(recorded)}`);
      }
    });
    await withLine('r15-i3-guard-', async (rig) => {
      const guard = { ...REPRODUCES, id: 'guard', onBase: 'passes', command: ['node', '-e', 'process.exit(3)'] };
      const { refusal } = await refusedAtTestDesign(rig, [COMPILES, REPRODUCES, guard], 'I3 guard');
      const named = refusal.mismatched.map((m) => `${m.checkId}:${m.declared}:${String(m.exitCode)}:${m.cause}`);
      if (JSON.stringify(named) !== '["guard:passes:3:contrary"]') throw new Error(`I3: a guard that failed on the base was refused as ${JSON.stringify(named)}`);
    });
    await withLine('r15-i3-control-', async (rig) => {
      const { startRun } = await api();
      const outcome = await startRun(await rig.request(await rig.components()));
      if (!outcome.ok && outcome.reason === 'refused' && outcome.at === 'test-design') {
        throw new Error(`I3: the fixture's own manifest was refused at the test-design exit as '${outcome.transition.reason}'`);
      }
    });
  },
});

export const BASE_DECLARATION_HAS_NO_DEFAULT: LocalAssertion = runtime({
  id: 'I5.base-declaration-has-no-default',
  title:
    "admission refuses an acceptance check that declares neither 'fails' nor 'passes' on the base, and a behavioral check whose declaration is neither, naming the check, and refuses a declaration on a check of any kind but those two; nothing is locked and no sandbox is provisioned",
  run: async () => {
    const cases: ReadonlyArray<{ checks: unknown[]; path: string; code: string }> = [
      { checks: [COMPILES, REPRODUCES, { ...REPRODUCES, id: 'silent', onBase: undefined }], path: 'manifest.checks[2].onBase', code: 'undeclared' },
      { checks: [COMPILES, REPRODUCES, { ...REPRODUCES, id: 'maybe', onBase: 'sometimes' }], path: 'manifest.checks[2].onBase', code: 'undeclared' },
      { checks: [{ ...COMPILES, onBase: 'passes' }, REPRODUCES], path: 'manifest.checks[0].onBase', code: 'not-declarable' },
      { checks: [COMPILES, REPRODUCES, { ...REPRODUCES, id: 'scenario', kind: 'behavioral', onBase: 'sometimes' }], path: 'manifest.checks[2].onBase', code: 'undeclared' },
    ];
    for (const [i, c] of cases.entries()) {
      await withLine(`r15-i5-undeclared-${String(i)}-`, async (rig) => {
        await refusedAtAdmission(rig, c.checks, c.path, c.code);
      });
    }
  },
});

export const NOTHING_FAILING_ON_THE_BASE_IS_REFUSED: LocalAssertion = runtime({
  id: 'I5.nothing-failing-on-the-base-is-refused',
  title:
    "admission refuses a manifest in which no required acceptance or behavioral check is declared 'fails': one with no declared check, one whose declared checks are all guards, one whose only reproduction is optional, and one whose behavioral check declares nothing; the run has nothing to show the change did",
  run: async () => {
    const cases: readonly unknown[][] = [
      [COMPILES],
      [COMPILES, { ...REPRODUCES, onBase: 'passes' }],
      [COMPILES, { ...REPRODUCES, required: false }],
      [COMPILES, { ...REPRODUCES, kind: 'behavioral', onBase: undefined }],
    ];
    for (const [i, checks] of cases.entries()) {
      await withLine(`r15-i5-none-${String(i)}-`, async (rig) => {
        await refusedAtAdmission(rig, checks, 'manifest.checks', 'none-fails-on-base');
      });
    }
  },
});

async function refusedAtAdmission(rig: LineRig, checks: readonly unknown[], path: string, code: string): Promise<void> {
  const { startRun } = await api();
  await writeManifest(rig.dirs, checks, { asWritten: true });
  const { provider, provisioned } = await counting();
  const outcome = await startRun(await rig.request(await rig.components({ sandbox: provider })));
  if (outcome.ok || outcome.reason !== 'invalid-request') {
    throw new Error(`I5: ${JSON.stringify(checks)} was ${outcome.ok ? 'admitted and finished' : `refused as '${outcome.reason}'`}, not refused at admission`);
  }
  if (!outcome.problems.some((p) => p.path === path && p.code === code)) {
    throw new Error(`I5: admission named ${JSON.stringify(outcome.problems.map((p) => `${p.path}:${p.code}`))}, not ${path}:${code}`);
  }
  if (provisioned() !== 0) throw new Error(`I5: a refused admission provisioned ${String(provisioned())} sandboxes`);
}

export const UNSTARTED_BASE_CHECK_REFUSES: LocalAssertion = runtime({
  id: 'I5.unstarted-base-check-refuses',
  title:
    "an acceptance check that does not start over the base refuses the test-design exit as no-result with no exit code, and is recorded as unstarted with its reason, never as a failure that reproduces the defect; one whose suites count below its expectedSuiteCount refuses as suite-count",
  run: async () => {
    await withLine('r15-i5-unstarted-', async (rig) => {
      const absent = { ...REPRODUCES, command: ['r15-no-such-program'] };
      const { refusal, components } = await refusedAtTestDesign(rig, [COMPILES, absent], 'I5 unstarted');
      const [m] = refusal.mismatched;
      if (refusal.mismatched.length !== 1 || m.cause !== 'no-result' || m.exitCode !== null) {
        throw new Error(`I5: a check that did not start was refused as ${JSON.stringify(refusal.mismatched)}`);
      }
      const record = await readRecord<BaseRunRecord>(components.vault, refusal.baseRun);
      if (record.checks.length !== 0 || record.unstarted.length !== 1 || record.unstarted[0]?.checkId !== 'hello-written' || record.unstarted[0].reason === '') {
        throw new Error(`I5: the base record holds ${JSON.stringify(record)}; a check that did not start is unstarted, with its reason`);
      }
    });
    await withLine('r15-i5-shrunk-', async (rig) => {
      const { refusal } = await refusedAtTestDesign(rig, [COMPILES, { ...REPRODUCES, expectedSuiteCount: 5 }], 'I5 suite count');
      if (refusal.mismatched.length !== 1 || refusal.mismatched[0].cause !== 'suite-count') {
        throw new Error(`I5: a base whose suites count below what was expected was refused as ${JSON.stringify(refusal.mismatched)}`);
      }
    });
  },
});

export const BASE_RESULTS_ARE_THE_RUNTIMES: LocalAssertion = runtime({
  id: 'I2.base-results-are-the-runtimes',
  title:
    "the base results are a record the runtime wrote to the Vault once, beside the lock manifest, and verify's evidence bundle names it, so the same check is seen failing over the base and passing over the change from records the runtime made both times",
  run: async () => {
    await withLine('r15-i2-evidence-', async (rig) => {
      const { startRun } = await api();
      const components = await rig.components();
      await startRun(await rig.request(components));
      const vault = components.vault;
      const ref = await vault.readBaseRun(rig.runId);
      if (ref === null) throw new Error('I2: the run crossed test-design with no base record');
      const record = await readRecord<BaseRunRecord>(vault, ref);
      const before = record.checks.find((c) => c.checkId === 'hello-written');
      if ((record.collectedBy as string) !== 'runtime' || before === undefined || before.exitCode === 0) {
        throw new Error(`I2: the base record is ${JSON.stringify(record)}; the runtime's, with hello-written failing`);
      }
      const state = await vault.readRunState(rig.runId);
      const bundles = await Promise.all(state.evidenceRefs.map((r) => readRecord<EvidenceBundle>(vault, r)));
      if (bundles.length === 0) throw new Error('I2: the run recorded no evidence');
      for (const bundle of bundles) {
        if (JSON.stringify(bundle.baseRun) !== JSON.stringify(ref)) throw new Error(`I2: an evidence bundle names ${JSON.stringify(bundle.baseRun)}, not the base record`);
        const after = bundle.checks.find((c) => c.checkId === 'hello-written');
        if (after?.exitCode !== 0) throw new Error(`I2: hello-written over the change is ${JSON.stringify(after)}`);
      }
      await expectRefused(vault.recordBaseRun({ ...record }), 'a second base record');
    });
  },
});

export const RESUME_READS_THE_BASE_RECORD: LocalAssertion = runtime({
  id: 'I2.resume-reads-the-base-record',
  title:
    'a resume of a run refused at the test-design exit reads the base record and is refused again as base-mismatch without running any check over the base again',
  run: async () => {
    await withLine('r15-i2-resume-', async (rig) => {
      const { resumeRun } = await api();
      const vacuous = { ...REPRODUCES, command: ['node', '-e', 'process.exit(0)'] };
      const { refusal } = await refusedAtTestDesign(rig, [COMPILES, vacuous], 'I2 first drive');
      const { provider, provisioned } = await counting();
      const driver = await stubDriver();
      const again = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components({ sandbox: provider, driver, reviewer: driver }) }), 'I2 resume');
      if (again.at !== 'test-design' || again.transition.reason !== 'base-mismatch') {
        throw new Error(`I2: the resumed run stopped at ${again.at} as '${again.transition.reason}'`);
      }
      if (JSON.stringify(again.transition.baseRun) !== JSON.stringify(refusal.baseRun)) throw new Error('I2: the resume judged a base record other than the first');
      if (provisioned() !== 0 || driver.requests.length !== 0) {
        throw new Error(`I2: the resume provisioned ${String(provisioned())} sandboxes and invoked the driver ${String(driver.requests.length)} times`);
      }
    });
  },
});

async function expectRefused(write: Promise<unknown>, what: string): Promise<void> {
  try {
    await write;
  } catch {
    return;
  }
  throw new Error(`I2: ${what} was stored`);
}
