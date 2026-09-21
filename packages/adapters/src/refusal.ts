/**
 * Every way an adapter declines to answer. An adapter that cannot read a
 * file, resolve a config setting, or trust a report says so by throwing one
 * of these, and never by returning an empty list, a zero, or a default it
 * guessed (I5). Each reason is a distinct cause a caller can act on.
 */
export type AdapterRefusalReason =
  /** A symbolic link, a device, a directory where a file was expected, or a path that could not be opened. */
  | 'unsafe-path'
  /** A file larger than the cap its reader was given. */
  | 'too-large'
  /** Bytes that are not UTF-8, or source the parser could not read. */
  | 'unparseable'
  /** A config setting that decides which files are tests, set to something the parser cannot resolve without running it. */
  | 'unresolvable-config'
  /** A framework major version whose discovery rules this package does not encode. */
  | 'unsupported-version'
  /** A framework feature whose effect on discovery this package does not model. */
  | 'unsupported-feature'
  /** A coverage report that is not where the adapter was told it would be. */
  | 'missing-report'
  /** A coverage report whose shape is not the istanbul JSON format. */
  | 'malformed-report'
  /** A behavioral scenario whose `input` or `expected` has a shape the adapter does not recognise. */
  | 'unrecognised-scenario';

export class AdapterRefusal extends Error {
  override readonly name = 'AdapterRefusal';
  constructor(
    readonly reason: AdapterRefusalReason,
    message: string,
  ) {
    super(`adapters (${reason}): ${message}`);
  }
}

export function refuse(reason: AdapterRefusalReason, message: string): never {
  throw new AdapterRefusal(reason, message);
}

/** A thrown value's message, for embedding in a refusal. */
export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
