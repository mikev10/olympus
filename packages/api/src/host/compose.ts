/**
 * The production composition: the real components, built once through the
 * graph builder, so every run the host serves is admitted against what they
 * can enforce (D-A-I1-05). The CLI composes nothing; it is a client of the
 * service this graph is served by (I9).
 */
import { BASE_IMAGE, ClaudeCodeDriver, ensureImage, MODEL_CREDENTIAL } from '@olympus-ai/driver-claude-code';
import { LocalDockerProvider } from '@olympus-ai/sandbox';
import { LocalVault } from '@olympus-ai/vault';
import { buildGraph, type BuiltGraph, type SandboxProfile } from '../graph.js';
import { GitHubIntegrator, type GitHubIntegratorOptions } from '../integrate.js';
import { localWorkspaceStore, type ContainerUser } from '../workspace.js';

export interface HostConfig {
  /** What the Vault owns. Mounted into no sandbox (I1). */
  readonly store: string;
  /** The working copy runs are admitted from, which locked paths resolve against. Mounted into no sandbox either. */
  readonly repository: string;
  /** Where the runtime keeps each run's trees. Outside both of the above. */
  readonly trees: string;
  /** The model API key. Held by the sandbox provider for its relays and given to no sandbox (A-P12-01). */
  readonly modelKey: string;
  /** The Docker executable. Defaults to `docker` on PATH. */
  readonly docker?: string;
  /** Defaults to `DEFAULT_LIMITS`. */
  readonly limits?: SandboxProfile['limits'];
  /** The image checks run in. Defaults to the Node image the driver's image is built from. */
  readonly checkImage?: string;
  /**
   * The remote a passed run is merged into, and the token that merges it,
   * held here and handed to no sandbox provider (D-I1b-06). Null composes a
   * host that cannot merge, which carries no run above L1 (D-I1b-05).
   */
  readonly git: GitHubIntegratorOptions | null;
  /**
   * Who sandboxes run as. Derived from this process on a host with uids, and
   * refused there if it differs; required on one without, such as Windows,
   * where there is nothing to derive it from (D-I1b-10).
   */
  readonly containerUser?: ContainerUser;
}

/** Bounds every sandbox the line provisions, whichever task it serves. */
export const DEFAULT_LIMITS: SandboxProfile['limits'] = { cpus: 2, memoryMb: 4096, pids: 512 };

export async function composeHost(config: HostConfig): Promise<BuiltGraph> {
  const vault = new LocalVault({ store: config.store, artifacts: config.repository });
  const docker = config.docker === undefined ? {} : { executable: config.docker };
  const sandbox = await LocalDockerProvider.create({
    ...docker,
    vaultPaths: [config.store, config.repository],
    credentials: { [MODEL_CREDENTIAL]: config.modelKey },
  });
  const driver = new ClaudeCodeDriver({ provider: sandbox });
  const buildImage = await ensureImage(docker);
  return buildGraph({
    vault,
    sandbox,
    driver,
    // One driver in both seats: below L3 the seat is filled and run state records its independence as reduced (I6).
    reviewer: driver,
    workspaces: localWorkspaceStore(config.containerUser === undefined ? { root: config.trees } : { root: config.trees, user: config.containerUser }),
    integrator: config.git === null ? null : new GitHubIntegrator(config.git),
    profile: { buildImage, checkImage: config.checkImage ?? BASE_IMAGE, limits: config.limits ?? DEFAULT_LIMITS },
  });
}
