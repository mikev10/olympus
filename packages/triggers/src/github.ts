/**
 * GitHub's webhook shapes, read into a kind's schema (D-A-TF-07). This file is
 * the only reader of `UntrustedPayload.raw` in the workspace, through the one
 * cast the cast scan allows (`I7.no-cast-outside-extractor`).
 *
 * The kind is the subscription's, never the unsigned `X-GitHub-Event` header,
 * and a body whose shape is not the kind's is refused. Each kind's time comes
 * from inside the signed body (D-R22-02): a push's `repository.pushed_at`, a
 * Unix integer, and never `head_commit.timestamp`, which whoever pushes sets;
 * a check run's `completed_at`; an issue's `updated_at`. A time missing, of
 * the wrong type, or unparseable is refused, never read as fresh (I5).
 *
 * A delivery that verifies but is not the kind's event — a push to another
 * branch, a check run that passed, an issue closed — is `ignored`: recorded,
 * not refused, and nothing is extracted from it.
 */
import {
  capTrust, checkFields, type AuthorTrust, type FieldDefect, type SchemaKind, type TriggerSubscription,
} from '@olympus-ai/core';
import type { UntrustedPayload, UntrustedText } from './types.js';

export type ExtractOutcome =
  | {
      readonly ok: true;
      readonly kind: SchemaKind;
      /** Checked against the kind's schema by `checkFields`; the caller builds the typed event from it. */
      readonly extracted: Readonly<Record<string, string>>;
      readonly authorTrust: AuthorTrust;
      /** The body's own time, ms since the epoch. */
      readonly signedAt: number;
      /** The commit the event names, for lineage; null for an issue. */
      readonly commit: string | null;
    }
  | { readonly ok: false; readonly outcome: 'ignored'; readonly why: string }
  | { readonly ok: false; readonly outcome: 'refused'; readonly cause: 'schema'; readonly defects: readonly FieldDefect[] }
  | { readonly ok: false; readonly outcome: 'refused'; readonly cause: 'stale'; readonly signedAt: number };

/** Wraps the exact body the route read. The bytes stay opaque to every reader but this file. */
export function untrustedBody(body: Uint8Array, source: string): UntrustedPayload {
  // Casting *to* the opaque handle: the cast scan reports only casts from it.
  return { __brand: 'UntrustedPayload', raw: body as unknown as UntrustedText, source, authorTrust: 'anonymous' };
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const ZERO_SHA = /^0+$/u;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

type Json = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function at(value: unknown, ...path: string[]): unknown {
  let here = value;
  for (const key of path) {
    if (!isObject(here) || !Object.hasOwn(here, key)) return undefined;
    here = here[key];
  }
  return here;
}

const shapeDefect = (field: string): ExtractOutcome => ({ ok: false, outcome: 'refused', cause: 'schema', defects: [{ field, problem: 'missing' }] });

function isoTime(value: unknown): number | undefined {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}

/** GitHub's association, as the four trust levels; anything else, or none, is `anonymous` (D-R22-08). */
function associationTrust(value: unknown): AuthorTrust {
  switch (value) {
    case 'OWNER': return 'owner';
    case 'MEMBER':
    case 'COLLABORATOR': return 'collaborator';
    case 'CONTRIBUTOR':
    case 'FIRST_TIME_CONTRIBUTOR':
    case 'FIRST_TIMER': return 'outside';
    default: return 'anonymous';
  }
}

function signedTime(kind: SchemaKind, body: Json): number | undefined {
  switch (kind) {
    case 'post-merge': {
      const pushed = at(body, 'repository', 'pushed_at');
      return typeof pushed === 'number' && Number.isSafeInteger(pushed) && pushed > 0 ? pushed * 1000 : undefined;
    }
    case 'ci-failure':
      return isoTime(at(body, 'check_run', 'completed_at'));
    case 'issue':
      return isoTime(at(body, 'issue', 'updated_at'));
    case 'scheduled':
      return undefined;
  }
}

/**
 * Reads a verified body for a subscription. `now` is the runtime's clock;
 * a body time further than `maxAgeMs` from it either way is stale.
 */
export function extractGithub(
  subscription: TriggerSubscription, payload: UntrustedPayload, now: number, maxAgeMs: number,
): ExtractOutcome {
  const kind = subscription.kind;
  if (kind !== 'post-merge' && kind !== 'ci-failure' && kind !== 'issue') {
    return { ok: false, outcome: 'refused', cause: 'schema', defects: [{ field: '(kind)', problem: 'unknown' }] };
  }
  // The one read of untrusted bytes (I7): the route wrapped them in `untrustedBody`.
  const bytes = payload.raw as unknown as Uint8Array;
  let body: unknown;
  try {
    body = JSON.parse(decoder.decode(bytes));
  } catch {
    return shapeDefect('(body)');
  }
  if (!isObject(body)) return shapeDefect('(body)');
  const signedAt = signedTime(kind, body);
  if (signedAt === undefined) return shapeDefect('(timestamp)');
  if (Math.abs(now - signedAt) > maxAgeMs) return { ok: false, outcome: 'refused', cause: 'stale', signedAt };

  const repository = at(body, 'repository', 'full_name');
  let fields: Record<string, unknown>;
  let trust: AuthorTrust = 'anonymous';
  let commit: string | null = null;
  switch (kind) {
    case 'post-merge': {
      const ref = at(body, 'ref');
      const branch = at(body, 'repository', 'default_branch');
      const after = at(body, 'after');
      if (typeof ref !== 'string' || typeof branch !== 'string' || typeof after !== 'string') return shapeDefect('ref');
      if (ref !== `refs/heads/${branch}`) return { ok: false, outcome: 'ignored', why: 'a push to a branch other than the default' };
      if (ZERO_SHA.test(after)) return { ok: false, outcome: 'ignored', why: 'a push that deleted the branch' };
      fields = { repository, ref, commit: after };
      commit = after;
      break;
    }
    case 'ci-failure': {
      const action = at(body, 'action');
      const run = at(body, 'check_run');
      if (typeof action !== 'string' || !isObject(run)) return shapeDefect('check_run');
      const conclusion = at(run, 'conclusion');
      if (action !== 'completed') return { ok: false, outcome: 'ignored', why: 'a check run that has not completed' };
      if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped' || conclusion === 'cancelled' || conclusion === 'stale') {
        return { ok: false, outcome: 'ignored', why: 'a check run that did not fail' };
      }
      const sha = at(run, 'head_sha');
      fields = { repository, commit: sha, check: at(run, 'name'), conclusion };
      commit = typeof sha === 'string' ? sha : null;
      break;
    }
    case 'issue': {
      const action = at(body, 'action');
      const issue = at(body, 'issue');
      if (typeof action !== 'string' || !isObject(issue)) return shapeDefect('issue');
      if (action !== 'opened' && action !== 'labeled') return { ok: false, outcome: 'ignored', why: 'an issue event other than opened or labelled' };
      const labels = at(issue, 'labels');
      if (!Array.isArray(labels)) return shapeDefect('labels');
      const names: string[] = [];
      for (const label of labels as readonly unknown[]) {
        const name = at(label, 'name');
        if (typeof name !== 'string') return shapeDefect('labels');
        // Only the subscription's allowlisted labels go further; a label outside it is not extracted, never cleaned.
        if (subscription.labels.includes(name) && !names.includes(name)) names.push(name);
      }
      const number = at(issue, 'number');
      trust = capTrust(associationTrust(at(issue, 'author_association')), subscription.trustCeiling);
      fields = { repository, number: typeof number === 'number' && Number.isSafeInteger(number) ? String(number) : number, labels: names.join(','), authorTrust: trust };
      break;
    }
  }
  const checked = checkFields(kind, fields);
  if (!checked.ok) return { ok: false, outcome: 'refused', cause: 'schema', defects: checked.defects };
  return { ok: true, kind, extracted: checked.fields, authorTrust: capTrust(trust, subscription.trustCeiling), signedAt, commit };
}
