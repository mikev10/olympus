/**
 * Drafting at `spec` and `test-design` (R19). A run admitted without its spec
 * or its acceptance tests drafts them on the line: a drafter writes, the
 * runtime reads exactly the draft's paths and records the bytes it read under
 * one hash, the base run runs a test draft over the base, an independent
 * critic reads the recorded bytes, and the exit's approval carries the
 * drafted floor. What a person or the policy approved is written into the
 * artifact root and the base, and locked against that hash (I3).
 *
 * Every step is recorded before the next reads it, in run state's attempt for
 * the station, so a resume does only what is not recorded. Nothing here takes
 * a status from a model (I2): a draft is a claim until it is approved and
 * locked, and a critic's clean result is one condition among others the
 * runtime checks itself, never sufficient (D-A-DS-07).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  capabilityRefusal,
  CRITIC_CONTRACTS,
  DRAFT_ROLES,
  gradeAgainst,
  gradeOf,
  grantedContext,
  grantedCriticContext,
  MODEL_TIERS,
  retrySuffix,
  seatTask,
  seatTestDrafter,
  STATION_CONTRACTS,
  stationTier,
  tierFor,
  tierRank,
  weakerGrade,
} from '@olympus-ai/core';
import type {
  BaseRefusalPart,
  ContextGrant,
  DraftAttempt,
  DraftCondition,
  DraftFloor,
  DraftRef,
  DraftSendBack,
  DraftSeat,
  DraftState,
  DraftStation,
  Driver,
  ModelIdentity,
  RetryPart,
  RunState,
  StationRefusal,
  VaultRef,
} from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import { draftDigest } from '@olympus-ai/vault';
import type { BaseRunRecord, CriticRecord, DecisionCause, DraftFile, DraftLockRecord, DraftRecord, Vault } from '@olympus-ai/vault';
import { baseMismatches, baseRefusal } from './base.js';
import { recordDecision } from './decisions.js';
import {
  attemptsOf,
  commit,
  joinParts,
  pinnedRole,
  readRecord,
  readText,
  recordTamper,
  runOnBase,
  runTask,
  scopeFor,
  spendRetry,
  specArtifacts,
  startAttempt,
  tamperedPaths,
  type LineArtifacts,
  type LineContext,
} from './line.js';
import { denialRefusal, parseSecurityPart, type SecurityPart } from './security.js';
import { DRAFT_DIR, parseQuestions, parseRunRequirements, type RunRequirements } from './spec-parts.js';
import { mergedCheckProblems, parseManifest } from './validate.js';
import { suiteBindingProblems, taskResultProblems, writesOutsideGrant } from './verification.js';
import { basePath, copyOnly, copyTree, draftBaseRunPath, draftPaths, existsIn, ownDiff, scratchPath, treeDigest, writeFiles } from './workspace.js';

/** The drivers that seat each drafter and each critic (R19). A run that drafts is refused without them. */
export interface DraftingDrivers {
  readonly specDrafter: Driver;
  readonly specCritic: Driver;
  readonly testDrafter: Driver;
  readonly testCritic: Driver;
}

/** What a run was admitted to draft, with the intent and rubrics it was admitted with (R19). */
export interface DraftingContext {
  readonly drafted: Readonly<Record<DraftStation, boolean>>;
  readonly intent: string | null;
  readonly rubrics: Readonly<Partial<Record<DraftStation, { readonly text: string; readonly sha256: string }>>>;
}

export const NOT_DRAFTING: DraftingContext = Object.freeze({ drafted: Object.freeze({ spec: false, 'test-design': false }), intent: null, rubrics: Object.freeze({}) });

/** Where a drafted spec's files are written, in the drafter's tree and in the artifact root alike. */
export function specDraftPaths(runId: string): { readonly spec: string; readonly security: string; readonly runRequirements: string; readonly questions: string } {
  const dir = `${DRAFT_DIR}/${runId}`;
  return { spec: `${dir}/spec.md`, security: `${dir}/security.json`, runRequirements: `${dir}/run-requirements.json`, questions: `${dir}/questions.json` };
}

/** Where a drafted acceptance manifest is written. */
export function manifestDraftPath(runId: string): string {
  return `${DRAFT_DIR}/${runId}/acceptance.json`;
}

export function seatDriver(drivers: DraftingDrivers, station: DraftStation, seat: DraftSeat): Driver {
  if (station === 'spec') return seat === 'drafter' ? drivers.specDrafter : drivers.specCritic;
  return seat === 'drafter' ? drivers.testDrafter : drivers.testCritic;
}

export function isDrafted(ctx: Pick<LineContext, 'drafting'>, station: DraftStation): boolean {
  return ctx.drafting.drafted[station];
}

function draftsOf(state: RunState, station: DraftStation): DraftState {
  return state.drafts[station] ?? { attempts: [], locked: null, parked: false };
}

/** The floor a drafted exit carries: the station's last draft and the conditions found failed for it when it reached the gate. */
export function draftFloorOf(state: RunState, station: DraftStation): DraftFloor {
  const last = draftsOf(state, station).attempts.at(-1);
  if (last?.sha256 == null || last.failed === null) throw new Error(`line: ${station} reached its exit with no draft at the gate`);
  return { draft: { sha256: last.sha256, attempt: last.attempt }, failed: last.failed };
}

/** The draft the locked acceptance tests came from, or null for tests the run was admitted with: which base record `verify` reads. */
export function testDraftOf(ctx: Pick<LineContext, 'drafting' | 'state'>): string | null {
  if (!isDrafted(ctx, 'test-design')) return null;
  return draftsOf(ctx.state, 'test-design').attempts.at(-1)?.sha256 ?? null;
}

function maxAttempts(station: DraftStation): number {
  return STATION_CONTRACTS[station].maxIterations;
}

function emptyAttempt(attempt: number): DraftAttempt {
  return { attempt, draft: null, sha256: null, critic: null, baseRun: null, failed: null, sentBack: null };
}

/** Replaces the station's last attempt with `change` applied, in one commit. */
async function updateAttempt(ctx: LineContext, station: DraftStation, change: Partial<DraftAttempt>, extra: { phase?: RunState['phase'] } = {}): Promise<void> {
  const drafts = draftsOf(ctx.state, station);
  const last = drafts.attempts.at(-1);
  if (last === undefined) throw new Error(`line: ${station} has no attempt to update`);
  await commit(ctx, { ...extra, drafts: { [station]: { ...drafts, attempts: [...drafts.attempts.slice(0, -1), { ...last, ...change }] } } });
}

/**
 * The station's drafting, from what run state records: a new attempt where
 * the last went back, the drafter where it has not drafted, then the base run
 * of a test draft, then the critic, then the gate. Each step is committed
 * before the next, and an attempt sent back is never resumed. Returns a
 * refusal, or undefined once the draft is at the gate and the station is
 * exiting.
 */
export async function draftStation(ctx: LineContext, station: DraftStation): Promise<StationRefusal | undefined> {
  for (;;) {
    const drafts = draftsOf(ctx.state, station);
    const current = drafts.attempts.at(-1);
    if (current?.sentBack !== null) {
      const attempt = (current?.attempt ?? 0) + 1;
      // An attempt goes back only while another is allowed; the last goes to a person, whose rejection parks the run.
      if (attempt > maxAttempts(station)) throw new Error(`line: ${station} ran past its ${String(maxAttempts(station))} attempts`);
      await commit(ctx, { drafts: { [station]: { ...drafts, attempts: [...drafts.attempts, emptyAttempt(attempt)] } } });
      continue;
    }
    if (current.draft === null) {
      const refusal = await draft(ctx, station, current, drafts.attempts.at(-2) ?? null);
      if (refusal !== undefined) return refusal;
      continue;
    }
    const record = await readRecord<DraftRecord>(ctx, current.draft);
    const last = current.attempt >= maxAttempts(station);
    if (record.problems.length > 0) {
      if (!last) {
        await sendBack(ctx, station, current, { by: 'runtime', problems: record.problems });
        continue;
      }
      return toGate(ctx, station, current, record);
    }
    if (station === 'test-design') {
      if (current.baseRun === null) {
        const refusal = await baseRunDraft(ctx, record);
        if (refusal !== undefined) return refusal;
        continue;
      }
      const judged = await judgeBase(ctx, current.baseRun, record);
      if (judged.refusal !== undefined) return judged.refusal;
      if (judged.parts.length > 0 && !last) {
        await sendBack(ctx, station, current, { by: 'base-run' }, { by: 'base-run', baseRun: current.baseRun, checks: judged.parts });
        continue;
      }
    }
    if (current.critic === null) {
      const refusal = await critique(ctx, station, current, record);
      if (refusal !== undefined) return refusal;
      continue;
    }
    if (current.critic !== 'not-seated') {
      const critic = await readRecord<CriticRecord>(ctx, current.critic);
      // A critic of the drafter's family is advisory: its findings are shown to the person and send nothing back (D-A-DS-06).
      if (critic.binding && critic.findings.length > 0 && !last) {
        await sendBack(ctx, station, current, { by: 'critic' }, { by: 'critic', critic: current.critic, findings: critic.findings.length });
        continue;
      }
    }
    return toGate(ctx, station, current, record);
  }
}

/** Records why a draft went back, then ends its attempt: the decision before the state, as a park is (D-P14-07). */
async function sendBack(
  ctx: LineContext, station: DraftStation, current: DraftAttempt, sentBack: DraftSendBack,
  decided?: Extract<DecisionCause, { cause: 'draft-sent-back' }>['sentBack'],
): Promise<void> {
  if (current.sha256 === null) throw new Error(`line: ${station} cannot send back an attempt that drafted nothing`);
  const draft: DraftRef = { sha256: current.sha256, attempt: current.attempt };
  const why = decided ?? (sentBack.by === 'runtime' ? { by: 'runtime' as const, problems: sentBack.problems } : undefined);
  if (why === undefined) throw new Error(`line: a ${sentBack.by} send-back carries what it is decided from`);
  await recordDecision({ vault: ctx.components.vault, runId: ctx.run.id, taskId: null, station }, { cause: 'draft-sent-back', decidedBy: 'line', draft, sentBack: why });
  await updateAttempt(ctx, station, { sentBack });
}

/** The draft at the gate: the runtime's conditions evaluated and recorded with the attempt, and the station exiting. */
async function toGate(ctx: LineContext, station: DraftStation, current: DraftAttempt, record: DraftRecord): Promise<undefined> {
  const failed = await conditionsFailed(ctx, station, current, record);
  await updateAttempt(ctx, station, { failed }, { phase: 'exiting' });
  return undefined;
}

/**
 * Each condition of the drafted floor that does not hold for this draft, by
 * name (D-A-DS-04). A condition the runtime cannot evaluate has failed (I5):
 * a questions part that does not parse has open questions as far as the
 * floor knows, and a critic that was not seated returned no clean result.
 */
async function conditionsFailed(ctx: LineContext, station: DraftStation, current: DraftAttempt, record: DraftRecord): Promise<DraftCondition[]> {
  const failed: DraftCondition[] = [];
  if (record.problems.length > 0) failed.push('shape');
  if (station === 'spec') {
    const questions = fileOf(record, specDraftPaths(ctx.run.id).questions);
    const parsed = questions === undefined ? undefined : parseQuestions(jsonOf(questions), 'questions');
    if (parsed === undefined || !parsed.ok || parsed.part.openQuestions.length > 0) failed.push('no-open-question');
  }
  let clean = false;
  if (current.critic !== null && current.critic !== 'not-seated') {
    const critic = await readRecord<CriticRecord>(ctx, current.critic);
    clean = critic.binding && critic.findings.length === 0;
  }
  if (!clean) failed.push('independent-critic-clean');
  if (station === 'test-design') {
    const passed = current.baseRun !== null && (await judgeBase(ctx, current.baseRun, record)).parts.length === 0;
    if (!passed) failed.push('base-run-passed');
    if (gradeAgainst(record.model, builderModels(ctx)) !== 'different-family') failed.push('drafter-independent-of-builder');
  }
  return failed;
}

/**
 * Every model the build driver can resolve for this run: each build task's
 * station tier, and each tier its escalation grant can raise it to (R14). A
 * test drafter of any of their families is not independent of the builder.
 */
export function builderModels(ctx: Pick<LineContext, 'graph' | 'policy' | 'components'>): ModelIdentity[] {
  const models = new Map<string, ModelIdentity>();
  for (const task of ctx.graph.tasks) {
    if (task.station !== 'build') continue;
    const scope = scopeFor(ctx as LineContext, task);
    const from = tierRank(stationTier(scope, 'build'));
    const to = scope.escalation === 'none' ? from : Math.max(from, tierRank(scope.escalation.ceiling));
    for (let rank = from; rank <= to; rank++) {
      const tier = MODEL_TIERS[rank];
      if (tier === undefined) continue;
      const model = ctx.components.driver.resolveModel(tier);
      models.set(JSON.stringify([model.provider, model.family, model.model, model.version]), model);
    }
  }
  return [...models.values()];
}

function fileOf(record: DraftRecord, path: string): DraftFile | undefined {
  return record.files.find((f) => f.path === path);
}

function bytesOf(file: DraftFile): Uint8Array {
  return Buffer.from(file.base64, 'base64');
}

function jsonOf(file: DraftFile): unknown {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(file)));
    return parsed;
  } catch {
    return undefined;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The runtime problems a test draft can have only because of what the base
 * holds: a drafted path the base already has, and a suite check the base's
 * framework would not run as named (A-R19-11).
 */
const BASE_PROBLEMS: ReadonlySet<string> = new Set(['exists', 'unbound']);

/**
 * What the previous attempt's ending tells the next drafter, typed, and
 * nothing else (D-A-DS-02). At `test-design` every fact the base supplied
 * is one `base-refusal` with nothing in it, so a drafted check cannot read
 * the repository back through its exit code or a path's existence: two
 * retries carry at most two bits of it (A-R19-11).
 */
async function retryParts(ctx: LineContext, station: DraftStation, previous: DraftAttempt | null): Promise<RetryPart[]> {
  const back = previous?.sentBack ?? null;
  if (previous === null || back === null) return [];
  switch (back.by) {
    case 'runtime': {
      if (station !== 'test-design') return [{ kind: 'runtime-problems', problems: back.problems }];
      const own = back.problems.filter((p) => !BASE_PROBLEMS.has(p.code));
      return [
        ...(own.length > 0 ? [{ kind: 'runtime-problems' as const, problems: own }] : []),
        ...(own.length < back.problems.length ? [{ kind: 'base-refusal' as const }] : []),
      ];
    }
    case 'critic': {
      if (previous.critic === null || previous.critic === 'not-seated') return [];
      const critic = await readRecord<CriticRecord>(ctx, previous.critic);
      return [{ kind: 'critic-findings', findings: critic.findings }];
    }
    case 'base-run':
      return [{ kind: 'base-refusal' }];
    case 'principal':
      if (station === 'spec') return back.notes === null ? [] : [{ kind: 'notes', notes: back.notes }];
      return back.reason === null ? [] : [{ kind: 'rejection-reason', reason: back.reason }];
  }
}

/**
 * Runs the drafter for the station's current attempt and records what it
 * drafted. The spec drafter works over a fresh copy of the base; the test
 * drafter over a tree holding the locked spec and nothing else, so it is
 * black-box by what it can reach, not by its instructions (I3).
 */
async function draft(ctx: LineContext, station: DraftStation, current: DraftAttempt, previous: DraftAttempt | null): Promise<StationRefusal | undefined> {
  const drivers = draftingDrivers(ctx);
  const driver = seatDriver(drivers, station, 'drafter');
  const seat = seatTask(ctx.state, station, 'drafter', ctx.run.baseCommit);
  const capability = capabilityRefusal(STATION_CONTRACTS[station], driver.capabilities());
  if (capability !== undefined) return capability;
  if ((await ctx.components.vault.readLocks(ctx.run.id)) !== null) {
    const tampered = await tamperedPaths(ctx);
    if (tampered.length > 0) return recordTamper(ctx, station, null, tampered, { phase: 'before-draft' }, null);
  }
  // At L3 a test drafter of the builder's family is refused, as a same-family reviewer is (R9, R19).
  if (station === 'test-design') {
    const model = driver.resolveModel(tierFor(scopeFor(ctx, seat), station, attemptsOf(ctx.state, seat)));
    const seated = seatTestDrafter(model, builderModels(ctx), ctx.run.requestedLevel);
    if (!seated.ok) return seated;
  }

  let context: string;
  if (station === 'spec') {
    context = joinParts(grantedContext(STATION_CONTRACTS.spec, { intent: ctx.drafting.intent ?? undefined } as Partial<Record<ContextGrant, string>>));
  } else {
    const spec = await readText(ctx, specArtifacts(ctx));
    if (spec.tampered.length > 0) return recordTamper(ctx, station, null, spec.tampered, { phase: 'context' }, null);
    context = joinParts(grantedContext(STATION_CONTRACTS['test-design'], { 'locked-spec': spec.text }));
  }
  const suffix = retrySuffix(station, current.attempt, await retryParts(ctx, station, previous));

  const started = await startAttempt(ctx, seat);
  if (started !== undefined) return started;
  const { workspaces } = ctx.components;
  const { start, work } = draftPaths(workspaces, ctx.run.id, station, 'drafter', current.attempt);
  const base = basePath(workspaces, ctx.run.id);
  if (station === 'spec') await copyTree(base, start);
  else await copyOnly(base, start, specArtifacts(ctx).map((a) => a.path));
  await copyTree(start, work);
  // The run's drafts directory, so where a drafter writes its draft is in the tree it is handed.
  await mkdir(join(work, DRAFT_DIR, ctx.run.id), { recursive: true });

  const role = pinnedRole(ctx, DRAFT_ROLES[station].drafter);
  const ran = await runTask(ctx, seat, driver, role, context, work, { suffix });
  if (!ran.ok) return spendRetry(ctx, seat);
  const problems = taskResultProblems(ran.result);
  if (problems.length > 0) {
    throw new Error(`line: the drafter's result at ${station} does not match the TaskResult contract, so it was not recorded: ${problems.join('; ')}`);
  }
  const result = await ctx.components.vault.recordTaskResult(ctx.run.id, ran.result);
  await commit(ctx, { tasks: { [seat.id]: 'verifying' }, results: { [seat.id]: result } });

  const read = station === 'spec' ? await readSpecDraft(ctx, start, work) : await readTestDraft(ctx, start, work);
  // A drafted path the drafter's policy grant does not cover is a problem, as a build's write outside it is an escape (I4, A-R19-11).
  const entries = read.files.map((f) => ({ path: f.path, change: 'added' as const, sha256: f.sha256 }));
  for (const path of writesOutsideGrant(entries, scopeFor(ctx, seat).writableGlobs, STATION_CONTRACTS[station].writeBoundary.workspaceGlobs)) {
    read.problems.push({ path, code: 'outside-grant' });
  }
  const record: DraftRecord = {
    runId: ctx.run.id,
    station,
    attempt: current.attempt,
    sha256: draftDigest(read.files),
    files: read.files,
    discarded: read.discarded,
    problems: read.problems,
    // The model the runtime resolved for the call, never the driver's account of itself (I2).
    model: ran.model,
    role: { id: role.role, sha256: role.sha256 },
    collectedBy: 'runtime',
  };
  const ref = await ctx.components.vault.recordDraft(record);
  await updateAttempt(ctx, station, { draft: ref, sha256: record.sha256 });
  return undefined;
}

interface ReadDraft {
  readonly files: DraftFile[];
  readonly discarded: string[];
  readonly problems: Array<{ path: string; code: string }>;
}

async function fileAt(root: string, path: string): Promise<DraftFile | undefined> {
  try {
    const bytes = await readFile(join(root, ...path.split('/')));
    return { path, sha256: sha256(bytes), base64: Buffer.from(bytes).toString('base64') };
  } catch {
    return undefined;
  }
}

/** What the drafter wrote outside the paths it drafts, which its workspace takes with it. */
async function discardedOf(start: string, work: string, kept: (path: string) => boolean): Promise<string[]> {
  return (await ownDiff(start, work)).map((entry) => entry.path).filter((path) => !kept(path)).sort();
}

/** A spec draft's four files, each read and parsed from the bytes read; anything wrong is a problem, by path and code. */
async function readSpecDraft(ctx: LineContext, start: string, work: string): Promise<ReadDraft> {
  const paths = specDraftPaths(ctx.run.id);
  const all = [paths.spec, paths.security, paths.runRequirements, paths.questions];
  const files: DraftFile[] = [];
  const problems: Array<{ path: string; code: string }> = [];
  for (const path of all) {
    const file = await fileAt(work, path);
    if (file === undefined) problems.push({ path, code: 'missing' });
    else files.push(file);
  }
  const spec = files.find((f) => f.path === paths.spec);
  if (spec !== undefined) {
    let text = '';
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytesOf(spec));
    } catch {
      problems.push({ path: paths.spec, code: 'not-utf8' });
    }
    if (text.trim() === '' && !problems.some((p) => p.path === paths.spec)) problems.push({ path: paths.spec, code: 'empty' });
  }
  const parse = (path: string, parser: (value: unknown) => { ok: boolean; problems?: ReadonlyArray<{ path: string; code: string }> }): void => {
    const file = files.find((f) => f.path === path);
    if (file === undefined) return;
    const json = jsonOf(file);
    if (json === undefined) {
      problems.push({ path, code: 'not-json' });
      return;
    }
    const parsed = parser(json);
    if (!parsed.ok) for (const p of parsed.problems ?? []) problems.push({ path: `${path}#${p.path}`, code: p.code });
  };
  parse(paths.security, (v) => parseSecurityPart(v));
  parse(paths.runRequirements, (v) => parseRunRequirements(v, 'runRequirements'));
  parse(paths.questions, (v) => parseQuestions(v, 'questions'));
  return { files, discarded: await discardedOf(start, work, (p) => all.includes(p)), problems };
}

/** A path is under `dir` when it is `dir/…`. */
function under(dir: string, path: string): boolean {
  return path.startsWith(`${dir}/`);
}

/**
 * A test draft: every file under the spec's test directory and the
 * acceptance manifest, read from the bytes read, and every refusal R15 and
 * R17 make of a manifest at admission made of it here (R19): the drafted
 * manifest held alone to its own shape, to acceptance and behavioral checks,
 * to naming every drafted test, beside the verification manifest held to a
 * reproduction and distinct ids, to a check denying each authorization rule,
 * and to a framework that runs each acceptance check's tests exactly, over
 * the base with the draft in it. Problems are paths and codes, never base
 * output, which carries the repository.
 */
async function readTestDraft(ctx: LineContext, start: string, work: string): Promise<ReadDraft> {
  const requirements = ctx.requirements;
  if (requirements === null) throw new Error('line: drafted tests reached test-design with no run-requirements part locked; admission refuses that');
  const manifestPath = manifestDraftPath(ctx.run.id);
  const testDir = requirements.testDirectory;
  const specPaths = new Set(specArtifacts(ctx).map((a) => a.path));
  const drafted = (path: string): boolean => path === manifestPath || (under(testDir, path) && !specPaths.has(path));
  const changed = (await ownDiff(start, work)).filter((e) => e.sha256 !== null).map((e) => e.path);
  const files: DraftFile[] = [];
  for (const path of changed.filter(drafted).sort()) {
    const file = await fileAt(work, path);
    if (file !== undefined) files.push(file);
  }
  const problems: Array<{ path: string; code: string }> = [];
  const tests = files.filter((f) => f.path !== manifestPath).map((f) => f.path);
  if (tests.length === 0) problems.push({ path: testDir, code: 'missing' });
  const base = basePath(ctx.components.workspaces, ctx.run.id);
  for (const test of tests) if (await existsIn(base, test)) problems.push({ path: test, code: 'exists' });
  const manifest = files.find((f) => f.path === manifestPath);
  const checks = manifest === undefined ? undefined : draftedChecks(manifest, problems);
  if (manifest === undefined) problems.push({ path: manifestPath, code: 'missing' });
  if (checks !== undefined) {
    const named = new Set<string>();
    checks.forEach((check, i) => {
      const at = `${manifestPath}#checks[${String(i)}]`;
      if (check.kind !== 'acceptance' && check.kind !== 'behavioral') {
        problems.push({ path: at, code: 'not-draftable' });
        return;
      }
      const runs = check.kind === 'acceptance' ? [...check.tests] : check.command.filter((arg) => tests.includes(arg));
      for (const test of runs) {
        if (!tests.includes(test)) problems.push({ path: `${at}.tests`, code: 'unreferenced' });
        named.add(test);
      }
    });
    for (const test of tests) if (!named.has(test)) problems.push({ path: test, code: 'unreferenced' });
    for (const p of mergedCheckProblems(ctx.checks, checks)) problems.push({ path: `${manifestPath}#${p.path}`, code: p.code });
    const undenied = denialRefusal(ctx.securityPart, [...ctx.checks, ...checks]);
    if (undenied?.reason === 'denial-check-missing') for (const rule of undenied.rules) problems.push({ path: `${manifestPath}#deniesRule:${rule}`, code: 'denial-check-missing' });
    if (problems.length === 0) {
      // Each acceptance check's tests bound to the base's framework, over the base with the draft written in (D-R15-04).
      const tree = await draftTree(ctx, files);
      for (const p of await suiteBindingProblems(checks, tree, tests)) problems.push({ path: `${manifestPath}#${p.path}`, code: p.code });
    }
  }
  return { files, discarded: await discardedOf(start, work, (p) => drafted(p)), problems };
}

/** The drafted manifest's checks, held alone to a manifest's shape; null where it is not one, its problems added. */
function draftedChecks(manifest: DraftFile, problems: Array<{ path: string; code: string }>): CheckSpec[] | undefined {
  const json = jsonOf(manifest);
  if (json === undefined) {
    problems.push({ path: manifest.path, code: 'not-json' });
    return undefined;
  }
  const parsed = parseManifest(json, { alone: false });
  if (!parsed.ok) {
    for (const p of parsed.problems) problems.push({ path: `${manifest.path}#${p.path}`, code: p.code });
    return undefined;
  }
  return parsed.checks;
}

/** The base with a test draft's files written in: what its checks run over and what its tests are bound against (R19). */
async function draftTree(ctx: LineContext, files: readonly DraftFile[]): Promise<string> {
  const { workspaces } = ctx.components;
  const tree = draftBaseRunPath(workspaces, ctx.run.id, draftDigest(files));
  await copyTree(basePath(workspaces, ctx.run.id), tree);
  await writeFiles(tree, files.map((f) => ({ path: f.path, bytes: bytesOf(f) })));
  return tree;
}

/** The checks a test draft is judged with: the verification manifest's and its own. */
function checksWithDraft(ctx: LineContext, record: DraftRecord): CheckSpec[] {
  const manifest = fileOf(record, manifestDraftPath(ctx.run.id));
  const parsed = manifest === undefined ? undefined : parseManifest(jsonOf(manifest), { alone: false });
  if (parsed?.ok !== true) throw new Error(`line: test draft ${record.sha256} reached its base run without a manifest that parses`);
  return [...ctx.checks, ...parsed.checks];
}

/**
 * Runs the draft's checks, and the verification manifest's, over the base
 * with the draft in it, once per draft hash, and records the result under
 * that hash (R19, D-A-BF-01). A record already written for the hash is the
 * one used: a resume never runs them twice.
 */
async function baseRunDraft(ctx: LineContext, record: DraftRecord): Promise<StationRefusal | undefined> {
  let ref = await ctx.components.vault.readBaseRun(ctx.run.id, record.sha256);
  if (ref === null) {
    const tree = await draftTree(ctx, record.files);
    const ran = await runOnBase(ctx, { tree, checks: checksWithDraft(ctx, record), draft: record.sha256 });
    if (!('hash' in ran)) return ran;
    ref = ran;
  }
  await updateAttempt(ctx, 'test-design', { baseRun: ref });
  return undefined;
}

/**
 * The base record of a test draft, judged: each drafted check that did not do
 * what it declared, as the run's records and a person read it, and a
 * refusal of the run where a check the run was admitted with did not, which
 * no draft caused and no redraft cures.
 */
async function judgeBase(ctx: LineContext, ref: VaultRef, record: DraftRecord): Promise<{ parts: BaseRefusalPart[]; refusal?: StationRefusal }> {
  const base = await readRecord<BaseRunRecord>(ctx, ref);
  const checks = checksWithDraft(ctx, record);
  const admitted = new Set(ctx.checks.map((c) => c.id));
  const mismatched = baseMismatches(checks, base);
  const own = mismatched.filter((m) => admitted.has(m.checkId));
  if (own.length > 0) {
    const refusal = baseRefusal(ctx.checks, base, ref);
    if (refusal !== undefined) return { parts: [], refusal };
  }
  const parts = mismatched.filter((m) => !admitted.has(m.checkId)).map((m): BaseRefusalPart =>
    m.cause === 'contrary' && m.exitCode !== null
      ? { checkId: m.checkId, declared: m.declared, exitCode: m.exitCode }
      : { checkId: m.checkId, declared: m.declared, cause: m.cause === 'suite-count' ? 'suite-short' : 'did-not-start' });
  return { parts };
}

/** The draft's files as the critic reads them: each path, then its text. */
function renderDraft(record: DraftRecord): string {
  return record.files.map((f) => `--- ${f.path}\n${new TextDecoder().decode(bytesOf(f))}`).join('\n');
}

/**
 * A critic's result is its final message, `{"findings": [string, …]}`, with no
 * severity. Anything else is one finding: a result the runtime cannot read
 * is never a clean one (I5, D-A-DS-07). A single fenced block is unwrapped.
 */
export function readCriticResult(narrative: string): { readable: boolean; findings: string[] } {
  const unreadable = { readable: false, findings: ['the critic returned no result the runtime could read as a list of findings'] };
  const text = narrative.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadable;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unreadable;
  const keys = Object.keys(parsed);
  const { findings } = parsed as { findings?: unknown };
  if (keys.length !== 1 || !Array.isArray(findings) || !findings.every((f) => typeof f === 'string' && f.trim() !== '')) return unreadable;
  return { readable: true, findings: findings as string[] };
}

/**
 * Seats the critic over the recorded bytes, read-only, granted what the
 * drafter was, the draft, and the rubric (R19). Graded against the drafter
 * from the models the runtime resolved, and again from the model its result
 * names, keeping the weaker (I6). Where it would be the drafter's own model,
 * no critic is seated: the condition fails and the draft goes to a person.
 */
async function critique(ctx: LineContext, station: DraftStation, current: DraftAttempt, record: DraftRecord): Promise<StationRefusal | undefined> {
  const driver = seatDriver(draftingDrivers(ctx), station, 'critic');
  const seat = seatTask(ctx.state, station, 'critic', ctx.run.baseCommit);
  const contract = CRITIC_CONTRACTS[station];
  const capability = capabilityRefusal({ ...STATION_CONTRACTS[station], requires: contract.requires }, driver.capabilities());
  if (capability !== undefined) return capability;
  const planned = driver.resolveModel(tierFor(scopeFor(ctx, seat), station, attemptsOf(ctx.state, seat)));
  if (gradeOf(record.model, planned) === 'same-model') {
    await updateAttempt(ctx, station, { critic: 'not-seated' });
    return undefined;
  }
  const rubric = ctx.drafting.rubrics[station];
  if (rubric === undefined) throw new Error(`line: no rubric was admitted for the ${station} critic; admission refuses that`);

  const offered: Partial<Record<ContextGrant, string>> = { draft: renderDraft(record), rubric: rubric.text };
  if (station === 'spec') {
    if (ctx.drafting.intent !== null) offered.intent = ctx.drafting.intent;
  } else {
    const spec = await readText(ctx, specArtifacts(ctx));
    if (spec.tampered.length > 0) return recordTamper(ctx, station, null, spec.tampered, { phase: 'context' }, null);
    offered['locked-spec'] = spec.text;
  }
  const context = joinParts(grantedCriticContext(contract, offered));

  const started = await startAttempt(ctx, seat);
  if (started !== undefined) return started;
  const { workspaces } = ctx.components;
  const { work } = draftPaths(workspaces, ctx.run.id, station, 'critic', current.attempt);
  const base = basePath(workspaces, ctx.run.id);
  if (station === 'spec') await copyTree(base, work);
  else await copyOnly(base, work, specArtifacts(ctx).map((a) => a.path));
  await writeFiles(work, record.files.map((f) => ({ path: f.path, bytes: bytesOf(f) })));

  const role = pinnedRole(ctx, DRAFT_ROLES[station].critic);
  // Which attempt's draft it reads, and nothing else of the drafter's history.
  const ran = await runTask(ctx, seat, driver, role, context, work, { mode: 'ro', suffix: retrySuffix(station, current.attempt, []) });
  if (!ran.ok) return spendRetry(ctx, seat);
  const problems = taskResultProblems(ran.result);
  if (problems.length > 0) {
    throw new Error(`line: the critic's result at ${station} does not match the TaskResult contract, so it was not recorded: ${problems.join('; ')}`);
  }
  const result = await ctx.components.vault.recordTaskResult(ctx.run.id, ran.result);
  await commit(ctx, { tasks: { [seat.id]: 'passed' }, results: { [seat.id]: result } });
  const read = readCriticResult(ran.result.claim.narrative);
  // The weaker of the planned seat and the one the result names: what the critic reports never widens it (I2, I6).
  const grade = weakerGrade(gradeOf(record.model, planned), gradeOf(record.model, ran.result.model));
  const critic: CriticRecord = {
    runId: ctx.run.id,
    station,
    attempt: current.attempt,
    draft: record.sha256,
    drafter: record.model,
    critic: ran.model,
    grade,
    binding: grade === 'different-family',
    readable: read.readable,
    findings: read.findings,
    rubric: rubric.sha256,
    role: { id: role.role, sha256: role.sha256 },
    collectedBy: 'runtime',
  };
  const ref = await ctx.components.vault.recordCriticResult(critic);
  await updateAttempt(ctx, station, { critic: ref });
  return undefined;
}

function draftingDrivers(ctx: LineContext): DraftingDrivers {
  const drivers = ctx.components.drafting ?? null;
  if (drivers === null) throw new Error('line: the run drafts and its component graph names no drafting drivers; admission refuses that');
  return drivers;
}

/**
 * The artifacts a locked draft makes of the line's: a spec's file and its
 * three parts, or the tests and their manifest (R19). Pure, from the lock's
 * paths, so a drive and a resume derive the same set.
 */
export function lockedArtifacts(artifacts: LineArtifacts, runId: string, station: DraftStation, files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>): LineArtifacts {
  const at = (path: string): { path: string; sha256: string } | null => files.find((f) => f.path === path) ?? null;
  if (station === 'spec') {
    const paths = specDraftPaths(runId);
    const spec = at(paths.spec);
    return {
      ...artifacts,
      spec: spec === null ? [] : [spec],
      specParts: { security: at(paths.security), runRequirements: at(paths.runRequirements), questions: at(paths.questions) },
    };
  }
  const manifest = manifestDraftPath(runId);
  return { ...artifacts, acceptanceTests: files.filter((f) => f.path !== manifest), acceptanceManifest: at(manifest) };
}

/**
 * The approved draft written into the artifact root and the base, and
 * locked against its hash (R19). The lock record comes first, with the base
 * digest the draft makes, and is committed before anything is written; then
 * the files, then the Vault's lock of each path not already locked. Every
 * step can be taken again by a resume, and the lock is held to the approved
 * hash: bytes changed in the artifact root after the draft was read are a
 * tamper, never what is locked (I3).
 */
export async function lockApproved(ctx: LineContext, station: DraftStation, approval: DraftLockRecord['approval']): Promise<StationRefusal | undefined> {
  const { vault, workspaces } = ctx.components;
  const drafts = draftsOf(ctx.state, station);
  const current = drafts.attempts.at(-1);
  if (current?.draft == null || current.sha256 === null) throw new Error(`line: ${station} approved no draft`);
  const record = await readRecord<DraftRecord>(ctx, current.draft);
  if (record.problems.length > 0 || record.files.length === 0) throw new Error(`line: ${station}'s draft ${record.sha256} carries problems and cannot be locked; approval refuses it`);
  const base = basePath(workspaces, ctx.run.id);
  let lock: DraftLockRecord;
  if (drafts.locked === null) {
    // The digest the base will have, computed on a copy, so the base itself is changed only once the lock is recorded.
    const scratch = scratchPath(workspaces, ctx.run.id, `lock.${station}`);
    await copyTree(base, scratch);
    await writeFiles(scratch, record.files.map((f) => ({ path: f.path, bytes: bytesOf(f) })));
    const digest = await treeDigest(scratch);
    await rm(scratch, { recursive: true, force: true });
    lock = {
      runId: ctx.run.id,
      station,
      draft: { sha256: record.sha256, attempt: record.attempt },
      files: record.files.map(({ path, sha256: hash }) => ({ path, sha256: hash })),
      approval,
      baseTreeSha256: digest,
      collectedBy: 'runtime',
    };
    const ref = await vault.recordDraftLock(lock);
    await commit(ctx, { drafts: { [station]: { ...draftsOf(ctx.state, station), locked: ref } } });
  } else {
    lock = await readRecord<DraftLockRecord>(ctx, drafts.locked);
  }

  const held = new Set((await vault.readLocks(ctx.run.id))?.entries.map((e) => e.path) ?? []);
  const unlocked = record.files.filter((f) => !held.has(f.path));
  // A path in the artifact root that holds other bytes than the draft is not overwritten: what is there is not ours to replace.
  const clobbered: Array<{ path: string; expected: string; actual: string }> = [];
  for (const file of unlocked) {
    const there = await fileAt(ctx.run.repo, file.path);
    if (there !== undefined && there.sha256 !== file.sha256) clobbered.push({ path: file.path, expected: file.sha256, actual: there.sha256 });
  }
  if (clobbered.length > 0) return recordTamper(ctx, station, null, clobbered, { phase: 'draft-lock' }, null);
  await writeFiles(ctx.run.repo, unlocked.map((f) => ({ path: f.path, bytes: bytesOf(f) })));
  await writeFiles(base, record.files.map((f) => ({ path: f.path, bytes: bytesOf(f) })));
  if (unlocked.length > 0) await vault.lock(ctx.run.id, unlocked.map((f) => f.path), station);
  const manifest = await vault.readLocks(ctx.run.id);
  const tampered = record.files.flatMap((file) => {
    const entry = manifest?.entries.find((e) => e.path === file.path);
    return entry?.sha256 === file.sha256 ? [] : [{ path: file.path, expected: file.sha256, actual: entry?.sha256 ?? 'missing' }];
  });
  if (tampered.length > 0) return recordTamper(ctx, station, null, tampered, { phase: 'draft-lock' }, null);
  const digest = await treeDigest(base);
  if (digest !== lock.baseTreeSha256) throw new Error(`line: the base is ${digest} after ${station}'s draft was written, not the ${lock.baseTreeSha256} its lock recorded`);

  applyLock(ctx, station, record);
  ctx.baseTreeSha256 = lock.baseTreeSha256;
  return undefined;
}

/** The line's artifacts, checks, and spec parts once `record` is locked at `station`, parsed from the bytes it holds. */
function applyLock(ctx: LineContext, station: DraftStation, record: DraftRecord): void {
  ctx.artifacts = lockedArtifacts(ctx.artifacts, ctx.run.id, station, record.files);
  if (station === 'spec') {
    const paths = specDraftPaths(ctx.run.id);
    const security = fileOf(record, paths.security);
    const requirements = fileOf(record, paths.runRequirements);
    const part = security === undefined ? undefined : parseSecurityPart(jsonOf(security));
    const req = requirements === undefined ? undefined : parseRunRequirements(jsonOf(requirements), 'runRequirements');
    ctx.securityPart = part?.ok === true ? part.part : null;
    ctx.requirements = req?.ok === true ? req.part : null;
    return;
  }
  ctx.checks = checksWithDraft(ctx, record);
}

/** The text of each spec part locked or admitted, parsed: what a drive started from the records holds. */
export function parsedParts(texts: { security: unknown; runRequirements: unknown }): { securityPart: SecurityPart | null; requirements: RunRequirements | null } {
  const part = texts.security === undefined ? undefined : parseSecurityPart(texts.security);
  const req = texts.runRequirements === undefined ? undefined : parseRunRequirements(texts.runRequirements, 'runRequirements');
  return { securityPart: part?.ok === true ? part.part : null, requirements: req?.ok === true ? req.part : null };
}

/**
 * Writes each committed draft lock's files into the base again, so a base a
 * stop left half-written is whole before a resume checks its digest (R19).
 * Only the base: the artifact root is `settleArtifactRoot`'s.
 */
export async function settleBase(vault: Vault, base: string, state: RunState): Promise<string | null> {
  let digest: string | null = null;
  for (const station of ['spec', 'test-design'] as const) {
    const lockRef = state.drafts[station]?.locked ?? null;
    if (lockRef === null) continue;
    const lock = JSON.parse(new TextDecoder().decode(await vault.read(lockRef))) as DraftLockRecord;
    const attempt = state.drafts[station]?.attempts.find((a) => a.attempt === lock.draft.attempt);
    if (attempt?.draft == null) throw new Error(`run ${state.runId}: the ${station} lock names an attempt run state does not hold`);
    const record = JSON.parse(new TextDecoder().decode(await vault.read(attempt.draft))) as DraftRecord;
    await writeFiles(base, record.files.map((f) => ({ path: f.path, bytes: bytesOf(f) })));
    digest = lock.baseTreeSha256;
  }
  return digest;
}

/**
 * Writes the files of each committed draft lock that a stop left unwritten
 * into the artifact root, so a resume does not read the runtime's own
 * unfinished step as a tamper (A-R19-11). Only a path the Vault has not
 * locked and the artifact root does not hold: bytes already there are never
 * replaced, and a locked path that is missing stays a tamper, since a
 * rewrite of either would launder one.
 */
export async function settleArtifactRoot(vault: Vault, repo: string, state: RunState): Promise<void> {
  const held = new Set((await vault.readLocks(state.runId))?.entries.map((e) => e.path) ?? []);
  for (const station of ['spec', 'test-design'] as const) {
    const lockRef = state.drafts[station]?.locked ?? null;
    if (lockRef === null) continue;
    const lock = JSON.parse(new TextDecoder().decode(await vault.read(lockRef))) as DraftLockRecord;
    const attempt = state.drafts[station]?.attempts.find((a) => a.attempt === lock.draft.attempt);
    if (attempt?.draft == null) throw new Error(`run ${state.runId}: the ${station} lock names an attempt run state does not hold`);
    const record = JSON.parse(new TextDecoder().decode(await vault.read(attempt.draft))) as DraftRecord;
    const absent: DraftFile[] = [];
    for (const file of record.files) if (!held.has(file.path) && (await fileAt(repo, file.path)) === undefined) absent.push(file);
    await writeFiles(repo, absent.map((f) => ({ path: f.path, bytes: bytesOf(f) })));
  }
}
