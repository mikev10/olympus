/**
 * The nightly jobs that seat a reviewer (R13b, A-R13b-01). Each seats the
 * service's reviewer driver, read-only, under `deny-all` with the model relay
 * alone, over one tree and nothing else, and records the seat, its grade,
 * what it cost, and what it found in the job's nightly record.
 *
 * - `nightly-findings-review` gives the seat one UTC day of the runtime's
 *   records as typed fields, never their text (D-R13b-04, I7).
 * - `nightly-tree-review` seats R9's security reviewer role over the head of
 *   the default branch, the tree its only mount (D-R13b-05).
 *
 * Each seat's family is checked against every author through `seatReviewer`
 * (I6). A finding becomes an `intake` candidate only where the runtime could
 * locate it: a file the tree holds and a line it has, or a record of the day
 * reviewed. Anything else is refused and recorded as refused (I5). The
 * reviewer's final message is kept as its claim, and no prompt is ever given
 * it (I7). Neither job writes under any run, changes a grant, or decides
 * anything (I2, D-A-LC-10, D-A-EX-01).
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { compileRoles } from '@olympus-ai/compiler';
import {
  DRAFT_ROLES, RECORD_CATEGORIES, REVIEWER_ROLE, SECURITY_REVIEWER_ROLE, STATION_CONTRACTS, StrictPolicyEngine, TREE_CATEGORIES,
  capabilityRefusal, checkFields, securitySeatContract, seatReviewer, stationTier, weakerGrade,
  type AutonomyLevel, type CandidateId, type CompiledRole, type Driver, type FieldDefect, type IndependenceGrade, type JobSchema, type ModelIdentity, type Policy,
  type ReviewJobTemplateId, type RoleId, type RunId, type SeatIdentity, type StationContract, type TaskId, type TaskResult, type TriggerSchedule,
} from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import { materialize, resolveCommit } from '@olympus-ai/readiness';
import type { SandboxHandle, SandboxProvider, SandboxSpec, Teardown } from '@olympus-ai/sandbox';
import {
  type DayItem, type EnforcementDecision, type NightlyRefusal, type NightlyReview, type NightlySeat, type ReviewFinding,
  type ReviewSubject, type UsageRecord, type Vault,
} from '@olympus-ai/vault';
import type { Intake } from './intake.js';
import { boundTo, readIntegration } from './line.js';
import { taskResultProblems } from './verification.js';

/** The role the findings reviewer runs under (D-R13b-07). Policy scopes it at `review`. */
export const FINDINGS_REVIEWER_ROLE = 'findings-reviewer' as RoleId;

/** The roles that judge rather than author: a call under one is never an author (D-R13b-05). */
export const JUDGING_ROLES: ReadonlySet<RoleId> = new Set<RoleId>([
  REVIEWER_ROLE, SECURITY_REVIEWER_ROLE, DRAFT_ROLES.spec.critic, DRAFT_ROLES['test-design'].critic, FINDINGS_REVIEWER_ROLE,
]);

/** What seats a nightly reviewer: the service's reviewer driver, the roles directory, and the image the driver runs in. */
export interface NightlySeatOptions {
  readonly driver: Driver;
  /** The roles directory runs are admitted with; compiled again at each firing, and its role's hash recorded. */
  readonly roles: string;
  /** The image the driver's sandbox runs, or `none` for a sandbox that runs no image. */
  readonly image: string;
}

/** What a reviewer job is handed: the job's slice of `NightlyOptions`. */
export interface ReviewJobOptions {
  readonly vault: Vault;
  readonly sandbox: SandboxProvider;
  readonly root: string;
  readonly user: SandboxSpec['user'];
  readonly limits: Readonly<Omit<SandboxSpec['limits'], 'wallClockMs'>> | null;
  readonly target: { readonly checkout: string; readonly branch: string } | null;
  readonly seat: NightlySeatOptions | null;
  readonly now: () => number;
}

/** A reviewer job's part of the record. */
export interface ReviewPart {
  readonly refusals: NightlyRefusal[];
  readonly review: NightlyReview;
}

const engine = new StrictPolicyEngine();
const DAY_MS = 24 * 3_600_000;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** The UTC date before the firing's: a day that is over (D-R13b-04). */
export function reviewedDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** The level a seat is checked at: the most the policy lets scheduled work reach, absent read as L0 (D-R13b-03). */
export function seatLevel(policy: Policy): AutonomyLevel {
  return policy.triggers.maxAutonomy.scheduled ?? 0;
}

const empty = (subject: ReviewSubject | null): NightlyReview => ({ subject, role: null, seat: null, usage: null, egress: null, claim: null, findings: [] });

// ---------------------------------------------------------------------------
// The day's records, as typed fields
// ---------------------------------------------------------------------------

/**
 * One decision's typed fields. Every cause is listed, so a cause added later
 * fails to compile here rather than reaching the seat unprojected. No
 * message, detail, host, path, or check id is taken: a check id may be one a
 * drafter wrote (R19), and a host is the agent's choice (I7).
 */
function decisionFields(d: EnforcementDecision, violation: IntegrityViolation | null): Record<string, string | number | null> {
  const base = { cause: d.decision.cause, decidedBy: d.decision.decidedBy, taskId: d.taskId, station: d.station };
  const decision = d.decision;
  switch (decision.cause) {
    case 'record-drift': return { ...base, problem: decision.problem };
    case 'admission-refused': return { ...base, reason: decision.refusal.reason };
    case 'resume-refused': return { ...base, reason: decision.refusal.reason };
    case 'station-refused': {
      const refusal = decision.refusal;
      if (refusal.reason === 'gate-failed') {
        return { ...base, reason: refusal.reason, failedChecks: refusal.failed.length, failedCauses: [...new Set(refusal.failed.map((f) => f.cause))].sort().join(',') };
      }
      return { ...base, reason: refusal.reason };
    }
    case 'approval-granted': return { ...base, key: decision.key };
    case 'approval-refused': return { ...base, reason: decision.reason };
    case 'approval-rejected': return { ...base, reason: decision.reason, notes: decision.notes ? 'yes' : 'no' };
    case 'draft-sent-back': return { ...base, sentBackBy: decision.sentBack.by };
    case 'draft-floor-applied': return { ...base, level: decision.level, failedConditions: [...decision.failed].sort().join(',') };
    case 'egress-connection': return { ...base, verdict: decision.connection.verdict };
    case 'violation-recorded': return { ...base, violation: violation?.kind ?? null, role: violation?.role ?? null };
    case 'relay-refused': return { ...base, refused: decision.refused, exhausted: decision.exhausted };
    case 'tier-escalated': return { ...base, from: decision.from, to: decision.to, failedGates: decision.failedGates };
    case 'task-conflict': return { ...base, with: decision.with.length, paths: decision.paths.length };
  }
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** Every record the runtime made on `day`, each with its id and typed fields alone. */
export async function dayItems(vault: Vault, day: string): Promise<DayItem[]> {
  const items: DayItem[] = [];
  for (const runId of await vault.listRuns()) {
    for (const ref of await vault.readDecisions(runId)) {
      const d = JSON.parse(decode(await vault.read(ref))) as EnforcementDecision;
      if (d.decidedAt.slice(0, 10) !== day) continue;
      // A violation the store cannot read throws, and the job refuses as store-unreadable: never a day reviewed without it (I5).
      const violation = d.decision.cause === 'violation-recorded' ? JSON.parse(decode(await vault.read(d.decision.violation))) as IntegrityViolation : null;
      items.push({ id: `decision:${ref.hash}`, kind: 'decision', runId: d.runId, fields: decisionFields(d, violation) });
    }
  }
  for (const entry of await vault.readTriggerDecisions()) {
    const { decision } = entry;
    if (decision.decidedAt.slice(0, 10) !== day) continue;
    const outcome = decision.outcome;
    const fields: Record<string, string | number | null> = { source: decision.source, outcome: outcome.kind };
    if (outcome.kind === 'refused') {
      fields.cause = outcome.cause;
      if (outcome.cause === 'schema') fields.defects = outcome.defects.length;
    }
    items.push({ id: `trigger:${entry.sha256}`, kind: 'trigger-decision', runId: entry.admittedAs, fields });
  }
  for (const count of await vault.readRefusedDeliveryCounts()) {
    if (!count.hour.startsWith(day)) continue;
    items.push({ id: `deliveries:${count.hour}:${count.bucket}`, kind: 'refused-deliveries', runId: null, fields: { bucket: count.bucket, hour: count.hour, ...count.counts } });
  }
  for (const entry of await vault.readNightly()) {
    if (entry.record.date !== day) continue;
    entry.record.findings.forEach((f, index) => {
      const id = `nightly:${entry.sha256}:${String(index)}`;
      const fields: Record<string, string | number | null> = { template: entry.record.template, finding: f.kind };
      let runId: RunId | null = null;
      switch (f.kind) {
        case 'record-drift': fields.problem = f.problem; runId = f.runId; break;
        case 'rate-drift': fields.rate = f.rate; break;
        case 'security': fields.scanner = f.scanner; fields.rule = f.rule; fields.candidate = 'id' in f.candidate ? 'recorded' : f.candidate.none; break;
        case 'security-unrecordable': fields.scanner = f.scanner; fields.defects = f.defects.length; break;
      }
      items.push({ id, kind: 'nightly-finding', runId, fields });
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

/**
 * Every identity that called a model for `runs` under a role that authors,
 * each once (D-R13b-05). The calls are every usage record the store holds for
 * each run, whatever its state references, so a call stored before a crash
 * took its commit is still an author (D-P13-20). A record that is not one the
 * runtime wrote for the run stops the read rather than being skipped (I5),
 * and one written before R9 names no driver, which `seatReviewer` refuses
 * rather than reading as different (A-R9-01).
 */
export async function authorsOf(vault: Vault, runs: Iterable<RunId>): Promise<SeatIdentity[]> {
  const distinct = new Map<string, SeatIdentity>();
  for (const runId of new Set(runs)) {
    for (const ref of await vault.readUsage(runId)) {
      const call = JSON.parse(decode(await vault.read(ref))) as Partial<UsageRecord> | null;
      if (call?.collectedBy !== 'runtime' || call.runId !== runId || call.role === undefined || call.model === undefined) {
        throw new Error(`a usage record of run ${runId} is not one the runtime collected for it`);
      }
      if (JUDGING_ROLES.has(call.role.id)) continue;
      const driver = typeof call.driver === 'string' ? call.driver : null;
      const seat: SeatIdentity = { role: { id: call.role.id, sha256: call.role.sha256 }, driver, model: call.model };
      distinct.set(JSON.stringify([call.role.id, call.role.sha256, driver, call.model.provider, call.model.family, call.model.model, call.model.version]), seat);
    }
  }
  return [...distinct.values()];
}

// ---------------------------------------------------------------------------
// The reviewer's result
// ---------------------------------------------------------------------------

/**
 * A reviewer's final message, read strictly, as a critic's is
 * (`readCriticResult`, D-R13b-06): one JSON object whose one key is
 * `findings`, a list. A single fenced block is unwrapped. Anything else is
 * unreadable, which is a refusal and never "no findings" (I5).
 */
export function readReviewResult(narrative: string): { readable: true; findings: readonly unknown[] } | { readable: false } {
  const text = narrative.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/u, '$1').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { readable: false };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { readable: false };
  const keys = Object.keys(parsed);
  const { findings } = parsed as { findings?: unknown };
  if (keys.length !== 1 || !Array.isArray(findings)) return { readable: false };
  return { readable: true, findings };
}

/** One element's fields, without its note, which stays in the claim alone. A shape that is not an object is all defects. */
function elementFields(element: unknown, keys: readonly string[]): { fields: Record<string, unknown> } | { defects: FieldDefect[] } {
  if (typeof element !== 'object' || element === null || Array.isArray(element)) return { defects: keys.map((field) => ({ field, problem: 'missing' })) };
  const { note, ...fields } = element as Record<string, unknown>;
  if (note !== undefined && typeof note !== 'string') return { defects: [{ field: 'note', problem: 'not-a-string' }] };
  // A line is a number in the result and a decimal string in the schema; any other type is left for the schema to refuse.
  if (typeof fields.line === 'number' && Number.isSafeInteger(fields.line)) fields.line = String(fields.line);
  return { fields };
}

/** The number of lines a file holds, as an editor would number them. */
function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

// ---------------------------------------------------------------------------
// The seat
// ---------------------------------------------------------------------------

interface SeatRequest {
  readonly policy: Policy;
  readonly schedule: TriggerSchedule;
  readonly role: RoleId;
  readonly contract: StationContract;
  readonly kind: 'review' | 'security';
  readonly authors: readonly SeatIdentity[];
  /** The one tree the seat reads, mounted read-only. */
  readonly tree: string;
  readonly context: string;
}

type SeatOutcome =
  | { readonly ok: true; readonly review: Omit<NightlyReview, 'subject' | 'findings'>; readonly result: TaskResult }
  | { readonly ok: false; readonly refusal: NightlyRefusal; readonly review: Omit<NightlyReview, 'subject' | 'findings'> };

const UNSEATED: Omit<NightlyReview, 'subject' | 'findings'> = { role: null, seat: null, usage: null, egress: null, claim: null };

/** The seat graded against every author; `no-author` where there is none, since `seatReviewer` seats only a review of someone (I6). */
function grade(task: TaskId, kind: 'review' | 'security', authors: readonly SeatIdentity[], reviewer: SeatIdentity, level: AutonomyLevel): { ok: true; seat: NightlySeat } | { ok: false; detail: string } {
  if (authors.length === 0) return { ok: true, seat: { reviewer, authors: [], independence: 'no-author', level } };
  let seated;
  try {
    seated = seatReviewer(task, kind, authors, reviewer, level);
  } catch (error) {
    return { ok: false, detail: describe(error) };
  }
  if (!seated.ok) return { ok: false, detail: seated.message };
  return { ok: true, seat: { reviewer, authors: seated.seat.authors, independence: seated.seat.independence, level } };
}

/**
 * Seats the reviewer once. The role is compiled from the service's roles
 * directory and scoped by policy at `review` (I4); the seat is graded before
 * the call from the model the runtime resolved, and after it from the model
 * the result names, keeping the weaker (I6). The sandbox mounts `tree`
 * read-only and nothing else, under `deny-all`; the relay is the one route
 * out, metered at the scope's budget. What the call cost and what the proxy
 * saw are read at teardown whatever the call did.
 */
async function seatOnce(options: ReviewJobOptions, request: SeatRequest): Promise<SeatOutcome> {
  const seatOptions = options.seat;
  if (seatOptions === null) {
    return { ok: false, refusal: { part: 'seat', cause: 'no-reviewer', detail: 'this service names no reviewer driver and roles directory, so no seat can be filled' }, review: UNSEATED };
  }
  const { driver } = seatOptions;
  const compiled = await compileRoles(seatOptions.roles).catch((error: unknown) => ({ ok: false as const, error }));
  const role: CompiledRole | undefined = compiled.ok ? compiled.roles.find((r) => r.role === request.role) : undefined;
  if (role === undefined) {
    return { ok: false, refusal: { part: 'seat', cause: 'role-unavailable', detail: `the role ${request.role} did not compile from the roles directory` }, review: UNSEATED };
  }
  const roleVersion = { id: role.role, sha256: role.sha256 };
  const resolved = engine.resolveCapabilities(request.role, 'review', request.policy);
  if (!resolved.ok) {
    return { ok: false, refusal: { part: 'policy', cause: 'role-unavailable', detail: `policy grants ${request.role} no scope at review: ${resolved.detail}` }, review: { ...UNSEATED, role: roleVersion } };
  }
  const { scope } = resolved;
  const capability = capabilityRefusal(request.contract, driver.capabilities());
  if (capability !== undefined) {
    return { ok: false, refusal: { part: 'seat', cause: 'seat-refused', detail: `the reviewer driver lacks what the seat requires (${capability.reason})` }, review: { ...UNSEATED, role: roleVersion } };
  }
  const level = seatLevel(request.policy);
  const relay = driver.relayRequest();
  // An unmetered call spends what nothing bounds; the line runs none above L1, and neither does a night (I4).
  if (relay === null && level > 1) {
    return { ok: false, refusal: { part: 'seat', cause: 'seat-refused', detail: 'the reviewer driver calls no model through a relay, so its call would be unmetered above L1' }, review: { ...UNSEATED, role: roleVersion } };
  }
  const task = `nightly.${request.schedule.id}` as TaskId;
  const tier = stationTier(scope, 'review');
  let model: ModelIdentity;
  try {
    model = driver.resolveModel(tier);
  } catch (error) {
    return { ok: false, refusal: { part: 'seat', cause: 'seat-failed', detail: `the reviewer driver resolved no model: ${describe(error)}` }, review: { ...UNSEATED, role: roleVersion } };
  }
  const identity = (m: ModelIdentity): SeatIdentity => ({ role: roleVersion, driver: driver.provenanceId(), model: m });
  const planned = grade(task, request.kind, request.authors, identity(model), level);
  if (!planned.ok) return { ok: false, refusal: { part: 'seat', cause: 'seat-refused', detail: planned.detail }, review: { ...UNSEATED, role: roleVersion } };

  const wallClockMs = scope.budget.maxWallClockMs;
  const spec: SandboxSpec = {
    image: seatOptions.image,
    // The tree is the one mount, read-only: the seat writes nothing, and the Vault is mounted nowhere (I1, I4).
    mounts: { workspace: { source: request.tree, target: '/workspace', mode: 'ro' }, others: [] },
    // Whatever egress policy grants the role elsewhere, a nightly seat reaches the relay alone.
    egress: { mode: 'deny-all', allow: [] },
    limits: options.limits === null ? { cpus: 0, memoryMb: 0, pids: 0, wallClockMs } : { ...options.limits, wallClockMs },
    user: { ...options.user },
  };
  let handle: SandboxHandle;
  try {
    handle = await options.sandbox.provision(relay === null ? spec : {
      ...spec,
      relay: { ...relay, meter: boundTo(relay.meter, model.model), budget: { maxTokens: scope.budget.maxTokens, maxCostUsd: scope.budget.maxCostUsd } },
    });
  } catch (error) {
    return { ok: false, refusal: { part: 'seat', cause: 'seat-failed', detail: `the seat's sandbox could not be provisioned: ${describe(error)}` }, review: { ...UNSEATED, role: roleVersion, seat: planned.seat } };
  }
  let called: { ok: true; result: TaskResult } | { ok: false; error: unknown };
  try {
    const result = await driver.runTask({
      taskId: task, role, stablePrefix: request.context, variableSuffix: task, tier, tools: [...scope.tools], sandbox: handle,
      timeoutMs: wallClockMs, budget: { ...scope.budget },
    });
    called = { ok: true, result };
  } catch (error) {
    called = { ok: false, error };
  }
  let teardown: Teardown;
  try {
    teardown = await options.sandbox.destroy(handle);
  } catch (error) {
    return {
      ok: false,
      refusal: { part: 'seat', cause: 'seat-failed', detail: `the seat's sandbox could not be destroyed and read, so what the call cost is unknown: ${describe(error)}` },
      review: { ...UNSEATED, role: roleVersion, seat: planned.seat },
    };
  }
  const read = { role: roleVersion, usage: teardown.meter, egress: teardown.egress };
  if (!called.ok) {
    return { ok: false, refusal: { part: 'seat', cause: 'seat-failed', detail: `the reviewer's call did not return: ${describe(called.error)}` }, review: { ...UNSEATED, ...read, seat: planned.seat } };
  }
  const { result } = called;
  const problems = taskResultProblems(result);
  if (result.taskId !== task || problems.length > 0) {
    return { ok: false, refusal: { part: 'seat', cause: 'result-unreadable', detail: `the reviewer's result does not match the TaskResult contract: ${problems.join('; ') || 'another task'}` }, review: { ...UNSEATED, ...read, seat: planned.seat } };
  }
  const claim = { narrative: result.claim.narrative, filesChanged: [...result.claim.filesChanged] };
  // The model the result names is graded too; it can lower the grade and never raise it, and never becomes the recorded identity (I2, I6).
  const reported = grade(task, request.kind, request.authors, identity(result.model), level);
  if (!reported.ok) return { ok: false, refusal: { part: 'seat', cause: 'seat-refused', detail: reported.detail }, review: { ...UNSEATED, ...read, seat: planned.seat, claim } };
  const independence: IndependenceGrade | 'no-author' = planned.seat.independence === 'no-author' || reported.seat.independence === 'no-author'
    ? planned.seat.independence
    : weakerGrade(planned.seat.independence, reported.seat.independence);
  return { ok: true, review: { ...read, seat: { ...planned.seat, independence }, claim }, result };
}

/** A located finding's candidate, or why it has none; the key is the runtime's hash of its fields. */
async function candidateFor(
  intake: Intake, policy: Policy, schedule: TriggerSchedule, date: string, schema: JobSchema, fields: Readonly<Record<string, string>>,
): Promise<{ readonly id: CandidateId } | { readonly none: 'budget' | 'schema' | 'recorded-before' }> {
  const key = `${date}:${schema}:${sha256(JSON.stringify(Object.entries(fields).sort()))}`;
  return intake.recordFinding(policy, schedule, key, fields, schema);
}

// ---------------------------------------------------------------------------
// The two jobs
// ---------------------------------------------------------------------------

const RESULT_NOTE = 'A finding may carry "note", a string saying what is wrong; it is kept as your claim and read by a person, never by the runtime.';

/** `nightly-findings-review` (R13b): the day before the firing, as typed fields, before a seat graded against the day's authors. */
export async function findingsReview(options: ReviewJobOptions, policy: Policy, schedule: TriggerSchedule, date: string, intake: Intake): Promise<ReviewPart> {
  const day = reviewedDay(date);
  let items: DayItem[];
  try {
    items = await dayItems(options.vault, day);
  } catch (error) {
    return { refusals: [{ part: 'subject', cause: 'store-unreadable', detail: `the records of ${day} could not be read: ${describe(error)}` }], review: empty(null) };
  }
  const subject: ReviewSubject = { kind: 'day', day, items, postMerge: 'not-recorded' };
  // A day with no record has nothing to review; it is recorded as reviewed by no seat, never as a seat that found nothing.
  if (items.length === 0) return { refusals: [], review: empty(subject) };
  let authors: SeatIdentity[];
  try {
    authors = await authorsOf(options.vault, items.flatMap((i) => (i.runId === null ? [] : [i.runId])));
  } catch (error) {
    return { refusals: [{ part: 'subject', cause: 'store-unreadable', detail: `the day's authors could not be read: ${describe(error)}` }], review: empty(subject) };
  }
  const dir = join(options.root, 'nightly', `${schedule.id}-${date}-${randomUUID()}`);
  const tree = join(dir, 'empty');
  await mkdir(tree, { recursive: true });
  const context = [
    `[day]\nThe runtime's records of ${day}, UTC. Each is an id the runtime gave it and its typed fields; nothing a record says in words is here.`,
    JSON.stringify(items),
    `[result]\nYour final message is one JSON object and nothing else: {"findings": [{"category": "<one of ${RECORD_CATEGORIES.join(', ')}>", "record": "<the id of one record above>"}]}. ${RESULT_NOTE} An empty list says you found nothing.`,
  ].join('\n\n');
  let seated: SeatOutcome;
  try {
    seated = await seatOnce(options, { policy, schedule, role: FINDINGS_REVIEWER_ROLE, contract: STATION_CONTRACTS.review, kind: 'review', authors, tree, context });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  if (!seated.ok) return { refusals: [seated.refusal], review: { subject, ...seated.review, findings: [] } };
  const read = readReviewResult(seated.result.claim.narrative);
  if (!read.readable) {
    return { refusals: [{ part: 'seat', cause: 'result-unreadable', detail: 'the reviewer returned no result the runtime could read as a list of findings' }], review: { subject, ...seated.review, findings: [] } };
  }
  const ids = new Set(items.map((i) => i.id));
  const findings: ReviewFinding[] = [];
  for (const element of read.findings) {
    const shaped = elementFields(element, ['category', 'record']);
    if ('defects' in shaped) {
      findings.push({ kind: 'refused', cause: 'unrecordable', defects: shaped.defects });
      continue;
    }
    const checked = checkFields('nightly-record-finding', shaped.fields);
    if (!checked.ok) {
      findings.push({ kind: 'refused', cause: 'unrecordable', defects: checked.defects });
      continue;
    }
    // A finding names a record of the day it reviewed, or it is refused (R13b).
    if (!ids.has(checked.fields.record)) {
      findings.push({ kind: 'refused', cause: 'unknown-record', defects: [] });
      continue;
    }
    const category = checked.fields.category as (typeof RECORD_CATEGORIES)[number];
    const candidate = await candidateFor(intake, policy, schedule, date, 'nightly-record-finding', checked.fields);
    findings.push({ kind: 'record', category, record: checked.fields.record, candidate });
  }
  return { refusals: [], review: { subject, ...seated.review, findings } };
}

/**
 * The runs merged since the job's last completed run started, every merged
 * run on its first, and whether the head is a commit no recorded merge
 * produced (D-R13b-05).
 */
async function mergedSince(vault: Vault, schedule: TriggerSchedule, date: string, head: string): Promise<{ merged: RunId[]; since: string; unattributed: boolean }> {
  const last = (await vault.readNightly())
    .filter((e) => e.record.schedule === schedule.id && e.record.template === 'nightly-tree-review' && e.record.outcome.kind === 'completed' && e.record.date < date)
    .at(-1);
  const since = last === undefined ? 'none' : last.record.startedAt;
  const merged: RunId[] = [];
  const commits = new Set<string>();
  for (const runId of await vault.listRuns()) {
    for (const record of await readIntegration(vault, runId)) {
      if (record.kind !== 'merged') continue;
      commits.add(record.mergeCommit);
      if (since === 'none' || record.mergedAt > since) merged.push(runId);
    }
  }
  return { merged: [...new Set(merged)], since, unattributed: !commits.has(head) };
}

/** `nightly-tree-review` (R13b): R9's security reviewer over the head of the default branch, graded against every author merged since its last run. */
export async function treeReview(options: ReviewJobOptions, policy: Policy, schedule: TriggerSchedule, date: string, intake: Intake): Promise<ReviewPart> {
  const { target } = options;
  if (target === null) return { refusals: [{ part: 'target', cause: 'no-target', detail: 'this host names no default branch to review' }], review: empty(null) };
  const dir = join(options.root, 'nightly', `${schedule.id}-${date}-${randomUUID()}`);
  const tree = join(dir, 'tree');
  try {
    let commit: string;
    let files: readonly string[];
    try {
      commit = await resolveCommit(target.checkout, `refs/heads/${target.branch}`);
      await mkdir(tree, { recursive: true });
      files = (await materialize(target.checkout, commit, tree)).files;
    } catch (error) {
      return { refusals: [{ part: 'target', cause: 'target-unreadable', detail: describe(error) }], review: empty(null) };
    }
    let since: Awaited<ReturnType<typeof mergedSince>>;
    let authors: SeatIdentity[];
    try {
      since = await mergedSince(options.vault, schedule, date, commit);
      authors = await authorsOf(options.vault, since.merged);
    } catch (error) {
      return { refusals: [{ part: 'subject', cause: 'store-unreadable', detail: `the merged work and its authors could not be read: ${describe(error)}` }], review: empty(null) };
    }
    const subject: ReviewSubject = { kind: 'tree', branch: target.branch, commit, files: files.length, merged: since.merged, since: since.since, unattributed: since.unattributed };
    const context = [
      `[tree]\nThis is not a change. The working directory holds the whole tree of the default branch ${target.branch} at commit ${commit}, ${String(files.length)} files, read-only. There is no spec, diff, or evidence: ask your two questions of the tree as it stands, and name a file and a line in it for every finding.`,
      `[result]\nYour final message is one JSON object and nothing else: {"findings": [{"category": "<one of ${TREE_CATEGORIES.join(', ')}>", "path": "<a file in the tree, relative to it>", "line": <a line number in that file>}]}. ${RESULT_NOTE} An empty list says you found nothing.`,
    ].join('\n\n');
    const seated = await seatOnce(options, {
      policy, schedule, role: SECURITY_REVIEWER_ROLE, contract: securitySeatContract(STATION_CONTRACTS.review), kind: 'security', authors, tree, context,
    });
    if (!seated.ok) return { refusals: [seated.refusal], review: { subject, ...seated.review, findings: [] } };
    const read = readReviewResult(seated.result.claim.narrative);
    if (!read.readable) {
      return { refusals: [{ part: 'seat', cause: 'result-unreadable', detail: 'the reviewer returned no result the runtime could read as a list of findings' }], review: { subject, ...seated.review, findings: [] } };
    }
    const held = new Set(files);
    const findings: ReviewFinding[] = [];
    for (const element of read.findings) {
      const shaped = elementFields(element, ['category', 'path', 'line']);
      if ('defects' in shaped) {
        findings.push({ kind: 'refused', cause: 'unrecordable', defects: shaped.defects });
        continue;
      }
      const checked = checkFields('nightly-tree-finding', shaped.fields);
      if (!checked.ok) {
        findings.push({ kind: 'refused', cause: 'unrecordable', defects: checked.defects });
        continue;
      }
      // Located in the tree reviewed, or refused: a file it holds, and a line that file has (R13b).
      const line = Number(checked.fields.line);
      const path = checked.fields.path;
      const located = held.has(path) && line <= lineCount(await readFile(join(tree, path), 'utf8'));
      if (!located) {
        findings.push({ kind: 'refused', cause: 'unlocated', defects: [] });
        continue;
      }
      const category = checked.fields.category as (typeof TREE_CATEGORIES)[number];
      const candidate = await candidateFor(intake, policy, schedule, date, 'nightly-tree-finding', checked.fields);
      findings.push({ kind: 'tree', category, path, line, candidate });
    }
    return { refusals: [], review: { subject, ...seated.review, findings } };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs a reviewer job; the job's id names which. */
export async function reviewJob(
  template: ReviewJobTemplateId, options: ReviewJobOptions, policy: Policy, schedule: TriggerSchedule, date: string, intake: Intake,
): Promise<ReviewPart> {
  return template === 'nightly-findings-review'
    ? findingsReview(options, policy, schedule, date, intake)
    : treeReview(options, policy, schedule, date, intake);
}
