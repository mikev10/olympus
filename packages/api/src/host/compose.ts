/**
 * The production composition: the real components, built once through the
 * graph builder, so every run the host serves is admitted against what they
 * can enforce (D-A-I1-05). The CLI composes nothing; it is a client of the
 * service this graph is served by (I9).
 */
import { WEBHOOK_SECRET_PREFIX } from '@olympus-ai/core';
import { BASE_IMAGE, ClaudeCodeDriver, ensureImage, MODEL_CREDENTIAL } from '@olympus-ai/driver-claude-code';
import { checkConfig, ENDPOINT_CREDENTIAL, OpenAICompatibleDriver, type EndpointConfig } from '@olympus-ai/driver-openai-compatible';
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
  /**
   * An OpenAI-compatible endpoint, its credential, and the seats it fills
   * (R6, D-R6-07). Every seat it does not name keeps the Claude Code driver.
   * Absent or null composes the Claude Code driver in every seat.
   */
  readonly endpoint?: HostEndpoint | null;
}

/** The seats an endpoint can fill: the build seat, the review seat, and the four drafting seats (R19). */
export const ENDPOINT_SEATS = ['driver', 'reviewer', 'specDrafter', 'specCritic', 'testDrafter', 'testCritic'] as const;
export type EndpointSeat = (typeof ENDPOINT_SEATS)[number];

export interface HostEndpoint {
  readonly config: EndpointConfig;
  /**
   * The endpoint's credential. Held by the sandbox provider for its relays and
   * given to no sandbox (A-P12-01). `null` only where the configuration
   * declared scheme `'none'`, for a local endpoint (A-R21-04).
   */
  readonly key: string | null;
  readonly seats: readonly EndpointSeat[];
}

/**
 * Reads the endpoint file `FACTORY_ENDPOINT_CONFIG` names: the driver's
 * configuration and a `seats` list, nothing else. A file that does not parse
 * exactly stops the host before it listens (I5): a seat that was misspelt
 * would otherwise be a seat silently left to the other driver.
 */
export function parseEndpointFile(text: string, key: string): HostEndpoint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`factory-host: the endpoint file is not JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('factory-host: the endpoint file is not a JSON object');
  const { seats, ...config } = parsed as Record<string, unknown>;
  if (!Array.isArray(seats) || seats.length === 0) throw new Error('factory-host: the endpoint file names no seats; an endpoint that fills none has nothing to do');
  const known = new Set<string>(ENDPOINT_SEATS);
  const named: EndpointSeat[] = [];
  for (const seat of seats as unknown[]) {
    if (typeof seat !== 'string' || !known.has(seat)) {
      throw new Error(`factory-host: the endpoint file names the seat ${JSON.stringify(seat)}; the seats are ${ENDPOINT_SEATS.join(', ')}`);
    }
    if (named.includes(seat as EndpointSeat)) throw new Error(`factory-host: the endpoint file names the seat '${seat}' twice`);
    named.push(seat as EndpointSeat);
  }
  // The driver's own check, so the host refuses exactly what the driver would, naming the field.
  const checked = checkConfig(config);
  // A-R21-04: no key is the file's declaration, never the variable's absence, and a key beside it is a contradiction.
  if (checked.scheme === 'none') {
    if (key !== '') {
      throw new Error("factory-host: the endpoint declares scheme 'none', so FACTORY_ENDPOINT_KEY must not be set; a key the endpoint never receives is a configuration that says two things");
    }
    return { config: checked, key: null, seats: named };
  }
  if (key === '') {
    throw new Error("factory-host: the endpoint has no credential; set FACTORY_ENDPOINT_KEY, or declare scheme 'none' for a local endpoint on the Docker host");
  }
  return { config: checked, key, seats: named };
}

/**
 * What the sandbox provider is given for an endpoint: its credential, where it
 * has one, and the Docker host port its local upstream listens on, where it is
 * local (A-R21-03, A-R21-04). Nothing for no endpoint.
 */
export function endpointGrants(endpoint: HostEndpoint | null): { credentials: Record<string, string>; dockerHostPorts: number[] } {
  if (endpoint === null) return { credentials: {}, dockerHostPorts: [] };
  return {
    credentials: endpoint.key === null ? {} : { [ENDPOINT_CREDENTIAL]: endpoint.key },
    dockerHostPorts: typeof endpoint.config.upstream === 'string' ? [] : [endpoint.config.upstream.port],
  };
}

/** Each seat's driver: the endpoint's in the seats it names, the default in every other (D-R6-07). */
export function seatedDrivers<D>(fallback: D, endpoint: { readonly driver: D; readonly seats: readonly EndpointSeat[] } | null): Record<EndpointSeat, D> {
  const out = {} as Record<EndpointSeat, D>;
  for (const name of ENDPOINT_SEATS) out[name] = endpoint?.seats.includes(name) === true ? endpoint.driver : fallback;
  return out;
}

/** Bounds every sandbox the line provisions, whichever task it serves. */
export const DEFAULT_LIMITS: SandboxProfile['limits'] = { cpus: 2, memoryMb: 4096, pids: 512 };

/** Both, or neither: a uid with no gid is a half-named user, refused rather than completed (D-I1b-10). */
export function containerUser(env: Readonly<Record<string, string | undefined>>): ContainerUser | undefined {
  const uid = env.FACTORY_CONTAINER_UID;
  const gid = env.FACTORY_CONTAINER_GID;
  if ((uid === undefined || uid === '') && (gid === undefined || gid === '')) return undefined;
  // Decimal digits only: `Number('')` and `Number(' ')` are 0, so a half-set pair would otherwise name root's group.
  const decimal = /^\d+$/u;
  if (uid === undefined || gid === undefined || !decimal.test(uid) || !decimal.test(gid)) {
    throw new Error('factory-host: FACTORY_CONTAINER_UID and FACTORY_CONTAINER_GID must both be set, as decimal integers, or neither');
  }
  return { uid: Number(uid), gid: Number(gid) };
}

/**
 * Every credential the sandbox provider is given, by the name a relay spec
 * names it with: the model key and the endpoint's, and nothing else. A
 * subscription's secret is not among them, so no sandbox spec can name one
 * and have it resolve (D-A-TF-05).
 */
export function providerCredentials(modelKey: string, endpoint: HostEndpoint | null): Record<string, string> {
  return { [MODEL_CREDENTIAL]: modelKey, ...endpointGrants(endpoint).credentials };
}

/**
 * Where the API server reads a subscription's secret: the host's own
 * environment, and only a variable with the webhook prefix, so a policy
 * cannot name the model key or any other host secret as one (D-A-TF-05).
 */
export function webhookSecrets(env: Readonly<Record<string, string | undefined>>): (name: string) => string | undefined {
  return (name) => (name.startsWith(WEBHOOK_SECRET_PREFIX) && name.length > WEBHOOK_SECRET_PREFIX.length ? env[name] : undefined);
}

export async function composeHost(config: HostConfig): Promise<BuiltGraph> {
  const vault = new LocalVault({ store: config.store, artifacts: config.repository });
  const docker = config.docker === undefined ? {} : { executable: config.docker };
  const endpoint = config.endpoint ?? null;
  const grants = endpointGrants(endpoint);
  const sandbox = await LocalDockerProvider.create({
    ...docker,
    vaultPaths: [config.store, config.repository],
    credentials: providerCredentials(config.modelKey, endpoint),
    dockerHostPorts: grants.dockerHostPorts,
  });
  const claude = new ClaudeCodeDriver({ provider: sandbox });
  // The endpoint's driver, in the seats the operator named and no others (D-R6-07). Its family is the operator's
  // declaration, so a reviewer or critic seated on it is graded against that declaration (I6).
  const other = endpoint === null ? null : new OpenAICompatibleDriver({ provider: sandbox, endpoint: endpoint.config });
  const seats = seatedDrivers<ClaudeCodeDriver | OpenAICompatibleDriver>(claude, other === null || endpoint === null ? null : { driver: other, seats: endpoint.seats });
  const seat = (name: EndpointSeat): ClaudeCodeDriver | OpenAICompatibleDriver => seats[name];
  const buildImage = await ensureImage(docker);
  return buildGraph({
    vault,
    sandbox,
    driver: seat('driver'),
    // With no endpoint, one driver in both seats: below L3 the seat is filled and run state records its independence as its grade (I6).
    reviewer: seat('reviewer'),
    // And in every drafting seat: a critic of its drafter's family is not seated, the condition is recorded as
    // failed, and every draft goes to a person (R19, D-A-DS-04). An endpoint of another family seats one.
    drafting: { specDrafter: seat('specDrafter'), specCritic: seat('specCritic'), testDrafter: seat('testDrafter'), testCritic: seat('testCritic') },
    workspaces: localWorkspaceStore(config.containerUser === undefined ? { root: config.trees } : { root: config.trees, user: config.containerUser }),
    integrator: config.git === null ? null : new GitHubIntegrator(config.git),
    profile: { buildImage, checkImage: config.checkImage ?? BASE_IMAGE, limits: config.limits ?? DEFAULT_LIMITS },
  });
}
