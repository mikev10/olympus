/**
 * The `Driver` contract over any endpoint that speaks the OpenAI-compatible
 * chat-completions API (R6).
 *
 * The endpoint is a model and nothing more; the agent loop it lacks is this
 * driver's, and it runs in the runtime's process (D-R6-01). What reaches the
 * sandbox is narrow and fixed:
 *
 * - Each model turn is one `provider.relayCall`, which posts the request to
 *   the model relay from inside the relay's own read-only container, so no
 *   program the task wrote can answer in the model's place (A-R6-05). The
 *   relay holds the credential the sandbox never does and enforces the task's
 *   budget (P12, P13), so a turn is metered whether the model behaves or not.
 * - Each tool call is `provider.exec` inside the sandbox. Nothing the model
 *   asks for runs on the host (I1).
 *
 * What stays on the host is what must stay out of the agent's reach: the
 * tools the model is offered, the check that a call names one it was granted,
 * and the decision to run it (I4).
 */
import { posix } from 'node:path';
import {
  DRIVER_CONTRACT_VERSION,
  type CompiledRole,
  type Driver,
  type DriverCapabilities,
  type DriverEvent,
  type ModelIdentity,
  type ModelTier,
  type TaskId,
  type TaskRequest,
  type TaskResult,
  type Usage,
} from '@olympus-ai/core';
import { SandboxRefusal, type ExecOptions, type ExecResult, type RelaySpec, type SandboxHandle, type SandboxProvider } from '@olympus-ai/sandbox';
import { RELAY_URL_VARIABLE } from './call.js';
import { checkConfig, type CheckedConfig, type EndpointConfig } from './config.js';
import { DriverRefusal, refuse } from './refusal.js';
import { DECLARED_TOOLS, definitionsFor, runTool, type ToolOutcome } from './tools.js';

/** The name the sandbox provider holds the endpoint's credential under. A name, never a value. */
export const ENDPOINT_CREDENTIAL = 'openai-compatible-endpoint';

/** This driver's own version, stamped into its provenance. Bumped when what it sends or how it reads changes. */
export const DRIVER_VERSION = '1';

export interface OpenAICompatibleDriverOptions {
  /**
   * The provider that provisioned the handle in `TaskRequest.sandbox`. Not
   * optional and not defaulted: a driver that could fall back to running on
   * the host is the failure I1 exists to prevent.
   */
  readonly provider: SandboxProvider;
  /** The endpoint, as the operator declared it (D-R6-02). */
  readonly endpoint: EndpointConfig;
  /** The working directory inside the sandbox. Defaults to the workspace mount's usual target. */
  readonly workdir?: string;
  /** The credential name the provider holds the endpoint's key under. Defaults to `ENDPOINT_CREDENTIAL`. */
  readonly credential?: string;
}

/** One message of the conversation, in the chat API's shape. */
type ChatMessage =
  | { readonly role: 'system' | 'user'; readonly content: string }
  | { readonly role: 'assistant'; readonly content: string | null; readonly tool_calls?: readonly ToolCall[] }
  | { readonly role: 'tool'; readonly tool_call_id: string; readonly content: string };

interface ToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: { readonly name: string; readonly arguments: string };
}

/** One answer, read strictly: the model it says it is, its usage, and its message. */
interface Turn {
  readonly model: string;
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly completionTokens: number;
  readonly content: string | null;
  readonly toolCalls: readonly ToolCall[];
}

/** The most of an endpoint's error body a refusal quotes. */
const QUOTE_LIMIT = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function quoted(text: string): string {
  return JSON.stringify(text.length > QUOTE_LIMIT ? `${text.slice(0, QUOTE_LIMIT)}…` : text);
}

/**
 * Reads one answer, or refuses the task. A response with no usage is refused
 * rather than counted as free (D-R6-05): the relay has already charged its
 * ceiling and will forward nothing more. One naming no model is refused as
 * one naming another would be (D-R6-03).
 */
function readTurn(body: string): Turn {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    refuse('endpoint', `the endpoint answered with a body that is not JSON: ${quoted(body)}`);
  }
  if (!isRecord(parsed)) refuse('endpoint', `the endpoint answered with ${quoted(body)}, which is not a chat completion`);
  const model = parsed.model;
  if (typeof model !== 'string' || model === '') {
    refuse('identity', 'the endpoint answered without naming its model, so the model the family was declared for cannot be confirmed (I6)');
  }
  const usage = parsed.usage;
  const promptTokens = isRecord(usage) ? count(usage.prompt_tokens) : undefined;
  const completionTokens = isRecord(usage) ? count(usage.completion_tokens) : undefined;
  if (!isRecord(usage) || promptTokens === undefined || completionTokens === undefined) {
    refuse('endpoint', 'the endpoint answered without prompt_tokens and completion_tokens; an endpoint whose calls cannot be counted is not served (D-R6-05)');
  }
  const details = usage.prompt_tokens_details;
  const cachedTokens = Math.min(isRecord(details) ? (count(details.cached_tokens) ?? 0) : 0, promptTokens);
  const choices = parsed.choices;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first.message : undefined;
  if (!isRecord(message)) refuse('endpoint', `the endpoint answered with no message: ${quoted(body)}`);
  const content = message.content;
  if (content !== null && content !== undefined && typeof content !== 'string') {
    refuse('endpoint', 'the endpoint answered with a message whose content is not text');
  }
  const calls = message.tool_calls;
  const toolCalls: ToolCall[] = [];
  if (calls !== null && calls !== undefined) {
    if (!Array.isArray(calls)) refuse('endpoint', 'the endpoint answered with tool_calls that is not a list');
    for (const call of calls as unknown[]) {
      const fn = isRecord(call) ? call.function : undefined;
      if (!isRecord(call) || typeof call.id !== 'string' || !isRecord(fn) || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') {
        refuse('endpoint', `the endpoint answered with a tool call the driver cannot read: ${quoted(JSON.stringify(call))}`);
      }
      toolCalls.push({ id: call.id, type: 'function', function: { name: fn.name, arguments: fn.arguments } });
    }
  }
  return { model, promptTokens, cachedTokens, completionTokens, content: typeof content === 'string' ? content : null, toolCalls };
}

/** A tool call's arguments as an object, or the error the model is shown. */
function argumentsOf(call: ToolCall): Record<string, unknown> | string {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Fall through to the same error as a non-object.
  }
  return `error: the arguments to '${call.function.name}' are not a JSON object`;
}

export class OpenAICompatibleDriver implements Driver {
  readonly id = 'openai-compatible';
  readonly contractVersion = DRIVER_CONTRACT_VERSION;

  readonly #provider: SandboxProvider;
  readonly #config: CheckedConfig;
  readonly #workdir: string;
  readonly #credential: string;
  /** One task per sandbox at a time, whatever `parallelism` says (A-R4-04). */
  readonly #inFlight = new Map<SandboxHandle, Promise<unknown>>();
  /** Tasks running now across sandboxes, and those waiting for a slot, in arrival order. */
  #running = 0;
  readonly #waiting: Array<() => void> = [];
  readonly #handlers = new Map<DriverEvent['kind'], Array<(e: DriverEvent) => void>>();
  readonly #cancelled = new Set<TaskId>();
  /** Every request body each task sent, kept so a caller — and a conformance assertion — can read what the model was offered. */
  readonly #requests = new Map<TaskId, Array<Record<string, unknown>>>();

  constructor(options: OpenAICompatibleDriverOptions) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the type requires a provider, but a missing one means running tools on the host (I1). A caller arriving from untyped code is refused, not trusted.
    if (options.provider === undefined || options.provider === null) {
      refuse('provider', 'OpenAICompatibleDriver needs the SandboxProvider that provisioned the handle; there is no host fallback (I1)');
    }
    if (typeof options.provider.relayCall !== 'function') {
      refuse(
        'provider',
        `the provider '${options.provider.id}' cannot call the model relay from outside the sandbox; a model call made from inside it is answered by whatever the task left there (A-R6-05)`,
      );
    }
    this.#provider = options.provider;
    this.#config = checkConfig(options.endpoint);
    this.#workdir = options.workdir ?? '/workspace';
    this.#credential = options.credential ?? ENDPOINT_CREDENTIAL;
  }

  provenanceId(): string {
    return `${this.id}@${DRIVER_VERSION} ${this.#config.provider}/${this.#config.version}`;
  }

  /**
   * Every feature is false, and each is proven absent (D-R6-06): an endpoint
   * the driver has not measured backs no `true`. `parallelism` is the
   * operator's number, and `#bounded` is what makes it true.
   */
  capabilities(): DriverCapabilities {
    return {
      subagents: false,
      hooks: false,
      mcp: false,
      parallelism: this.#config.parallelism,
      computerUse: false,
      steering: false,
      stablePrefixCaching: false,
    };
  }

  declaredTools(): readonly string[] {
    return DECLARED_TOOLS;
  }

  /** The relay every sandbox this driver runs in is provisioned with: the endpoint's origin, its one path, and the `openai-chat` meter (A-R6-01). */
  relayRequest(): Omit<RelaySpec, 'budget'> {
    return {
      upstream: this.#config.upstream,
      paths: [this.#config.path],
      header: this.#config.header,
      scheme: this.#config.scheme,
      credential: this.#credential,
      urlVariable: RELAY_URL_VARIABLE,
      meter: { dialect: 'openai-chat', prices: { ...this.#config.prices } },
    };
  }

  /** I6: the family is the operator's declaration, branded once in the constructor. Nothing here derives it. */
  resolveModel(tier: ModelTier): ModelIdentity {
    const model = this.#config.models[tier];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- ModelTier is a union, but a tier arriving from parsed configuration can be outside it.
    if (model === undefined) refuse('capability', `no model is mapped to tier '${tier}'`);
    return { provider: this.#config.provider, family: this.#config.family, model, version: this.#config.version };
  }

  runTask(req: TaskRequest): Promise<TaskResult> {
    return this.#serialized(req.sandbox, () => this.#runTask(req));
  }

  /**
   * `spawnSubagent` and `steer` are deliberately absent, because
   * `capabilities()` declares both false. A method that threw would be a
   * capability declared false and present.
   */

  /** Stops a task at its next turn. The sandbox is the run's, so nothing here destroys it. */
  cancel(taskId: TaskId): Promise<void> {
    this.#cancelled.add(taskId);
    return Promise.resolve();
  }

  /**
   * There is no artifact format: the role is rendered on each request and
   * nowhere else (D-R6-06), so there is nothing to write and no hook to point
   * at. Refused rather than a no-op, which would read as roles written.
   */
  emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void> {
    return Promise.reject(
      new DriverRefusal(
        'capability',
        `OpenAICompatibleDriver has no artifact format; ${String(roles.length)} role(s) for ${targetDir} were not written. ` +
          'A role reaches this driver on each request, never as a file (D-R6-06).',
      ),
    );
  }

  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void {
    const existing = this.#handlers.get(kind);
    if (existing === undefined) this.#handlers.set(kind, [handler]);
    else existing.push(handler);
  }

  /** Every request body a task sent to the endpoint, in order. */
  requestsFor(taskId: TaskId): ReadonlyArray<Readonly<Record<string, unknown>>> {
    return this.#requests.get(taskId) ?? [];
  }

  async #serialized<T>(handle: SandboxHandle, body: () => Promise<T>): Promise<T> {
    // Checked again after every wait: another follower may have claimed the handle first.
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
    if (this.#running >= this.#config.parallelism) await new Promise<void>((admit) => this.#waiting.push(admit));
    else this.#running += 1;
    try {
      return await body();
    } finally {
      // A slot passes straight to the next caller waiting, so a newcomer never jumps the queue.
      const next = this.#waiting.shift();
      if (next === undefined) this.#running -= 1;
      else next();
    }
  }

  #emit(event: DriverEvent): void {
    for (const handler of this.#handlers.get(event.kind) ?? []) handler(event);
  }

  /**
   * I4: a granted tool this driver does not declare is refused before the
   * task starts, so a caller that bypassed the policy engine gets no wider
   * session than policy would have allowed.
   */
  #refuseUngrantedTools(req: TaskRequest): void {
    const declared = new Set(DECLARED_TOOLS);
    const undeclared = req.tools.filter((tool) => !declared.has(tool));
    if (undeclared.length > 0) {
      refuse(
        'grant',
        `the task grants ${undeclared.map((t) => `'${t}'`).join(', ')}, which this driver does not declare. ` +
          'The task was not started: a grant this driver cannot honour is a policy that means something other than what it says (I4).',
      );
    }
  }

  async #runTask(req: TaskRequest): Promise<TaskResult> {
    this.#refuseUngrantedTools(req);
    this.#cancelled.delete(req.taskId);
    const identity = this.resolveModel(req.tier);
    const granted = new Set(req.tools);
    const tools = definitionsFor(req.tools);
    const started = Date.now();
    const deadline = started + req.timeoutMs;
    const exec = (argv: string[], options?: ExecOptions): Promise<ExecResult> => this.#provider.exec(req.sandbox, argv, options);

    // The role and the run's stable material form the system message, and this task's own text the user
    // message, as the Claude Code driver renders them (D-A-RC-03): instructions first, never a file.
    const messages: ChatMessage[] = [
      { role: 'system', content: `${req.role.instructions}\n\n${req.stablePrefix}` },
      { role: 'user', content: req.variableSuffix },
    ];
    const events: DriverEvent[] = [];
    const written = new Set<string>();
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
    const sent: Array<Record<string, unknown>> = [];
    this.#requests.set(req.taskId, sent);
    const price = this.#config.prices[identity.model];
    // checkConfig refuses a tier model with no price; the table is a record, so the index is checked again here.
    if (price === undefined) refuse('configuration', `the model ${identity.model} has no price`);

    for (let turn = 1; ; turn += 1) {
      if (this.#cancelled.has(req.taskId)) refuse('invocation', `task ${req.taskId} was cancelled`);
      if (Date.now() >= deadline) refuse('invocation', `task ${req.taskId} ran past its ${String(req.timeoutMs)} ms bound`);
      if (turn > this.#config.maxTurns) {
        refuse('invocation', `task ${req.taskId} did not finish in ${String(this.#config.maxTurns)} model calls, the configured maxTurns`);
      }

      const body: Record<string, unknown> = {
        model: identity.model,
        messages,
        [this.#config.ceilingField]: this.#config.maxOutputTokens,
        stream: false,
        ...(tools.length === 0 ? {} : { tools }),
      };
      sent.push(JSON.parse(JSON.stringify(body)) as Record<string, unknown>);
      const answer = await this.#call(req.sandbox, body);
      const reply = readTurn(answer);
      if (reply.model !== identity.model) {
        refuse(
          'identity',
          `the endpoint answered as ${JSON.stringify(reply.model)} when ${JSON.stringify(identity.model)} was requested. ` +
            `The family '${identity.family}' was declared for the model requested, so the answer is not one the run can attribute (I6, D-R6-03).`,
        );
      }
      const input = reply.promptTokens - reply.cachedTokens;
      usage.inputTokens += input;
      usage.cacheReadTokens += reply.cachedTokens;
      usage.outputTokens += reply.completionTokens;
      usage.costUsd += (input * price.inputPerMTok + reply.cachedTokens * price.cacheReadPerMTok + reply.completionTokens * price.outputPerMTok) / 1e6;

      if (reply.toolCalls.length === 0) {
        const result: TaskResult = {
          taskId: req.taskId,
          claim: { narrative: reply.content ?? '', filesChanged: [...written].map((path) => this.#claimed(path)) },
          events,
          usage: { ...usage, wallClockMs: Date.now() - started } satisfies Usage,
          model: identity,
          contractVersion: this.contractVersion,
        };
        return result;
      }

      messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.toolCalls });
      for (const call of reply.toolCalls) {
        const name = call.function.name;
        let output: string;
        if (!granted.has(name)) {
          // Never run, and recorded: the model asked for a tool policy did not give it (I4).
          output = `error: the tool '${name}' is not granted to this task`;
          const refused: DriverEvent = { at: new Date().toISOString(), kind: 'tool-call', detail: { tool: name, refused: true } };
          events.push(refused);
          this.#emit(refused);
        } else {
          const args = argumentsOf(call);
          const outcome: ToolOutcome =
            typeof args === 'string'
              ? { output: args, event: { at: new Date().toISOString(), kind: 'tool-call' as const, detail: { tool: name, error: args } } }
              : await runTool(name, args, exec, this.#workdir);
          output = outcome.output;
          events.push(outcome.event);
          this.#emit(outcome.event);
          if (outcome.written !== undefined) written.add(outcome.written);
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      }
    }
  }

  /** One model call through the relay, made from the relay's own container (A-R6-05). Returns the body of a success; refuses on anything else. */
  async #call(sandbox: SandboxHandle, body: Record<string, unknown>): Promise<string> {
    const provider = this.#provider;
    // The constructor refused a provider without relayCall; the field is optional in the type, so it is checked again here.
    if (provider.relayCall === undefined) refuse('provider', `the provider '${provider.id}' cannot call the model relay (A-R6-05)`);
    let answer: { readonly status: number; readonly body: string };
    try {
      answer = await provider.relayCall(sandbox, { path: this.#config.path, body: JSON.stringify(body) });
    } catch (error) {
      // The sandbox's own refusals (its wall clock, its output cap) are reported as the sandbox's.
      if (error instanceof DriverRefusal || error instanceof SandboxRefusal) throw error;
      refuse('invocation', `the model call through the relay failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (answer.status === 402) refuse('budget', `the relay refused the call: ${quoted(answer.body)}`);
    if (answer.status < 200 || answer.status >= 300) {
      refuse('endpoint', `the endpoint answered ${String(answer.status)}: ${quoted(answer.body)}`);
    }
    return answer.body;
  }

  /** A written path as the claim names it: relative to the working directory when inside it. */
  #claimed(path: string): string {
    const relative = posix.relative(this.#workdir, path);
    return relative.startsWith('..') || posix.isAbsolute(relative) ? path : relative;
  }
}
