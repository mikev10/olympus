/**
 * ClaudeCodeDriver: the `Driver` contract over the Claude Code CLI, run inside
 * a provisioned sandbox.
 *
 * The whole of `I1.driver-executes-inside-the-sandbox` is that this class
 * holds a `SandboxProvider` and has no other way to start a process. There is
 * no `spawn` in this file, no shell on the host, and no path that runs the CLI
 * outside a container: every command goes through `provider.exec` against the
 * handle the request carries, so the mount table is the only filesystem the
 * model can reach. A driver constructed without a provider cannot be
 * constructed.
 *
 * This driver holds no credential (P12). The sandbox it runs in is provisioned
 * with a model relay — `MODEL_RELAY`, below — that holds the credential in a
 * container of its own and forwards the CLI's requests to the API with it. The
 * CLI is given the relay's address by the provider and a placeholder where a
 * key would go, so no process the task runs can read the credential: not the
 * CLI, not a tool it starts, not a later exec (D-P5-20, paid).
 */
import type {
  AgentClaim,
  CompiledRole,
  Driver,
  DriverCapabilities,
  DriverEvent,
  ModelFamily,
  ModelIdentity,
  ModelTier,
  RoleId,
  TaskId,
  TaskRequest,
  TaskResult,
  Usage,
} from '@olympus-ai/core';
import { DRIVER_CONTRACT_VERSION } from '@olympus-ai/core';
import type { RelaySpec, SandboxHandle, SandboxProvider } from '@olympus-ai/sandbox';
import { CLI_VERSION } from './image.js';
import { refuse } from './refusal.js';
import { parseStream, type ParsedStream, type SessionInit } from './stream.js';
import { DECLARED_TOOLS, isCommandTool, isNetworkTool, isSubagentTool, writtenPath } from './tools.js';

/**
 * The environment variable the CLI reads its key from. It carries
 * `KEY_PLACEHOLDER`, never a credential. The session's own `init` message
 * reports which source the CLI used, and this driver refuses a session that
 * names any other: a CLI that found a key in a keychain or a mounted file would
 * be authenticating by a path this driver did not arrange, and would be
 * holding a real credential inside the sandbox.
 */
export const KEY_VARIABLE = 'ANTHROPIC_API_KEY';

/**
 * What the CLI sends where a key would go. The relay discards it with every
 * other authentication header the client sent and writes the credential it
 * holds (D-P12-03). It is not a secret and authenticates nothing: the relay is
 * reachable only from the sandbox it serves.
 */
export const KEY_PLACEHOLDER = 'relay-held-credential-placeholder';

/**
 * The name of the credential the relay is given, as a provider holds it.
 * `LocalDockerProvider.create({ credentials: { [MODEL_CREDENTIAL]: key } })`.
 */
export const MODEL_CREDENTIAL = 'anthropic';

/**
 * The relay a sandbox this driver runs in must be provisioned with (D-P12-05):
 * the API origin, the one path the CLI calls with non-essential traffic off,
 * the header the API reads a key from, and the variable the CLI reads its
 * base URL from.
 *
 * `/v1/messages` covers the CLI's `POST /v1/messages?beta=true` and its
 * token-counting sub-path. The CLI also sends `HEAD /api/hello` at startup; the
 * relay refuses it, the CLI carries on without it, and the grant stays the one
 * path a task needs. Observed against the pinned CLI, and re-proven by every
 * claim assertion, each of which runs through the relay.
 */
export const MODEL_RELAY: Readonly<RelaySpec> = Object.freeze({
  upstream: 'https://api.anthropic.com',
  paths: ['/v1/messages'],
  header: 'x-api-key',
  credential: MODEL_CREDENTIAL,
  urlVariable: 'ANTHROPIC_BASE_URL',
});

/**
 * I6: the family is a value this driver assigns, here, once. It is not derived
 * from `id`, from `provider`, from the tier, or from the model name the CLI
 * reports. A reviewer's independence is only as good as this being a decision
 * rather than a string comparison.
 */
const FAMILY = 'claude' as ModelFamily;

/**
 * Tier to model alias. Aliases rather than pinned model names: the CLI
 * resolves an alias to the current model and reports what it resolved, and
 * `ModelIdentity.model` carries that answer rather than this driver's guess.
 */
const TIER_MODELS: Readonly<Record<ModelTier, string>> = {
  fast: 'haiku',
  standard: 'sonnet',
  deep: 'opus',
};

/**
 * Environment the CLI gets on every exec, beside the key placeholder.
 *
 * Non-essential traffic is off because the relay is the CLI's only route out
 * and grants the messages endpoint alone; a CLI that also wanted an analytics
 * host would be refused and the run would fail for a reason that has nothing
 * to do with the task. The auto-updater is off for the same reason and one more:
 * an image pinned to a CLI version that updates itself at run time is not
 * pinned.
 */
/**
 * How long the session inspection may take. It makes no API call, so this
 * bounds a CLI that failed to start rather than a model that is thinking.
 */
const INSPECT_TIMEOUT_SECONDS = 60;

const CLI_ENVIRONMENT: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  // The CLI turns tool search off when its base URL is not Anthropic's, on the
  // theory that a third-party gateway may not carry the beta. The relay is not
  // a gateway: it forwards to the API itself, headers and query intact. Without
  // this, a session granted `ToolSearch` silently comes up without it, which the
  // driver refuses (I4.driver-tool-inventory-validated; D-P12-10).
  ENABLE_TOOL_SEARCH: 'true',
};

/** Every exec's environment: the settings above and the placeholder. No value in it is secret. */
const CLI_KEY_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({ ...CLI_ENVIRONMENT, [KEY_VARIABLE]: KEY_PLACEHOLDER });

/**
 * An MCP server this driver can put in front of a task, as the CLI's
 * `--mcp-config` describes one. Servers are the driver's rather than the
 * request's because `TaskRequest` carries tools and no server configuration:
 * the request names `mcp__<server>__<tool>` among its grants, and this map is
 * what turns that name into something startable.
 */
export interface McpServerConfig {
  readonly command: string;
  readonly args?: readonly string[];
}

/** `mcp__<server>__<tool>`: how the CLI names a tool a server provides. */
const MCP_TOOL = /^mcp__([^_][^_]*(?:_[^_]+)*)__(.+)$/;

/** The server an MCP tool name belongs to, or `undefined` when the name is not one. */
export function mcpServerOf(tool: string): string | undefined {
  return MCP_TOOL.exec(tool)?.[1];
}

export interface ClaudeCodeDriverOptions {
  /**
   * The provider that provisioned the handle in `TaskRequest.sandbox`. Not
   * optional and not defaulted: a driver that could fall back to running on
   * the host is the failure I1 exists to prevent.
   */
  readonly provider: SandboxProvider;
  /** The working directory inside the sandbox. Defaults to the workspace mount's usual target. */
  readonly workdir?: string;
  /** Overrides the tier-to-model map. Every tier must be present. */
  readonly models?: Readonly<Record<ModelTier, string>>;
  /**
   * MCP servers by name. A request may grant `mcp__<name>__<tool>` only for a
   * name in this map; the session is started with `--strict-mcp-config` and
   * only the servers its grants actually name, so a server nothing granted is
   * not merely unused but absent (I4).
   */
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>;
  /**
   * A settings file inside the sandbox, as `emitArtifacts` writes one. When
   * set, the session is started with it, which is how the hook points reach
   * the CLI. Absent means no settings file and no hooks.
   */
  readonly settingsPath?: string;
}

/** What one invocation of the CLI is told to do. Built in one place so the argv is readable. */
interface Invocation {
  readonly argv: string[];
  readonly env: Record<string, string>;
}

/**
 * A settings file that decides what runs may not live where the agent can
 * write.
 *
 * `--settings` carries the hook commands, and a hook is a command the CLI runs
 * outside the task's tool grant. A settings file on the workspace mount is a
 * file a task with `Write` can edit, so a later task granted nothing but
 * `Read` would still execute whatever the earlier one put there — a capability
 * arriving from the tree being worked on rather than from policy (I3, I4).
 *
 * The runtime may put it anywhere it likes that the workspace does not cover.
 * The driver refuses the one placement that cannot be safe rather than trying
 * to guess which of the others is.
 */
function requireSettingsOutsideWorkspace(path: string | undefined, workdir: string): string | undefined {
  if (path === undefined) return undefined;
  // Container paths, always POSIX: the workdir is a mount target, not a host path.
  const root = workdir.replace(/\/+$/, '');
  if (path === root || path.startsWith(`${root}/`)) {
    refuse(
      'capability',
      `the settings file ${path} is inside the workspace ${workdir}, which the agent can write. ` +
        'A hook command read from the workspace runs outside the tool grant of the task that loads it, so the driver ' +
        'refuses rather than taking execution configuration from the tree being worked on (I3, I4).',
    );
  }
  return path;
}

export class ClaudeCodeDriver implements Driver {
  readonly id = 'claude-code';
  readonly contractVersion = DRIVER_CONTRACT_VERSION;

  readonly #provider: SandboxProvider;
  readonly #workdir: string;
  readonly #models: Readonly<Record<ModelTier, string>>;
  readonly #mcpServers: Readonly<Record<string, McpServerConfig>>;
  readonly #settingsPath: string | undefined;
  /**
   * The one in-flight invocation per sandbox. `capabilities().parallelism` is
   * 1, and this is what makes that true rather than aspirational: a second
   * task on the same sandbox waits for the first. A declared number that
   * nothing enforced would be a capability claim with nothing behind it, which
   * is the state I8 exists to end.
   */
  readonly #inFlight = new Map<SandboxHandle, Promise<unknown>>();
  readonly #handlers = new Map<DriverEvent['kind'], Array<(e: DriverEvent) => void>>();
  /**
   * What each task's session reported about itself at startup, kept so a
   * caller — and a conformance assertion — can read what the session actually
   * came up with rather than inferring it from the model's output. The tool
   * list, the MCP servers and the subagent types are facts the CLI printed
   * before it took a turn.
   */
  readonly #sessions = new Map<TaskId, SessionInit>();
  /**
   * The handle `emitArtifacts` writes through. The contract gives that method a
   * target directory and no handle, so the driver must already hold one; a
   * driver asked to emit before it has been given a sandbox refuses rather than
   * writing to the host.
   *
   * Set only by `useSandbox`, never by running a task. One driver serves every
   * sandbox, and `#serialized` bounds concurrency per handle rather than across
   * them, so a task starting on a second sandbox would otherwise retarget this
   * field while a task on the first was still running — and that task's
   * artifacts would land in the other sandbox's mount table. The caller names
   * the sandbox it means; the driver does not infer one from whatever ran last.
   */
  #artifactSandbox: SandboxHandle | undefined;

  constructor(options: ClaudeCodeDriverOptions) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the type requires a provider, but this is the one class where a missing one means running the model on the host (I1). A caller arriving from untyped code is refused, not trusted.
    if (options.provider === undefined || options.provider === null) {
      refuse('provider', 'ClaudeCodeDriver needs the SandboxProvider that provisioned the handle; there is no host fallback (I1)');
    }
    this.#provider = options.provider;
    this.#workdir = options.workdir ?? '/workspace';
    this.#models = options.models ?? TIER_MODELS;
    this.#mcpServers = options.mcpServers ?? {};
    this.#settingsPath = requireSettingsOutsideWorkspace(options.settingsPath, this.#workdir);
  }

  provenanceId(): string {
    return `${this.id}@${CLI_VERSION}`;
  }

  /**
   * Every value is asserted against the real CLI by the conformance registry
   * (I8), in both directions: a `true` the CLI does not give is a false claim,
   * and a capability the CLI gives that is not declared here is an undeclared
   * one. Editing a value without changing what the driver does fails the suite.
   *
   * `computerUse` is `false` and stays false: the image has no display, and
   * the assertion proves the absence rather than skipping it. A container that
   * could drive one is R3.
   *
   * `steering` is `false` because `steer()` is absent below. The CLI can take
   * a message mid-turn over `--input-format stream-json`, but this driver does
   * not hold the session open to deliver one, and a capability is what the
   * driver does rather than what the tool could do.
   */
  capabilities(): DriverCapabilities {
    return {
      subagents: true,
      hooks: true,
      mcp: true,
      // One CLI process per task, and a sandbox is one container. Concurrency
      // across tasks is the runtime's to arrange with more sandboxes, not this
      // driver's to claim.
      parallelism: 1,
      computerUse: false,
      steering: false,
      stablePrefixCaching: true,
    };
  }

  declaredTools(): readonly string[] {
    return DECLARED_TOOLS;
  }

  /**
   * I6: `family` is the constant above, assigned. Nothing here reads `this.id`,
   * the tier, or the resolved model name to produce it.
   */
  resolveModel(tier: ModelTier): ModelIdentity {
    const model = this.#models[tier];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ModelTier is a union, but a tier arriving from parsed configuration can be outside it, and an undefined model would reach the argv as the string 'undefined'.
    if (model === undefined) refuse('capability', `no model is mapped to tier '${tier}'`);
    return { provider: 'anthropic', family: FAMILY, model, version: CLI_VERSION };
  }

  runTask(req: TaskRequest): Promise<TaskResult> {
    return this.#serialized(req.sandbox, () => this.#runTask(req, undefined));
  }

  /**
   * Runs `role` as a child task under the same grants the parent request
   * carries, and returns its own `TaskResult`.
   *
   * `--agent` rather than hoping the model reaches for the `Task` tool: a
   * capability that depends on the model choosing to exercise it is not a
   * capability the driver can be held to. The role definition is passed on the
   * same argv, so a subagent is a session this driver configured rather than
   * one the workspace supplied (I3).
   */
  spawnSubagent(role: RoleId, req: TaskRequest): Promise<TaskResult> {
    return this.#serialized(req.sandbox, () => this.#runTask(req, role));
  }

  /** One invocation per sandbox at a time, which is what `parallelism: 1` means. */
  async #serialized<T>(handle: SandboxHandle, body: () => Promise<T>): Promise<T> {
    const previous = this.#inFlight.get(handle);
    if (previous !== undefined) await previous.catch(() => undefined);
    const running = body();
    this.#inFlight.set(handle, running);
    try {
      return await running;
    } finally {
      if (this.#inFlight.get(handle) === running) this.#inFlight.delete(handle);
    }
  }

  async #runTask(req: TaskRequest, asRole: RoleId | undefined): Promise<TaskResult> {
    this.#refuseUngrantedTools(req);
    const identity = this.resolveModel(req.tier);
    const servers = this.#mcpConfigFor(req);
    const configPath = await this.#writeMcpConfig(req, servers);
    const ungranted = await this.#ungrantedMcpTools(req, servers, configPath);
    const invocation = this.#invocationFor(req, identity, asRole, configPath, ungranted);

    const exec = await this.#provider.exec(req.sandbox, invocation.argv, { env: invocation.env });
    const stream = parseStream(exec.stdout);
    const init = this.#refuseUnusableStream(req, exec.exitCode, exec.stderr, stream);

    const events = eventsFrom(stream);
    for (const event of events) this.#emit(event);
    this.#sessions.set(req.taskId, init);

    return {
      taskId: req.taskId,
      claim: claimFrom(stream),
      events,
      usage: usageFrom(stream, exec.durationMs),
      // The identity the task actually ran under: the alias this driver asked
      // for, replaced by the model the session says it resolved to. `family`
      // is never touched by that replacement (I6).
      model: init.model === '' ? identity : { ...identity, model: init.model },
      contractVersion: this.contractVersion,
    };
  }

  /**
   * `steer` is deliberately absent, because `capabilities().steering` is
   * false. A method that threw would be a capability declared false and
   * present, which is the direction the conformance assertion refuses.
   */

  /**
   * Forgets a task's session. The container belongs to the run rather than to
   * this driver, so nothing here destroys it: a driver that tore down a
   * sandbox it did not provision would end every other task sharing it.
   */
  cancel(taskId: TaskId): Promise<void> {
    this.#sessions.delete(taskId);
    return Promise.resolve();
  }

  /**
   * Renders roles into the CLI's own artifact format under `targetDir`.
   *
   * Written through the sandbox like everything else, so the artifacts land on
   * the mount table rather than on the host. `CompiledRole.instructions` is
   * rendered verbatim: what the instructions should say is the compiler's
   * (M2), and this driver's job is the file format.
   */
  async emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void> {
    if (roles.length === 0) refuse('capability', 'emitArtifacts was given no roles; there is nothing to write');
    const handle = this.#artifactSandbox;
    if (handle === undefined) {
      refuse('provider', 'emitArtifacts has no sandbox to write into; call useSandbox() with the handle the run provisioned (I1)');
    }
    for (const file of artifactFiles(roles, targetDir)) {
      const written = await this.#provider.exec(handle, writeFileArgv(file.path), { env: { [ARTIFACT_CONTENT]: file.content } });
      if (written.exitCode !== 0) {
        refuse('invocation', `writing ${file.path} inside the sandbox failed with exit code ${String(written.exitCode)}: ${written.stderr.trim()}`);
      }
    }
  }

  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void {
    const existing = this.#handlers.get(kind);
    if (existing === undefined) this.#handlers.set(kind, [handler]);
    else existing.push(handler);
  }

  /** Names the sandbox `emitArtifacts` writes into, for a caller emitting before any task has run. */
  useSandbox(handle: SandboxHandle): void {
    this.#artifactSandbox = handle;
  }

  /** What the CLI reported about a task's session, once one has run. */
  sessionFor(taskId: TaskId): SessionInit | undefined {
    return this.#sessions.get(taskId);
  }

  /**
   * I4: a granted tool this driver does not declare is refused before the task
   * starts. `validateToolGrants` applies this rule to a policy; this applies it
   * to the grant that actually reaches the CLI, so a caller that bypassed the
   * engine does not get a wider session than policy would have allowed.
   */
  #refuseUngrantedTools(req: TaskRequest): void {
    const declared = new Set(DECLARED_TOOLS);
    // MCP tools are not the driver's to declare — they belong to whichever
    // server a request configures — so they are checked against the server map
    // instead, by `#mcpConfigFor`.
    const undeclared = req.tools.filter((tool) => mcpServerOf(tool) === undefined && !declared.has(tool));
    if (undeclared.length > 0) {
      refuse(
        'grant',
        `the task grants ${undeclared.map((t) => `'${t}'`).join(', ')}, which this driver does not declare. ` +
          'The task was not started: a grant this driver cannot honour is a policy that means something other than what it says (I4).',
      );
    }
  }

  /**
   * The MCP servers this request's grants name, and nothing else.
   *
   * A grant naming a server the driver does not hold is refused rather than
   * dropped: the CLI silently ignores a tool name it does not know, so a
   * policy could grant `mcp__missing__tool`, get a session without it, and
   * read as though the grant had taken effect (I4, I5).
   */
  #mcpConfigFor(req: TaskRequest): Record<string, McpServerConfig> {
    const wanted: Record<string, McpServerConfig> = {};
    for (const tool of req.tools) {
      const server = mcpServerOf(tool);
      if (server === undefined) continue;
      const config = this.#mcpServers[server];
      if (config === undefined) {
        refuse('grant', `the task grants '${tool}', but this driver holds no MCP server named '${server}'`);
      }
      wanted[server] = config;
    }
    return wanted;
  }

  /**
   * Every MCP tool the request's servers offer that the request did not grant.
   *
   * `--tools` governs the built-in set only: an MCP server contributes its
   * whole tool list to a session, so granting `mcp__s__a` on a server that also
   * offers `mcp__s__b` produces a session holding both. That is a tool
   * available to the model that policy did not grant, which is precisely what
   * I4 forbids, and it is not something a narrower grant can fix because the
   * names come from the server rather than from the driver.
   *
   * What does fix it is naming them: `--disallowedTools mcp__s__b` removes it
   * from the session entirely, not merely from what the model may use. So the
   * driver asks the CLI what the servers offer before it runs the task. The
   * inspection starts a session and reads the list it prints, which costs a
   * process and no tokens — the CLI prints its session before it calls
   * anything, and this invocation is given no tools and is bounded so it
   * cannot sit there retrying.
   *
   * Only when the request grants an MCP tool at all. A task with no MCP grant
   * configures no server, so there is nothing to inspect and nothing to hide.
   */
  async #ungrantedMcpTools(req: TaskRequest, servers: Record<string, McpServerConfig>, configPath: string | undefined): Promise<string[]> {
    if (configPath === undefined || Object.keys(servers).length === 0) return [];
    const inspected = await this.#provider.exec(
      req.sandbox,
      [
        'sh',
        '-c',
        `cd ${shellQuote(this.#workdir)} && exec timeout ${String(INSPECT_TIMEOUT_SECONDS)} "$@"`,
        'driver',
        'claude',
        '--print', 'the session is read before any turn',
        '--output-format', 'stream-json',
        '--verbose',
        '--tools', '',
        '--setting-sources', '',
        '--strict-mcp-config',
        '--mcp-config', configPath,
        '--permission-mode', 'bypassPermissions',
        '--permission-prompts', 'none',
        '--no-session-persistence',
      ],
      { env: CLI_KEY_ENVIRONMENT },
    );
    const init = parseStream(inspected.stdout).init;
    if (init === undefined) {
      refuse(
        'invocation',
        `the MCP servers ${Object.keys(servers).join(', ')} could not be inspected, so the tools they offer beyond the grant are unknown. ` +
          'The task was not started: running it would mean offering the model tools nobody can enumerate (I4, I5).',
      );
    }
    // An `init` line is not an enumeration. A server that came up failed, or
    // was still connecting, contributes no tools to the list, so a disallow
    // list computed from it would be short by exactly the tools that server
    // offers -- and the task would then run holding them. Every configured
    // server has to be connected, and every granted tool has to be present,
    // before the absence of a name means anything (I5).
    const unconnected = init.mcpServers.filter((server) => server.status !== 'connected');
    if (unconnected.length > 0) {
      refuse(
        'invocation',
        `MCP server(s) ${unconnected.map((server) => `${server.name} (${server.status})`).join(', ')} did not connect during inspection, ` +
          'so what they offer is unknown and the tools to disallow cannot be computed',
      );
    }
    const enumerated = new Set(init.tools);
    const absent = req.tools.filter((tool) => mcpServerOf(tool) !== undefined && !enumerated.has(tool));
    if (absent.length > 0) {
      refuse(
        'grant',
        `the inspection did not find granted MCP tool(s) ${absent.join(', ')}; the servers offer a different set than the request names`,
      );
    }
    const granted = new Set(req.tools);
    return init.tools.filter((tool) => mcpServerOf(tool) !== undefined && !granted.has(tool));
  }

  /**
   * Writes the MCP configuration into the container and returns its path, or
   * `undefined` when the request granted no MCP tool.
   *
   * A file rather than a JSON string on the argv. The CLI takes `--mcp-config`
   * as "JSON files or strings (space-separated)", and a server definition that
   * carries a command with arguments has spaces in it, so passing one inline
   * produced a session with no MCP tools at all — and the model, asked to use
   * one, invented a tool list rather than saying it had none. A path has no
   * spaces and is what the documented file form expects.
   *
   * It lives in the container's own filesystem rather than the workspace mount,
   * which keeps it out of the tree a task works on and out of any diff. That is
   * all the location buys. The driver and the agent's own commands run as the
   * same user, so a process the agent started can rewrite this file between the
   * inspection and the run. What makes that pointless is not where the file
   * sits but `#refuseSessionUnlikeGrant`, which compares the session the CLI
   * actually started against the grant and refuses a tool nobody granted
   * however it arrived.
   *
   * Nothing secret is in it, and `McpServerConfig` has no field that could
   * carry one: a server environment was removed from the type rather than left
   * as a place a caller might put a token the agent could then read.
   */
  async #writeMcpConfig(req: TaskRequest, servers: Record<string, McpServerConfig>): Promise<string | undefined> {
    if (Object.keys(servers).length === 0) return undefined;
    const path = `/tmp/mcp-${sessionIdFor(req.taskId)}.json`;
    const written = await this.#provider.exec(req.sandbox, writeFileArgv(path), {
      env: { [ARTIFACT_CONTENT]: JSON.stringify({ mcpServers: servers }) },
    });
    if (written.exitCode !== 0) {
      refuse('invocation', `the MCP configuration could not be written to ${path}: ${written.stderr.trim()}`);
    }
    return path;
  }

  #invocationFor(
    req: TaskRequest,
    identity: ModelIdentity,
    asRole: RoleId | undefined,
    configPath: string | undefined,
    ungrantedMcpTools: readonly string[],
  ): Invocation {
    // `--tools` and not `--allowedTools`: the first decides which tools exist
    // in the session at all, the second decides which uses need approval. I4
    // is about availability — a tool outside the grant must be unavailable to
    // the model, not merely unused — so the narrower flag is the correct one.
    // An empty grant produces `--tools ''`, which is a session with no tools:
    // default deny, spelled the way the CLI spells it.
    const cli = [
      'claude',
      '--print', req.variableSuffix,
      '--output-format', 'stream-json',
      '--verbose',
      '--model', identity.model,
      // The cacheable half. Appended rather than replacing the default prompt,
      // so the session still behaves like the CLI it is, and the dynamic
      // sections that change between tasks — cwd, git status, env — are moved
      // out of the prefix, so two tasks in one run present the same prefix and
      // the second reads it from cache instead of writing it again.
      '--append-system-prompt', req.stablePrefix,
      '--exclude-dynamic-system-prompt-sections',
      '--tools', req.tools.filter((tool) => mcpServerOf(tool) === undefined).join(','),
      // Nothing outside this argv configures the session: no user, project, or
      // local settings file, and no MCP server the request did not name. A
      // session configured by a settings file in the workspace would be
      // configured by the thing it is being judged on (I3).
      '--setting-sources', '',
      '--strict-mcp-config',
      // The container is the sandbox. A permission prompt has nobody to answer
      // it, and `none` denies anything that would prompt rather than stalling
      // until the wall-clock budget kills the container.
      '--permission-mode', 'bypassPermissions',
      '--permission-prompts', 'none',
      '--no-session-persistence',
      '--session-id', sessionIdFor(req.taskId),
      '--include-hook-events',
      '--max-budget-usd', String(req.budget.maxCostUsd),
    ];
    if (configPath !== undefined) cli.push('--mcp-config', configPath);
    // Named one by one, because a server-wide pattern removes the granted tools
    // with the rest and a later `--allowedTools` does not bring them back.
    if (ungrantedMcpTools.length > 0) cli.push('--disallowedTools', ungrantedMcpTools.join(','));
    if (this.#settingsPath !== undefined) cli.push('--settings', this.#settingsPath);
    if (asRole !== undefined) {
      cli.push('--agents', JSON.stringify({ [asRole]: { description: `the ${asRole} role`, prompt: req.stablePrefix } }), '--agent', asRole);
    }
    // `exec "$@"` runs the CLI as the process itself, with every argument an
    // argv element the shell never re-reads. Only the working directory is
    // interpolated, and it is quoted.
    return {
      argv: ['sh', '-c', `cd ${shellQuote(this.#workdir)} && exec "$@"`, 'driver', ...cli],
      env: CLI_KEY_ENVIRONMENT,
    };
  }

  /**
   * Fail closed on anything that means the task did not run (I5), and return
   * the session that did.
   *
   * A session the CLI never started, a credential from a source this driver
   * did not arrange, a missing result, and an API status the CLI gave up on
   * are each a refusal. None of them is a `TaskResult` with a sad narrative in
   * it: a `TaskResult` says a task ran, and the runtime derives status from
   * evidence that assumes one did.
   */
  #refuseUnusableStream(req: TaskRequest, exitCode: number, stderr: string, stream: ParsedStream): NonNullable<ParsedStream['init']> {
    const init = stream.init;
    if (init === undefined) {
      const first = stream.unreadable[0];
      refuse(
        'invocation',
        `the CLI produced no session for task ${req.taskId} (exit code ${String(exitCode)})` +
          (first === undefined ? '' : `; the first unreadable line was ${JSON.stringify(first.slice(0, 200))}`) +
          (stderr.trim() === '' ? '' : `; stderr: ${stderr.trim().slice(0, 400)}`),
      );
    }
    if (init.apiKeySource !== KEY_VARIABLE) {
      refuse(
        'credential',
        `the session authenticated from '${init.apiKeySource}' rather than ${KEY_VARIABLE}; ` +
          'a key this driver did not supply is one it cannot account for, and one the CLI found is a credential inside the sandbox',
      );
    }
    const result = stream.result;
    if (result === undefined) {
      refuse('invocation', `the CLI ended without a result for task ${req.taskId} (exit code ${String(exitCode)})`);
    }
    if (result.apiErrorStatus !== undefined) {
      refuse(
        'invocation',
        `the model was not reached for task ${req.taskId}: the API answered ${String(result.apiErrorStatus)} and the CLI stopped retrying`,
      );
    }
    if (result.isError && result.numTurns === 0) {
      refuse('invocation', `the CLI took no turn for task ${req.taskId}: ${result.terminalReason ?? 'no reason given'}`);
    }
    // Nothing was refused mid-task. Under `bypassPermissions` there is nothing
    // to prompt and therefore nothing to deny, so a denial means the task ran
    // with less than it was granted, and the result describes work done under
    // conditions the request did not ask for (I5).
    if (result.permissionDenials.length > 0) {
      refuse(
        'grant',
        `task ${req.taskId} had ${String(result.permissionDenials.length)} tool use(s) denied ` +
          `(${result.permissionDenials.join(', ')}), so it did not run under the capabilities it was granted`,
      );
    }
    this.#refuseSessionUnlikeGrant(req, init);
    return init;
  }

  /**
   * The session the CLI actually started must offer exactly what the request
   * granted: no more, and no less.
   *
   * Everything else in this driver is an argument it hopes the CLI honours --
   * `--tools`, `--disallowedTools`, `--mcp-config`, `--strict-mcp-config`. This
   * is the one place that checks. The CLI prints what the session came up with
   * before it takes a turn, so the check costs nothing, and it is the backstop
   * for every assumption those flags rest on. Two of those assumptions were
   * already wrong before anyone read the session report: an inline MCP
   * configuration silently produced no servers at all, and a granted server
   * contributed tools nobody granted.
   *
   * Both directions refuse. A tool the session holds and the request did not
   * grant is a capability arriving from somewhere other than policy, which is
   * the whole of I4. A tool the request granted and the session does not hold
   * is a grant that did not take effect, and a task that runs anyway produces a
   * result describing work done under conditions nobody asked for, which is the
   * silent degrade I5 refuses.
   */
  #refuseSessionUnlikeGrant(req: TaskRequest, init: SessionInit): void {
    const granted = new Set(req.tools);
    const offered = new Set(init.tools);
    const ungranted = [...offered].filter((tool) => !granted.has(tool)).sort((a, b) => a.localeCompare(b));
    const missing = [...granted].filter((tool) => !offered.has(tool)).sort((a, b) => a.localeCompare(b));
    if (ungranted.length > 0) {
      refuse(
        'grant',
        `the session for task ${req.taskId} offers ${ungranted.map((t) => `'${t}'`).join(', ')}, which the request did not grant. ` +
          'A capability the model can reach and policy did not grant is the failure I4 exists to prevent.',
      );
    }
    if (missing.length > 0) {
      refuse(
        'grant',
        `the session for task ${req.taskId} does not offer ${missing.map((t) => `'${t}'`).join(', ')}, which the request granted. ` +
          'The grant did not take effect, and a task run without it would describe work done under conditions nobody asked for (I5).',
      );
    }
    const configured = new Set(Object.keys(this.#mcpServersFor(req)));
    const loaded = init.mcpServers.map((server) => server.name);
    const unexpected = loaded.filter((name) => !configured.has(name));
    if (unexpected.length > 0) {
      refuse(
        'grant',
        `the session for task ${req.taskId} loaded MCP server(s) ${unexpected.join(', ')}, which this driver did not configure`,
      );
    }
    const broken = init.mcpServers.filter((server) => server.status !== 'connected');
    if (broken.length > 0) {
      refuse(
        'invocation',
        `the session for task ${req.taskId} has MCP server(s) ${broken.map((b) => `${b.name} (${b.status})`).join(', ')} that are not connected; ` +
          'the granted tools were not reachable',
      );
    }
  }

  /** The servers this request's grants name. `#mcpConfigFor` refuses an unheld one; this one is for a grant already validated. */
  #mcpServersFor(req: TaskRequest): Record<string, McpServerConfig> {
    const wanted: Record<string, McpServerConfig> = {};
    for (const tool of req.tools) {
      const server = mcpServerOf(tool);
      if (server === undefined) continue;
      const config = this.#mcpServers[server];
      if (config !== undefined) wanted[server] = config;
    }
    return wanted;
  }

  #emit(event: DriverEvent): void {
    for (const handler of this.#handlers.get(event.kind) ?? []) handler(event);
  }
}

/**
 * The event stream, built from what the CLI reported rather than from what the
 * model said about itself.
 *
 * These are observations of the invocation, and the driver sees only what the
 * CLI emits: a write the CLI did not report is a write this list does not
 * have. That is exactly why P6 collects the diff itself and why `filesChanged`
 * lives on `AgentClaim` (D-P4-01).
 */
export function eventsFrom(stream: ParsedStream): DriverEvent[] {
  const at = new Date().toISOString();
  const events: DriverEvent[] = [];
  // A hook firing is a tool-call event carrying the lifecycle point, because
  // `DriverEvent['kind']` has no `hook` member and widening a frozen union to
  // fit an implementation detail of one driver is the wrong direction. What
  // the event proves is that the point the driver installed was reached.
  for (const hook of stream.hooks) {
    events.push({ at, kind: 'tool-call', detail: { hook: hook.event, name: hook.name, outcome: hook.outcome } });
  }
  for (const use of stream.toolUses) {
    const detail: Record<string, unknown> = { tool: use.name };
    if (use.parentToolUseId !== undefined) detail.parentToolUseId = use.parentToolUseId;
    events.push({ at, kind: 'tool-call', detail });
    if (isCommandTool(use.name)) {
      events.push({ at, kind: 'command', detail: { tool: use.name, command: use.input.command } });
    }
    const path = writtenPath(use.name, use.input);
    if (path !== undefined) events.push({ at, kind: 'file-write', detail: { tool: use.name, path } });
    if (isNetworkTool(use.name)) {
      events.push({ at, kind: 'network', detail: { tool: use.name, target: use.input.url ?? use.input.query } });
    }
    if (isSubagentTool(use.name)) {
      events.push({ at, kind: 'subagent', detail: { tool: use.name, subagentType: use.input.subagent_type } });
    }
  }
  return events;
}

/** The narrative and the files the model says it changed. Both are claims; neither is evidence (I2). */
function claimFrom(stream: ParsedStream): AgentClaim {
  const files = new Set<string>();
  for (const use of stream.toolUses) {
    const path = writtenPath(use.name, use.input);
    if (path !== undefined) files.add(path);
  }
  return { narrative: stream.result?.narrative ?? '', filesChanged: [...files] };
}

function usageFrom(stream: ParsedStream, fallbackDurationMs: number): Usage {
  const usage = stream.result?.usage;
  const reported = usage?.durationMs ?? 0;
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    costUsd: usage?.costUsd ?? 0,
    wallClockMs: reported === 0 ? fallbackDurationMs : reported,
  };
}

/**
 * A session id derived from the task id, so a stream can be tied back to the
 * task that asked for it. The CLI requires a UUID and a `TaskId` is not one,
 * so the bytes are a hash of the id rather than the id itself. Deterministic
 * on purpose: the same task asked for twice is the same session id, which is
 * what makes a stream attributable after the fact.
 */
export function sessionIdFor(taskId: TaskId): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < taskId.length; i += 1) {
    h1 = Math.imul(h1 ^ taskId.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + taskId.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  const hex = (n: number): string => n.toString(16).padStart(8, '0');
  const a = hex(h1);
  const b = hex(h2);
  const c = hex(Math.imul(h1 ^ h2, 0xc2b2ae35) >>> 0);
  const d = hex(Math.imul(h1 + h2, 0x27d4eb2f) >>> 0);
  // Version 5 and variant 10xx, so the CLI's UUID validation accepts it.
  return `${a}-${b.slice(0, 4)}-5${b.slice(5, 8)}-a${c.slice(1, 4)}-${c.slice(4, 8)}${d}`;
}

export interface ArtifactFile {
  readonly path: string;
  readonly content: string;
}

/**
 * The CLI's artifact layout: one `.md` agent definition per role, a `SKILL.md`
 * naming the set, and a settings file carrying the hook points. The format is
 * the driver's; the content of `instructions` is the compiler's (M2).
 */
export function artifactFiles(roles: readonly CompiledRole[], targetDir: string): ArtifactFile[] {
  const files: ArtifactFile[] = [];
  for (const role of roles) {
    files.push({
      path: `${targetDir}/agents/${role.role}.md`,
      content: `---\nname: ${role.role}\ndescription: the ${role.role} role\n---\n\n${role.instructions}\n`,
    });
  }
  files.push({
    path: `${targetDir}/skills/factory-roles/SKILL.md`,
    content:
      '---\nname: factory-roles\ndescription: The roles this run compiled, as the Claude Code CLI reads them.\n---\n\n' +
      roles.map((r) => `- ${r.role}`).join('\n') +
      '\n',
  });
  files.push({ path: `${targetDir}/settings.json`, content: `${JSON.stringify({ hooks: HOOK_SETTINGS }, null, 2)}\n` });
  return files;
}

/**
 * The hook points the driver installs. Each command is a no-op whose only
 * purpose is to fire, because what a hook should *do* is the compiler's and
 * the station line's. That they fire at all is `driver.hooks`, and the
 * assertion reads the CLI's own hook events rather than anything the model
 * says about them.
 */
export const HOOK_SETTINGS: Readonly<Record<string, unknown>> = {
  PreToolUse: [{ hooks: [{ type: 'command', command: 'true' }] }],
  PostToolUse: [{ hooks: [{ type: 'command', command: 'true' }] }],
  SessionStart: [{ hooks: [{ type: 'command', command: 'true' }] }],
};

/** Single-quotes a value for `sh -c`. Every embedded quote is closed, escaped, and reopened. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** The variable the artifact's bytes travel in. Never a here-document, and never an argument. */
export const ARTIFACT_CONTENT = 'DRIVER_ARTIFACT_CONTENT';

/**
 * The command that writes an artifact, with the content nowhere in it.
 *
 * It was a here-document, and a here-document ends at its delimiter wherever
 * that delimiter appears. Content carrying a line reading
 * `FACTORY_ARTIFACT_EOF` closed the document early and the rest of the file ran
 * as shell -- demonstrated, not theorised: a role whose instructions contained
 * that line executed `touch` inside the container. Quoting the delimiter stops
 * expansion *inside* the document; it does nothing about a line that ends it.
 *
 * `CompiledRole.instructions` is compiler output (M2), and a compiler's input
 * is a specification an agent may have written, so these bytes are not the
 * runtime's own. They now travel as an environment value and reach the file
 * through `printf %s`, which writes its argument literally. The only things on
 * the argv are the variable's name and the path, and `--` ends option parsing
 * so a path beginning with a dash cannot become a flag.
 */
export function writeFileArgv(path: string): string[] {
  return [
    'sh',
    '-c',
    `mkdir -p "$(dirname -- "$1")" && printf %s "$${ARTIFACT_CONTENT}" > "$1"`,
    'driver',
    path,
  ];
}
