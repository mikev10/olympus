/**
 * The Docker CLI, run as a child process with no shell. Every argument is an
 * element of an argv array, so nothing a caller supplies can be read as shell
 * syntax.
 *
 * The CLI rather than the daemon socket: an argv array is auditable in a way
 * a hand-rolled HTTP client over a named pipe is not, the flags that carry
 * the limits are the documented surface, and a reviewer can paste the command
 * this module builds into a terminal and see the same container. The cost is
 * one process per call, which is nothing beside pulling an image.
 */
import { spawn } from 'node:child_process';

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

export interface CliOptions {
  /** Milliseconds before the child is killed and `timedOut` is thrown. Omitted means no bound. */
  readonly timeoutMs?: number;
}

/** Thrown when a call exceeded its bound. The caller decides what the bound meant. */
export class CliTimeout extends Error {
  override readonly name = 'CliTimeout';
  constructor(readonly elapsedMs: number) {
    super(`the docker command did not finish within ${String(elapsedMs)}ms`);
  }
}

/** Thrown when the `docker` executable itself could not be run. */
export class DockerUnavailable extends Error {
  override readonly name = 'DockerUnavailable';
}

/**
 * Runs `docker` with the given arguments. Resolves with whatever exit code
 * the CLI produced, including a non-zero one: deciding what a failure means
 * belongs to the caller, not here.
 */
export function dockerCli(executable: string, args: string[], options: CliOptions = {}): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const started = performance.now();
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    let settled = false;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      finish();
    };

    if (options.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        const elapsed = performance.now() - started;
        child.kill('SIGKILL');
        settle(() => {
          rejectPromise(new CliTimeout(elapsed));
        });
      }, options.timeoutMs);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on('error', (error: Error) => {
      settle(() => {
        rejectPromise(new DockerUnavailable(`${executable} could not be run: ${error.message}`));
      });
    });
    child.on('close', (code) => {
      settle(() => {
        resolvePromise({
          // A child killed by a signal reports a null code. The only signal this module sends is
          // the timeout kill above, which has already rejected; anything else is the host killing
          // docker, which is a failure and is reported as one rather than as a zero exit.
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          durationMs: performance.now() - started,
        });
      });
    });
  });
}

/** What the daemon this provider will talk to actually is. */
export interface DaemonFacts {
  readonly osType: 'linux';
  readonly serverVersion: string;
  /** The context endpoint, e.g. `npipe:////./pipe/dockerDesktopLinuxEngine` or `unix:///var/run/docker.sock`. */
  readonly endpoint: string;
}

/** A local endpoint is a pipe or a socket on this machine; anything routed is remote. */
function isLocalEndpoint(endpoint: string): boolean {
  return endpoint.startsWith('unix://') || endpoint.startsWith('npipe://');
}

/**
 * Establishes what the daemon is, or refuses. There is no third outcome: a
 * provider that cannot reach a daemon, or reaches one that does not match
 * what `capabilities()` claims, must not be constructed at all. Skipping the
 * work it was going to do is the degrade I5 forbids.
 */
export async function probeDaemon(executable: string): Promise<DaemonFacts> {
  let info: CliResult;
  try {
    info = await dockerCli(executable, ['info', '--format', '{{.OSType}}|{{.ServerVersion}}|{{.Name}}']);
  } catch (error) {
    throw new DockerUnavailable(
      `LocalDockerProvider requires a Docker daemon and there is none: ${error instanceof Error ? error.message : String(error)}. ` +
        'The mount layer is where I1 is enforced, and it cannot be enforced without containers.',
    );
  }
  if (info.exitCode !== 0) {
    throw new DockerUnavailable(
      `LocalDockerProvider requires a running Docker daemon; \`${executable} info\` exited ${String(info.exitCode)}: ` +
        (info.stderr.trim() || info.stdout.trim()),
    );
  }

  const [osType, serverVersion] = info.stdout.trim().split('|');
  if (osType !== 'linux') {
    throw new DockerUnavailable(
      `LocalDockerProvider requires a Linux-container daemon; this one reports ${String(osType)}. ` +
        'The mount modes, --network none, and the cgroup limits this provider relies on are Linux behaviour, ' +
        'and claiming them against another daemon would be a claim without an enforcement.',
    );
  }
  if (serverVersion === undefined || serverVersion === '') {
    throw new DockerUnavailable(`\`${executable} info\` did not report a server version; the daemon's identity is unverified`);
  }

  const context = await dockerCli(executable, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  const endpoint = context.exitCode === 0 ? context.stdout.trim() : '';
  if (endpoint === '') {
    throw new DockerUnavailable(
      `\`${executable} context inspect\` did not report an endpoint, so this provider cannot tell a local daemon from a remote one, ` +
        'and it claims `remote: false`',
    );
  }
  if (!isLocalEndpoint(endpoint)) {
    throw new DockerUnavailable(
      `LocalDockerProvider declares \`remote: false\` but this context points at ${endpoint}. ` +
        'Provisioning on a remote worker is M4b; a provider that did it while claiming otherwise would break I8.',
    );
  }

  return { osType, serverVersion, endpoint };
}
