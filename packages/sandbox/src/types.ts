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
  /**
   * What one driver call may spend through this relay (A-P13-01). The relay
   * counts what each response used and refuses every request once either
   * bound is reached, so a call begun under budget may end over it by at most
   * one call (D-P13-03). Each bound MUST be a positive finite number.
   */
  budget: RelayBudget;
  /** How the relay reads what a call used and prices it. A dialect the implementation does not know is refused (D-P13-06). */
  meter: RelayMeter;
}

/** One driver call's spending bounds. `maxTokens` sums all four token classes (D-P13-05). */
export interface RelayBudget {
  maxTokens: number;
  maxCostUsd: number;
}

/** US dollars per million tokens of each class. Each MUST be a non-negative finite number. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  /** A cache write held five minutes. */
  cacheWritePerMTok: number;
  /** A cache write held an hour. A write whose duration the response does not report is charged at this price. */
  cacheWrite1hPerMTok: number;
}

/**
 * Where the usage sits in a response, and what each model costs. The dialect
 * is a closed union so a relay never guesses at a response it was not built to
 * read; a model absent from `prices` is refused before its request is sent.
 */
export interface RelayMeter {
  dialect: 'anthropic-messages';
  /** Keyed by the exact model name a request carries. Never empty. */
  prices: Readonly<Record<string, ModelPrice>>;
}

/**
 * What a sandbox's relay counted, read by `destroy` after the sandbox stopped
 * (A-P13-02). `unmetered` is a sandbox with no relay, stated rather than
 * reported as zero, so a caller never presents an uncounted call as free.
 *
 * `exhausted` is the first reason the relay stopped forwarding, or `'none'`;
 * `refused` counts the requests the meter refused, the budget's refusals and
 * an unpriced model's among them.
 */
export type MeterReading =
  | { readonly kind: 'unmetered' }
  | {
      readonly kind: 'metered';
      readonly calls: number;
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheReadTokens: number;
      readonly cacheWriteTokens: number;
      readonly costUsd: number;
      readonly exhausted: 'none' | 'tokens' | 'cost' | 'unreadable';
      readonly refused: number;
    };

/**
 * One connection the egress proxy decided (A-P14-02): `opened` for an
 * absolute-form `http://` request it permitted to be forwarded, `tunnelled`
 * for a `CONNECT` it permitted to be joined, `refused` for either kind to a
 * host outside the allowlist, or for any request with no readable host. The
 * verdict is the proxy's decision, logged before it acts on it: a permitted
 * connection whose upstream then fails is still `opened` or `tunnelled`, and
 * the client is answered 502. `host` is null when the request named none.
 * `at` is the proxy's own clock when it decided.
 */
export interface EgressConnection {
  readonly verdict: 'opened' | 'tunnelled' | 'refused';
  readonly host: string | null;
  readonly at: string;
}

/** Every connection a sandbox's proxy decided, in the order it logged them, or `none` for a sandbox with no proxy. */
export type EgressLog =
  | { readonly kind: 'none' }
  | { readonly kind: 'proxied'; readonly connections: readonly EgressConnection[] };

/** What `destroy` read from a sandbox's sidecars after they stopped (A-P13-02, A-P14-02). */
export interface Teardown {
  readonly meter: MeterReading;
  readonly egress: EgressLog;
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
  /**
   * Start the command and return once it has started, with no output; it runs
   * until it exits or the sandbox ends. It exists so an HTTP scenario can start
   * the server it probes (A-P11-02). The result's exit code is the start's,
   * not the command's. An implementation MUST refuse it together with `stdin`,
   * which a detached command cannot be handed, and one that cannot detach MUST
   * refuse rather than run the command to completion.
   */
  readonly detach?: boolean;
}

/** One request a probe sends. `path` begins with `/`; the host is always the sandbox's own loopback. */
export interface ProbeExchange {
  readonly method: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * What a probe is asked to do (A-P11-01). A port and never a URL: the probe
 * reaches the sandbox's loopback and no other host, so it cannot be pointed
 * anywhere the sandbox could not already reach.
 */
export interface ProbeRequest {
  readonly port: number;
  /** How long the port has to accept a connection before the probe gives up and sends nothing. */
  readonly readyWithinMs: number;
  /** Sent in order, one at a time, each on its own connection. */
  readonly exchanges: readonly [ProbeExchange, ...ProbeExchange[]];
}

/**
 * What the probe saw for one request, and nothing it decided. `oversized` is a
 * response whose body passed the cap, reported without a body rather than
 * with a truncated one a comparison could mistake for the whole.
 */
export type ProbeObservation =
  | { readonly kind: 'response'; readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string }
  | { readonly kind: 'oversized'; readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly limitBytes: number }
  | { readonly kind: 'no-response'; readonly reason: string };

/**
 * `ready: false` means the port never accepted a connection within
 * `readyWithinMs`, and `observations` is empty because nothing was sent.
 * Otherwise there is one observation per exchange, in order.
 */
export interface ProbeResult {
  readonly ready: boolean;
  readonly observations: readonly ProbeObservation[];
  readonly durationMs: number;
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
  /**
   * Sends HTTP requests to the sandbox's own loopback from a client the
   * sandbox's processes cannot reach: one that shares the sandbox's network
   * and not its filesystem or process tree, so what it observed is not the
   * product's report of itself (A-P11-01). Optional: a provider that cannot
   * put the client out of the product's reach omits it, and a set built on
   * that provider names `behavioral:http` unavailable. An implementation MUST
   * connect to the sandbox's loopback and nothing else, MUST charge the call
   * to the sandbox's wall-clock budget as `exec` does, and MUST refuse a call
   * on an ended sandbox.
   */
  probe?(h: SandboxHandle, request: ProbeRequest): Promise<ProbeResult>;
  /**
   * Ends the sandbox and returns what its relay counted and what its egress
   * proxy decided, each read after the sidecar stopped so nothing spends or
   * connects after the read (D-P13-07, D-P14-03). A sandbox with no relay
   * returns `meter: { kind: 'unmetered' }`, and one with no proxy
   * `egress: { kind: 'none' }`. A provider that had a relay or a proxy and
   * cannot read its record MUST throw rather than return a reading, and MUST
   * still tear the sidecar down.
   */
  destroy(h: SandboxHandle): Promise<Teardown>;
  capabilities(): SandboxCapabilities;
}
