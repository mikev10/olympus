/**
 * R19: drafting at `spec` and `test-design`. A run admitted with an intent
 * and no spec, or with no acceptance tests, drafts them on the line: a
 * drafter writes, the runtime records the bytes it read under one hash, the
 * base run runs a test draft, an independent critic reads it, and the exit
 * carries the drafted floor (D-A-DS-01 to D-A-DS-07).
 *
 * Each assertion drives the real admission and line in `@olympus-ai/api` over
 * the filesystem Vault and the stub sandbox, with stub drivers in every seat
 * whose model family and model the assertion sets, so a grade is the one the
 * assertion arranged. No run here goes above L1: admission refuses a stub
 * composition there (D-I1a-06), and the real one calls a paid model. The
 * floor at L2 and L3 is asserted on the pure transition the line's exit calls,
 * over the conditions the line itself recorded for a draft (D-R19-11).
 */
import { createHash } from 'node:crypto';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdmissionOutcome, BuiltGraph, DraftingDrivers, RunOutcome, RunRequest } from '@olympus-ai/api';
import type {
  ApprovalKey,
  AutonomyLevel,
  CompiledRole,
  DraftCondition,
  DraftStation,
  Driver,
  DriverEvent,
  ModelFamily,
  ModelIdentity,
  Policy,
  RoleId,
  RunState,
  TaskId,
  TaskRequest,
  TaskResult,
} from '@olympus-ai/core';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { CriticRecord, DraftLockRecord, DraftRecord, EnforcementDecision, EvidenceBundle, Vault } from '@olympus-ai/vault';
import { compileError, runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { around } from './line-assertions.js';
import { ARTIFACTS, lineScope, linePolicy, readRecord, refusalOf, withLine, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

const INTENT = { text: 'Write hello.txt at the repository root, holding the word hello.', from: 'principal' } as const;

/** The scopes the rig's policy grants each drafting seat; none of the test seats has egress (I3). */
function draftingScopes(): Record<RoleId, ReturnType<typeof lineScope>> {
  return {
    ['spec-drafter' as RoleId]: lineScope(['spec'], 'deep'),
    ['spec-critic' as RoleId]: lineScope(['spec'], 'deep'),
    ['test-drafter' as RoleId]: lineScope(['test-design'], 'deep'),
    ['test-critic' as RoleId]: lineScope(['test-design'], 'deep'),
  };
}

/** The rig's policy with the drafting seats granted: every M1 station `auto` at L0 and L1 unless `cells` says otherwise. */
async function draftingPolicy(cells: Parameters<typeof linePolicy>[0] = {}, roles: Record<RoleId, ReturnType<typeof lineScope>> = {}): Promise<Policy> {
  return linePolicy(cells, {
    roles: {
      ['builder' as RoleId]: lineScope(['build', 'verify'], 'standard'),
      ['reviewer' as RoleId]: lineScope(['review'], 'deep'),
      ...draftingScopes(),
      ...roles,
    },
  });
}

/**
 * The hello fixture's artifacts with the spec, the tests, or both drafted. A
 * drafted spec names no parts, which are drafted with it; supplied, it keeps
 * the fixture's, or `parts` where given.
 */
function artifactsFor(spec: boolean, tests: boolean, parts?: NonNullable<RunRequest['artifacts']['specParts']>): RunRequest['artifacts'] {
  const { specParts, ...rest } = ARTIFACTS;
  return {
    ...rest,
    spec: spec ? 'draft' : ARTIFACTS.spec,
    acceptanceTests: tests ? 'draft' : ARTIFACTS.acceptanceTests,
    ...(spec ? {} : { specParts: parts ?? specParts }),
  };
}

/** The spec a stub drafter writes for the hello fixture: its text and its three parts. */
function helloSpec(runId: string, overrides: Record<string, string> = {}): Record<string, string> {
  const dir = `.drafts/${runId}`;
  return {
    [`${dir}/spec.md`]: '# Hello\n\nThe repository root holds hello.txt, whose content is the word hello.\n',
    [`${dir}/security.json`]: JSON.stringify({ none: 'the change writes one file in the repository and crosses no boundary' }),
    [`${dir}/run-requirements.json`]: JSON.stringify({ testCommand: ['node', 'checks/hello.check.cjs'], framework: 'node', testDirectory: 'checks', publicInterface: 'the file hello.txt at the repository root' }),
    [`${dir}/questions.json`]: JSON.stringify({ assumptions: [{ point: 'trailing newline', chose: 'either is accepted' }], openQuestions: [] }),
    ...overrides,
  };
}

/** The acceptance tests a stub test drafter writes: one check script, and a manifest declaring it fails on the base. */
function helloTests(runId: string, script = HELLO_CHECK): Record<string, string> {
  return {
    'checks/hello.check.cjs': script,
    [`.drafts/${runId}/acceptance.json`]: JSON.stringify({
      checks: [{ id: 'drafted-hello', kind: 'behavioral', onBase: 'fails', command: ['node', 'checks/hello.check.cjs'], required: true, timeoutMs: 10_000 }],
    }),
  };
}

const HELLO_CHECK = "const fs = require('node:fs');\nprocess.exit(fs.existsSync('hello.txt') && fs.readFileSync('hello.txt', 'utf8').trim() === 'hello' ? 0 : 1);\n";

/** Writes `files` into the task's sandbox, as an agent does, through the provider that runs it. */
async function writeIn(sandbox: SandboxProvider, req: TaskRequest, files: Record<string, string>): Promise<void> {
  const script = `const fs=require('node:fs');const path=require('node:path');for(const [p,c] of Object.entries(${JSON.stringify(files)})){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c);}`;
  const wrote = await sandbox.exec(req.sandbox, ['node', '-e', script]);
  if (wrote.exitCode !== 0) throw new Error(`R19: a stub seat's write did not land: ${wrote.stderr}`);
}

/** The attempt a drafter's request is for, read from its variable suffix as the runtime wrote it. */
function attemptOf(req: TaskRequest): number {
  const match = /\battempt (\d+)\b/.exec(req.variableSuffix);
  return match === null ? 1 : Number(match[1]);
}

/** Every file in the task's sandbox workspace, by relative path, read through the provider that runs it. */
async function workspaceOf(sandbox: SandboxProvider, req: TaskRequest): Promise<Record<string, string>> {
  const script = "const fs=require('node:fs');const path=require('node:path');const out={};const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else out[path.relative('.',p).split(path.sep).join('/')]=e.isFile()?fs.readFileSync(p,'utf8'):'<not a file>';}};walk('.');process.stdout.write(JSON.stringify(out));";
  const listed = await sandbox.exec(req.sandbox, ['node', '-e', script]);
  if (listed.exitCode !== 0) throw new Error(`R19: a stub seat could not list its workspace: ${listed.stderr}`);
  return JSON.parse(listed.stdout) as Record<string, string>;
}

interface SeatOptions {
  readonly family: string;
  readonly model?: string;
  /** The family the seat's result reports, where it is not the one it resolves; only the resolved one may grade it. */
  readonly reportedFamily?: string;
  /** What the seat does in its sandbox, and the narrative it returns; undefined returns a plain account. */
  readonly act?: (req: TaskRequest) => Promise<string | undefined>;
  /** The provider the seat runs on; where given, its workspace is read when each call begins. */
  readonly sandbox?: SandboxProvider;
}

export interface ObservedSeat extends Driver {
  readonly requests: TaskRequest[];
  /** What each call's workspace held when the call began, in the order of `requests`; empty where no provider was given. */
  readonly workspaces: Array<Record<string, string>>;
}

/** A stub driver for one seat, whose model the assertion sets, recording every request it is given. */
async function seat(options: SeatOptions): Promise<ObservedSeat> {
  const { StubDriver } = await core();
  const inner = new StubDriver();
  const model: ModelIdentity = { provider: 'stub', family: options.family as ModelFamily, model: options.model ?? `${options.family}-model`, version: '0' };
  const reported: ModelIdentity = options.reportedFamily === undefined ? model : { ...model, family: options.reportedFamily as ModelFamily, model: `${options.reportedFamily}-model` };
  const requests: TaskRequest[] = [];
  const workspaces: Array<Record<string, string>> = [];
  return {
    id: inner.id,
    contractVersion: inner.contractVersion,
    requests,
    workspaces,
    provenanceId: () => inner.provenanceId(),
    capabilities: () => inner.capabilities(),
    declaredTools: () => inner.declaredTools(),
    resolveModel: () => model,
    relayRequest: () => null,
    runTask: async (req: TaskRequest): Promise<TaskResult> => {
      requests.push(req);
      if (options.sandbox !== undefined) workspaces.push(await workspaceOf(options.sandbox, req));
      const narrative = (await options.act?.(req)) ?? 'drafted as asked';
      const result = await inner.runTask(req);
      return { ...result, claim: { narrative, filesChanged: [] }, model: reported };
    },
    cancel: (taskId: TaskId) => inner.cancel(taskId),
    emitArtifacts: (roles: CompiledRole[], targetDir: string) => inner.emitArtifacts(roles, targetDir),
    on: (kind: DriverEvent['kind'], handler: (e: DriverEvent) => void) => {
      inner.on(kind, handler);
    },
  };
}

const CLEAN = JSON.stringify({ findings: [] });

/** What a drafting rig's seats do: the families they run on, and what each drafts or finds per attempt. */
interface Seats {
  readonly drafterFamily?: string;
  readonly drafterModel?: string;
  readonly testDrafterFamily?: string;
  readonly criticFamily?: string;
  readonly criticModel?: string;
  /** The family the critics' and the test drafter's results report, where it is not the one they resolve. */
  readonly criticReports?: string;
  readonly testDrafterReports?: string;
  readonly spec?: (attempt: number, runId: string) => Record<string, string>;
  readonly tests?: (attempt: number, runId: string) => Record<string, string>;
  readonly critic?: (station: DraftStation, attempt: number) => string;
  /** The provider every seat runs on and writes through; a fresh stub where none is given. */
  readonly sandbox?: SandboxProvider;
}

interface DraftingRig {
  readonly drivers: Record<keyof DraftingDrivers, ObservedSeat>;
  readonly components: () => Promise<BuiltGraph>;
  readonly request: (overrides?: Partial<RunRequest>) => Promise<RunRequest>;
}

/**
 * The rig's components with a drafting seat in each slot: stub drivers whose
 * families and drafts the assertion sets, over one stub sandbox the builder
 * also writes through. The rubrics are the shipped ones, copied beside the
 * roles, inside neither the workspace nor the store.
 */
async function drafting(rig: LineRig, seats: Seats = {}): Promise<DraftingRig> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const { DEFAULT_RUBRICS_DIRECTORY, worstCaseCost } = await api();
  const sandbox = seats.sandbox ?? new StubSandboxProvider();
  const rubrics = join(rig.roles, '..', 'rubrics');
  await cp(DEFAULT_RUBRICS_DIRECTORY, rubrics, { recursive: true, force: true });
  const drafterFamily = seats.drafterFamily ?? 'drafter-family';
  const criticFamily = seats.criticFamily ?? 'critic-family';
  const critic = (station: DraftStation) => (req: TaskRequest): Promise<string> => Promise.resolve((seats.critic ?? (() => CLEAN))(station, criticAttempt(req)));
  const criticSeat = {
    family: criticFamily,
    sandbox,
    ...(seats.criticModel === undefined ? {} : { model: seats.criticModel }),
    ...(seats.criticReports === undefined ? {} : { reportedFamily: seats.criticReports }),
  };
  const drivers = {
    specDrafter: await seat({
      family: drafterFamily,
      sandbox,
      ...(seats.drafterModel === undefined ? {} : { model: seats.drafterModel }),
      act: async (req) => {
        await writeIn(sandbox, req, (seats.spec ?? ((_, id) => helloSpec(id)))(attemptOf(req), rig.runId));
        return undefined;
      },
    }),
    specCritic: await seat({ ...criticSeat, act: critic('spec') }),
    testDrafter: await seat({
      family: seats.testDrafterFamily ?? drafterFamily,
      sandbox,
      ...(seats.drafterModel === undefined ? {} : { model: seats.drafterModel }),
      ...(seats.testDrafterReports === undefined ? {} : { reportedFamily: seats.testDrafterReports }),
      act: async (req) => {
        await writeIn(sandbox, req, (seats.tests ?? ((_, id) => helloTests(id)))(attemptOf(req), rig.runId));
        return undefined;
      },
    }),
    testCritic: await seat({ ...criticSeat, act: critic('test-design') }),
  };
  const components = async (): Promise<BuiltGraph> => rig.components({ sandbox, drafting: drivers });
  const request = async (overrides: Partial<RunRequest> = {}): Promise<RunRequest> => {
    const policy = overrides.policy ?? (await draftingPolicy());
    const artifacts = overrides.artifacts ?? artifactsFor(true, false);
    const drafted = [...(artifacts.spec === 'draft' ? ['spec' as const] : []), ...(artifacts.acceptanceTests === 'draft' ? ['test-design' as const] : [])];
    const graph = JSON.parse(await readFile(join(rig.dirs.artifacts, artifacts.taskGraph), 'utf8')) as { tasks: Parameters<typeof worstCaseCost>[0]['tasks'] };
    return rig.request(await components(), {
      intent: artifacts.spec === 'draft' ? INTENT : null,
      rubrics,
      ...overrides,
      artifacts,
      policy,
      // The figure a person approved: every seat a drafting station may hold counted in (R19).
      approvedCostUsd: overrides.approvedCostUsd ?? worstCaseCost({ tasks: graph.tasks, edges: [] }, policy, drafted).usd,
    });
  };
  return { drivers, components, request };
}

/** A critic's request names the attempt of the draft it reads, from the draft's recorded path to the draft lock; the line passes it in the suffix. */
function criticAttempt(req: TaskRequest): number {
  return attemptOf(req);
}

/** Admits and drives a drafting run to its first stop. */
async function admitAndDrive(r: DraftingRig, overrides: Partial<RunRequest> = {}): Promise<RunOutcome> {
  const { admitRun } = await api();
  const admission: AdmissionOutcome = await admitRun(await r.request(overrides));
  if (!admission.ok) throw new Error(`R19: a drafting run was refused at admission as ${admission.reason}: ${JSON.stringify(admission)}`);
  return admission.admitted.drive();
}

/** The station's last attempt in run state, or a failure naming what the state holds instead. */
function lastAttempt(state: RunState, station: DraftStation): NonNullable<RunState['drafts'][DraftStation]>['attempts'][number] {
  const attempt = state.drafts[station]?.attempts.at(-1);
  if (attempt === undefined) throw new Error(`R19: run state holds no ${station} attempt: ${JSON.stringify(state.drafts)}`);
  return attempt;
}

/** The refusal a drive stopped on, which must be a person's approval of `key`. */
function awaiting(outcome: RunOutcome, key: string, what: string): void {
  const refusal = refusalOf(outcome, what);
  if (refusal.transition.reason !== 'approval-required' || refusal.transition.key !== key) {
    throw new Error(`R19: ${what} stopped as ${refusal.transition.reason}${refusal.transition.reason === 'approval-required' ? ` for ${refusal.transition.key}` : ''}, not for a person's approval of ${key}: ${refusal.transition.message}`);
  }
}

/** Approves the draft waiting at `key`, by its hash, and drives on. */
async function approveAndResume(rig: LineRig, r: DraftingRig, key: ApprovalKey, sha256: string): Promise<RunOutcome> {
  const { approveStation, resumeRun } = await api();
  const components = await r.components();
  const approved = await approveStation({ runId: rig.runId, key, draft: sha256, approvedBy: 'conformance', vault: components.vault });
  if (!approved.ok) throw new Error(`R19: approving the draft at ${key} was refused as ${approved.reason}: ${approved.message}`);
  return resumeRun({ runId: rig.runId, components });
}

async function decisionsOf(vault: Vault, runId: string): Promise<EnforcementDecision[]> {
  const out: EnforcementDecision[] = [];
  for (const ref of await vault.readDecisions(runId as never)) out.push(await readRecord<EnforcementDecision>(vault, ref));
  return out;
}

function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

export const DRAFTED_SPEC_LOCKS_NOTHING_UNTIL_APPROVED: LocalAssertion = runtime({
  id: 'I3.drafted-spec-locks-nothing-until-approved',
  title:
    'a run admitted with an intent and no spec seats the spec drafter under its role with the intent in its context, records the draft under the hash of the bytes the runtime read, and locks nothing until a person approves that hash; then the approved bytes are written into the artifact root and the base, locked against that hash, and the run moves on to test-design',
  run: async () => {
    await withLine('r19-spec-', async (rig) => {
      const r = await drafting(rig);
      const outcome = await admitAndDrive(r);
      awaiting(outcome, 'spec:1', 'a drafted spec at L1');
      const [request] = r.drivers.specDrafter.requests;
      if (request?.role.role !== ('spec-drafter' as RoleId)) throw new Error('R19: the spec drafter was not seated under its role');
      if (!request.stablePrefix.includes(INTENT.text)) throw new Error('R19: the spec drafter was not given the intent');
      const components = await r.components();
      if ((await components.vault.readLocks(rig.runId)) !== null) throw new Error('R19: something was locked before the drafted spec was approved');
      const state = await rig.state();
      const attempt = lastAttempt(state, 'spec');
      if (attempt.draft === null || attempt.sha256 === null) throw new Error('R19: the spec draft was not recorded');
      const record = await readRecord<DraftRecord>(components.vault, attempt.draft);
      const files = helloSpec(rig.runId);
      if (!sameStrings(record.files.map((f) => f.path), Object.keys(files))) throw new Error(`R19: the draft recorded ${JSON.stringify(record.files.map((f) => f.path))}, not the four files the drafter wrote`);
      const next = await approveAndResume(rig, r, 'spec:1', attempt.sha256);
      // The run moved on: test-design runs the supplied tests over the base and stops at integrate.
      awaiting(next, 'integrate:1', 'the run after its drafted spec was approved');
      const locks = await components.vault.readLocks(rig.runId);
      for (const file of record.files) {
        const entry = locks?.entries.find((e) => e.path === file.path);
        if (entry?.sha256 !== file.sha256 || entry.lockedBy !== 'spec') throw new Error(`R19: ${file.path} is not locked at spec against the approved hash: ${JSON.stringify(entry)}`);
        const there = await readFile(join(rig.dirs.artifacts, file.path), 'utf8');
        if (there !== files[file.path]) throw new Error(`R19: the artifact root holds other bytes at ${file.path} than the draft approved`);
      }
      const after = await rig.state();
      const lock = after.drafts.spec?.locked;
      if (lock == null) throw new Error('R19: no draft lock was committed');
      const lockRecord = await readRecord<DraftLockRecord>(components.vault, lock);
      if (lockRecord.approval.by !== 'principal' || lockRecord.draft.sha256 !== attempt.sha256) throw new Error(`R19: the draft lock records ${JSON.stringify(lockRecord.approval)} for ${lockRecord.draft.sha256}`);
    });
  },
});

export const DRAFTED_TESTS_LOCK_AND_RUN: LocalAssertion = runtime({
  id: 'I3.drafted-tests-lock-and-run-at-verify',
  title:
    'an approved test draft is written into the artifact root and locked at test-design against the approved hash, its manifest and every test, and verify runs its checks; a locked drafted test changed afterwards verifies as tampered',
  run: async () => {
    await withLine('r19-tests-lock-', async (rig) => {
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r, { artifacts: artifactsFor(true, true) }), 'spec:1', 'a drafted spec');
      const spec = lastAttempt(await rig.state(), 'spec');
      awaiting(await approveAndResume(rig, r, 'spec:1', spec.sha256 ?? ''), 'test-design:1', 'drafted tests');
      const attempt = lastAttempt(await rig.state(), 'test-design');
      if (attempt.sha256 === null || attempt.draft === null) throw new Error('R19: the test draft was not recorded');
      const vault = (await r.components()).vault;
      if ((await vault.readLocks(rig.runId))?.entries.some((e) => e.lockedBy === 'test-design') === true) throw new Error('R19: something was locked at test-design before the test draft was approved');
      awaiting(await approveAndResume(rig, r, 'test-design:1', attempt.sha256), 'integrate:1', 'the run after its drafted tests were approved');
      const record = await readRecord<DraftRecord>(vault, attempt.draft);
      const drafted = helloTests(rig.runId);
      if (!sameStrings(record.files.map((f) => f.path), Object.keys(drafted))) throw new Error(`R19: the test draft recorded ${JSON.stringify(record.files.map((f) => f.path))}`);
      const locks = await vault.readLocks(rig.runId);
      for (const file of record.files) {
        const entry = locks?.entries.find((e) => e.path === file.path);
        if (entry?.sha256 !== file.sha256 || entry.lockedBy !== 'test-design') throw new Error(`R19: ${file.path} is not locked at test-design against the approved hash: ${JSON.stringify(entry)}`);
        if ((await readFile(join(rig.dirs.artifacts, file.path), 'utf8')) !== drafted[file.path]) throw new Error(`R19: the artifact root holds other bytes at ${file.path} than the test draft approved`);
      }
      // verify ran the drafted check over the build, and it passed there.
      const evidence = await Promise.all((await rig.state()).evidenceRefs.map(async (ref) => readRecord<EvidenceBundle>(vault, ref)));
      if (!evidence.some((b) => b.checks.some((c) => c.checkId === 'drafted-hello' && c.exitCode === 0))) {
        throw new Error(`R19: verify's evidence holds no passing run of the drafted check: ${JSON.stringify(evidence.map((b) => b.checks.map((c) => [c.checkId, c.exitCode])))}`);
      }
      await writeFile(join(rig.dirs.artifacts, 'checks', 'hello.check.cjs'), 'process.exit(0);\n');
      const verdict = await vault.verifyLocks(rig.runId);
      if (verdict.ok || !verdict.tampered.some((t) => t.path === 'checks/hello.check.cjs')) throw new Error(`R19: a locked drafted test changed after approval verified as ${JSON.stringify(verdict)}`);
    });
  },
});

export const SUPPLIED_ARTIFACTS_SEAT_NO_DRAFTER: LocalAssertion = runtime({
  id: 'I3.supplied-artifacts-seat-no-drafter',
  title: 'a run admitted with all its artifacts seats no drafter and no critic, records no draft, and its admission record holds every artifact as supplied',
  run: async () => {
    await withLine('r19-supplied-', async (rig) => {
      const r = await drafting(rig);
      const outcome = await admitAndDrive(r, { artifacts: ARTIFACTS, intent: null });
      awaiting(outcome, 'integrate:1', 'a run admitted with its artifacts');
      const calls = Object.values(r.drivers).reduce((n, d) => n + d.requests.length, 0);
      if (calls > 0) throw new Error(`R19: a run admitted with its artifacts made ${String(calls)} drafting calls`);
      const state = await rig.state();
      if (Object.keys(state.drafts).length > 0) throw new Error(`R19: a run admitted with its artifacts recorded drafts: ${JSON.stringify(state.drafts)}`);
      const record = await readRecord<{ artifacts: { spec: { source: string }; acceptanceTests: { source: string } } }>((await r.components()).vault, state.admission);
      if (record.artifacts.spec.source !== 'supplied' || record.artifacts.acceptanceTests.source !== 'supplied') throw new Error(`R19: the admission record holds ${JSON.stringify(record.artifacts)}`);
    });
  },
});

export const SPEC_LESS_RUN_NEEDS_AN_INTENT: LocalAssertion = runtime({
  id: 'I5.spec-less-run-needs-an-intent',
  title:
    'a run with neither a spec nor an intent is refused at admission, as is one with both, one that drafts without the drivers that seat its drafters and critics, without rubrics, or without a drafting role in its roles directory; each before any driver call and with no run state',
  run: async () => {
    const { rm } = await import('node:fs/promises');
    const cases: Array<[string, (rig: LineRig, r: DraftingRig) => Promise<RunRequest>, string]> = [
      ['neither a spec nor an intent', async (_rig, r) => r.request({ intent: null }), 'invalid-request'],
      ['a spec and an intent', async (_rig, r) => r.request({ artifacts: ARTIFACTS, intent: INTENT }), 'invalid-request'],
      ['no drafting drivers', async (rig, r) => ({ ...(await r.request()), components: await rig.components() }), 'invalid-request'],
      ['no rubrics', async (_rig, r) => r.request({ rubrics: null }), 'invalid-request'],
      ['no spec-drafter role', async (rig, r) => {
        const roles = join(rig.roles, '..', 'roles-undrafted');
        await cp(rig.roles, roles, { recursive: true });
        await rm(join(roles, 'spec-drafter.md'));
        return r.request({ roles });
      }, 'role-undefined'],
    ];
    for (const [what, make, reason] of cases) {
      await withLine('r19-intent-', async (rig) => {
        const { admitRun } = await api();
        const { isNoRunState } = await import('@olympus-ai/vault');
        const r = await drafting(rig);
        const outcome = await admitRun(await make(rig, r));
        if (outcome.ok || outcome.reason !== reason) throw new Error(`R19: a run with ${what} was ${outcome.ok ? 'admitted' : `refused as ${outcome.reason}`}, not ${reason}`);
        const calls = Object.values(r.drivers).reduce((n, d) => n + d.requests.length, 0);
        if (calls > 0) throw new Error(`R19: a run with ${what} reached a drafting seat`);
        try {
          await (await rig.components()).vault.readRunState(rig.runId);
          throw new Error(`R19: a run with ${what} left run state`);
        } catch (error) {
          if (!isNoRunState(error)) throw error;
        }
      });
    }
  },
});

export const APPROVAL_BINDS_THE_DRAFT: LocalAssertion = runtime({
  id: 'I3.approval-binds-the-draft-hash',
  title:
    'an approval naming another hash than the draft waiting, or none, is refused as draft-mismatch and recorded; a grant for one attempt is not spent on the next, even where the next attempt drafted the same bytes, so the next waits for its own approval',
  run: async () => {
    await withLine('r19-hash-', async (rig) => {
      const { approveStation, rejectDraft, resumeRun } = await api();
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r), 'spec:1', 'a drafted spec');
      const vault = (await r.components()).vault;
      const first = lastAttempt(await rig.state(), 'spec');
      if (first.sha256 === null) throw new Error('R19: no draft hash');
      for (const draft of ['0'.repeat(64), null]) {
        await refusedApproval(rig, vault, draft, 'draft-mismatch');
      }
      // A grant recorded for attempt 1, then the attempt rejected: attempt 2 drafts the same bytes and still waits.
      const granted = await approveStation({ runId: rig.runId, key: 'spec:1', draft: first.sha256, approvedBy: 'conformance', vault });
      if (!granted.ok) throw new Error(`R19: approving the draft waiting was refused as ${granted.reason}`);
      const rejected = await rejectDraft({ runId: rig.runId, key: 'spec:1', draft: first.sha256, notes: 'say why hello', rejectedBy: 'conformance', vault });
      if (!rejected.ok) throw new Error(`R19: the rejection was refused as ${rejected.reason}`);
      awaiting(await resumeRun({ runId: rig.runId, components: await r.components() }), 'spec:1', 'the second spec attempt');
      const second = lastAttempt(await rig.state(), 'spec');
      if (second.attempt !== 2 || second.sha256 !== first.sha256) throw new Error(`R19: the second attempt is ${String(second.attempt)} with ${String(second.sha256)}; the stub drafts the same bytes each time`);
      if ((await vault.readLocks(rig.runId)) !== null) throw new Error('R19: the grant for attempt 1 was spent on attempt 2');
    });
  },
});

export const LOCKED_DRAFT_IS_THE_BYTES_READ: LocalAssertion = runtime({
  id: 'I3.locked-draft-is-the-bytes-read',
  title: 'bytes changed in the drafter\'s workspace after the runtime read the draft are not what the critic reads, nor what is approved or locked: the critic\'s context and workspace hold the bytes recorded, the lock the hash recorded, and the artifact root the bytes recorded',
  run: async () => {
    await withLine('r19-bytes-', async (rig) => {
      const { admitRun, draftPaths } = await api();
      const r = await drafting(rig);
      const { work } = draftPaths(rig.workspaces, rig.runId, 'spec', 'drafter', 1);
      const spec = `.drafts/${rig.runId}/spec.md`;
      // Between the runtime's read of the draft and the critic's call, the drafter's workspace changes.
      const base = await r.components();
      const vault: Vault = {
        ...around(base.vault, {}),
        recordDraft: async (rec) => {
          const ref = await base.vault.recordDraft(rec);
          await writeFile(join(work, ...spec.split('/')), '# Rewritten before the critic\n');
          return ref;
        },
      };
      const admission = await admitRun({ ...(await r.request()), components: { ...base, vault } });
      if (!admission.ok) throw new Error(`R19: refused as ${admission.reason}: ${JSON.stringify(admission)}`);
      awaiting(await admission.admitted.drive(), 'spec:1', 'a drafted spec');
      const attempt = lastAttempt(await rig.state(), 'spec');
      if (attempt.sha256 === null || attempt.draft === null) throw new Error('R19: no draft');
      const read = await readRecord<DraftRecord>(base.vault, attempt.draft);
      const [critic] = r.drivers.specCritic.requests;
      const [criticTree] = r.drivers.specCritic.workspaces;
      if (critic === undefined || criticTree === undefined) throw new Error('R19: the spec critic was never seated');
      for (const file of read.files) {
        const bytes = Buffer.from(file.base64, 'base64').toString('utf8');
        if (!critic.stablePrefix.includes(`--- ${file.path}\n${bytes}`)) throw new Error(`R19: the critic's context does not hold the recorded bytes of ${file.path}`);
        if (criticTree[file.path] !== bytes) throw new Error(`R19: the critic's workspace holds other bytes at ${file.path} than the draft recorded`);
      }
      if (critic.stablePrefix.includes('Rewritten before the critic')) throw new Error('R19: the critic read the drafter\'s workspace after the draft was recorded');
      await writeFile(join(work, ...spec.split('/')), '# Rewritten after the read\n');
      await approveAndResume(rig, r, 'spec:1', attempt.sha256);
      const record = await readRecord<DraftRecord>((await r.components()).vault, attempt.draft);
      const recorded = record.files.find((f) => f.path === spec);
      const locked = (await (await r.components()).vault.readLocks(rig.runId))?.entries.find((e) => e.path === spec);
      if (recorded === undefined || locked?.sha256 !== recorded.sha256) throw new Error('R19: the lock does not hold the hash of the bytes read');
      if ((await readFile(join(rig.dirs.artifacts, spec), 'utf8')) !== helloSpec(rig.runId)[spec]) throw new Error('R19: the artifact root holds the bytes written after the read');
    });
  },
});

/**
 * A drafted spec approved, then a resume stopped inside `lockApproved` by a
 * vault that throws once at `stop`, then a resume with the real vault: the run
 * must lock the approved bytes and move on, with no tamper recorded.
 */
async function lockAcrossAStop(window: 'after-lock-record' | 'after-lock-commit'): Promise<void> {
  await withLine(`r19-stop-${window}-`, async (rig) => {
    const { approveStation, resumeRun } = await api();
    const r = await drafting(rig);
    awaiting(await admitAndDrive(r), 'spec:1', 'a drafted spec');
    const attempt = lastAttempt(await rig.state(), 'spec');
    if (attempt.sha256 === null || attempt.draft === null) throw new Error('R19: no spec draft');
    const base = await r.components();
    const approved = await approveStation({ runId: rig.runId, key: 'spec:1', draft: attempt.sha256, approvedBy: 'conformance', vault: base.vault });
    if (!approved.ok) throw new Error(`R19: approving the drafted spec was refused as ${approved.reason}`);
    const stopped = new Error('R19: the process stopped here');
    let armed = true;
    const vault: Vault = window === 'after-lock-record'
      ? {
          ...around(base.vault, {}),
          recordDraftLock: async (rec) => {
            const ref = await base.vault.recordDraftLock(rec);
            if (armed) { armed = false; throw stopped; }
            return ref;
          },
        }
      : {
          ...around(base.vault, {}),
          // The first read of the locks after the lock's commit is the step before the artifact root is written.
          readLocks: async (runId) => {
            if (armed && (await base.vault.readRunState(runId)).drafts.spec?.locked != null) { armed = false; throw stopped; }
            return base.vault.readLocks(runId);
          },
        };
    const first = await resumeRun({ runId: rig.runId, components: { ...base, vault } }).then(() => null, (error: unknown) => error);
    if (first !== stopped) throw new Error(`R19: the stop was not reached in ${window}: ${String(first)}`);
    const next = await resumeRun({ runId: rig.runId, components: await r.components() });
    awaiting(next, 'integrate:1', `the run resumed after a stop ${window}`);
    const record = await readRecord<DraftRecord>(base.vault, attempt.draft);
    const locks = await base.vault.readLocks(rig.runId);
    for (const file of record.files) {
      const entry = locks?.entries.find((e) => e.path === file.path);
      if (entry?.sha256 !== file.sha256) throw new Error(`R19: after a stop ${window}, ${file.path} is not locked against the approved hash`);
      const there = createHash('sha256').update(await readFile(join(rig.dirs.artifacts, file.path))).digest('hex');
      if (there !== file.sha256) throw new Error(`R19: after a stop ${window}, the artifact root holds other bytes at ${file.path}`);
    }
    const tampers = (await decisionsOf(base.vault, rig.runId)).filter((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'lock-tamper');
    if (tampers.length > 0) throw new Error(`R19: a stop ${window} was recorded as a tamper: ${JSON.stringify(tampers)}`);
  });
}

export const DRAFT_LOCK_SURVIVES_A_STOP: LocalAssertion = runtime({
  id: 'I5.draft-lock-survives-a-stop',
  title:
    'a stop between recording a draft lock and committing it, or between committing it and writing the approved bytes into the artifact root, is finished by the next resume: the approved bytes are locked against their hash and written, the run moves on, and no tamper is recorded for the runtime\'s own unfinished step',
  run: async () => {
    await lockAcrossAStop('after-lock-record');
    await lockAcrossAStop('after-lock-commit');
  },
});

export const DRAFT_OUTSIDE_THE_GRANT_GOES_BACK: LocalAssertion = runtime({
  id: 'I4.draft-outside-the-grant-goes-back',
  title:
    'a drafted path the drafting role\'s policy grant does not cover is a runtime problem, outside-grant, which sends the draft back and is never approved or locked: a policy that narrows a drafter\'s writable globs is held at drafting as at build (A-R19-11)',
  run: async () => {
    await withLine('r19-grant-', async (rig) => {
      const r = await drafting(rig);
      const policy = await draftingPolicy({}, { ['spec-drafter' as RoleId]: lineScope(['spec'], 'deep', ['src/**']) });
      await admitAndDrive(r, { policy });
      const [first] = (await rig.state()).drafts.spec?.attempts ?? [];
      const back = first?.sentBack;
      if (back?.by !== 'runtime') throw new Error(`R19: a draft outside its grant was not sent back by the runtime: ${JSON.stringify(back)}`);
      const outside = back.problems.filter((p) => p.code === 'outside-grant').map((p) => p.path);
      if (!sameStrings(outside, Object.keys(helloSpec(rig.runId)))) throw new Error(`R19: the draft's paths outside the grant were ${JSON.stringify(outside)}, not its four files`);
      if ((await (await r.components()).vault.readLocks(rig.runId)) !== null) throw new Error('R19: a draft outside its grant locked something');
    });
  },
});

/** A provider that records every sandbox spec it is asked to provision, forwarding to the stub. */
async function recordingSandbox(): Promise<{ sandbox: SandboxProvider; specs: SandboxSpec[] }> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  const specs: SandboxSpec[] = [];
  return {
    specs,
    sandbox: {
      id: inner.id,
      capabilities: () => inner.capabilities(),
      provision: (spec) => {
        specs.push(spec);
        return inner.provision(spec);
      },
      exec: (h, cmd, opts) => inner.exec(h, cmd, opts),
      destroy: (h) => inner.destroy(h),
    },
  };
}

export const TEST_DRAFTER_IS_BLACK_BOX: LocalAssertion = runtime({
  id: 'I3.test-drafter-is-black-box',
  title:
    'the test drafter\'s sandbox mounts a tree holding the locked spec and nothing of the repository, with no egress, and its context grants the locked spec alone; the test critic sees the same tree with the draft and is mounted read-only; a policy granting either test seat egress is refused at admission',
  run: async () => {
    await withLine('r19-blackbox-', async (rig) => {
      const recorded = await recordingSandbox();
      const r = await drafting(rig, { sandbox: recorded.sandbox });
      const components = r.components;
      const { admitRun } = await api();
      const req = await r.request({ artifacts: artifactsFor(false, true, { security: 'security.json', runRequirements: 'run-requirements.json' }), intent: null });
      await writeFile(join(rig.dirs.artifacts, 'run-requirements.json'), helloSpec(rig.runId)[`.drafts/${rig.runId}/run-requirements.json`] ?? '');
      const admission = await admitRun({ ...req, components: await components() });
      if (!admission.ok) throw new Error(`R19: refused as ${admission.reason}: ${JSON.stringify(admission)}`);
      awaiting(await admission.admitted.drive(), 'test-design:1', 'drafted tests');
      const [drafter] = r.drivers.testDrafter.requests;
      if (drafter === undefined) throw new Error('R19: the test drafter was never seated');
      if (!drafter.stablePrefix.startsWith('[locked-spec]') || drafter.stablePrefix.includes('[base-repo-readonly]') || drafter.stablePrefix.includes('[intent]')) {
        throw new Error('R19: the test drafter was granted context beyond the locked spec');
      }
      const drafterSpec = recorded.specs.find((s) => s.mounts.workspace.source.includes(`test-design.drafter.`));
      if (drafterSpec === undefined) throw new Error('R19: no sandbox was provisioned for the test drafter');
      if (drafterSpec.egress.mode !== 'deny-all' || drafterSpec.mounts.others.length > 0) throw new Error(`R19: the test drafter's sandbox had egress ${JSON.stringify(drafterSpec.egress)} and ${String(drafterSpec.mounts.others.length)} other mounts`);
      // What the mounted workspace held when the drafter's call began: the locked spec's files at their locked bytes, and nothing else.
      const locked = ((await (await components()).vault.readLocks(rig.runId))?.entries ?? []).filter((e) => e.lockedBy === 'spec');
      const [handed] = r.drivers.testDrafter.workspaces;
      if (handed === undefined) throw new Error('R19: the test drafter\'s workspace was not read when its call began');
      if (locked.length === 0 || !sameStrings(Object.keys(handed), locked.map((e) => e.path))) {
        throw new Error(`R19: the test drafter's workspace held ${JSON.stringify(Object.keys(handed))}, not the locked spec ${JSON.stringify(locked.map((e) => e.path))} alone`);
      }
      for (const entry of locked) {
        if (sha256Of(handed[entry.path] ?? '') !== entry.sha256) throw new Error(`R19: the test drafter's workspace held other bytes at ${entry.path} than the spec locked`);
      }
      const criticSpec = recorded.specs.find((s) => s.mounts.workspace.source.includes('test-design.critic.'));
      if (criticSpec?.mounts.workspace.mode !== 'ro' || criticSpec.egress.mode !== 'deny-all' || criticSpec.mounts.others.length > 0) throw new Error('R19: the test critic was not mounted read-only alone with no egress');
      const [critic] = r.drivers.testCritic.requests;
      if (critic === undefined || !critic.stablePrefix.includes('[draft]') || !critic.stablePrefix.includes('[rubric]') || critic.stablePrefix.includes('[intent]')) {
        throw new Error('R19: the test critic was not granted the locked spec, the draft, and the rubric alone');
      }
    });
    for (const role of ['test-drafter', 'test-critic']) {
      await withLine('r19-blackbox-egress-', async (rig) => {
        const { admitRun } = await api();
        const r = await drafting(rig);
        const open = { ...lineScope(['test-design'], 'deep'), network: { egress: ['example.com'] } };
        const policy = await draftingPolicy({}, { [role as RoleId]: open });
        const outcome = await admitRun(await r.request({ policy, artifacts: artifactsFor(true, true) }));
        if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'not-black-box')) {
          throw new Error(`R19: a ${role} granted egress was ${outcome.ok ? 'admitted' : outcome.reason}`);
        }
      });
    }
  },
});

export const BASE_REFUSAL_CARRIES_NOTHING_OF_THE_BASE: LocalAssertion = runtime({
  id: 'I3.base-refusal-tells-the-drafter-nothing-of-the-repository',
  title:
    'a test draft whose check does not do on the base what it declares is sent back before anyone is asked to approve it, and the next attempt learns only that its draft did not hold over the repository: never the check, its exit code, which a drafted check chooses from what it read, or its output (A-R19-11)',
  run: async () => {
    await withLine('r19-base-', async (rig) => {
      const marker = 'REPOSITORY-OUTPUT-MARKER';
      // Attempt 1's check passes on the base though it declares it fails, and prints a marker; attempt 2's is right.
      const leaky = `process.stdout.write(${JSON.stringify(marker)}); process.exit(0);\n`;
      const r = await drafting(rig, { tests: (attempt, id) => helloTests(id, attempt === 1 ? leaky : HELLO_CHECK) });
      const outcome = await admitAndDrive(r, { artifacts: artifactsFor(true, true) });
      awaiting(outcome, 'spec:1', 'a drafted spec');
      const state = lastAttempt(await rig.state(), 'spec');
      if (state.sha256 === null) throw new Error('R19: no spec draft');
      awaiting(await approveAndResume(rig, r, 'spec:1', state.sha256), 'test-design:1', 'drafted tests');
      const attempts = (await rig.state()).drafts['test-design']?.attempts ?? [];
      if (attempts.length !== 2 || attempts[0]?.sentBack?.by !== 'base-run') throw new Error(`R19: the first test draft was not sent back by its base run: ${JSON.stringify(attempts.map((a) => a.sentBack))}`);
      const [, retry] = r.drivers.testDrafter.requests;
      if (retry === undefined) throw new Error('R19: the test drafter was not called again');
      if (!retry.variableSuffix.includes('[base-refusal]')) throw new Error(`R19: the retry was not told its draft did not hold: ${JSON.stringify(retry.variableSuffix)}`);
      // The record keeps what the check did, for a person; the drafter is told none of it.
      const decided = (await decisionsOf((await r.components()).vault, rig.runId)).map((d) => d.decision).find((d) => d.cause === 'draft-sent-back' && d.sentBack.by === 'base-run');
      const sent = decided?.cause === 'draft-sent-back' ? decided.sentBack : undefined;
      if (sent?.by !== 'base-run' || !sent.checks.some((c) => c.checkId === 'drafted-hello' && 'exitCode' in c && c.exitCode === 0)) throw new Error(`R19: the base record does not keep the check's exit code: ${JSON.stringify(sent)}`);
      for (const told of ['drafted-hello', 'exit', 'declared']) {
        if (retry.variableSuffix.includes(told)) throw new Error(`R19: the retry was told ${JSON.stringify(told)} of the base run: ${JSON.stringify(retry.variableSuffix)}`);
      }
      for (const req of [...r.drivers.testDrafter.requests, ...r.drivers.testCritic.requests]) {
        if (req.variableSuffix.includes(marker) || req.stablePrefix.includes(marker) || req.role.instructions.includes(marker)) throw new Error('R19: base output reached a black-box seat');
      }
      for (const tree of [...r.drivers.testDrafter.workspaces, ...r.drivers.testCritic.workspaces]) {
        if (Object.values(tree).some((bytes) => bytes.includes(marker))) throw new Error('R19: base output reached a black-box seat\'s workspace');
      }
      if (r.drivers.testCritic.requests.length !== 1) throw new Error('R19: the critic read a draft the base run had already refused');
    });
  },
});

/** Runs a drafted spec to its gate with `seats`, and returns the conditions the line recorded as failed. */
async function specConditions(rig: LineRig, seats: Seats): Promise<{ failed: readonly DraftCondition[]; r: DraftingRig }> {
  const r = await drafting(rig, seats);
  awaiting(await admitAndDrive(r), 'spec:1', 'a drafted spec');
  const attempt = lastAttempt(await rig.state(), 'spec');
  if (attempt.failed === null) throw new Error('R19: the draft reached the gate with no conditions recorded');
  return { failed: attempt.failed, r };
}

export const DRAFTED_EXIT_FLOOR: LocalAssertion = runtime({
  id: 'I4.drafted-exit-floor',
  title:
    'under a policy cell of auto, a drafted artifact\'s exit is human-required at L0, L1, and L3, and at L2 is auto only with every condition held; a run admitted with its artifacts under the same cell passes the exit with no person; the floor never loosens a human-required or blocked cell',
  run: async () => {
    const { effectiveApproval, STATION_CONTRACTS } = await core();
    // L0 and L1 on the line: the cell is auto, and the drafted exit still waits for a person.
    for (const level of [0, 1] as AutonomyLevel[]) {
      await withLine(`r19-floor-l${String(level)}-`, async (rig) => {
        const r = await drafting(rig);
        awaiting(await admitAndDrive(r, { requestedLevel: level }), `spec:${String(level)}`, `a drafted spec at L${String(level)}`);
        const floors = (await decisionsOf((await r.components()).vault, rig.runId)).filter((d) => d.decision.cause === 'draft-floor-applied');
        if (floors.length === 0) throw new Error(`R19: the floor that held a drafted exit at L${String(level)} was not recorded`);
      });
    }
    // L2 and L3 on the transition the line's exit calls, over a policy whose cells are all auto.
    const policy = await draftingPolicy(Object.fromEntries([0, 1, 2, 3].flatMap((l) => ['spec', 'test-design'].map((s) => [`${s}:${String(l)}`, 'auto']))));
    const draft = { sha256: 'a'.repeat(64), attempt: 1 };
    for (const station of ['spec', 'test-design'] as const) {
      if (effectiveApproval(STATION_CONTRACTS[station], policy, 3, [], { draft, failed: [] }) !== 'human-required') throw new Error(`R19: a drafted ${station} exit at L3 is not human-required`);
      if (effectiveApproval(STATION_CONTRACTS[station], policy, 2, [], { draft, failed: [] }) !== 'auto') throw new Error(`R19: a drafted ${station} exit at L2 with every condition held is not auto`);
      for (const level of [0, 1, 2, 3] as AutonomyLevel[]) {
        if (effectiveApproval(STATION_CONTRACTS[station], policy, level, []) !== 'auto') throw new Error(`R19: a supplied ${station} under auto at L${String(level)} is not auto`);
      }
      const held = await draftingPolicy({ [`${station}:2`]: 'human-required' }) ;
      if (effectiveApproval(STATION_CONTRACTS[station], held, 2, [], { draft, failed: [] }) !== 'human-required') throw new Error('R19: the floor loosened a human-required cell');
      const blocked = await draftingPolicy({ [`${station}:2`]: 'blocked' });
      if (effectiveApproval(STATION_CONTRACTS[station], blocked, 2, [], { draft, failed: [] }) !== 'blocked') throw new Error('R19: the floor loosened a blocked cell');
    }
    // A supplied spec under the same cell at L1 passes `spec` with no person.
    await withLine('r19-floor-supplied-', async (rig) => {
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r, { artifacts: ARTIFACTS, intent: null }), 'integrate:1', 'a supplied spec under auto');
    });
  },
});

export const DRAFTED_FLOOR_CONDITIONS: LocalAssertion = runtime({
  id: 'I4.drafted-floor-conditions',
  title:
    'the line records, for each draft at its gate, every condition of the floor that failed: an open question, a critic of the drafter\'s family or none seated, a failed base run beside a clean critic, a test drafter of the builder\'s family, and a draft whose parts do not parse; at L2 under auto each one alone sends the draft to a person, and a draft with none failed passes',
  run: async () => {
    const { effectiveApproval, STATION_CONTRACTS } = await core();
    const policy = await draftingPolicy({ 'spec:2': 'auto', 'test-design:2': 'auto' });
    const draft = { sha256: 'a'.repeat(64), attempt: 3 };
    const atL2 = (station: DraftStation, failed: readonly DraftCondition[]) => effectiveApproval(STATION_CONTRACTS[station], policy, 2, [], { draft, failed });
    const expectAlone = (station: DraftStation, failed: readonly DraftCondition[], condition: DraftCondition, what: string): void => {
      if (!failed.includes(condition)) throw new Error(`R19: ${what} did not fail '${condition}'; recorded ${JSON.stringify(failed)}`);
      if (atL2(station, [condition]) !== 'human-required') throw new Error(`R19: '${condition}' alone did not send a draft to a person at L2`);
    };
    await withLine('r19-cond-clean-', async (rig) => {
      const { failed } = await specConditions(rig, {});
      if (failed.length !== 0) throw new Error(`R19: a clean spec draft with an independent clean critic failed ${JSON.stringify(failed)}`);
      if (atL2('spec', failed) !== 'auto') throw new Error('R19: a draft with every condition held was not auto at L2');
    });
    await withLine('r19-cond-question-', async (rig) => {
      const { failed } = await specConditions(rig, {
        spec: (_, id) => helloSpec(id, { [`.drafts/${id}/questions.json`]: JSON.stringify({ assumptions: [], openQuestions: ['which greeting?'] }) }),
      });
      expectAlone('spec', failed, 'no-open-question', 'a spec with an open question');
    });
    await withLine('r19-cond-family-', async (rig) => {
      const { failed } = await specConditions(rig, { criticFamily: 'drafter-family', criticModel: 'another-model' });
      expectAlone('spec', failed, 'independent-critic-clean', 'a clean critic of the drafter\'s family');
    });
    await withLine('r19-cond-same-model-', async (rig) => {
      const { failed, r } = await specConditions(rig, { criticFamily: 'drafter-family', criticModel: 'drafter-family-model' });
      expectAlone('spec', failed, 'independent-critic-clean', 'a critic on the drafter\'s own model');
      if (r.drivers.specCritic.requests.length > 0) throw new Error('R19: a critic on the drafter\'s own model was seated');
      if (lastAttempt(await rig.state(), 'spec').critic !== 'not-seated') throw new Error('R19: the attempt does not record that no critic was seated');
    });
    await withLine('r19-cond-shape-', async (rig) => {
      const broken = (_: number, id: string) => helloSpec(id, { [`.drafts/${id}/security.json`]: '{"partly":' });
      const { failed } = await specConditions(rig, { spec: broken });
      expectAlone('spec', failed, 'shape', 'a spec whose security part does not parse, on its last attempt');
      const attempts = (await rig.state()).drafts.spec?.attempts ?? [];
      if (attempts.length !== 3 || attempts.slice(0, 2).some((a) => a.sentBack?.by !== 'runtime')) throw new Error('R19: a draft that does not parse was not sent back by the runtime');
    });
    await withLine('r19-cond-builder-', async (rig) => {
      // The test drafter on the builder's family: the stub builder's.
      const r = await drafting(rig, { testDrafterFamily: 'stub' });
      awaiting(await admitAndDrive(r, { artifacts: artifactsFor(true, true) }), 'spec:1', 'a drafted spec');
      const spec = lastAttempt(await rig.state(), 'spec');
      awaiting(await approveAndResume(rig, r, 'spec:1', spec.sha256 ?? ''), 'test-design:1', 'drafted tests');
      const failed = lastAttempt(await rig.state(), 'test-design').failed ?? [];
      expectAlone('test-design', failed, 'drafter-independent-of-builder', 'a test drafter of the builder\'s family');
    });
    await withLine('r19-cond-base-', async (rig) => {
      // Every attempt's check passes on the base though it declares it fails; the critic is clean throughout.
      const r = await drafting(rig, { tests: (_, id) => helloTests(id, 'process.exit(0);\n') });
      awaiting(await admitAndDrive(r, { artifacts: artifactsFor(true, true) }), 'spec:1', 'a drafted spec');
      const spec = lastAttempt(await rig.state(), 'spec');
      awaiting(await approveAndResume(rig, r, 'spec:1', spec.sha256 ?? ''), 'test-design:1', 'drafted tests, the third refused on the base');
      const attempt = lastAttempt(await rig.state(), 'test-design');
      if (attempt.attempt !== 3 || attempt.critic === null || attempt.critic === 'not-seated') throw new Error('R19: the third test draft did not reach a clean critic');
      const critic = await readRecord<CriticRecord>((await r.components()).vault, attempt.critic);
      if (!critic.binding || critic.findings.length > 0) throw new Error('R19: the critic of the third draft was not independent and clean');
      expectAlone('test-design', attempt.failed ?? [], 'base-run-passed', 'a clean critic beside a failed base run');
    });
  },
});

export const CRITIC_FINDING_SENDS_BACK: LocalAssertion = runtime({
  id: 'I5.critic-finding-sends-back',
  title:
    'any finding from an independent critic sends the draft back with the findings in the next attempt\'s variable suffix, and a result the runtime cannot read counts as one; the drafter is never asked to settle it in its stable prefix or role',
  run: async () => {
    await withLine('r19-finding-', async (rig) => {
      const r = await drafting(rig, { critic: (_, attempt) => (attempt === 1 ? JSON.stringify({ findings: ['statement 2 cannot be tested'] }) : attempt === 2 ? 'Looks fine to me!' : CLEAN) });
      awaiting(await admitAndDrive(r), 'spec:1', 'a drafted spec after two critiques');
      const attempts = (await rig.state()).drafts.spec?.attempts ?? [];
      if (attempts.length !== 3 || attempts[0]?.sentBack?.by !== 'critic' || attempts[1]?.sentBack?.by !== 'critic') {
        throw new Error(`R19: a finding and an unreadable result did not each send the draft back: ${JSON.stringify(attempts.map((a) => a.sentBack))}`);
      }
      const vault = (await r.components()).vault;
      const second = attempts[1].critic;
      if (second == null || second === 'not-seated') throw new Error('R19: no critic record for the second attempt');
      const unreadable = await readRecord<CriticRecord>(vault, second);
      if (unreadable.readable || unreadable.findings.length !== 1) throw new Error(`R19: an unreadable critic result was recorded as ${JSON.stringify(unreadable)}`);
      const [, retry] = r.drivers.specDrafter.requests;
      if (!retry?.variableSuffix.includes('statement 2 cannot be tested')) throw new Error('R19: the finding did not reach the next attempt\'s variable suffix');
      if (retry.stablePrefix.includes('statement 2 cannot be tested') || retry.role.instructions.includes('statement 2 cannot be tested')) throw new Error('R19: a finding reached the stable prefix or the role');
      // Attempt 3 is told attempt 2's result could not be read, in its suffix alone.
      const third = r.drivers.specDrafter.requests[2];
      const unreadableFinding = unreadable.findings[0] ?? '';
      if (!third?.variableSuffix.includes(unreadableFinding)) throw new Error(`R19: the third attempt was not told the second critic's result was unreadable: ${JSON.stringify(third?.variableSuffix)}`);
      if (third.stablePrefix.includes(unreadableFinding) || third.role.instructions.includes(unreadableFinding)) throw new Error('R19: the unreadable result reached the stable prefix or the role');
      for (const tree of r.drivers.specDrafter.workspaces.slice(1)) {
        if (Object.values(tree).some((bytes) => bytes.includes('statement 2 cannot be tested') || bytes.includes(unreadableFinding))) throw new Error('R19: a finding reached a retry\'s workspace');
      }
      if (!(await decisionsOf(vault, rig.runId)).some((d) => d.decision.cause === 'draft-sent-back')) throw new Error('R19: no draft-sent-back decision was recorded');
    });
  },
});

export const CRITIC_OF_DRAFTER_FAMILY_IS_ADVISORY: LocalAssertion = runtime({
  id: 'I6.critic-of-drafter-family-is-advisory',
  title:
    'a critic of the drafter\'s family, on another model, is graded different-model, from the model the runtime resolved even where its result reports another family: its findings are recorded and shown to the person deciding the draft, and they neither send it back nor end an attempt',
  run: async () => {
    for (const criticReports of [undefined, 'critic-family']) await withLine('r19-advisory-', async (rig) => {
      const { runStanding } = await api();
      const r = await drafting(rig, { criticFamily: 'drafter-family', criticModel: 'another-model', ...(criticReports === undefined ? {} : { criticReports }), critic: () => JSON.stringify({ findings: ['the spec says nothing about permissions'] }) });
      awaiting(await admitAndDrive(r), 'spec:1', 'a drafted spec with an advisory finding');
      const attempts = (await rig.state()).drafts.spec?.attempts ?? [];
      if (attempts.length !== 1 || attempts[0]?.sentBack !== null) throw new Error('R19: an advisory finding sent the draft back');
      const vault = (await r.components()).vault;
      const { standing } = await runStanding(vault, rig.runId);
      if (standing.standing !== 'awaiting-approval' || standing.draft?.critic?.grade !== 'different-model' || standing.draft.critic.binding || !standing.draft.critic.findings.includes('the spec says nothing about permissions')) {
        throw new Error(`R19: the person deciding the draft was shown ${JSON.stringify(standing)}`);
      }
    });
  },
});

export const TEST_DRAFTER_OF_BUILDER_FAMILY: LocalAssertion = runtime({
  id: 'I6.test-drafter-of-builder-family',
  title:
    'a test drafter of a family the build driver can resolve, escalation included, fails the floor\'s independence condition below L3 and is refused at L3, as a same-family reviewer is; one of another family is seated and graded different-family',
  run: async () => {
    const { seatTestDrafter } = await core();
    const model = (family: string, name = `${family}-model`): ModelIdentity => ({ provider: 'p', family: family as ModelFamily, model: name, version: '1' });
    const builders = [model('builder-family', 'fast'), model('escalated-family', 'deep')];
    for (const family of ['builder-family', 'escalated-family']) {
      const l3 = seatTestDrafter(model(family), builders, 3);
      if (l3.ok || l3.reason !== 'same-family-drafter') throw new Error(`R19: a ${family} test drafter at L3 was ${JSON.stringify(l3)}`);
      const l2 = seatTestDrafter(model(family), builders, 2);
      if (!l2.ok || l2.grade === 'different-family') throw new Error(`R19: a ${family} test drafter below L3 was graded ${JSON.stringify(l2)}`);
    }
    const other = seatTestDrafter(model('other-family'), builders, 3);
    if (!other.ok || other.grade !== 'different-family') throw new Error('R19: a test drafter of another family was not seated at L3');
    // On the line the escalation ceiling counts: the builder escalates from standard to deep on another family.
    await withLine('r19-builder-esc-', async (rig) => {
      const { builderModels } = await api();
      const families = { standard: 'stub', deep: 'deep-family' };
      const driver: Driver = { ...(await seat({ family: 'stub' })), resolveModel: (tier) => model(families[tier as 'standard' | 'deep'], tier) };
      const policy = await draftingPolicy({}, { ['builder' as RoleId]: { ...lineScope(['build', 'verify'], 'standard'), escalation: { afterFailedGates: 1, ceiling: 'deep' } } });
      const { parseGraph } = await api();
      const graph = parseGraph(JSON.parse(await readFile(join(rig.dirs.artifacts, 'graph.json'), 'utf8')), { runId: rig.runId, baseCommit: '0', workspace: rig.dirs.artifacts });
      if (!graph.ok) throw new Error('R19: the fixture graph did not parse');
      const resolved = builderModels({ graph: graph.graph, policy, components: { ...(await rig.components()), driver } });
      const names = resolved.map((m) => m.family).sort();
      if (JSON.stringify(names) !== JSON.stringify(['deep-family', 'stub'])) throw new Error(`R19: the builder's models were read as ${JSON.stringify(names)}, escalation not included`);
    });
    // On the line, a test drafter that resolves to the builder's family and reports another is graded by the one resolved.
    await withLine('r19-builder-reported-', async (rig) => {
      const r = await drafting(rig, { testDrafterFamily: 'stub', testDrafterReports: 'other-family' });
      awaiting(await admitAndDrive(r, { artifacts: artifactsFor(true, true) }), 'spec:1', 'a drafted spec');
      const spec = lastAttempt(await rig.state(), 'spec');
      awaiting(await approveAndResume(rig, r, 'spec:1', spec.sha256 ?? ''), 'test-design:1', 'drafted tests');
      const failed = lastAttempt(await rig.state(), 'test-design').failed ?? [];
      if (!failed.includes('drafter-independent-of-builder')) throw new Error(`R19: a test drafter resolved to the builder's family and reporting another was graded independent; failed ${JSON.stringify(failed)}`);
    });
  },
});

export const LAST_ATTEMPT_GOES_TO_A_PERSON: LocalAssertion = runtime({
  id: 'I5.last-attempt-goes-to-a-person',
  title:
    'a third draft an independent critic finds against goes to a person rather than back; a person\'s rejection of it parks the run terminally with drafts-rejected, recorded with its station before it is committed, and a resume stops on the park',
  run: async () => {
    await withLine('r19-park-', async (rig) => {
      const { rejectDraft, resumeRun } = await api();
      const r = await drafting(rig, { critic: () => JSON.stringify({ findings: ['still untestable'] }) });
      awaiting(await admitAndDrive(r), 'spec:1', 'a third drafted spec with findings');
      const state = await rig.state();
      const attempt = lastAttempt(state, 'spec');
      if (attempt.attempt !== 3 || !(attempt.failed ?? []).includes('independent-critic-clean')) throw new Error(`R19: the third draft reached the gate as ${JSON.stringify(attempt)}`);
      const base = (await r.components()).vault;
      // The park is recorded before the parked state is committed: a stop between the two leaves no park unrecorded.
      let parkRecorded = false;
      const parkedCommits: boolean[] = [];
      const vault: Vault = {
        ...around(base, { beforeCommit: (s) => { if (s.drafts.spec?.parked === true) parkedCommits.push(parkRecorded); } }),
        recordDecision: async (d) => {
          const ref = await base.recordDecision(d);
          if (d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'parked' && d.decision.refusal.cause === 'drafts-rejected') parkRecorded = true;
          return ref;
        },
      };
      const rejected = await rejectDraft({ runId: rig.runId, key: 'spec:1', draft: attempt.sha256 ?? '', notes: null, rejectedBy: 'conformance', vault });
      if (!rejected.ok || !rejected.parked) throw new Error(`R19: rejecting the third draft was ${JSON.stringify(rejected)}`);
      if (parkedCommits.length === 0 || parkedCommits.some((recorded) => !recorded)) throw new Error(`R19: the parked state was committed before its park was recorded: ${JSON.stringify(parkedCommits)}`);
      const decisions = await decisionsOf(vault, rig.runId);
      const park = decisions.find((d) => d.decision.cause === 'station-refused' && d.decision.refusal.reason === 'parked' && d.decision.refusal.cause === 'drafts-rejected');
      if (park?.station !== 'spec') throw new Error('R19: the park was not recorded at spec');
      if (!decisions.some((d) => d.decision.cause === 'approval-rejected')) throw new Error('R19: the rejection was not recorded');
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components: await r.components() }), 'a parked run resumed');
      if (resumed.transition.reason !== 'parked' || resumed.transition.cause !== 'drafts-rejected') throw new Error(`R19: a resume of the parked run stopped as ${resumed.transition.reason}`);
      if (r.drivers.specDrafter.requests.length !== 3) throw new Error('R19: the parked run drafted again');
    });
  },
});

export const REJECTION_TEXT_ONLY_AT_SPEC: LocalAssertion = runtime({
  id: 'I7.rejection-text-only-at-spec',
  title:
    'a person\'s notes on a rejected spec reach the next attempt in its variable suffix as the approver\'s words, never its stable prefix or role; a test-design rejection carrying text is refused, and one with a reason from the fixed set reaches the next attempt as that reason alone',
  run: async () => {
    await withLine('r19-notes-', async (rig) => {
      const { rejectDraft, resumeRun } = await api();
      const r = await drafting(rig);
      awaiting(await admitAndDrive(r, { artifacts: artifactsFor(true, true) }), 'spec:1', 'a drafted spec');
      const vault = (await r.components()).vault;
      const notes = 'name the file and its exact content';
      const spec = lastAttempt(await rig.state(), 'spec');
      const rejected = await rejectDraft({ runId: rig.runId, key: 'spec:1', draft: spec.sha256 ?? '', notes, rejectedBy: 'conformance', vault });
      if (!rejected.ok) throw new Error(`R19: a spec rejection with notes was refused as ${rejected.reason}`);
      awaiting(await resumeRun({ runId: rig.runId, components: await r.components() }), 'spec:1', 'the second spec attempt');
      const [, retry] = r.drivers.specDrafter.requests;
      if (!retry?.variableSuffix.includes(`[approver-notes]\n${notes}`)) throw new Error('R19: the notes did not reach the next spec attempt');
      if (retry.stablePrefix.includes(notes) || retry.role.instructions.includes(notes)) throw new Error('R19: the notes reached the stable prefix or the role');
      if (Object.values(r.drivers.specDrafter.workspaces[1] ?? {}).some((bytes) => bytes.includes(notes))) throw new Error('R19: the notes reached the retry\'s workspace');
      const second = lastAttempt(await rig.state(), 'spec');
      awaiting(await approveAndResume(rig, r, 'spec:1', second.sha256 ?? ''), 'test-design:1', 'drafted tests');
      const tests = lastAttempt(await rig.state(), 'test-design');
      const withText = await rejectDraft({ runId: rig.runId, key: 'test-design:1', draft: tests.sha256 ?? '', notes: 'the hello check reads src/', reason: 'not-black-box', rejectedBy: 'conformance', vault });
      if (withText.ok || withText.reason !== 'invalid-request') throw new Error(`R19: a test-design rejection with text was ${withText.ok ? 'recorded' : withText.reason}`);
      const reasoned = await rejectDraft({ runId: rig.runId, key: 'test-design:1', draft: tests.sha256 ?? '', reason: 'not-black-box', rejectedBy: 'conformance', vault });
      if (!reasoned.ok) throw new Error(`R19: a test-design rejection with a reason was refused as ${reasoned.reason}`);
      awaiting(await resumeRun({ runId: rig.runId, components: await r.components() }), 'test-design:1', 'the second test attempt');
      const [, testRetry] = r.drivers.testDrafter.requests;
      if (testRetry === undefined || !testRetry.variableSuffix.includes('[rejection-reason]\nnot-black-box') || testRetry.variableSuffix.includes('src/')) {
        throw new Error(`R19: the test drafter's retry was told ${JSON.stringify(testRetry?.variableSuffix)}`);
      }
      if (testRetry.stablePrefix.includes(notes) || testRetry.role.instructions.includes(notes)) throw new Error('R19: the spec\'s rejection notes reached the test drafter');
      if (Object.values(r.drivers.testDrafter.workspaces[1] ?? {}).some((bytes) => bytes.includes(notes) || bytes.includes('src/'))) throw new Error('R19: rejection text reached the test drafter\'s workspace');
    });
  },
});

export const INTENT_IS_NOT_A_PAYLOAD: LocalAssertion = compileError({
  id: 'I7.intent-is-not-a-payload',
  title: 'an intent is a person\'s text from the principal\'s channel: a trigger\'s payload, its raw text, or an intent naming another channel does not compile as one',
  fixture: 'i7/intent-is-not-a-payload.ts',
});

export const INTENT_REFUSED_FROM_ANOTHER_CHANNEL: LocalAssertion = runtime({
  id: 'I7.intent-refused-from-another-channel',
  title: 'an intent that reached admission past the compiler claiming another channel is refused, and the Vault refuses to record one that did not come from the principal',
  run: async () => {
    await withLine('r19-channel-', async (rig) => {
      const { admitRun } = await api();
      const r = await drafting(rig);
      const outcome = await admitRun(await r.request({ intent: { text: INTENT.text, from: 'trigger' } as never }));
      if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'not-an-intent')) throw new Error(`R19: an intent from a trigger was ${outcome.ok ? 'admitted' : outcome.reason}`);
      const vault = (await r.components()).vault;
      await vault.recordIntent({ runId: rig.runId, text: INTENT.text, from: 'trigger', collectedBy: 'runtime' } as never).then(
        () => { throw new Error('R19: the Vault recorded an intent from a trigger'); },
        (error: unknown) => { if (!String(error).includes('principal')) throw error; },
      );
    });
  },
});

export const WORST_CASE_COVERS_DRAFTING: LocalAssertion = runtime({
  id: 'I5.worst-case-covers-drafting-seats',
  title: 'the worst-case cost a person approves at admission counts every call each drafting seat may make, drafter and critic, so a drafting run approved for the figure without them is refused as cost-unapproved',
  run: async () => {
    await withLine('r19-cost-', async (rig) => {
      const { admitRun, worstCaseCost } = await api();
      const r = await drafting(rig);
      const req = await r.request({ artifacts: artifactsFor(true, true) });
      const graph = JSON.parse(await readFile(join(rig.dirs.artifacts, 'graph.json'), 'utf8')) as { tasks: Parameters<typeof worstCaseCost>[0]['tasks'] };
      const without = worstCaseCost({ tasks: graph.tasks, edges: [] }, req.policy);
      const outcome = await admitRun({ ...req, approvedCostUsd: without.usd });
      if (outcome.ok || outcome.reason !== 'cost-unapproved') throw new Error(`R19: a drafting run approved without its seats' cost was ${outcome.ok ? 'admitted' : outcome.reason}`);
      const seats = outcome.worstCase.tasks.filter((t) => t.station === 'spec' || t.station === 'test-design');
      if (seats.length !== 4 || outcome.worstCase.usd <= without.usd) throw new Error(`R19: the worst case counts ${String(seats.length)} drafting seats`);
    });
  },
});

/**
 * Asks for approval of `draft` at spec:1 and requires it refused as `reason`:
 * exactly one decision added, an approval-refused for that reason at that
 * key, no grant among the decisions added, and the run's grants unchanged.
 */
async function refusedApproval(rig: LineRig, vault: Vault, draft: string | null, reason: 'draft-mismatch' | 'draft-invalid'): Promise<EnforcementDecision> {
  const { approveStation } = await api();
  const before = new Set((await vault.readDecisions(rig.runId as never)).map((ref) => ref.hash));
  const grants = JSON.stringify((await rig.state()).approvals);
  const refused = await approveStation({ runId: rig.runId, key: 'spec:1', draft, approvedBy: 'conformance', vault });
  if (refused.ok || refused.reason !== reason) throw new Error(`R19: an approval naming ${String(draft)} was ${refused.ok ? 'granted' : refused.reason}, not ${reason}`);
  const added: EnforcementDecision[] = [];
  for (const ref of await vault.readDecisions(rig.runId)) if (!before.has(ref.hash)) added.push(await readRecord<EnforcementDecision>(vault, ref));
  const [only] = added;
  if (added.length !== 1 || only?.decision.cause !== 'approval-refused' || only.decision.reason !== reason || only.decision.key !== 'spec:1') {
    throw new Error(`R19: refusing an approval naming ${String(draft)} recorded ${JSON.stringify(added.map((d) => d.decision))}`);
  }
  if (JSON.stringify((await rig.state()).approvals) !== grants) throw new Error(`R19: a refused approval naming ${String(draft)} changed the run's grants`);
  return only;
}

/** For P14's table: a drafting run that records each drafting decision, read back for its decider and station. */
export async function draftingDecision(cause: 'approval-rejected' | 'draft-sent-back' | 'draft-floor-applied' | 'draft-mismatch' | 'draft-invalid'): Promise<void> {
  await withLine(`p14-${cause}-`, async (rig) => {
    const { rejectDraft } = await api();
    const seats: Seats = cause === 'draft-sent-back'
      ? { critic: (_, attempt) => (attempt === 1 ? JSON.stringify({ findings: ['one'] }) : CLEAN) }
      : cause === 'draft-invalid'
        ? { spec: (_, id) => helloSpec(id, { [`.drafts/${id}/spec.md`]: '' }) }
        : {};
    const r = await drafting(rig, seats);
    awaiting(await admitAndDrive(r), 'spec:1', `a drafted spec for ${cause}`);
    const vault = (await r.components()).vault;
    const attempt = lastAttempt(await rig.state(), 'spec');
    let found: EnforcementDecision | undefined;
    if (cause === 'approval-rejected') {
      const rejected = await rejectDraft({ runId: rig.runId, key: 'spec:1', draft: attempt.sha256 ?? '', rejectedBy: 'conformance', vault });
      if (!rejected.ok) throw new Error(`P14: the rejection was refused as ${rejected.reason}`);
      const rejections = (await decisionsOf(vault, rig.runId)).filter((d) => d.decision.cause === 'approval-rejected');
      // Bound to the draft rejected, and recorded once.
      const [only] = rejections;
      if (rejections.length !== 1 || only?.decision.cause !== 'approval-rejected' || only.decision.draft.sha256 !== attempt.sha256 || only.decision.draft.attempt !== attempt.attempt) {
        throw new Error(`P14: the rejection of ${String(attempt.sha256)} was recorded as ${JSON.stringify(rejections.map((d) => d.decision))}`);
      }
      found = only;
    } else if (cause === 'draft-mismatch' || cause === 'draft-invalid') {
      found = await refusedApproval(rig, vault, cause === 'draft-mismatch' ? '0'.repeat(64) : attempt.sha256, cause);
    } else {
      const decisions = await decisionsOf(vault, rig.runId);
      found = decisions.find((d) => d.decision.cause === cause);
      if (found === undefined) throw new Error(`P14: no ${cause} decision was recorded; recorded ${JSON.stringify(decisions.map((d) => d.decision.cause))}`);
    }
    const decider = cause === 'approval-rejected' || cause === 'draft-mismatch' || cause === 'draft-invalid' ? 'approval' : 'line';
    if (found.decision.decidedBy !== decider || found.station !== 'spec' || found.runId !== rig.runId) throw new Error(`P14: a ${cause} decision was recorded as ${JSON.stringify(found)}`);
  });
}

/** For P14's table: a rejection of the last allowed draft, recorded as the park it makes. */
export async function draftsRejectedPark(): Promise<void> {
  await LAST_ATTEMPT_GOES_TO_A_PERSON.run();
}

export const R19_ASSERTIONS = {
  I3: [DRAFTED_SPEC_LOCKS_NOTHING_UNTIL_APPROVED, DRAFTED_TESTS_LOCK_AND_RUN, SUPPLIED_ARTIFACTS_SEAT_NO_DRAFTER, APPROVAL_BINDS_THE_DRAFT, LOCKED_DRAFT_IS_THE_BYTES_READ, TEST_DRAFTER_IS_BLACK_BOX, BASE_REFUSAL_CARRIES_NOTHING_OF_THE_BASE],
  I4: [DRAFTED_EXIT_FLOOR, DRAFTED_FLOOR_CONDITIONS, DRAFT_OUTSIDE_THE_GRANT_GOES_BACK],
  I5: [SPEC_LESS_RUN_NEEDS_AN_INTENT, CRITIC_FINDING_SENDS_BACK, LAST_ATTEMPT_GOES_TO_A_PERSON, WORST_CASE_COVERS_DRAFTING, DRAFT_LOCK_SURVIVES_A_STOP],
  I6: [CRITIC_OF_DRAFTER_FAMILY_IS_ADVISORY, TEST_DRAFTER_OF_BUILDER_FAMILY],
  I7: [REJECTION_TEXT_ONLY_AT_SPEC, INTENT_IS_NOT_A_PAYLOAD, INTENT_REFUSED_FROM_ANOTHER_CHANNEL],
} as const;
