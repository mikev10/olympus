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
  | 'handle'
  /** A variable named in `ExecOptions.env` is not a usable name, or has no value to pass. */
  | 'environment'
  /** The user is not a uid and gid, or cannot write the rw workspace on a host that enforces ownership. */
  | 'user'
  /** A relay request this provider cannot apply: an unheld credential, an upstream that is not an https origin, an empty grant, an upstream host the allowlist also names, or a relay that did not come up. */
  | 'relay';

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

/**
 * The error a failed start reports once its cleanup has run: the failure that
 * stopped it, and, when the cleanup failed too, what the cleanup left behind.
 * A refusal keeps its layer, so a caller still sees the right refusal. A relay
 * container holds its credential, so one left on the host is reported rather
 * than dropped in favour of the better reason (external review, codex-3).
 */
export function withLeftovers(error: unknown, leftovers: Error | undefined): unknown {
  if (leftovers === undefined) return error;
  const why = `${error instanceof Error ? error.message : String(error)} — and cleaning up after it failed: ${leftovers.message}`;
  return error instanceof SandboxRefusal ? new SandboxRefusal(error.layer, why) : new Error(why);
}
