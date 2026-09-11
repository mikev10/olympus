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
import { resolve as resolvePath } from 'node:path';
import type { EgressPolicy, ExecResult, SandboxCapabilities, SandboxHandle, SandboxProvider, SandboxSpec } from '../types.js';
import { CliTimeout, dockerCli, probeDaemon, type DaemonFacts } from './docker.js';
import { mountArgument, mountTable, resolveMounts, type ResolvedMount } from './mounts.js';
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
}

/**
 * What the provider actually applied to one container. Recorded rather than
 * assumed: "egress is denied" is a claim, and this is the evidence for it,
 * readable by an auditor and by the conformance suite.
 */
export interface AppliedControls {
  readonly containerId: string;
  readonly mounts: readonly ResolvedMount[];
  /** The Docker network mode. `none` is `deny-all` applied; nothing else is reachable from this provider. */
  readonly network: 'none';
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

/**
 * `deny-all` is `--network none`, which the kernel enforces: the container
 * gets a loopback interface and nothing else. `allowlist` has no
 * implementation here — enforcing one needs a filtering proxy the container
 * is forced through, which is not in this unit — so it is refused. Treating
 * an allowlist as deny-all would break the run silently, and treating it as
 * allow-all would grant the network to a policy that asked for a subset. I5:
 * a control that cannot be enforced is a refusal, not a default.
 */
function checkEgress(egress: EgressPolicy): void {
  if (egress.mode === 'deny-all') {
    if (egress.allow.length > 0) {
      refuse('egress', `egress.mode is deny-all but ${String(egress.allow.length)} allow entries are set; the policy contradicts itself and is refused rather than half-applied`);
    }
    return;
  }
  refuse(
    'egress',
    'egress.mode "allowlist" is not enforceable by this provider: an allowlist needs a filtering proxy the container is ' +
      'forced through, and none exists at M1. It is refused rather than silently applied as deny-all or as allow-all.',
  );
}

function runArgsFor(spec: SandboxSpec, mounts: readonly ResolvedMount[], name: string): string[] {
  const args = ['run', '--detach', '--init', '--name', name, '--network', 'none'];
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
  readonly #sandboxes = new Map<SandboxHandle, Sandbox>();

  private constructor(executable: string, vaultPaths: readonly string[], daemon: DaemonFacts) {
    this.#executable = executable;
    this.#vaultPaths = vaultPaths;
    this.#daemon = daemon;
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
    return new LocalDockerProvider(executable, vaultPaths, daemon);
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
    checkEgress(spec.egress);
    checkLimits(spec.limits);

    // Re-validated rather than trusted: the table may have been built by a cast, parsed from a
    // document, or handed over by JavaScript, in which case the type-level guarantee never ran.
    const table = mountTable({ workspace: spec.mounts.workspace, others: spec.mounts.others });
    const mounts = await resolveMounts(table, this.#vaultPaths);

    // I10: no Greek name in code, container names included. This one reaches `docker ps`.
    const name = `sandbox-${randomUUID()}`;
    const args = runArgsFor(spec, mounts, name);
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
        network: 'none',
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

  async exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult> {
    const sandbox = this.#require(h);
    if (sandbox.ended !== undefined) refuse('lifetime', `sandbox ${h} has ended: ${sandbox.ended}`);
    if (cmd.length === 0) refuse('handle', 'the command is empty; there is nothing to run');

    const remaining = sandbox.controls.deadline - performance.now();
    const budget = String(sandbox.controls.limits.wallClockMs);
    if (remaining <= 0) {
      await this.#end(sandbox, `its wall-clock budget of ${budget}ms was already spent`);
      refuse('lifetime', `sandbox ${h} is past its wall-clock limit of ${budget}ms; the command was not started`);
    }

    try {
      const result = await dockerCli(this.#executable, ['exec', sandbox.controls.containerId, ...cmd], { timeoutMs: remaining });
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
    sandbox.ending = this.#remove(sandbox.controls.containerId);
    return sandbox.ending;
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
