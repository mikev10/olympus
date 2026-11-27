/**
 * R5a: drafting at `plan`. A run admitted with `'draft'` for its task graph
 * seats a planner at `plan`, which proposes the build tasks and their order
 * within the policy's `planning` grant; the proposal goes through the
 * station's gate and is locked before any builder is seated (D-A-GD-01 to
 * D-A-GD-07).
 *
 * Each assertion drives the real admission and line in `@olympus-ai/api` over
 * the filesystem Vault and the stub sandbox, with stub drivers in every seat,
 * as R19's do. No run here goes above L1: admission refuses a stub
 * composition there (D-I1a-06). The floor at L2 and L3 is asserted on the
 * pure transition the line's exit calls, over the conditions the line itself
 * recorded for a draft.
 */
import { existsSync } from 'node:fs';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApprovalKey, AutonomyLevel, DraftCondition, RoleId, TaskId, TaskRequest } from '@olympus-ai/core';
import type { CriticRecord, DraftLockRecord, DraftRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { around } from './line-assertions.js';
import { ARTIFACTS, lineScope, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';
import {
  admitAndDrive, approveAndResume, artifactsFor, awaiting, decisionsOf, drafting, draftingPolicy, helloGraph, lastAttempt, RIG_PLANNING, seat,
  type DraftingRig, type Seats,
} from './drafting.js';
import { PARTS_GOOD, wideDriver, type Overlap } from './parallel.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

/** The hello fixture with its graph drafted and everything else supplied. */
const PLAN_ARTIFACTS = { ...ARTIFACTS, taskGraph: 'draft' };

const PLAN_KEY: ApprovalKey = 'plan:1';

function graphPath(runId: string): string {
  return `.drafts/${runId}/graph.json`;
}

/** One drafted build task as a planner writes it. */
function task(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'], objective: `Deliver the part named ${id}.`, ...extra };
}

async function stubSandbox() {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  return new StubSandboxProvider();
}

/** Drives a run that drafts its graph to the person's decision at `plan`, and returns the draft waiting there. */
async function toPlanGate(rig: LineRig, seats: Seats = {}, overrides: Parameters<DraftingRig['request']>[0] = {}): Promise<{ r: DraftingRig; sha256: string; vault: Vault }> {
  const r = await drafting(rig, seats);
  awaiting(await admitAndDrive(r, { artifacts: PLAN_ARTIFACTS, ...overrides }), PLAN_KEY, 'a drafted graph at L1');
  const attempt = lastAttempt(await rig.state(), 'plan');
  if (attempt.sha256 === null) throw new Error('R5a: the graph draft was not recorded');
  return { r, sha256: attempt.sha256, vault: (await r.components()).vault };
}

/** The ids of the graph tasks run state holds: every task but the drafting seats. */
function graphTasks(state: { tasks: Readonly<Record<string, unknown>> }): string[] {
  return Object.keys(state.tasks).filter((id) => !/\.(drafter|critic)$/.test(id)).sort();
}

/** The codes of the runtime problems that sent attempt `n` back. */
function sentBackCodes(state: Awaited<ReturnType<LineRig['state']>>, n: number): string[] {
  const back = state.drafts.plan?.attempts[n - 1]?.sentBack ?? null;
  if (back?.by !== 'runtime') throw new Error(`R5a: attempt ${String(n)} was not sent back by the runtime: ${JSON.stringify(state.drafts.plan?.attempts[n - 1])}`);
  return back.problems.map((p) => p.code);
}

export const DRAFTED_PLAN_NEEDS_A_POLICY_GRANT: LocalAssertion = runtime({
  id: 'I5.drafted-plan-needs-a-policy-grant',
  title: 'a run that drafts its task graph under a policy with no planning grant is refused at admission as policy-refused at plan, before any driver is called and before any state exists; the same request under a policy that grants planning is admitted',
  run: async () => {
    await withLine('r5a-grant-', async (rig) => {
      const { admitRun } = await api();
      const r = await drafting(rig);
      const outcome = await admitRun(await r.request({ artifacts: PLAN_ARTIFACTS, policy: await draftingPolicy() }));
      if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.station !== 'plan') throw new Error(`R5a: a drafted graph under a policy with no planning was ${outcome.ok ? 'admitted' : JSON.stringify(outcome)}`);
      const calls = Object.values(r.drivers).reduce((n, d) => n + d.requests.length, 0);
      if (calls > 0) throw new Error(`R5a: ${String(calls)} driver calls were made for a run refused at admission`);
      const state = await rig.state().then((s) => s, () => null);
      if (state !== null) throw new Error('R5a: a run refused for no planning grant left run state behind');
      const admitted = await admitRun(await r.request({ artifacts: PLAN_ARTIFACTS }));
      if (!admitted.ok) throw new Error(`R5a control: the same request under a policy granting planning was refused as ${admitted.reason}`);
    });
  },
});

export const DRAFTED_GRAPH_SEATS_ONLY_GRANTED_ROLES: LocalAssertion = runtime({
  id: 'I4.drafted-graph-seats-only-granted-roles',
  title: 'a drafted graph naming a role outside the policy\'s planning roles, or holding more build tasks than its bound, is sent back as a runtime problem naming the code, and no task of it is created and no builder is seated',
  run: async () => {
    await withLine('r5a-roles-', async (rig) => {
      const builder = await stubDriver();
      const { r } = await toPlanGate(rig, {
        builder,
        graph: (attempt, id) => helloGraph(id, attempt === 1
          ? [task('hello', { role: 'other-builder' })]
          : attempt === 2 ? ['a', 'b', 'c', 'd'].map((t) => task(t)) : [task('hello')]),
      });
      const state = await rig.state();
      if (!sentBackCodes(state, 1).includes('role-not-granted')) throw new Error(`R5a: a role outside the grant went back as ${JSON.stringify(sentBackCodes(state, 1))}`);
      if (!sentBackCodes(state, 2).includes('over-bound')) throw new Error(`R5a: a graph past ${String(RIG_PLANNING.maxBuildTasks)} tasks went back as ${JSON.stringify(sentBackCodes(state, 2))}`);
      if (graphTasks(state).length > 0) throw new Error(`R5a: tasks exist before any graph was approved: ${JSON.stringify(graphTasks(state))}`);
      if (builder.requests.length > 0) throw new Error('R5a: a builder was seated before any graph was approved');
      const retry = r.drivers.planner.requests[1]?.variableSuffix ?? '';
      if (!retry.includes('role-not-granted')) throw new Error(`R5a: the planner's retry was not told why its draft went back: ${retry}`);
      const first = r.drivers.planner.requests[0]?.variableSuffix ?? '';
      if (!first.includes(`at most ${String(RIG_PLANNING.maxBuildTasks)} build task`) || !first.includes('builder')) throw new Error(`R5a: the planner was not told its bound: ${first}`);
    });
  },
});

export const WORST_CASE_COVERS_A_DRAFTED_GRAPH: LocalAssertion = runtime({
  id: 'I5.worst-case-covers-a-drafted-graph',
  title: 'the figure admission shows for a drafted graph is its bound\'s: the planner\'s and the plan critic\'s calls, the most build tasks under the costliest allowed role, one review and its security seat; approval is compared with that figure, and the locked graph\'s own worst case is never above it',
  run: async () => {
    await withLine('r5a-cost-', async (rig) => {
      const { admitRun, boundGraph, parseDraftedGraph, worstCaseCost } = await api();
      await cp(join(rig.roles, 'builder.md'), join(rig.roles, 'cheap-builder.md'));
      const cheap = lineScope(['build', 'verify'], 'standard');
      const planning = { maxBuildTasks: 2, roles: ['cheap-builder' as RoleId, 'builder' as RoleId] };
      const policy = await draftingPolicy({}, { ['cheap-builder' as RoleId]: { ...cheap, budget: { ...cheap.budget, maxCostUsd: 0.25 } } }, { planning });
      const sandbox = await stubSandbox();
      await writeManifest(rig.dirs, [PARTS_GOOD]);
      const r = await drafting(rig, { sandbox, work: false, builder: await wideDriver(sandbox, 1), graph: (_, id) => helloGraph(id, [task('a'), task('b')]) });
      const req = await r.request({ artifacts: PLAN_ARTIFACTS, policy });
      const bind = { runId: rig.runId, baseCommit: req.baseCommit, workspace: req.workspace };
      const figure = worstCaseCost(boundGraph(planning, policy, bind), policy, ['plan']).usd;
      const allCheap = parseDraftedGraph({ tasks: [task('a', { role: 'cheap-builder' }), task('b', { role: 'cheap-builder' })] }, bind, planning);
      if (!allCheap.ok) throw new Error(`R5a control: a graph within the bound did not parse: ${JSON.stringify(allCheap.problems)}`);
      const cheapest = worstCaseCost(allCheap.graph, policy, ['plan']).usd;
      if (cheapest >= figure) throw new Error(`R5a control: the cheaper graph costs ${String(cheapest)}, not below the bound's ${String(figure)}`);
      // A person who approved a cheaper graph's figure has not approved the bound's.
      const under = await admitRun({ ...req, approvedCostUsd: cheapest });
      if (under.ok || under.reason !== 'cost-unapproved') throw new Error(`R5a: a drafted graph approved below its bound's figure was ${under.ok ? 'admitted' : under.reason}`);
      if (under.worstCase.usd !== figure) throw new Error(`R5a: admission's figure is ${String(under.worstCase.usd)}, not the bound's ${String(figure)}`);
      const builds = under.worstCase.tasks.filter((t) => t.station === 'build');
      const reviews = under.worstCase.tasks.filter((t) => t.station === 'review');
      const seats = under.worstCase.tasks.filter((t) => t.station === 'plan');
      if (builds.length !== 2 || builds.some((t) => t.role !== 'builder') || reviews.length !== 2 || seats.length !== 2) {
        throw new Error(`R5a: the bound's worst case counts ${JSON.stringify(under.worstCase.tasks.map((t) => [t.task, t.station, t.role]))}`);
      }
      const admission = await admitRun(req);
      if (!admission.ok) throw new Error(`R5a: a drafted graph approved for its bound's figure was refused as ${admission.reason}`);
      if (admission.admitted.worstCase.usd !== figure) throw new Error('R5a: the admitted figure is not the bound\'s');
      awaiting(await admission.admitted.drive(), PLAN_KEY, 'the drafted graph');
      awaiting(await approveAndResume(rig, r, PLAN_KEY, lastAttempt(await rig.state(), 'plan').sha256 ?? ''), 'integrate:1', 'the run after its graph was approved');
      const locked = parseDraftedGraph(JSON.parse(await readFile(join(rig.dirs.artifacts, graphPath(rig.runId)), 'utf8')), bind, planning);
      if (!locked.ok) throw new Error('R5a: the locked graph does not parse');
      const own = worstCaseCost(locked.graph, policy, ['plan']).usd;
      if (own > figure) throw new Error(`R5a: the locked graph could cost ${String(own)}, above the ${String(figure)} approved`);
    });
  },
});

export const DRAFTED_GRAPH_LOCKS_NOTHING_UNTIL_APPROVED: LocalAssertion = runtime({
  id: 'I3.drafted-graph-locks-nothing-until-approved',
  title: 'a run that drafts its graph seats the planner under its role, records the draft under the hash of the bytes read, and until a person approves that hash locks no graph, creates no task and seats no builder; an approval naming another hash is refused; then the approved bytes are locked at plan, the tasks are created with the runtime\'s review, and the run builds',
  run: async () => {
    await withLine('r5a-lock-', async (rig) => {
      const { approveStation } = await api();
      const builder = await stubDriver();
      const { r, sha256, vault } = await toPlanGate(rig, { builder });
      const [request] = r.drivers.planner.requests;
      if (request?.role.role !== ('planner' as RoleId)) throw new Error('R5a: the planner was not seated under its role');
      if ((await vault.readLocks(rig.runId))?.entries.some((e) => e.lockedBy === 'plan') === true) throw new Error('R5a: something was locked at plan before the graph was approved');
      const before = await rig.state();
      if (graphTasks(before).length > 0) throw new Error(`R5a: tasks exist before the graph was approved: ${JSON.stringify(graphTasks(before))}`);
      if (builder.requests.length > 0) throw new Error('R5a: a builder was seated before the graph was approved');
      if (existsSync(join(rig.dirs.artifacts, graphPath(rig.runId)))) throw new Error('R5a: the draft was written into the artifact root before it was approved');
      const other = await approveStation({ runId: rig.runId, key: PLAN_KEY, draft: '0'.repeat(64), approvedBy: 'conformance', vault });
      if (other.ok || other.reason !== 'draft-mismatch') throw new Error(`R5a: an approval naming another draft's hash was ${other.ok ? 'granted' : other.reason}`);
      awaiting(await approveAndResume(rig, r, PLAN_KEY, sha256), 'integrate:1', 'the run after its graph was approved');
      const attempt = lastAttempt(await rig.state(), 'plan');
      if (attempt.draft === null) throw new Error('R5a: no draft record');
      const record = await readRecord<DraftRecord>(vault, attempt.draft);
      const [file] = record.files;
      if (record.files.length !== 1 || file?.path !== graphPath(rig.runId)) throw new Error(`R5a: the draft recorded ${JSON.stringify(record.files.map((f) => f.path))}`);
      const entry = (await vault.readLocks(rig.runId))?.entries.find((e) => e.path === file.path);
      if (entry?.sha256 !== file.sha256 || entry.lockedBy !== 'plan') throw new Error(`R5a: the graph is not locked at plan against the approved hash: ${JSON.stringify(entry)}`);
      const after = await rig.state();
      if (JSON.stringify(graphTasks(after)) !== JSON.stringify(['hello', 'review', 'review.security'])) throw new Error(`R5a: the locked graph's tasks are ${JSON.stringify(graphTasks(after))}`);
      const lock = after.drafts.plan?.locked;
      if (lock == null) throw new Error('R5a: no draft lock was committed');
      const lockRecord = await readRecord<DraftLockRecord>(vault, lock);
      if (lockRecord.approval.by !== 'principal' || lockRecord.draft.sha256 !== sha256) throw new Error(`R5a: the lock records ${JSON.stringify(lockRecord.approval)} for ${lockRecord.draft.sha256}`);
      if (builder.requests.length === 0) throw new Error('R5a: no builder was seated once the graph was locked');
    });
  },
});

export const LOCKED_GRAPH_IS_THE_BYTES_READ: LocalAssertion = runtime({
  id: 'I3.locked-graph-is-the-bytes-read',
  title: 'bytes changed in the planner\'s workspace after the runtime read the draft are not what is approved, locked, or built from: the artifact root holds the bytes recorded and the builders run that graph; a change to the locked file in the artifact root afterwards stops the run as a tamper',
  run: async () => {
    await withLine('r5a-bytes-', async (rig) => {
      const { admitRun, draftPaths, resumeRun } = await api();
      const builder = await stubDriver();
      const r = await drafting(rig, { builder });
      const { work } = draftPaths(rig.workspaces, rig.runId, 'plan', 'drafter', 1);
      const path = graphPath(rig.runId);
      const rewritten = JSON.stringify({ tasks: [task('swapped')] });
      const base = await r.components();
      const vault: Vault = {
        ...around(base.vault, {}),
        recordDraft: async (rec) => {
          const ref = await base.vault.recordDraft(rec);
          // Between the runtime's read of the draft and its approval, the planner's workspace changes.
          await writeFile(join(work, ...path.split('/')), rewritten);
          return ref;
        },
      };
      const admission = await admitRun({ ...(await r.request({ artifacts: PLAN_ARTIFACTS })), components: { ...base, vault } });
      if (!admission.ok) throw new Error(`R5a: refused as ${admission.reason}: ${JSON.stringify(admission)}`);
      awaiting(await admission.admitted.drive(), PLAN_KEY, 'a drafted graph');
      const attempt = lastAttempt(await rig.state(), 'plan');
      if (attempt.sha256 === null || attempt.draft === null) throw new Error('R5a: no draft');
      const [critic] = r.drivers.planCritic.requests;
      if (critic === undefined || critic.stablePrefix.includes('swapped')) throw new Error('R5a: the plan critic read the planner\'s workspace after the draft was recorded');
      awaiting(await approveAndResume(rig, r, PLAN_KEY, attempt.sha256), 'integrate:1', 'the run after its graph was approved');
      const expected = helloGraph(rig.runId)[path];
      if ((await readFile(join(rig.dirs.artifacts, path), 'utf8')) !== expected) throw new Error('R5a: the artifact root holds other bytes than the draft the runtime read');
      const record = await readRecord<DraftRecord>(base.vault, attempt.draft);
      const locked = (await base.vault.readLocks(rig.runId))?.entries.find((e) => e.path === path);
      if (locked?.sha256 !== record.files[0]?.sha256) throw new Error('R5a: the lock does not hold the hash of the bytes read');
      const state = await rig.state();
      if (graphTasks(state).includes('swapped') || !graphTasks(state).includes('hello')) throw new Error(`R5a: the run built ${JSON.stringify(graphTasks(state))}, not the graph the runtime read`);
      if (builder.requests.some((req) => req.taskId !== ('hello' as TaskId))) throw new Error('R5a: a builder was seated for a task the recorded draft does not hold');
      // The locked file changed in the artifact root: the next drive stops on it.
      await writeFile(join(rig.dirs.artifacts, path), rewritten);
      const tampered = refusalOf(await resumeRun({ runId: rig.runId, components: await r.components() }), 'a resume over a changed locked graph');
      if (tampered.transition.reason !== 'lock-tamper' || !tampered.transition.tampered.some((t) => t.path === path)) {
        throw new Error(`R5a: a locked graph changed in the artifact root stopped the run as ${JSON.stringify(tampered.transition)}`);
      }
      if ((await rig.state()).violations.length === 0) throw new Error('R5a: the tamper was not recorded as a violation');
    });
  },
});

export const RUNTIME_DERIVES_THE_REVIEW: LocalAssertion = runtime({
  id: 'I3.runtime-derives-the-review-of-a-drafted-graph',
  title: 'a drafted graph naming a review task is sent back; the locked graph holds the build tasks the planner wrote, one review task the runtime added and its security seat, and both seats review every build task',
  run: async () => {
    await withLine('r5a-review-', async (rig) => {
      const sandbox = await stubSandbox();
      await writeManifest(rig.dirs, [PARTS_GOOD]);
      const reviewer = await stubDriver();
      const { r, sha256 } = await toPlanGate(rig, {
        sandbox, work: false, builder: await wideDriver(sandbox, 1), reviewer,
        graph: (attempt, id) => helloGraph(id, attempt === 1
          ? [task('a'), { id: 'mine', station: 'review', role: 'reviewer', dependsOn: ['a'], dependencySet: ['**'] }]
          : [task('a'), task('b')]),
      });
      const first = sentBackCodes(await rig.state(), 1);
      if (!first.includes('not-a-build-task')) throw new Error(`R5a: a draft naming a review task went back as ${JSON.stringify(first)}`);
      awaiting(await approveAndResume(rig, r, PLAN_KEY, sha256), 'integrate:1', 'the run after its graph was approved');
      const state = await rig.state();
      if (JSON.stringify(graphTasks(state)) !== JSON.stringify(['a', 'b', 'review', 'review.security'])) throw new Error(`R5a: the locked graph's tasks are ${JSON.stringify(graphTasks(state))}`);
      // Each seat is handed the runtime's evidence for every task it reviews, by task id.
      for (const id of ['review', 'review.security']) {
        const request = reviewer.requests.find((q) => q.taskId === (id as TaskId));
        if (request === undefined) throw new Error(`R5a: the seat ${id} was never called`);
        for (const built of ['a', 'b']) {
          if (!request.stablePrefix.includes(`"taskId":"${built}"`)) throw new Error(`R5a: the seat ${id} was not given the evidence of build task ${built}, so it does not review it`);
        }
      }
      if (await readFile(join(rig.dirs.artifacts, graphPath(rig.runId)), 'utf8').then((text) => text.includes('review'))) throw new Error('R5a: the locked file holds a review task; the review is the runtime\'s, derived on every read');
    });
  },
});

export const OBJECTIVE_REACHES_THE_BUILDER: LocalAssertion = runtime({
  id: 'I3.objective-reaches-the-builder-never-the-reviewer',
  title: 'a builder\'s context holds its own task\'s objective and the objective of each task it depends on, and no other task\'s; neither review seat\'s context holds any objective or the graph',
  run: async () => {
    await withLine('r5a-objective-', async (rig) => {
      const sandbox = await stubSandbox();
      await writeManifest(rig.dirs, [PARTS_GOOD]);
      const builder = await wideDriver(sandbox, 1);
      const reviewer = await stubDriver();
      const OBJ = { a: 'OBJECTIVE-ALPHA lays the foundation.', b: 'OBJECTIVE-BRAVO stands alone.', c: 'OBJECTIVE-CHARLIE builds on alpha.' };
      const { r, sha256 } = await toPlanGate(rig, {
        sandbox, work: false, builder, reviewer,
        graph: (_, id) => helloGraph(id, [task('a', { objective: OBJ.a }), task('b', { objective: OBJ.b }), task('c', { objective: OBJ.c, dependsOn: ['a'] })]),
      });
      awaiting(await approveAndResume(rig, r, PLAN_KEY, sha256), 'integrate:1', 'the run after its graph was approved');
      const told = (id: string): string => {
        const req = builder.requests.find((q) => q.taskId === (id as TaskId));
        if (req === undefined) throw new Error(`R5a: no builder was seated for ${id}`);
        return req.stablePrefix;
      };
      const holds = (id: string, has: readonly string[], lacks: readonly string[]): void => {
        for (const text of has) if (!told(id).includes(text)) throw new Error(`R5a: the builder of ${id} was not given ${text}`);
        for (const text of lacks) if (told(id).includes(text)) throw new Error(`R5a: the builder of ${id} was given ${text}, which is neither its own nor a dependency's`);
      };
      holds('a', [OBJ.a], [OBJ.b, OBJ.c]);
      holds('b', [OBJ.b], [OBJ.a, OBJ.c]);
      holds('c', [OBJ.c, OBJ.a], [OBJ.b]);
      const seats = new Set(reviewer.requests.map((q) => q.taskId));
      if (!seats.has('review' as TaskId) || !seats.has('review.security' as TaskId)) throw new Error(`R5a: the review seats called were ${JSON.stringify([...seats])}`);
      for (const req of reviewer.requests) {
        const all = `${req.stablePrefix}\n${req.variableSuffix}`;
        for (const text of [...Object.values(OBJ), '[task-graph]', '[plan]', 'dependencySet']) {
          if (all.includes(text)) throw new Error(`R5a: the seat ${req.taskId} was given ${text}`);
        }
      }
    });
  },
});

export const PLAN_DRAFT_OUTSIDE_THE_GRANT_IS_DISCARDED: LocalAssertion = runtime({
  id: 'I4.plan-draft-outside-the-grant-is-discarded',
  title: 'a file the planner wrote anywhere but its graph path is recorded only as discarded: it is in no draft file, not in the artifact root, and in no tree the plan critic or a builder is handed',
  run: async () => {
    await withLine('r5a-discard-', async (rig) => {
      const sandbox = await stubSandbox();
      const builder = await seat({ family: 'builder-family', sandbox });
      const strays = { 'notes/plan.md': 'STRAY-NOTES', 'src/planted.js': 'STRAY-CODE' };
      const { r, sha256, vault } = await toPlanGate(rig, { sandbox, builder, graph: (_, id) => ({ ...helloGraph(id), ...strays }) });
      const attempt = lastAttempt(await rig.state(), 'plan');
      if (attempt.draft === null) throw new Error('R5a: no draft');
      const record = await readRecord<DraftRecord>(vault, attempt.draft);
      if (record.files.length !== 1 || record.files[0]?.path !== graphPath(rig.runId)) throw new Error(`R5a: the draft recorded ${JSON.stringify(record.files.map((f) => f.path))}`);
      for (const path of Object.keys(strays)) if (!record.discarded.includes(path)) throw new Error(`R5a: ${path} was not recorded as discarded: ${JSON.stringify(record.discarded)}`);
      awaiting(await approveAndResume(rig, r, PLAN_KEY, sha256), 'integrate:1', 'the run after its graph was approved');
      const trees = [...r.drivers.planCritic.workspaces, ...builder.workspaces];
      if (r.drivers.planCritic.workspaces.length === 0 || builder.workspaces.length === 0) throw new Error('R5a: the plan critic or the builder was never seated');
      for (const path of Object.keys(strays)) {
        if (existsSync(join(rig.dirs.artifacts, path))) throw new Error(`R5a: ${path} reached the artifact root`);
        if (trees.some((tree) => Object.hasOwn(tree, path))) throw new Error(`R5a: ${path} reached a later seat's tree`);
      }
      const texts = [...r.drivers.planCritic.requests, ...builder.requests].map((q) => q.stablePrefix).join('\n');
      for (const text of Object.values(strays)) if (texts.includes(text)) throw new Error(`R5a: ${text} reached a later seat's context`);
    });
  },
});

export const PLANNER_IS_NOT_GRANTED_THE_INTENT: LocalAssertion = runtime({
  id: 'I7.planner-is-not-granted-the-intent',
  title: 'on a run whose spec is drafted from an intent, the planner and the plan critic are given the locked spec and not the intent\'s text: in neither\'s context, and in neither\'s tree',
  run: async () => {
    await withLine('r5a-intent-', async (rig) => {
      const intent = { text: 'INTENT-ONLY-MARKER: please write hello.txt at the root, holding hello.', from: 'principal' } as const;
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r, { artifacts: { ...artifactsFor(true, false), taskGraph: 'draft' }, intent }), 'spec:1', 'a drafted spec');
      if (!JSON.stringify(r.drivers.specDrafter.requests).includes('INTENT-ONLY-MARKER')) throw new Error('R5a control: the spec drafter was not given the intent');
      awaiting(await approveAndResume(rig, r, 'spec:1', lastAttempt(await rig.state(), 'spec').sha256 ?? ''), PLAN_KEY, 'a drafted graph');
      const seats: Array<[string, TaskRequest[], Array<Record<string, string>>]> = [
        ['planner', r.drivers.planner.requests, r.drivers.planner.workspaces], ['plan critic', r.drivers.planCritic.requests, r.drivers.planCritic.workspaces],
      ];
      for (const [name, requests, trees] of seats) {
        const [request] = requests;
        if (request === undefined) throw new Error(`R5a: the ${name} was never seated`);
        if (!request.stablePrefix.includes('[locked-spec]') || !request.stablePrefix.includes('The repository root holds hello.txt')) throw new Error(`R5a: the ${name} was not given the locked spec`);
        if (JSON.stringify(requests).includes('INTENT-ONLY-MARKER')) throw new Error(`R5a: the ${name}'s context holds the intent`);
        if (JSON.stringify(trees).includes('INTENT-ONLY-MARKER')) throw new Error(`R5a: the ${name}'s tree holds the intent`);
      }
    });
  },
});

export const DRAFTED_GRAPH_SHAPE_GOES_BACK: LocalAssertion = runtime({
  id: 'I5.drafted-graph-shape-goes-back',
  title: 'a drafted graph with a cycle, a reserved id, a missing objective, or an objective over the cap is sent back with its code; a third such draft goes to a person, who can reject it and not approve it, and the rejection parks the run with drafts-rejected naming plan',
  run: async () => {
    const { OBJECTIVE_MAX_BYTES } = await api();
    const bad: Record<string, unknown[]> = {
      cycle: [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })],
      reserved: [task('review')],
      'objective-missing': [{ id: 'a', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] }],
      'objective-too-long': [task('a', { objective: 'x'.repeat(OBJECTIVE_MAX_BYTES + 1) })],
    };
    for (const [code, tasks] of Object.entries(bad)) {
      await withLine(`r5a-shape-${code.replace(/[^a-z]/g, '')}-`, async (rig) => {
        const { r } = await toPlanGate(rig, { graph: (attempt, id) => helloGraph(id, attempt === 1 ? tasks : undefined) });
        const codes = sentBackCodes(await rig.state(), 1);
        if (!codes.includes(code)) throw new Error(`R5a: a draft with ${code} went back as ${JSON.stringify(codes)}`);
        if (!(r.drivers.planner.requests[1]?.variableSuffix ?? '').includes(code)) throw new Error(`R5a: the planner's retry does not name ${code}`);
        if (r.drivers.planCritic.requests.length !== 1) throw new Error('R5a: a draft the runtime sent back was read by the critic');
      });
    }
    await withLine('r5a-shape-park-', async (rig) => {
      const { approveStation, rejectDraft, resumeRun } = await api();
      const { r, sha256, vault } = await toPlanGate(rig, { graph: (_, id) => helloGraph(id, bad.cycle) });
      const attempt = lastAttempt(await rig.state(), 'plan');
      if (attempt.attempt !== 3 || !(attempt.failed ?? []).includes('shape')) throw new Error(`R5a: the third bad draft reached the gate as ${JSON.stringify(attempt)}`);
      const approved = await approveStation({ runId: rig.runId, key: PLAN_KEY, draft: sha256, approvedBy: 'conformance', vault });
      if (approved.ok || approved.reason !== 'draft-invalid') throw new Error(`R5a: approving a graph the runtime would not lock was ${approved.ok ? 'granted' : approved.reason}`);
      const rejected = await rejectDraft({ runId: rig.runId, key: PLAN_KEY, draft: sha256, notes: 'the tasks depend on each other', rejectedBy: 'conformance', vault });
      if (!rejected.ok || !rejected.parked) throw new Error(`R5a: rejecting the third draft was ${JSON.stringify(rejected)}`);
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components: await r.components() }), 'a parked run resumed');
      const t = resumed.transition;
      if (t.reason !== 'parked' || t.cause !== 'drafts-rejected' || t.station !== 'plan') throw new Error(`R5a: a resume of the parked run stopped as ${JSON.stringify(t)}`);
      if (r.drivers.planner.requests.length !== 3 || graphTasks(await rig.state()).length > 0) throw new Error('R5a: the parked run planned again, or created tasks');
    });
  },
});

/** The conditions the line recorded failed for the graph draft a rig's seats produce. */
async function planConditions(rig: LineRig, seats: Seats): Promise<{ failed: readonly DraftCondition[]; r: DraftingRig; vault: Vault }> {
  const { r, vault } = await toPlanGate(rig, seats);
  const attempt = lastAttempt(await rig.state(), 'plan');
  if (attempt.failed === null) throw new Error('R5a: the draft reached the gate with no conditions recorded');
  return { failed: attempt.failed, r, vault };
}

export const PLAN_EXIT_FLOOR: LocalAssertion = runtime({
  id: 'I4.plan-exit-floor',
  title: 'under a policy cell of auto, a drafted graph\'s exit waits for a person at L0, L1 and L3 and records draft-floor-applied; at L2 it is auto only for a draft whose shape holds and whose critic of another family found nothing, so a draft with a critic finding, or with a critic of the planner\'s family, waits for a person; a supplied graph under the same cell passes with no person',
  run: async () => {
    const { effectiveApproval, STATION_CONTRACTS } = await core();
    const policy = await draftingPolicy(Object.fromEntries([0, 1, 2, 3].map((l) => [`plan:${String(l)}`, 'auto'])), {}, { planning: RIG_PLANNING });
    const at = (level: AutonomyLevel, failed: readonly DraftCondition[]) => effectiveApproval(STATION_CONTRACTS.plan, policy, level, [], { draft: { sha256: 'a'.repeat(64), attempt: 1 }, failed });
    const finding = (runId: string): string => JSON.stringify({ findings: [{ path: graphPath(runId), note: 'the two tasks change one file' }] });
    // The conditions the line recorded for each draft, on the real line at L1, where the cell is auto and the floor still holds the exit.
    const clean = await withLine('r5a-floor-clean-', async (rig) => {
      const { failed, vault } = await planConditions(rig, {});
      if (!(await decisionsOf(vault, rig.runId)).some((d) => d.decision.cause === 'draft-floor-applied' && d.station === 'plan')) throw new Error('R5a: the floor that held a drafted plan exit at L1 was not recorded');
      return failed;
    });
    const found = await withLine('r5a-floor-finding-', async (rig) => (await planConditions(rig, { critic: () => finding(rig.runId) })).failed);
    const sameFamily = await withLine('r5a-floor-family-', async (rig) => (await planConditions(rig, { criticFamily: 'drafter-family', criticModel: 'another-model' })).failed);
    if (clean.length !== 0) throw new Error(`R5a: a clean draft under an independent critic recorded failed conditions: ${JSON.stringify(clean)}`);
    if (!found.includes('independent-critic-clean')) throw new Error(`R5a: a draft with a critic finding recorded ${JSON.stringify(found)}`);
    if (!sameFamily.includes('independent-critic-clean')) throw new Error(`R5a: a draft whose critic is of the planner's family recorded ${JSON.stringify(sameFamily)}`);
    if (at(2, clean) !== 'auto') throw new Error('R5a: a clean drafted graph at L2 under auto is not auto');
    if (at(2, found) !== 'human-required' || at(2, sameFamily) !== 'human-required') throw new Error('R5a: a drafted graph with a failed condition is auto at L2');
    for (const level of [0, 1, 3] as AutonomyLevel[]) if (at(level, clean) !== 'human-required') throw new Error(`R5a: a drafted graph at L${String(level)} is not human-required`);
    for (const level of [0, 1, 2, 3] as AutonomyLevel[]) {
      if (effectiveApproval(STATION_CONTRACTS.plan, policy, level, []) !== 'auto') throw new Error(`R5a: a supplied graph under auto at L${String(level)} is not auto`);
    }
    await withLine('r5a-floor-supplied-', async (rig) => {
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r, { artifacts: ARTIFACTS, intent: null, policy }), 'integrate:1', 'a supplied graph under auto');
    });
  },
});

export const PLAN_CRITIC_OF_PLANNER_FAMILY_IS_ADVISORY: LocalAssertion = runtime({
  id: 'I6.plan-critic-of-planner-family-is-advisory',
  title: 'a plan critic of the planner\'s family, on another model, is graded different-model from the models the runtime resolved: its finding is recorded and shown and sends nothing back, and its clean result never satisfies the floor; a critic that would be the planner\'s own model is not seated',
  run: async () => {
    await withLine('r5a-advisory-', async (rig) => {
      const { runStanding } = await api();
      const note = 'the plan splits one file across two tasks';
      const { failed, vault } = await planConditions(rig, {
        criticFamily: 'drafter-family', criticModel: 'another-model', criticReports: 'critic-family',
        critic: () => JSON.stringify({ findings: [{ path: graphPath(rig.runId), note }] }),
      });
      const attempts = (await rig.state()).drafts.plan?.attempts ?? [];
      if (attempts.length !== 1 || attempts[0]?.sentBack !== null) throw new Error('R5a: an advisory finding sent the graph back');
      const ref = attempts[0].critic;
      if (ref === null || ref === 'not-seated') throw new Error('R5a: the advisory critic was not recorded');
      const critic = await readRecord<CriticRecord>(vault, ref);
      if (critic.grade !== 'different-model' || critic.binding) throw new Error(`R5a: a critic of the planner's family was graded ${critic.grade}, binding ${String(critic.binding)}`);
      if (!failed.includes('independent-critic-clean')) throw new Error('R5a: an advisory critic satisfied the floor');
      const { standing } = await runStanding(vault, rig.runId);
      if (standing.standing !== 'awaiting-approval' || standing.draft?.station !== 'plan' || !(standing.draft.critic?.findings ?? []).includes(`${graphPath(rig.runId)}: ${note}`)) {
        throw new Error(`R5a: the person deciding the graph was shown ${JSON.stringify(standing)}`);
      }
    });
    await withLine('r5a-advisory-clean-', async (rig) => {
      const { failed } = await planConditions(rig, { criticFamily: 'drafter-family', criticModel: 'another-model' });
      if (!failed.includes('independent-critic-clean')) throw new Error('R5a: a same-family critic\'s clean result satisfied the floor');
    });
    await withLine('r5a-advisory-same-', async (rig) => {
      const { failed, r } = await planConditions(rig, { criticFamily: 'drafter-family', criticModel: 'drafter-family-model' });
      if (lastAttempt(await rig.state(), 'plan').critic !== 'not-seated' || r.drivers.planCritic.requests.length > 0) throw new Error('R5a: a critic on the planner\'s own model was seated');
      if (!failed.includes('independent-critic-clean')) throw new Error('R5a: a critic that was not seated satisfied the floor');
    });
  },
});

/** An approved graph, then a resume stopped inside the lock by a vault that throws once, then a resume with the real vault. */
async function planLockAcrossAStop(window: 'after-lock-record' | 'after-lock-commit'): Promise<void> {
  await withLine(`r5a-stop-${window}-`, async (rig) => {
    const { approveStation, resumeRun } = await api();
    const { r, sha256, vault: real } = await toPlanGate(rig);
    const approved = await approveStation({ runId: rig.runId, key: PLAN_KEY, draft: sha256, approvedBy: 'conformance', vault: real });
    if (!approved.ok) throw new Error(`R5a: approving the drafted graph was refused as ${approved.reason}`);
    const stopped = new Error('R5a: the process stopped here');
    let armed = true;
    const vault: Vault = window === 'after-lock-record'
      ? {
          ...around(real, {}),
          recordDraftLock: async (rec) => {
            const ref = await real.recordDraftLock(rec);
            if (armed) { armed = false; throw stopped; }
            return ref;
          },
        }
      : {
          ...around(real, {}),
          readLocks: async (runId) => {
            if (armed && (await real.readRunState(runId)).drafts.plan?.locked != null) { armed = false; throw stopped; }
            return real.readLocks(runId);
          },
        };
    const first = await resumeRun({ runId: rig.runId, components: { ...(await r.components()), vault } }).then(() => null, (error: unknown) => error);
    if (first !== stopped) throw new Error(`R5a: the stop was not reached ${window}: ${String(first)}`);
    if (graphTasks(await rig.state()).length > 0) throw new Error(`R5a: tasks were created before the lock held, at a stop ${window}`);
    awaiting(await resumeRun({ runId: rig.runId, components: await r.components() }), 'integrate:1', `the run resumed after a stop ${window}`);
    if (r.drivers.planner.requests.length !== 1) throw new Error(`R5a: a run stopped ${window} planned again on resume`);
    const entry = (await real.readLocks(rig.runId))?.entries.find((e) => e.path === graphPath(rig.runId));
    if (entry?.lockedBy !== 'plan') throw new Error(`R5a: after a stop ${window}, the graph is not locked at plan`);
    if (JSON.stringify(graphTasks(await rig.state())) !== JSON.stringify(['hello', 'review', 'review.security'])) throw new Error(`R5a: after a stop ${window}, the tasks are ${JSON.stringify(graphTasks(await rig.state()))}`);
    const tampers = (await decisionsOf(real, rig.runId)).filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'lock-tamper');
    if (tampers.length > 0) throw new Error(`R5a: a stop ${window} was recorded as a tamper`);
  });
}

export const PLAN_LOCK_SURVIVES_A_STOP: LocalAssertion = runtime({
  id: 'I5.plan-lock-survives-a-stop',
  title: 'a run stopped after its graph\'s lock was recorded or committed resumes with the locked graph, plans nothing again, creates the tasks once, and records no tamper; a run stopped before the lock, while its planner\'s draft was being recorded, resumes at the attempt in flight',
  run: async () => {
    await planLockAcrossAStop('after-lock-record');
    await planLockAcrossAStop('after-lock-commit');
    await withLine('r5a-stop-before-', async (rig) => {
      const { admitRun, resumeRun } = await api();
      const r = await drafting(rig);
      const base = await r.components();
      const stopped = new Error('R5a: the process stopped here');
      const vault: Vault = { ...around(base.vault, {}), recordDraft: () => Promise.reject(stopped) };
      const admission = await admitRun({ ...(await r.request({ artifacts: PLAN_ARTIFACTS })), components: { ...base, vault } });
      if (!admission.ok) throw new Error(`R5a: refused as ${admission.reason}`);
      const first = await admission.admitted.drive().then(() => null, (error: unknown) => error);
      if (first !== stopped) throw new Error(`R5a: the stop before the lock was not reached: ${String(first)}`);
      awaiting(await resumeRun({ runId: rig.runId, components: await r.components() }), PLAN_KEY, 'the run resumed before its graph was locked');
      const attempts = (await rig.state()).drafts.plan?.attempts ?? [];
      if (attempts.length !== 1 || attempts[0]?.attempt !== 1 || attempts[0].draft === null) throw new Error(`R5a: the resume did not finish the attempt in flight: ${JSON.stringify(attempts)}`);
    });
  },
});

export const DRAFTED_PLAN_NEEDS_ITS_ROLES: LocalAssertion = runtime({
  id: 'I5.drafted-plan-needs-its-roles',
  title: 'admission refuses a run that drafts its graph when planner or plan-critic has no compiled role, as role-undefined, or no policy scope at plan, as policy-refused naming the role; no driver is called',
  run: async () => {
    for (const role of ['planner', 'plan-critic']) {
      await withLine(`r5a-norole-${role.replace('-', '')}-`, async (rig) => {
        const { admitRun } = await api();
        const r = await drafting(rig);
        await rm(join(rig.roles, `${role}.md`));
        const outcome = await admitRun(await r.request({ artifacts: PLAN_ARTIFACTS }));
        if (outcome.ok || outcome.reason !== 'role-undefined' || !outcome.roles.includes(role as RoleId)) throw new Error(`R5a: a drafting run with no compiled ${role} was ${outcome.ok ? 'admitted' : JSON.stringify(outcome)}`);
        if (Object.values(r.drivers).some((d) => d.requests.length > 0)) throw new Error('R5a: a driver was called for a run refused at admission');
      });
      for (const stations of [null, ['review'] as const]) {
        await withLine(`r5a-noscope-${role.replace('-', '')}-`, async (rig) => {
          const { admitRun } = await api();
          const { StrictPolicyEngine } = await core();
          const r = await drafting(rig);
          const granted = await draftingPolicy({}, {}, { planning: RIG_PLANNING });
          const roles = Object.fromEntries(Object.entries(granted.roles).flatMap(([id, scope]) => (id !== role ? [[id, scope]] : stations === null ? [] : [[id, lineScope([...stations], 'deep')]])));
          const policy = new StrictPolicyEngine().resolvePolicy({ ...granted, roles });
          // The figure is never reached: admission refuses the scope before it reads a cost.
          const outcome = await admitRun(await r.request({ artifacts: PLAN_ARTIFACTS, policy, approvedCostUsd: 0 }));
          if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.station !== 'plan' || outcome.role !== role) {
            throw new Error(`R5a: a drafting run whose ${role} has ${stations === null ? 'no scope' : 'no scope at plan'} was ${outcome.ok ? 'admitted' : JSON.stringify(outcome)}`);
          }
          if (Object.values(r.drivers).some((d) => d.requests.length > 0)) throw new Error('R5a: a driver was called for a run refused at admission');
        });
      }
    }
  },
});

export const SUPPLIED_GRAPH_SEATS_NO_PLANNER: LocalAssertion = runtime({
  id: 'I3.supplied-graph-seats-no-planner',
  title: 'a run admitted with a graph file, under a policy that grants planning, seats no planner and no plan critic, records no plan draft, and locks the file at plan against the hash admission recorded, as supplied',
  run: async () => {
    await withLine('r5a-supplied-', async (rig) => {
      const r = await drafting(rig);
      const policy = await draftingPolicy({}, {}, { planning: RIG_PLANNING });
      awaiting(await admitAndDrive(r, { artifacts: ARTIFACTS, intent: null, policy }), 'integrate:1', 'a run admitted with its graph');
      if (r.drivers.planner.requests.length + r.drivers.planCritic.requests.length > 0) throw new Error('R5a: a run admitted with its graph seated a planner or a plan critic');
      const state = await rig.state();
      if (state.drafts.plan !== undefined) throw new Error(`R5a: a run admitted with its graph recorded a plan draft: ${JSON.stringify(state.drafts.plan)}`);
      const vault = (await r.components()).vault;
      const record = await readRecord<{ artifacts: { taskGraph: { source: string; file?: { path: string; sha256: string } } } }>(vault, state.admission);
      const admitted = record.artifacts.taskGraph;
      if (admitted.source !== 'supplied' || admitted.file?.path !== 'graph.json') throw new Error(`R5a: the admission record holds the graph as ${JSON.stringify(admitted)}`);
      const entry = (await vault.readLocks(rig.runId))?.entries.find((e) => e.path === 'graph.json');
      if (entry?.lockedBy !== 'plan' || entry.sha256 !== admitted.file.sha256) throw new Error(`R5a: the supplied graph is locked as ${JSON.stringify(entry)}`);
    });
  },
});

export const PARALLEL_TASKS_OF_A_DRAFTED_GRAPH: LocalAssertion = runtime({
  id: 'I4.parallel-tasks-of-a-drafted-graph',
  title: 'two drafted build tasks with no dependency between them are built at once under the policy\'s bound, and a third that depends on both starts only after both have passed',
  run: async () => {
    await withLine('r5a-parallel-', async (rig) => {
      const sandbox = await stubSandbox();
      await writeManifest(rig.dirs, [PARTS_GOOD]);
      const overlap: Overlap = { mostAtOnce: 0 };
      const early: string[] = [];
      const builder = await wideDriver(sandbox, 2, {
        meet: 2,
        overlap,
        during: async (req) => {
          if (req.taskId !== ('c' as TaskId)) return;
          const { tasks } = await rig.state();
          for (const dep of ['a', 'b']) if (tasks[dep as TaskId] !== 'passed') early.push(`${dep} was ${String(tasks[dep as TaskId])}`);
        },
      });
      const policy = await draftingPolicy({}, {}, { planning: RIG_PLANNING, concurrency: { maxParallelTasks: 2, maxConflictRetries: 0 } });
      const { r, sha256 } = await toPlanGate(rig, { sandbox, work: false, builder, graph: (_, id) => helloGraph(id, [task('a'), task('b'), task('c', { dependsOn: ['a', 'b'] })]) }, { policy });
      awaiting(await approveAndResume(rig, r, PLAN_KEY, sha256), 'integrate:1', 'the run after its graph was approved');
      if (overlap.mostAtOnce !== 2) throw new Error(`R5a: the two independent drafted tasks ran ${String(overlap.mostAtOnce)} at a time, not both at once`);
      if (!builder.requests.some((q) => q.taskId === ('c' as TaskId))) throw new Error('R5a: the dependent task was never built');
      if (early.length > 0) throw new Error(`R5a: the dependent task started before its dependencies passed: ${early.join('; ')}`);
    });
  },
});

export const R5A_ASSERTIONS = {
  I3: [DRAFTED_GRAPH_LOCKS_NOTHING_UNTIL_APPROVED, LOCKED_GRAPH_IS_THE_BYTES_READ, RUNTIME_DERIVES_THE_REVIEW, OBJECTIVE_REACHES_THE_BUILDER, SUPPLIED_GRAPH_SEATS_NO_PLANNER],
  I4: [DRAFTED_GRAPH_SEATS_ONLY_GRANTED_ROLES, PLAN_DRAFT_OUTSIDE_THE_GRANT_IS_DISCARDED, PLAN_EXIT_FLOOR, PARALLEL_TASKS_OF_A_DRAFTED_GRAPH],
  I5: [DRAFTED_PLAN_NEEDS_A_POLICY_GRANT, WORST_CASE_COVERS_A_DRAFTED_GRAPH, DRAFTED_GRAPH_SHAPE_GOES_BACK, PLAN_LOCK_SURVIVES_A_STOP, DRAFTED_PLAN_NEEDS_ITS_ROLES],
  I6: [PLAN_CRITIC_OF_PLANNER_FAMILY_IS_ADVISORY],
  I7: [PLANNER_IS_NOT_GRANTED_THE_INTENT],
} as const;
