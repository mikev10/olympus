/**
 * R8b: the observation plan. Each assertion drives the real code: admission
 * and the line over the hello fixture for the plan's admission and lock, and
 * the history walk over a real git checkout for its reading at window close.
 * The provider is a reader the assertion writes, standing where
 * `GitHubCheckReader` stands, so what is asserted is what the runtime makes of
 * what a provider reports (D-R8b-01).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdmissionOutcome, CheckReader, CheckRun, RunOutcome, RunRequest } from '@olympus-ai/api';
import type { Policy } from '@olympus-ai/core';
import type { AdmittedPlan, ObservationPlan, ObservationRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { DRAFTED_PLAN_WITH_THE_TESTS } from './drafting.js';
import { ARTIFACTS, linePolicy, readRecord, withLine, type LineRig } from './line.js';
import { DELIVERY_AGE_MS, RUN_A, WINDOW_MS, ago, kinds, mergedRun, observePolicy, seedMerge, walkOn, withObserve, type Rig } from './observe.js';

const api = async () => import('@olympus-ai/api');

const CLOSED_AGO = WINDOW_MS + DELIVERY_AGE_MS + 60_000;
const ACTIONS = 'github-actions';

export const PLAN: ObservationPlan = {
  works: [{ app: ACTIONS, name: 'test' }],
  regressed: [{ app: ACTIONS, name: 'smoke' }, { app: ACTIONS, name: 'e2e' }],
  rollback: { regressed: [0, 1], consecutive: 2 },
};
const SUPPLIED: AdmittedPlan = { source: 'supplied', file: { path: 'observation.json', sha256: '0'.repeat(64) }, plan: PLAN };

/** A check run as a provider reports one. */
export function checkRun(id: number, commit: string, name: string, conclusion: string | null, app: string | null = ACTIONS): CheckRun {
  return { id: String(id), app, name, headSha: commit, status: conclusion === null ? 'in_progress' : 'completed', conclusion, completedAt: conclusion === null ? null : new Date(Date.now() - 600_000 + id).toISOString() };
}

/** A reader over fixed check runs, by commit, counting what it was asked; `fail` makes it throw as an unreadable provider does. */
export function readerOf(byCommit: (commit: string) => readonly CheckRun[], fail = false): CheckReader & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    checkRuns: (commit) => {
      asked.push(commit);
      return fail ? Promise.reject(new Error('checks: GitHub answered /commits/x/check-runs with 403')) : Promise.resolve(byCommit(commit));
    },
  };
}

async function planned(vault: Vault): Promise<ObservationRecord[]> {
  return kinds(await vault.readObservations(RUN_A), 'plan-signal');
}

/** Two merges and one commit after the second: `a` is the run's merge, `later` a first parent after it. */
async function history(rig: Rig): Promise<{ a: string; later: string }> {
  const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
  const later = await rig.repo.commit({ 'b.txt': 'b, later\n' }, 'Edit b');
  return { a, later };
}

// ---------------------------------------------------------------------------

/** The hello request with the plan at `observation.json`, under `policy`. */
async function planRequest(rig: LineRig, policy: Policy, plan: unknown, overrides: Partial<RunRequest> = {}): Promise<RunRequest> {
  await writeFile(join(rig.dirs.artifacts, 'observation.json'), typeof plan === 'string' ? plan : JSON.stringify(plan));
  return rig.request(await rig.components(), { policy, artifacts: { ...ARTIFACTS, observationPlan: 'observation.json' }, ...overrides });
}

function problemAt(outcome: AdmissionOutcome, path: string, code: string, context: string): void {
  if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.path === path && p.code === code)) {
    throw new Error(`I5: ${context} was ${outcome.ok ? 'admitted' : JSON.stringify(outcome)}, not refused at ${path} as ${code}`);
  }
}

const PLAN_REQUIRED = runtime({
  id: 'I5.observe-plan-is-required-while-observing',
  title:
    'a run whose policy names an observation window and whose request names no plan is refused at admission; a plan on a run whose policy names no window is refused; a plan that does not hold its shape is refused; the same run with a window and a whole plan is admitted',
  run: async () => {
    const { admitRun } = await api();
    await withLine('r8b-required-', async (rig) => {
      const observing = await observePolicy();
      problemAt(await admitRun(await rig.request(await rig.components(), { policy: observing })), 'artifacts.observationPlan', 'missing', 'an unplanned run under a window');
      problemAt(await admitRun(await planRequest(rig, await linePolicy(), PLAN)), 'artifacts.observationPlan', 'not-applicable', 'a plan with no window');
      problemAt(await admitRun(await planRequest(rig, observing, { ...PLAN, works: [{ app: ACTIONS, name: 'test', run: 'merge it' }] })), 'observationPlan.works[0]', 'invalid-plan', 'a plan whose check carries another field');
      const admitted = await admitRun(await planRequest(rig, observing, PLAN));
      if (!admitted.ok) throw new Error(`I5 control: a planned run under a window was refused: ${JSON.stringify(admitted)}`);
      const record = await readRecord<{ artifacts: { observationPlan?: AdmittedPlan } }>((await rig.components()).vault, (await rig.state()).admission);
      const held = record.artifacts.observationPlan;
      if (held?.source !== 'supplied' || JSON.stringify(held.plan) !== JSON.stringify(PLAN)) throw new Error(`I5 control: the admission record holds ${JSON.stringify(held)}, not the plan as admitted`);
    });
  },
});

function awaitingIntegrate(outcome: RunOutcome, context: string): void {
  if (outcome.ok || outcome.reason !== 'refused' || outcome.transition.reason !== 'approval-required' || outcome.transition.key !== 'integrate:1') {
    throw new Error(`I3: ${context} stopped as ${JSON.stringify(outcome)}, not at integrate's approval`);
  }
}

const PLAN_LOCKED = runtime({
  id: 'I3.observe-plan-is-locked-with-the-tests',
  title:
    'a supplied plan changed between admission and test-design is refused there as a lock tamper, never admitted unplanned; unchanged, it is locked at test-design with the tests against its admitted hash, and changed afterwards it verifies as tampered',
  run: async () => {
    const { admitRun } = await api();
    await withLine('r8b-tamper-', async (rig) => {
      const admission = await admitRun(await planRequest(rig, await observePolicy(), PLAN));
      if (!admission.ok) throw new Error(`I3 control: the planned run was refused at admission: ${JSON.stringify(admission)}`);
      await writeFile(join(rig.dirs.artifacts, 'observation.json'), JSON.stringify({ ...PLAN, works: [{ app: ACTIONS, name: 'anything that passes' }] }));
      const outcome = await admission.admitted.drive();
      if (outcome.ok || outcome.reason !== 'refused' || outcome.transition.reason !== 'lock-tamper' || !outcome.transition.tampered.some((t) => t.path === 'observation.json')) {
        throw new Error(`I3: a plan changed after admission was ${JSON.stringify(outcome)}, not refused as a lock tamper at test-design`);
      }
    });
    await withLine('r8b-locked-', async (rig) => {
      const admission = await admitRun(await planRequest(rig, await observePolicy(), PLAN));
      if (!admission.ok) throw new Error(`I3 control: the planned run was refused at admission: ${JSON.stringify(admission)}`);
      awaitingIntegrate(await admission.admitted.drive(), 'a planned run');
      const vault = (await rig.components()).vault;
      const record = await readRecord<{ artifacts: { observationPlan?: AdmittedPlan } }>(vault, (await rig.state()).admission);
      const held = record.artifacts.observationPlan;
      const entry = (await vault.readLocks(rig.runId))?.entries.find((e) => e.path === 'observation.json');
      if (held?.source !== 'supplied' || entry?.lockedBy !== 'test-design' || entry.sha256 !== held.file.sha256) {
        throw new Error(`I3: the plan is not locked at test-design against its admitted hash: ${JSON.stringify({ entry, held })}`);
      }
      const tests = (await vault.readLocks(rig.runId))?.entries.filter((e) => ARTIFACTS.acceptanceTests.includes(e.path)) ?? [];
      if (tests.length === 0 || tests.some((t) => t.lockedBy !== entry.lockedBy || t.lockedAt !== entry.lockedAt)) throw new Error(`I3: the plan and the tests were not locked by one call: ${JSON.stringify({ entry, tests })}`);
      await writeFile(join(rig.dirs.artifacts, 'observation.json'), JSON.stringify(PLAN) + '\n');
      const verdict = await vault.verifyLocks(rig.runId);
      if (verdict.ok || !verdict.tampered.some((t) => t.path === 'observation.json')) throw new Error(`I3: a locked plan changed afterwards verified as ${JSON.stringify(verdict)}`);
    });
  },
});

// ---------------------------------------------------------------------------

const JUDGED_AT_CLOSE = runtime({
  id: 'I2.observe-plan-is-judged-at-close',
  title:
    "at window close each planned check is recorded as working, regressed, or missing before the window closes: a check the provider never reported is missing, never skipped; a run with the plan's name from another app, or a name differing by case or whitespace, is not the plan's check; R2 counts each status per run and no rate counts them",
  run: async () => {
    const { deriveOutcomes } = await api();
    let commits: { a: string; later: string } | null = null;
    const reader = readerOf((commit) => {
      if (commits === null) return [];
      if (commit === commits.a) {
        return [
          checkRun(1, commit, 'test', 'success'),
          // Failures the plan does not name: another app's check under its name, and its name in other case and spacing.
          checkRun(2, commit, 'smoke', 'failure', 'imposter-app'),
          checkRun(3, commit, 'Smoke', 'failure'),
          checkRun(4, commit, 'smoke ', 'failure'),
          checkRun(5, commit, 'e2e', 'skipped'),
        ];
      }
      return commit === commits.later ? [checkRun(6, commit, 'smoke', 'success')] : [];
    });
    await withObserve('r8b-judged-', async (rig) => {
      commits = await history(rig);
      await seedMerge(rig.vault, RUN_A, commits.a, ago(CLOSED_AGO), SUPPLIED);
      const record = await walkOn(rig, '2026-11-05');
      if (record.outcome.kind !== 'completed') throw new Error(`I2: the walk was refused: ${JSON.stringify(record.outcome)}`);
      const signals = await planned(rig.vault);
      const status = (name: string): string | undefined => signals.find((o) => o.signal.kind === 'plan-signal' && o.signal.check.name === name)?.signal.kind === 'plan-signal'
        ? (signals.find((o) => o.signal.kind === 'plan-signal' && o.signal.check.name === name)?.signal as { status: string }).status : undefined;
      const read = { test: status('test'), smoke: status('smoke'), e2e: status('e2e') };
      if (signals.length !== 3 || read.test !== 'working' || read.smoke !== 'working' || read.e2e !== 'missing') throw new Error(`I2: the plan was judged ${JSON.stringify(read)} over ${String(signals.length)} records`);
      const e2e = signals.find((o) => o.signal.kind === 'plan-signal' && o.signal.check.name === 'e2e');
      if (e2e?.signal.kind !== 'plan-signal' || e2e.signal.checkRun !== null || e2e.signal.at.source !== 'runtime') throw new Error(`I2: a missing check carries a run: ${JSON.stringify(e2e)}`);
      const all = (await rig.vault.readObservations(RUN_A)).map((e) => e.record);
      const closed = all.find((o) => o.signal.kind === 'window-closed');
      if (closed === undefined || signals.some((o) => o.recordedAt > closed.recordedAt)) throw new Error('I2: the window closed before the plan was recorded');
      const o = deriveOutcomes([await mergedRun(rig.vault, RUN_A, ago(CLOSED_AGO), commits.a)], {}, { observations: [] });
      const reading = o.safety.observed.plans[RUN_A];
      if (reading?.working !== 2 || reading.regressed !== 0 || reading.missing !== 1 || reading.rollbackConditionMet) throw new Error(`I2: R2 reads the plan as ${JSON.stringify(reading)}`);
      if (o.safety.observed.perRun[RUN_A] !== 'clean' || o.safety.observed.changeFailure.line.kind !== 'rate' || o.safety.observed.changeFailure.line.count !== 0) {
        throw new Error(`I2: a plan signal entered a rate: ${JSON.stringify(o.safety.observed.changeFailure)}`);
      }
    }, 'checkout', reader);
  },
});

const UNREADABLE_KEEPS_OPEN = runtime({
  id: 'I5.observe-unreadable-provider-keeps-the-window-open',
  title:
    "a provider that cannot be read, a host with no check reader, and a run whose plan the store cannot give back are each refused at close, record no plan signal, and leave the run's window open and the run counted as observing; the same run closes once its checks can be read",
  run: async () => {
    const { deriveOutcomes } = await api();
    const stillOpen = async (rig: Rig, mergedAt: string, a: string, cause: string, context: string): Promise<void> => {
      const record = await walkOn(rig, '2026-11-05');
      if (record.outcome.kind !== 'refused' || !record.outcome.refusals.some((r) => r.cause === cause)) throw new Error(`I5: ${context} was ${JSON.stringify(record.outcome)}, not refused ${cause}`);
      const own = await rig.vault.readObservations(RUN_A);
      if (own.some((e) => e.record.signal.kind === 'window-closed' || e.record.signal.kind === 'plan-signal')) throw new Error(`I5: ${context} closed the window or recorded a signal`);
      const o = deriveOutcomes([await mergedRun(rig.vault, RUN_A, mergedAt, a)], {}, { observations: [] });
      if (o.safety.observed.perRun[RUN_A] !== 'observing') throw new Error(`I5: ${context} left the run ${String(o.safety.observed.perRun[RUN_A])}`);
    };
    const failing = readerOf(() => [], true);
    await withObserve('r8b-provider-', async (rig) => {
      const { a } = await history(rig);
      const mergedAt = ago(CLOSED_AGO);
      await seedMerge(rig.vault, RUN_A, a, mergedAt, SUPPLIED);
      await stillOpen(rig, mergedAt, a, 'provider-unreadable', 'a provider answering 403');
    }, 'checkout', failing);
    await withObserve('r8b-no-reader-', async (rig) => {
      const { a } = await history(rig);
      const mergedAt = ago(CLOSED_AGO);
      await seedMerge(rig.vault, RUN_A, a, mergedAt, SUPPLIED);
      await stillOpen(rig, mergedAt, a, 'provider-unreadable', 'a host with no check reader');
    }, 'checkout', null);
    await withObserve('r8b-no-state-', async (rig) => {
      const { a } = await history(rig);
      const mergedAt = ago(CLOSED_AGO);
      await seedMerge(rig.vault, RUN_A, a, mergedAt, 'unadmitted');
      await stillOpen(rig, mergedAt, a, 'plan-unreadable', 'a merged run with no state in the store');
    }, 'checkout', readerOf(() => []));
    // The control: the same planned run, with checks that can be read, closes.
    await withObserve('r8b-readable-', async (rig) => {
      const { a } = await history(rig);
      await seedMerge(rig.vault, RUN_A, a, ago(CLOSED_AGO), SUPPLIED);
      const record = await walkOn(rig, '2026-11-05');
      if (record.outcome.kind !== 'completed' || kinds(await rig.vault.readObservations(RUN_A), 'window-closed').length !== 1) throw new Error(`I5 control: a readable planned run did not close: ${JSON.stringify(record.outcome)}`);
    }, 'checkout', readerOf(() => []));
  },
});

const ROLLBACK_RECORDED_ONLY = runtime({
  id: 'I5.observe-rollback-condition-is-recorded-and-never-acted-on',
  title:
    "a plan's rollback condition, met on consecutive first parents, is recorded with its checks and commits; it starts no run, opens no candidate, makes no commit, and changes no integration, and a condition one commit short is not recorded",
  run: async () => {
    const failingOn = (commits: () => readonly string[]) => readerOf((commit) => (commits().includes(commit) ? [checkRun(1, commit, 'smoke', 'failure'), checkRun(2, commit, 'e2e', 'timed_out')] : []));
    let met: readonly string[] = [];
    await withObserve('r8b-rollback-', async (rig) => {
      const { a, later } = await history(rig);
      met = [a, later];
      await seedMerge(rig.vault, RUN_A, a, ago(CLOSED_AGO), SUPPLIED);
      const head = rig.repo.git(['rev-parse', 'HEAD']);
      const integrations = (await rig.vault.readIntegration(RUN_A)).length;
      await walkOn(rig, '2026-11-05');
      const condition = kinds(await rig.vault.readObservations(RUN_A), 'rollback-condition-met');
      if (condition.length !== 1 || condition[0]?.signal.kind !== 'rollback-condition-met' || condition[0].signal.commits.join() !== [a, later].join()) {
        throw new Error(`I5: a met rollback condition was recorded as ${JSON.stringify(condition)}`);
      }
      if (rig.repo.git(['rev-parse', 'HEAD']) !== head) throw new Error('I5: a met rollback condition made a commit');
      if ((await rig.vault.listRuns()).join() !== RUN_A) throw new Error(`I5: a met rollback condition started a run: ${JSON.stringify(await rig.vault.listRuns())}`);
      if ((await rig.vault.readTriggerDecisions()).some((e) => e.candidate != null)) throw new Error('I5: a met rollback condition opened a candidate');
      if ((await rig.vault.readIntegration(RUN_A)).length !== integrations) throw new Error('I5: a met rollback condition changed an integration');
    }, 'checkout', failingOn(() => met));
    // The control: failing on the merge commit alone is one commit short of two in a row.
    await withObserve('r8b-short-', async (rig) => {
      const { a } = await history(rig);
      met = [a];
      await seedMerge(rig.vault, RUN_A, a, ago(CLOSED_AGO), SUPPLIED);
      await walkOn(rig, '2026-11-05');
      if (kinds(await rig.vault.readObservations(RUN_A), 'rollback-condition-met').length !== 0) throw new Error('I5 control: a condition one commit short was recorded as met');
      if (kinds(await rig.vault.readObservations(RUN_A), 'plan-signal').length !== 3) throw new Error('I5 control: the plan was not read');
    }, 'checkout', failingOn(() => met));
  },
});

const PARTIAL_READING_IS_FINISHED = runtime({
  id: 'I5.observe-partial-plan-reading-is-finished-before-close',
  title:
    "a walk whose store fails after recording some of a plan's signals leaves the window open, and the next walk records every planned check and the met rollback condition before it closes the window, never closing on the part already written (triage A, codex-1, gemini-1)",
  run: async () => {
    const { walkHistory } = await api();
    let commits: readonly string[] = [];
    const reader = readerOf((commit) => (commits.includes(commit) ? [checkRun(1, commit, 'smoke', 'failure'), checkRun(2, commit, 'e2e', 'failure')] : []));
    await withObserve('r8b-partial-', async (rig) => {
      const { a, later } = await history(rig);
      commits = [a, later];
      await seedMerge(rig.vault, RUN_A, a, ago(CLOSED_AGO), SUPPLIED);
      // The store fails on the second plan signal it is asked to record, as a full disk or an I/O error would.
      let planWrites = 0;
      const failing = new Proxy(rig.vault, {
        get(target, key) {
          if (key !== 'recordObservation') {
            // Bound to the store itself, whose private fields a proxy receiver cannot reach.
            const value = Reflect.get(target, key, target) as unknown;
            return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
          }
          return async (r: ObservationRecord) => {
            if (r.signal.kind === 'plan-signal' && ++planWrites === 2) throw new Error('store: no space left on device');
            return target.recordObservation(r);
          };
        },
      });
      const first = await walkHistory(failing, { checkout: rig.repo.dir, branch: 'main', checks: reader }, rig.policy, () => Date.now());
      if (first.refusals.length === 0) throw new Error('I5 control: a store that failed mid-reading refused nothing');
      if (kinds(await rig.vault.readObservations(RUN_A), 'window-closed').length !== 0) throw new Error('I5: a window closed on a reading the store did not finish');
      await walkOn(rig, '2026-11-05');
      const own = await rig.vault.readObservations(RUN_A);
      const names = kinds(own, 'plan-signal').map((o) => (o.signal.kind === 'plan-signal' ? `${o.signal.role}:${o.signal.check.name}` : '')).sort();
      if (names.join() !== ['regressed:e2e', 'regressed:smoke', 'works:test'].join()) throw new Error(`I5: the finished reading holds ${JSON.stringify(names)}`);
      if (kinds(own, 'rollback-condition-met').length !== 1) throw new Error('I5: the met rollback condition was lost to the partial write');
      if (kinds(own, 'window-closed').length !== 1) throw new Error('I5 control: the finished reading did not close the window');
    }, 'checkout', reader);
  },
});

export const R8B_I2: readonly LocalAssertion[] = [JUDGED_AT_CLOSE];
export const R8B_I3: readonly LocalAssertion[] = [PLAN_LOCKED, DRAFTED_PLAN_WITH_THE_TESTS];
export const R8B_I5: readonly LocalAssertion[] = [PLAN_REQUIRED, UNREADABLE_KEEPS_OPEN, ROLLBACK_RECORDED_ONLY, PARTIAL_READING_IS_FINISHED];
