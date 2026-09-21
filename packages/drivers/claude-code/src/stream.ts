/**
 * Reading the CLI's `--output-format stream-json` output.
 *
 * The stream is one JSON object per line. Three of them matter: the `init`
 * system message, which reports what the session actually came up with — the
 * tool list, the MCP servers, the model, the credential source — the
 * `assistant` messages, which carry the tool uses, and the final `result`,
 * which carries usage and cost.
 *
 * What the runtime keeps from this is evidence about the *invocation*, not a
 * verdict about the *work*. `is_error` and `terminal_reason` describe whether
 * the CLI got a turn out of the API; neither is a status for the task, and
 * `TaskResult` has nowhere to put one (I2).
 */
import { asArray, asBoolean, asFiniteNumber, asRecord, asString, at, stringsIn } from './json.js';

/** What the session reported about itself at startup, before any turn. */
export interface SessionInit {
  /** The tools actually available to the model, as the CLI resolved them. */
  readonly tools: readonly string[];
  /** The MCP servers actually loaded, by name. */
  readonly mcpServers: ReadonlyArray<{ readonly name: string; readonly status: string }>;
  /** Subagent types actually available, by name. */
  readonly agents: readonly string[];
  readonly model: string;
  readonly sessionId: string;
  /** Where the CLI found its credential. `ANTHROPIC_API_KEY` is the only one this driver arranges. */
  readonly apiKeySource: string;
  readonly cliVersion: string;
}

/**
 * One hook the CLI ran, as `--include-hook-events` reports it. Observed by the
 * CLI rather than narrated by the model: a hook that did not fire produces no
 * line here, and no amount of the model saying it did puts one in.
 */
export interface HookFiring {
  /** The lifecycle point, e.g. `PreToolUse`. */
  readonly event: string;
  /** The configured hook's name, e.g. `SessionStart:startup`. */
  readonly name: string;
  /** `success` when the hook ran and exited zero. Present only on the response line. */
  readonly outcome: string | undefined;
}

/** One tool the model asked for, in the order the stream reported it. */
export interface ToolUse {
  readonly name: string;
  readonly input: Record<string, unknown>;
  /** Set when the use came from inside a subagent rather than the main turn. */
  readonly parentToolUseId: string | undefined;
}

/** Token and money counters, as the CLI reported them. */
export interface StreamUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly durationMs: number;
}

export interface StreamResult {
  readonly narrative: string;
  readonly usage: StreamUsage;
  readonly numTurns: number;
  /** True when the CLI could not get the turn it was asked for. Not a verdict on the work. */
  readonly isError: boolean;
  /** Present when the failure was an API status, e.g. 401. */
  readonly apiErrorStatus: number | undefined;
  /** How the CLI says the session ended, e.g. `api_error`. */
  readonly terminalReason: string | undefined;
  /** Tool calls the permission layer refused. A non-empty list is evidence about I4, not a warning. */
  readonly permissionDenials: readonly string[];
  /** How many subagents the CLI says it started. */
  readonly subagentsSpawned: number;
}

export interface ParsedStream {
  readonly init: SessionInit | undefined;
  readonly hooks: readonly HookFiring[];
  readonly toolUses: readonly ToolUse[];
  readonly textBlocks: readonly string[];
  readonly result: StreamResult | undefined;
  /** Lines that were not JSON at all. Kept so a refusal can quote one. */
  readonly unreadable: readonly string[];
}

function readInit(message: Record<string, unknown>): SessionInit {
  const servers: Array<{ name: string; status: string }> = [];
  for (const entry of asArray(message.mcp_servers) ?? []) {
    const record = asRecord(entry);
    const name = asString(record?.name);
    if (name === undefined) continue;
    servers.push({ name, status: asString(record?.status) ?? 'unknown' });
  }
  return {
    tools: stringsIn(message.tools),
    mcpServers: servers,
    agents: stringsIn(message.agents),
    model: asString(message.model) ?? '',
    sessionId: asString(message.session_id) ?? '',
    apiKeySource: asString(message.apiKeySource) ?? '',
    cliVersion: asString(message.claude_code_version) ?? '',
  };
}

function readUsage(message: Record<string, unknown>): StreamUsage {
  const usage = asRecord(message.usage) ?? {};
  return {
    inputTokens: asFiniteNumber(usage.input_tokens) ?? 0,
    outputTokens: asFiniteNumber(usage.output_tokens) ?? 0,
    cacheReadTokens: asFiniteNumber(usage.cache_read_input_tokens) ?? 0,
    cacheWriteTokens: asFiniteNumber(usage.cache_creation_input_tokens) ?? 0,
    costUsd: asFiniteNumber(message.total_cost_usd) ?? 0,
    durationMs: asFiniteNumber(message.duration_ms) ?? 0,
  };
}

function readResult(message: Record<string, unknown>): StreamResult {
  const denials: string[] = [];
  for (const entry of asArray(message.permission_denials) ?? []) {
    denials.push(asString(asRecord(entry)?.tool_name) ?? JSON.stringify(entry));
  }
  return {
    narrative: asString(message.result) ?? '',
    usage: readUsage(message),
    numTurns: asFiniteNumber(message.num_turns) ?? 0,
    isError: asBoolean(message.is_error) ?? false,
    apiErrorStatus: asFiniteNumber(message.api_error_status),
    terminalReason: asString(message.terminal_reason),
    permissionDenials: denials,
    subagentsSpawned: asFiniteNumber(at(message, 'subagent_stats', 'spawned')) ?? 0,
  };
}

/**
 * Reads the whole stream. Unknown message types are ignored rather than
 * refused: the CLI adds them, and a driver that fell over on one would break
 * on an upgrade that changed nothing it uses. A line that is not JSON is kept
 * instead, because that is a symptom of the CLI writing something else to
 * stdout entirely, which the caller must be able to see.
 */
export function parseStream(stdout: string): ParsedStream {
  let init: SessionInit | undefined;
  let result: StreamResult | undefined;
  const hooks: HookFiring[] = [];
  const toolUses: ToolUse[] = [];
  const textBlocks: string[] = [];
  const unreadable: string[] = [];

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      unreadable.push(trimmed);
      continue;
    }
    const message = asRecord(parsed);
    if (message === undefined) {
      unreadable.push(trimmed);
      continue;
    }
    const type = asString(message.type);
    if (type === 'system') {
      const subtype = asString(message.subtype);
      if (subtype === 'init') {
        init = readInit(message);
        continue;
      }
      // Only the response line is kept. `hook_started` says a hook was
      // reached; `hook_response` says it ran and how it ended, which is the
      // part an assertion about hooks firing needs.
      if (subtype === 'hook_response') {
        const event = asString(message.hook_event);
        if (event !== undefined) {
          hooks.push({ event, name: asString(message.hook_name) ?? '', outcome: asString(message.outcome) });
        }
      }
      continue;
    }
    if (type === 'result') {
      result = readResult(message);
      continue;
    }
    if (type !== 'assistant') continue;
    const parentToolUseId = asString(message.parent_tool_use_id);
    for (const block of asArray(at(message, 'message', 'content')) ?? []) {
      const record = asRecord(block);
      const blockType = asString(record?.type);
      if (blockType === 'text') {
        const text = asString(record?.text);
        if (text !== undefined) textBlocks.push(text);
        continue;
      }
      if (blockType !== 'tool_use') continue;
      const name = asString(record?.name);
      if (name === undefined) continue;
      toolUses.push({ name, input: asRecord(record?.input) ?? {}, parentToolUseId });
    }
  }

  return { init, hooks, toolUses, textBlocks, result, unreadable };
}
