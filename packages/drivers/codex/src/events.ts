/**
 * Reads what `codex exec --json` prints: one JSON event per line.
 *
 * The event and item types are the pinned CLI's (`exec/src/exec_events.rs` at
 * `rust-v0.166.0`). The reader is closed in both directions. A line that does
 * not parse, a top-level type not in that list, and an item type this driver
 * has no reason to see are each recorded, and the driver refuses the task on
 * any of them (I5): an item the session should not be able to produce, such
 * as a web search or an MCP call, means it held a tool nobody granted, and an
 * event this reader cannot name is one whose meaning nobody checked.
 */

export interface CodexUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly outputTokens: number;
}

export interface CommandItem {
  readonly command: string;
  readonly exitCode: number | null;
}

export interface ParsedEvents {
  readonly threadId: string | undefined;
  /** The text of every completed agent message, in order. The last is the narrative. */
  readonly messages: readonly string[];
  readonly commands: readonly CommandItem[];
  /** Every path a completed file change names. A claim, never evidence (I2). */
  readonly changedPaths: readonly string[];
  /** The message of every error item, the reroute included. */
  readonly errorItems: readonly string[];
  /** A model the CLI says it was rerouted to, or `undefined`. */
  readonly reroute: string | undefined;
  /** Every turn's usage, summed. `undefined` when no turn completed. */
  readonly usage: CodexUsage | undefined;
  /** Why a turn failed, or the session errored, in order. */
  readonly failures: readonly string[];
  /** Lines that did not parse as an event object. */
  readonly unreadable: readonly string[];
  /** Event and item types this reader does not accept, as `event:<type>` or `item:<type>`. */
  readonly unknown: readonly string[];
}

const EVENT_TYPES = new Set(['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.updated', 'item.completed', 'error']);

/** The items a session of this driver can produce: no tool outside the declared set reports any other kind. */
const ITEM_TYPES = new Set(['agent_message', 'reasoning', 'command_execution', 'file_change', 'error']);

/** How the pinned CLI names a reroute in an error item (`exec/src/event_processor_with_jsonl_output.rs:496-503`). */
const REROUTE = /^model rerouted: (\S+) -> (\S+)/u;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function isCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseEvents(stdout: string): ParsedEvents {
  let threadId: string | undefined;
  const messages: string[] = [];
  const commands: CommandItem[] = [];
  const changedPaths: string[] = [];
  const errorItems: string[] = [];
  let reroute: string | undefined;
  let usage: { inputTokens: number; cachedInputTokens: number; cacheWriteTokens: number; outputTokens: number } | undefined;
  const failures: string[] = [];
  const unreadable: string[] = [];
  const unknown: string[] = [];

  for (const line of stdout.split(/\r?\n/u)) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      unreadable.push(line);
      continue;
    }
    const event = record(parsed);
    const type = event?.type;
    if (event === undefined || typeof type !== 'string') {
      unreadable.push(line);
      continue;
    }
    if (!EVENT_TYPES.has(type)) {
      unknown.push(`event:${type}`);
      continue;
    }
    if (type === 'thread.started') {
      // A session with no id is not a session this reader can name (codex-4).
      const id = text(event.thread_id);
      if (id === '') {
        unreadable.push(line);
        continue;
      }
      threadId = id;
    } else if (type === 'turn.completed') {
      const u = record(event.usage);
      // The two counts the meter is held to must be there and be counts; a completed turn
      // without them is unreadable, never a turn that used nothing (codex-4). The cached and
      // cache-write counts stay optional, and an invalid one is refused the same way.
      const optional = [u?.cached_input_tokens, u?.cache_write_input_tokens].filter((v) => v !== undefined);
      if (!isCount(u?.input_tokens) || !isCount(u?.output_tokens) || !optional.every(isCount)) {
        unreadable.push(line);
        continue;
      }
      usage ??= { inputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
      usage.inputTokens += count(u?.input_tokens);
      usage.cachedInputTokens += count(u?.cached_input_tokens);
      usage.cacheWriteTokens += count(u?.cache_write_input_tokens);
      usage.outputTokens += count(u?.output_tokens);
    } else if (type === 'turn.failed') {
      failures.push(text(record(event.error)?.message) || 'the turn failed without a message');
    } else if (type === 'error') {
      failures.push(text(event.message) || 'the session reported an error without a message');
    } else if (type.startsWith('item.')) {
      const item = record(event.item);
      const kind = item?.type;
      if (item === undefined || typeof kind !== 'string') {
        unreadable.push(line);
        continue;
      }
      if (!ITEM_TYPES.has(kind)) {
        unknown.push(`item:${kind}`);
        continue;
      }
      // Only a completed item is counted: a started or updated one is reported again when it ends.
      if (type !== 'item.completed') continue;
      if (kind === 'agent_message') messages.push(text(item.text));
      else if (kind === 'command_execution') {
        commands.push({ command: text(item.command), exitCode: typeof item.exit_code === 'number' ? item.exit_code : null });
      } else if (kind === 'file_change') {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        for (const change of changes) {
          const path = text(record(change)?.path);
          if (path !== '') changedPaths.push(path);
        }
      } else if (kind === 'error') {
        const message = text(item.message);
        errorItems.push(message);
        const rerouted = REROUTE.exec(message);
        if (rerouted !== null) reroute = rerouted[2];
      }
    }
  }
  return { threadId, messages, commands, changedPaths, errorItems, reroute, usage, failures, unreadable, unknown };
}
