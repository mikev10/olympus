/**
 * R4: parallel task execution. Every assertion here drives the real line over
 * the filesystem Vault and the stub sandbox, with a stub driver that declares
 * more than one task at once, so what the line does with concurrency is
 * observed without a model or a container.
 *
 * The graphs are wide: build tasks with no dependency between them, each
 * writing its own file under `parts/`, and one review task over all of them.
 * The manifest's reproduction passes when `parts/` holds at least one file
 * and every file in it reads `good`, and fails on the base, which has none.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunState, StationRefusal, TaskId, TaskRequest } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { EnforcementDecision, EvidenceBundle, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { around } from './line-assertions.js';
import { comparable, linePolicy, readRecord, refusalOf, stubDriver, withLine, writeManifest, type DriverOptions, type LineRig, type ObservedDriver } from './line.js';
import { inTask, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');

const REVIEW = 'parts-review' as TaskId;

/** Each file in `parts/` reads `good`, and there is at least one. The directory's name is built, so the command names no path a task writes (D-R15-03). */
const PARTS_GOOD = {
  id: 'parts-good',
  kind: 'behavioral',
  onBase: 'fails',
  command: [
    'node',
    '-e',
    "const fs = require('node:fs'); const d = ['pa', 'rts'].join(''); const f = fs.existsSync(d) ? fs.readdirSync(d) : []; process.exit(f.length > 0 && f.every((n) => fs.readFileSync(d + '/' + n, 'utf8') === 'good') ? 0 : 1)",
  ],
  required: true,
  timeoutMs: 10_000,
};

/** `ids` as independent build tasks, in this order, and `extra` after them; one review over every build task. */
async function wideGraph(rig: LineRig, ids: readonly string[], extra: ReadonlyArray<{ id: string; dependsOn: string[] }> = []): Promise<void> {
  const builds = [...ids.map((id) => ({ id, dependsOn: [] as string[] })), ...extra];
  await writeFile(
    join(rig.dirs.artifacts, 'graph.json'),
    JSON.stringify({
      tasks: [
        ...builds.map(({ id, dependsOn }) => ({ id, station: 'build', role: 'builder', dependsOn, dependencySet: ['**'] })),
        { id: REVIEW, station: 'review', role: 'reviewer', dependsOn: builds.map((b) => b.id), dependencySet: ['**'] },
      ],
    }),
  );
  await writeManifest(rig.dirs, [PARTS_GOOD]);
}

/** How long a call waits for its siblings to reach the driver: past it, the ones absent are not running alongside. */
const MEET_MS = 1_500;

function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Overlap as the driver saw it: how many builder calls were inside `runTask` at once, at most. */
interface Overlap {
  mostAtOnce: number;
}

/**
 * A stub declaring `parallelism`, whose builder calls each write
 * `parts/<task>.txt` as `good` (or what `write` says) and hold the call open
 * for `holdMs`, counted in `overlap`. With `meet`, a call that has written
 * first waits until `meet` calls have written or `MEET_MS` passes, so whether
 * calls overlap is decided by the line and not by how fast a loaded host
 * reaches each one. `during` runs after that.
 */
async function wideDriver(
  sandbox: SandboxProvider,
  parallelism: number,
  options: { holdMs?: number; meet?: number; overlap?: Overlap; write?: (req: TaskRequest, call: number) => Record<string, string> | null; during?: DriverOptions['during'] } = {},
): Promise<ObservedDriver> {
  let inside = 0;
  let written = 0;
  const calls = new Map<TaskId, number>();
  return stubDriver({
    capabilities: { parallelism },
    during: async (req) => {
      if (req.role !== ('builder' as TaskRequest['role'])) return;
      const call = (calls.get(req.taskId) ?? 0) + 1;
      calls.set(req.taskId, call);
      inside += 1;
      let wrote = false;
      if (options.overlap !== undefined) options.overlap.mostAtOnce = Math.max(options.overlap.mostAtOnce, inside);
      try {
        const files = options.write === undefined ? { [`parts/${req.taskId}.txt`]: 'good' } : options.write(req, call);
        if (files !== null) await inTask(sandbox, req, writes(files));
        written += 1;
        wrote = true;
        const until = Date.now() + MEET_MS;
        while (options.meet !== undefined && written < options.meet && Date.now() < until) await delay(10);
        if (options.during !== undefined) await options.during(req);
        await delay(options.holdMs ?? 150);
      } finally {
        inside -= 1;
        if (wrote) written -= 1;
      }
    },
  });
}

async function stubSandbox(): Promise<SandboxProvider> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  return new StubSandboxProvider();
}

/** Starts the run under `concurrency` and returns its refusal, which a wide graph that passed makes at the integrate approval. */
async function runWide(rig: LineRig, driver: ObservedDriver, sandbox: SandboxProvider, concurrency: { maxParallelTasks: number; maxConflictRetries: number }) {
  const { startRun } = await api();
  const components = await rig.components({ driver, sandbox }, { work: false });
  const policy = await linePolicy({}, { concurrency });
  return refusalOf(await startRun(await rig.request(components, { policy })), 'R4 run');
}

function expectIntegrateApproval(t: StationRefusal, context: string): void {
  if (t.reason !== 'approval-required' || t.key !== 'integrate:1') throw new Error(`${context}: the run ended as ${JSON.stringify(t)}, not at the integrate approval`);
}

async function decisionsOf(vault: Vault, rig: LineRig): Promise<EnforcementDecision[]> {
  return Promise.all((await vault.readDecisions(rig.runId)).map((ref) => readRecord<EnforcementDecision>(vault, ref)));
}

/** The bundles the run wrote, in the order it wrote them. */
async function bundlesOf(vault: Vault, state: RunState): Promise<EvidenceBundle[]> {
  return Promise.all(state.evidenceRefs.map((ref) => readRecord<EvidenceBundle>(vault, ref)));
}

export const PARALLELISM_CAPPED_BY_POLICY_AND_DRIVER: LocalAssertion = runtime({
  id: 'I4.parallelism-capped-by-policy-and-driver',
  title:
    'with maxParallelTasks 2 and a driver declaring 3, three independent tasks build two at a time and the third never runs alongside them; with the driver declaring 1, no two builds overlap; every task still passes',
  run: async () => {
    for (const [declared, expected] of [[3, 2], [1, 1]] as const) {
      await withLine(`r4-i4-cap-${String(declared)}-`, async (rig) => {
        await wideGraph(rig, ['a', 'b', 'c']);
        const sandbox = await stubSandbox();
        const overlap: Overlap = { mostAtOnce: 0 };
        // Each call waits for a third: one the line let run alongside would arrive, and one it held back cannot.
        const driver = await wideDriver(sandbox, declared, { overlap, meet: 3, holdMs: 10 });
        expectIntegrateApproval((await runWide(rig, driver, sandbox, { maxParallelTasks: 2, maxConflictRetries: 0 })).transition, 'I4');
        if (overlap.mostAtOnce !== expected) {
          throw new Error(`I4: with maxParallelTasks 2 and a driver declaring ${String(declared)}, ${String(overlap.mostAtOnce)} builds ran at once, not ${String(expected)}`);
        }
        // Calls in one batch reach the driver in whatever order their setup finishes; each task is built once.
        const built = driver.requests.filter((r) => r.role === ('builder' as TaskRequest['role'])).map((r) => r.taskId).sort();
        if (JSON.stringify(built) !== JSON.stringify(['a', 'b', 'c'])) throw new Error(`I4: the builds were ${JSON.stringify(built)}, not each task once`);
        const { tasks } = await rig.state();
        if (tasks['a' as TaskId] !== 'passed' || tasks['b' as TaskId] !== 'passed' || tasks['c' as TaskId] !== 'passed') throw new Error(`I4: the tasks ended ${JSON.stringify(tasks)}`);
      });
    }
  },
});

export const SIBLING_NEVER_SEES_UNACCEPTED_WORK: LocalAssertion = runtime({
  id: 'I3.sibling-never-sees-unaccepted-work',
  title:
    'two siblings built at once each start from base and accepted changes only: each writes its file, waits while the other writes, and finds the other\'s file absent from its own tree; the accepted tree then holds both',
  run: async () => {
    await withLine('r4-i3-sibling-', async (rig) => {
      await wideGraph(rig, ['a', 'b']);
      const sandbox = await stubSandbox();
      const seen: Record<string, boolean> = {};
      const overlap: Overlap = { mostAtOnce: 0 };
      const driver = await wideDriver(sandbox, 2, {
        overlap,
        // Each looks only once both have written.
        meet: 2,
        during: async (req) => {
          const other = req.taskId === ('a' as TaskId) ? 'parts/b.txt' : 'parts/a.txt';
          seen[req.taskId] = JSON.parse(await inTask(sandbox, req, `console.log(JSON.stringify(require('node:fs').existsSync(${JSON.stringify(other)})))`)) as boolean;
        },
      });
      expectIntegrateApproval((await runWide(rig, driver, sandbox, { maxParallelTasks: 2, maxConflictRetries: 0 })).transition, 'I3');
      if (overlap.mostAtOnce !== 2) throw new Error(`I3: the siblings did not build at once (${String(overlap.mostAtOnce)} at most), so nothing was shown`);
      if (seen.a !== false || seen.b !== false) throw new Error(`I3: a sibling's unaccepted change was in another's tree: ${JSON.stringify(seen)}`);
    });
  },
});

/**
 * Two siblings both writing `parts/shared.txt`, built at once under
 * `maxConflictRetries`. What the second to verify saw in its tree on each call
 * is kept, so a rebuild can be shown to start over the accepted change.
 */
async function conflictRun(rig: LineRig, maxConflictRetries: number): Promise<{ refusal: StationRefusal; driver: ObservedDriver; sawSibling: boolean[]; vault: Vault }> {
  await wideGraph(rig, ['a', 'b']);
  const sandbox = await stubSandbox();
  const sawSibling: boolean[] = [];
  const driver = await wideDriver(sandbox, 2, {
    write: (req) => ({ 'parts/shared.txt': 'good', [`parts/${req.taskId}.txt`]: 'good' }),
    during: async (req) => {
      if (req.taskId !== ('b' as TaskId)) return;
      // The sibling's own file is in this task's tree only when the tree was built over the sibling's accepted change.
      sawSibling.push(JSON.parse(await inTask(sandbox, req, "console.log(JSON.stringify(require('node:fs').existsSync('parts/a.txt')))")) as boolean);
    },
  });
  const outcome = await runWide(rig, driver, sandbox, { maxParallelTasks: 2, maxConflictRetries });
  return { refusal: outcome.transition, driver, sawSibling, vault: (await rig.components()).vault };
}

/** The `task-conflict` decisions the run recorded, each checked as the line's, at verify, over task `b`, naming `a` and the shared path. */
async function conflictDecisions(rig: LineRig, vault: Vault, expected: number, context: string): Promise<void> {
  const conflicts = (await decisionsOf(vault, rig)).filter((d) => d.decision.cause === 'task-conflict');
  if (conflicts.length !== expected) throw new Error(`${context}: ${String(conflicts.length)} task-conflict decisions, not ${String(expected)}`);
  for (const d of conflicts) {
    const c = d.decision;
    if (c.cause !== 'task-conflict' || d.station !== 'verify' || d.taskId !== 'b' || c.task !== 'b'
      || JSON.stringify(c.with) !== '["a"]' || JSON.stringify(c.paths) !== '["parts/shared.txt"]') {
      throw new Error(`${context}: a conflict was recorded as ${JSON.stringify(d)}`);
    }
  }
}

export const CONFLICT_RETRIES_THEN_PARKS: LocalAssertion = runtime({
  id: 'I5.conflict-retries-then-parks',
  title:
    'two siblings writing one path: the second to verify is recorded as a conflict naming the first and the path, in run state and as the line\'s task-conflict decision, and is rebuilt over the accepted tree, spending no failed gate; with maxConflictRetries 0 the first conflict parks it with conflicts-exhausted naming both tasks and the path, and nothing is merged or overwritten',
  run: async () => {
    await withLine('r4-i5-conflict-retry-', async (rig) => {
      const { refusal, driver, sawSibling, vault } = await conflictRun(rig, 1);
      expectIntegrateApproval(refusal, 'I5 conflict retry');
      const state = await rig.state();
      const b = state.attempts['b' as TaskId];
      if (b?.iterations !== 2 || JSON.stringify(b.conflicts) !== '[{"with":["a"],"paths":["parts/shared.txt"]}]') {
        throw new Error(`I5: after one conflict the second task's attempts are ${JSON.stringify(b)}`);
      }
      // Its first start tree held none of the sibling's work, and the rebuild's held the accepted change.
      if (JSON.stringify(sawSibling) !== '[false,true]') throw new Error(`I5: the conflicting task's start trees held the sibling's file: ${JSON.stringify(sawSibling)}`);
      if (driver.requests.filter((r) => r.taskId === ('b' as TaskId)).length !== 2) throw new Error('I5: the conflicting task was not rebuilt exactly once');
      await conflictDecisions(rig, vault, 1, 'I5 conflict retry');
      // A conflict is not a failed gate: no gate-failed decision was recorded.
      const gates = (await decisionsOf(vault, rig)).filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'gate-failed');
      if (gates.length !== 0) throw new Error(`I5: a conflict was recorded as ${String(gates.length)} failed gate(s)`);
    });

    await withLine('r4-i5-conflict-park-', async (rig) => {
      const { refusal, driver, vault } = await conflictRun(rig, 0);
      if (refusal.reason !== 'parked' || refusal.cause !== 'conflicts-exhausted' || refusal.task !== 'b' || refusal.limit !== 0
        || JSON.stringify(refusal.conflictsWith) !== '["a"]' || JSON.stringify(refusal.paths) !== '["parts/shared.txt"]') {
        throw new Error(`I5: a conflict past maxConflictRetries 0 ended as ${JSON.stringify(refusal)}`);
      }
      if (driver.requests.filter((r) => r.taskId === ('b' as TaskId)).length !== 1) throw new Error('I5: a task past its conflict bound was rebuilt');
      const state = await rig.state();
      if (state.tasks['a' as TaskId] !== 'passed' || state.tasks['b' as TaskId] !== 'parked') throw new Error(`I5: the tasks ended ${JSON.stringify(state.tasks)}`);
      // The parked task's change was never composed: the only bundle is the first task's.
      const bundles = await bundlesOf(vault, state);
      if (bundles.length !== 1 || bundles[0]?.taskId !== 'a') throw new Error(`I5: the parked task's change reached a bundle: ${JSON.stringify(bundles.map((x) => x.taskId))}`);
      await conflictDecisions(rig, vault, 1, 'I5 conflict park');
    });
  },
});

export const NO_ACCEPTED_CHANGE_IS_LOST: LocalAssertion = runtime({
  id: 'I5.no-accepted-change-is-lost',
  title:
    'siblings built at once writing different paths are each in the accepted tree integrate opens: the latest bundle\'s cumulative diff carries every sibling\'s path, and no conflict is recorded',
  run: async () => {
    await withLine('r4-i5-lost-', async (rig) => {
      await wideGraph(rig, ['a', 'b', 'c']);
      const sandbox = await stubSandbox();
      const overlap: Overlap = { mostAtOnce: 0 };
      const driver = await wideDriver(sandbox, 3, { overlap, meet: 3 });
      expectIntegrateApproval((await runWide(rig, driver, sandbox, { maxParallelTasks: 3, maxConflictRetries: 0 })).transition, 'I5 lost');
      if (overlap.mostAtOnce !== 3) throw new Error(`I5: the siblings did not build at once (${String(overlap.mostAtOnce)} at most)`);
      const vault = (await rig.components()).vault;
      const state = await rig.state();
      const latest = (await bundlesOf(vault, state)).at(-1);
      const paths = latest?.diff.map((e) => e.path).sort();
      if (JSON.stringify(paths) !== '["parts/a.txt","parts/b.txt","parts/c.txt"]') throw new Error(`I5: the accepted tree carries ${JSON.stringify(paths)}`);
      if ((await decisionsOf(vault, rig)).some((d) => d.decision.cause === 'task-conflict')) throw new Error('I5: siblings on different paths were recorded as conflicting');
    });
  },
});

export const PARK_FINISHES_SIBLINGS: LocalAssertion = runtime({
  id: 'I5.park-finishes-siblings',
  title:
    'a task that parks while a sibling builds: the sibling finishes, its result, usage and status are recorded, no dependent of the parked task starts, and the run refuses with the park',
  run: async () => {
    await withLine('r4-i5-park-', async (rig) => {
      // Two at once: the failing task builds beside a new sibling in each batch, and parks beside the last.
      await wideGraph(rig, ['a', 'b1', 'b2', 'b3'], [{ id: 'd', dependsOn: ['a'] }]);
      const sandbox = await stubSandbox();
      const driver = await wideDriver(sandbox, 2, {
        holdMs: 10,
        during: async (req) => {
          if (req.taskId === ('a' as TaskId)) throw new Error('the model provider is unreachable');
          if (req.taskId !== ('b3' as TaskId)) return;
          // The last sibling is still building when its neighbour parks: it waits for the park's commit.
          for (let i = 0; i < 200; i += 1) {
            if ((await rig.state()).tasks['a' as TaskId] === 'parked') return;
            await delay(50);
          }
          throw new Error('the failing task never parked while its sibling built');
        },
      });
      const refusal = (await runWide(rig, driver, sandbox, { maxParallelTasks: 2, maxConflictRetries: 0 })).transition;
      if (refusal.reason !== 'parked' || refusal.task !== 'a' || refusal.cause !== 'retries-exhausted') throw new Error(`I5: the run ended as ${JSON.stringify(refusal)}`);
      const state = await rig.state();
      const sibling = 'b3' as TaskId;
      if (state.tasks[sibling] !== 'verifying' || !Object.hasOwn(state.results, sibling)) {
        throw new Error(`I5: the sibling building beside the park ended ${String(state.tasks[sibling])} with ${Object.hasOwn(state.results, sibling) ? 'a' : 'no'} result`);
      }
      const vault = (await rig.components()).vault;
      const usage = await Promise.all(state.usage.map((ref) => readRecord<{ taskId: TaskId; reading: { kind: string } }>(vault, ref)));
      if (!usage.some((u) => u.taskId === sibling && u.reading.kind !== 'lost')) throw new Error('I5: the sibling\'s call has no usage record');
      if (driver.requests.some((r) => r.taskId === ('d' as TaskId))) throw new Error('I5: a dependent of the parked task started');
      if (Object.hasOwn(state.tasks, 'd') && state.tasks['d' as TaskId] !== 'pending') throw new Error(`I5: the dependent ended ${String(state.tasks['d' as TaskId])}`);
    });
  },
});

export const PARALLEL_RESUME_MATCHES: LocalAssertion = runtime({
  id: 'I5.parallel-resume-matches',
  title:
    'a run stopped mid-batch, after one sibling\'s result is committed and between the other\'s settled call and the commit of its result, and resumed reaches the state an uninterrupted run reaches: the task in flight is run again as a replay, spending a start and no iteration, and its sibling is not run again',
  run: async () => {
    let uninterrupted: unknown;
    await withLine('r4-i5-whole-', async (rig) => {
      await wideGraph(rig, ['a', 'b']);
      const sandbox = await stubSandbox();
      expectIntegrateApproval((await runWide(rig, await wideDriver(sandbox, 2), sandbox, { maxParallelTasks: 2, maxConflictRetries: 0 })).transition, 'I5 whole');
      uninterrupted = comparable(await rig.state());
    });
    await withLine('r4-i5-resume-', async (rig) => {
      const { startRun, resumeRun } = await api();
      await wideGraph(rig, ['a', 'b']);
      const sandbox = await stubSandbox();
      const driver = await wideDriver(sandbox, 2, {
        holdMs: 10,
        // The first task is slower, so its sibling's result is committed before the stop.
        during: async (req) => {
          if (req.taskId === ('a' as TaskId)) await delay(400);
        },
      });
      const base = await rig.components({ driver, sandbox }, { work: false });
      // The process stops at the commit that would record the slower task built: its call has settled
      // and its usage is recorded, so the resume replays it rather than refusing a lost meter (D-I1a-12).
      // Nothing after the stop is stored.
      let dead = false;
      const killed = around(base.vault, {
        beforeCommit: (s) => {
          if (dead || s.tasks['a' as TaskId] === 'verifying') {
            dead = true;
            throw new Error('killed mid-batch');
          }
        },
      });
      const policy = await linePolicy({}, { concurrency: { maxParallelTasks: 2, maxConflictRetries: 0 } });
      try {
        await startRun(await rig.request({ ...base, vault: killed }, { policy }));
        throw new Error('I5: the run was not stopped mid-batch');
      } catch (error) {
        if ((error as Error).message !== 'killed mid-batch') throw error;
      }
      const stopped = await rig.state();
      if (stopped.tasks['a' as TaskId] !== 'running' || stopped.tasks['b' as TaskId] !== 'verifying') {
        throw new Error(`I5: the stop left ${JSON.stringify(stopped.tasks)}, not one task built and its sibling in flight`);
      }
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components({ driver, sandbox }, { work: false }) }), 'I5 resume');
      expectIntegrateApproval(resumed.transition, 'I5 resume');
      const state = await rig.state();
      if (JSON.stringify(comparable(state)) !== JSON.stringify(uninterrupted)) {
        throw new Error(`I5: the resumed run reached ${JSON.stringify(comparable(state))}, not ${JSON.stringify(uninterrupted)}`);
      }
      for (const [id, starts] of [['a', 2], ['b', 1]] as const) {
        const spent = state.attempts[id as TaskId];
        if (spent?.iterations !== 1 || spent.starts !== starts) throw new Error(`I5: task ${id} ended with ${JSON.stringify(spent)}, not ${String(starts)} start(s) of one iteration`);
      }
    });
  },
});

export const STATUS_PER_TASK_UNDER_CONCURRENCY: LocalAssertion = runtime({
  id: 'I2.status-per-task-under-concurrency',
  title:
    'two siblings built at once, one whose first change fails the gate: each task\'s status follows its own evidence, so the failing task is failed and rebuilt while its sibling passes on its first iteration, and neither\'s commits change the other\'s status or counts',
  run: async () => {
    await withLine('r4-i2-status-', async (rig) => {
      await wideGraph(rig, ['a', 'b']);
      const sandbox = await stubSandbox();
      const seen: Array<Readonly<Record<string, string>>> = [];
      const driver = await wideDriver(sandbox, 2, {
        write: (req, call) => ({ [`parts/${req.taskId}.txt`]: req.taskId === ('a' as TaskId) && call === 1 ? 'bad' : 'good' }),
      });
      const { startRun } = await api();
      const base = await rig.components({ driver, sandbox }, { work: false });
      const watched = around(base.vault, { beforeCommit: (s) => { seen.push({ ...s.tasks }); } });
      const policy = await linePolicy({}, { concurrency: { maxParallelTasks: 2, maxConflictRetries: 0 } });
      expectIntegrateApproval(refusalOf(await startRun(await rig.request({ ...base, vault: watched }, { policy })), 'I2 run').transition, 'I2');
      const state = await rig.state();
      if (state.attempts['a' as TaskId]?.iterations !== 2 || state.attempts['b' as TaskId]?.iterations !== 1) {
        throw new Error(`I2: the attempts are ${JSON.stringify(state.attempts)}`);
      }
      // The sibling passed, and stayed passed, through every commit the failing task made afterwards.
      const passedAt = seen.findIndex((t) => t.b === 'passed');
      if (passedAt === -1 || seen.slice(passedAt).some((t) => t.b !== 'passed')) throw new Error(`I2: the sibling's status moved after it passed: ${JSON.stringify(seen.map((t) => t.b))}`);
      if (!seen.some((t) => t.a === 'failed' && t.b === 'passed')) throw new Error(`I2: the failing task was never failed beside a passed sibling: ${JSON.stringify(seen)}`);
      const vault = (await rig.components()).vault;
      const failed = (await decisionsOf(vault, rig)).filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'gate-failed');
      if (failed.length !== 1 || failed[0]?.taskId !== 'a') throw new Error(`I2: the failed gates were recorded over ${JSON.stringify(failed.map((d) => d.taskId))}`);
    });
  },
});

/** The two rows R4 adds to P14's scenario table: a conflict, and a park past the conflict bound. */
export async function conflictScenario(kind: 'task-conflict' | 'conflicts-exhausted', check: (d: EnforcementDecision[]) => void): Promise<void> {
  await withLine(`p14-${kind}-`, async (rig) => {
    const { vault } = await conflictRun(rig, kind === 'task-conflict' ? 1 : 0);
    check(await decisionsOf(vault, rig));
  });
}

export const R4_I2: readonly LocalAssertion[] = [STATUS_PER_TASK_UNDER_CONCURRENCY];
export const R4_I3: readonly LocalAssertion[] = [SIBLING_NEVER_SEES_UNACCEPTED_WORK];
export const R4_I4: readonly LocalAssertion[] = [PARALLELISM_CAPPED_BY_POLICY_AND_DRIVER];
export const R4_I5: readonly LocalAssertion[] = [CONFLICT_RETRIES_THEN_PARKS, NO_ACCEPTED_CHANGE_IS_LOST, PARK_FINISHES_SIBLINGS, PARALLEL_RESUME_MATCHES];
