/**
 * LocalDockerProvider: the SandboxProvider contract over a local Docker
 * daemon. This is the substrate every other package's safety rests on, so
 * every control the SandboxSpec names is either applied to the container or
 * the provision is refused. There is no path through this file that returns a
 * handle to a sandbox with fewer controls than were asked for.
 *
 * The container is started detached with a keep-alive command and each
 * `exec()` is a `docker exec` into it, so the mount table, the network mode,
 * and the cgroup limits are set once, by `docker run`, and cannot be varied
 * per command afterwards.
 */
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import type { ExecOptions, ExecResult, SandboxCapabilities, SandboxHandle, SandboxProvider, SandboxSpec } from '../types.js';
import { CliTimeout, dockerCli, probeDaemon, type DaemonFacts } from './docker.js';
import { checkEgress, type EgressPlan } from './egress.js';
import { mountArgument, mountTable, resolveMounts, type ResolvedMount } from './mounts.js';
import { EGRESS_PROXY_IMAGE, PROXY_ALIAS, PROXY_PORT, startProxy, stopProxy, type AppliedProxy, type ProxyOptions } from './proxy.js';
import { refuse } from './refusal.js';

/**
 * A POSIX keep-alive. `sleep infinity` is a GNU and BusyBox extension, and a
 * loop that sleeps in bounded steps runs on any shell; the wall-clock budget,
 * not this number, is what ends the container.
 */
const KEEP_ALIVE = 'while :; do sleep 3600; done';

/** How long the lifecycle commands themselves may take. Distinct from the sandbox's own budget. */
const LIFECYCLE_TIMEOUT_MS = 120_000;

export interface LocalDockerOptions {
  /**
   * Host directories the Vault owns. No mount may be one, sit inside one, or
   * contain one, at any mode. Required and not defaulted: a provider that
   * defaulted this to an empty list would enforce I1 against nothing, and the
   * caller that forgot would never find out.
   */
  readonly vaultPaths: readonly string[];
  /** The Docker executable. Defaults to `docker` on PATH. */
  readonly executable?: string;
  /**
   * The image the egress proxy runs on. Defaults to the digest this package
   * pins. Overridable so an air-gapped host can name a mirror of the same
   * image, not so a different filter can be substituted: the proxy's behaviour
   * is `PROXY_SOURCE`, which this image is handed and runs.
   */
  readonly proxyImage?: string;
}

/**
 * What the provider applied for egress. A discriminated union, so the mode
 * that was asked for and the evidence that it was applied cannot drift apart:
 * `deny-all` can only carry `network: 'none'`, and `allowlist` cannot exist
 * without the proxy that enforces it.
 */
export type AppliedEgress =
  | {
      readonly mode: 'deny-all';
      /**
       * The Docker network mode. `none` is `deny-all` applied: a loopback
       * interface and nothing else, enforced by the kernel. The literal is
       * load-bearing — only this branch can carry it, so a sandbox that
       * records `network: 'none'` is a sandbox that was given it.
       */
      readonly network: 'none';
    }
  | {
      readonly mode: 'allowlist';
      /**
       * The per-sandbox internal network. Created `--internal`, so a container
       * on it has no default route at all and every address off the subnet is
       * unreachable at the kernel, whatever the process believes.
       */
      readonly network: string;
      /** The hosts the proxy will open a connection to, normalised as it matches them. Every other host is refused. */
      readonly allow: readonly string[];
      /**
       * The filtering proxy this sandbox's only route out passes through.
       *
       * `proxy.internalNetwork` is the same string as `network` above, and the
       * suite asserts it. They are kept apart because they are two facts that
       * coincide rather than one written twice: `network` is the mode the
       * *sandbox* container was given, which is what `'none'` is in the other
       * branch, and `proxy.internalNetwork` is a network the *proxy* created
       * and will remove. Either record read alone is complete.
       */
      readonly proxy: AppliedProxy;
    };

/**
 * What the provider actually applied to one container. Recorded rather than
 * assumed: "egress is denied" is a claim, and this is the evidence for it,
 * readable by an auditor and by the conformance suite.
 */
export interface AppliedControls {
  readonly containerId: string;
  readonly mounts: readonly ResolvedMount[];
  /** What was applied for egress, and the evidence for it: the network mode, and for an allowlist the hosts and the proxy that enforces them. */
  readonly egress: AppliedEgress;
  readonly limits: SandboxSpec['limits'];
  /** `performance.now()` reading past which the sandbox is over its wall-clock budget. */
  readonly deadline: number;
  /** The exact argv `docker run` was given, so a reviewer can reproduce the container. */
  readonly runArgs: readonly string[];
}

interface Sandbox {
  readonly controls: AppliedControls;
  /** Set once the budget is spent or the container is destroyed, so a later exec says why rather than failing obscurely. */
  ended?: string;
  /**
   * Destroys the container when the wall-clock budget expires, whether or not
   * anyone calls `exec` again. Cleared when the sandbox ends by another route.
   */
  timer?: NodeJS.Timeout | undefined;
  /**
   * The one in-flight removal. The wall-clock timer and an `exec` that
   * outlives its budget both expire at the same instant and both want the
   * container gone, so without this they issue two concurrent `docker rm`
   * calls for the same container: the second returns as soon as the first has
   * marked it, while removal is still in progress, and a caller that checks
   * immediately afterwards still finds it. One promise, awaited by whoever
   * arrives second.
   */
  ending?: Promise<Error | undefined> | undefined;
}

function checkLimits(limits: SandboxSpec['limits']): void {
  const named: Array<[string, number]> = [
    ['cpus', limits.cpus],
    ['memoryMb', limits.memoryMb],
    ['pids', limits.pids],
    ['wallClockMs', limits.wallClockMs],
  ];
  for (const [name, value] of named) {
    if (!Number.isFinite(value) || value <= 0) {
      refuse('limits', `limits.${name} must be a finite positive number, not ${String(value)}; an unbounded sandbox is refused, not granted`);
    }
  }
  if (!Number.isInteger(limits.memoryMb) || !Number.isInteger(limits.pids)) {
    refuse('limits', 'limits.memoryMb and limits.pids must be whole numbers; Docker takes no fraction of a megabyte or of a process');
  }
}

function checkUser(user: SandboxSpec['user']): void {
  const ids: Array<[string, unknown]> = [['uid', user.uid], ['gid', user.gid]];
  for (const [name, value] of ids) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      refuse('user', `user.${name} must be a whole number of zero or more, not ${String(value)}; a container needs a user it can be matched to its workspace by`);
    }
  }
}

/**
 * Whether the host carries a bind mount's ownership into the container
 * unchanged. A Linux host does, so a container user that is neither the
 * owner nor in the group of a directory without a world-write bit cannot
 * write it. Docker Desktop's file sharing on macOS and Windows maps every
 * container user onto the host user, so there is no ownership to mismatch.
 */
const HOST_ENFORCES_OWNERSHIP = process.platform === 'linux';

/**
 * I5: a rw workspace the container's user cannot write is refused here. Mounted
 * as it is, every write the task attempts fails, and the run reads as a model
 * that chose not to act rather than a mount the runtime got wrong (A-P6-04).
 */
async function checkWorkspaceWritable(workspace: ResolvedMount, user: SandboxSpec['user']): Promise<void> {
  if (workspace.mode !== 'rw' || !HOST_ENFORCES_OWNERSHIP || user.uid === 0) return;
  const facts = await stat(workspace.source);
  const writable =
    facts.uid === user.uid ? (facts.mode & 0o200) !== 0 : facts.gid === user.gid ? (facts.mode & 0o020) !== 0 : (facts.mode & 0o002) !== 0;
  if (!writable) {
    refuse(
      'user',
      `the workspace ${workspace.declared} is owned by ${String(facts.uid)}:${String(facts.gid)} with mode ${(facts.mode & 0o777).toString(8)}, ` +
        `which uid ${String(user.uid)} gid ${String(user.gid)} cannot write; a task handed it could not change anything, so it is refused rather than mounted`,
    );
  }
}

/**
 * The proxy environment variables the sandbox is given under an allowlist.
 *
 * They are a convenience for the process inside, not the control: the control
 * is that the internal network carries no default route, so a process that
 * ignores or unsets every one of these reaches nothing at all. Loopback is
 * exempted so a container talking to itself does not take a detour through a
 * proxy that would refuse it.
 */
function proxyEnvironment(): string[] {
  const url = `http://${PROXY_ALIAS}:${String(PROXY_PORT)}`;
  const loopback = 'localhost,127.0.0.1,::1';
  return [
    '--env', `HTTP_PROXY=${url}`,
    '--env', `http_proxy=${url}`,
    '--env', `HTTPS_PROXY=${url}`,
    '--env', `https_proxy=${url}`,
    '--env', `NO_PROXY=${loopback}`,
    '--env', `no_proxy=${loopback}`,
  ];
}

/**
 * A plain environment-variable name: a letter or underscore, then letters,
 * digits, and underscores. Narrower than POSIX allows, deliberately — a name
 * outside this set is far more likely to be a caller building `NAME=value`
 * into the key than a variable anyone meant to set.
 */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Turns the names and values a caller asked for into `docker exec` flags and
 * an environment for the `docker` process itself.
 *
 * `-e NAME` with no `=value` makes the CLI read that name from its own
 * environment, so the value travels through the daemon API and appears in no
 * argument vector — not the one this process spawns, and not the one the
 * command runs under inside the container. A secret in an argv is readable by
 * anything that can list processes, and a credential is exactly what this
 * exists to carry.
 *
 * Every refusal here is the fail-closed one (I5): a command that lost its
 * credential does not fail where the credential was lost. It fails later,
 * inside the model runner, with a message about authentication that says
 * nothing about the provider having dropped it.
 */
function environmentPassthrough(env: Readonly<Record<string, string>> | undefined): {
  flags: string[];
  values: Record<string, string> | undefined;
} {
  if (env === undefined) return { flags: [], values: undefined };
  const names = Object.keys(env);
  if (names.length === 0) return { flags: [], values: undefined };

  const flags: string[] = [];
  const values: Record<string, string> = {};
  for (const name of names) {
    if (!ENV_NAME.test(name)) {
      refuse('environment', `${JSON.stringify(name)} is not an environment variable name; a name is a letter or underscore followed by letters, digits, and underscores`);
    }
    // `noUncheckedIndexedAccess` makes this `string | undefined`, which is the
    // honest type: a caller can pass an explicit `undefined` as easily as omit
    // a key, and both must refuse rather than send an empty value through.
    const value = env[name];
    if (value === undefined) {
      refuse('environment', `${name} was named in ExecOptions.env with no value; the command was not started rather than run without it`);
    }
    flags.push('--env', name);
    values[name] = value;
  }
  return { flags, values };
}

function runArgsFor(spec: SandboxSpec, mounts: readonly ResolvedMount[], name: string, egress: AppliedEgress): string[] {
  const args = ['run', '--detach', '--init', '--name', name, '--network', egress.network, '--user', `${String(spec.user.uid)}:${String(spec.user.gid)}`];
  if (egress.mode === 'allowlist') args.push(...proxyEnvironment());
  for (const mount of mounts) args.push('--mount', mountArgument(mount));
  args.push(
    '--cpus', String(spec.limits.cpus),
    '--memory', `${String(spec.limits.memoryMb)}m`,
    '--pids-limit', String(spec.limits.pids),
    '--entrypoint', 'sh',
    spec.image,
    '-c', KEEP_ALIVE,
  );
  return args;
}

export class LocalDockerProvider implements SandboxProvider {
  readonly id = 'local-docker';

  readonly #executable: string;
  readonly #vaultPaths: readonly string[];
  readonly #daemon: DaemonFacts;
  readonly #proxyImage: string;
  readonly #sandboxes = new Map<SandboxHandle, Sandbox>();

  private constructor(executable: string, vaultPaths: readonly string[], daemon: DaemonFacts, proxyImage: string) {
    this.#executable = executable;
    this.#vaultPaths = vaultPaths;
    this.#daemon = daemon;
    this.#proxyImage = proxyImage;
  }

  /** The options the proxy's own lifecycle commands run under. */
  get #proxyOptions(): ProxyOptions {
    return { executable: this.#executable, image: this.#proxyImage, timeoutMs: LIFECYCLE_TIMEOUT_MS };
  }

  /**
   * The only way to build one. The daemon is probed first and the provider is
   * not constructed unless it is there, runs Linux containers, and is local —
   * the three things `capabilities()` goes on to claim. A provider that
   * existed without a daemon would have to answer `capabilities()` with a
   * guess, and every assertion built on it would be asserting the guess.
   */
  static async create(options: LocalDockerOptions): Promise<LocalDockerProvider> {
    const executable = options.executable ?? 'docker';
    const daemon = await probeDaemon(executable);
    const vaultPaths = options.vaultPaths.map((path) => resolvePath(path));
    return new LocalDockerProvider(executable, vaultPaths, daemon, options.proxyImage ?? EGRESS_PROXY_IMAGE);
  }

  /** What the probe established about the daemon behind this provider. */
  daemon(): DaemonFacts {
    return this.#daemon;
  }

  /** What was applied to one sandbox. Throws for a handle this provider did not issue. */
  appliedControls(h: SandboxHandle): AppliedControls {
    return this.#require(h).controls;
  }

  async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    if (spec.image.trim() === '') refuse('image', 'SandboxSpec.image is empty; there is no image to run');
    const plan = checkEgress(spec.egress);
    checkLimits(spec.limits);
    checkUser(spec.user);

    // Re-validated rather than trusted: the table may have been built by a cast, parsed from a
    // document, or handed over by JavaScript, in which case the type-level guarantee never ran.
    const table = mountTable({ workspace: spec.mounts.workspace, others: spec.mounts.others });
    const mounts = await resolveMounts(table, this.#vaultPaths);
    const workspace = mounts.find((mount) => mount.target === table.workspace.target);
    // resolveMounts returns one entry per table entry, the workspace among them.
    if (workspace === undefined) refuse('mount', 'the resolved mount table has no workspace');
    await checkWorkspaceWritable(workspace, spec.user);

    // I10: no Greek name in code, container names included. This one reaches `docker ps`.
    const id = randomUUID();
    const name = `sandbox-${id}`;
    const egress = await this.#applyEgress(id, plan);
    try {
      return await this.#start(spec, mounts, name, egress);
    } catch (error) {
      // Whatever refused, the proxy and its networks were created for a sandbox that does not
      // exist. They go with it: a leaked route out is worse than the failure that caused it.
      if (egress.mode === 'allowlist') await stopProxy(egress.proxy, this.#proxyOptions);
      throw error;
    }
  }

  /**
   * Starts the proxy an allowlist needs, or nothing at all.
   *
   * `deny-all` is untouched by this unit: no network is created, no proxy is
   * started, and the container is given `--network none` exactly as before.
   * Starting a proxy beside a sandbox entitled to no egress would put a route
   * out next to the one policy that asked for none.
   */
  async #applyEgress(id: string, plan: EgressPlan): Promise<AppliedEgress> {
    if (plan.mode === 'deny-all') return { mode: 'deny-all', network: 'none' };
    let proxy: AppliedProxy;
    try {
      proxy = await startProxy(id, plan.hosts, this.#proxyOptions);
    } catch (error) {
      // I5: an allowlist this provider could not stand up is a refusal. There is no fallback to
      // deny-all, which breaks the run silently, and none to a routed network, which hands the
      // whole of it to a policy that asked for a subset.
      refuse(
        'egress',
        'the egress allowlist could not be enforced, so no sandbox was provisioned: ' +
          (error instanceof Error ? error.message : String(error)),
      );
    }
    return { mode: 'allowlist', network: proxy.internalNetwork, allow: plan.hosts, proxy };
  }

  async #start(spec: SandboxSpec, mounts: readonly ResolvedMount[], name: string, egress: AppliedEgress): Promise<SandboxHandle> {
    const args = runArgsFor(spec, mounts, name, egress);
    const started = await dockerCli(this.#executable, args, { timeoutMs: LIFECYCLE_TIMEOUT_MS });
    if (started.exitCode !== 0) {
      refuse('image', `docker run exited ${String(started.exitCode)} for image ${spec.image}: ${started.stderr.trim() || started.stdout.trim()}`);
    }
    const containerId = started.stdout.trim();
    if (containerId === '') refuse('image', 'docker run reported no container id, so there is no sandbox to hand back');

    // A container that exits immediately — a shell-less image, a bad entrypoint — would otherwise
    // hand back a handle whose every exec fails obscurely.
    const running = await dockerCli(this.#executable, ['inspect', '--format', '{{.State.Running}}', containerId], {
      timeoutMs: LIFECYCLE_TIMEOUT_MS,
    });
    if (running.stdout.trim() !== 'true') {
      // Best effort: the refusal below is the reason the caller needs, and a container that
      // never started is not one this provider is handing out a handle to.
      await this.#remove(containerId);
      refuse('image', `the container from image ${spec.image} was not running after start; it needs a POSIX shell at \`sh\` to hold itself open`);
    }

    const handle = containerId as SandboxHandle;
    const sandbox: Sandbox = {
      controls: {
        containerId,
        mounts,
        egress,
        limits: { ...spec.limits },
        deadline: performance.now() + spec.limits.wallClockMs,
        runArgs: Object.freeze([...args]),
      },
    };
    this.#sandboxes.set(handle, sandbox);

    // The budget has to be enforced by something that runs on its own. Checking it inside `exec`
    // bounds only sandboxes somebody keeps calling: a task that starts a background process and
    // is never exec'd again would outlive its limit entirely, which is the whole thing the limit
    // exists to prevent. Review finding 2.
    const timer = setTimeout(() => {
      void this.#expire(sandbox, spec.limits.wallClockMs);
    }, spec.limits.wallClockMs);
    // The runtime is a service (I9), and a pending timer must never be the reason its process
    // stays alive. An unref'd timer still fires for as long as the process is running.
    timer.unref();
    sandbox.timer = timer;
    return handle;
  }

  async exec(h: SandboxHandle, cmd: string[], options: ExecOptions = {}): Promise<ExecResult>  {
    const sandbox = this.#require(h);
    if (sandbox.ended !== undefined) refuse('lifetime', `sandbox ${h} has ended: ${sandbox.ended}`);
    if (cmd.length === 0) refuse('handle', 'the command is empty; there is nothing to run');
    const passthrough = environmentPassthrough(options.env);

    const remaining = sandbox.controls.deadline - performance.now();
    const budget = String(sandbox.controls.limits.wallClockMs);
    if (remaining <= 0) {
      await this.#end(sandbox, `its wall-clock budget of ${budget}ms was already spent`);
      refuse('lifetime', `sandbox ${h} is past its wall-clock limit of ${budget}ms; the command was not started`);
    }

    try {
      const result = await dockerCli(
        this.#executable,
        // `--interactive` keeps the container process's stdin attached to the one `docker` is given
        // (A-P8-02). Without it the bytes would reach the CLI and stop there, and the command would
        // run as if it had been handed nothing.
        ['exec', ...(options.stdin === undefined ? [] : ['--interactive']), ...passthrough.flags, sandbox.controls.containerId, ...cmd],
        {
          timeoutMs: remaining,
          ...(passthrough.values === undefined ? {} : { env: passthrough.values }),
          ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        },
      );
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs };
    } catch (error) {
      if (!(error instanceof CliTimeout)) throw error;
      // The budget is the sandbox's, not the command's: the container goes with it, so nothing
      // left running inside outlives the limit that was supposed to bound it.
      const removal = await this.#end(sandbox, `it exceeded its wall-clock limit of ${budget}ms`);
      if (removal !== undefined) {
        // The breach is still the headline, but a container that outlived its budget *and*
        // could not be removed is worse than one that was, and must not be reported as less.
        refuse('lifetime', `sandbox ${h} exceeded its wall-clock limit of ${budget}ms and could not be destroyed: ${removal.message}`);
      }
      refuse('lifetime', `sandbox ${h} exceeded its wall-clock limit of ${budget}ms and was destroyed`);
    }
  }

  async destroy(h: SandboxHandle): Promise<void> {
    const sandbox = this.#require(h);
    if (sandbox.ended !== undefined) refuse('lifetime', `sandbox ${h} has already ended: ${sandbox.ended}`);
    const removal = await this.#end(sandbox, 'it was destroyed');
    if (removal !== undefined) throw removal;
  }

  /**
   * Each value is asserted against a provisioned container by the conformance
   * registry (I8), so flipping one here without changing what the provider
   * does fails the suite. `persistent` is true because one container serves
   * every exec; the others are false or `linux` because `create()` refused to
   * build a provider for which they were not.
   */
  capabilities(): SandboxCapabilities {
    return { computerUse: false, gpu: false, os: this.#daemon.osType, persistent: true, remote: false };
  }

  #require(h: SandboxHandle): Sandbox {
    const sandbox = this.#sandboxes.get(h);
    if (sandbox === undefined) refuse('handle', `${h} is not a handle this provider issued`);
    return sandbox;
  }

  /**
   * Ends a sandbox and keeps its record. The record is not deleted, for two
   * reasons: a later call then says the sandbox ended and why, instead of
   * "unknown handle" for a container the runtime itself destroyed; and
   * `appliedControls()` keeps answering afterwards, so what was enforced on a
   * sandbox outlives the sandbox and can still be read when the run is
   * audited. Returns the removal failure rather than throwing it, so a caller
   * that is already refusing for a better reason can decide which to report.
   */
  async #end(sandbox: Sandbox, why: string): Promise<Error | undefined> {
    // Whoever gets here second awaits the first removal rather than starting another, and so
    // does not return until the container is actually gone.
    if (sandbox.ending !== undefined) return sandbox.ending;
    sandbox.ended = why;
    if (sandbox.timer !== undefined) {
      clearTimeout(sandbox.timer);
      sandbox.timer = undefined;
    }
    sandbox.ending = this.#dismantle(sandbox.controls);
    return sandbox.ending;
  }

  /**
   * Removes everything one sandbox was given: the container, and under an
   * allowlist the proxy container and both its networks.
   *
   * The proxy goes with the sandbox it serves and with nothing else. A proxy
   * that outlived its sandbox would be a route out with no workload behind it
   * and nobody watching it, and the assertion that counts leaked containers is
   * there to make that a failing test rather than a thing somebody notices in
   * `docker ps` a week later.
   */
  async #dismantle(controls: AppliedControls): Promise<Error | undefined> {
    // The container first: a network still holding an endpoint cannot be removed.
    const container = await this.#remove(controls.containerId);
    if (controls.egress.mode === 'deny-all') return container;
    const proxy = await stopProxy(controls.egress.proxy, this.#proxyOptions);
    return container ?? proxy;
  }

  /**
   * The wall-clock timer firing. Nothing is waiting on this call, so a removal
   * failure has no caller to refuse: it is recorded on the sandbox, where the
   * next `exec` or `destroy` reports it, rather than raised as an unhandled
   * rejection.
   */
  async #expire(sandbox: Sandbox, budgetMs: number): Promise<void> {
    if (sandbox.ending !== undefined) return;
    const removal = await this.#end(sandbox, `it exceeded its wall-clock limit of ${String(budgetMs)}ms`);
    if (removal !== undefined) {
      sandbox.ended = `it exceeded its wall-clock limit of ${String(budgetMs)}ms and could not be destroyed: ${removal.message}`;
    }
  }

  async #remove(containerId: string): Promise<Error | undefined> {
    const removed = await dockerCli(this.#executable, ['rm', '--force', '--volumes', containerId], {
      timeoutMs: LIFECYCLE_TIMEOUT_MS,
    });
    if (removed.exitCode === 0) return undefined;
    return new Error(`docker rm exited ${String(removed.exitCode)} for container ${containerId}: ${removed.stderr.trim()}`);
  }
}
