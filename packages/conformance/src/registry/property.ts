/**
 * R25: property checks. A property check runs locked property files under
 * the base's test framework, with the runtime's preload ahead of it, which
 * pins the seed and the case count and reports every run (D-R25-02).
 *
 * The rig is the hello fixture with a stand-in vitest, which imports the
 * files it is given, and a stand-in fast-check. The stand-in implements the
 * surface the preload uses: `configureGlobal`, `assert`, `property`,
 * `integer`, `stringify`, and `defaultReportMessage`. Its generator is seeded
 * and deterministic. The preload, the adapter that writes it, its reports,
 * and the comparison are the real ones. The stub sandbox runs on the host and
 * mounts nothing, so the rig maps the preload's mount onto its source. The
 * real fast-check under the real vitest, in the check image, is what the
 * benchmark's deterministic tier runs (D-R25-04).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Driver, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { CheckResult } from '@olympus-ai/integrity';
import type { SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { BaseRunRecord, EvidenceBundle } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { ONE_RULE } from './decisions.js';
import { ARTIFACTS, HELLO_TASK, linePolicy, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');

const COMPILES = { id: 'hello-exit-zero', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };

/** The stand-in vitest: imports each file it is given after `run`, and exits 1 if any throws or none is given. */
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

/** The stand-in fast-check, ESM, at the entry its package.json exports. */
const FAST_CHECK = [
  'let global = {};',
  'export function configureGlobal(parameters) { global = { ...parameters }; }',
  'export function integer() { return { generate: (next) => (next() % 2001) - 1000 }; }',
  'export function property(arbitrary, predicate) { return { arbitrary, predicate }; }',
  'export function stringify(value) { return JSON.stringify(value); }',
  'export function defaultReportMessage(d) { return d.failed ? `Property failed after ${d.numRuns} tests { seed: ${d.seed} } Counterexample: ${stringify(d.counterexample)}` : undefined; }',
  'export function assert(prop, parameters = {}) {',
  '  const p = { ...global, ...parameters };',
  '  const seed = p.seed ?? 0;',
  '  const numRuns = p.numRuns ?? 100;',
  '  let state = (seed >>> 0) || 1;',
  '  const next = () => { state = (Math.imul(state, 1103515245) + 12345) >>> 0; return state >>> 8; };',
  '  let details = { failed: false, numRuns: 0, seed, counterexample: null };',
  '  for (let i = 0; i < numRuns; i += 1) {',
  '    const value = prop.arbitrary.generate(next);',
  '    details.numRuns = i + 1;',
  '    let ok;',
  '    try { ok = prop.predicate(value) !== false; } catch { ok = false; }',
  '    if (!ok) { details = { ...details, failed: true, counterexample: [value] }; break; }',
  '  }',
  '  if (p.reporter !== undefined) return p.reporter(details);',
  '  const message = defaultReportMessage(details);',
  '  if (message !== undefined) throw new Error(message);',
  '}',
  'export default { configureGlobal, integer, property, stringify, defaultReportMessage, assert };',
  '',
].join('\n');

/** A property that fails until the build writes `hello.txt`, whose name it builds rather than spells (D-R15-03). */
const HELLO_PROPERTY = 'hello.property.test.mjs';
/** A property that holds on every tree. */
const HOLDS = 'holds.property.test.mjs';
/** A property that holds, run by a file that sets its own case count below the pin. */
const FEW = 'few.property.test.mjs';
/** A file that registers a property and never reaches it. */
const UNREACHED = 'unreached.property.test.mjs';
/** A file that imports the framework and registers nothing. */
const NONE = 'none.property.test.mjs';
/** A property that fails for some inputs on every tree, so its counterexample depends on the seed alone. */
const SOMETIMES = 'sometimes.property.test.mjs';
/** The multiply suite: an acceptance test on three inputs, and a property over all of them. */
const MULTIPLY_TEST = 'multiply.test.mjs';
const MULTIPLY_PROPERTY = 'multiply.property.test.mjs';
const MATH = 'math.mjs';

const PROPERTY_FILES: Readonly<Record<string, string>> = {
  [HELLO_PROPERTY]: "import fc from 'fast-check';\nimport { existsSync } from 'node:fs';\nfc.assert(fc.property(fc.integer(), () => existsSync(['hello', 'txt'].join('.'))));\n",
  [HOLDS]: "import fc from 'fast-check';\nfc.assert(fc.property(fc.integer(), (n) => n === n));\n",
  [FEW]: "import * as fc from 'fast-check';\nfc.assert(fc.property(fc.integer(), (n) => n === n), { numRuns: 1 });\n",
  [UNREACHED]: "import fc from 'fast-check';\nif (process.env.NEVER_SET_BY_ANYONE === 'yes') fc.assert(fc.property(fc.integer(), (n) => n === n));\n",
  [NONE]: "import fc from 'fast-check';\nexport const unused = fc.integer();\n",
  [SOMETIMES]: "import fc from 'fast-check';\nfc.assert(fc.property(fc.integer(), (n) => n % 5 !== 0));\n",
  [MULTIPLY_TEST]: "import { multiply } from './math.mjs';\nfor (const [a, b, p] of [[3, 4, 12], [7, 0, 0], [-2, -5, 10]]) if (multiply(a, b) !== p) throw new Error(`multiply(${a}, ${b}) is not ${p}`);\n",
  [MULTIPLY_PROPERTY]: "import fc from 'fast-check';\nimport { multiply } from './math.mjs';\nfc.assert(fc.property(fc.integer(), (a) => multiply(a, 1) === a));\n",
  [MATH]: "export function multiply() { throw new Error('multiply is not written'); }\n",
};

/** R7's `hard-coded-output`, as JavaScript: right on the acceptance test's three inputs, a sum elsewhere. */
const HARD_CODED = 'export function multiply(a, b) {\n  if (a === 3 && b === 4) return 12;\n  if (b === 0) return 0;\n  if (a === -2 && b === -5) return 10;\n  return a + b;\n}\n';
const HONEST = 'export function multiply(a, b) {\n  return a * b;\n}\n';

/** Every file above but the source the build writes, which no one locks. */
const ALL_FILES = Object.keys(PROPERTY_FILES).filter((name) => name !== MATH);
const PROPERTY_ARTIFACTS = { ...ARTIFACTS, acceptanceTests: [...ARTIFACTS.acceptanceTests, ...ALL_FILES] };

const property = (id: string, tests: readonly string[], onBase: 'fails' | 'passes', seed = 42, numRuns = 25) =>
  ({ id, kind: 'property', onBase, tests, seed, numRuns, required: true, timeoutMs: 10_000 });

/** The fixture as a vitest repository that declares fast-check 4, with both stand-ins installed and every file above written. */
async function withProperties(rig: LineRig, options: { fastCheck?: boolean } = {}): Promise<void> {
  const root = rig.dirs.artifacts;
  const declared = options.fastCheck !== false;
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hello', private: true, devDependencies: { vitest: '4.1.11', ...(declared ? { 'fast-check': '^4.3.0' } : {}) } }));
  await mkdir(join(root, 'node_modules', 'vitest'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'vitest', 'vitest.mjs'), RUNNER);
  await mkdir(join(root, 'node_modules', 'fast-check', 'lib'), { recursive: true });
  await writeFile(join(root, 'node_modules', 'fast-check', 'package.json'), JSON.stringify({ name: 'fast-check', version: '4.3.0', type: 'module', exports: { '.': { import: { default: './lib/fast-check.js' } } } }));
  await writeFile(join(root, 'node_modules', 'fast-check', 'lib', 'fast-check.js'), FAST_CHECK);
  const { hashedLockfile } = await import('@olympus-ai/adapters');
  await writeFile(join(root, 'package-lock.json'), hashedLockfile('hello', ['node_modules/fast-check', 'node_modules/vitest']));
  for (const [name, text] of Object.entries(PROPERTY_FILES)) await writeFile(join(root, name), text);
}

/**
 * The stub sandbox with the mount table's `others` honoured for the one thing
 * a property check needs: the stub runs on the host and mounts nothing, so a
 * `file:` URL to a mount's target in a command's environment is rewritten to
 * its source.
 */
async function mounting(): Promise<SandboxProvider> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  const mounts = new Map<SandboxHandle, SandboxSpec['mounts']['others']>();
  return new Proxy(inner, {
    get(target, key, receiver) {
      if (key === 'provision') {
        return async (spec: SandboxSpec) => {
          const handle = await target.provision(spec);
          mounts.set(handle, spec.mounts.others);
          return handle;
        };
      }
      if (key === 'exec') {
        return async (h: SandboxHandle, cmd: string[], options?: Parameters<SandboxProvider['exec']>[2]) => {
          if (options?.env === undefined) return target.exec(h, cmd, options);
          const env: Record<string, string> = {};
          for (const [name, value] of Object.entries(options.env)) {
            let mapped = value;
            for (const m of mounts.get(h) ?? []) mapped = mapped.split(`file://${m.target}`).join(pathToFileURL(m.source).href);
            env[name] = mapped;
          }
          return target.exec(h, cmd, { ...options, env });
        };
      }
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
}

/** The rig's stub builder, made to write `path` with `text` in its workspace before it does the rig's own work. */
async function writing(path: string, text: string, sandbox: SandboxProvider): Promise<Driver> {
  const driver = await stubDriver();
  return new Proxy(driver, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        if (req.role.role === 'builder') {
          const wrote = await sandbox.exec(req.sandbox, ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(path)}, ${JSON.stringify(text)})`]);
          if (wrote.exitCode !== 0) throw new Error(`the builder's write did not land: ${wrote.stderr}`);
        }
        return target.runTask(req);
      };
    },
  });
}

async function admissionProblems(rig: LineRig, checks: readonly unknown[]): Promise<ReadonlyArray<{ path: string; code: string }>> {
  const { startRun } = await api();
  await writeManifest(rig.dirs, checks);
  const outcome = await startRun(await rig.request(await rig.components({ sandbox: await mounting() }), { artifacts: PROPERTY_ARTIFACTS }));
  return !outcome.ok && outcome.reason === 'invalid-request' ? outcome.problems : [];
}

/** The base record of a run that crossed or stopped at `test-design`, and the result of `checkId` in it. */
async function baseResult(rig: LineRig, components: Awaited<ReturnType<LineRig['components']>>, checkId: string): Promise<CheckResult | undefined> {
  const ref = await components.vault.readBaseRun(rig.runId, null);
  if (ref === null) throw new Error('R25: the run left no base record');
  return (await readRecord<BaseRunRecord>(components.vault, ref)).checks.find((c) => c.checkId === checkId);
}

export const PROPERTY_CHECK_NEEDS_THE_SLOT: LocalAssertion = runtime({
  id: 'I5.property-check-needs-an-adapter-slot',
  title:
    "a manifest that pins a property check over a base whose adapter set has no property slot is refused at admission, naming the check's kind; the same check over a base that declares fast-check 4 beside vitest 4 is admitted and runs",
  run: async () => {
    await withLine('r25-slot-', async (rig) => {
      await withProperties(rig, { fastCheck: false });
      const problems = await admissionProblems(rig, [COMPILES, property('hello-property', [HELLO_PROPERTY], 'fails')]);
      if (!problems.some((p) => p.path === 'manifest.checks[1].kind' && p.code === 'unbound')) {
        throw new Error(`R25: a property check on a set with no slot was not refused at admission: ${JSON.stringify(problems)}`);
      }
    });
    await withLine('r25-slot-control-', async (rig) => {
      await withProperties(rig);
      const { startRun } = await api();
      await writeManifest(rig.dirs, [COMPILES, property('hello-property', [HELLO_PROPERTY], 'fails')]);
      const sandbox = await mounting();
      const components = await rig.components({ sandbox });
      const outcome = await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS }));
      const refusal = refusalOf(outcome, 'R25 slot control');
      if (refusal.at !== 'integrate' || refusal.state?.tasks[HELLO_TASK] !== 'passed') {
        throw new Error(`R25 control: a property check on a set with the slot did not carry the run to integrate: stopped at ${refusal.at} with ${JSON.stringify(refusal.transition)}`);
      }
    });
  },
});

export const PROPERTY_FILE_MUST_REGISTER: LocalAssertion = runtime({
  id: 'I5.property-file-must-register-a-property',
  title: 'a locked property file that registers no property with the framework is refused at admission, naming the file, before any check runs',
  run: async () => {
    await withLine('r25-none-', async (rig) => {
      await withProperties(rig);
      const problems = await admissionProblems(rig, [COMPILES, property('none', [NONE], 'passes'), property('hello-property', [HELLO_PROPERTY], 'fails')]);
      if (!problems.some((p) => p.path === 'manifest.checks[1].tests[0]' && p.code === 'no-property')) {
        throw new Error(`R25: a property file that registers nothing was not refused at admission: ${JSON.stringify(problems)}`);
      }
      if (problems.some((p) => p.path.startsWith('manifest.checks[2]'))) throw new Error(`R25: a file that registers a property was refused beside one that does not: ${JSON.stringify(problems)}`);
    });
  },
});

export const PROPERTY_CHECK_RUNS_EVERY_PINNED_CASE: LocalAssertion = runtime({
  id: 'I5.property-check-runs-every-pinned-case',
  title:
    "a property check whose file sets fewer cases than the manifest pins, or never reaches its registered property, does not do what it declared and refuses the test-design exit; the runtime's comparison names the short count and the registration that never reported; the same check over a file that runs every pinned case crosses",
  run: async () => {
    const { startRun } = await api();
    for (const [file, field] of [[FEW, `${FEW}:2.casesRun`], [UNREACHED, `${UNREACHED}:2`]] as const) {
      await withLine('r25-cases-', async (rig) => {
        await withProperties(rig);
        await writeManifest(rig.dirs, [COMPILES, property('short', [file], 'passes'), property('hello-property', [HELLO_PROPERTY], 'fails')]);
        const components = await rig.components({ sandbox: await mounting() });
        const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS })), `R25 ${file}`);
        if (refusal.at !== 'test-design' || refusal.transition.reason !== 'base-mismatch' || !refusal.transition.mismatched.some((m) => m.checkId === 'short' && m.cause === 'suite-count')) {
          throw new Error(`R25: ${file} was not refused at the test-design exit for running short: ${refusal.at} ${JSON.stringify(refusal.transition)}`);
        }
        const result = await baseResult(rig, components, 'short');
        const named = result?.expectation?.held === false && result.expectation.mismatches.some((m) => m.field === field);
        if (!named) throw new Error(`R25: the comparison for ${file} did not name ${field}: ${JSON.stringify(result?.expectation)}`);
      });
    }
    await withLine('r25-cases-control-', async (rig) => {
      await withProperties(rig);
      await writeManifest(rig.dirs, [COMPILES, property('holds', [HOLDS], 'passes'), property('hello-property', [HELLO_PROPERTY], 'fails')]);
      const components = await rig.components({ sandbox: await mounting() });
      const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS })), 'R25 cases control');
      if (refusal.at !== 'integrate') throw new Error(`R25 control: a property file that runs every pinned case stopped at ${refusal.at}: ${JSON.stringify(refusal.transition)}`);
      const result = await baseResult(rig, components, 'holds');
      if (result?.property?.runs.length !== 1 || result.property.runs[0]?.casesRun !== 25) throw new Error(`R25 control: the evidence did not record 25 cases: ${JSON.stringify(result?.property)}`);
    });
  },
});

export const PROPERTY_SEED_REPRODUCES: LocalAssertion = runtime({
  id: 'I2.property-seed-reproduces-the-verdict',
  title:
    "a property check's evidence records the seed the manifest pinned, the cases run, and the counterexample; two runs on the same seed reach the same verdict on the same counterexample, and a run on another seed records that seed",
  run: async () => {
    const { startRun } = await api();
    const evidence = async (prefix: string, seed: number) =>
      withLine(prefix, async (rig) => {
        await withProperties(rig);
        await writeManifest(rig.dirs, [COMPILES, property('sometimes', [SOMETIMES], 'fails', seed), property('hello-property', [HELLO_PROPERTY], 'fails')]);
        const components = await rig.components({ sandbox: await mounting() });
        refusalOf(await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS })), `R25 seed ${String(seed)}`);
        const result = await baseResult(rig, components, 'sometimes');
        const run = result?.property?.runs[0];
        if (result?.property?.seed !== seed || run?.seed !== seed || !run.failed || run.counterexample === null) {
          throw new Error(`R25: seed ${String(seed)} left evidence ${JSON.stringify(result?.property)}`);
        }
        return { held: result.expectation?.held, run };
      });
    const first = await evidence('r25-seed-a-', 7);
    const again = await evidence('r25-seed-b-', 7);
    if (JSON.stringify(first) !== JSON.stringify(again)) throw new Error(`R25: the same seed reached ${JSON.stringify(first)} and then ${JSON.stringify(again)}`);
    const other = await evidence('r25-seed-c-', 8);
    if (other.run.seed !== 8) throw new Error('R25: a run on another seed did not record it');
  },
});

export const PROPERTY_EDIT_IS_LOCK_TAMPER: LocalAssertion = runtime({
  id: 'I3.property-check-edited-after-test-design-is-lock-tamper',
  title: 'a builder that rewrites a locked property file so that it holds on any tree is refused as lock-tamper, and the rewrite never judges the change',
  run: async () => {
    const { startRun } = await api();
    await withLine('r25-tamper-', async (rig) => {
      await withProperties(rig);
      await writeManifest(rig.dirs, [COMPILES, property('hello-property', [HELLO_PROPERTY], 'fails')]);
      const sandbox = await mounting();
      const driver = await writing(HELLO_PROPERTY, PROPERTY_FILES[HOLDS] ?? '', sandbox);
      const components = await rig.components({ sandbox, driver, reviewer: driver });
      const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS })), 'R25 tamper');
      const tampered = refusal.transition.reason === 'lock-tamper' ? refusal.transition.tampered.map((t) => t.path) : [];
      if (!tampered.includes(HELLO_PROPERTY)) throw new Error(`R25: a rewritten property file was refused as ${JSON.stringify(refusal.transition)}, not lock-tamper naming it`);
      if ((refusal.state?.evidenceRefs.length ?? 0) !== 0) throw new Error('R25: the rewritten property file judged the change: evidence was written');
    });
  },
});

export const PROPERTY_CATCHES_HARD_CODED_OUTPUT: LocalAssertion = runtime({
  id: 'I5.property-check-catches-hard-coded-output',
  title:
    "R7's hard-coded-output, a multiply right on the acceptance test's three inputs and a sum elsewhere, passes its acceptance check and fails the property check at verify, the comparison naming the failed property; an honest multiply passes both",
  run: async () => {
    const { startRun } = await api();
    const acceptance = { id: 'multiply', kind: 'acceptance', onBase: 'fails', tests: [MULTIPLY_TEST], required: true, timeoutMs: 10_000 };
    const run = async (prefix: string, text: string) =>
      withLine(prefix, async (rig) => {
        await withProperties(rig);
        await writeManifest(rig.dirs, [COMPILES, acceptance, property('multiply-property', [MULTIPLY_PROPERTY], 'fails')]);
        const sandbox = await mounting();
        const driver = await writing(MATH, text, sandbox);
        const components = await rig.components({ sandbox, driver, reviewer: driver });
        const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS })), prefix);
        const bundles = await Promise.all((refusal.state?.evidenceRefs ?? []).map((r) => readRecord<EvidenceBundle>(components.vault, r)));
        const last = bundles.at(-1);
        return { refusal, accepted: last?.checks.find((c) => c.checkId === 'multiply'), judged: last?.checks.find((c) => c.checkId === 'multiply-property') };
      });
    const hard = await run('r25-hard-', HARD_CODED);
    if (hard.accepted?.exitCode !== 0) throw new Error(`R25: the hard-coded multiply did not pass its acceptance check, so the item is not R7's miss: ${JSON.stringify({ accepted: hard.accepted, at: hard.refusal.at, transition: hard.refusal.transition })}`);
    const failed = hard.judged?.expectation?.held === false && hard.judged.expectation.mismatches.some((m) => m.field === `${MULTIPLY_PROPERTY}:3.failed`);
    if (!failed || hard.refusal.state?.tasks[HELLO_TASK] !== 'parked') {
      throw new Error(`R25: the property check did not catch the hard-coded multiply: ${JSON.stringify({ judged: hard.judged?.expectation, task: hard.refusal.state?.tasks[HELLO_TASK] })}`);
    }
    const honest = await run('r25-honest-', HONEST);
    if (honest.refusal.at !== 'integrate' || honest.judged?.expectation?.held !== true) {
      throw new Error(`R25 control: an honest multiply did not pass the property check: ${honest.refusal.at} ${JSON.stringify(honest.judged?.expectation)}`);
    }
  },
});

export const POLICY_REQUIRES_A_PROPERTY_PER_RULE: LocalAssertion = runtime({
  id: 'I5.policy-requires-a-property-check-per-authorization-rule',
  title:
    "under a policy that sets propertyPerAuthorizationRule, an authorization rule with its denial check and no required property check naming it refuses the test-design exit, naming the rule, before the base runs; a required property check naming it in deniesRule lets the run cross; a property check never stands in for the denial check",
  run: async () => {
    const { startRun } = await api();
    const policy = await linePolicy({}, { propertyPerAuthorizationRule: true });
    const denies = { id: 'stranger-refused', kind: 'behavioral', onBase: 'passes', deniesRule: 'owner-only', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };
    const states = { ...property('owner-property', [HOLDS], 'passes'), deniesRule: 'owner-only' };
    const attempt = async (prefix: string, checks: readonly unknown[]) =>
      withLine(prefix, async (rig) => {
        await withProperties(rig);
        await writeFile(join(rig.dirs.artifacts, 'security.json'), JSON.stringify(ONE_RULE));
        await writeManifest(rig.dirs, [COMPILES, property('hello-property', [HELLO_PROPERTY], 'fails'), ...checks]);
        const components = await rig.components({ sandbox: await mounting() });
        const refusal = refusalOf(await startRun(await rig.request(components, { artifacts: PROPERTY_ARTIFACTS, policy })), prefix);
        return { refusal, base: await components.vault.readBaseRun(rig.runId, null) };
      });
    const unstated = await attempt('r25-rule-', [denies]);
    if (unstated.refusal.at !== 'test-design' || unstated.refusal.transition.reason !== 'denial-check-missing' || unstated.refusal.transition.rules.join() !== 'owner-only' || !unstated.refusal.transition.message.includes('property')) {
      throw new Error(`R25: a rule with no property check under the policy was ${JSON.stringify(unstated.refusal.transition)} at ${unstated.refusal.at}`);
    }
    if (unstated.base !== null) throw new Error('R25: the base ran before the rule with no property check refused the exit');
    const alone = await attempt('r25-rule-alone-', [states]);
    if (alone.refusal.transition.reason !== 'denial-check-missing' || alone.refusal.transition.message.includes('property')) {
      throw new Error(`R25: a property check stood in for the denial check: ${JSON.stringify(alone.refusal.transition)}`);
    }
    const both = await attempt('r25-rule-control-', [denies, states]);
    if (both.refusal.at !== 'integrate') throw new Error(`R25 control: a rule with both checks stopped at ${both.refusal.at}: ${JSON.stringify(both.refusal.transition)}`);
  },
});

export const R25_ASSERTIONS = {
  I2: [PROPERTY_SEED_REPRODUCES],
  I3: [PROPERTY_EDIT_IS_LOCK_TAMPER],
  I5: [PROPERTY_CHECK_NEEDS_THE_SLOT, PROPERTY_FILE_MUST_REGISTER, PROPERTY_CHECK_RUNS_EVERY_PINNED_CASE, PROPERTY_CATCHES_HARD_CODED_OUTPUT, POLICY_REQUIRES_A_PROPERTY_PER_RULE],
} as const;
