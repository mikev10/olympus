/**
 * P14's conformance table: every cause of an enforcement decision, keyed so
 * that a cause with no row does not compile, and each row either a scenario
 * that makes the decision and finds it recorded, or a mark whose own check
 * fails the moment the mark stops being true (D-P14-10, D-P14-12).
 *
 * Each scenario drives the component that decides — admission, a resume, the
 * line, an approval — over the filesystem Vault, then reads the decision back
 * through `readDecisions` and checks the component named, the run, the task,
 * and the station. Deleting the write for any one cause fails its row (I8).
 */
import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentGraph } from '@olympus-ai/api';
import type { ParkCause, RoleId, RunId, RunState, StationId, StationRefusal, TaskId } from '@olympus-ai/core';
import type { EgressConnection, EgressLog, MeterReading, SandboxProvider, Teardown } from '@olympus-ai/sandbox';
import type { AdmissionRefusal, DecisionCause, EnforcementDecision, ResumeRefusal, Vault } from '@olympus-ai/vault';
import ts from 'typescript';
import { runtime } from '../kit/assert.js';
import { packageProgram, walk } from '../kit/scan.js';
import type { LocalAssertion } from '../kit/types.js';
import { workspacePackages, workspaceRelative } from '../kit/workspace.js';
import { around } from './line-assertions.js';
import { inTask, runHello, writes } from './verification.js';
import { HELLO_TASK, lineScope, linePolicy, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');

/** Every cause a decision can have, at the grain a rate counts by. */
export type CauseKey =
  | `admission:${AdmissionRefusal['reason']}`
  | `resume:${ResumeRefusal['reason']}`
  | `station:${Exclude<StationRefusal['reason'], 'parked'>}`
  | `station:parked:${ParkCause}`
  | 'approval-granted'
  | `approval-refused:${Extract<DecisionCause, { cause: 'approval-refused' }>['reason']}`
  | `egress:${EgressConnection['verdict']}`
  | 'violation-recorded'
  | 'relay-refused';

export function keyOf(d: DecisionCause): CauseKey {
  switch (d.cause) {
    case 'admission-refused':
      return `admission:${d.refusal.reason}`;
    case 'resume-refused':
      return `resume:${d.refusal.reason}`;
    case 'station-refused':
      return d.refusal.reason === 'parked' ? `station:parked:${d.refusal.cause}` : `station:${d.refusal.reason}`;
    case 'approval-granted':
      return 'approval-granted';
    case 'approval-refused':
      return `approval-refused:${d.reason}`;
    case 'egress-connection':
      return `egress:${d.connection.verdict}`;
    case 'violation-recorded':
      return 'violation-recorded';
    case 'relay-refused':
      return 'relay-refused';
  }
}

/**
 * A row: a scenario, or one of two marks. `unconstructed`: no code builds
 * the arm (D-P14-10). `blocked-above-l1`: the cause can only happen above L1,
 * which every run is refused today (D-P14-12).
 */
type Row =
  | { readonly kind: 'scenario'; readonly run: () => Promise<void> }
  | { readonly kind: 'unconstructed' }
  | { readonly kind: 'blocked-above-l1' };

interface Expected {
  readonly decidedBy: DecisionCause['decidedBy'];
  readonly taskId: TaskId | null;
  readonly station: StationId | null;
}

/** Every decision recorded for the run, read back through the Vault, each checked against its file with a plain SHA-256. */
async function decisionsOf(rig: LineRig, vault: Vault, runId: RunId = rig.runId): Promise<EnforcementDecision[]> {
  const refs = await vault.readDecisions(runId);
  const decisions: EnforcementDecision[] = [];
  for (const ref of refs) {
    const file = join(rig.dirs.store, 'runs', runId, 'objects', 'decision', `${ref.hash}.json`);
    const actual = createHash('sha256').update(await readFile(file)).digest('hex');
    if (actual !== ref.hash) throw new Error(`P14: decision file ${workspaceRelative(file)} hashes to ${actual}, not the ${ref.hash} its ref names`);
    const decision = await readRecord<EnforcementDecision>(vault, ref);
    if ((decision.collectedBy as string) !== 'runtime') throw new Error(`P14: a decision was recorded as collected by ${decision.collectedBy as string}`);
    decisions.push(decision);
  }
  return decisions;
}

/** The one recorded decision with this cause, checked for who made it and where; fails naming what was recorded instead. */
async function expectDecision(rig: LineRig, vault: Vault, key: CauseKey, expected: Expected): Promise<EnforcementDecision> {
  const decisions = await decisionsOf(rig, vault);
  const found = decisions.filter((d) => keyOf(d.decision) === key);
  const match = found.find(
    (d) => d.runId === rig.runId && d.decision.decidedBy === expected.decidedBy && d.taskId === expected.taskId && d.station === expected.station,
  );
  if (match === undefined) {
    const seen = decisions.map((d) => `${keyOf(d.decision)} by ${d.decision.decidedBy} at ${String(d.station)}/${String(d.taskId)}`);
    throw new Error(`P14: no ${key} decision by ${expected.decidedBy} at ${String(expected.station)}/${String(expected.taskId)}; recorded: ${JSON.stringify(seen)}`);
  }
  return match;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * A refused admission leaves its decision and nothing else: no run state, no
 * admission record, no lock, no workspace (D-P14-01). Then the same run id is
 * admitted, which a leftover would stop.
 */
async function onlyTheDecision(rig: LineRig, vault: Vault, key: CauseKey): Promise<void> {
  const decisions = await decisionsOf(rig, vault);
  if (decisions.length !== 1 || decisions[0] === undefined || keyOf(decisions[0].decision) !== key) {
    throw new Error(`P14: a ${key} admission left ${JSON.stringify(decisions.map((d) => keyOf(d.decision)))}, not one ${key} decision`);
  }
  const run = join(rig.dirs.store, 'runs', rig.runId);
  for (const leftover of ['state', 'admission.json', 'locks']) {
    if (await exists(join(run, leftover))) throw new Error(`P14: a ${key} admission left ${leftover} behind`);
  }
  const { startRun } = await api();
  const control = await startRun(await rig.request(await rig.components()));
  if (!control.ok && control.reason !== 'refused') throw new Error(`P14: after a ${key} admission the same run id was refused as ${control.reason}`);
}

/** A default L1 run of the fixture, which stops at `integrate` for a human's approval. Returns the key it waits on. */
async function stoppedForApproval(rig: LineRig, components?: ComponentGraph): Promise<string> {
  const { startRun } = await api();
  const refusal = refusalOf(await startRun(await rig.request(components ?? (await rig.components()))), 'P14 approval stop');
  if (refusal.transition.reason !== 'approval-required') throw new Error(`P14: the default run stopped as ${refusal.transition.reason}`);
  return refusal.transition.key;
}

/** A provider that forwards to the stub and reports, for every driver call's sandbox, the teardown `make` gives it. */
async function reportingProvider(make: (n: number) => Partial<Teardown>): Promise<SandboxProvider> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  let n = 0;
  return {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    provision: (spec) => inner.provision(spec),
    exec: (handle, cmd, options) => inner.exec(handle, cmd, options),
    destroy: async (handle) => {
      const base = await inner.destroy(handle);
      n += 1;
      return { ...base, ...make(n) };
    },
  };
}

const PROXIED: EgressLog = {
  kind: 'proxied',
  connections: [
    { verdict: 'opened', host: 'registry.npmjs.org', at: '2026-09-29T00:00:01.000Z' },
    { verdict: 'tunnelled', host: 'api.anthropic.com', at: '2026-09-29T00:00:02.000Z' },
    { verdict: 'refused', host: 'exfil.example', at: '2026-09-29T00:00:03.000Z' },
  ],
};

/** The driver's call reports three connections; the verify checks' sandboxes report none. */
async function egressScenario(verdict: EgressConnection['verdict']): Promise<void> {
  await withLine(`p14-egress-${verdict}-`, async (rig) => {
    const sandbox = await reportingProvider((n) => (n === 1 ? { egress: PROXIED } : {}));
    const components = await rig.components({ sandbox });
    await stoppedForApproval(rig, components);
    const d = await expectDecision(rig, components.vault, `egress:${verdict}`, { decidedBy: 'egress-proxy', taskId: HELLO_TASK, station: 'build' });
    const expected = PROXIED.kind === 'proxied' ? PROXIED.connections.find((c) => c.verdict === verdict) : undefined;
    if (d.decision.cause !== 'egress-connection' || JSON.stringify(d.decision.connection) !== JSON.stringify(expected)) {
      throw new Error(`P14: the ${verdict} connection was recorded as ${JSON.stringify(d.decision)}`);
    }
  });
}

/** A builder whose grant covers only `src/**` writes outside it: a capability escape, recorded as a violation and refused (I4). */
async function escapeScenario(check: (rig: LineRig, vault: Vault, state: RunState) => Promise<void>): Promise<void> {
  await withLine('p14-escape-', async (rig) => {
    const { startRun } = await api();
    const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
    const sandbox = new StubSandboxProvider();
    const driver = await stubDriver({ during: (req) => inTask(sandbox, req, writes({ 'escape.txt': 'outside the grant\n' })).then(() => undefined) });
    const components = await rig.components({ sandbox, driver, reviewer: driver });
    const policy = await linePolicy({}, { roles: { ['builder' as RoleId]: lineScope(['build', 'verify'], 'standard', ['src/**']), ['reviewer' as RoleId]: lineScope(['review'], 'deep') } });
    const refusal = refusalOf(await startRun(await rig.request(components, { policy })), 'P14 escape');
    if (refusal.transition.reason !== 'violation' || refusal.state === null) throw new Error(`P14: the escape was refused as ${refusal.transition.reason}`);
    await check(rig, components.vault, refusal.state);
  });
}

/**
 * The violation site that keeps its finding out of run state (D-P6-03): a
 * claim naming a file the diff lacks. An escape alone does not cover it,
 * since that violation reaches state through another call (external review of
 * P14, codex-6).
 */
async function claimMismatchScenario(): Promise<void> {
  await withLine('p14-claim-mismatch-', async (rig) => {
    await writeManifest(rig.dirs, [{ id: 'passes', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 }]);
    const { vault, violations } = await runHello(rig, { claim: ['src/claimed.ts'] });
    const mismatch = violations.find((v) => v.kind === 'claim-mismatch');
    if (mismatch === undefined) throw new Error('P14: the claim mismatch recorded no violation');
    const recorded = (await decisionsOf(rig, vault)).filter((d) => d.decision.cause === 'violation-recorded');
    const kinds = await Promise.all(
      recorded.map(async (d) => (d.decision.cause === 'violation-recorded' ? (await readRecord<{ kind: string }>(vault, d.decision.violation)).kind : null)),
    );
    const at = kinds.indexOf('claim-mismatch');
    const d = recorded[at];
    if (d === undefined) throw new Error(`P14: no violation-recorded decision points at the claim mismatch; recorded: ${JSON.stringify(kinds)}`);
    if (d.decision.decidedBy !== 'line' || d.taskId !== HELLO_TASK || d.station !== 'verify') {
      throw new Error(`P14: the claim mismatch's decision is by ${d.decision.decidedBy} at ${String(d.station)}/${String(d.taskId)}`);
    }
  });
}

async function parkScenario(cause: ParkCause): Promise<void> {
  const { STATION_CONTRACTS } = await import('@olympus-ai/core');
  const { maxIterations, retry } = STATION_CONTRACTS.build;
  await withLine(`p14-park-${cause}-`, async (rig) => {
    const { startRun, resumeRun } = await api();
    let vault: Vault;
    if (cause === 'iterations-exhausted') {
      await writeManifest(rig.dirs, [{ id: 'always-fails', kind: 'unit', command: ['node', '-e', 'process.exit(1)'], required: true, timeoutMs: 10_000 }]);
      const driver = await stubDriver();
      const components = await rig.components({ driver, reviewer: driver });
      vault = components.vault;
      refusalOf(await startRun(await rig.request(components)), 'P14 iterations');
    } else if (cause === 'retries-exhausted') {
      const components = await rig.components({ driver: await stubDriver({ failing: true }) });
      vault = components.vault;
      refusalOf(await startRun(await rig.request(components)), 'P14 retries');
    } else {
      // Killed inside every attempt until the invocation bound, then resumed once more (A-P4-06).
      const driver = await stubDriver();
      const bound = maxIterations * (retry.max + 1);
      for (let spent = 0; spent < bound; spent += 1) {
        const base = await rig.components({ driver, reviewer: driver });
        const killed = around(base.vault, {
          beforeCommit: (s) => {
            if (s.tasks[HELLO_TASK] === 'verifying') throw new Error('killed in flight');
          },
        });
        const components = { ...base, vault: killed };
        try {
          await (spent === 0 ? startRun(await rig.request(components)) : resumeRun({ runId: rig.runId, components }));
        } catch (error) {
          if ((error as Error).message !== 'killed in flight') throw error;
        }
      }
      const components = await rig.components({ driver, reviewer: driver });
      vault = components.vault;
      refusalOf(await resumeRun({ runId: rig.runId, components }), 'P14 starts');
    }
    // A gate that fails its last iteration parks the task at verify, where the run then is (D-P14-13).
    const station = cause === 'iterations-exhausted' ? 'verify' : 'build';
    const d = await expectDecision(rig, vault, `station:parked:${cause}`, { decidedBy: 'line', taskId: HELLO_TASK, station });
    if (d.decision.cause !== 'station-refused' || d.decision.refusal.reason !== 'parked' || d.decision.refusal.task !== HELLO_TASK) {
      throw new Error(`P14: a ${cause} park was recorded as ${JSON.stringify(d.decision)}`);
    }
  });
}

/** An admission refused for `key`, found recorded with nothing else left behind. */
function admissionRow(key: CauseKey, prefix: string, arrange: (rig: LineRig) => Promise<unknown>): Row {
  return {
    kind: 'scenario',
    run: async () => {
      await withLine(prefix, async (rig) => {
        const vault = (await rig.components()).vault;
        await arrange(rig);
        await expectDecision(rig, vault, key, { decidedBy: 'admission', taskId: null, station: null });
        await onlyTheDecision(rig, vault, key);
      });
    },
  };
}

export const DECISION_TABLE: Readonly<Record<CauseKey, Row>> = {
  'admission:invalid-request': {
    kind: 'scenario',
    run: async () => {
      // The one invalid request that has a run id the Vault can name and a run already there: admitting it twice.
      await withLine('p14-invalid-', async (rig) => {
        const { startRun } = await api();
        await stoppedForApproval(rig);
        const again = await startRun(await rig.request(await rig.components()));
        if (again.ok || again.reason !== 'invalid-request') throw new Error(`P14: a second admission was ${again.ok ? 'admitted' : again.reason}`);
        const vault = (await rig.components()).vault;
        const d = await expectDecision(rig, vault, 'admission:invalid-request', { decidedBy: 'admission', taskId: null, station: null });
        if (d.decision.cause !== 'admission-refused' || d.decision.refusal.reason !== 'invalid-request') throw new Error('P14: unreachable');
        const problems = d.decision.refusal.problems;
        if (!problems.some((p) => p.path === 'runId' && p.code === 'already-admitted') || problems.some((p) => Object.hasOwn(p, 'message'))) {
          throw new Error(`P14: an invalid request was recorded with ${JSON.stringify(problems)}; each problem keeps its path and code and no message`);
        }
      });
    },
  },
  'admission:unsafe-above-l1': admissionRow('admission:unsafe-above-l1', 'p14-unsafe-', async (rig) => {
    const { startRun } = await api();
    await startRun(await rig.request(await rig.components(), { requestedLevel: 2 }));
  }),
  'admission:cost-unapproved': admissionRow('admission:cost-unapproved', 'p14-cost-', async (rig) => {
    const { startRun } = await api();
    await startRun(await rig.request(await rig.components(), { approvedCostUsd: 0 }));
  }),
  'admission:controls-unavailable': { kind: 'blocked-above-l1' },
  'admission:policy-refused': admissionRow('admission:policy-refused', 'p14-policy-', async (rig) => {
    const { startRun } = await api();
    await startRun(await rig.request(await rig.components(), { policy: await linePolicy({}, { stationCaps: { build: 0 } }) }));
  }),
  'admission:refused': admissionRow('admission:refused', 'p14-capability-', async (rig) => {
    const { startRun } = await api();
    const lacking = await stubDriver({ capabilities: { parallelism: 0 } });
    await startRun(await rig.request(await rig.components({ driver: lacking, reviewer: await stubDriver() })));
  }),
  'resume:unsafe-above-l1': { kind: 'blocked-above-l1' },
  'resume:refused': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-resume-', async (rig) => {
        const { resumeRun } = await api();
        await stoppedForApproval(rig);
        const reviewer = await stubDriver({ capabilities: { parallelism: 0 } });
        const components = await rig.components({ reviewer });
        refusalOf(await resumeRun({ runId: rig.runId, components }), 'P14 resume');
        const d = await expectDecision(rig, components.vault, 'resume:refused', { decidedBy: 'admission', taskId: null, station: null });
        if (d.decision.cause !== 'resume-refused' || d.decision.refusal.reason !== 'refused' || d.decision.refusal.refusal.reason !== 'capability-missing') {
          throw new Error(`P14: a resume refused for a missing capability was recorded as ${JSON.stringify(d.decision)}`);
        }
      });
    },
  },
  'station:gate-failed': { kind: 'unconstructed' },
  'station:lock-tamper': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-tamper-', async (rig) => {
        const { startRun } = await api();
        const writer = await stubDriver({ during: async () => writeFile(join(rig.dirs.artifacts, 'spec.md'), '# hello\n\nWidened by the agent.\n') });
        const components = await rig.components({ driver: writer, reviewer: writer });
        refusalOf(await startRun(await rig.request(components)), 'P14 tamper');
        // Found at the station's lock check, over no task: the decision names what its violation names (D-P14-13).
        await expectDecision(rig, components.vault, 'station:lock-tamper', { decidedBy: 'line', taskId: null, station: 'build' });
      });
    },
  },
  'station:violation': {
    kind: 'scenario',
    run: () => escapeScenario(async (rig, vault) => {
      await expectDecision(rig, vault, 'station:violation', { decidedBy: 'line', taskId: HELLO_TASK, station: 'verify' });
    }),
  },
  'station:unsafe-above-l1': { kind: 'unconstructed' },
  'station:capability-missing': {
    kind: 'scenario',
    run: async () => {
      // A driver that declares the capability when admission checks it and not when build does: the line's own check refuses.
      await withLine('p14-station-capability-', async (rig) => {
        const { startRun } = await api();
        const inner = await stubDriver();
        let asked = 0;
        const driver = {
          ...inner,
          capabilities: () => {
            asked += 1;
            return asked === 1 ? inner.capabilities() : { ...inner.capabilities(), parallelism: 0 };
          },
        };
        const components = await rig.components({ driver, reviewer: await stubDriver() });
        const refusal = refusalOf(await startRun(await rig.request(components)), 'P14 station capability');
        if (refusal.transition.reason !== 'capability-missing' || refusal.state === null) {
          throw new Error(`P14: a driver that lost a capability was refused as ${refusal.transition.reason}, with state ${String(refusal.state !== null)}`);
        }
        await expectDecision(rig, components.vault, 'station:capability-missing', { decidedBy: 'station-machine', taskId: HELLO_TASK, station: 'build' });
      });
    },
  },
  'station:approval-blocked': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-blocked-', async (rig) => {
        const { startRun } = await api();
        const components = await rig.components();
        refusalOf(await startRun(await rig.request(components, { policy: await linePolicy({ 'review:1': 'blocked' }) })), 'P14 blocked');
        await expectDecision(rig, components.vault, 'station:approval-blocked', { decidedBy: 'station-machine', taskId: null, station: 'review' });
      });
    },
  },
  'station:approval-required': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-required-', async (rig) => {
        const { runStanding } = await api();
        const components = await rig.components();
        await stoppedForApproval(rig, components);
        const d = await expectDecision(rig, components.vault, 'station:approval-required', { decidedBy: 'station-machine', taskId: null, station: 'integrate' });
        if (Number.isNaN(Date.parse(d.decidedAt))) throw new Error(`P14: approval-required was recorded with time ${d.decidedAt}`);
        // Reading where a run stands derives the same refusal and decides nothing.
        const before = (await components.vault.readDecisions(rig.runId)).length;
        await runStanding(components.vault, rig.runId);
        if ((await components.vault.readDecisions(rig.runId)).length !== before) throw new Error('P14: a status read recorded a decision');
      });
    },
  },
  'station:same-family-reviewer': { kind: 'blocked-above-l1' },
  'station:parked:iterations-exhausted': { kind: 'scenario', run: () => parkScenario('iterations-exhausted') },
  'station:parked:retries-exhausted': { kind: 'scenario', run: () => parkScenario('retries-exhausted') },
  'station:parked:starts-exhausted': { kind: 'scenario', run: () => parkScenario('starts-exhausted') },
  'station:cancelled': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-cancel-', async (rig) => {
        const { cancelRun, resumeRun } = await api();
        const components = await rig.components();
        await stoppedForApproval(rig, components);
        const cancelled = await cancelRun({ runId: rig.runId, by: 'maintainer', vault: components.vault });
        if (!cancelled.ok) throw new Error(`P14: the cancel was refused: ${cancelled.message}`);
        refusalOf(await resumeRun({ runId: rig.runId, components }), 'P14 cancelled');
        await expectDecision(rig, components.vault, 'station:cancelled', { decidedBy: 'station-machine', taskId: null, station: 'integrate' });
      });
    },
  },
  'station:halted': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-halt-', async (rig) => {
        const { resumeRun } = await api();
        const components = await rig.components();
        await stoppedForApproval(rig, components);
        // What the service commits when a drive ends in an error (A-P9-02).
        const state = await rig.state();
        await components.vault.commitRunState({ ...state, halted: { at: new Date().toISOString(), message: 'the drive failed' } }, state.version);
        refusalOf(await resumeRun({ runId: rig.runId, components }), 'P14 halted');
        await expectDecision(rig, components.vault, 'station:halted', { decidedBy: 'station-machine', taskId: null, station: 'integrate' });
      });
    },
  },
  'approval-granted': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-granted-', async (rig) => {
        const { approveStation } = await api();
        const components = await rig.components();
        const key = await stoppedForApproval(rig, components);
        const approved = await approveStation({ runId: rig.runId, key: key as never, approvedBy: 'maintainer', vault: components.vault });
        if (!approved.ok) throw new Error(`P14: the approval was refused: ${approved.message}`);
        const d = await expectDecision(rig, components.vault, 'approval-granted', { decidedBy: 'approval', taskId: null, station: 'integrate' });
        if (d.decision.cause !== 'approval-granted' || d.decision.principal !== 'maintainer' || d.decision.key !== key) {
          throw new Error(`P14: the grant was recorded as ${JSON.stringify(d.decision)}`);
        }
      });
    },
  },
  'approval-refused:invalid-request': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-approval-invalid-', async (rig) => {
        const { approveStation } = await api();
        const components = await rig.components();
        const key = await stoppedForApproval(rig, components);
        await approveStation({ runId: rig.runId, key: 'not a key' as never, approvedBy: 'maintainer', vault: components.vault });
        const d = await expectDecision(rig, components.vault, 'approval-refused:invalid-request', { decidedBy: 'approval', taskId: null, station: null });
        if (d.decision.cause !== 'approval-refused' || d.decision.key !== null) {
          throw new Error(`P14: a malformed key was recorded as ${JSON.stringify(d.decision)}; the caller's text is not stored`);
        }
        // A blank principal is refused too, and its key is kept because it is a key.
        await approveStation({ runId: rig.runId, key: key as never, approvedBy: ' ', vault: components.vault });
        const both = (await decisionsOf(rig, components.vault)).filter((x) => keyOf(x.decision) === 'approval-refused:invalid-request');
        if (!both.some((x) => x.decision.cause === 'approval-refused' && x.decision.key === key)) throw new Error('P14: a blank approver was not recorded with its key');
      });
    },
  },
  'approval-refused:not-awaiting': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-approval-early-', async (rig) => {
        const { approveStation } = await api();
        const components = await rig.components();
        await stoppedForApproval(rig, components);
        const refused = await approveStation({ runId: rig.runId, key: 'build:1', approvedBy: 'maintainer', vault: components.vault });
        if (refused.ok) throw new Error('P14: an approval of an exit the run is not at was granted');
        const d = await expectDecision(rig, components.vault, 'approval-refused:not-awaiting', { decidedBy: 'approval', taskId: null, station: 'integrate' });
        if (d.decision.cause !== 'approval-refused' || d.decision.key !== 'build:1') throw new Error(`P14: recorded as ${JSON.stringify(d.decision)}`);
      });
    },
  },
  'egress:opened': { kind: 'scenario', run: () => egressScenario('opened') },
  'egress:tunnelled': { kind: 'scenario', run: () => egressScenario('tunnelled') },
  'egress:refused': { kind: 'scenario', run: () => egressScenario('refused') },
  'violation-recorded': {
    kind: 'scenario',
    run: () => escapeScenario(async (rig, vault, state) => {
      const [violation] = state.violations;
      if (violation === undefined) throw new Error('P14: the escape recorded no violation');
      const before = await vault.read(violation);
      const d = await expectDecision(rig, vault, 'violation-recorded', { decidedBy: 'line', taskId: HELLO_TASK, station: 'verify' });
      if (d.decision.cause !== 'violation-recorded' || JSON.stringify(d.decision.violation) !== JSON.stringify(violation)) {
        throw new Error(`P14: the violation decision points at ${JSON.stringify(d.decision)}, not ${JSON.stringify(violation)}`);
      }
      if (Buffer.compare(Buffer.from(before), Buffer.from(await vault.read(violation))) !== 0) throw new Error('P14: the violation record changed');
    }).then(claimMismatchScenario),
  },
  'relay-refused': {
    kind: 'scenario',
    run: async () => {
      await withLine('p14-relay-', async (rig) => {
        const refusing: MeterReading = { kind: 'metered', calls: 3, inputTokens: 300, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1, exhausted: 'cost', refused: 2 };
        const sandbox = await reportingProvider((n) => (n === 1 ? { meter: refusing } : {}));
        const components = await rig.components({ sandbox });
        await stoppedForApproval(rig, components);
        const [usage] = (await rig.state()).usage;
        const d = await expectDecision(rig, components.vault, 'relay-refused', { decidedBy: 'model-relay', taskId: HELLO_TASK, station: 'build' });
        if (d.decision.cause !== 'relay-refused' || JSON.stringify(d.decision.usage) !== JSON.stringify(usage) || d.decision.refused !== 2 || d.decision.exhausted !== 'cost') {
          throw new Error(`P14: the relay's refusals were recorded as ${JSON.stringify(d.decision)}`);
        }
        // A call whose relay refused nothing records no relay decision.
        const relayed = (await decisionsOf(rig, components.vault)).filter((x) => x.decision.cause === 'relay-refused');
        if (relayed.length !== 1) throw new Error(`P14: ${String(relayed.length)} relay decisions for one refusing call`);
      });
    },
  },
};

/** The literals whose `reason` property is declared by `StationRefusal`, found in a package's own source. */
/**
 * The string a literal's `reason` property is set to, however it is spelled:
 * a quoted key, and a literal inside parentheses, `as`, `satisfies`, or an
 * angle-bracket assertion, all count (external review of P14, codex-7).
 */
function reasonOf(node: ts.ObjectLiteralExpression): string | undefined {
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const { name } = property;
    if (!((ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === 'reason')) continue;
    let value: ts.Expression = property.initializer;
    while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isSatisfiesExpression(value) || ts.isTypeAssertionExpression(value)) {
      value = value.expression;
    }
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
  }
  return undefined;
}

/** The control for `reasonOf`: each spelling of one arm is read as that arm, so a scan that finds nothing is not blind to it. */
function reasonOfReadsEverySpelling(): void {
  const spellings = [
    "({ reason: 'gate-failed' })",
    "({ 'reason': 'gate-failed' })",
    "({ \"reason\": 'gate-failed' })",
    "({ reason: ('gate-failed') })",
    "({ reason: 'gate-failed' as const })",
    "({ reason: ('gate-failed' as const) })",
    "({ reason: 'gate-failed' satisfies string })",
    "({ reason: <const>'gate-failed' })",
    '({ reason: `gate-failed` })',
  ];
  for (const text of spellings) {
    const sf = ts.createSourceFile('spelling.ts', text, ts.ScriptTarget.Latest, true);
    let read: string | undefined;
    walk(sf, (node) => {
      if (ts.isObjectLiteralExpression(node)) read = reasonOf(node);
    });
    if (read !== 'gate-failed') throw new Error(`P14: the scan reads ${text} as ${String(read)}, so that spelling would construct the arm unseen`);
  }
}

function stationRefusalReasons(packageName: string): Array<{ reason: string; file: string }> {
  const pkg = workspacePackages().find((p) => p.name === packageName);
  if (pkg === undefined) throw new Error(`P14: no workspace package ${packageName}`);
  const { files, checker } = packageProgram(pkg);
  const found: Array<{ reason: string; file: string }> = [];
  for (const sf of files) {
    if (!sf.fileName.includes('/src/')) continue;
    walk(sf, (node) => {
      if (!ts.isObjectLiteralExpression(node)) return;
      const reason = reasonOf(node);
      if (reason === undefined) return;
      const contextual = checker.getContextualType(node);
      if (contextual === undefined) return;
      const members = contextual.isUnion() ? contextual.types : [contextual];
      const declaredByStationRefusal = members.some((member) =>
        (member.getProperty('reason')?.declarations ?? []).some((d) => d.getSourceFile().fileName.endsWith('core/src/station/types.ts')),
      );
      if (declaredByStationRefusal) found.push({ reason, file: workspaceRelative(sf.fileName) });
    });
  }
  return found;
}

async function checkMark(key: CauseKey, row: Exclude<Row, { kind: 'scenario' }>): Promise<void> {
  switch (row.kind) {
    case 'unconstructed': {
      const reason = key.slice('station:'.length);
      reasonOfReadsEverySpelling();
      const built = [...stationRefusalReasons('@olympus-ai/core'), ...stationRefusalReasons('@olympus-ai/api')];
      // The control: arms the line is known to build are found, so an empty scan is not read as proof.
      for (const known of ['lock-tamper', 'parked', 'approval-required']) {
        if (!built.some((b) => b.reason === known)) throw new Error(`P14: the scan found no '${known}' refusal, so it cannot show one is absent`);
      }
      const site = built.find((b) => b.reason === reason);
      if (site !== undefined) throw new Error(`P14: ${key} is marked unconstructed and ${site.file} constructs it; give it a scenario (D-P14-10)`);
      return;
    }
    case 'blocked-above-l1': {
      for (const level of [2, 3] as const) {
        await withLine(`p14-blocked-l${String(level)}-`, async (rig) => {
          const { startRun } = await api();
          const outcome = await startRun(await rig.request(await rig.components(), { requestedLevel: level }));
          if (outcome.ok || outcome.reason !== 'unsafe-above-l1' || !outcome.unsafe.some((u) => u.component === 'SkeletonLine')) {
            throw new Error(`P14: ${key} is marked blocked above L1 and an L${String(level)} run was not refused for the skeleton line; give it a scenario (D-P14-12)`);
          }
        });
      }
      return;
    }
  }
}

export const ENFORCEMENT_DECISIONS_RECORDED: LocalAssertion = runtime({
  id: 'I2.enforcement-decisions-recorded-by-the-enforcer',
  title:
    'every cause of an enforcement decision — each admission and resume refusal, each station refusal and park by cause, each approval granted or refused, each egress connection, each violation, and each relay refusal — is recorded through recordDecision, naming the component that decided, the run, task, and station, and verifies with sha256sum alone; a refused admission leaves only its decision; a status read records nothing; a cause with no scenario has a mark whose check fails when it stops holding (D-P14-10, D-P14-12)',
  run: async () => {
    const failures: string[] = [];
    for (const [key, row] of Object.entries(DECISION_TABLE) as Array<[CauseKey, Row]>) {
      try {
        await (row.kind === 'scenario' ? row.run() : checkMark(key, row));
      } catch (error) {
        failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    try {
      await failsClosed();
    } catch (error) {
      failures.push(`fail-closed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (failures.length > 0) throw new Error(`P14: ${String(failures.length)} check(s) failed:\n${failures.join('\n')}`);
  },
});

/** A Vault that refuses every decision, forwarding everything else. */
function refusingDecisions(inner: Vault): Vault {
  return { ...around(inner, {}), recordDecision: () => Promise.reject(new Error('the decision store is unavailable')) };
}

/**
 * I5: a decision that cannot be written stops what it records (D-P14-07). A
 * line whose Vault refuses the write throws rather than returning an
 * unrecorded refusal, and an approval whose decision cannot be written is not
 * granted: no grant reaches run state.
 */
async function failsClosed(): Promise<void> {
  await withLine('p14-closed-line-', async (rig) => {
    const { startRun } = await api();
    const base = await rig.components();
    // The throw must be the refused write's: any other exception before it would pass a bare "it threw" (external review of P14, codex-6).
    let attempts = 0;
    const vault: Vault = { ...refusingDecisions(base.vault), recordDecision: () => { attempts += 1; return refusingDecisions(base.vault).recordDecision(null as never); } };
    let threw = false;
    try {
      await startRun(await rig.request({ ...base, vault }));
    } catch {
      threw = true;
    }
    if (attempts === 0) throw new Error('the line never tried to write a decision, so its throw is not the refused write');
    if (!threw) throw new Error('a line whose Vault refused a decision returned instead of throwing');
  });
  await withLine('p14-closed-approval-', async (rig) => {
    const { approveStation } = await api();
    const components = await rig.components();
    const key = await stoppedForApproval(rig, components);
    const outcome = await approveStation({ runId: rig.runId, key: key as never, approvedBy: 'maintainer', vault: refusingDecisions(components.vault) }).catch(
      (error: unknown) => ({ ok: false as const, error }),
    );
    if (outcome.ok) throw new Error('an approval whose decision could not be written was granted');
    if ((await rig.state()).approvals.length !== 0) throw new Error('an approval whose decision could not be written reached run state');
  });
}
