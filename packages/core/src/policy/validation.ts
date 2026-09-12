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
  isModelTier, isStationId, isTriggerKind,
} from './constants.js';
import type {
  ApprovalKey, ApprovalOutcome, CapabilityScope, PolicyDocument, TriggerPolicy,
} from './types.js';

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
  tier: true, autonomyCeiling: true, triggerKinds: true, budget: true,
};

const NETWORK_KEYS: Readonly<Record<keyof CapabilityScope['network'], true>> = { egress: true };

const BUDGET_KEYS: Readonly<Record<keyof Budget, true>> = {
  maxTokens: true, maxCostUsd: true, maxWallClockMs: true,
};

const TRIGGER_KEYS: Readonly<Record<keyof TriggerPolicy, true>> = {
  enabled: true, entryStation: true, taskTemplate: true, maxAutonomy: true,
  minAuthorTrust: true, maxTriggerDepth: true, budgetPerWindow: true,
};

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
 * `egress` is `'none'` or an explicit host list (I4: the contract admits no
 * wildcard). An empty list is accepted and means the same as `'none'` by
 * granting nothing; `'all'`, `'*'`, or any other bare string is refused.
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
    return { egress: hosts };
  }
  defects.push({
    path: at,
    problem: `expected 'none' or an array of host strings, found ${describe(egress)}; there is no wildcard`,
  });
  return undefined;
}

function validateScope(value: unknown, path: string, defects: PolicyDefect[]): CapabilityScope | undefined {
  const record = shape(value, path, keysOf(SCOPE_KEYS), defects);
  if (record === undefined) return undefined;
  const stations = readArray<StationId>(record, 'stations', path, 'one of the ten station ids', isStationId, defects);
  const writableGlobs = readArray<string>(record, 'writableGlobs', path, 'a non-empty glob string', isNonEmptyString, defects);
  const tools = readArray<string>(record, 'tools', path, 'a non-empty tool name', isNonEmptyString, defects);
  const tier = read<ModelTier>(record, 'tier', path, `one of 'fast', 'standard', 'deep'`, isModelTier, defects);
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
    || tier === undefined || autonomyCeiling === undefined || triggerKinds === undefined
    || network === undefined || budget === undefined
  ) return undefined;
  return { stations, writableGlobs, tools, network, tier, autonomyCeiling, triggerKinds, budget };
}

function validateTriggers(value: unknown, path: string, defects: PolicyDefect[]): TriggerPolicy | undefined {
  const record = shape(value, path, keysOf(TRIGGER_KEYS), defects);
  if (record === undefined) return undefined;
  const enabled = readArray<TriggerKind>(record, 'enabled', path, 'a trigger kind', isTriggerKind, defects);
  const entryStation = readPartialMap<TriggerKind, StationId>(
    record, 'entryStation', path, 'a trigger kind', isTriggerKind, 'a station id', isStationId, defects,
  );
  // I7: a template name is pre-declared here; a payload can never name one.
  const taskTemplate = readPartialMap<TriggerKind, string>(
    record, 'taskTemplate', path, 'a trigger kind', isTriggerKind, 'a non-empty template name', isNonEmptyString, defects,
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
  if (
    enabled === undefined || entryStation === undefined || taskTemplate === undefined
    || maxAutonomy === undefined || minAuthorTrust === undefined || maxTriggerDepth === undefined
    || runs === undefined || windowMs === undefined
  ) return undefined;
  return {
    enabled, entryStation, taskTemplate, maxAutonomy, minAuthorTrust,
    maxTriggerDepth, budgetPerWindow: { runs, windowMs },
  };
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
