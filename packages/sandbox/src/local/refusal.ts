/**
 * One refusal type for the whole provider. A refusal is the provider
 * declining to give a caller something it cannot enforce; it is never a
 * warning, never a downgrade, and never a container that came up with fewer
 * controls than the spec asked for (I5).
 *
 * `layer` names which control refused, so a caller — and a conformance
 * assertion — can require the *right* refusal rather than merely some error.
 * A test that accepts any throw passes when the daemon is missing, the image
 * is wrong, or the code has a typo, and proves nothing about the control it
 * claims to cover.
 */
export type RefusalLayer =
  /** The mount table: a second rw mount, a malformed path, an overlap, or a source that lands on the Vault. */
  | 'mount'
  /** The egress policy asked for something this provider cannot enforce. */
  | 'egress'
  /** A limit was missing, non-finite, or not positive. */
  | 'limits'
  /** The image reference was unusable, or the container did not come up. */
  | 'image'
  /** The sandbox's wall-clock budget is spent. */
  | 'lifetime'
  /** The handle is not one this provider issued, or the command is empty. */
  | 'handle';

export class SandboxRefusal extends Error {
  override readonly name = 'SandboxRefusal';
  constructor(
    readonly layer: RefusalLayer,
    message: string,
  ) {
    super(message);
  }
}

export function refuse(layer: RefusalLayer, message: string): never {
  throw new SandboxRefusal(layer, message);
}
