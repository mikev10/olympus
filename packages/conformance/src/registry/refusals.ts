/**
 * R58: a refused run says so, and a spent budget parks at once. One free
 * assertion per fix, each failing with its fix reverted (I8): a run a
 * station refused reads `refused` in `status`, from the decision record and
 * only while the run is still at the state the refusal was made at (#181); a
 * driver call that fails after its relay refused it for a spent budget parks
 * the task without a retry, naming the bound (#193).
 */
import { randomUUID } from 'node:crypto';
import type { RoleId, StationRefusal, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { MeterReading, SandboxProvider } from '@olympus-ai/sandbox';
import type { EnforcementDecision, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_REPRODUCTION, HELLO_TASK, lineScope, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig, type ObservedDriver } from './line.js';

const api = async () => import('@olympus-ai/api');

/** Declared to fail on the base and exits 0 there, so `test-design` refuses its exit as a base mismatch (D-A-BF-01). */
const PASSES_ON_THE_BASE = { ...HELLO_REPRODUCTION, command: ['node', '-e', 'process.exit(0)'] };

async function stationRefusals(vault: Vault, rig: LineRig): Promise<EnforcementDecision[]> {
  const decisions: EnforcementDecision[] = [];
  for (const ref of await vault.readDecisions(rig.runId)) {
    const d = await readRecord<EnforcementDecision>(vault, ref);
    if (d.decision.cause === 'station-refused') decisions.push(d);
  }
  return decisions;
}

export const REFUSED_RUN_READS_REFUSED: LocalAssertion = runtime({
  id: 'I2.refused-run-reads-refused',
  title:
    "a run test-design refused as base-mismatch reads refused in status, with the station, the refusal, and the time its decision record holds, and can still be cancelled; a recorded refusal naming no state version, or another version than the run's, reads open (#181)",
  run: async () => {
    await withLine('r58-refused-', async (rig) => {
      await writeManifest(rig.dirs, [PASSES_ON_THE_BASE]);
      const components = await rig.components();
      const { startRun, runStanding, cancelRun } = await api();
      const refusal = refusalOf(await startRun(await rig.request(components)), 'R58 refused');
      if (refusal.at !== 'test-design' || refusal.transition.reason !== 'base-mismatch') {
        throw new Error(`R58 control: the run stopped at ${refusal.at} as ${refusal.transition.reason}, not at test-design as base-mismatch`);
      }
      const recorded = await stationRefusals(components.vault, rig);
      const [decision] = recorded;
      if (recorded.length !== 1 || decision?.decision.cause !== 'station-refused') throw new Error(`R58 control: ${String(recorded.length)} station refusals were recorded, not one`);
      const { state, standing } = await runStanding(components.vault, rig.runId);
      if (decision.decision.stateVersion !== state.version) {
        throw new Error(`I2: the refusal names state version ${String(decision.decision.stateVersion)}, and the run was left at ${state.version}`);
      }
      if (standing.standing !== 'refused') throw new Error(`I2: a run refused at test-design reads ${JSON.stringify(standing)}`);
      if (standing.station !== 'test-design' || standing.decidedAt !== decision.decidedAt || JSON.stringify(standing.refusal) !== JSON.stringify(decision.decision.refusal)) {
        throw new Error(`I2: the refused standing ${JSON.stringify(standing)} is not the decision record's ${JSON.stringify(decision)}`);
      }
      if (standing.refusal.reason !== 'base-mismatch' || standing.refusal.message === '') throw new Error(`I2: the refused standing carries no cause and message: ${JSON.stringify(standing.refusal)}`);
      // A refused run is not finished: it can be cancelled, and then reads as cancelled, from committed state.
      const cancelled = await cancelRun({ runId: rig.runId, by: 'r58-operator', vault: components.vault });
      if (!cancelled.ok) throw new Error(`I2: a refused run could not be cancelled: ${JSON.stringify(cancelled)}`);
      const after = await runStanding(components.vault, rig.runId);
      if (after.standing.standing !== 'stopped' || after.standing.refusal.reason !== 'cancelled') throw new Error(`I2: after its cancellation the run reads ${JSON.stringify(after.standing)}`);
    });
    // A refusal is current only by the version it names: none, as every record before the field, or a stale one, is not.
    await withLine('r58-refused-version-', async (rig) => {
      const components = await rig.components();
      const { admitRun, runStanding } = await api();
      const admission = await admitRun(await rig.request(components));
      if (!admission.ok) throw new Error(`R58 control: the run was not admitted: ${JSON.stringify(admission)}`);
      const { state } = await runStanding(components.vault, rig.runId);
      const refusal: StationRefusal = { ok: false, reason: 'spec-part-missing', part: 'security', message: 'r58: a refusal recorded by hand' };
      const record = async (stateVersion: string | undefined): Promise<void> => {
        await components.vault.recordDecision({
          runId: rig.runId,
          taskId: null,
          station: state.station,
          decidedAt: new Date().toISOString(),
          occurrence: randomUUID(),
          decision: { cause: 'station-refused', decidedBy: 'line', refusal, ...(stateVersion === undefined ? {} : { stateVersion }) },
          collectedBy: 'runtime',
        });
      };
      await record(undefined);
      const unversioned = await runStanding(components.vault, rig.runId);
      if (unversioned.standing.standing !== 'open') throw new Error(`I5: a refusal naming no state version reads ${JSON.stringify(unversioned.standing)}`);
      await record(`${state.version}-stale`);
      const stale = await runStanding(components.vault, rig.runId);
      if (stale.standing.standing !== 'open') throw new Error(`I5: a refusal naming another state version reads ${JSON.stringify(stale.standing)}`);
      // Control: the same record naming the run's version is read, so the two above were refused for their version alone.
      await record(state.version);
      const current = await runStanding(components.vault, rig.runId);
      if (current.standing.standing !== 'refused' || current.standing.refusal.reason !== 'spec-part-missing') {
        throw new Error(`R58 control: a refusal naming the run's version reads ${JSON.stringify(current.standing)}`);
      }
    });
  },
});

/** A stub driver whose every call fails, remembering the sandbox each call was handed. */
async function failingDriver(): Promise<{ driver: ObservedDriver; handles: Set<TaskRequest['sandbox']> }> {
  const inner = await stubDriver();
  const handles = new Set<TaskRequest['sandbox']>();
  const driver: ObservedDriver = {
    ...inner,
    runTask: (req: TaskRequest): Promise<TaskResult> => {
      inner.requests.push(req);
      handles.add(req.sandbox);
      return Promise.reject(new Error('r58: the provider answered 402'));
    },
  };
  return { driver, handles };
}

/** The stub provider, reporting `meter` for every sandbox a driver call ran in and its own reading for every other. */
async function meteredProvider(handles: Set<TaskRequest['sandbox']>, meter: MeterReading): Promise<SandboxProvider> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  return {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    provision: (spec) => inner.provision(spec),
    exec: (handle, cmd, options) => inner.exec(handle, cmd, options),
    destroy: async (handle) => {
      const base = await inner.destroy(handle);
      return handles.has(handle) ? { ...base, meter } : base;
    },
  };
}

/** Read through a call, so a count checked before a resume is read again after it. */
const invocations = (driver: ObservedDriver): number => driver.requests.length;

const READING = { kind: 'metered', calls: 2, inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.5 } as const;

export const SPENT_BUDGET_PARKS_AT_ONCE: LocalAssertion = runtime({
  id: 'I5.spent-budget-parks-at-once',
  title:
    "a build whose driver call fails after its relay's meter reports the token budget spent and a request refused parks the task as budget-spent after one invocation, naming the bound and the policy's limit, with no retry counted, and a resume reads the same park from committed state; a failed call whose meter reports nothing spent is retried to retries-exhausted (#193)",
  run: async () => {
    const { STATION_CONTRACTS } = await import('@olympus-ai/core');
    const { maxTokens, maxCostUsd } = lineScope(['build'], 'standard').budget;
    for (const [bound, limit] of [['tokens', maxTokens], ['cost', maxCostUsd]] as const) {
      await withLine(`r58-budget-${bound}-`, async (rig) => {
        const { driver, handles } = await failingDriver();
        const sandbox = await meteredProvider(handles, { ...READING, exhausted: bound, refused: 1 });
        const components = await rig.components({ driver, sandbox });
        const { startRun, resumeRun, runStanding } = await api();
        const { transition } = refusalOf(await startRun(await rig.request(components)), `R58 ${bound}`);
        if (transition.reason !== 'parked' || transition.cause !== 'budget-spent') throw new Error(`I5: a call refused for a spent ${bound} budget ended the run as ${JSON.stringify(transition)}`);
        if (transition.task !== HELLO_TASK || transition.bound !== bound || transition.limit !== limit) {
          throw new Error(`I5: the park names ${transition.bound} ${String(transition.limit)} over ${transition.task}, not ${bound} ${String(limit)} over ${HELLO_TASK}`);
        }
        if (driver.requests.length !== 1) throw new Error(`I5: the driver was invoked ${String(driver.requests.length)} times under a spent budget, not once`);
        const attempts = (await rig.state()).attempts[HELLO_TASK];
        if (attempts?.retries !== 0 || attempts.parkedFor !== 'budget-spent' || attempts.budgetSpent?.bound !== bound || attempts.budgetSpent.limit !== limit) {
          throw new Error(`I5: the park committed ${JSON.stringify(attempts)}`);
        }
        const parks = (await stationRefusals(components.vault, rig)).filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'parked');
        if (parks.length !== 1 || parks[0]?.decision.decidedBy !== 'line' || parks[0].taskId !== HELLO_TASK) throw new Error(`I5: the park was recorded as ${JSON.stringify(parks)}`);
        // The park is shown with the failed attempt behind it, and a resume reads it back from committed state and invokes nothing.
        const { standing } = await runStanding(components.vault, rig.runId);
        if (standing.standing !== 'stopped' || standing.refusal.reason !== 'parked' || standing.refusal.cause !== 'budget-spent' || standing.lastFailure?.kind !== 'attempt-failed') {
          throw new Error(`I5: the parked run reads ${JSON.stringify(standing)}`);
        }
        const resumed = refusalOf(await resumeRun({ runId: rig.runId, components }), `R58 ${bound} resume`);
        if (JSON.stringify(resumed.transition) !== JSON.stringify(transition)) throw new Error(`I5: a resume read the park as ${JSON.stringify(resumed.transition)}, not ${JSON.stringify(transition)}`);
        if (invocations(driver) !== 1) throw new Error('I5: the resume invoked the driver under the spent budget');
      });
    }
    // Controls: a failed call is parked for its budget only on the meter's word. Nothing spent, or a relay stopped for an answer it could not read, is retried.
    for (const reading of [{ ...READING, exhausted: 'none', refused: 0 }, { ...READING, exhausted: 'unreadable', refused: 1 }, { ...READING, exhausted: 'cost', refused: 0 }] as const) {
      await withLine(`r58-budget-control-${reading.exhausted}-`, async (rig) => {
        const { driver, handles } = await failingDriver();
        const components = await rig.components({ driver, sandbox: await meteredProvider(handles, reading) });
        const { startRun } = await api();
        const { transition } = refusalOf(await startRun(await rig.request(components)), 'R58 control');
        if (transition.reason !== 'parked' || transition.cause !== 'retries-exhausted' || driver.requests.length !== STATION_CONTRACTS.build.retry.max + 1) {
          throw new Error(`R58 control: under a meter reading ${reading.exhausted} with ${String(reading.refused)} refused, ${String(driver.requests.length)} calls ended as ${JSON.stringify(transition)}`);
        }
      });
    }
  },
});

/** A stub driver whose every call returns a result, remembering the sandbox each call was handed. */
async function recordingDriver(): Promise<{ driver: ObservedDriver; handles: Set<TaskRequest['sandbox']> }> {
  const handles = new Set<TaskRequest['sandbox']>();
  const driver = await stubDriver({ during: (req: TaskRequest) => { handles.add(req.sandbox); return Promise.resolve(); } });
  return { driver, handles };
}

const builds = (driver: ObservedDriver): number => driver.requests.filter((r) => r.role.role === ('builder' as RoleId)).length;

export const SPENT_BUDGET_RESULT_IS_JUDGED_ONCE: LocalAssertion = runtime({
  id: 'I5.spent-budget-result-is-judged-once',
  title:
    "a build call that returns a result after its relay's meter reports the budget spent and a request refused has that result judged: where its gate fails, the task parks as budget-spent with no second build, naming the bound and limit; where its gate passes, the run goes on to its approval (#248)",
  run: async () => {
    const { maxCostUsd } = lineScope(['build'], 'standard').budget;
    const spent: MeterReading = { ...READING, exhausted: 'cost', refused: 1 };
    // The builder writes nothing, so the fixture's check fails over its change.
    await withLine('r58-result-fails-', async (rig) => {
      const { driver, handles } = await recordingDriver();
      const components = await rig.components({ driver, reviewer: driver, sandbox: await meteredProvider(handles, spent) }, { work: false });
      const { startRun, resumeRun } = await api();
      const { transition } = refusalOf(await startRun(await rig.request(components)), 'R58 result fails');
      if (transition.reason !== 'parked' || transition.cause !== 'budget-spent' || transition.task !== HELLO_TASK || transition.bound !== 'cost' || transition.limit !== maxCostUsd) {
        throw new Error(`I5: a result whose gate failed under a spent budget ended the run as ${JSON.stringify(transition)}`);
      }
      if (builds(driver) !== 1) throw new Error(`I5: the builder was invoked ${String(builds(driver))} times under a spent budget, not once`);
      const gates = (await stationRefusals(components.vault, rig)).filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'gate-failed');
      if (gates.length !== 1) throw new Error(`R58 control: ${String(gates.length)} failed gates were recorded, so the result was not judged exactly once`);
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components }), 'R58 result fails, resumed');
      if (JSON.stringify(resumed.transition) !== JSON.stringify(transition) || builds(driver) !== 1) {
        throw new Error(`I5: a resume read the park as ${JSON.stringify(resumed.transition)} after ${String(builds(driver))} builds`);
      }
    });
    // The builder does the work: the result passes its gate, and a spent budget alone parks nothing.
    await withLine('r58-result-passes-', async (rig) => {
      const { driver, handles } = await recordingDriver();
      const components = await rig.components({ driver, reviewer: driver, sandbox: await meteredProvider(handles, spent) });
      const { startRun } = await api();
      const { transition } = refusalOf(await startRun(await rig.request(components)), 'R58 result passes');
      if (transition.reason !== 'approval-required') throw new Error(`I5: a result that passed its gate under a spent budget ended the run as ${JSON.stringify(transition)}`);
      const attempts = (await rig.state()).attempts[HELLO_TASK];
      if (attempts?.budgetSpent?.bound !== 'cost' || attempts.parkedFor !== undefined) throw new Error(`I5: the passed task's attempts are ${JSON.stringify(attempts)}`);
    });
  },
});

/** The decision table's row: a spent budget's park is recorded by the line over the task, at build. */
export async function budgetSpentPark(expect: (rig: LineRig, vault: Vault) => Promise<EnforcementDecision>): Promise<void> {
  await withLine('r58-park-budget-spent-', async (rig) => {
    const { driver, handles } = await failingDriver();
    const components = await rig.components({ driver, sandbox: await meteredProvider(handles, { ...READING, exhausted: 'cost', refused: 1 }) });
    const { startRun } = await api();
    refusalOf(await startRun(await rig.request(components)), 'P14 budget');
    const d = await expect(rig, components.vault);
    if (d.decision.cause !== 'station-refused' || d.decision.refusal.reason !== 'parked' || d.decision.refusal.cause !== 'budget-spent' || d.decision.stateVersion !== undefined) {
      throw new Error(`P14: a budget-spent park was recorded as ${JSON.stringify(d.decision)}`);
    }
  });
}

export const R58_I2: readonly LocalAssertion[] = [REFUSED_RUN_READS_REFUSED];
export const R58_I5: readonly LocalAssertion[] = [SPENT_BUDGET_PARKS_AT_ONCE, SPENT_BUDGET_RESULT_IS_JUDGED_ONCE];
