/**
 * One refusal type for the driver, shaped like the sandbox's: a `layer` names
 * which control declined, so a conformance assertion can require the right
 * refusal rather than merely some error. A test that accepts any throw passes
 * when the daemon is down, the image is missing, or the code has a typo, and
 * proves nothing about what it claims to cover (I5).
 */
export type DriverRefusalLayer =
  /** No sandbox provider, or one that did not provision the handle in the request. */
  | 'provider'
  /** The session authenticated from a source other than the placeholder this driver set. */
  | 'credential'
  /** The image could not be built or is not present. */
  | 'image'
  /** A tool the request grants is not one this driver declares (I4). */
  | 'grant'
  /** The CLI could not be run, exited without a result, or produced output this driver cannot read. */
  | 'invocation'
  /** A capability the request needs is not one this driver declares. */
  | 'capability';

export class DriverRefusal extends Error {
  override readonly name = 'DriverRefusal';
  constructor(
    readonly layer: DriverRefusalLayer,
    message: string,
  ) {
    super(message);
  }
}

export function refuse(layer: DriverRefusalLayer, message: string): never {
  throw new DriverRefusal(layer, message);
}
