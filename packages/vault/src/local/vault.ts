/**
 * LocalVault: the Vault contract over the local filesystem.
 *
 * Files, not a database. An evidence bundle, a lock manifest, and a violation
 * are written once and never edited, and the claim this runtime makes is that
 * an auditor can verify one *without trusting the tool that produced it*: the
 * bytes on disk are exactly the bytes that were hashed, so `sha256sum` over an
 * object file reproduces the hash in its name with no Olympus and no schema in
 * the way. A row inside an opaque database would put the tool back in the
 * trust path.
 *
 * Nothing here compares-then-writes. Every record that must not be silently
 * overwritten is created with the `wx` flag, so the filesystem arbitrates and
 * the loser gets `EEXIST`. Hand-rolled concurrency is this file's real risk:
 * the exclusive create is the only reason the race is safe, and any change
 * that reads a version, decides, and then writes reintroduces the lost update
 * that `I5.stale-commit-is-refused-under-contention` exists to catch.
 *
 * Two roots, never one. `store` is what the Vault owns; `artifacts` is the
 * tree a locked path resolves against, which is the tree an agent can write.
 * Collapsing them would place the Vault inside the workspace, which is the
 * arrangement I1 exists to prevent, so the constructor refuses a nested pair.
 *
 * Every cross-file import below is type-only. That is load-bearing, not
 * incidental: it keeps the module free of run-time coupling to any sibling
 * package, which is what lets a child process load this file directly and
 * contend on the real `commitRunState` rather than on a re-implementation of
 * it (`I5.stale-commit-is-refused-under-contention`).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { dirname, join, posix, relative, resolve, win32 } from 'node:path';
import type { RunId, RunState, StationId, TaskResult, VaultRef, VaultRefKind } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type {
  AdmissionRecord, BaseRunRecord, CriticRecord, DecisionCause, DraftLockRecord, DraftRecord, EnforcementDecision, EvidenceBundle, IntegrationRecord, IntentRecord,
  LockEntry, LockManifest, LockVerdict, NoRunState, RubricRecord, UsageRecord, Vault,
} from '../types.js';

/** Reported as `actual` for a locked path that no longer exists: a deleted artifact is a mismatch, not an empty file (D-S1-02). */
const MISSING = 'missing';

/**
 * Reported as `actual` for a locked path that now resolves outside the
 * artifact root. Replacing a locked file with a symlink to somewhere else is a
 * tamper, and reporting it as one keeps it on the path that records a
 * violation and refuses, rather than throwing past it.
 */
const ESCAPED = 'escaped';

/**
 * Reported as `actual` for a locked path that is present but cannot be read
 * as bytes: replaced by a directory (EISDIR), a symlink loop (ELOOP), or a
 * file whose permissions were removed (EACCES).
 *
 * A sentinel rather than a thrown error, because D-S1-15 records exactly this
 * shape: an exception that happens to stop a run is not a control. It holds
 * only until someone adds a catch, and it ends the run with no violation
 * recorded and the state left mid-flight. An artifact that cannot be read is
 * not the artifact that was locked, so it is a mismatch like any other, and
 * the line records it and refuses.
 */
const UNREADABLE = 'unreadable';

/** A run state version, and the name of the file that holds it. Zero means "nothing committed yet" and is never a file. */
const VERSION = /^(0|[1-9][0-9]*)$/;

const NUMBERED_JSON = /^(0|[1-9][0-9]*)\.json$/;

/**
 * A run id becomes a directory name. Anything that could climb out of the
 * store (`..`, a separator, a drive letter) is refused rather than sanitised:
 * a caller that can steer a write out of the store is the write path I1 denies.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const KINDS: readonly VaultRefKind[] = [
  'spec', 'acceptance-tests', 'task-graph', 'lock-manifest', 'policy',
  'verification-manifest', 'evidence', 'violation', 'run-state', 'rubric', 'learning',
  'admission', 'task-result', 'usage', 'decision', 'integration', 'base-run',
  'intent', 'draft', 'critic-result', 'draft-lock',
];

/** The one admission record a run may have. Named, not hash-addressed, so its exclusive create is what makes it once-only. */
const ADMISSION_FILE = 'admission.json';

/**
 * The one base record a run's admitted checks may have (D-A-BF-01), named for
 * the same reason as the admission record. A test draft's is named for its
 * hash beside it, once per draft (R19).
 */
const BASE_RUN_FILE = 'base-run.json';

function baseRunFile(draft: string | null): string {
  return draft === null ? BASE_RUN_FILE : `base-run.${draft}.json`;
}

/** Once per run and station: an approved draft is locked once, as an admission is admitted once (R19). */
function draftLockFile(station: string): string {
  return `draft-lock.${station}.json`;
}

const DRAFT_STATIONS = new Set(['spec', 'test-design']);

export interface VaultRoots {
  /** What the Vault owns. Never inside `artifacts`, and never the same directory. */
  readonly store: string;
  /** What a locked path resolves against: the tree holding the artifacts. */
  readonly artifacts: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isAbsent(error)) return false;
    throw error;
  }
}

function isAbsent(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
}

/** True when `child` is `parent` or sits beneath it. */
function contains(parent: string, child: string): boolean {
  const step = relative(parent, child);
  return step === '' || (!step.startsWith('..') && !posix.isAbsolute(step) && !win32.isAbsolute(step));
}

function requireRunId(runId: string): string {
  if (!RUN_ID.test(runId) || runId === '.' || runId === '..') {
    throw new Error(`LocalVault: '${runId}' is not a usable run id; a run id names a directory and must match ${String(RUN_ID)}`);
  }
  return runId;
}

function runDir(store: string, runId: string): string {
  return join(store, 'runs', requireRunId(runId));
}

/**
 * Creates `file` only if it does not exist. Returns false when it already
 * does. The `wx` flag is the concurrency control for every record in this
 * store: it is one filesystem operation, so two writers cannot both succeed.
 */
async function createExclusive(file: string, bytes: Uint8Array): Promise<boolean> {
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, bytes, { flag: 'wx' });
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
}

/** The numbers of the `<n>.json` files in `dir`, ascending. An absent directory has none. */
async function numbersIn(dir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isAbsent(error)) return [];
    throw error;
  }
  const numbers: number[] = [];
  for (const name of names) {
    const digits = NUMBERED_JSON.exec(name)?.[1];
    if (digits !== undefined) numbers.push(Number(digits));
  }
  return numbers.sort((a, b) => a - b);
}

/**
 * The highest `<n>.json` in `dir`, or null when there is none. Derived by
 * scanning rather than read from a pointer file: a pointer written after the
 * record it points at is a second, non-atomic step, and a writer that dies
 * between the two would leave a record no reader can see and a version no
 * writer can take.
 */
async function highestIn(dir: string): Promise<number | null> {
  const numbers = await numbersIn(dir);
  return numbers.at(-1) ?? null;
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8');
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function encode(record: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}

/**
 * Every field a consumer reads without checking, checked here. A record that
 * satisfies part of the shape is refused rather than returned: a state whose
 * `evidenceRefs` is absent survives this function and then throws `is not
 * iterable` in whichever caller spreads it, which turns a corrupt store into
 * a crash somewhere else entirely. Found by the P1 external review, finding 2.
 */
function isMap(value: unknown): boolean {
  return isRecord(value) && !Array.isArray(value);
}

function isRef(value: unknown): boolean {
  return isRecord(value) && hasString(value, 'runId') && hasString(value, 'kind') && hasString(value, 'hash');
}

function requireRunState(value: unknown, file: string): RunState {
  const ok =
    isRecord(value) &&
    hasString(value, 'runId') && hasString(value, 'station') && hasString(value, 'version') &&
    (value.phase === 'working' || value.phase === 'exiting') && isRef(value.admission) &&
    isMap(value.tasks) && isMap(value.attempts) && isMap(value.results) &&
    Array.isArray(value.evidenceRefs) && Array.isArray(value.violations) &&
    Array.isArray(value.approvals) && Array.isArray(value.reviews) && Array.isArray(value.usage) &&
    (value.cancelled === null || (isRecord(value.cancelled) && hasString(value.cancelled, 'by') && hasString(value.cancelled, 'at'))) &&
    (value.halted === null || (isRecord(value.halted) && hasString(value.halted, 'at') && hasString(value.halted, 'message')));
  if (!ok) throw new Error(`LocalVault: ${file} does not hold a run state; refusing to return a partial record`);
  // A state committed before R19 holds no drafts and grants that name no draft: read as none (R19).
  const drafts = value.drafts === undefined ? {} : value.drafts;
  if (!isMap(drafts)) throw new Error(`LocalVault: ${file} holds drafts that are not a map; refusing to return a partial record`);
  const approvals = (value.approvals as unknown[]).map((grant) => (isRecord(grant) && grant.draft === undefined ? { ...grant, draft: null } : grant));
  return { ...value, drafts, approvals } as unknown as RunState;
}

const READING_COUNTS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'refused'] as const;
const EXHAUSTED = new Set(['none', 'tokens', 'cost', 'unreadable']);

/** Why a usage record is not one the runtime collected, or `undefined` when it is. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Why `roles` is not the compiled role set an admission pins, or undefined.
 * Each role's hash is checked against its instructions, which the compiler
 * keeps byte for byte, so a record cannot pin one version and carry another's
 * text (D-A-RC-01).
 */
function rolesProblem(roles: unknown): string | undefined {
  if (!Array.isArray(roles)) return 'it carries no compiled roles';
  const seen = new Set<string>();
  for (const role of roles as unknown[]) {
    if (!isRecord(role) || !hasString(role, 'role') || role.role === '' || !hasString(role, 'instructions') || typeof role.sha256 !== 'string') {
      return 'a role carries no id, instructions, and hash';
    }
    const { role: id, instructions, sha256 } = role as { role: string; instructions: string; sha256: string };
    if (seen.has(id)) return `role ${id} is listed twice`;
    seen.add(id);
    if (createHash('sha256').update(instructions, 'utf8').digest('hex') !== sha256) {
      return `role ${id}'s hash is not the hash of its instructions`;
    }
  }
  return undefined;
}

function usageProblem(r: unknown): string | undefined {
  if (!isRecord(r) || !hasString(r, 'runId') || !hasString(r, 'taskId') || !hasString(r, 'station')) return 'it names no run, task, and station';
  if (r.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (typeof r.attempt !== 'number' || !Number.isInteger(r.attempt) || r.attempt < 1) return 'attempt is not a positive whole number';
  const model = r.model;
  if (!isRecord(model) || !hasString(model, 'provider') || !hasString(model, 'family') || !hasString(model, 'model') || model.family === '' || model.model === '') {
    return 'it names no model the call ran on (A-I1a-01)';
  }
  const role = r.role;
  if (!isRecord(role) || !hasString(role, 'id') || role.id === '' || typeof role.sha256 !== 'string' || !SHA256_HEX.test(role.sha256)) {
    return 'it names no role and version the call ran under (D-A-RC-04)';
  }
  const reading = r.reading;
  if (!isRecord(reading)) return 'it carries no reading';
  if (reading.kind === 'unmetered' || reading.kind === 'pending') return undefined;
  if (reading.kind === 'lost') return hasString(reading, 'detail') && reading.detail !== '' ? undefined : 'a lost reading does not say why it was lost';
  if (reading.kind !== 'metered') return `the reading's kind ${String(reading.kind)} is not metered, unmetered, pending, or lost`;
  const bad = READING_COUNTS.filter((k) => typeof reading[k] !== 'number' || !Number.isFinite(reading[k]) || reading[k] < 0);
  if (bad.length > 0) return `the reading's ${bad.join(', ')} are not non-negative finite numbers`;
  if (typeof reading.exhausted !== 'string' || !EXHAUSTED.has(reading.exhausted)) return "the reading's exhausted is not a known reason";
  return undefined;
}

/**
 * The component each cause may name. A decision attributed to a component
 * that does not make its cause is refused, so the record cannot say the
 * proxy refused an admission (D-P14-09).
 */
const DECIDERS: Readonly<Record<DecisionCause['cause'], readonly string[]>> = {
  'admission-refused': ['admission'],
  'resume-refused': ['admission'],
  'station-refused': ['station-machine', 'line'],
  'approval-granted': ['approval'],
  'approval-refused': ['approval'],
  'egress-connection': ['egress-proxy'],
  'violation-recorded': ['line'],
  'relay-refused': ['model-relay'],
  'tier-escalated': ['line'],
  'task-conflict': ['line'],
  'approval-rejected': ['approval'],
  'draft-sent-back': ['line'],
  'draft-floor-applied': ['line'],
};

function isNullableString(r: Record<string, unknown>, key: string): boolean {
  return r[key] === null || typeof r[key] === 'string';
}

function decisionProblem(d: unknown): string | undefined {
  if (!isRecord(d) || !hasString(d, 'runId')) return 'it names no run';
  if (d.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (!isNullableString(d, 'taskId') || !isNullableString(d, 'station')) return 'its task and station are neither strings nor null';
  if (!hasString(d, 'decidedAt')) return 'it carries no time';
  if (!hasString(d, 'occurrence')) return 'it carries no occurrence id, so it could be one entry with a decision alike in every other field';
  const decision = d.decision;
  if (!isRecord(decision) || typeof decision.cause !== 'string' || !Object.hasOwn(DECIDERS, decision.cause)) return 'its cause is not a known cause';
  const deciders = DECIDERS[decision.cause as DecisionCause['cause']];
  if (typeof decision.decidedBy !== 'string' || !deciders.includes(decision.decidedBy)) {
    return `a ${decision.cause} decision is not made by ${String(decision.decidedBy)}`;
  }
  return undefined;
}

/**
 * One result of the base run, whole. The suite count is required, a count or
 * null: an absent one reads as neither, and the suite-count rule would pass it
 * (codex-obs). An exit code is an integer: NaN is written as null and read
 * back as a failure, which a check declared `'fails'` would count as a
 * reproduction.
 */
/** A security check's finding as the runtime fingerprinted it: the base set every later finding is judged against, so a malformed one is refused (R17). */
function isFinding(f: unknown): boolean {
  return isRecord(f) && hasString(f, 'rule') && hasString(f, 'fingerprint') && /^[0-9a-f]{64}$/.test(f.fingerprint as string) &&
    isRecord(f.location) && hasString(f.location, 'path') && Number.isInteger(f.location.line);
}

function isBaseResult(c: unknown): boolean {
  return isRecord(c) && hasString(c, 'checkId') && Number.isInteger(c.exitCode) &&
    (c.suiteCount === null || (Number.isInteger(c.suiteCount) && (c.suiteCount as number) >= 0)) &&
    (c.findings === null || (Array.isArray(c.findings) && c.findings.every(isFinding)));
}

/** D-A-BF-01: the runtime's record of the acceptance checks over the base, whole, or refused. */
function baseRunProblem(r: unknown): string | undefined {
  if (!isRecord(r) || !hasString(r, 'runId')) return 'it names no run';
  if (r.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (!(r.draft === null || (typeof r.draft === 'string' && SHA256_HEX.test(r.draft)))) return 'it names neither a draft hash nor null (R19)';
  if (!hasString(r, 'baseTreeSha256') || !/^[0-9a-f]{64}$/.test(r.baseTreeSha256 as string)) return 'it names no base tree digest';
  if (!Array.isArray(r.checks) || !r.checks.every(isBaseResult)) {
    return 'its checks are not results';
  }
  if (!Array.isArray(r.unstarted) || !r.unstarted.every((u) => isRecord(u) && hasString(u, 'checkId') && hasString(u, 'reason'))) {
    return 'its unstarted checks do not each say why';
  }
  return undefined;
}

function isModel(m: unknown): boolean {
  return isRecord(m) && hasString(m, 'provider') && hasString(m, 'family') && hasString(m, 'model') && m.family !== '' && m.model !== '';
}

function isRoleVersion(r: unknown): boolean {
  return isRecord(r) && hasString(r, 'id') && r.id !== '' && typeof r.sha256 === 'string' && SHA256_HEX.test(r.sha256);
}

function isDraftRef(d: unknown): boolean {
  return isRecord(d) && typeof d.sha256 === 'string' && SHA256_HEX.test(d.sha256) && Number.isInteger(d.attempt) && (d.attempt as number) >= 1;
}

function isPathCodes(value: unknown): boolean {
  return Array.isArray(value) && value.every((p) => isRecord(p) && hasString(p, 'path') && hasString(p, 'code'));
}

/**
 * The hash a draft is named by: the SHA-256 of the canonical list of each
 * file's path and hash, sorted by path (R19). Exported for the runtime, which
 * computes it from the bytes it read, so the two cannot drift.
 */
export function draftDigest(files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>): string {
  const canonical = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => [f.path, f.sha256]);
  return sha256(new TextEncoder().encode(JSON.stringify(canonical)));
}

/** R19: a draft as the runtime read it, whole, with its hash the hash of its files and each file's the hash of its bytes. */
function draftProblem(r: unknown): string | undefined {
  if (!isRecord(r) || !hasString(r, 'runId')) return 'it names no run';
  if (r.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (typeof r.station !== 'string' || !DRAFT_STATIONS.has(r.station)) return 'it names no drafting station';
  if (!Number.isInteger(r.attempt) || (r.attempt as number) < 1) return 'attempt is not a positive whole number';
  if (!Array.isArray(r.files) || r.files.length === 0) return 'it holds no file';
  const seen = new Set<string>();
  for (const file of r.files as unknown[]) {
    if (!isRecord(file) || !hasString(file, 'path') || !hasString(file, 'sha256') || !hasString(file, 'base64')) return 'a file carries no path, hash, and bytes';
    const { path, sha256: hash, base64 } = file as { path: string; sha256: string; base64: string };
    if (seen.has(path)) return `${path} is listed twice`;
    seen.add(path);
    if (sha256(Buffer.from(base64, 'base64')) !== hash) return `${path}'s hash is not the hash of its bytes`;
  }
  if (r.sha256 !== draftDigest(r.files as Array<{ path: string; sha256: string }>)) return 'its hash is not the hash of its files';
  if (!Array.isArray(r.discarded) || !r.discarded.every((d) => typeof d === 'string')) return 'its discarded paths are not a list';
  if (!isPathCodes(r.problems)) return 'its problems are not paths and codes';
  if (!isModel(r.model)) return 'it names no model the drafter ran on';
  if (!isRoleVersion(r.role)) return 'it names no role and version the drafter ran under';
  return undefined;
}

/** R19: a critic's result, whole: a binding result is of another family, and an unreadable one carries a finding (I5). */
function criticProblem(r: unknown): string | undefined {
  if (!isRecord(r) || !hasString(r, 'runId')) return 'it names no run';
  if (r.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (typeof r.station !== 'string' || !DRAFT_STATIONS.has(r.station)) return 'it names no drafting station';
  if (!Number.isInteger(r.attempt) || (r.attempt as number) < 1) return 'attempt is not a positive whole number';
  if (typeof r.draft !== 'string' || !SHA256_HEX.test(r.draft)) return 'it names no draft hash';
  if (!isModel(r.drafter) || !isModel(r.critic)) return 'it names no drafter and critic model';
  if (r.grade !== 'different-family' && r.grade !== 'different-model' && r.grade !== 'same-model') return 'its grade is not a grade';
  if (r.binding !== (r.grade === 'different-family')) return 'only a critic of another family than the drafter is binding (D-A-DS-06)';
  if (typeof r.readable !== 'boolean') return 'it does not say whether the result was readable';
  if (!Array.isArray(r.findings) || !r.findings.every((f) => typeof f === 'string' && f !== '')) return 'its findings are not a list of text';
  if (!r.readable && r.findings.length === 0) return 'an unreadable result counts as a finding (I5)';
  if (typeof r.rubric !== 'string' || !SHA256_HEX.test(r.rubric)) return 'it names no rubric hash';
  if (!isRoleVersion(r.role)) return 'it names no role and version the critic ran under';
  return undefined;
}

/** R19: an approved draft's lock, whole. */
function draftLockProblem(r: unknown): string | undefined {
  if (!isRecord(r) || !hasString(r, 'runId')) return 'it names no run';
  if (r.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (typeof r.station !== 'string' || !DRAFT_STATIONS.has(r.station)) return 'it names no drafting station';
  if (!isDraftRef(r.draft)) return 'it names no draft';
  if (!Array.isArray(r.files) || r.files.length === 0 || !r.files.every((f) => isRecord(f) && hasString(f, 'path') && typeof f.sha256 === 'string' && SHA256_HEX.test(f.sha256))) {
    return 'its files are not paths and hashes';
  }
  const approval = r.approval;
  if (!isRecord(approval) || !((approval.by === 'principal' && hasString(approval, 'principal') && approval.principal !== '') || approval.by === 'policy')) {
    return 'it does not say who approved it';
  }
  if (typeof r.baseTreeSha256 !== 'string' || !SHA256_HEX.test(r.baseTreeSha256)) return 'it names no base tree digest';
  return undefined;
}

/** A-I1b-01: the runtime's record of what it did on the remote, whole, or refused. */
function integrationProblem(r: unknown): string | undefined {
  if (!isRecord(r) || !hasString(r, 'runId')) return 'it names no run';
  if (r.collectedBy !== 'runtime') return "collectedBy is not 'runtime'";
  if (r.kind !== 'opened' && r.kind !== 'merged') return 'its kind is neither opened nor merged';
  for (const key of ['repository', 'baseBranch', 'baseCommit', 'branch', 'commit', 'url']) {
    if (!hasString(r, key) || r[key] === '') return `it carries no ${key}`;
  }
  if (typeof r.pullRequest !== 'number' || !Number.isInteger(r.pullRequest) || r.pullRequest < 1) return 'it names no pull request';
  if (r.kind === 'merged' && (!hasString(r, 'mergeCommit') || r.mergeCommit === '')) return 'a merge record carries no merge commit';
  if (r.kind === 'merged' && (!hasString(r, 'mergedAt') || Number.isNaN(Date.parse(r.mergedAt as string)))) return 'a merge record carries no merge time';
  return undefined;
}

function isLockEntry(value: unknown): boolean {
  return isRecord(value) && hasString(value, 'path') && hasString(value, 'sha256') && hasString(value, 'lockedAt') && hasString(value, 'lockedBy');
}

/** As above: an entry list whose elements are not entries is refused here, not resolved as a path later. */
function requireManifest(value: unknown, file: string): LockManifest {
  const ok = isRecord(value) && hasString(value, 'runId') && Array.isArray(value.entries) && value.entries.every(isLockEntry);
  if (!ok) throw new Error(`LocalVault: ${file} does not hold a lock manifest; refusing to report on an unreadable one`);
  return value as unknown as LockManifest;
}

/**
 * Locked paths are artifact-root-relative. An absolute path or a `..` segment
 * would let the Vault and any later reader name different files, which is the
 * shape D-S1-15 records; symlink containment is resolved separately, at hash
 * time, because a path can become an escape after it was locked.
 */
function refuseUnusablePaths(runId: string, paths: readonly string[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path === '') {
      problems.push('an empty path');
      continue;
    }
    if (posix.isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
      problems.push(`'${path}' is absolute; locked paths are relative to the artifact root`);
    }
    if (path.split(/[\\/]/).includes('..')) {
      problems.push(`'${path}' contains a '..' segment and could leave the artifact root`);
    }
    if (seen.has(path)) problems.push(`'${path}' is listed twice`);
    seen.add(path);
  }
  if (problems.length > 0) {
    throw new Error(`LocalVault: refusing to lock for run ${runId}: ${problems.join('; ')}`);
  }
}

/**
 * The SHA-256 of a locked artifact, or a sentinel saying why there is none.
 * `realpath` is what closes the symlink case: a locked file swapped for a link
 * out of the tree resolves outside the artifact root and is reported as a
 * tamper rather than silently hashed.
 */
async function artifactRoot(artifacts: string): Promise<string> {
  try {
    return await realpath(artifacts);
  } catch (error) {
    throw new Error(
      `LocalVault: the artifact root ${artifacts} cannot be resolved, so no locked path can be verified against it`,
      { cause: error },
    );
  }
}

/**
 * The SHA-256 of a locked artifact, or a sentinel saying why there is none.
 * Resolving the real path is what closes the symlink case: a locked file
 * swapped for a link out of the tree resolves outside the root and is
 * reported as a tamper rather than silently hashed.
 *
 * No failure here throws. Every way of failing to resolve or read the
 * artifact is a mismatch the caller records and refuses on, because a locked
 * artifact the runtime cannot read is not the locked artifact. The root is
 * resolved once by the caller: it is the same for every entry, and losing it
 * is an operational failure rather than a verdict about one path.
 */
async function hashArtifact(root: string, path: string): Promise<string> {
  const target = resolve(root, path);
  let real: string;
  try {
    real = await realpath(target);
  } catch (error) {
    return isAbsent(error) ? MISSING : UNREADABLE;
  }
  if (!contains(root, real)) return ESCAPED;
  try {
    return sha256(await readFile(real));
  } catch (error) {
    return isAbsent(error) ? MISSING : UNREADABLE;
  }
}

function objectFile(store: string, ref: VaultRef): string {
  if (!KINDS.includes(ref.kind)) throw new Error(`LocalVault: '${ref.kind}' is not a Vault reference kind`);
  if (!/^[0-9a-f]{64}$/.test(ref.hash)) throw new Error(`LocalVault: '${ref.hash}' is not a SHA-256 digest`);
  if (ref.kind === 'admission') return join(runDir(store, ref.runId), ADMISSION_FILE);
  return join(runDir(store, ref.runId), 'objects', ref.kind, `${ref.hash}.json`);
}

/**
 * Stores a record under its own SHA-256. Writing the same bytes twice for the
 * same run and kind yields the same reference and leaves the first copy in
 * place: the object is the hash of its content, so a second write has nothing
 * to change (D-S1-03).
 */
async function storeObject(store: string, runId: RunId, kind: VaultRefKind, record: unknown): Promise<VaultRef> {
  const bytes = encode(record);
  const ref: VaultRef = { runId, kind, hash: sha256(bytes) };
  await createExclusive(objectFile(store, ref), bytes);
  return ref;
}

export class LocalVault implements Vault {
  readonly #store: string;
  readonly #artifacts: string;

  constructor(roots: VaultRoots) {
    const store = resolve(roots.store);
    const artifacts = resolve(roots.artifacts);
    if (contains(store, artifacts) || contains(artifacts, store)) {
      throw new Error(
        `LocalVault: the store (${store}) and the artifact root (${artifacts}) overlap. The artifact root is the tree ` +
          'an agent writes; a store inside it, or holding it, is a Vault an agent can reach, which is exactly what I1 denies.',
      );
    }
    this.#store = store;
    this.#artifacts = artifacts;
  }

  async read(ref: VaultRef): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(objectFile(this.#store, ref));
    } catch (error) {
      if (!isAbsent(error)) throw error;
      // A base record written before R19 lives only under its fixed name.
      const legacy = ref.kind === 'base-run' ? await readFile(join(runDir(this.#store, ref.runId), BASE_RUN_FILE)).catch(() => undefined) : undefined;
      if (legacy === undefined) throw new Error(`LocalVault: no ${ref.kind} ${ref.hash} for run ${ref.runId}`, { cause: error });
      bytes = legacy;
    }
    // Every other kind is named by its hash, so the file a ref names holds that
    // content. The admission record is named by its run, so a ref carrying some
    // other hash must not read it back as if it matched.
    if ((ref.kind === 'admission' || ref.kind === 'base-run') && sha256(bytes) !== ref.hash) {
      throw new Error(`LocalVault: no ${ref.kind} ${ref.hash} for run ${ref.runId}; the run's ${ref.kind} record hashes to ${sha256(bytes)}`);
    }
    return bytes;
  }

  /**
   * Adds to the run's manifest; never replaces it. `spec` locks the spec and
   * `test-design` locks the acceptance tests, and I3 requires both still
   * verified at every later transition, so a later lock that dropped the
   * earlier one would make the invariant unsatisfiable. An already-locked path
   * is refused rather than re-hashed: re-locking is how a tamper would launder
   * itself, and the station and instant of the first lock are the audit record.
   */
  async lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest> {
    if (paths.length === 0) {
      throw new Error(`LocalVault: refusing to lock nothing for run ${runId}; an empty manifest would verify as intact`);
    }
    refuseUnusablePaths(runId, paths);

    const locks = join(runDir(this.#store, runId), 'locks');
    const generation = await highestIn(locks);
    const existing: LockEntry[] =
      generation === null ? [] : [...requireManifest(await readJson(join(locks, `${String(generation)}.json`)), `${String(generation)}.json`).entries];

    const already = paths.filter((path) => existing.some((entry) => entry.path === path));
    if (already.length > 0) {
      const held = already.map((path) => {
        const entry = existing.find((e) => e.path === path);
        return `'${path}' (locked at ${entry === undefined ? 'an earlier station' : entry.lockedBy})`;
      });
      throw new Error(
        `LocalVault: refusing to lock ${held.join(', ')} again for run ${runId}. An artifact is fixed from its first ` +
          'lock; re-locking would rebase its hash onto whatever the bytes are now.',
      );
    }

    const root = await artifactRoot(this.#artifacts);
    const lockedAt = new Date().toISOString();
    const added: LockEntry[] = [];
    for (const path of paths) {
      const hash = await hashArtifact(root, path);
      if (hash === MISSING) throw new Error(`LocalVault: cannot lock ${path} for run ${runId}: no such file under ${this.#artifacts}`);
      if (hash === ESCAPED) throw new Error(`LocalVault: cannot lock ${path} for run ${runId}: it resolves outside ${this.#artifacts}`);
      if (hash === UNREADABLE) throw new Error(`LocalVault: cannot lock ${path} for run ${runId}: it exists but cannot be read as bytes`);
      added.push({ path, sha256: hash, lockedAt, lockedBy: by });
    }

    const manifest: LockManifest = { runId, entries: [...existing, ...added] };
    const next = (generation ?? 0) + 1;
    if (!(await createExclusive(join(locks, `${String(next)}.json`), encode(manifest)))) {
      throw new Error(
        `LocalVault: another writer locked generation ${String(next)} for run ${runId} first; nothing was stored. ` +
          'Re-read the manifest and lock again.',
      );
    }
    return manifest;
  }

  async verifyLocks(runId: RunId): Promise<LockVerdict> {
    const locks = join(runDir(this.#store, runId), 'locks');
    const generation = await highestIn(locks);
    if (generation === null) {
      throw new Error(`LocalVault: nothing is locked for run ${runId}; refusing to report intact`);
    }
    const file = join(locks, `${String(generation)}.json`);
    const manifest = requireManifest(await readJson(file), file);

    const root = await artifactRoot(this.#artifacts);
    const tampered: Array<{ path: string; expected: string; actual: string }> = [];
    for (const entry of manifest.entries) {
      const actual = await hashArtifact(root, entry.path);
      if (actual !== entry.sha256) tampered.push({ path: entry.path, expected: entry.sha256, actual });
    }
    return tampered.length === 0 ? { ok: true } : { ok: false, tampered };
  }

  writeEvidence(b: EvidenceBundle): Promise<VaultRef> {
    return storeObject(this.#store, b.runId, 'evidence', b);
  }

  recordViolation(v: IntegrityViolation): Promise<VaultRef> {
    return storeObject(this.#store, v.runId, 'violation', v);
  }

  /**
   * Once per run. The record is created with the same exclusive create as run
   * state, under a fixed name rather than its hash, so a second admission for
   * the run finds the file present and stores nothing: a run cannot be
   * re-admitted at another level or under another policy.
   */
  async recordAdmission(a: AdmissionRecord): Promise<VaultRef> {
    if (!isRecord(a) || !isRecord(a.run) || typeof a.run.id !== 'string') {
      throw new Error('LocalVault: an admission record must carry the run it admits');
    }
    // A stack not written at admission cannot be backfilled, so a record without one is refused (R18).
    if (typeof (a.stack as unknown) !== 'string' || a.stack === '') {
      throw new Error(`LocalVault: the admission record of run ${a.run.id} names no stack; nothing was stored`);
    }
    // The roles a run's seats run under cannot be supplied later, so a record without them is refused (D-A-RC-01).
    const roles = rolesProblem(a.roles);
    if (roles !== undefined) throw new Error(`LocalVault: the admission record of run ${a.run.id} does not pin its roles: ${roles}; nothing was stored`);
    const runId = a.run.id;
    const bytes = encode(a);
    if (!(await createExclusive(join(runDir(this.#store, runId), ADMISSION_FILE), bytes))) {
      throw new Error(`LocalVault: run ${runId} already has an admission record; a run is admitted once, and nothing was stored`);
    }
    return { runId, kind: 'admission', hash: sha256(bytes) };
  }

  recordTaskResult(runId: RunId, r: TaskResult): Promise<VaultRef> {
    if (!isRecord(r) || typeof r.taskId !== 'string') {
      return Promise.reject(new Error(`LocalVault: refusing to record a task result for run ${runId} that names no task`));
    }
    return storeObject(this.#store, runId, 'task-result', r);
  }

  /**
   * I2: only a record the runtime collected. A reading is checked for its
   * shape too, because a total derived from a record with a missing count
   * would be a figure nobody measured.
   */
  recordUsage(r: UsageRecord): Promise<VaultRef> {
    const problem = usageProblem(r);
    if (problem !== undefined) return Promise.reject(new Error(`LocalVault: refusing a usage record: ${problem}`));
    return storeObject(this.#store, r.runId, 'usage', r);
  }

  /**
   * I2: only a decision the runtime recorded, attributed to a component that
   * makes its cause. Written under the run's directory whether or not the run
   * has state, so a refused admission leaves this and nothing else (D-P14-01).
   */
  recordDecision(d: EnforcementDecision): Promise<VaultRef> {
    const problem = decisionProblem(d);
    if (problem !== undefined) return Promise.reject(new Error(`LocalVault: refusing an enforcement decision: ${problem}`));
    return storeObject(this.#store, d.runId, 'decision', d);
  }

  /** Every decision file under the run, by its name; the name is the hash, so each ref reads back the file it names. */
  readDecisions(runId: RunId): Promise<readonly VaultRef[]> {
    return this.#objects(runId, 'decision');
  }

  /** Every usage file under the run, referenced from run state or not (A-I1a-05). */
  readUsage(runId: RunId): Promise<readonly VaultRef[]> {
    return this.#objects(runId, 'usage');
  }

  /**
   * I2: only the runtime's record, whole. Once per run and draft, by an
   * exclusive create: a second base run would let a run or a draft be judged
   * against whichever base suited it, so it is refused and nothing more is
   * stored. The record is stored under its hash first, so the name that makes
   * it once-only never points at a record that is not there (R19).
   */
  async recordBaseRun(r: BaseRunRecord): Promise<VaultRef> {
    const problem = baseRunProblem(r);
    if (problem !== undefined) throw new Error(`LocalVault: refusing a base record: ${problem}`);
    const bytes = encode(r);
    const ref: VaultRef = { runId: r.runId, kind: 'base-run', hash: sha256(bytes) };
    const named = join(runDir(this.#store, r.runId), baseRunFile(r.draft));
    if (await pathExists(named)) {
      throw new Error(`LocalVault: run ${r.runId} already has a base record${r.draft === null ? '' : ` for draft ${r.draft}`}; the checks run over a base once, and nothing was stored`);
    }
    await createExclusive(objectFile(this.#store, ref), bytes);
    if (!(await createExclusive(named, bytes))) {
      throw new Error(`LocalVault: run ${r.runId} already has a base record${r.draft === null ? '' : ` for draft ${r.draft}`}; the checks run over a base once, and nothing was stored`);
    }
    return ref;
  }

  async readBaseRun(runId: RunId, draft: string | null): Promise<VaultRef | null> {
    if (draft !== null && !SHA256_HEX.test(draft)) throw new Error(`LocalVault: '${draft}' is not a draft hash`);
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(runDir(this.#store, runId), baseRunFile(draft)));
    } catch (error) {
      if (isAbsent(error)) return null;
      throw error;
    }
    return { runId, kind: 'base-run', hash: sha256(bytes) };
  }

  /** I7: only a person's intent, as the principal's channel supplied it (R19). */
  recordIntent(r: IntentRecord): Promise<VaultRef> {
    if (!isRecord(r) || !hasString(r, 'runId') || !hasString(r, 'text') || r.text.trim() === '') return Promise.reject(new Error('LocalVault: refusing an intent that names no run or carries no text'));
    if ((r.from as string) !== 'principal') return Promise.reject(new Error("LocalVault: refusing an intent that did not come from the principal's channel"));
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error("LocalVault: refusing an intent: collectedBy is not 'runtime'"));
    return storeObject(this.#store, r.runId, 'intent', r);
  }

  recordRubric(r: RubricRecord): Promise<VaultRef> {
    if (!isRecord(r) || !hasString(r, 'runId') || !hasString(r, 'text') || typeof r.station !== 'string' || !DRAFT_STATIONS.has(r.station)) {
      return Promise.reject(new Error('LocalVault: refusing a rubric that names no run, station, or text'));
    }
    if ((r.collectedBy as string) !== 'runtime') return Promise.reject(new Error("LocalVault: refusing a rubric: collectedBy is not 'runtime'"));
    if (createHash('sha256').update(r.text, 'utf8').digest('hex') !== r.sha256) return Promise.reject(new Error('LocalVault: refusing a rubric whose hash is not its text\'s'));
    return storeObject(this.#store, r.runId, 'rubric', r);
  }

  recordDraft(r: DraftRecord): Promise<VaultRef> {
    const problem = draftProblem(r);
    if (problem !== undefined) return Promise.reject(new Error(`LocalVault: refusing a draft: ${problem}`));
    return storeObject(this.#store, r.runId, 'draft', r);
  }

  recordCriticResult(r: CriticRecord): Promise<VaultRef> {
    const problem = criticProblem(r);
    if (problem !== undefined) return Promise.reject(new Error(`LocalVault: refusing a critic result: ${problem}`));
    return storeObject(this.#store, r.runId, 'critic-result', r);
  }

  /** Once per run and station, by an exclusive create: an approved draft is locked once (R19). */
  async recordDraftLock(r: DraftLockRecord): Promise<VaultRef> {
    const problem = draftLockProblem(r);
    if (problem !== undefined) throw new Error(`LocalVault: refusing a draft lock: ${problem}`);
    const bytes = encode(r);
    const ref: VaultRef = { runId: r.runId, kind: 'draft-lock', hash: sha256(bytes) };
    await createExclusive(objectFile(this.#store, ref), bytes);
    if (!(await createExclusive(join(runDir(this.#store, r.runId), draftLockFile(r.station)), bytes))) {
      throw new Error(`LocalVault: run ${r.runId} already locked a draft at ${r.station}; nothing more was stored`);
    }
    return ref;
  }

  async readLocks(runId: RunId): Promise<LockManifest | null> {
    const locks = join(runDir(this.#store, runId), 'locks');
    const generation = await highestIn(locks);
    if (generation === null) return null;
    const file = join(locks, `${String(generation)}.json`);
    return requireManifest(await readJson(file), file);
  }

  /** I2: only what the runtime did, whole. The same act recorded twice is one entry, since the record carries no time. */
  recordIntegration(r: IntegrationRecord): Promise<VaultRef> {
    const problem = integrationProblem(r);
    if (problem !== undefined) return Promise.reject(new Error(`LocalVault: refusing an integration record: ${problem}`));
    return storeObject(this.#store, r.runId, 'integration', r);
  }

  readIntegration(runId: RunId): Promise<readonly VaultRef[]> {
    return this.#objects(runId, 'integration');
  }

  /** Every run directory under the store, whatever it holds, so a run refused at admission is listed too (A-R2-02). */
  async listRuns(): Promise<readonly RunId[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(join(this.#store, 'runs'), { withFileTypes: true });
    } catch (error) {
      if (isAbsent(error)) return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
      .map((entry) => entry.name as RunId)
      .sort();
  }

  async #objects(runId: RunId, kind: 'decision' | 'usage' | 'integration'): Promise<readonly VaultRef[]> {
    const dir = join(runDir(this.#store, runId), 'objects', kind);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if (isAbsent(error)) return [];
      throw error;
    }
    return names
      .map((name) => /^([0-9a-f]{64})\.json$/.exec(name)?.[1])
      .filter((hash): hash is string => hash !== undefined)
      .sort()
      .map((hash) => ({ runId, kind, hash }));
  }

  async readRunState(runId: RunId): Promise<RunState> {
    const states = join(runDir(this.#store, runId), 'state');
    const version = await highestIn(states);
    if (version === null) throw Object.assign(new Error(`LocalVault: no run state for ${runId}`), { code: 'no-run-state' as const, runId }) satisfies NoRunState;
    const file = join(states, `${String(version)}.json`);
    return requireRunState(await readJson(file), file);
  }

  /**
   * Compare-and-swap, arbitrated by the filesystem. The next version's file is
   * created with `wx`, so of any number of writers holding the same
   * `ifVersion` exactly one creates it and the rest are refused with `EEXIST`.
   * There is deliberately no read-then-compare here: that shape loses an
   * update whenever two writers interleave between the read and the write, and
   * it passes a sequential test while doing so.
   *
   * `ifVersion` is authoritative and `s.version` is ignored; the contract left
   * the choice to this unit (D-S1, S1 spec section 2). The precondition below
   * is an extra refusal, not the concurrency control: it rejects a version
   * that never existed, so a caller cannot jump the run forward and leave a
   * hole in its history.
   */
  async commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
    if (!VERSION.test(ifVersion)) {
      throw new Error(`LocalVault: '${ifVersion}' is not a run state version`);
    }
    const states = join(runDir(this.#store, s.runId), 'state');
    const current = Number(ifVersion);
    if (!Number.isSafeInteger(current)) throw new Error(`LocalVault: run state version ${ifVersion} is out of range`);

    const held = await highestIn(states);
    if (current === 0 ? held !== null : held === null || held < current) {
      const at = held === null ? 'no committed state' : `version ${String(held)}`;
      throw new Error(`LocalVault: run ${s.runId} has ${at}, so version ${ifVersion} was never current; nothing stored`);
    }

    const next = String(current + 1);
    const stored: RunState = { ...s, version: next };
    if (!(await createExclusive(join(states, `${next}.json`), encode(stored)))) {
      throw new Error(
        `LocalVault: run ${s.runId} has already moved past version ${ifVersion}; another writer committed ${next} first. ` +
          'Nothing was stored. Re-read the state and commit again.',
      );
    }
    return stored;
  }
}
