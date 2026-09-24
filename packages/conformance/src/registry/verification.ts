/**
 * The runtime assertions P6 owes: verification over runtime-owned trees, the
 * evidence it records, and the refusals around it. Each is registered under
 * the invariant it protects (i2.ts through i6.ts); they live together because
 * they share the line rig in `line.ts`.
 *
 * Where a refusal is required, the assertion also runs the control: the same
 * run with the one thing removed that should cause it, so no assertion passes
 * on a line that refuses everything. The two that observe a container need a
 * Docker daemon and fail without one, for the reason `local-sandbox.ts` gives.
 */
import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentGraph, RunOutcome } from '@olympus-ai/api';
import type { RoleId, RunState, TaskId, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { AdmissionRecord, EvidenceBundle, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_REVIEW, HELLO_TASK, linePolicy, lineScope, readArtifact, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';
import { TEST_IMAGE, withProvider } from './local-sandbox.js';

const api = async () => import('@olympus-ai/api');

const PASSING = { id: 'passes', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 };
const FAILING = { ...PASSING, id: 'fails', command: ['node', '-e', 'process.exit(1)'] };

/** Runs a Node script in the task's own workspace, through the sandbox the line provisioned for it. */
async function inTask(sandbox: SandboxProvider, req: TaskRequest, script: string): Promise<string> {
  const result = await sandbox.exec(req.sandbox, ['node', '-e', script]);
  if (result.exitCode !== 0) throw new Error(`a script in task ${req.taskId} exited ${String(result.exitCode)}: ${result.stderr}`);
  return result.stdout;
}

function writes(files: Record<string, string>): string {
  return [
    "const fs = require('node:fs'); const path = require('node:path');",
    ...Object.entries(files).map(
      ([file, text]) => `fs.mkdirSync(path.dirname(${JSON.stringify(file)}), { recursive: true }); fs.writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(text)});`,
    ),
  ].join(' ');
}

/** A Vault that forwards everything and keeps each violation it is asked to record. */
function recording(inner: Vault, violations: IntegrityViolation[]): Vault {
  return {
    read: (ref) => inner.read(ref),
    lock: (runId, paths, by) => inner.lock(runId, paths, by),
    verifyLocks: (runId) => inner.verifyLocks(runId),
    writeEvidence: (b) => inner.writeEvidence(b),
    recordViolation: (v) => {
      violations.push(v);
      return inner.recordViolation(v);
    },
    recordAdmission: (a) => inner.recordAdmission(a),
    recordTaskResult: (runId, r) => inner.recordTaskResult(runId, r),
    readRunState: (runId) => inner.readRunState(runId),
    commitRunState: (s, ifVersion) => inner.commitRunState(s, ifVersion),
  };
}

async function bundles(vault: Vault, state: RunState): Promise<EvidenceBundle[]> {
  return Promise.all(state.evidenceRefs.map((ref) => readRecord<EvidenceBundle>(vault, ref)));
}

function statusOf(state: RunState, task: TaskId): string | undefined {
  return Object.hasOwn(state.tasks, task) ? state.tasks[task] : undefined;
}

/** A run of the hello fixture with the given driver behaviour, returning what it left. */
async function runHello(
  rig: LineRig,
  options: { during?: (sandbox: SandboxProvider, req: TaskRequest) => Promise<void>; claim?: readonly string[]; overrides?: Partial<ComponentGraph> } = {},
): Promise<{ outcome: RunOutcome; state: RunState; vault: Vault; violations: IntegrityViolation[] }> {
  const { startRun } = await api();
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const sandbox = new StubSandboxProvider();
  const during = options.during;
  const driver = await stubDriver(during === undefined ? {} : { during: (req) => (req.taskId === HELLO_TASK ? during(sandbox, req) : Promise.resolve()) });
  const claimed = options.claim;
  const author = claimed === undefined ? driver : {
    ...driver,
    runTask: async (req: TaskRequest): Promise<TaskResult> => {
      const result = await driver.runTask(req);
      return { ...result, claim: { narrative: 'every test passes', filesChanged: [...claimed] } };
    },
  };
  const violations: IntegrityViolation[] = [];
  const base = await rig.components({ sandbox, driver: author, reviewer: driver, ...options.overrides });
  const vault = recording(base.vault, violations);
  const outcome = await startRun(await rig.request({ ...base, vault }));
  return { outcome, state: await rig.state(), vault, violations };
}

export const STATUS_DERIVED_FROM_CHECK_RESULTS: LocalAssertion = runtime({
  id: 'I2.status-derived-from-check-results',
  title:
    "a driver that runs a passing command and claims every test passes, while the pinned required check fails, leaves its task failed, not passed; with the check passing the same task passes; the claim's file list is diffed against the runtime's diff, the difference is in the bundle and recorded as a claim-mismatch violation, and that violation does not halt the run",
  run: async () => {
    const passingCommand = async (sandbox: SandboxProvider, req: TaskRequest): Promise<void> => {
      await inTask(sandbox, req, 'process.exit(0)');
    };
    await withLine('p6-i2-status-', async (rig) => {
      await writeManifest(rig.dirs, [FAILING]);
      const { state, vault } = await runHello(rig, { during: passingCommand, claim: [] });
      if (statusOf(state, HELLO_TASK) === 'passed') throw new Error('I2: a task whose required check failed was marked passed on the strength of its claim');
      const all = await bundles(vault, state);
      if (all.length === 0 || all.some((b) => b.checks[0]?.exitCode !== 1)) {
        throw new Error('I2: the evidence does not hold the failing check the verdict followed');
      }
    });
    await withLine('p6-i2-status-control-', async (rig) => {
      await writeManifest(rig.dirs, [PASSING]);
      const { state, vault, violations } = await runHello(rig, { claim: ['src/claimed.ts'] });
      if (statusOf(state, HELLO_TASK) !== 'passed') throw new Error('I2 control: a task whose required check passed was not marked passed');
      const [bundle] = await bundles(vault, state);
      if (bundle?.claimEvidenceDiff.join('\n') !== 'claimed but not in the diff: src/claimed.ts') {
        throw new Error(`I2: the claim/evidence diff is ${JSON.stringify(bundle?.claimEvidenceDiff)}, not the one claimed file the diff lacks`);
      }
      if (!violations.some((v) => v.kind === 'claim-mismatch' && v.taskId === HELLO_TASK)) {
        throw new Error('I2: a claim that differs from the evidence was not recorded as a claim-mismatch violation');
      }
      if (state.violations.length > 0) throw new Error('I2: a claim mismatch halted the run, so the claim decided the outcome (D-P6-03)');
    });
  },
});

export const UNSTARTED_CHECK_IS_IN_THE_EVIDENCE: LocalAssertion = runtime({
  id: 'I2.unstarted-check-is-in-the-evidence',
  title:
    'a required check whose program cannot be started fails the gate, and the evidence bundle records it in `unstarted` with the reason and invents no exit code for it; the same check with a program that exists leaves `unstarted` empty',
  run: async () => {
    await withLine('p6-i2-unstarted-', async (rig) => {
      await writeManifest(rig.dirs, [{ ...PASSING, id: 'cannot-start', command: ['no-such-program-p6', '--version'] }]);
      const { state, vault } = await runHello(rig);
      if (statusOf(state, HELLO_TASK) === 'passed') throw new Error('I2: a required check that never started did not fail the gate');
      const [bundle] = await bundles(vault, state);
      const entry = bundle?.unstarted.find((u) => u.checkId === 'cannot-start');
      if (entry === undefined || entry.reason.trim() === '') throw new Error('I2: the bundle does not record the check that could not start, with a reason');
      if (bundle?.checks.some((c) => c.checkId === 'cannot-start')) throw new Error('I2: a check that never started has a result in the bundle');
    });
    await withLine('p6-i2-unstarted-control-', async (rig) => {
      await writeManifest(rig.dirs, [PASSING]);
      const { state, vault } = await runHello(rig);
      const [bundle] = await bundles(vault, state);
      if (bundle === undefined || bundle.unstarted.length > 0) throw new Error('I2 control: a check that ran is recorded as unstarted');
    });
  },
});

export const TASK_RESULT_KEY_SET_ENFORCED: LocalAssertion = runtime({
  id: 'I2.task-result-key-set-enforced',
  title:
    "a driver result carrying a key the TaskResult contract does not name — `status`, built after the fact the way a cast or JavaScript would — is refused where the line receives it, at build and at review alike, naming the key, and is never recorded; the same result without it is recorded",
  run: async () => {
    await withLine('p6-i2-keys-', async (rig) => {
      const { startRun } = await api();
      const inner = await stubDriver();
      const lying = {
        ...inner,
        runTask: async (req: TaskRequest): Promise<TaskResult> => {
          const result: TaskResult = await inner.runTask(req);
          const widened: Record<string, unknown> = { ...result, status: 'passed' };
          return widened as unknown as TaskResult;
        },
      };
      let message = '';
      try {
        await startRun(await rig.request(await rig.components({ driver: lying, reviewer: inner })));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      if (!message.includes('result.status')) throw new Error(`I2: a result carrying status was not refused naming it (got: ${message || 'no refusal'})`);
      const state = await rig.state();
      if (Object.hasOwn(state.results, HELLO_TASK)) throw new Error('I2: a result carrying status was recorded');
    });
    // The line receives a result at review too (codex-6), and the same boundary holds there.
    await withLine('p6-i2-keys-review-', async (rig) => {
      const { startRun } = await api();
      const inner = await stubDriver();
      const lying = {
        ...inner,
        runTask: async (req: TaskRequest): Promise<TaskResult> => {
          const result: TaskResult = await inner.runTask(req);
          const widened: Record<string, unknown> = { ...result, status: 'passed' };
          return widened as unknown as TaskResult;
        },
      };
      let message = '';
      try {
        await startRun(await rig.request(await rig.components({ driver: inner, reviewer: lying })));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      if (!message.includes('result.status')) throw new Error(`I2: a review result carrying status was not refused naming it (got: ${message || 'no refusal'})`);
      if (Object.hasOwn((await rig.state()).results, HELLO_REVIEW)) throw new Error('I2: a review result carrying status was recorded');
    });
    await withLine('p6-i2-keys-control-', async (rig) => {
      const { startRun } = await api();
      await startRun(await rig.request(await rig.components()));
      if (!Object.hasOwn((await rig.state()).results, HELLO_TASK)) throw new Error('I2 control: a result with exactly the contract keys was not recorded');
    });
  },
});

export const LOCKED_PATH_IN_DIFF_IS_TAMPER: LocalAssertion = runtime({
  id: 'I3.locked-path-in-diff-is-tamper',
  title:
    "an agent that rewrites a locked artifact inside its own workspace copy — which the Vault's lock check no longer sees, because the copy is not the tree the locks resolve against — is caught in the runtime's diff: the run records a lock-tamper violation naming the path, and no evidence is written",
  run: async () => {
    await withLine('p6-i3-diff-', async (rig) => {
      const original = await readArtifact(rig.dirs, 'spec.md');
      const rewrite = async (sandbox: SandboxProvider, req: TaskRequest): Promise<void> => {
        await inTask(sandbox, req, writes({ 'spec.md': '# hello\n\nThe capability, quietly widened in the copy.\n' }));
      };
      const { outcome, state, vault } = await runHello(rig, { during: rewrite });
      if ((await readArtifact(rig.dirs, 'spec.md')) !== original) throw new Error('I3: the rewrite reached the admitted workspace; this assertion is about the copy');
      const refusal = refusalOf(outcome, 'I3');
      if (refusal.transition.reason !== 'lock-tamper') throw new Error(`I3: a locked path in the diff was refused as ${refusal.transition.reason}, not lock-tamper`);
      if (!refusal.transition.tampered.some((t) => t.path === 'spec.md')) throw new Error('I3: the tamper does not name spec.md');
      const [ref] = state.violations;
      if (ref === undefined) throw new Error('I3: no violation recorded');
      const violation = await readRecord<IntegrityViolation>(vault, ref);
      if (violation.kind !== 'lock-tamper' || violation.detail.phase !== 'diff') throw new Error('I3: the violation is not a lock-tamper found in the diff');
      if (state.evidenceRefs.length > 0) throw new Error('I3: evidence was written over a diff that touched a locked artifact');
    });
  },
});

export const WRITABLE_GLOBS_ENFORCED_ON_THE_DIFF: LocalAssertion = runtime({
  id: 'I4.writable-globs-enforced-on-the-diff',
  title:
    "a build task whose role may write `src/**` and which also writes `notes.md` is refused from the runtime's diff before any check runs: the run records a capability-escape violation naming notes.md and not the granted path, and writes no evidence; the same task writing only `src/ok.ts` passes",
  run: async () => {
    const narrowed = async () =>
      linePolicy({}, {
        roles: { ['builder' as RoleId]: lineScope(['build', 'verify'], 'standard', ['src/**']), ['reviewer' as RoleId]: lineScope(['review'], 'deep') },
      });
    await withLine('p6-i4-globs-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      const driver = await stubDriver({ during: (req) => inTask(sandbox, req, writes({ 'src/ok.ts': 'ok', 'notes.md': 'outside' })).then(() => undefined) });
      const components = await rig.components({ sandbox, driver, reviewer: driver });
      const outcome = await startRun(await rig.request(components, { policy: await narrowed() }));
      const refusal = refusalOf(outcome, 'I4');
      if (refusal.transition.reason !== 'violation') throw new Error(`I4: a write outside the grant was refused as ${refusal.transition.reason}, not as a violation`);
      const state = await rig.state();
      const [ref] = state.violations;
      if (ref === undefined) throw new Error('I4: no violation recorded');
      const violation = await readRecord<IntegrityViolation>(components.vault, ref);
      const outside = violation.detail.outsideGrant;
      if (violation.kind !== 'capability-escape' || JSON.stringify(outside) !== JSON.stringify(['notes.md'])) {
        throw new Error(`I4: the violation is ${violation.kind} naming ${JSON.stringify(outside)}, not a capability-escape naming notes.md alone`);
      }
      if (state.evidenceRefs.length > 0) throw new Error('I4: checks ran over a diff that left the grant');
    });
    await withLine('p6-i4-globs-control-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      const driver = await stubDriver({ during: (req) => inTask(sandbox, req, writes({ 'src/ok.ts': 'ok' })).then(() => undefined) });
      await startRun(await rig.request(await rig.components({ sandbox, driver, reviewer: driver }), { policy: await narrowed() }));
      if (statusOf(await rig.state(), HELLO_TASK) !== 'passed') throw new Error('I4 control: a write inside the grant did not pass');
    });
  },
});

export const MISSING_CHECK_OR_SHRUNKEN_SUITE_REFUSES: LocalAssertion = runtime({
  id: 'I5.missing-check-or-shrunken-suite-refuses',
  title:
    "a task that deletes one of two test files fails a check pinning two suites, the count taken by the adapters over the verified tree on the host and recorded as one; a required check with no result fails the gate; with neither, the same task passes and records two",
  run: async () => {
    const suites = async (rig: LineRig): Promise<void> => {
      await writeFile(join(rig.dirs.artifacts, 'package.json'), JSON.stringify({ name: 'p6', devDependencies: { vitest: '4.1.11' } }));
      await writeFile(join(rig.dirs.artifacts, 'a.test.ts'), "test('a', () => {})\n");
      await writeFile(join(rig.dirs.artifacts, 'b.test.ts'), "test('b', () => {})\n");
      await writeManifest(rig.dirs, [{ ...PASSING, expectedSuiteCount: 2 }]);
    };
    await withLine('p6-i5-shrink-', async (rig) => {
      await suites(rig);
      const remove = async (sandbox: SandboxProvider, req: TaskRequest): Promise<void> => {
        await inTask(sandbox, req, "require('node:fs').rmSync('b.test.ts')");
      };
      const { state, vault } = await runHello(rig, { during: remove });
      if (statusOf(state, HELLO_TASK) === 'passed') throw new Error('I5: a task that shrank the suite passed a check pinning its size');
      const [bundle] = await bundles(vault, state);
      if (bundle?.checks[0]?.suiteCount !== 1) throw new Error(`I5: the recorded suite count is ${String(bundle?.checks[0]?.suiteCount)}, not the one suite left`);
    });
    await withLine('p6-i5-missing-', async (rig) => {
      await writeManifest(rig.dirs, [PASSING, { ...PASSING, id: 'absent', command: ['no-such-program-p6'] }]);
      const { state } = await runHello(rig);
      if (statusOf(state, HELLO_TASK) === 'passed') throw new Error('I5: a required check with no result did not fail the gate');
    });
    await withLine('p6-i5-shrink-control-', async (rig) => {
      await suites(rig);
      const { state, vault } = await runHello(rig);
      if (statusOf(state, HELLO_TASK) !== 'passed') throw new Error('I5 control: a task that kept both suites did not pass');
      const [bundle] = await bundles(vault, state);
      if (bundle?.checks[0]?.suiteCount !== 2) throw new Error('I5 control: the suite count was not recorded as two');
    });
  },
});

export const CHECK_COMMAND_HAS_A_GRAMMAR: LocalAssertion = runtime({
  id: 'I5.check-command-has-a-grammar',
  title:
    'a pinned command is an argument vector: a string, an empty vector, a blank program, and a non-string argument are each refused at admission naming the field; an argument containing a space reaches the process as one argument, where splitting it would fail the check',
  run: async () => {
    const { parseManifest } = await api();
    const refused: Array<[unknown, string, string]> = [
      ['node -e process.exit(0)', 'manifest.checks[0].command', 'not-argv'],
      [[], 'manifest.checks[0].command', 'empty'],
      [['  '], 'manifest.checks[0].command[0]', 'empty'],
      [['node', 7], 'manifest.checks[0].command[1]', 'not-argv'],
    ];
    for (const [command, path, code] of refused) {
      const parsed = parseManifest({ checks: [{ ...PASSING, command }] });
      if (parsed.ok || !parsed.problems.some((p) => p.path === path && p.code === code)) {
        throw new Error(`I5: the command ${JSON.stringify(command)} was not refused as ${code} at ${path}`);
      }
    }
    const script = "process.exit(process.argv[1] === 'a b' ? 0 : 1)";
    await withLine('p6-i5-argv-', async (rig) => {
      await writeManifest(rig.dirs, [{ ...PASSING, command: ['node', '-e', script, 'a b'] }]);
      const { state } = await runHello(rig);
      if (statusOf(state, HELLO_TASK) !== 'passed') throw new Error('I5: an argument containing a space did not reach the process as one argument');
    });
    await withLine('p6-i5-argv-control-', async (rig) => {
      await writeManifest(rig.dirs, [{ ...PASSING, command: ['node', '-e', script, 'a', 'b'] }]);
      const { state } = await runHello(rig);
      if (statusOf(state, HELLO_TASK) === 'passed') throw new Error('I5 control: the check passes whatever its arguments, so it proves nothing');
    });
  },
});

export const ADAPTER_REFUSAL_ENFORCED_AT_ADMISSION: LocalAssertion = runtime({
  id: 'I5.adapter-refusal-enforced-at-admission',
  title:
    "admission records the adapter set's unavailable controls in the admission record, mutation and HTTP and browser behavioral among them; the admission refusal reads them from that record and refuses L3 naming each one, refuses nothing at L0-L2, and refuses nothing at L3 when the record names none",
  run: async () => {
    await withLine('p6-i5-admission-', async (rig) => {
      const { startRun, admissionRefusal } = await api();
      const components = await rig.components();
      await startRun(await rig.request(components));
      const state = await rig.state();
      const record = await readRecord<AdmissionRecord>(components.vault, state.admission);
      for (const control of ['mutation', 'behavioral:http', 'behavioral:browser', 'test']) {
        if (!record.unavailableControls.includes(control)) throw new Error(`I5: the admission record does not name ${control} as unavailable`);
      }
      const at = (level: 0 | 1 | 2 | 3, controls: readonly string[]): AdmissionRecord => ({ ...record, run: { ...record.run, requestedLevel: level }, unavailableControls: controls });
      const refused = admissionRefusal(at(3, record.unavailableControls));
      if (refused?.unavailable.join(',') !== record.unavailableControls.join(',')) {
        throw new Error('I5: an L3 admission with unavailable controls was not refused naming each one');
      }
      for (const level of [0, 1, 2] as const) {
        if (admissionRefusal(at(level, record.unavailableControls)) !== undefined) throw new Error(`I5: the admission refusal refused L${String(level)}`);
      }
      if (admissionRefusal(at(3, [])) !== undefined) throw new Error('I5 control: L3 was refused with every control available');
    });
  },
});

export const REVIEW_SEAT_READS_ONLY_ITS_GRANTS: LocalAssertion = runtime({
  id: 'I6.review-seat-reads-only-its-grants',
  title:
    "the review seat's workspace holds the locked spec, the acceptance tests, and the files the diff changed, and nothing else: a reviewer that opens the admitted task graph, the verification manifest, and a file the author wrote under .git — outside the diff — finds none of them, and finds the file the author's diff did change",
  run: async () => {
    await withLine('p6-i6-view-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      const probe = ['graph.json', 'verify.json', '.git/author-notes', 'spec.md', 'acceptance.md', 'src/change.ts'];
      const look = `const fs = require('node:fs'); console.log(JSON.stringify(${JSON.stringify(probe)}.map((p) => fs.existsSync(p))));`;
      const seen: Record<string, boolean[]> = {};
      const driver = await stubDriver({
        during: async (req) => {
          if (req.taskId === HELLO_TASK) {
            await inTask(sandbox, req, writes({ 'src/change.ts': 'changed', '.git/author-notes': 'the plan, as the author sees it' }));
            seen.author = JSON.parse(await inTask(sandbox, req, look)) as boolean[];
          } else {
            seen.reviewer = JSON.parse(await inTask(sandbox, req, look)) as boolean[];
          }
        },
      });
      await startRun(await rig.request(await rig.components({ sandbox, driver, reviewer: driver })));
      const author = seen.author ?? [];
      const reviewer = seen.reviewer;
      if (author.join(',') !== 'true,true,true,true,true,true') throw new Error(`I6 control: the author's own workspace does not hold every probed file (${author.join(',')})`);
      if (reviewer === undefined) throw new Error('I6: the reviewer never ran');
      const expected = [false, false, false, true, true, true];
      if (reviewer.join(',') !== expected.join(',')) {
        const got = probe.map((p, i) => `${p}=${String(reviewer[i])}`).join(', ');
        throw new Error(`I6: the review seat's workspace holds the wrong files: ${got}`);
      }
    });
  },
});

/** The line's provisioning, with an image and limits a real daemon accepts; the line does not choose either before I1. */
function onImage(provider: SandboxProvider): SandboxProvider {
  return {
    id: provider.id,
    capabilities: () => provider.capabilities(),
    provision: (spec: SandboxSpec) => provider.provision({ ...spec, image: TEST_IMAGE, limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 120_000 } }),
    exec: (h, cmd, options) => provider.exec(h, cmd, options),
    destroy: (h) => provider.destroy(h),
  };
}

export const TASK_CAPABILITIES_DO_NOT_OUTLIVE_THE_TASK: LocalAssertion = runtime({
  id: 'I4.task-capabilities-do-not-outlive-the-task',
  title:
    'a build task that leaves a process writing to its workspace does not reach the next task: in real containers, the second task finds no such process and a file that stops growing, and the first task\'s own copy stops changing once its sandbox is gone',
  run: async () => {
    await withProvider('p6-i4-outlive-', async (docker) => {
      await withLine('p6-i4-outlive-line-', async (rig) => {
        const { startRun } = await api();
        const sandbox = onImage(docker);
        const second = 'second' as TaskId;
        await writeFile(
          join(rig.dirs.artifacts, 'graph.json'),
          JSON.stringify({
            tasks: [
              { id: HELLO_TASK, station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] },
              { id: second, station: 'build', role: 'builder', dependsOn: [HELLO_TASK], dependencySet: ['**'] },
              { id: 'hello-review', station: 'review', role: 'reviewer', dependsOn: [HELLO_TASK, second], dependencySet: ['**'] },
            ],
          }),
        );
        await writeManifest(rig.dirs, [{ ...PASSING, command: ['sh', '-c', 'exit 0'] }]);
        const observed: { process?: string; sizes?: [string, string] } = {};
        const sh = (req: TaskRequest, script: string) => docker.exec(req.sandbox, ['sh', '-c', script]);
        const driver = await stubDriver({
          during: async (req) => {
            if (req.taskId === HELLO_TASK) {
              await sh(req, 'echo first > /workspace/leak.txt; (while :; do echo p6-leak-tick >> /workspace/leak.txt; sleep 0.2; done) > /dev/null 2>&1 &');
              await sh(req, 'sleep 1');
            } else if (req.taskId === second) {
              observed.process = (await sh(req, 'ps -o args 2>/dev/null || ps')).stdout;
              const before = (await sh(req, 'wc -c < /workspace/leak.txt')).stdout.trim();
              await sh(req, 'sleep 1');
              const after = (await sh(req, 'wc -c < /workspace/leak.txt')).stdout.trim();
              observed.sizes = [before, after];
            }
          },
        });
        await startRun(await rig.request(await rig.components({ sandbox, driver, reviewer: driver })));
        const state = await rig.state();
        if (!Object.hasOwn(state.results, second)) throw new Error('I4: the second task never ran');
        if (observed.process === undefined || observed.sizes === undefined) throw new Error('I4: the second task did not observe its workspace');
        if (observed.process.includes('p6-leak-tick')) throw new Error("I4: the first task's process was running during the second task");
        const [before, after] = observed.sizes;
        if (before === '' || before !== after) throw new Error(`I4: the leaked file changed during the second task (${before} bytes, then ${after})`);
      });
    });
  },
});

export const WORKSPACE_IS_WRITABLE_BY_THE_TASK: LocalAssertion = runtime({
  id: 'I5.workspace-is-writable-by-the-task',
  title:
    'a rw workspace owned by one user and handed to a container running as another is refused at provisioning, naming the user, on a host whose daemon carries ownership through the mount; on a host that maps every container user onto the host user the write lands instead; on such a host a workspace its own user can write but not search is refused too; a sandbox whose task cannot write its workspace is never handed back',
  run: async () => {
    await withProvider('p6-i5-writable-', async (provider, dirs) => {
      const { specFor } = await import('./local-sandbox.js');
      // Write without search creates nothing (codex-8). Root is exempt from both bits, so the case
      // needs a runtime that is not root, which CI's runner is not.
      if (process.platform === 'linux' && process.getuid !== undefined && process.getgid !== undefined && process.getuid() !== 0) {
        const own = { uid: process.getuid(), gid: process.getgid() };
        await chmod(dirs.workspace, 0o600);
        try {
          let mounted;
          try {
            mounted = await provider.provision(specFor(dirs, 'rw', { user: own }));
          } catch (error) {
            if ((error as { layer?: unknown }).layer !== 'user') throw error;
          }
          if (mounted !== undefined) {
            await provider.destroy(mounted);
            throw new Error('I5: a workspace at mode 600 was mounted for its own user, who can write it but not create anything in it');
          }
        } finally {
          await chmod(dirs.workspace, 0o700);
        }
      }
      const stranger = { uid: 54321, gid: 54321 };
      let handle;
      try {
        handle = await provider.provision(specFor(dirs, 'rw', { user: stranger }));
      } catch (error) {
        const layer = (error as { layer?: unknown }).layer;
        if (layer !== 'user' || !(error instanceof Error) || !error.message.includes('54321')) throw error;
        if (process.platform !== 'linux') throw new Error('I5: the workspace was refused on a host that does not carry ownership through the mount', { cause: error });
        return;
      }
      try {
        const wrote = await provider.exec(handle, ['sh', '-c', 'echo written > /workspace/probe']);
        if (wrote.exitCode !== 0) throw new Error(`I5: a sandbox was handed back whose task cannot write its workspace: ${wrote.stderr}`);
        if (process.platform === 'linux') throw new Error('I5: on Linux a workspace the container user cannot write was mounted, not refused');
      } finally {
        await provider.destroy(handle);
      }
    });
  },
});
