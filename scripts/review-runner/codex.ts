import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEFAULT_TIMEOUT_MS = 900_000;

/**
 * Argv for `codex exec`, measured against codex-cli 0.155.1. There is no
 * `--ask-for-approval` flag in this version — passing one aborts the run
 * before it reaches the network, and the rollout log shows exec's default is
 * already "never ask" without it. `--skip-git-repo-check` is required because
 * the scratch work dir is never a git repo. The trailing `-` reads the prompt
 * from stdin, where the whole bundle is inlined.
 */
export function codexArgv(finalMessagePath: string): readonly string[] {
  return [
    'exec',
    '--sandbox', 'read-only',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--json',
    '-o', finalMessagePath,
    '-',
  ];
}

/**
 * Locates Codex's JS entry point without spawning `npm` (itself a `.cmd` on
 * Windows). `CODEX_JS` is checked first so a non-standard install can override
 * it; failing that, the standard global-install path is derived for the
 * current platform. Fails closed and names exactly what was looked for — this
 * function never falls back to invoking a shell.
 */
export function resolveCodexEntry(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  execPath: string,
): string {
  const override = env.CODEX_JS;
  if (override !== undefined && override !== '') {
    if (!existsSync(override)) {
      throw new Error(`CODEX_JS is set to "${override}", but no file exists there`);
    }
    return override;
  }

  let candidate: string;
  if (platform === 'win32') {
    const appData = env.APPDATA;
    if (appData === undefined || appData === '') {
      throw new Error(
        'cannot locate the Codex CLI entry point: %APPDATA% is not set and CODEX_JS was not given',
      );
    }
    candidate = join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  } else {
    candidate = join(dirname(execPath), '..', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  }

  if (!existsSync(candidate)) {
    throw new Error(
      `Codex CLI entry point not found at "${candidate}". Install @openai/codex, or set CODEX_JS to override.`,
    );
  }
  return candidate;
}

export interface CliResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunCliOptions {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdin: string;
  readonly timeoutMs?: number;
}

/**
 * Spawns with `shell: false` — `shell: true` concatenates argv unescaped
 * (Node itself warns DEP0190 for exactly this), and this argv carries file
 * paths. Writes `stdin` and ENDS the stream: an unclosed stdin makes the CLI
 * wait on it forever. Kills the child once `timeoutMs` (default
 * `DEFAULT_TIMEOUT_MS`) elapses, reporting that as `timedOut` rather than
 * throwing, so a hung reviewer becomes evidence instead of an uncaught
 * rejection.
 */
export function runCli(options: RunCliOptions): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });

    child.stdin.write(options.stdin, 'utf8');
    child.stdin.end();
  });
}

/**
 * Walks a dotted path through parsed JSON. `unknown` all the way down: the
 * only way to read a field two levels under a value JSON.parse handed back as
 * `unknown` is to index it after confirming it is a non-null object, which is
 * exactly what this loop does at each step.
 */
function getPath(record: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
  let cur: unknown = record;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    // JSON-parse boundary: `cur` is known to be a non-null object from the
    // check above, but objects from JSON.parse carry no index signature.
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Parses a rollout log's JSON-lines text into records, skipping blank and
 * unparseable lines and anything that did not parse to a plain object —
 * mirrors evidence.ts's stripSessionLog, which the rollout log also feeds.
 */
function parseJsonl(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        // JSON-parse boundary: narrowed to a non-null, non-array object above.
        out.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON; skip it rather than fail the whole log over one bad line.
    }
  }
  return out;
}

/**
 * The model id, read from the rollout log's `world_state` record. Measured
 * absent from `codex exec --json` stdout entirely (task-1-codex-report.md,
 * Step 7): stdout carries only thread.started / turn.started / item.completed
 * / turn.completed, none of which has a model field. Only the on-disk rollout
 * log has it, so this function must be pointed at that file, never at stdout.
 */
export function codexModel(rolloutJsonl: string): string | null {
  for (const record of parseJsonl(rolloutJsonl)) {
    if (record.type !== 'world_state') continue;
    const model = getPath(record, ['payload', 'state', 'collaboration_mode', 'model']);
    if (typeof model === 'string') return model;
  }
  return null;
}

/**
 * Input token count, read from the rollout log's `token_usage_record`. This is
 * the only place `input_tokens` appears in the CLI's output at all — `--json`
 * stdout's `turn.completed.usage` omits it. `input_tokens` already includes
 * cached tokens; callers must not add `cached_input_tokens` to it.
 */
export function codexUsage(rolloutJsonl: string): number | null {
  for (const record of parseJsonl(rolloutJsonl)) {
    if (record.type !== 'token_usage_record') continue;
    const tokens = getPath(record, ['payload', 'usage', 'input_tokens']);
    if (typeof tokens === 'number') return tokens;
  }
  return null;
}

/**
 * The recorded approval policy, read from the rollout log's `turn_context`
 * record. Codex has no `--ask-for-approval` flag in 0.155.1, so this value —
 * read back from what the CLI itself recorded, not asserted by the caller —
 * is the only evidence a run could not have been prompted for approval.
 *
 * Measured 2026-09-21 against codex-cli 0.155.1 with a real call:
 * `approval_policy` occurs exactly once in the rollout log, on `turn_context`,
 * at `payload.approval_policy`. No other location is read. If a future Codex
 * version drops or relocates the field, this must return `null` and cause a
 * refusal upstream — not guess at a second location nobody has verified.
 */
export function codexApprovalPolicy(rolloutJsonl: string): string | null {
  for (const record of parseJsonl(rolloutJsonl)) {
    if (record.type !== 'turn_context') continue;
    const policy = getPath(record, ['payload', 'approval_policy']);
    if (typeof policy === 'string') return policy;
  }
  return null;
}
