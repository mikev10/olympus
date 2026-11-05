/**
 * The closed template registry and the per-kind field schemas (R22,
 * D-A-TF-01, D-A-TF-04, D-R22-05).
 *
 * I7: an event's payload is data. A trigger selects a template from this
 * registry, never one the payload names, and only fields a kind's schema
 * declares leave the extractor. Each field has a byte cap and a character
 * class, checked whole; a value outside either refuses the event and is never
 * truncated or cleaned to fit. No schema has a field for free text — no
 * title, body, comment, commit message, or log.
 *
 * They live in core, not in `triggers`, because the policy validator reads
 * them and core cannot import a package that depends on it. Schemas are code,
 * not policy: a policy-declared schema could widen a field to carry free text
 * by one edit, and this file changes only through a reviewed pull request.
 */
import type { AuthorTrust, TriggerKind } from '../run/types.js';

/**
 * What an admitted event does. `intake-candidate` records the event in the
 * Vault for a person to read; nothing runs. A job template takes the
 * schedule's id as its only input, seats no model, and never enters the
 * build: `nightly-integrity` re-hashes the Vault and checks R2's rates,
 * `nightly-security` scans the default branch and audits its lockfile
 * (R13a, A-R13a-01). Two jobs seat a read-only reviewer and never enter the
 * build either: `nightly-findings-review` reviews a day of the runtime's
 * records as typed fields, and `nightly-tree-review` reviews the default
 * branch's tree (R13b, A-R13b-01). A job template is valid only on
 * `scheduled`. No template starts a build (D-A-TF-01).
 */
export type TemplateId = 'intake-candidate' | JobTemplateId;

/** The templates that run a job in place of recording a candidate (A-R13a-01). */
export type JobTemplateId = 'nightly-integrity' | 'nightly-security' | ReviewJobTemplateId;

/** The job templates that seat a reviewer (A-R13b-01). */
export type ReviewJobTemplateId = 'nightly-findings-review' | 'nightly-tree-review';

const JOB_TEMPLATE_SET: Readonly<Record<JobTemplateId, true>> = {
  'nightly-integrity': true, 'nightly-security': true, 'nightly-findings-review': true, 'nightly-tree-review': true,
};
const TEMPLATE_SET: Readonly<Record<TemplateId, true>> = { 'intake-candidate': true, ...JOB_TEMPLATE_SET };
const REVIEW_TEMPLATE_SET: Readonly<Record<ReviewJobTemplateId, true>> = { 'nightly-findings-review': true, 'nightly-tree-review': true };

export function isReviewJobTemplate(value: unknown): value is ReviewJobTemplateId {
  return typeof value === 'string' && Object.hasOwn(REVIEW_TEMPLATE_SET, value);
}

export function isJobTemplate(value: unknown): value is JobTemplateId {
  return typeof value === 'string' && Object.hasOwn(JOB_TEMPLATE_SET, value);
}

export const TEMPLATE_IDS: readonly TemplateId[] = Object.freeze(Object.keys(TEMPLATE_SET).filter(isTemplateId));

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && Object.hasOwn(TEMPLATE_SET, value);
}

/** A whole-tree finding's category: what it makes vulnerable, or what it makes reachable that need not be (R9's role). */
export const TREE_CATEGORIES = Object.freeze([
  'unchecked-input', 'exposed-secret', 'unenforced-authorization', 'weakened-check',
  'reachable-before-authentication', 'unnamed-surface', 'unsafe-default', 'weakening-combination',
] as const);
export type TreeCategory = (typeof TREE_CATEGORIES)[number];

/** A findings-review finding's category: what the day's records show. */
export const RECORD_CATEGORIES = Object.freeze([
  'repeated-refusal', 'repeated-park', 'violation', 'failed-check', 'record-drift', 'refused-deliveries', 'security-finding', 'control-gap',
] as const);
export type RecordCategory = (typeof RECORD_CATEGORIES)[number];

/**
 * The character classes a field may be in. Each is anchored and admits no
 * whitespace, so no field can hold a sentence. A failed check is named by
 * its run's id, never by its name, which is text a repository's CI
 * configuration chose (D-R22-11).
 */
export type CharClass =
  | 'identifier' | 'repository' | 'branch-ref' | 'commit-sha'
  | 'failure-conclusion' | 'decimal' | 'label-list' | 'author-trust'
  | 'nightly-scanner' | 'finding-rule' | 'tree-path' | 'tree-category' | 'record-category' | 'day-record';

export const CHAR_CLASSES: Readonly<Record<CharClass, RegExp>> = Object.freeze({
  identifier: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u,
  repository: /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u,
  // A branch, never a tag; no `..`, no component starting with a dot.
  'branch-ref': /^refs\/heads\/(?!.*\.\.)(?!.*\/\.)(?!\.)[A-Za-z0-9._/-]+$/u,
  'commit-sha': /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
  'failure-conclusion': /^(?:failure|timed_out|action_required|startup_failure)$/u,
  decimal: /^[1-9][0-9]{0,18}$/u,
  // Labels from the subscription's allowlist, comma-joined; empty when none matched.
  'label-list': /^(?:[A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+)*)?$/u,
  'author-trust': /^(?:owner|collaborator|outside|anonymous)$/u,
  'nightly-scanner': /^(?:secret-scan|static-analysis|dependency-audit)$/u,
  // A scanner's rule id or an advisory's GHSA id: dotted, dashed, coloned, never a sentence.
  'finding-rule': /^[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?$/u,
  // Relative to the tree, forward slashes, no `..` component, no leading slash or dot-slash, no whitespace.
  'tree-path': /^(?!\/)(?!\.\/)(?!(?:.*\/)?\.\.(?:\/|$))[A-Za-z0-9._@+=,~/-]+$/u,
  // The questions R9's security reviewer asks, one category each (D-R13b-08).
  'tree-category': new RegExp(`^(?:${TREE_CATEGORIES.join('|')})$`, 'u'),
  'record-category': new RegExp(`^(?:${RECORD_CATEGORIES.join('|')})$`, 'u'),
  // An id the runtime gave one record of the day it reviewed, never a name a model chose (D-R13b-04).
  'day-record': /^(?:(?:decision|trigger):[0-9a-f]{64}|nightly:[0-9a-f]{64}:[0-9]{1,6}|deliveries:[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[A-Za-z0-9._:-]{1,128})$/u,
});

/** A single label as the policy's allowlist names one: the elements of `label-list`. */
export const LABEL_CLASS = /^[A-Za-z0-9._:/-]{1,50}$/u;

export interface FieldSpec {
  readonly maxBytes: number;
  readonly charClass: CharClass;
}

/**
 * Every kind with a schema, and its closed field set. Every field is
 * required. `human` has none: a person's run carries no payload. Neither does
 * `review-feedback`, so it cannot be enabled (D-A-TF-04).
 */
export const FIELD_SCHEMAS = Object.freeze({
  scheduled: Object.freeze({
    schedule: { maxBytes: 64, charClass: 'identifier' },
  }),
  'post-merge': Object.freeze({
    repository: { maxBytes: 140, charClass: 'repository' },
    ref: { maxBytes: 255, charClass: 'branch-ref' },
    commit: { maxBytes: 64, charClass: 'commit-sha' },
  }),
  'ci-failure': Object.freeze({
    repository: { maxBytes: 140, charClass: 'repository' },
    commit: { maxBytes: 64, charClass: 'commit-sha' },
    checkRun: { maxBytes: 19, charClass: 'decimal' },
    conclusion: { maxBytes: 20, charClass: 'failure-conclusion' },
  }),
  issue: Object.freeze({
    repository: { maxBytes: 140, charClass: 'repository' },
    number: { maxBytes: 10, charClass: 'decimal' },
    labels: { maxBytes: 1024, charClass: 'label-list' },
    authorTrust: { maxBytes: 12, charClass: 'author-trust' },
  }),
} as const satisfies Partial<Record<TriggerKind, Readonly<Record<string, FieldSpec>>>>);

export type SchemaKind = keyof typeof FIELD_SCHEMAS;

/**
 * The schemas a job's output is checked against, apart from the per-kind
 * event schemas: a job is not an event source, and its candidate's kind is
 * the `scheduled` kind that fired it (A-R13a-03, A-R13a-07). A
 * `nightly-finding` names where a scanner found something and which rule
 * found it, and nothing the scanner said about it.
 */
export const JOB_FIELD_SCHEMAS = Object.freeze({
  'nightly-finding': Object.freeze({
    scanner: { maxBytes: 20, charClass: 'nightly-scanner' },
    rule: { maxBytes: 200, charClass: 'finding-rule' },
    path: { maxBytes: 1024, charClass: 'tree-path' },
    line: { maxBytes: 10, charClass: 'decimal' },
  }),
  /** Where the whole-tree reviewer found something, and which question it answers (A-R13b-01, D-R13b-08). */
  'nightly-tree-finding': Object.freeze({
    category: { maxBytes: 40, charClass: 'tree-category' },
    path: { maxBytes: 1024, charClass: 'tree-path' },
    line: { maxBytes: 10, charClass: 'decimal' },
  }),
  /** Which of the day's records the findings reviewer names, and what it shows (A-R13b-01, D-R13b-08). */
  'nightly-record-finding': Object.freeze({
    category: { maxBytes: 40, charClass: 'record-category' },
    record: { maxBytes: 200, charClass: 'day-record' },
  }),
} as const satisfies Readonly<Record<string, Readonly<Record<string, FieldSpec>>>>);

export type JobSchema = keyof typeof JOB_FIELD_SCHEMAS;

export function isJobSchema(value: unknown): value is JobSchema {
  return typeof value === 'string' && Object.hasOwn(JOB_FIELD_SCHEMAS, value);
}
/** Every schema a candidate's fields can have been checked against: a kind's, or a job's output schema. */
export type CandidateSchema = SchemaKind | JobSchema;

const ALL_SCHEMAS: Readonly<Record<CandidateSchema, Readonly<Record<string, FieldSpec>>>> = { ...FIELD_SCHEMAS, ...JOB_FIELD_SCHEMAS };

export function isCandidateSchema(value: unknown): value is CandidateSchema {
  return typeof value === 'string' && Object.hasOwn(ALL_SCHEMAS, value);
}

type AllSchemas = typeof FIELD_SCHEMAS & typeof JOB_FIELD_SCHEMAS;
export type FieldName<K extends CandidateSchema> = keyof AllSchemas[K] & string;
/** The typed record an extractor yields for a schema: exactly the schema's fields (A-R22-03). */
export type ExtractedFields<K extends CandidateSchema> = Readonly<Record<FieldName<K>, string>>;

export function hasFieldSchema(kind: TriggerKind): kind is SchemaKind {
  return Object.hasOwn(FIELD_SCHEMAS, kind);
}

/** The schema's fields, in declaration order. */
export function schemaFields(kind: SchemaKind): ReadonlyArray<readonly [string, FieldSpec]> {
  return Object.entries(FIELD_SCHEMAS[kind]);
}

/** Why a value was refused: the field and which rule it broke. Never the value, which is the payload's. */
export interface FieldDefect {
  readonly field: string;
  readonly problem: 'unknown' | 'missing' | 'not-a-string' | 'over-cap' | 'out-of-class';
}

const encoder = new TextEncoder();

/**
 * Checks a candidate record against a kind's or a job's schema: every field present,
 * no other field, each a string within its cap and wholly in its class. The
 * value is returned as given or not at all (I5).
 */
export function checkFields<K extends CandidateSchema>(
  kind: K, fields: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly fields: ExtractedFields<K> } | { readonly ok: false; readonly defects: readonly FieldDefect[] } {
  const schema: Readonly<Record<string, FieldSpec>> = ALL_SCHEMAS[kind];
  const defects: FieldDefect[] = [];
  for (const field of Object.keys(fields)) {
    if (!Object.hasOwn(schema, field)) defects.push({ field, problem: 'unknown' });
  }
  const out: Record<string, string> = {};
  for (const [field, spec] of Object.entries(schema)) {
    if (!Object.hasOwn(fields, field)) {
      defects.push({ field, problem: 'missing' });
      continue;
    }
    const value = fields[field];
    if (typeof value !== 'string') {
      defects.push({ field, problem: 'not-a-string' });
      continue;
    }
    // The cap is checked on bytes, before the class, so an oversized value is never matched against a pattern.
    if (encoder.encode(value).byteLength > spec.maxBytes) {
      defects.push({ field, problem: 'over-cap' });
      continue;
    }
    if (!CHAR_CLASSES[spec.charClass].test(value)) {
      defects.push({ field, problem: 'out-of-class' });
      continue;
    }
    out[field] = value;
  }
  if (defects.length > 0) return { ok: false, defects };
  // Every schema field was checked into `out` and nothing else was; the cast names that record's type.
  return { ok: true, fields: out as ExtractedFields<K> };
}

/** Author trust, lowest first: a floor is met by its own rank or above. */
const TRUST_RANK: Readonly<Record<AuthorTrust, number>> = { anonymous: 0, outside: 1, collaborator: 2, owner: 3 };

export function trustRank(trust: AuthorTrust): number {
  return TRUST_RANK[trust];
}

/** The lower of two trusts: an association capped by a subscription's ceiling. */
export function capTrust(trust: AuthorTrust, ceiling: AuthorTrust): AuthorTrust {
  return TRUST_RANK[trust] <= TRUST_RANK[ceiling] ? trust : ceiling;
}
