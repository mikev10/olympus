/**
 * Runtime values for the contract's closed string unions, plus the membership
 * guards the validator uses.
 *
 * The contract types are type-only, and validating a document needs them as
 * values. Every list here is derived from a total `Readonly<Record<T, true>>`
 * literal rather than written out beside the union (D-P3-03): a member added
 * to the union makes the record a compile error until this file knows about
 * it, and a member invented here is a compile error too. A hand-written array
 * rots silently, and a validator that has not heard of a new station either
 * rejects every policy that names it or accepts it nowhere.
 *
 * Membership is tested with `Object.hasOwn`, never `in`: `'toString' in set`
 * is true, and a prototype key is not a station.
 */
import type {
  AuthorTrust, AutonomyLevel, ModelTier, StationId, TriggerKind,
} from '../run/types.js';
import type { ApprovalKey, ApprovalOutcome } from './types.js';

/** Ordered 1-10, as the spine orders them; `Object.keys` preserves that. */
const STATION_SET: Readonly<Record<StationId, true>> = {
  intake: true, spec: true, 'test-design': true, plan: true, build: true,
  verify: true, review: true, integrate: true, observe: true, learn: true,
};

const LEVEL_SET: Readonly<Record<AutonomyLevel, true>> = { 0: true, 1: true, 2: true, 3: true };

const TIER_SET: Readonly<Record<ModelTier, true>> = { fast: true, standard: true, deep: true };

const TRIGGER_KIND_SET: Readonly<Record<TriggerKind, true>> = {
  human: true, 'ci-failure': true, 'review-feedback': true, 'post-merge': true, scheduled: true,
};

const AUTHOR_TRUST_SET: Readonly<Record<AuthorTrust, true>> = {
  owner: true, collaborator: true, outside: true, anonymous: true,
};

const APPROVAL_OUTCOME_SET: Readonly<Record<ApprovalOutcome, true>> = {
  auto: true, 'human-required': true, blocked: true,
};

export function isStationId(value: unknown): value is StationId {
  return typeof value === 'string' && Object.hasOwn(STATION_SET, value);
}

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  // Number-keyed record, so hasOwn coerces 2 to '2'. A string '2' is refused:
  // a document that writes a level as text has the wrong type, not a value to
  // coerce.
  return typeof value === 'number' && Object.hasOwn(LEVEL_SET, value);
}

export function isModelTier(value: unknown): value is ModelTier {
  return typeof value === 'string' && Object.hasOwn(TIER_SET, value);
}

export function isTriggerKind(value: unknown): value is TriggerKind {
  return typeof value === 'string' && Object.hasOwn(TRIGGER_KIND_SET, value);
}

export function isAuthorTrust(value: unknown): value is AuthorTrust {
  return typeof value === 'string' && Object.hasOwn(AUTHOR_TRUST_SET, value);
}

export function isApprovalOutcome(value: unknown): value is ApprovalOutcome {
  return typeof value === 'string' && Object.hasOwn(APPROVAL_OUTCOME_SET, value);
}

/** The ten stations, in station order. Derived, so it cannot omit one. */
export const STATION_IDS: readonly StationId[] = Object.freeze(
  Object.keys(STATION_SET).filter(isStationId),
);

/** The four autonomy levels, ascending. */
export const AUTONOMY_LEVELS: readonly AutonomyLevel[] = Object.freeze(
  Object.keys(LEVEL_SET).map(Number).filter(isAutonomyLevel),
);

export const TRIGGER_KINDS: readonly TriggerKind[] = Object.freeze(
  Object.keys(TRIGGER_KIND_SET).filter(isTriggerKind),
);

/** Level as its own digit, so an approval key can be built without interpolating a number. */
const LEVEL_TEXT: Readonly<Record<AutonomyLevel, `${AutonomyLevel}`>> = { 0: '0', 1: '1', 2: '2', 3: '3' };

/**
 * All forty `station:level` keys, the cross product of the two total records
 * above. This is what makes `Policy.approvals` total: resolvePolicy fills
 * every key here, and the count is checked at run time rather than trusted.
 */
export const APPROVAL_KEYS: readonly ApprovalKey[] = Object.freeze(
  STATION_IDS.flatMap((station) => AUTONOMY_LEVELS.map((level): ApprovalKey => `${station}:${LEVEL_TEXT[level]}`)),
);

export function isApprovalKey(value: unknown): value is ApprovalKey {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 2) return false;
  const [station, level] = parts;
  // A station id contains no colon, so the split is unambiguous. The level is
  // read as text here because it arrives as part of a key.
  return isStationId(station) && level !== undefined && /^[0-9]$/.test(level) && isAutonomyLevel(Number(level));
}
