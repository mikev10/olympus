/**
 * R15: every check that declares what it does on the base runs over it at
 * the `test-design` exit, before any driver is invoked, and the exit is
 * refused unless each does there what the locked manifest declares
 * (D-A-BF-01, D-R15-01, D-R15-02).
 *
 * The hello fixture's `hello-written` check is a behavioral check declared
 * `'fails'`: the base has no `hello.txt`, and the rig's builder writes one
 * (`doingTheWork`). The assertions here make it an acceptance check, the
 * kind that must declare, over a workspace given a suite and a runner
 * (`withSuite`), and admit its test file as a locked acceptance test.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EnforcementDecision, Vault, BaseRunRecord, EvidenceBundle } from '@olympus-ai/vault';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { Driver, TaskRequest, TaskResult } from '@olympus-ai/core';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { ARTIFACTS, HELLO_TASK, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');

const COMPILES = { id: 'hello-exit-zero', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };
/** The locked acceptance test: it throws until `hello.txt` exists. It builds the name rather than spelling it (D-R15-03). */
const HELLO_TEST = 'hello.test.mjs';
/** A locked acceptance test that passes whatever the tree holds, and one that never does. */
const PASSING_TEST = 'passes.test.mjs';
const FAILING_TEST = 'fails.test.mjs';
/** The fixture's reproduction as an acceptance check: it runs the locked test, which fails on the base and passes once the build writes the file. */
export const REPRODUCES = { id: 'hello-written', kind: 'acceptance', onBase: 'fails', tests: [HELLO_TEST], required: true, timeoutMs: 10_000 };

/**
 * A stand-in for vitest at the path the adapter starts it from, as the base
 * installed it: it imports each test file it is given after `run` and exits 1
 * if any throws, or if it was given none. The stub sandbox runs it on the
 * host, so the runner the line starts is this file, from the base.
 */
const RUNNER = [
  "import { pathToFileURL } from 'node:url';",
  "const files = process.argv.slice(process.argv.indexOf('run') + 1);",
  'if (files.length === 0) process.exit(1);',
  'for (const file of files) {',
  '  try { await import(pathToFileURL(file).href); } catch { process.exit(1); }',
  '}',
  'process.exit(0);',
  '',
].join('\n');

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
 * (D-R15-02). An acceptance check is a suite check: it runs the base's
 * installed framework over locked tests the framework enumerates, so an
 * assertion about one gives the workspace a vitest manifest, the runner, and
 * the test files, and admits the tests as acceptance tests (D-R15-04).
 */
export async function withSuite(rig: LineRig): Promise<void> {
  const root = rig.dirs.artifacts;
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hello', private: true, devDependencies: { vitest: '4.1.11' } }));
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'vitest', 'vitest.mjs'), RUNNER);
  await writeFile(join(root, HELLO_TEST), "import { existsSync } from 'node:fs';\nif (!existsSync(['hello', 'txt'].join('.'))) throw new Error('hello.txt is not written');\n");
  await writeFile(join(root, PASSING_TEST), '');
  await writeFile(join(root, FAILING_TEST), "throw new Error('fails on every tree');\n");
}

/** The rig's artifacts, with every test `withSuite` writes admitted as an acceptance test. */
export const SUITE_ARTIFACTS = { ...ARTIFACTS, acceptanceTests: [...ARTIFACTS.acceptanceTests, HELLO_TEST, PASSING_TEST, FAILING_TEST] };

/** Runs the fixture with `checks` as its manifest and returns the refusal, the driver's requests, and the components. */
async function refusedAtTestDesign(rig: LineRig, checks: readonly unknown[], context: string, sandbox?: SandboxProvider) {
  const { startRun } = await api();
  await withSuite(rig);
  await writeManifest(rig.dirs, checks);
  const driver = await stubDriver();
  const components = await rig.components({ driver, reviewer: driver, ...(sandbox === undefined ? {} : { sandbox }) });
  const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: SUITE_ARTIFACTS })), context);
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
      const vacuous = { ...REPRODUCES, tests: [PASSING_TEST] };
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
      const guard = { ...REPRODUCES, id: 'guard', onBase: 'passes', tests: [FAILING_TEST] };
      const { refusal } = await refusedAtTestDesign(rig, [COMPILES, REPRODUCES, guard], 'I3 guard');
      const named = refusal.mismatched.map((m) => `${m.checkId}:${m.declared}:${String(m.exitCode)}:${m.cause}`);
      if (JSON.stringify(named) !== '["guard:passes:1:contrary"]') throw new Error(`I3: a guard that failed on the base was refused as ${JSON.stringify(named)}`);
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
      // The runner cannot be started: the provider's exec of it throws, so there is no exit code to record.
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const inner = new StubSandboxProvider();
      const unstartable: SandboxProvider = new Proxy(inner, {
        get(target, key, receiver) {
          if (key !== 'exec') return Reflect.get(target, key, receiver) as unknown;
          return async (...args: Parameters<SandboxProvider['exec']>) => {
            if (args[1].includes('node_modules/vitest/vitest.mjs')) throw new Error('the runner could not be spawned');
            return target.exec(...args);
          };
        },
      });
      const { refusal, components } = await refusedAtTestDesign(rig, [COMPILES, REPRODUCES], 'I5 unstarted', unstartable);
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
      // A behavioral check that pins a count is held to it over the base, as at verify: the tree holds three suites.
      const pinned = { id: 'scenario', kind: 'behavioral', onBase: 'fails', command: ['node', '-e', 'process.exit(1)'], expectedSuiteCount: 5, required: true, timeoutMs: 10_000 };
      const { refusal } = await refusedAtTestDesign(rig, [COMPILES, REPRODUCES, pinned], 'I5 suite count');
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
      const vacuous = { ...REPRODUCES, tests: [PASSING_TEST] };
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

const VITEST_RUNNER = 'node_modules/vitest/vitest.mjs';

/** A provider that records every argument vector it runs, so an assertion can see what the line started. */
async function recording(): Promise<{ provider: SandboxProvider; ran: () => ReadonlyArray<readonly string[]> }> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  const ran: Array<readonly string[]> = [];
  const provider = new Proxy(inner, {
    get(target, key, receiver) {
      if (key !== 'exec') return Reflect.get(target, key, receiver) as unknown;
      return async (...args: Parameters<SandboxProvider['exec']>) => {
        ran.push([...args[1]]);
        return target.exec(...args);
      };
    },
  });
  return { provider, ran: () => ran };
}

/** Admission over a workspace `setup` prepared, with the suite's tests admitted: refused, naming `path` and `code`, with no sandbox provisioned. */
async function refusedAtBinding(rig: LineRig, checks: readonly unknown[], path: string, code: string, setup: (rig: LineRig) => Promise<void>): Promise<void> {
  const { startRun } = await api();
  await setup(rig);
  await writeManifest(rig.dirs, checks, { asWritten: true });
  const { provider, provisioned } = await counting();
  const outcome = await startRun(await rig.request(await rig.components({ sandbox: provider }), { artifacts: SUITE_ARTIFACTS }));
  if (outcome.ok || outcome.reason !== 'invalid-request') {
    throw new Error(`D-R15-04: ${JSON.stringify(checks)} was ${outcome.ok ? 'admitted and finished' : `refused as '${outcome.reason}'`}, not refused at admission`);
  }
  if (!outcome.problems.some((p) => p.path === path && p.code === code)) {
    throw new Error(`D-R15-04: admission named ${JSON.stringify(outcome.problems.map((p) => `${p.path}:${p.code}`))}, not ${path}:${code}`);
  }
  if (provisioned() !== 0) throw new Error(`D-R15-04: a refused admission provisioned ${String(provisioned())} sandboxes`);
}

export const SUITE_CHECK_RUNS_WHAT_IT_NAMES: LocalAssertion = runtime({
  id: 'I5.suite-check-runs-what-it-names',
  title:
    "a unit or acceptance check pins no command: the line starts the base's installed test framework over exactly the locked tests an acceptance check names, over the base and at verify, and records as its suite count the named tests that runner selects; admission refuses a suite check that pins a command, a named test that is not an admitted acceptance test or that the framework does not run as a suite, a set the framework's own selection rule would widen, and a suite check over a base with no test framework, so a count of the tree's test files never stands in for tests nothing ran (D-R15-04)",
  run: async () => {
    await withLine('r15-i5-bound-', async (rig) => {
      const { startRun } = await api();
      await withSuite(rig);
      await writeManifest(rig.dirs, [COMPILES, REPRODUCES]);
      const { provider, ran } = await recording();
      const components = await rig.components({ sandbox: provider });
      await startRun(await rig.request(components, { artifacts: SUITE_ARTIFACTS }));
      const started = ran().filter((argv) => argv.includes(VITEST_RUNNER)).map((argv) => argv.join(' '));
      const expected = `node ${VITEST_RUNNER} run ./${HELLO_TEST}`;
      if (started.length !== 2 || started.some((argv) => argv !== expected)) {
        throw new Error(`D-R15-04: the line started ${JSON.stringify(started)}; once over the base and once at verify, each exactly ${expected}`);
      }
      const vault = components.vault;
      const ref = await vault.readBaseRun(rig.runId);
      if (ref === null) throw new Error('D-R15-04: no base record');
      const before = (await readRecord<BaseRunRecord>(vault, ref)).checks.find((c) => c.checkId === REPRODUCES.id);
      const state = await vault.readRunState(rig.runId);
      const bundles = await Promise.all(state.evidenceRefs.map((r) => readRecord<EvidenceBundle>(vault, r)));
      const after = bundles.at(-1)?.checks.find((c) => c.checkId === REPRODUCES.id);
      if (before?.exitCode !== 1 || before.suiteCount !== 1 || after?.exitCode !== 0 || after.suiteCount !== 1) {
        throw new Error(`D-R15-04: the reproduction was recorded as ${JSON.stringify(before)} over the base and ${JSON.stringify(after)} at verify`);
      }
    });
    // The external review's construction (R15 codex-1): a probe that reads a file the build writes, given a suite count the
    // tree's test files would have met although the probe loads none of them.
    const probe = { ...REPRODUCES, tests: undefined, command: ['node', '-e', "process.exit(require('node:fs').existsSync(['hello', 'txt'].join('.')) ? 0 : 1)"], expectedSuiteCount: 1 };
    const cases: ReadonlyArray<{ checks: unknown[]; path: string; code: string; setup?: (rig: LineRig) => Promise<void> }> = [
      { checks: [COMPILES, probe], path: 'manifest.checks[1].command', code: 'not-applicable' },
      { checks: [COMPILES, REPRODUCES, { id: 'unit', kind: 'unit', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 }], path: 'manifest.checks[2].command', code: 'not-applicable' },
      {
        checks: [COMPILES, { ...REPRODUCES, tests: ['unlocked.test.mjs'] }],
        path: 'manifest.checks[1].tests[0]',
        code: 'unbound',
        setup: async (rig) => {
          await withSuite(rig);
          await writeFile(join(rig.dirs.artifacts, 'unlocked.test.mjs'), '');
        },
      },
      { checks: [COMPILES, { ...REPRODUCES, tests: ['acceptance.md'] }], path: 'manifest.checks[1].tests', code: 'unbound' },
      {
        checks: [COMPILES, REPRODUCES],
        path: 'manifest.checks[1].tests',
        code: 'unbound',
        setup: async (rig) => {
          await withSuite(rig);
          // `./hello.test.mjs` is a filter to vitest, and this path contains it.
          await mkdir(join(rig.dirs.artifacts, 'deep'), { recursive: true });
          await writeFile(join(rig.dirs.artifacts, 'deep', HELLO_TEST), '');
        },
      },
      {
        checks: [COMPILES, REPRODUCES, { id: 'unit', kind: 'unit', required: true, timeoutMs: 10_000 }],
        path: 'manifest.checks[2]',
        code: 'unbound',
        // The tests, and no framework to run them.
        setup: async (rig) => {
          for (const test of [HELLO_TEST, PASSING_TEST, FAILING_TEST]) await writeFile(join(rig.dirs.artifacts, test), '');
        },
      },
    ];
    for (const [i, c] of cases.entries()) {
      await withLine(`r15-i5-unbound-${String(i)}-`, async (rig) => {
        await refusedAtBinding(rig, c.checks, c.path, c.code, c.setup ?? withSuite);
      });
    }
  },
});

/** The rig's stub builder, made to write one file under node_modules besides whatever the rig has it do. */
async function writingDependency(path: string, text: string, sandbox: SandboxProvider): Promise<Driver> {
  const driver = await stubDriver();
  return new Proxy(driver, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        if ((req.role as string) === 'builder') {
          const script = `const fs = require('node:fs'); fs.mkdirSync(require('node:path').dirname(${JSON.stringify(path)}), { recursive: true }); fs.writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(text)})`;
          const wrote = await sandbox.exec(req.sandbox, ['node', '-e', script]);
          if (wrote.exitCode !== 0) throw new Error(`the write under node_modules did not land: ${wrote.stderr}`);
        }
        return target.runTask(req);
      };
    },
  });
}

export const DEPENDENCY_TREES_ARE_THE_BASES: LocalAssertion = runtime({
  id: 'I3.dependency-trees-are-the-bases',
  title:
    "every check runs over the base's dependency trees, so the change cannot replace the runner that judges it: what a task writes under node_modules is never carried into the tree the checks run over, is recorded in its evidence by package, and escalates the integrate exit; a builder that rewrites the test runner an acceptance check starts, and does nothing else, is judged by the base's runner and parks (D-R15-05)",
  run: async () => {
    await withLine('r15-i3-judge-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      await withSuite(rig);
      await writeManifest(rig.dirs, [COMPILES, REPRODUCES]);
      const sandbox = new StubSandboxProvider();
      const driver = await writingDependency(VITEST_RUNNER, 'process.exit(0)\n', sandbox);
      const components = await rig.components({ sandbox, driver, reviewer: driver }, { work: false });
      const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: SUITE_ARTIFACTS })), 'I3 judge');
      const state = refusal.state;
      if (state?.tasks[HELLO_TASK] !== 'parked') throw new Error(`I3: a builder that only rewrote the runner left the task ${String(state?.tasks[HELLO_TASK])}, not parked`);
      const bundles = await Promise.all(state.evidenceRefs.map((r) => readRecord<EvidenceBundle>(components.vault, r)));
      const bundle = bundles.at(-1);
      const judged = bundle?.checks.find((c) => c.checkId === REPRODUCES.id);
      if (judged?.exitCode !== 1 || JSON.stringify(bundle?.notCarried) !== '["node_modules/vitest"]' || bundle?.diff.length !== 0) {
        throw new Error(`I3: the rewritten runner's evidence was ${JSON.stringify({ judged, notCarried: bundle?.notCarried, diff: bundle?.diff })}`);
      }
    });
    await withLine('r15-i3-cache-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      const driver = await writingDependency('node_modules/.vite/vitest/results.json', '{}', sandbox);
      const components = await rig.components({ sandbox, driver });
      const refusal = refusalOf(await startRun(await rig.request(components)), 'I3 cache');
      const escalations = refusal.transition.reason === 'approval-required' ? refusal.transition.escalations : [];
      if (refusal.at !== 'integrate' || !escalations.some((e) => e.endsWith(': node_modules/.vite'))) {
        throw new Error(`I3: a passing task's write under node_modules stopped the run at ${refusal.at} escalated by ${JSON.stringify(escalations)}`);
      }
    });
  },
});
