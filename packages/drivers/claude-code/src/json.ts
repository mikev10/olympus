/**
 * Readers for parsed JSON.
 *
 * The CLI's stream is untrusted in the narrow sense that matters here: it is
 * produced by a program this package does not control, at a version that can
 * change what it emits. Reading it with casts would turn a shape change into a
 * `TypeError` deep inside the driver, or worse into a `NaN` in a usage number
 * that gets reported as a measurement. Each reader returns `undefined` when
 * the shape is not what was asked for, and the caller decides whether that is
 * a refusal or a field it can do without.
 *
 * None of this makes the content trustworthy. What the model wrote stays a
 * claim (I2), and no string read here is ever concatenated into a prompt (I7).
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function asArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A finite number only. An `Infinity` or a `NaN` in a usage field is a missing measurement, not a measurement. */
export function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** Every element that is a string, in order. Elements of other types are dropped. */
export function stringsIn(value: unknown): string[] {
  return (asArray(value) ?? []).filter((e): e is string => typeof e === 'string');
}

/** A nested field, or `undefined` if any step is not an object. */
export function at(root: unknown, ...path: string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    const record = asRecord(cursor);
    if (record === undefined) return undefined;
    cursor = record[key];
  }
  return cursor;
}
