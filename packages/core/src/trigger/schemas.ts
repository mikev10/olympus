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
 * Vault for a person to read; nothing runs. A job template a later unit adds
 * (R8, R13) takes extracted fields as its only input and never enters the
 * build. No template starts a build (D-A-TF-01).
 */
export type TemplateId = 'intake-candidate';

const TEMPLATE_SET: Readonly<Record<TemplateId, true>> = { 'intake-candidate': true };

export const TEMPLATE_IDS: readonly TemplateId[] = Object.freeze(Object.keys(TEMPLATE_SET).filter(isTemplateId));

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && Object.hasOwn(TEMPLATE_SET, value);
}

/**
 * The character classes a field may be in. Each is anchored and admits no
 * newline. `check-name` is the one that admits a space: a check's name is
 * written by whoever wrote the repository's CI configuration, it is capped at
 * 100 bytes, and refusing every check name with a space would refuse most
 * real failures (D-R22-11).
 */
export type CharClass =
  | 'identifier' | 'repository' | 'branch-ref' | 'commit-sha' | 'check-name'
  | 'failure-conclusion' | 'decimal' | 'label-list' | 'author-trust';

export const CHAR_CLASSES: Readonly<Record<CharClass, RegExp>> = Object.freeze({
  identifier: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u,
  repository: /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/u,
  // A branch, never a tag; no `..`, no component starting with a dot.
  'branch-ref': /^refs\/heads\/(?!.*\.\.)(?!.*\/\.)(?!\.)[A-Za-z0-9._/-]+$/u,
  'commit-sha': /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u,
  'check-name': /^[A-Za-z0-9._:/()-]+(?: [A-Za-z0-9._:/()-]+)*$/u,
  'failure-conclusion': /^(?:failure|timed_out|action_required|startup_failure)$/u,
  decimal: /^[1-9][0-9]{0,9}$/u,
  // Labels from the subscription's allowlist, comma-joined; empty when none matched.
  'label-list': /^(?:[A-Za-z0-9._:/-]+(?:,[A-Za-z0-9._:/-]+)*)?$/u,
  'author-trust': /^(?:owner|collaborator|outside|anonymous)$/u,
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
    check: { maxBytes: 100, charClass: 'check-name' },
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
export type FieldName<K extends SchemaKind> = keyof (typeof FIELD_SCHEMAS)[K] & string;
/** The typed record an extractor yields for a kind: exactly the schema's fields (A-R22-03). */
export type ExtractedFields<K extends SchemaKind> = { readonly [F in FieldName<K>]: string };

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
 * Checks a candidate record against the kind's schema: every field present,
 * no other field, each a string within its cap and wholly in its class. The
 * value is returned as given or not at all (I5).
 */
export function checkFields<K extends SchemaKind>(
  kind: K, fields: Readonly<Record<string, unknown>>,
): { readonly ok: true; readonly fields: ExtractedFields<K> } | { readonly ok: false; readonly defects: readonly FieldDefect[] } {
  const schema: Readonly<Record<string, FieldSpec>> = FIELD_SCHEMAS[kind];
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
