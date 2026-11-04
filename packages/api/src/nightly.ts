/**
 * The nightly jobs that call no model (R13a). A schedule that names a job
 * template runs one of them in place of recording a candidate; each writes
 * one `NightlyRecord` beside the runs, and each reads the schedule's id from
 * the event and nothing else (A-R13a-01).
 *
 * - `nightly-integrity` re-hashes every object the store holds, checks every
 *   ref a run's state names, verifies the locks of a run still in flight, and
 *   checks R2's rates against the last snapshot (D-A-NR-03, D-A-NR-07).
 * - `nightly-security` runs R17's scanners over the head of the target's
 *   default branch under `deny-all`, and audits its lockfile in a separate
 *   sandbox granted the advisory host alone (D-A-NR-04, D-R13a-04).
 *
 * A part that cannot finish is a refusal, with its findings so far kept
 * beside it, and never "nothing found" (I5). A finding becomes an `intake`
 * candidate carrying its scanner, rule, path, and line, which a person admits
 * like any other; no job opens a change, drafts a fix, or narrows a grant
 * (D-A-SC-03, I2). Every field written is the runtime's.
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { AUDITORS, UNSUPPORTED_LOCKFILES, type AuditFinding, type DependencyAuditor } from '@olympus-ai/adapters';
import { checkFields, type JobTemplateId, type NightlyScanner, type Policy, type RunId, type RunState, type TriggerSchedule, type VaultRef } from '@olympus-ai/core';
import type { Finding, SecurityCheckSpec } from '@olympus-ai/integrity';
import { materialize, resolveCommit } from '@olympus-ai/readiness';
import type { EgressLog, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import {
  isNoRunState, type IntegrityCoverage, type NightlyEntry, type NightlyFinding, type NightlyRecord, type NightlyRefusal,
  type RateSnapshot, type RecordDriftProblem, type SecurityCoverage, type Vault,
} from '@olympus-ai/vault';
import type { Intake } from './intake.js';
import { deriveOutcomes, readRunRecords, type RunEnding, type RunRecords } from './outcomes.js';
import { scanTree } from './scan.js';
import { scannerFor, type SecurityScanners } from './security.js';
import type { WorkspaceStore } from './workspace.js';

/** The checkout the sweep reads and the branch runs merge into: the target's default branch (D-R13a-04). */
export interface NightlyTarget {
  readonly checkout: string;
  readonly branch: string;
}

export interface NightlyOptions {
  readonly vault: Vault;
  readonly sandbox: SandboxProvider;
  readonly workspaces: WorkspaceStore;
  /** The host profile's limits, or null for a sandbox that runs no image. */
  readonly limits: Readonly<Omit<SandboxSpec['limits'], 'wallClockMs'>> | null;
  readonly scanners: SecurityScanners;
  /** Null on a host with no target, where `nightly-security` is refused `no-target`. */
  readonly target: NightlyTarget | null;
  readonly auditors?: readonly DependencyAuditor[];
  readonly now?: () => number;
}

/** Endings no later step changes: a snapshot covers these runs alone (D-R13a-03). */
export const SETTLED: ReadonlySet<RunEnding> = new Set<RunEnding>(['refused', 'merged', 'cancelled']);

/** A finding's fingerprint is the runtime's SHA-256, hex; nothing else is a key (codex-3). */
const FINGERPRINT = /^[0-9a-f]{64}$/u;

/** How long one scan or the audit may run. */
export const NIGHTLY_STEP_TIMEOUT_MS = 15 * 60_000;

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/** Every leaf of a JSON value, by its dotted path, as JSON: two snapshots compare figure by figure. */
export function flattenFigures(value: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (value !== null && typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) out[prefix] = JSON.stringify(value);
    for (const [key, child] of entries) flattenFigures(child, prefix === '' ? key : `${prefix}.${key}`, out);
    return out;
  }
  out[prefix] = value === undefined ? 'undefined' : JSON.stringify(value);
  return out;
}

/** Every ref a run's state names, each with the path it is stored under. */
function refsOf(state: RunState): VaultRef[] {
  const refs: VaultRef[] = [state.admission, ...Object.values(state.results), ...state.evidenceRefs, ...state.violations, ...state.usage];
  for (const draft of Object.values(state.drafts)) {
    for (const attempt of draft.attempts) {
      if (attempt.draft !== null) refs.push(attempt.draft);
      if (attempt.critic !== null && attempt.critic !== 'not-seated') refs.push(attempt.critic);
      if (attempt.baseRun !== null) refs.push(attempt.baseRun);
    }
    if (draft.locked !== null) refs.push(draft.locked);
  }
  return refs;
}

function pathOf(ref: VaultRef): string {
  return ref.kind === 'admission' ? `runs/${ref.runId}/admission.json` : `runs/${ref.runId}/objects/${ref.kind}/${ref.hash}.json`;
}

/** A refused-delivery count is rewritten while its hour is open: one for the hour the last night started in, or later, may still move. */
function stillOpen(path: string, priorStartedAt: string): boolean {
  const hour = /^intake\/counts\/([^/]+)\//u.exec(path)?.[1];
  return hour !== undefined && hour >= priorStartedAt.slice(0, 13);
}

type Drift = Extract<NightlyFinding, { kind: 'record-drift' }>;

function drift(runId: RunId | null, record: string, problem: RecordDriftProblem, expected: string, observed: string): Drift {
  return { kind: 'record-drift', runId, record, problem, expected, observed };
}

/** The refusals as the record's tuple, or null where there are none. */
function refusedWith(refusals: readonly NightlyRefusal[]): NightlyRecord['outcome'] {
  const [first, ...rest] = refusals;
  return first === undefined ? { kind: 'completed' } : { kind: 'refused', refusals: [first, ...rest] };
}

export class NightlyJobs {
  readonly #options: NightlyOptions;
  readonly #now: () => number;

  constructor(options: NightlyOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** Runs the schedule's job for `date` and writes its record; returns the record and its hash. */
  async run(policy: Policy, schedule: TriggerSchedule & { readonly template: JobTemplateId }, date: string, intake: Intake): Promise<{ record: NightlyRecord; sha256: string }> {
    const startedAt = new Date(this.#now()).toISOString();
    let part: Part;
    try {
      part = schedule.template === 'nightly-integrity'
        ? await this.#integrity(schedule, date)
        : await this.#security(policy, schedule, date, intake);
    } catch (error) {
      // A failure no part caught still writes the record, refused, so the firing is never left without one (codex-5).
      part = { findings: [], refusals: [{ part: 'job', cause: 'job-failed', detail: describe(error) }], integrity: null, security: null };
    }
    const record: NightlyRecord = {
      schedule: schedule.id, template: schedule.template, date, startedAt, endedAt: new Date(this.#now()).toISOString(),
      outcome: refusedWith(part.refusals), findings: part.findings,
      integrity: part.integrity, security: part.security, collectedBy: 'runtime',
    };
    return { record, sha256: await this.#options.vault.recordNightly(record) };
  }

  async #integrity(schedule: TriggerSchedule, date: string): Promise<Part> {
    const { vault } = this.#options;
    const findings: NightlyFinding[] = [];
    const refusals: NightlyRefusal[] = [];
    let prior: NightlyEntry | undefined;
    try {
      prior = [...(await vault.readNightly())]
        .filter((e) => e.record.schedule === schedule.id && e.record.integrity !== null && e.record.date < date)
        .at(-1);
    } catch (error) {
      refusals.push({ part: 'store', cause: 'store-unreadable', detail: `the nightly records could not be read: ${describe(error)}` });
    }
    // Each earlier firing names the record its job wrote. A baseline no firing names was not written by this job (codex-4, gemini-2).
    const named = new Map<string, string>();
    for (const entry of await vault.readTriggerDecisions()) {
      const { source, key, outcome } = entry.decision;
      if (source === `schedule:${schedule.id}` && outcome.kind === 'job') named.set(key, outcome.nightly);
    }
    if (prior !== undefined && named.get(prior.record.date) !== prior.sha256) {
      findings.push(drift(null, `nightly/${prior.sha256}.json`, 'changed-since-snapshot', named.get(prior.record.date) ?? 'unnamed', prior.sha256));
      refusals.push({ part: 'store', cause: 'baseline-unrecorded', detail: `the record for ${prior.record.date} is not the one that night's firing names, so nothing is compared against it` });
      prior = undefined;
    }

    // Re-hash: the store names every object, and each content-addressed one is checked against its name.
    const hashes: Record<string, string> = {};
    let objects = 0;
    let storeRead = true;
    try {
      for await (const object of vault.listObjects()) {
        objects += 1;
        const observed = sha256(object.bytes);
        hashes[object.path] = observed;
        if (object.named === 'content') {
          const expected = /([0-9a-f]{64})\.json$/u.exec(object.path)?.[1] ?? '';
          if (observed !== expected) findings.push(drift(object.runId, object.path, 'hash-mismatch', expected, observed));
        }
      }
    } catch (error) {
      storeRead = false;
      refusals.push({ part: 'store', cause: 'store-unreadable', detail: describe(error) });
    }

    // Every record a firing names is still held.
    if (storeRead) {
      for (const [day, hash] of named) {
        if (hashes[`nightly/${hash}.json`] === undefined) findings.push(drift(null, `nightly/${hash}.json`, 'missing', hash, `missing (named by the firing of ${day})`));
      }
    }

    // Against the last night: a record that changed or went missing since it was hashed.
    const priorCoverage = prior?.record.integrity ?? null;
    if (storeRead && prior !== undefined && priorCoverage !== null) {
      for (const [path, expected] of Object.entries(priorCoverage.hashes)) {
        if (stillOpen(path, prior.record.startedAt)) continue;
        const observed = hashes[path];
        const runId = /^runs\/([^/]+)\//u.exec(path)?.[1] as RunId | undefined;
        if (observed === undefined) findings.push(drift(runId ?? null, path, 'missing', expected, 'missing'));
        else if (observed !== expected) findings.push(drift(runId ?? null, path, 'changed-since-snapshot', expected, observed));
      }
    }

    // Refs, locks, and rates, run by run.
    const records = new Map<RunId, RunRecords>();
    let ratesRead = true;
    for (const runId of await vault.listRuns()) {
      let state: RunState | null = null;
      try {
        state = await vault.readRunState(runId);
      } catch (error) {
        if (!isNoRunState(error)) {
          refusals.push({ part: 'store', cause: 'store-unreadable', detail: `run ${runId}: ${describe(error)}` });
          continue;
        }
      }
      if (storeRead && state !== null) {
        for (const ref of refsOf(state)) {
          const path = pathOf(ref);
          const observed = hashes[path] ?? (ref.kind === 'base-run' ? hashes[`runs/${runId}/base-run.json`] : undefined);
          if (observed === undefined) findings.push(drift(runId, path, 'missing', ref.hash, 'missing'));
          else if (observed !== ref.hash) findings.push(drift(runId, path, 'hash-mismatch', ref.hash, observed));
        }
      }
      let run: RunRecords;
      try {
        run = await readRunRecords(vault, runId);
      } catch (error) {
        ratesRead = false;
        refusals.push({ part: 'rates', cause: 'rates-unreadable', detail: `run ${runId}: ${describe(error)}` });
        continue;
      }
      records.set(runId, run);
      // A lock governs only while its run can still move; a settled run's artifacts may be edited for the next (D-R13a-05).
      if (SETTLED.has(run.ending)) continue;
      try {
        if ((await vault.readLocks(runId)) === null) continue;
        const verdict = await vault.verifyLocks(runId);
        if (!verdict.ok) for (const t of verdict.tampered) findings.push(drift(runId, `runs/${runId}/locks: ${t.path}`, 'lock-unverified', t.expected, t.actual));
      } catch (error) {
        refusals.push({ part: 'locks', cause: 'locks-unreadable', detail: `run ${runId}: ${describe(error)}` });
      }
    }

    // Rates: the last snapshot's runs, derived again from the records as they now stand (D-A-NR-03).
    let rates: RateSnapshot | null = null;
    if (ratesRead) {
      const priorRates = priorCoverage?.rates ?? null;
      if (priorRates !== null) {
        const again: RunRecords[] = [];
        for (const runId of priorRates.runs) {
          const run = records.get(runId);
          if (run === undefined) findings.push({ kind: 'rate-drift', rate: `runs.${runId}`, snapshot: '"settled"', observed: 'absent' });
          else {
            if (!SETTLED.has(run.ending)) findings.push({ kind: 'rate-drift', rate: `runs.${runId}`, snapshot: '"settled"', observed: JSON.stringify(run.ending) });
            again.push(run);
          }
        }
        const figures = flattenFigures(deriveOutcomes(again));
        for (const rate of new Set([...Object.keys(priorRates.figures), ...Object.keys(figures)])) {
          const before = priorRates.figures[rate] ?? 'absent';
          const now = figures[rate] ?? 'absent';
          if (before !== now) findings.push({ kind: 'rate-drift', rate, snapshot: before, observed: now });
        }
      }
      const settled = [...records.values()].filter((r) => SETTLED.has(r.ending));
      rates = { runs: settled.map((r) => r.runId).sort(), figures: flattenFigures(deriveOutcomes(settled)) };
    }

    // Drift that names a run is also in that run's P14 record (A-R13a-04).
    for (const finding of findings) {
      if (finding.kind !== 'record-drift' || finding.runId === null) continue;
      await vault.recordDecision({
        runId: finding.runId, taskId: null, station: null, decidedAt: new Date(this.#now()).toISOString(), occurrence: randomUUID(),
        decision: { cause: 'record-drift', decidedBy: 'nightly', record: finding.record, problem: finding.problem, expected: finding.expected, observed: finding.observed },
        collectedBy: 'runtime',
      });
    }

    const integrity: IntegrityCoverage = {
      objects, hashes, comparedWith: prior === undefined ? 'none' : { record: prior.sha256 }, rates,
    };
    return { findings, refusals, integrity, security: null };
  }

  async #security(policy: Policy, schedule: TriggerSchedule, date: string, intake: Intake): Promise<Part> {
    const { target } = this.#options;
    const findings: NightlyFinding[] = [];
    const refusals: NightlyRefusal[] = [];
    const nightly = policy.triggers.nightly;
    const egress: Array<SecurityCoverage['egress'][number]> = [];
    const coverage = (commit: { branch: string; commit: string } | null, ran: SecurityCoverage['ran'], audited: SecurityCoverage['audited']): SecurityCoverage => ({ target: commit, ran, audited, egress });
    if (nightly === undefined) {
      refusals.push({ part: 'policy', cause: 'no-policy', detail: 'the policy names no nightly block, so no scanner or advisory host is granted' });
      return { findings, refusals, integrity: null, security: coverage(null, [], null) };
    }
    if (target === null) {
      refusals.push({ part: 'target', cause: 'no-target', detail: 'this host names no default branch to scan' });
      return { findings, refusals, integrity: null, security: coverage(null, [], null) };
    }
    const dir = join(this.#options.workspaces.root, 'nightly', `${schedule.id}-${date}-${randomUUID()}`);
    const tree = join(dir, 'tree');
    const ran: Array<SecurityCoverage['ran'][number]> = [];
    let commit: string;
    let files: readonly string[];
    try {
      commit = await resolveCommit(target.checkout, `refs/heads/${target.branch}`);
      await mkdir(tree, { recursive: true });
      files = (await materialize(target.checkout, commit, tree)).files;
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      refusals.push({ part: 'target', cause: 'target-unreadable', detail: describe(error) });
      return { findings, refusals, integrity: null, security: coverage(null, [], null) };
    }
    const where = { branch: target.branch, commit };
    let audited: SecurityCoverage['audited'] = null;
    try {
      for (const [index, selected] of nightly.scanners.entries()) {
        const outcome = await this.#scan(tree, join(dir, `scan-${String(index)}`), selected);
        if (outcome.egress !== null) egress.push({ part: selected.kind, log: outcome.egress });
        if (!outcome.ok) {
          refusals.push({ part: selected.kind, cause: 'scan-failed', detail: outcome.reason });
          continue;
        }
        ran.push(selected.kind);
        for (const f of outcome.findings) {
          findings.push(await this.#finding(intake, policy, schedule, date, selected.kind, f.rule, f.location.path, f.location.line, f.fingerprint));
        }
      }
      const audit = await this.#audit(tree, files, join(dir, 'audit'), nightly.advisoryHost);
      if (audit.egress !== null) egress.push({ part: 'dependency-audit', log: audit.egress });
      if (!audit.ok) refusals.push({ part: 'dependency-audit', cause: audit.cause, detail: audit.detail });
      else {
        ran.push('dependency-audit');
        audited = { lockfile: audit.auditor.lockfile, stack: audit.auditor.stack };
        for (const f of audit.findings) {
          findings.push(await this.#finding(intake, policy, schedule, date, 'dependency-audit', f.rule, audit.auditor.lockfile, f.line, f.fingerprint));
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return { findings, refusals, integrity: null, security: coverage(where, ran, audited) };
  }

  /** One R17 scanner over the tree, as `verify` runs it: a copy, `deny-all`, the pinned image, the tree the only data mount. */
  async #scan(
    tree: string, scratch: string, selected: NightlyScanner,
  ): Promise<({ ok: true; findings: readonly Finding[] } | { ok: false; reason: string }) & { egress: EgressLog | null }> {
    const scanner = scannerFor(selected.kind, this.#options.scanners);
    const check: SecurityCheckSpec = { id: `nightly-${selected.kind}`, kind: selected.kind, required: true, timeoutMs: NIGHTLY_STEP_TIMEOUT_MS, image: scanner.image, config: selected.config };
    const scanned = await scanTree({
      sandbox: this.#options.sandbox, tree, scratch: { dir: scratch, tree: join(scratch, 'tree'), config: join(scratch, 'config') },
      check, scanner, limits: this.#options.limits, user: this.#options.workspaces.user,
    });
    if (!scanned.ok) return { ok: false, reason: scanned.reason, egress: scanned.at === 'exec' ? scanned.egress : null };
    if (scanned.result.findings === null) return { ok: false, reason: `the scanner exited ${String(scanned.result.exitCode)} without a whole report`, egress: scanned.egress };
    return { ok: true, findings: scanned.result.findings, egress: scanned.egress };
  }

  /** The lockfile's audit in its own sandbox: the manifest and lockfile alone, read-only, egress to the advisory host alone (D-R13a-06). */
  async #audit(
    tree: string, files: readonly string[], scratch: string, advisoryHost: string,
  ): Promise<({ ok: true; auditor: DependencyAuditor; findings: readonly AuditFinding[] } | { ok: false; cause: NightlyRefusal['cause']; detail: string }) & { egress: EgressLog | null }> {
    const root = new Set(files.filter((f) => !f.includes('/')));
    const auditors = this.#options.auditors ?? AUDITORS;
    const lockfiles = [...auditors.map((a) => a.lockfile), ...UNSUPPORTED_LOCKFILES].filter((name) => root.has(name));
    // Lockfiles of two stacks: auditing whichever is listed first would leave the other unaudited (gemini-3).
    if (lockfiles.length > 1) return { ok: false, cause: 'unsupported-stack', detail: `the default branch holds ${lockfiles.join(' and ')}; which stack it uses is not decided`, egress: null };
    const auditor = auditors.find((a) => root.has(a.lockfile));
    if (auditor === undefined) {
      const other = UNSUPPORTED_LOCKFILES.find((name) => root.has(name));
      return other === undefined
        ? { ok: false, cause: 'no-lockfile', detail: 'the default branch holds no lockfile at its root', egress: null }
        : { ok: false, cause: 'unsupported-stack', detail: `${other} is a lockfile no audit covers`, egress: null };
    }
    await mkdir(scratch, { recursive: true });
    for (const name of auditor.files) if (root.has(name)) await copyFile(join(tree, name), join(scratch, name));
    const lockfileText = await readFile(join(scratch, auditor.lockfile), 'utf8');
    const spec: SandboxSpec = {
      image: auditor.image,
      mounts: { workspace: { source: scratch, target: '/workspace', mode: 'ro' }, others: [] },
      egress: { mode: 'allowlist', allow: [advisoryHost] },
      limits: this.#options.limits === null ? { cpus: 0, memoryMb: 0, pids: 0, wallClockMs: NIGHTLY_STEP_TIMEOUT_MS } : { ...this.#options.limits, wallClockMs: NIGHTLY_STEP_TIMEOUT_MS },
      user: { ...this.#options.workspaces.user },
    };
    let handle: SandboxHandle;
    try {
      handle = await this.#options.sandbox.provision(spec);
    } catch (error) {
      return { ok: false, cause: 'audit-failed', detail: `its sandbox could not be provisioned: ${describe(error)}`, egress: null };
    }
    let outcome: { ok: true; auditor: DependencyAuditor; findings: readonly AuditFinding[] } | { ok: false; cause: NightlyRefusal['cause']; detail: string };
    let egress: EgressLog;
    try {
      const exec = await this.#options.sandbox.exec(handle, [...auditor.invocation], { env: { HOME: '/tmp', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' } });
      const parsed = auditor.parse(exec.stdout, exec.exitCode, lockfileText);
      if (parsed.ok) outcome = { ok: true, auditor, findings: parsed.findings };
      else {
        outcome = parsed.unreachable
          ? { ok: false, cause: 'advisory-unreachable', detail: `the audit could not reach ${advisoryHost} (exit ${String(exec.exitCode)})` }
          : { ok: false, cause: 'audit-failed', detail: `the audit exited ${String(exec.exitCode)} without a whole report` };
      }
    } catch (error) {
      outcome = { ok: false, cause: 'audit-failed', detail: describe(error) };
    } finally {
      // Read after the audit whatever it did, so the record holds what the proxy decided (D-P14-04).
      ({ egress } = await this.#options.sandbox.destroy(handle));
    }
    // A report counts only where the proxy saw the advisory host reached; a grant is permission, not contact (codex-2).
    const reached = egress.kind === 'proxied' && egress.connections.some((c) => c.verdict !== 'refused' && c.host === advisoryHost);
    if (outcome.ok && !reached) {
      return { ok: false, cause: 'advisory-unreachable', detail: `the audit's proxy recorded no connection to ${advisoryHost}`, egress };
    }
    return { ...outcome, egress };
  }

  /** A finding, with the candidate it became or why it became none (D-R13a-07). */
  async #finding(
    intake: Intake, policy: Policy, schedule: TriggerSchedule, date: string,
    scanner: SecurityCoverage['ran'][number], rule: string, path: string, line: number | null, fingerprint: string,
  ): Promise<NightlyFinding> {
    // Checked before any record holds them: an unlocated finding is checked with a stand-in line, which is not kept.
    const checked = checkFields('nightly-finding', { scanner, rule, path, line: String(line ?? 1) });
    if (!checked.ok) return { kind: 'security-unrecordable', scanner, defects: checked.defects };
    if (!FINGERPRINT.test(fingerprint)) return { kind: 'security-unrecordable', scanner, defects: [{ field: 'fingerprint', problem: 'out-of-class' }] };
    const candidate = line === null
      ? { none: 'unlocated' as const }
      : await intake.recordFinding(policy, schedule, `${date}:${scanner}:${fingerprint}`, { scanner, rule, path, line: String(line) });
    return { kind: 'security', scanner, rule, path, line, fingerprint, candidate };
  }
}

interface Part {
  readonly findings: NightlyFinding[];
  readonly refusals: NightlyRefusal[];
  readonly integrity: IntegrityCoverage | null;
  readonly security: SecurityCoverage | null;
}
