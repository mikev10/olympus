/**
 * Schema validation for the authored policy document: the narrowing from an
 * already-parsed `unknown` to a `PolicyDocument`.
 *
 * I4: a document is accepted only when every key is one the contract names and
 * every value sits in its domain. An unknown key is a refusal, never a value
 * to ignore — a typo in a grant is a grant that silently does not exist, and a
 * typo in a cap is a cap that silently does not apply.
 *
 * I5: this module refuses. It never repairs a value, drops an offending key, or
 * substitutes a default for a malformed one. The only defaulting anywhere in
 * this package is `resolvePolicy` filling an *omitted* approval with
 * `human-required` (R-F2-08), which is a different thing from mending a
 * present-but-wrong one.
 *
 * These types live beside the implementation rather than in `policy/types.ts`,
 * which is an F2 contract file, because `PolicyRefusal`'s three reasons do not
 * describe a malformed document (D-P3-02).
 *
 * Where the bytes came from is not this module's concern: it takes a parsed
 * value. The YAML loader and its hardening are owed to P9 (D-P3-01).
 */
import type { Budget } from '../driver/contract.js';
import type {
  AuthorTrust, AutonomyLevel, ModelTier, RoleId, StationId, TriggerKind,
} from '../run/types.js';
import {
  isApprovalKey, isApprovalOutcome, isAuthorTrust, isAutonomyLevel,
  isModelTier, isStationId, isTriggerKind, tierRank,
} from './constants.js';
import type {
  ApprovalKey, ApprovalOutcome, CapabilityScope, EscalationGrant, PolicyDocument, TriggerPolicy,
  TriggerSchedule, TriggerSubscription,
} from './types.js';
import {
  CHAR_CLASSES, LABEL_CLASS, TEMPLATE_IDS, hasFieldSchema, isTemplateId, type TemplateId,
} from '../trigger/schemas.js';

/** One thing wrong, at the path it is wrong at. */
export interface PolicyDefect {
  /** Dotted path from the document root: `roles.builder.network.egress`. */
  readonly path: string;
  readonly problem: string;
}

/**
 * Validation either yields a document or the complete list of what is wrong
 * with the input. Every defect is reported, not just the first: a policy file
 * fixed one message at a time is a policy file read many times.
 */
export type DocumentValidation =
  | { readonly ok: true; readonly document: PolicyDocument }
  | { readonly ok: false; readonly defects: readonly PolicyDefect[] };

/**
 * Key lists derived from total records over the contract interfaces, for the
 * same reason as the union lists in constants.ts: a field added to
 * `PolicyDocument` makes this a compile error until the validator knows about
 * it. Written as an array beside the interface, a new field would instead
 * arrive as an "unknown key" and every document carrying it would be refused.
 */
const DOCUMENT_KEYS: Readonly<Record<keyof PolicyDocument, true>> = {
  globalCap: true, stationCaps: true, approvals: true, roles: true,
  protectedPaths: true, triggers: true, concurrency: true,
};

const SCOPE_KEYS: Readonly<Record<keyof CapabilityScope, true>> = {
  stations: true, writableGlobs: true, tools: true, network: true,
  tier: true, tierByStation: true, escalation: true, autonomyCeiling: true, triggerKinds: true, budget: true,
};

const ESCALATION_KEYS: Readonly<Record<keyof Exclude<EscalationGrant, 'none'>, true>> = {
  afterFailedGates: true, ceiling: true,
};

const NETWORK_KEYS: Readonly<Record<keyof CapabilityScope['network'], true>> = { egress: true };

const BUDGET_KEYS: Readonly<Record<keyof Budget, true>> = {
  maxTokens: true, maxCostUsd: true, maxWallClockMs: true,
};

const TRIGGER_KEYS: Readonly<Record<keyof TriggerPolicy, true>> = {
  enabled: true, entryStation: true, taskTemplate: true, maxAutonomy: true,
  minAuthorTrust: true, maxTriggerDepth: true, budgetPerWindow: true,
  subscriptions: true, schedules: true, maxDeliveryAgeMs: true, candidateExpiryMs: true,
};

const SUBSCRIPTION_KEYS: Readonly<Record<keyof TriggerSubscription, true>> = {
  id: true, kind: true, source: true, transport: true, secret: true, trustCeiling: true, labels: true,
};

const SCHEDULE_KEYS: Readonly<Record<keyof TriggerSchedule, true>> = { id: true, template: true, at: true };

/** The bounds D-R22-02 and D-R22-04 set: a delivery at most seven days old, a candidate waiting at most thirty. */
export const MAX_DELIVERY_AGE_CAP_MS = 7 * 24 * 3_600_000;
export const CANDIDATE_EXPIRY_CAP_MS = 30 * 24 * 3_600_000;

/** A subscription's secret is a host variable with this prefix, so no other host secret can be named as one (D-A-TF-05). */
export const WEBHOOK_SECRET_PREFIX = 'FACTORY_WEBHOOK_';
const SECRET_NAME = /^FACTORY_WEBHOOK_[A-Z0-9_]+$/u;
const DAILY_TIME = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/u;

const WINDOW_KEYS: Readonly<Record<keyof TriggerPolicy['budgetPerWindow'], true>> = {
  runs: true, windowMs: true,
};

const CONCURRENCY_KEYS: Readonly<Record<keyof PolicyDocument['concurrency'], true>> = {
  maxParallelTasks: true, maxConflictRetries: true,
};

/**
 * Keys that are never a role id. `Object.fromEntries` would store `__proto__`
 * as an own property rather than invoking the setter, so this is not the only
 * thing standing between a document and prototype pollution; a role by one of
 * these names is nonsense regardless, and refusing it by name says so.
 */
const RESERVED_ROLE_IDS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Narrows to `unknown[]` rather than `Array.isArray`'s `any[]`. */
function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (isArray(value)) return 'an array';
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
  if (typeof value === 'number') return `the number ${String(value)}`;
  if (typeof value === 'boolean') return `the boolean ${String(value)}`;
  return `a value of type ${typeof value}`;
}

function child(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function keysOf(set: Readonly<Record<string, true>>): readonly string[] {
  return Object.keys(set);
}

/**
 * Checks that `value` is an object carrying no key outside `allowed`, and
 * returns it for field reading. Missing keys are reported by the field
 * readers, so each problem produces exactly one defect.
 */
function shape(
  value: unknown, path: string, allowed: readonly string[], defects: PolicyDefect[],
): Readonly<Record<string, unknown>> | undefined {
  if (!isRecord(value)) {
    defects.push({
      path: path === '' ? '(document)' : path,
      problem: `expected an object with the keys ${allowed.join(', ')}; found ${describe(value)}`,
    });
    return undefined;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      defects.push({
        path: child(path, key),
        problem: `unknown key; the keys allowed here are ${allowed.join(', ')}`,
      });
    }
  }
  return value;
}

type Guard<T> = (value: unknown) => value is T;

/** Reads one required field and narrows it, or reports why it could not. */
function read<T>(
  record: Readonly<Record<string, unknown>>, key: string, path: string,
  expected: string, guard: Guard<T>, defects: PolicyDefect[],
): T | undefined {
  const at = child(path, key);
  if (!Object.hasOwn(record, key)) {
    defects.push({ path: at, problem: `required key is missing; expected ${expected}` });
    return undefined;
  }
  const value = record[key];
  if (!guard(value)) {
    defects.push({ path: at, problem: `expected ${expected}, found ${describe(value)}` });
    return undefined;
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** Every element must pass, or the whole array is refused. */
function readArray<T>(
  record: Readonly<Record<string, unknown>>, key: string, path: string,
  element: string, guard: Guard<T>, defects: PolicyDefect[],
): T[] | undefined {
  const raw = read(record, key, path, `an array of ${element}`, isArray, defects);
  if (raw === undefined) return undefined;
  const at = child(path, key);
  const out: T[] = [];
  let ok = true;
  for (const [index, entry] of raw.entries()) {
    if (guard(entry)) {
      out.push(entry);
      continue;
    }
    ok = false;
    defects.push({ path: `${at}[${String(index)}]`, problem: `expected ${element}, found ${describe(entry)}` });
  }
  return ok ? out : undefined;
}

/**
 * A sparse map keyed by a closed union: `stationCaps`, and the four per-kind
 * maps inside `triggers`. An unrecognised key is a defect, not an entry to
 * drop, because a cap keyed by a misspelt station is a cap that does not
 * apply.
 */
function readPartialMap<K extends string, V>(
  record: Readonly<Record<string, unknown>>, key: string, path: string,
  keyKind: string, keyGuard: Guard<K>, valueKind: string, valueGuard: Guard<V>,
  defects: PolicyDefect[],
): Partial<Record<K, V>> | undefined {
  const raw = read(record, key, path, `an object keyed by ${keyKind}`, isRecord, defects);
  if (raw === undefined) return undefined;
  const at = child(path, key);
  const out: Partial<Record<K, V>> = {};
  let ok = true;
  for (const [entryKey, entryValue] of Object.entries(raw)) {
    if (!keyGuard(entryKey)) {
      ok = false;
      defects.push({ path: child(at, entryKey), problem: `not ${keyKind}` });
      continue;
    }
    if (!valueGuard(entryValue)) {
      ok = false;
      defects.push({ path: child(at, entryKey), problem: `expected ${valueKind}, found ${describe(entryValue)}` });
      continue;
    }
    out[entryKey] = entryValue;
  }
  return ok ? out : undefined;
}

function validateBudget(value: unknown, path: string, defects: PolicyDefect[]): Budget | undefined {
  const record = shape(value, path, keysOf(BUDGET_KEYS), defects);
  if (record === undefined) return undefined;
  const maxTokens = read(record, 'maxTokens', path, 'a non-negative integer', isNonNegativeInteger, defects);
  const maxCostUsd = read(record, 'maxCostUsd', path, 'a non-negative number', isNonNegativeNumber, defects);
  const maxWallClockMs = read(record, 'maxWallClockMs', path, 'a non-negative integer', isNonNegativeInteger, defects);
  if (maxTokens === undefined || maxCostUsd === undefined || maxWallClockMs === undefined) return undefined;
  return { maxTokens, maxCostUsd, maxWallClockMs };
}

/**
 * Characters that mean an entry is not one host: the glob wildcards, a path or
 * prefix-length separator, a backslash, and any whitespace. The rule this
 * enforces is narrow and statable — *an egress entry denotes a single host* —
 * rather than a hostname grammar, which belongs to whichever unit can actually
 * enforce an allowlist (D-P3-08).
 */
const NOT_ONE_HOST = /[*?/\\\s]/u;

function isHostLiteral(value: string): boolean {
  return !NOT_ONE_HOST.test(value);
}

/**
 * `egress` is `'none'` or an explicit host list (I4: the contract admits no
 * wildcard). An empty list is accepted and means the same as `'none'` by
 * granting nothing; `'all'`, `'*'`, or any other bare string is refused.
 *
 * Refusing the bare `'*'` while accepting `['*']` was the hole: the authored
 * form then reads as an explicit allowlist while denoting every host, and a
 * consumer that treats entries as patterns would grant the whole network from
 * a policy that looks restrictive. Entries carrying a wildcard, a path, a
 * prefix length, or whitespace are refused here so the list means what it
 * looks like.
 */
function validateEgress(
  value: unknown, path: string, defects: PolicyDefect[],
): CapabilityScope['network'] | undefined {
  const record = shape(value, path, keysOf(NETWORK_KEYS), defects);
  if (record === undefined) return undefined;
  const at = child(path, 'egress');
  if (!Object.hasOwn(record, 'egress')) {
    defects.push({ path: at, problem: `required key is missing; expected 'none' or an array of host strings` });
    return undefined;
  }
  const egress = record.egress;
  if (egress === 'none') return { egress: 'none' };
  if (isArray(egress)) {
    const hosts = egress.filter(isNonEmptyString);
    if (hosts.length !== egress.length) {
      defects.push({ path: at, problem: 'every egress entry must be a non-empty host string' });
      return undefined;
    }
    const notHosts = hosts.filter((host) => !isHostLiteral(host));
    if (notHosts.length > 0) {
      defects.push({
        path: at,
        problem:
          'an egress entry names one host and carries no wildcard, path, prefix length, or whitespace; refused: '
          + notHosts.map((host) => JSON.stringify(host)).join(', '),
      });
      return undefined;
    }
    return { egress: hosts };
  }
  defects.push({
    path: at,
    problem: `expected 'none' or an array of host strings, found ${describe(egress)}; there is no wildcard`,
  });
  return undefined;
}

/**
 * `'none'`, or a grant with a positive failure count and a ceiling tier
 * (A-R14-01). Required, like every scope key: a scope that does not say
 * whether it escalates is refused rather than read as not escalating.
 */
function validateEscalation(record: Readonly<Record<string, unknown>>, path: string, defects: PolicyDefect[]): EscalationGrant | undefined {
  const at = child(path, 'escalation');
  if (!Object.hasOwn(record, 'escalation')) {
    defects.push({ path: at, problem: `required key is missing; expected 'none' or { afterFailedGates, ceiling }` });
    return undefined;
  }
  const value = record.escalation;
  if (value === 'none') return 'none';
  if (!isRecord(value)) {
    defects.push({ path: at, problem: `expected 'none' or { afterFailedGates, ceiling }, found ${describe(value)}` });
    return undefined;
  }
  const grant = shape(value, at, keysOf(ESCALATION_KEYS), defects);
  if (grant === undefined) return undefined;
  const afterFailedGates = read(grant, 'afterFailedGates', at, 'a positive integer', isPositiveInteger, defects);
  const ceiling = read<ModelTier>(grant, 'ceiling', at, `one of 'fast', 'standard', 'deep'`, isModelTier, defects);
  if (afterFailedGates === undefined || ceiling === undefined) return undefined;
  return { afterFailedGates, ceiling };
}

/**
 * What the per-station tiers and the escalation ceiling mean together. A tier
 * for a station the role may not act at applies nowhere, as a cap keyed by a
 * misspelt station would; a ceiling below a tier the role starts at would
 * cap nothing it could reach. Both are refused rather than read as meaning
 * something (I5).
 */
function tierDefects(scope: CapabilityScope, path: string, defects: PolicyDefect[]): void {
  for (const station of Object.keys(scope.tierByStation)) {
    if (!scope.stations.includes(station as StationId)) {
      defects.push({ path: child(child(path, 'tierByStation'), station), problem: `the role may not act at '${station}', so a tier for it applies nowhere` });
    }
  }
  if (scope.escalation === 'none') return;
  const { ceiling } = scope.escalation;
  const starting = [scope.tier, ...Object.values(scope.tierByStation)];
  const above = starting.filter((tier) => tierRank(tier) > tierRank(ceiling));
  if (above.length > 0) {
    defects.push({
      path: child(child(path, 'escalation'), 'ceiling'),
      problem: `the ceiling '${ceiling}' is below the tier '${above[0] ?? ceiling}' the role starts at; a ceiling caps escalation and never lowers a tier`,
    });
  }
}

function validateScope(value: unknown, path: string, defects: PolicyDefect[]): CapabilityScope | undefined {
  const record = shape(value, path, keysOf(SCOPE_KEYS), defects);
  if (record === undefined) return undefined;
  const stations = readArray<StationId>(record, 'stations', path, 'one of the ten station ids', isStationId, defects);
  const writableGlobs = readArray<string>(record, 'writableGlobs', path, 'a non-empty glob string', isNonEmptyString, defects);
  const tools = readArray<string>(record, 'tools', path, 'a non-empty tool name', isNonEmptyString, defects);
  const tier = read<ModelTier>(record, 'tier', path, `one of 'fast', 'standard', 'deep'`, isModelTier, defects);
  const tierByStation = readPartialMap<StationId, ModelTier>(
    record, 'tierByStation', path, 'a station id', isStationId, `one of 'fast', 'standard', 'deep'`, isModelTier, defects,
  );
  const escalation = validateEscalation(record, path, defects);
  const autonomyCeiling = read<AutonomyLevel>(record, 'autonomyCeiling', path, 'an autonomy level 0-3', isAutonomyLevel, defects);
  const triggerKinds = readArray<TriggerKind>(record, 'triggerKinds', path, 'a trigger kind', isTriggerKind, defects);
  const network = Object.hasOwn(record, 'network')
    ? validateEgress(record.network, child(path, 'network'), defects)
    : undefined;
  if (!Object.hasOwn(record, 'network')) {
    defects.push({ path: child(path, 'network'), problem: `required key is missing; expected { egress }` });
  }
  const budget = Object.hasOwn(record, 'budget')
    ? validateBudget(record.budget, child(path, 'budget'), defects)
    : undefined;
  if (!Object.hasOwn(record, 'budget')) {
    defects.push({ path: child(path, 'budget'), problem: 'required key is missing; expected a budget' });
  }
  if (
    stations === undefined || writableGlobs === undefined || tools === undefined
    || tier === undefined || tierByStation === undefined || escalation === undefined
    || autonomyCeiling === undefined || triggerKinds === undefined
    || network === undefined || budget === undefined
  ) return undefined;
  const scope: CapabilityScope = { stations, writableGlobs, tools, network, tier, tierByStation, escalation, autonomyCeiling, triggerKinds, budget };
  const before = defects.length;
  tierDefects(scope, path, defects);
  return defects.length === before ? scope : undefined;
}

function validateTriggers(value: unknown, path: string, defects: PolicyDefect[]): TriggerPolicy | undefined {
  const record = shape(value, path, keysOf(TRIGGER_KEYS), defects);
  if (record === undefined) return undefined;
  const enabled = readArray<TriggerKind>(record, 'enabled', path, 'a trigger kind', isTriggerKind, defects);
  const entryStation = readPartialMap<TriggerKind, StationId>(
    record, 'entryStation', path, 'a trigger kind', isTriggerKind, 'a station id', isStationId, defects,
  );
  // I7: a template is one the closed registry in code names; a payload can never name one (A-R22-02).
  const taskTemplate = readPartialMap<TriggerKind, TemplateId>(
    record, 'taskTemplate', path, 'a trigger kind', isTriggerKind, `a registered template (${TEMPLATE_IDS.join(', ')})`, isTemplateId, defects,
  );
  const maxAutonomy = readPartialMap<TriggerKind, AutonomyLevel>(
    record, 'maxAutonomy', path, 'a trigger kind', isTriggerKind, 'an autonomy level 0-3', isAutonomyLevel, defects,
  );
  const minAuthorTrust = readPartialMap<TriggerKind, AuthorTrust>(
    record, 'minAuthorTrust', path, 'a trigger kind', isTriggerKind, 'an author trust level', isAuthorTrust, defects,
  );
  const maxTriggerDepth = read(record, 'maxTriggerDepth', path, 'a non-negative integer', isNonNegativeInteger, defects);
  const window = Object.hasOwn(record, 'budgetPerWindow')
    ? shape(record.budgetPerWindow, child(path, 'budgetPerWindow'), keysOf(WINDOW_KEYS), defects)
    : undefined;
  if (!Object.hasOwn(record, 'budgetPerWindow')) {
    defects.push({ path: child(path, 'budgetPerWindow'), problem: 'required key is missing; expected { runs, windowMs }' });
  }
  const windowPath = child(path, 'budgetPerWindow');
  const runs = window === undefined
    ? undefined
    : read(window, 'runs', windowPath, 'a non-negative integer', isNonNegativeInteger, defects);
  const windowMs = window === undefined
    ? undefined
    : read(window, 'windowMs', windowPath, 'a positive integer', isPositiveInteger, defects);
  const subscriptions = Object.hasOwn(record, 'subscriptions')
    ? readList(record, 'subscriptions', path, validateSubscription, defects)
    : [];
  const schedules = Object.hasOwn(record, 'schedules')
    ? readList(record, 'schedules', path, validateSchedule, defects)
    : [];
  const maxDeliveryAgeMs = optionalBounded(record, 'maxDeliveryAgeMs', path, MAX_DELIVERY_AGE_CAP_MS, '7 days', defects);
  const candidateExpiryMs = optionalBounded(record, 'candidateExpiryMs', path, CANDIDATE_EXPIRY_CAP_MS, '30 days', defects);
  if (
    enabled === undefined || entryStation === undefined || taskTemplate === undefined
    || maxAutonomy === undefined || minAuthorTrust === undefined || maxTriggerDepth === undefined
    || runs === undefined || windowMs === undefined || subscriptions === undefined || schedules === undefined
    || maxDeliveryAgeMs === null || candidateExpiryMs === null
  ) return undefined;
  const triggers: TriggerPolicy = {
    enabled, entryStation, taskTemplate, maxAutonomy, minAuthorTrust,
    maxTriggerDepth, budgetPerWindow: { runs, windowMs }, subscriptions, schedules,
    ...(maxDeliveryAgeMs === undefined ? {} : { maxDeliveryAgeMs }),
    ...(candidateExpiryMs === undefined ? {} : { candidateExpiryMs }),
  };
  const before = defects.length;
  routeDefects(triggers, path, defects);
  return defects.length === before ? triggers : undefined;
}

/**
 * An optional positive integer at most `cap`: undefined when absent, null
 * when present and wrong (the defect already reported).
 */
function optionalBounded(
  record: Readonly<Record<string, unknown>>, key: string, path: string, cap: number, capText: string, defects: PolicyDefect[],
): number | undefined | null {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = read(record, key, path, `a positive integer of milliseconds, at most ${capText}`, isPositiveInteger, defects);
  if (value === undefined) return null;
  if (value > cap) {
    defects.push({ path: child(path, key), problem: `at most ${String(cap)} (${capText}); found ${String(value)}` });
    return null;
  }
  return value;
}

/** An array whose every element a validator accepts, or undefined with each element's defects reported. */
function readList<T>(
  record: Readonly<Record<string, unknown>>, key: string, path: string,
  validate: (value: unknown, path: string, defects: PolicyDefect[]) => T | undefined, defects: PolicyDefect[],
): T[] | undefined {
  const raw = read(record, key, path, 'an array', isArray, defects);
  if (raw === undefined) return undefined;
  const out: T[] = [];
  let ok = true;
  for (const [index, entry] of raw.entries()) {
    const value = validate(entry, `${child(path, key)}[${String(index)}]`, defects);
    if (value === undefined) ok = false;
    else out.push(value);
  }
  return ok ? out : undefined;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && CHAR_CLASSES.identifier.test(value);
}

function validateSubscription(value: unknown, path: string, defects: PolicyDefect[]): TriggerSubscription | undefined {
  const record = shape(value, path, keysOf(SUBSCRIPTION_KEYS), defects);
  if (record === undefined) return undefined;
  const id = read(record, 'id', path, 'a lowercase identifier of at most 64 characters', isIdentifier, defects);
  const kind = read<TriggerKind>(record, 'kind', path, 'a trigger kind', isTriggerKind, defects);
  const source = read(record, 'source', path, `'github'`, (v): v is 'github' => v === 'github', defects);
  const transport = read(record, 'transport', path, `'signed-webhook'`, (v): v is 'signed-webhook' => v === 'signed-webhook', defects);
  const secret = read(record, 'secret', path, `the name of a host variable starting ${WEBHOOK_SECRET_PREFIX}`, (v): v is string => typeof v === 'string' && SECRET_NAME.test(v), defects);
  const trustCeiling = read<AuthorTrust>(record, 'trustCeiling', path, 'an author trust level', isAuthorTrust, defects);
  const labels = readArray<string>(record, 'labels', path, 'a label of at most 50 characters with no space or comma', (v): v is string => typeof v === 'string' && LABEL_CLASS.test(v), defects);
  if (
    id === undefined || kind === undefined || source === undefined || transport === undefined
    || secret === undefined || trustCeiling === undefined || labels === undefined
  ) return undefined;
  if (kind === 'human' || kind === 'scheduled') {
    defects.push({ path: child(path, 'kind'), problem: `'${kind}' is not delivered by a webhook; a subscription is for a kind a source sends` });
    return undefined;
  }
  if (labels.length > 0 && kind !== 'issue') {
    defects.push({ path: child(path, 'labels'), problem: `only an 'issue' subscription carries labels` });
    return undefined;
  }
  return { id, kind, source, transport, secret, trustCeiling, labels };
}

function validateSchedule(value: unknown, path: string, defects: PolicyDefect[]): TriggerSchedule | undefined {
  const record = shape(value, path, keysOf(SCHEDULE_KEYS), defects);
  if (record === undefined) return undefined;
  const id = read(record, 'id', path, 'a lowercase identifier of at most 64 characters', isIdentifier, defects);
  const template = read<TemplateId>(record, 'template', path, `a registered template (${TEMPLATE_IDS.join(', ')})`, isTemplateId, defects);
  const at = read(record, 'at', path, `a UTC time 'HH:MM'`, (v): v is string => typeof v === 'string' && DAILY_TIME.test(v), defects);
  if (id === undefined || template === undefined || at === undefined) return undefined;
  return { id, template, at };
}

/**
 * What the trigger policy means together (D-A-TF-03, the relational check
 * D-P3-13 left to admission until a registry existed). A non-human kind in
 * `enabled` needs its whole route; a subscription or schedule needs its kind
 * enabled; ids are unique. `human` keeps D-P3-05's route: an entry station,
 * a cap, and a floor, and no template.
 */
function routeDefects(triggers: TriggerPolicy, path: string, defects: PolicyDefect[]): void {
  const nonHuman = triggers.enabled.filter((kind) => kind !== 'human');
  for (const kind of nonHuman) {
    const missing: string[] = [];
    if (!Object.hasOwn(triggers.entryStation, kind)) missing.push('an entryStation');
    if (!Object.hasOwn(triggers.taskTemplate, kind)) missing.push('a registered taskTemplate');
    if (!Object.hasOwn(triggers.maxAutonomy, kind)) missing.push('a maxAutonomy');
    if (!Object.hasOwn(triggers.minAuthorTrust, kind)) missing.push('a minAuthorTrust');
    if (!hasFieldSchema(kind)) missing.push('a field schema in code, which this kind does not have');
    if (missing.length > 0) {
      defects.push({ path: child(path, 'enabled'), problem: `'${kind}' is enabled without ${missing.join(', ')}; a non-human kind is enabled only with its whole route` });
    }
  }
  if (nonHuman.length > 0) {
    for (const key of ['maxDeliveryAgeMs', 'candidateExpiryMs'] as const) {
      if (triggers[key] === undefined) defects.push({ path: child(path, key), problem: 'required while a non-human kind is enabled' });
    }
  }
  const unique = (ids: readonly string[], at: string): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) defects.push({ path: at, problem: `the id '${id}' appears more than once` });
      seen.add(id);
    }
  };
  const subscriptions = triggers.subscriptions ?? [];
  const schedules = triggers.schedules ?? [];
  unique(subscriptions.map((s) => s.id), child(path, 'subscriptions'));
  unique(schedules.map((s) => s.id), child(path, 'schedules'));
  subscriptions.forEach((s, i) => {
    if (!triggers.enabled.includes(s.kind)) {
      defects.push({ path: `${child(path, 'subscriptions')}[${String(i)}].kind`, problem: `'${s.kind}' is not enabled, so this subscription grants nothing` });
    }
  });
  if (schedules.length > 0 && !triggers.enabled.includes('scheduled')) {
    defects.push({ path: child(path, 'schedules'), problem: `'scheduled' is not enabled, so no schedule fires` });
  }
}

function validateRoles(
  value: unknown, path: string, defects: PolicyDefect[],
): Record<RoleId, CapabilityScope> | undefined {
  if (!isRecord(value)) {
    defects.push({ path, problem: `expected an object keyed by role id, found ${describe(value)}` });
    return undefined;
  }
  const entries: Array<[string, CapabilityScope]> = [];
  let ok = true;
  for (const roleId of Object.keys(value)) {
    if (!isNonEmptyString(roleId) || RESERVED_ROLE_IDS.includes(roleId)) {
      ok = false;
      defects.push({ path: child(path, roleId), problem: 'not a usable role id' });
      continue;
    }
    const scope = validateScope(value[roleId], child(path, roleId), defects);
    if (scope === undefined) {
      ok = false;
      continue;
    }
    entries.push([roleId, scope]);
  }
  return ok ? Object.fromEntries(entries) : undefined;
}

/**
 * The only path from an unvalidated value to a `PolicyDocument`. Returns every
 * defect it finds; an `ok: true` result means nothing was wrong, not that
 * something was repaired.
 */
export function validatePolicyDocument(input: unknown): DocumentValidation {
  const defects: PolicyDefect[] = [];
  const record = shape(input, '', keysOf(DOCUMENT_KEYS), defects);
  if (record === undefined) return { ok: false, defects };

  const globalCap = read<AutonomyLevel>(record, 'globalCap', '', 'an autonomy level 0-3', isAutonomyLevel, defects);
  const stationCaps = readPartialMap<StationId, AutonomyLevel>(
    record, 'stationCaps', '', 'a station id', isStationId, 'an autonomy level 0-3', isAutonomyLevel, defects,
  );
  const approvals = readPartialMap<ApprovalKey, ApprovalOutcome>(
    record, 'approvals', '', `a 'station:level' key`, isApprovalKey,
    `one of 'auto', 'human-required', 'blocked'`, isApprovalOutcome, defects,
  );
  const protectedPaths = readArray<string>(record, 'protectedPaths', '', 'a non-empty path or glob', isNonEmptyString, defects);
  const roles = Object.hasOwn(record, 'roles')
    ? validateRoles(record.roles, 'roles', defects)
    : undefined;
  if (!Object.hasOwn(record, 'roles')) {
    defects.push({ path: 'roles', problem: 'required key is missing; expected an object keyed by role id' });
  }
  const triggers = Object.hasOwn(record, 'triggers')
    ? validateTriggers(record.triggers, 'triggers', defects)
    : undefined;
  if (!Object.hasOwn(record, 'triggers')) {
    defects.push({ path: 'triggers', problem: 'required key is missing; expected a trigger policy' });
  }
  const concurrencyRecord = Object.hasOwn(record, 'concurrency')
    ? shape(record.concurrency, 'concurrency', keysOf(CONCURRENCY_KEYS), defects)
    : undefined;
  if (!Object.hasOwn(record, 'concurrency')) {
    defects.push({ path: 'concurrency', problem: 'required key is missing; expected { maxParallelTasks, maxConflictRetries }' });
  }
  const maxParallelTasks = concurrencyRecord === undefined
    ? undefined
    : read(concurrencyRecord, 'maxParallelTasks', 'concurrency', 'a positive integer', isPositiveInteger, defects);
  const maxConflictRetries = concurrencyRecord === undefined
    ? undefined
    : read(concurrencyRecord, 'maxConflictRetries', 'concurrency', 'a non-negative integer', isNonNegativeInteger, defects);

  if (
    globalCap === undefined || stationCaps === undefined || approvals === undefined
    || protectedPaths === undefined || roles === undefined || triggers === undefined
    || maxParallelTasks === undefined || maxConflictRetries === undefined
    || defects.length > 0
  ) {
    // A defect with no undefined field is still a refusal: `shape` reports an
    // unknown key without failing the fields around it.
    return { ok: false, defects };
  }
  return {
    ok: true,
    document: {
      globalCap, stationCaps, approvals, roles, protectedPaths, triggers,
      concurrency: { maxParallelTasks, maxConflictRetries },
    },
  };
}

/** Formats defects for a refusal message: one per line, path first. */
export function formatDefects(defects: readonly PolicyDefect[]): string {
  return defects.map((d) => `  ${d.path}: ${d.problem}`).join('\n');
}
