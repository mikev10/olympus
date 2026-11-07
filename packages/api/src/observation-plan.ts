/**
 * The observation plan (R8b, `docs/plan/R8-observe.md`): what a run is
 * observed against once merged. The plan is held to its shape here, at
 * admission for a supplied plan and in the test draft for a drafted one, and
 * judged here at window close against the check runs a provider reported.
 * The runtime judges every signal; nothing a model says decides one (I2).
 */
import type { CheckRef, ObservationPlan } from '@olympus-ai/vault';
import { DRAFT_DIR } from './spec-parts.js';
import type { RequestProblem, RequestProblemCode } from './validate.js';

/** A GitHub App's slug, as the `identifier` class admits it: never a sentence. */
const APP_SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;
// eslint-disable-next-line no-control-regex -- a control character is what this refuses
const CONTROL = /[\u0000-\u001f\u007f]/u;
const MAX_CHECKS = 50;
const MAX_NAME_BYTES = 255;
const MAX_CONSECUTIVE = 100;

/** The conclusions R22 counts as a failure (`core/src/trigger/schemas.ts`, `failure-conclusion`). */
export const FAILING_CONCLUSIONS: ReadonlySet<string> = new Set(['failure', 'timed_out', 'action_required', 'startup_failure']);

/** A plan problem is a request problem: admission reports it as one, and a draft records its path and code. */
export type PlanProblem = RequestProblem;

export type ParsedPlan = { readonly ok: true; readonly plan: ObservationPlan } | { readonly ok: false; readonly problems: readonly PlanProblem[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The plan's own shape, whole (D-A-OB-11). `at` prefixes each problem's path. */
export function parsePlan(json: unknown, at: string): ParsedPlan {
  const problems: PlanProblem[] = [];
  const report = (path: string, code: RequestProblemCode, message: string): void => {
    problems.push({ path, code, message });
  };
  if (!isObject(json)) return { ok: false, problems: [{ path: at, code: 'invalid-plan', message: `${at}: the plan is a JSON object` }] };
  for (const key of Object.keys(json)) if (key !== 'works' && key !== 'regressed' && key !== 'rollback') report(`${at}.${key}`, 'not-applicable', `${at}.${key}: a plan holds works, regressed, and rollback alone`);
  const list = (key: 'works' | 'regressed'): CheckRef[] => {
    const value = json[key];
    const path = `${at}.${key}`;
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHECKS) {
      report(path, 'invalid-plan', `${path}: between 1 and ${String(MAX_CHECKS)} checks`);
      return [];
    }
    const out: CheckRef[] = [];
    (value as readonly unknown[]).forEach((item, i) => {
      const here = `${path}[${String(i)}]`;
      if (!isObject(item) || Object.keys(item).some((k) => k !== 'app' && k !== 'name')) {
        report(here, 'invalid-plan', `${here}: a check is { "app", "name" }`);
        return;
      }
      const { app, name } = item;
      if (typeof app !== 'string' || app.length > 100 || !APP_SLUG.test(app)) report(`${here}.app`, 'invalid-plan', `${here}.app: the producing app's slug, lowercase letters, digits, and dashes`);
      if (typeof name !== 'string' || name === '' || Buffer.byteLength(name) > MAX_NAME_BYTES || CONTROL.test(name)) {
        report(`${here}.name`, 'invalid-plan', `${here}.name: the check run's exact name, 1 to ${String(MAX_NAME_BYTES)} bytes, with no control characters`);
      }
      if (typeof app !== 'string' || typeof name !== 'string') return;
      if (out.some((c) => c.app === app && c.name === name)) report(here, 'duplicate', `${here}: the same check twice`);
      else out.push({ app, name });
    });
    return out;
  };
  const works = list('works');
  const regressed = list('regressed');
  const rollback = json.rollback;
  let indices: number[] = [];
  let consecutive = 0;
  if (!isObject(rollback) || Object.keys(rollback).some((k) => k !== 'regressed' && k !== 'consecutive')) {
    report(`${at}.rollback`, 'invalid-plan', `${at}.rollback: { "regressed": [index, ...], "consecutive": n }`);
  } else {
    const r = rollback.regressed;
    if (!Array.isArray(r) || r.length === 0) report(`${at}.rollback.regressed`, 'invalid-plan', `${at}.rollback.regressed: at least one index into regressed`);
    else {
      (r as readonly unknown[]).forEach((v, i) => {
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v >= regressed.length) report(`${at}.rollback.regressed[${String(i)}]`, 'invalid-plan', `${at}.rollback.regressed[${String(i)}]: an index into regressed`);
        else if (indices.includes(v)) report(`${at}.rollback.regressed[${String(i)}]`, 'duplicate', `${at}.rollback.regressed[${String(i)}]: the same index twice`);
        else indices.push(v);
      });
    }
    const c = rollback.consecutive;
    if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 1 || c > MAX_CONSECUTIVE) report(`${at}.rollback.consecutive`, 'invalid-plan', `${at}.rollback.consecutive: a whole number of commits, 1 to ${String(MAX_CONSECUTIVE)}`);
    else consecutive = c;
  }
  if (problems.length > 0) return { ok: false, problems };
  indices = [...indices].sort((a, b) => a - b);
  return { ok: true, plan: { works, regressed, rollback: { regressed: indices, consecutive } } };
}

/** A check run as a provider reported it. `name` is the provider's text: compared, never stored or prompted (D-A-OB-10, I7). */
export interface CheckRun {
  readonly id: string;
  readonly app: string | null;
  readonly name: string;
  readonly headSha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly completedAt: string | null;
}

/**
 * What lists the check runs on a commit (R8b, D-A-OB-09). Host-side, beside
 * `Integrator`, with a read-only token of its own; never in a sandbox and
 * never in the core (D-A-BR-04). It throws on anything it cannot read whole:
 * an unreadable provider is a refusal, never an empty list (I5, D-A-OB-14).
 */
export interface CheckReader {
  checkRuns(commit: string): Promise<readonly CheckRun[]>;
}

/** The run of `check` that decides it on one commit: the latest completed, by `completed_at`, then id. */
export function decidingRun(runs: readonly CheckRun[], check: CheckRef): CheckRun | null {
  let best: CheckRun | null = null;
  for (const run of runs) {
    // Byte-for-byte: a name differing by case or whitespace is another check, and so is another app's (D-A-OB-10).
    if (run.app !== check.app || run.name !== check.name || run.status !== 'completed' || run.completedAt === null) continue;
    if (best === null) best = run;
    else {
      const order = run.completedAt.localeCompare(best.completedAt ?? '');
      if (order > 0 || (order === 0 && BigInt(run.id) > BigInt(best.id))) best = run;
    }
  }
  return best;
}

export type Verdict = 'working' | 'regressed' | 'missing';

/** One planned check, judged (D-A-OB-11). `commit` is where it was decided; `run` is null for a missing check. */
export interface JudgedCheck {
  readonly role: 'works' | 'regressed';
  readonly check: CheckRef;
  readonly status: Verdict;
  readonly commit: string;
  readonly run: CheckRun | null;
}

export interface Judged {
  readonly checks: readonly JudgedCheck[];
  /** The commits on which every check the rollback condition names failed, consecutively; null when it was not met. */
  readonly rollback: { readonly checks: readonly CheckRef[]; readonly commits: readonly string[] } | null;
}

function verdictOf(run: CheckRun | null): Verdict {
  if (run === null) return 'missing';
  if (run.conclusion === 'success') return 'working';
  return run.conclusion !== null && FAILING_CONCLUSIONS.has(run.conclusion) ? 'regressed' : 'missing';
}

/**
 * The plan judged over a change's first-parent commits, merge commit first,
 * each with the check runs the provider reported on it (D-A-OB-11). A works
 * check is judged on the merge commit alone. A regressed check is regressed
 * where any commit's deciding run failed, working where none did and one
 * succeeded, and missing otherwise: neutral, skipped, cancelled, and no run
 * at all are never read as working.
 */
export function judgePlan(plan: ObservationPlan, commits: ReadonlyArray<{ readonly commit: string; readonly runs: readonly CheckRun[] }>): Judged {
  const merge = commits[0];
  if (merge === undefined) throw new Error('observe: a plan is judged over at least its merge commit');
  const checks: JudgedCheck[] = [];
  for (const check of plan.works) {
    const run = decidingRun(merge.runs, check);
    checks.push({ role: 'works', check, status: verdictOf(run), commit: merge.commit, run: verdictOf(run) === 'missing' ? null : run });
  }
  for (const check of plan.regressed) {
    let first: { commit: string; run: CheckRun; status: Verdict } | null = null;
    let failed: { commit: string; run: CheckRun } | null = null;
    for (const c of commits) {
      const run = decidingRun(c.runs, check);
      const status = verdictOf(run);
      if (run === null || status === 'missing') continue;
      if (status === 'regressed') {
        failed = { commit: c.commit, run };
        break;
      }
      first ??= { commit: c.commit, run, status };
    }
    if (failed !== null) checks.push({ role: 'regressed', check, status: 'regressed', commit: failed.commit, run: failed.run });
    else if (first !== null) checks.push({ role: 'regressed', check, status: 'working', commit: first.commit, run: first.run });
    else checks.push({ role: 'regressed', check, status: 'missing', commit: merge.commit, run: null });
  }
  const named = plan.rollback.regressed.map((i) => plan.regressed[i]).filter((c): c is CheckRef => c !== undefined);
  let streak: string[] = [];
  let rollback: Judged['rollback'] = null;
  for (const c of commits) {
    const all = named.every((check) => verdictOf(decidingRun(c.runs, check)) === 'regressed');
    streak = all ? [...streak, c.commit] : [];
    if (streak.length >= plan.rollback.consecutive) {
      rollback = { checks: named, commits: streak };
      break;
    }
  }
  return { checks, rollback };
}

/** Where a drafted plan is written, beside the drafted acceptance manifest (R8b, D-R8b-01). */
export function planDraftPath(runId: string): string {
  return `${DRAFT_DIR}/${runId}/observation.json`;
}
