/**
 * The tool inventory (`I4.openai-compatible-driver-tool-inventory-validated`)
 * and how each tool runs: inside the sandbox, through `provider.exec`, and
 * never on the host (I1, D-R6-01).
 *
 * The names are the Claude Code driver's own, so one policy grants either
 * driver the same tools (D-R6-04). A constant rather than a probe, because
 * `validateToolGrants` runs before any task starts.
 *
 * What a tool returns goes back to the model as text. A tool that fails —
 * a missing file, an edit that does not match, arguments that do not parse —
 * is an error the model reads and may recover from; it is not a refusal of the
 * task, as it is not for the CLI either.
 */
import { posix } from 'node:path';
import type { DriverEvent } from '@olympus-ai/core';
import type { ExecOptions, ExecResult } from '@olympus-ai/sandbox';

export const DECLARED_TOOLS: readonly string[] = ['Bash', 'Edit', 'Read', 'Write'];

/** A function the chat API offers the model, in the API's own shape. */
export interface ToolDefinition {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
}

function definition(name: string, description: string, properties: Record<string, { type: 'string'; description: string }>): ToolDefinition {
  return Object.freeze({
    type: 'function',
    function: Object.freeze({
      name,
      description,
      parameters: Object.freeze({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }),
    }),
  });
}

const DEFINITIONS: Readonly<Record<string, ToolDefinition>> = Object.freeze({
  Bash: definition('Bash', 'Runs a shell command in the working directory and returns its exit code, stdout, and stderr.', {
    command: { type: 'string', description: 'The command, run by sh -c.' },
  }),
  Edit: definition('Edit', 'Replaces the one occurrence of old_string in a file with new_string. Fails unless old_string occurs exactly once.', {
    path: { type: 'string', description: 'The file, absolute or relative to the working directory.' },
    old_string: { type: 'string', description: 'The exact text to replace. Must occur exactly once.' },
    new_string: { type: 'string', description: 'The text to put in its place.' },
  }),
  Read: definition('Read', 'Returns the contents of a file.', {
    path: { type: 'string', description: 'The file, absolute or relative to the working directory.' },
  }),
  Write: definition('Write', 'Writes a file, creating it and its directories, and replacing anything already there.', {
    path: { type: 'string', description: 'The file, absolute or relative to the working directory.' },
    content: { type: 'string', description: 'The whole content of the file.' },
  }),
});

/** The definitions of the granted tools, in inventory order, and of no others (I4). */
export function definitionsFor(granted: readonly string[]): ToolDefinition[] {
  const wanted = new Set(granted);
  return DECLARED_TOOLS.filter((name) => wanted.has(name)).map((name) => DEFINITIONS[name]).filter((d): d is ToolDefinition => d !== undefined);
}

/** How a tool reaches the sandbox: the provider's exec against the task's handle, and nothing else. */
export type SandboxExec = (argv: string[], options?: ExecOptions) => Promise<ExecResult>;

/** What one tool call did: the text the model reads, the event the run records, and the file it wrote, if any. */
export interface ToolOutcome {
  readonly output: string;
  readonly event: DriverEvent;
  readonly written?: string;
}

/** The most of any one stream returned to the model. More is cut, and the cut is said. */
export const OUTPUT_LIMIT = 64 * 1024;

function clipped(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text;
  return `${text.slice(0, OUTPUT_LIMIT)}\n[cut: ${String(text.length - OUTPUT_LIMIT)} more characters not shown]`;
}

function event(kind: DriverEvent['kind'], detail: Record<string, unknown>): DriverEvent {
  return { at: new Date().toISOString(), kind, detail };
}

/** A path inside the container, resolved against the working directory. The sandbox is the boundary, as it is for the CLI (D-R6-04). */
function resolved(workdir: string, path: string): string {
  return posix.resolve(workdir, path);
}

/** The argv that writes stdin to a path, creating its directories. The path is an argument, never shell text, and `--` ends option parsing. */
function writeArgv(path: string): string[] {
  return ['sh', '-c', 'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"', 'driver', path];
}

type Args = Record<string, unknown>;

/** The string arguments a tool needs, or the error the model is shown when they are not there. */
function strings(args: Args, names: readonly string[]): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = args[name];
    if (typeof value !== 'string') return `error: the argument '${name}' must be a string`;
    out[name] = value;
  }
  return out;
}

/**
 * Runs one granted tool. The caller has already checked the grant; this runs
 * whatever it is handed, so it is never reached for a tool the task was not
 * granted.
 */
export async function runTool(name: string, args: Args, exec: SandboxExec, workdir: string): Promise<ToolOutcome> {
  switch (name) {
    case 'Bash': {
      const a = strings(args, ['command']);
      if (typeof a === 'string') return { output: a, event: event('tool-call', { tool: name, error: a }) };
      const command = a.command ?? '';
      // $1 is the directory and $2 the command: neither is spliced into shell text.
      const result = await exec(['sh', '-c', 'cd -- "$1" && exec sh -c "$2"', 'driver', workdir, command]);
      return {
        output: `exit code: ${String(result.exitCode)}\n--- stdout ---\n${clipped(result.stdout)}\n--- stderr ---\n${clipped(result.stderr)}`,
        event: event('command', { tool: name, command, exitCode: result.exitCode }),
      };
    }
    case 'Read': {
      const a = strings(args, ['path']);
      if (typeof a === 'string') return { output: a, event: event('tool-call', { tool: name, error: a }) };
      const path = resolved(workdir, a.path ?? '');
      const result = await exec(['cat', '--', path]);
      const output = result.exitCode === 0 ? clipped(result.stdout) : `error: reading ${path} failed: ${result.stderr.trim()}`;
      return { output, event: event('tool-call', { tool: name, path, exitCode: result.exitCode }) };
    }
    case 'Write': {
      const a = strings(args, ['path', 'content']);
      if (typeof a === 'string') return { output: a, event: event('tool-call', { tool: name, error: a }) };
      const path = resolved(workdir, a.path ?? '');
      const result = await exec(writeArgv(path), { stdin: a.content ?? '' });
      if (result.exitCode !== 0) {
        return { output: `error: writing ${path} failed: ${result.stderr.trim()}`, event: event('tool-call', { tool: name, path, exitCode: result.exitCode }) };
      }
      return { output: `wrote ${path}`, event: event('file-write', { tool: name, path }), written: path };
    }
    case 'Edit': {
      const a = strings(args, ['path', 'old_string', 'new_string']);
      if (typeof a === 'string') return { output: a, event: event('tool-call', { tool: name, error: a }) };
      const path = resolved(workdir, a.path ?? '');
      const before = a.old_string ?? '';
      if (before === '') return { output: 'error: old_string is empty', event: event('tool-call', { tool: name, path, error: 'empty old_string' }) };
      const read = await exec(['cat', '--', path]);
      if (read.exitCode !== 0) {
        return { output: `error: reading ${path} failed: ${read.stderr.trim()}`, event: event('tool-call', { tool: name, path, exitCode: read.exitCode }) };
      }
      const occurrences = read.stdout.split(before).length - 1;
      if (occurrences !== 1) {
        const error = `old_string occurs ${String(occurrences)} times in ${path}; it must occur exactly once`;
        return { output: `error: ${error}`, event: event('tool-call', { tool: name, path, error }) };
      }
      const written = await exec(writeArgv(path), { stdin: read.stdout.replace(before, () => a.new_string ?? '') });
      if (written.exitCode !== 0) {
        return { output: `error: writing ${path} failed: ${written.stderr.trim()}`, event: event('tool-call', { tool: name, path, exitCode: written.exitCode }) };
      }
      return { output: `edited ${path}`, event: event('file-write', { tool: name, path }), written: path };
    }
    default:
      return { output: `error: no tool named '${name}'`, event: event('tool-call', { tool: name, refused: true }) };
  }
}
