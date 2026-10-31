/**
 * CodexDriver: the `Driver` contract over the Codex CLI, run inside a
 * provisioned sandbox (R26).
 *
 * It follows the Claude Code driver's shape, and the recorded Codex
 * constraint binds it. The class holds a `SandboxProvider` and has no other way
 * to start a process: every command goes through `provider.exec` against the
 * handle the request carries, so the mount table, which keeps the Vault out,
 * is the only filesystem the model can reach (I1). There is no `spawn` here.
 *
 * It holds no credential (P12). The sandbox runs with a relay that holds the
 * key and forwards the CLI's requests, and the CLI is given a placeholder
 * where a key would go. It does not bound spend either (P13): the relay meters
 * every call under `MODEL_METER` and refuses once the task's budget is spent.
 *
 * Every task runs twice, in a sense. First the inspection (`capture.ts`,
 * D-R26-02) runs the same invocation against an endpoint on the sandbox's
 * loopback and reads the request the session would send: its tools, its
 * model, and its credential. Only a session that offers exactly the grant,
 * names the model the runtime resolved, and carries the placeholder is then
 * run for real, through the relay.
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
  TaskId,
  TaskRequest,
  TaskResult,
  Usage,
} from '@olympus-ai/core';
import { DRIVER_CONTRACT_VERSION } from '@olympus-ai/core';
import type { ModelPrice, RelayMeter, RelaySpec, SandboxHandle, SandboxProvider } from '@olympus-ai/sandbox';
import { CAPTURE_NONCE_VARIABLE, CAPTURE_SOURCE, CAPTURE_SOURCE_VARIABLE, capturedFrom, markers, type CapturedRequest } from './capture.js';
import { parseEvents, type ParsedEvents } from './events.js';
import { CLI_VERSION } from './image.js';
import { DriverRefusal, refuse } from './refusal.js';
import { DECLARED_TOOLS, TOOL_GROUPS, groupsFor, type ToolGroup } from './tools.js';

/** The variable the CLI reads its key from (`model_providers.<id>.env_key`). It carries `KEY_PLACEHOLDER`, never a credential. */
export const KEY_VARIABLE = 'OPENAI_API_KEY';

/** What the CLI sends where a key would go. The relay drops it and writes the credential it holds (D-P12-03). */
export const KEY_PLACEHOLDER = 'relay-held-credential-placeholder';

/** The name of the credential the relay is given: `LocalDockerProvider.create({ credentials: { [MODEL_CREDENTIAL]: key } })`. */
export const MODEL_CREDENTIAL = 'openai';

/** The variable the provider gives the relay's address in. The CLI is pointed at it on the argv, never through its own defaults. */
export const RELAY_URL_VARIABLE = 'MODEL_RELAY_URL';

/** The date the prices in `MODEL_METER` were read from OpenAI's published list. */
export const PRICES_AS_OF = '2026-10-31';

/**
 * A model's price at its ceiling (D-R26-06): OpenAI bills a prompt over 272K
 * input tokens at twice the input rate and one and a half times the output
 * rate, and the meter cannot see a prompt's length before it prices one, so
 * every call is priced as though it were that long. The dollar figure is then
 * high, by those factors, and never low. The Responses API reports no cache
 * writes, so their prices are never charged; they are set to the input rate's
 * ceiling only so the table has no zero a reader could take for free.
 */
function price(input: number, cached: number, output: number): ModelPrice {
  const longInput = input * 2;
  return {
    inputPerMTok: longInput,
    outputPerMTok: output * 1.5,
    cacheReadPerMTok: cached * 2,
    cacheWritePerMTok: longInput,
    cacheWrite1hPerMTok: longInput,
    maxOutputTokens: 128_000,
  };
}

/**
 * How the relay reads a call of this driver and what each model costs
 * (A-R26-01). List prices per million tokens, as of `PRICES_AS_OF`, before
 * the ceiling factors: input, cached input, output. A model not here is
 * refused by the relay before its request is sent.
 */
export const MODEL_METER: Readonly<RelayMeter> = Object.freeze({
  dialect: 'openai-responses',
  prices: Object.freeze({
    'gpt-5.6-luna': price(0.2, 0.02, 1.2),
    'gpt-5.6-terra': price(2, 0.2, 12),
    'gpt-5.6-sol': price(4, 0.4, 20),
  }),
});

/**
 * The relay a sandbox this driver runs in must be provisioned with: the API
 * origin, the one path the CLI calls, the header and scheme the API reads a
 * key in, the variable the relay's address is given in, and the meter. The
 * budget is the task's, added by whoever provisions the sandbox (D-P13-01).
 */
export const MODEL_RELAY: Readonly<Omit<RelaySpec, 'budget'>> = Object.freeze({
  upstream: 'https://api.openai.com',
  paths: ['/v1/responses'],
  header: 'authorization',
  scheme: 'bearer',
  credential: MODEL_CREDENTIAL,
  urlVariable: RELAY_URL_VARIABLE,
  meter: MODEL_METER,
});

/**
 * I6: the family is a value this driver states, here, once. It is not derived
 * from `id`, the provider, the tier, or a model name, and nothing the CLI or
 * the API reports can change it.
 */
export const FAMILY = 'openai' as ModelFamily;

/** The most tasks this driver runs at once, each on its own sandbox (A-R4-04). */
export const PARALLELISM = 4;

/** Tier to model, by the exact name the relay prices (D-R26-05). */
export const TIER_MODELS: Readonly<Record<ModelTier, string>> = Object.freeze({
  fast: 'gpt-5.6-luna',
  standard: 'gpt-5.6-terra',
  deep: 'gpt-5.6-sol',
});

/** The catalogs the image writes, owned by root (D-R26-04). */
export const CATALOG_WITH_PATCH = '/opt/codex/catalog-patch.json';
export const CATALOG_WITHOUT_PATCH = '/opt/codex/catalog-no-patch.json';

/** Where each invocation makes its own home (D-R26-09). */
export const HOMES_DIR = '/codex-homes';

/** The model provider the argv defines. Its name is the driver's, so no provider the CLI ships is used by accident. */
const PROVIDER_ID = 'model-relay';

/** How long the inspection may take. It calls no model, so this bounds a CLI that failed to start. */
const INSPECT_TIMEOUT_SECONDS = 90;

/** A working directory the argv can name inside a TOML key without quoting surprises. */
const SAFE_DIR = /^\/[A-Za-z0-9._/-]*$/u;

export interface CodexDriverOptions {
  /** The provider that provisioned the handle in `TaskRequest.sandbox`. Not optional: there is no host fallback (I1). */
  readonly provider: SandboxProvider;
  /** The working directory inside the sandbox. Defaults to the workspace mount's usual target. */
  readonly workdir?: string;
  /** Overrides the tier-to-model map. Every model must be in `MODEL_METER`, or the relay refuses its calls. */
  readonly models?: Readonly<Record<ModelTier, string>>;
}

/**
 * What the inspection read from the session's one request. Kept per task so a
 * caller and the suite can see what the session was configured with, rather
 * than inferring it from what the model said.
 */
export interface Inspection {
  readonly tools: readonly string[];
  readonly model: string;
  readonly authorization: string | null;
  /** The request body the session would have sent, verbatim. */
  readonly body: string;
}

/** A UTF-16 code unit that is half of a pair with no other half. */
// No u flag: under it a lone surrogate cannot be matched, which is the one thing this pattern is for.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A TOML basic string. JSON's escapes are TOML's, save DEL, which TOML forbids raw; a value that is not well-formed UTF-16 is refused. */
export function tomlString(value: string): string {
  if (LONE_SURROGATE.test(value)) refuse('invocation', 'a value for the CLI configuration holds an unpaired surrogate, which TOML cannot carry');
  return JSON.stringify(value).replaceAll('\u007f', '\\u007f');
}

export class CodexDriver implements Driver {
  readonly id = 'codex';
  readonly contractVersion = DRIVER_CONTRACT_VERSION;

  readonly #provider: SandboxProvider;
  readonly #workdir: string;
  readonly #models: Readonly<Record<ModelTier, string>>;
  readonly #inFlight = new Map<SandboxHandle, Promise<unknown>>();
  #running = 0;
  readonly #waiting: Array<() => void> = [];
  readonly #handlers = new Map<DriverEvent['kind'], Array<(e: DriverEvent) => void>>();
  readonly #inspections = new Map<TaskId, Inspection>();

  constructor(options: CodexDriverOptions) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the type requires a provider, but a missing one here means running the model on the host (I1). A caller from untyped code is refused, not trusted.
    if (options.provider === undefined || options.provider === null) {
      refuse('provider', 'CodexDriver needs the SandboxProvider that provisioned the handle; there is no host fallback (I1)');
    }
    const workdir = options.workdir ?? '/workspace';
    if (!SAFE_DIR.test(workdir)) {
      refuse('capability', `the working directory ${JSON.stringify(workdir)} is not a plain absolute path; it is named in the CLI's configuration, which is TOML`);
    }
    const models = options.models ?? TIER_MODELS;
    for (const [tier, model] of Object.entries(models)) {
      if (!Object.hasOwn(MODEL_METER.prices, model)) {
        refuse('capability', `tier '${tier}' maps to ${JSON.stringify(model)}, which MODEL_METER does not price, so the relay would refuse every call`);
      }
    }
    this.#provider = options.provider;
    this.#workdir = workdir;
    this.#models = models;
  }

  provenanceId(): string {
    return `${this.id}@${CLI_VERSION}`;
  }

  /**
   * Each value is asserted against the real CLI under `driver.<key>.codex`
   * (I8, D-R26-07). The `false` ones have no method behind them: a method
   * present beside a capability declared false is the direction the
   * conformance assertion refuses.
   */
  capabilities(): DriverCapabilities {
    return {
      subagents: false,
      hooks: false,
      mcp: false,
      parallelism: PARALLELISM,
      computerUse: false,
      steering: false,
      stablePrefixCaching: false,
    };
  }

  declaredTools(): readonly string[] {
    return DECLARED_TOOLS_VIEW;
  }

  relayRequest(): Omit<RelaySpec, 'budget'> {
    return { ...MODEL_RELAY, paths: [...MODEL_RELAY.paths] };
  }

  /** I6: `family` is `FAMILY`, assigned. Nothing here reads the tier, the model, or `this.id` to produce it. */
  resolveModel(tier: ModelTier): ModelIdentity {
    const model = this.#models[tier];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a tier from parsed configuration can be outside the union, and an undefined model would reach the argv as 'undefined'.
    if (model === undefined) refuse('capability', `no model is mapped to tier '${tier}'`);
    return { provider: 'openai', family: FAMILY, model, version: CLI_VERSION };
  }

  runTask(req: TaskRequest): Promise<TaskResult> {
    return this.#serialized(req.sandbox, () => this.#runTask(req));
  }

  /** Forgets a task's inspection. The container is the run's, so nothing here destroys it. */
  cancel(taskId: TaskId): Promise<void> {
    this.#inspections.delete(taskId);
    return Promise.resolve();
  }

  /** `hooks` is false: there is no artifact format this driver installs, so it refuses and writes nothing. */
  emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void> {
    return Promise.reject(
      new DriverRefusal(
        'capability',
        `emitArtifacts was asked for ${String(roles.length)} role(s) under ${targetDir}, but this driver declares hooks false and installs no artifacts; ` +
          'a role reaches the session on the argv alone (D-R26-08)',
      ),
    );
  }

  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void {
    const existing = this.#handlers.get(kind);
    if (existing === undefined) this.#handlers.set(kind, [handler]);
    else existing.push(handler);
  }

  /** What the inspection read for a task, once one has run. */
  inspectionFor(taskId: TaskId): Inspection | undefined {
    return this.#inspections.get(taskId);
  }

  /**
   * Runs the inspection alone and returns what it read, refusing as a task
   * would. No model is called. The suite uses it to read the request a
   * session would send without paying for one.
   */
  inspect(req: TaskRequest): Promise<Inspection> {
    return this.#serialized(req.sandbox, async () => {
      const groups = this.#groupsOrRefuse(req);
      const identity = this.resolveModel(req.tier);
      return this.#inspect(req, identity, groups);
    });
  }

  async #serialized<T>(handle: SandboxHandle, body: () => Promise<T>): Promise<T> {
    for (let held = this.#inFlight.get(handle); held !== undefined; held = this.#inFlight.get(handle)) {
      await held.catch(() => undefined);
    }
    const running = this.#bounded(body);
    this.#inFlight.set(handle, running);
    try {
      return await running;
    } finally {
      if (this.#inFlight.get(handle) === running) this.#inFlight.delete(handle);
    }
  }

  async #bounded<T>(body: () => Promise<T>): Promise<T> {
    if (this.#running >= PARALLELISM) await new Promise<void>((admit) => this.#waiting.push(admit));
    else this.#running += 1;
    try {
      return await body();
    } finally {
      const next = this.#waiting.shift();
      if (next === undefined) this.#running -= 1;
      else next();
    }
  }

  async #runTask(req: TaskRequest): Promise<TaskResult> {
    const groups = this.#groupsOrRefuse(req);
    const identity = this.resolveModel(req.tier);
    await this.#inspect(req, identity, groups);

    const exec = await this.#provider.exec(req.sandbox, runArgv(this.#workdir, cliArgs(this.#workdir, identity.model, req, groups)), {
      env: { [KEY_VARIABLE]: KEY_PLACEHOLDER },
    });
    const parsed = parseEvents(exec.stdout);
    refuseUnusable(req, exec.exitCode, exec.stderr, parsed, identity);
    const events = eventsFrom(parsed);
    for (const event of events) this.#emit(event);
    return {
      taskId: req.taskId,
      claim: claimFrom(parsed),
      events,
      usage: usageFrom(parsed, identity.model, exec.durationMs),
      // The CLI reports no model of its own (D-R26-01); a reroute it did report was refused above.
      model: identity,
      contractVersion: this.contractVersion,
    };
  }

  /** I4: the grant is refused unless the CLI can offer exactly it. */
  #groupsOrRefuse(req: TaskRequest): readonly ToolGroup[] {
    const mcp = req.tools.filter((tool) => tool.startsWith('mcp__'));
    if (mcp.length > 0) {
      refuse('grant', `the task grants ${mcp.map((t) => `'${t}'`).join(', ')}, but this driver declares mcp false and configures no server (D-R26-07)`);
    }
    const result = groupsFor(req.tools);
    if ('refusal' in result) {
      refuse('grant', `${result.refusal}. The task was not started: a grant this driver cannot honour exactly means something other than what it says (I4).`);
    }
    return result.groups;
  }

  /** D-R26-02: the request the session would send, read from an endpoint on the sandbox's loopback, and held to the grant. */
  async #inspect(req: TaskRequest, identity: ModelIdentity, groups: readonly ToolGroup[]): Promise<Inspection> {
    const nonce = crypto.randomUUID();
    const exec = await this.#provider.exec(req.sandbox, inspectArgv(this.#workdir, nonce, cliArgs(this.#workdir, identity.model, req, groups)), {
      env: { [KEY_VARIABLE]: KEY_PLACEHOLDER, [CAPTURE_SOURCE_VARIABLE]: CAPTURE_SOURCE, [CAPTURE_NONCE_VARIABLE]: nonce, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' },
    });
    const captured = capturedFrom(exec.stdout, nonce);
    if ('missing' in captured) {
      refuse(
        'invocation',
        `the session for task ${req.taskId} could not be inspected: ${captured.missing} (exit code ${String(exec.exitCode)})` +
          (exec.stderr.trim() === '' ? '' : `; stderr: ${exec.stderr.trim().slice(0, 400)}`) +
          '. The task was not started: running it would offer the model tools nobody has enumerated (I4, I5).',
      );
    }
    const inspection = inspectionFrom(req, captured.requests);
    const granted = [...new Set(req.tools)].sort((a, b) => a.localeCompare(b));
    const offered = [...new Set(inspection.tools)].sort((a, b) => a.localeCompare(b));
    const ungranted = offered.filter((tool) => !granted.includes(tool));
    const missing = granted.filter((tool) => !offered.includes(tool));
    if (ungranted.length > 0 || missing.length > 0 || offered.length !== inspection.tools.length) {
      refuse(
        'grant',
        `the session for task ${req.taskId} would offer [${inspection.tools.join(', ')}] where the request granted [${granted.join(', ')}]` +
          (ungranted.length > 0 ? `; ${ungranted.join(', ')} not granted (I4)` : '') +
          (missing.length > 0 ? `; ${missing.join(', ')} granted and absent, so the grant did not take effect (I5)` : ''),
      );
    }
    if (inspection.model !== identity.model) {
      refuse('invocation', `the session for task ${req.taskId} would ask for ${JSON.stringify(inspection.model)} where the runtime resolved ${identity.model}`);
    }
    if (inspection.authorization !== `Bearer ${KEY_PLACEHOLDER}`) {
      refuse(
        'credential',
        `the session for task ${req.taskId} would authenticate with something other than the placeholder in ${KEY_VARIABLE}; ` +
          'a key the driver did not supply is one it cannot account for, and one the CLI found is a credential inside the sandbox',
      );
    }
    this.#inspections.set(req.taskId, inspection);
    return inspection;
  }

  #emit(event: DriverEvent): void {
    for (const handler of this.#handlers.get(event.kind) ?? []) handler(event);
  }
}

/** What `declaredTools()` hands out: a frozen copy, so a caller cannot widen the inventory. */
const DECLARED_TOOLS_VIEW: readonly string[] = Object.freeze([...DECLARED_TOOLS]);

/** The one request an inspection may see, read into what the driver checks. Anything else is refused. */
function inspectionFrom(req: TaskRequest, requests: readonly CapturedRequest[]): Inspection {
  const posts = requests.filter((r) => r.method === 'POST' && (r.url.split('?')[0] ?? '').endsWith('/responses'));
  const others = requests.filter((r) => !posts.includes(r));
  if (others.length > 0) {
    refuse(
      'invocation',
      `the session for task ${req.taskId} reached ${others.map((r) => `${r.method} ${r.url}`).join(', ')} beside the Responses endpoint; ` +
        'the relay grants that one path, so the task would fail for a reason that is not its own',
    );
  }
  const first = posts[0];
  if (posts.length !== 1 || first?.body == null) {
    refuse('invocation', `the session for task ${req.taskId} sent ${String(posts.length)} readable Responses request(s) during inspection, not one`);
  }
  let body: unknown;
  try {
    body = JSON.parse(first.body);
  } catch {
    refuse('invocation', `the session for task ${req.taskId} sent a Responses request whose body is not JSON`);
  }
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const tools = fields.tools ?? [];
  if (!Array.isArray(tools)) refuse('invocation', `the session for task ${req.taskId} sent a tools field that is not a list`);
  const names = (tools as unknown[]).map((tool) => {
    const t = typeof tool === 'object' && tool !== null ? (tool as Record<string, unknown>) : {};
    const name = typeof t.name === 'string' ? t.name : typeof t.type === 'string' ? `type:${t.type}` : undefined;
    if (name === undefined) refuse('invocation', `the session for task ${req.taskId} offers a tool with neither a name nor a type`);
    return name;
  });
  // A tool list delivered inside the input, as code mode delivers one, is a set this check cannot read (D-R26-04).
  const input = Array.isArray(fields.input) ? (fields.input as unknown[]) : [];
  if (input.some((item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).type === 'additional_tools')) {
    refuse('invocation', `the session for task ${req.taskId} carries its tools inside the input, which the driver cannot hold to the grant`);
  }
  return { tools: names, model: typeof fields.model === 'string' ? fields.model : '', authorization: first.authorization, body: first.body };
}

/**
 * The CLI's arguments after `codex exec`, the same for the inspection and the run.
 * The base URL is not here: each wrapper puts its own first, before the `--`
 * that ends the options, so the two invocations differ in that one argument.
 */
export function cliArgs(workdir: string, model: string, req: TaskRequest, groups: readonly ToolGroup[]): string[] {
  const held = new Set(groups);
  const args = [
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    // Nothing from a home or rules file configures the session, and a fresh home holds none anyway (D-R26-09).
    '--ignore-user-config',
    '--ignore-rules',
    // The container is the sandbox, and nobody is there to approve (D-R26-11).
    '--dangerously-bypass-approvals-and-sandbox',
    '--cd', workdir,
    '--model', model,
    '-c', `model_provider=${tomlString(PROVIDER_ID)}`,
    '-c', `model_providers.${PROVIDER_ID}.name=${tomlString(PROVIDER_ID)}`,
    '-c', `model_providers.${PROVIDER_ID}.env_key=${tomlString(KEY_VARIABLE)}`,
    '-c', `model_providers.${PROVIDER_ID}.wire_api="responses"`,
    '-c', `model_providers.${PROVIDER_ID}.supports_websockets=false`,
    '-c', `model_providers.${PROVIDER_ID}.capabilities.remote_compaction="unsupported"`,
    // The catalog decides apply_patch, and the rest of its overrides hold for every task (D-R26-04).
    '-c', `model_catalog_json=${tomlString(groups.some((g) => g.lever.kind === 'catalog') ? CATALOG_WITH_PATCH : CATALOG_WITHOUT_PATCH)}`,
    // Workspace instructions off, every source of them (D-A-DD-03).
    '-c', 'project_doc_max_bytes=0',
    '-c', `projects.${tomlString(workdir)}.trust_level="untrusted"`,
    '-c', 'skills.include_instructions=false',
    '-c', 'skills.bundled.enabled=false',
    '--disable', 'plugins',
    '--disable', 'hooks',
    '--disable', 'apps',
    '--disable', 'memories',
    // With the catalog's multi_agent_version null, this leaves no multi-agent tool; either alone does not (D-R26-03).
    '--disable', 'multi_agent',
    // Never offered (D-R26-03).
    '-c', 'web_search="disabled"',
    '-c', 'tools.experimental_request_user_input.enabled=false',
    // The role and the granted context, on the argv and never in the workspace (D-R26-08).
    '-c', `developer_instructions=${tomlString(`${req.role.instructions}\n\n${req.stablePrefix}`)}`,
  ];
  for (const group of TOOL_GROUP_FEATURES) {
    args.push(held.has(group) ? '--enable' : '--disable', featureOf(group));
  }
  args.push('--', req.variableSuffix);
  return args;
}

const TOOL_GROUP_FEATURES: readonly ToolGroup[] = TOOL_GROUPS.filter((group) => group.lever.kind === 'feature');

function featureOf(group: ToolGroup): string {
  if (group.lever.kind !== 'feature') throw new Error('a catalog lever has no feature');
  return group.lever.feature;
}

/** Makes a fresh home, then runs the CLI as the process itself. `exec "$@"` keeps every argument an argv element the shell never re-reads. */
function runArgv(workdir: string, args: readonly string[]): string[] {
  const script = [
    'set -eu',
    `home="$(mktemp -d ${HOMES_DIR}/h.XXXXXX)"`,
    'export HOME="$home" CODEX_HOME="$home"',
    `cd ${shellQuote(workdir)}`,
    `exec codex exec -c "model_providers.${PROVIDER_ID}.base_url=\\"\${${RELAY_URL_VARIABLE}}/v1\\"" "$@"`,
  ].join('\n');
  return ['sh', '-c', script, 'driver', ...args];
}

/**
 * The inspection: the endpoint on loopback, the CLI pointed at it, and the
 * capture printed between markers once both have stopped. The CLI's own
 * output is discarded, so nothing it prints can stand between the markers.
 * Exported so the suite can run a control through the same capture.
 */
export function inspectArgv(workdir: string, nonce: string, args: readonly string[]): string[] {
  const { begin, end } = markers(nonce);
  const script = [
    'set -eu',
    `home="$(mktemp -d ${HOMES_DIR}/h.XXXXXX)"`,
    `cap="$(mktemp -d ${HOMES_DIR}/c.XXXXXX)"`,
    'export HOME="$home" CODEX_HOME="$home"',
    `node --eval "$${CAPTURE_SOURCE_VARIABLE}" "$cap" & server=$!`,
    'i=0; while [ ! -s "$cap/port" ] && [ "$i" -lt 100 ]; do sleep 0.1; i=$((i+1)); done',
    '[ -s "$cap/port" ] || { kill "$server" 2>/dev/null; echo "the capture endpoint did not start" >&2; exit 1; }',
    `cd ${shellQuote(workdir)}`,
    `timeout ${String(INSPECT_TIMEOUT_SECONDS)} codex exec -c "model_providers.${PROVIDER_ID}.base_url=\\"http://127.0.0.1:$(cat "$cap/port")/v1\\"" "$@" >/dev/null 2>"$cap/stderr" || true`,
    'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true',
    `printf '%s\\n' ${shellQuote(begin)}`,
    'cat "$cap/requests.json" 2>/dev/null || true',
    `printf '\\n%s\\n' ${shellQuote(end)}`,
    'tail -c 400 "$cap/stderr" >&2 || true',
    'rm -rf "$home" "$cap"',
  ].join('\n');
  return ['sh', '-c', script, 'driver', ...args];
}

/** Fail closed on anything that means the task did not run as asked (I5). */
function refuseUnusable(req: TaskRequest, exitCode: number, stderr: string, parsed: ParsedEvents, identity: ModelIdentity): void {
  const tail = stderr.trim() === '' ? '' : `; stderr: ${stderr.trim().slice(-400)}`;
  if (parsed.threadId === undefined) {
    refuse('invocation', `the CLI started no session for task ${req.taskId} (exit code ${String(exitCode)})${tail}`);
  }
  if (parsed.unreadable.length > 0 || parsed.unknown.length > 0) {
    refuse(
      'invocation',
      `the CLI reported what this driver does not read for task ${req.taskId}: ` +
        [...parsed.unknown, ...parsed.unreadable.map((line) => JSON.stringify(line.slice(0, 200)))].join(', ') +
        '. An item outside the declared tools is a capability nobody granted, and an unread event is one nobody checked (I4, I5).',
    );
  }
  if (parsed.reroute !== undefined) {
    refuse('invocation', `the API rerouted task ${req.taskId} from ${identity.model} to ${parsed.reroute}; work by another model is not attributed to the one the runtime chose (I6)`);
  }
  if (parsed.failures.length > 0) {
    refuse('invocation', `task ${req.taskId} failed: ${parsed.failures.map((f) => JSON.stringify(f.slice(0, 300))).join('; ')}${tail}`);
  }
  if (parsed.usage === undefined || exitCode !== 0) {
    refuse('invocation', `the CLI ended task ${req.taskId} without completing a turn (exit code ${String(exitCode)})${tail}`);
  }
}

/** Observations of the invocation, built from what the CLI reported, never from what the model said about itself. */
export function eventsFrom(parsed: ParsedEvents): DriverEvent[] {
  const at = new Date().toISOString();
  const events: DriverEvent[] = [];
  for (const command of parsed.commands) {
    events.push({ at, kind: 'tool-call', detail: { tool: 'exec_command' } });
    events.push({ at, kind: 'command', detail: { tool: 'exec_command', command: command.command, exitCode: command.exitCode } });
  }
  for (const path of parsed.changedPaths) {
    events.push({ at, kind: 'tool-call', detail: { tool: 'apply_patch' } });
    events.push({ at, kind: 'file-write', detail: { tool: 'apply_patch', path } });
  }
  return events;
}

/** The narrative and the files the session says it changed. Both are claims (I2). */
function claimFrom(parsed: ParsedEvents): AgentClaim {
  return { narrative: parsed.messages.at(-1) ?? '', filesChanged: [...new Set(parsed.changedPaths)] };
}

/**
 * The CLI's account of the task. Its `input_tokens` include the cached ones,
 * as the API's do, so the cached part is taken out, the way the relay counts
 * it (A-R26-01). The dollars are the meter's own prices, so the figure is the
 * relay's arithmetic over the CLI's counts.
 */
function usageFrom(parsed: ParsedEvents, model: string, durationMs: number): Usage {
  const u = parsed.usage ?? { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
  const cached = Math.min(u.cachedInputTokens, u.inputTokens);
  const input = u.inputTokens - cached;
  const p = MODEL_METER.prices[model];
  const costUsd = p === undefined ? 0 : (input * p.inputPerMTok + u.outputTokens * p.outputPerMTok + cached * p.cacheReadPerMTok) / 1e6;
  return { inputTokens: input, outputTokens: u.outputTokens, cacheReadTokens: cached, cacheWriteTokens: u.cacheWriteTokens, costUsd, wallClockMs: durationMs };
}

/** Single-quotes a value for `sh -c`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

