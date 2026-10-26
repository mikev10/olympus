/**
 * One refusal type for the driver, shaped like the sandbox's and the Claude
 * Code driver's: a `layer` names which control declined, so an assertion can
 * require the right refusal rather than merely some error (I5).
 */
export type DriverRefusalLayer =
  /** No sandbox provider: there is no host fallback (I1). */
  | 'provider'
  /** The operator's configuration is missing a field, or holds one the driver cannot use as written. */
  | 'configuration'
  /** A tool the request grants is not one this driver declares (I4). */
  | 'grant'
  /** A capability the request needs is not one this driver declares. */
  | 'capability'
  /** The in-sandbox call could not be made, the task was cancelled, or it ran past its bounds. */
  | 'invocation'
  /** The endpoint answered with an error, or with a body the driver cannot read. */
  | 'endpoint'
  /** The endpoint answered as a model other than the one the request named (I6). */
  | 'identity'
  /** The relay refused the call because the task's budget is spent (P13). */
  | 'budget';

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
