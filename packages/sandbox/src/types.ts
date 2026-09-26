/**
 * Sandbox: the ephemeral, agent-writable execution substrate. The mount table
 * is where I1 is physically enforced.
 */
export type SandboxHandle = string & { readonly __brand: 'SandboxHandle' };

export interface MountEntry {
  source: string;
  target: string;
  mode: 'ro' | 'rw';
}

/**
 * I1 enforced at the substrate: at most one rw mount, and if there is one, it
 * is the Workspace. `others` admits ro only, so a second rw mount has no slot;
 * the Workspace itself is rw for build and ro for verification, so the checks
 * run against a tree they cannot modify (I3). Implementations MUST reject
 * every table that violates this, MUST mount the Workspace with the mode the
 * table gives it, and MUST resolve symlinks and path escapes before mounting.
 */
export interface MountTable {
  workspace: MountEntry & { mode: 'rw' | 'ro' };
  readonly others: Array<MountEntry & { mode: 'ro' }>;
}

export interface EgressPolicy { mode: 'deny-all' | 'allowlist'; allow: string[]; }

/**
 * A model relay: a provider-owned endpoint that holds a credential the sandbox
 * never does, and forwards the sandbox's requests to one upstream with it
 * (A-P12-01).
 *
 * The spec names the credential and never carries it, because a `SandboxSpec`
 * is a record the runtime may keep and a secret in it is a secret in the
 * record. An implementation resolves `credential` against the credentials it
 * was constructed with.
 *
 * Implementations MUST keep the credential out of the sandbox — out of its
 * environment, its mounts, and every process it runs — and MUST refuse a relay
 * whose credential they were not given, whose `upstream` is not an `https`
 * origin, or whose `paths` is empty, rather than provision a sandbox whose
 * model calls fail later for a reason nothing recorded (I5). An implementation
 * that cannot keep a credential out of a process it runs MUST refuse every
 * spec that carries a relay.
 *
 * A relay is independent of `egress` (D-P12-02): under `deny-all` the sandbox
 * reaches the relay and nothing else. Under `allowlist` the relay is still the
 * only route to its upstream, so implementations MUST refuse an `egress.allow`
 * naming the upstream's host (D-P12-11).
 */
export interface RelaySpec {
  /** An `https` origin with no path: `'https://api.example.com'`. The only origin the relay reaches. */
  upstream: string;
  /** The path prefixes forwarded, each a segment boundary. Every other path is refused. Never empty (D-P12-04). */
  paths: string[];
  /** The one request header the credential is written into. Every authentication header the client sent is discarded. */
  header: string;
  /** The name of a credential the provider holds. Never a value. */
  credential: string;
  /** The environment variable the provider sets in the sandbox to the relay's address, so no caller hard-codes it. */
  urlVariable: string;
}

export interface SandboxSpec {
  image: string;
  mounts: MountTable;
  egress: EgressPolicy;
  limits: { cpus: number; memoryMb: number; pids: number; wallClockMs: number };
  /**
   * Who the container's commands run as. Required, so a provider can match the
   * container to the workspace it was handed: a bind mount carries the host's
   * ownership through unchanged, and a workspace another uid owns is read-only
   * to the task. Where the host enforces that ownership an implementation MUST
   * refuse a rw workspace this user cannot write, never mount it and let the
   * task fail quietly (I5, A-P6-04).
   */
  user: { uid: number; gid: number };
  /** A model relay beside the sandbox, or none. Absent means the sandbox holds no route to one. */
  relay?: RelaySpec;
}

export interface ExecResult { exitCode: number; stdout: string; stderr: string; durationMs: number; }

/**
 * Per-command options. `env` exists so a value can reach a process inside the
 * sandbox without becoming a mount: a secret on the mount table is a file the
 * agent can read, copy, and exfiltrate for the sandbox's whole life, and a
 * secret in a prompt is a secret the model has seen. It does not make a value
 * confidential from the task — every process the command starts can read it,
 * and later ones through `/proc` (D-P5-20) — so a model credential is not
 * passed this way; it stays in a relay (`RelaySpec`).
 *
 * Implementations MUST keep the value out of every argument vector, on the
 * host and in the guest alike, because an argv is world-readable in a process
 * table. They MUST refuse a name that is not a plain environment-variable name
 * and a value that is absent, rather than running the command without it: a
 * command that silently loses its credential fails somewhere later, for a
 * reason nothing in the evidence explains (I5).
 *
 * `stdin` is written to the command's standard input, UTF-8, and the stream is
 * then closed. It exists so a behavioral scenario can feed its process input
 * without a shell wrapper inside the container, which would put part of the
 * scenario where the code under test can reach it (A-P8-02). Omitted, the
 * command has no standard input attached. An implementation that cannot
 * deliver the bytes MUST refuse rather than run the command without them.
 */
export interface ExecOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly stdin?: string;
}

/**
 * I8: every capability claimed here needs an executable conformance assertion
 * (packages/conformance) that fails when the capability is removed.
 *
 * A type alias rather than an interface, for the reason `DriverCapabilities`
 * gives: an interface can be reopened from another compilation unit, and a
 * capability added that way is invisible to the program that holds the
 * registry equal to this type's keys.
 */
export type SandboxCapabilities = {
  computerUse: boolean; gpu: boolean; os: 'linux' | 'macos'; persistent: boolean; remote: boolean;
};

/**
 * M1 implements a local Docker provider only. Remote workers and pools arrive
 * later behind this same interface.
 */
export interface SandboxProvider {
  readonly id: string;
  provision(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(h: SandboxHandle, cmd: string[], options?: ExecOptions): Promise<ExecResult>;
  destroy(h: SandboxHandle): Promise<void>;
  capabilities(): SandboxCapabilities;
}
