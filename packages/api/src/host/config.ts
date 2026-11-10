/**
 * Every variable `factory-host` reads, declared once (R35, #121, #127). The
 * host reads its environment only through `readHostConfig`, which asks for
 * nothing this table does not name; the shipped `.env.example` and the
 * README's configuration table are checked against it, so a variable the
 * host reads and the docs do not list fails a test.
 *
 * Start-up collects every missing or invalid variable and refuses with one
 * list, before it listens (I5): a host that stopped at the first problem
 * would make a user fix them one start at a time.
 */
import { WEBHOOK_SECRET_PREFIX } from '@olympus-ai/core';
import { containerUser, parseCodexSeats, type HostCodex } from './compose.js';
import type { ContainerUser } from '../workspace.js';

export interface HostVariable {
  readonly name: string;
  readonly purpose: string;
  /** Required: the host refuses to start without it. Optional variables say what their absence means. */
  readonly required: boolean;
  /** A credential: never printed, and never given to a sandbox. */
  readonly secret: boolean;
  /** A family of variables sharing this prefix, each named by the policy. */
  readonly prefix?: true;
}

/** Where the docs for every variable live, named in every refusal. */
export const CONFIG_DOCS = 'README.md, "Configure the host", and .env.example';

export const HOST_VARIABLES: readonly HostVariable[] = [
  { name: 'FACTORY_API_TOKEN', required: true, secret: true, purpose: 'the local token every request must bear, at least 32 characters' },
  { name: 'FACTORY_LISTEN_PORT', required: true, secret: false, purpose: 'the port the API listens on' },
  { name: 'FACTORY_LISTEN_HOST', required: false, secret: false, purpose: 'the address the API listens on; default 127.0.0.1' },
  { name: 'FACTORY_POLICY_FILE', required: true, secret: false, purpose: 'the policy.yaml every run is admitted under' },
  { name: 'FACTORY_ROLES_DIR', required: true, secret: false, purpose: 'the roles directory seats are compiled from, outside the repository and the trees' },
  { name: 'FACTORY_RUBRICS_DIR', required: false, secret: false, purpose: 'the rubrics a drafting run\'s critics are given; unset, a run that drafts is refused at admission' },
  { name: 'FACTORY_VAULT_STORE', required: true, secret: false, purpose: 'the directory the Vault owns' },
  { name: 'FACTORY_REPOSITORY', required: true, secret: false, purpose: 'the git working copy runs are admitted from; --workspace names it' },
  { name: 'FACTORY_TREES', required: true, secret: false, purpose: 'where each run\'s trees are kept; must allow symbolic links' },
  { name: 'ANTHROPIC_API_KEY', required: true, secret: true, purpose: 'the model key, held by the host\'s relays and given to no sandbox' },
  { name: 'FACTORY_PRINCIPAL', required: false, secret: false, purpose: 'who a request bearing the token is, as approvals record it; default local' },
  { name: 'FACTORY_GIT_REPOSITORY', required: true, secret: false, purpose: 'the GitHub repository a passed run merges into, as owner/name' },
  { name: 'FACTORY_GIT_BASE_BRANCH', required: true, secret: false, purpose: 'the branch a passed run merges into' },
  { name: 'FACTORY_GIT_TOKEN', required: true, secret: true, purpose: 'the token that merges, held by the host and given to no sandbox' },
  { name: 'FACTORY_CONTAINER_UID', required: false, secret: false, purpose: 'the uid sandboxes run as; with FACTORY_CONTAINER_GID, both or neither; required on a host with no uids, such as Windows' },
  { name: 'FACTORY_CONTAINER_GID', required: false, secret: false, purpose: 'the gid sandboxes run as; with FACTORY_CONTAINER_UID, both or neither' },
  { name: 'FACTORY_ENDPOINT_CONFIG', required: false, secret: false, purpose: 'a JSON file naming an OpenAI-compatible endpoint and the seats it fills' },
  { name: 'FACTORY_ENDPOINT_KEY', required: false, secret: true, purpose: 'that endpoint\'s credential; not set for an endpoint declaring scheme none' },
  { name: 'FACTORY_CODEX_SEATS', required: false, secret: false, purpose: 'the seats the Codex driver fills, comma-separated; with FACTORY_CODEX_KEY, both or neither' },
  { name: 'FACTORY_CODEX_KEY', required: false, secret: true, purpose: 'the OpenAI key the Codex relay is given' },
  { name: 'FACTORY_CHECKS_TOKEN', required: false, secret: true, purpose: 'a token that reads check runs, for observation windows; unset, a run with an observation plan is refused at its window\'s close' },
  { name: WEBHOOK_SECRET_PREFIX, prefix: true, required: false, secret: true, purpose: 'each webhook subscription\'s secret, the full name given by the policy; unset, that subscription verifies no delivery' },
];

/** The host's settings, read and checked: everything `main.ts` needs before it composes. */
export interface HostSettings {
  readonly token: string;
  readonly port: number;
  readonly listenHost: string;
  readonly policyFile: string;
  readonly rolesDirectory: string;
  readonly rubricsDirectory: string | null;
  readonly store: string;
  readonly repository: string;
  readonly trees: string;
  readonly modelKey: string;
  readonly principal: string;
  readonly git: { readonly repository: string; readonly baseBranch: string; readonly token: string };
  readonly containerUser: ContainerUser | undefined;
  /** The endpoint file's path and key; the file is read by `main.ts`, after this check. */
  readonly endpoint: { readonly file: string; readonly key: string } | null;
  readonly codex: HostCodex | null;
  readonly checksToken: string | null;
  /** A subscription's secret by its full name, and only a name with the webhook prefix (D-A-TF-05). */
  readonly webhookSecret: (name: string) => string | undefined;
}

export type HostConfigResult = { readonly ok: true; readonly settings: HostSettings } | { readonly ok: false; readonly problems: readonly string[] };

function declared(name: string): HostVariable | undefined {
  return HOST_VARIABLES.find((v) => (v.prefix === true ? name.startsWith(v.name) && name.length > v.name.length : v.name === name));
}

/**
 * Reads and checks the host's environment, collecting every problem rather
 * than stopping at the first. Nothing outside the table is read: asking for
 * an undeclared name is a programming error and throws.
 */
export function readHostConfig(env: Readonly<Record<string, string | undefined>>): HostConfigResult {
  const problems: string[] = [];
  const get = (name: string): string => {
    if (declared(name) === undefined) throw new Error(`factory-host: ${name} is read but not declared in HOST_VARIABLES`);
    return env[name] ?? '';
  };
  const required = (name: string): string => {
    const value = get(name);
    if (value === '') problems.push(`${name} is not set: ${declared(name)?.purpose ?? ''}`);
    return value;
  };
  const optional = (name: string): string | null => {
    const value = get(name);
    return value === '' ? null : value;
  };
  // Each check that throws is caught here and listed, so one bad pair does not hide the rest.
  const checked = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch (error) {
      problems.push((error instanceof Error ? error.message : String(error)).replace(/^factory-host: /u, ''));
      return fallback;
    }
  };

  const token = required('FACTORY_API_TOKEN');
  const portText = required('FACTORY_LISTEN_PORT');
  const port = Number(portText);
  if (portText !== '' && (!/^\d+$/u.test(portText) || port > 65535)) problems.push(`FACTORY_LISTEN_PORT is not a port: ${portText}`);
  const policyFile = required('FACTORY_POLICY_FILE');
  const rolesDirectory = required('FACTORY_ROLES_DIR');
  const store = required('FACTORY_VAULT_STORE');
  const repository = required('FACTORY_REPOSITORY');
  const trees = required('FACTORY_TREES');
  const modelKey = required('ANTHROPIC_API_KEY');
  const git = { repository: required('FACTORY_GIT_REPOSITORY'), baseBranch: required('FACTORY_GIT_BASE_BRANCH'), token: required('FACTORY_GIT_TOKEN') };
  const user = checked(() => containerUser({ FACTORY_CONTAINER_UID: get('FACTORY_CONTAINER_UID'), FACTORY_CONTAINER_GID: get('FACTORY_CONTAINER_GID') }), undefined);
  const endpointFile = get('FACTORY_ENDPOINT_CONFIG');
  const endpointKey = get('FACTORY_ENDPOINT_KEY');
  // A key with no file is half a configuration. A file with no key is the file's to allow: only one declaring scheme 'none' does.
  if (endpointFile === '' && endpointKey !== '') problems.push('FACTORY_ENDPOINT_KEY is set without FACTORY_ENDPOINT_CONFIG');
  const codex = checked(() => parseCodexSeats(get('FACTORY_CODEX_SEATS'), get('FACTORY_CODEX_KEY')), null);
  const listenHost = optional('FACTORY_LISTEN_HOST') ?? '127.0.0.1';
  const principal = optional('FACTORY_PRINCIPAL') ?? 'local';
  const rubricsDirectory = optional('FACTORY_RUBRICS_DIR');
  const checksToken = optional('FACTORY_CHECKS_TOKEN');

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    settings: {
      token, port, listenHost, policyFile, rolesDirectory, rubricsDirectory, store, repository, trees, modelKey, principal, git,
      containerUser: user,
      endpoint: endpointFile === '' ? null : { file: endpointFile, key: endpointKey },
      codex, checksToken,
      // Only a name with the webhook prefix is ever read, so a policy cannot name another host secret as one.
      webhookSecret: (name) => (name.startsWith(WEBHOOK_SECRET_PREFIX) && name.length > WEBHOOK_SECRET_PREFIX.length ? optional(name) ?? undefined : undefined),
    },
  };
}

/** The refusal start-up prints: every problem, then where the docs are. No stack trace. */
export function refusalText(problems: readonly string[]): string {
  return [
    `not started; ${String(problems.length)} configuration problem${problems.length === 1 ? '' : 's'}:`,
    ...problems.map((p) => `  - ${p}`),
    `every variable is described in ${CONFIG_DOCS}`,
  ].join('\n');
}

/**
 * What start-up throws when it refuses. The runtime touches no terminal, so it
 * writes nothing itself (I9): Node reports the uncaught refusal and exits 1.
 * Its stack is replaced by its text, so what is printed is the list and no
 * frame (D-R35-08).
 */
export class HostRefusal extends Error {
  constructor(problems: readonly string[]) {
    super(refusalText(problems));
    this.stack = `${this.name}: ${this.message}`;
  }
}
HostRefusal.prototype.name = 'factory-host';
