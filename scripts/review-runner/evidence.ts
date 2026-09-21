import type { CleanRoomProof } from './cleanroom.ts';
import type { EchoVerdict } from './integrity.ts';

export type Family = 'codex' | 'gemini';

export type Outcome = 'counted' | 'INTEGRITY_FAILED' | 'INTEGRITY_UNVERIFIED' | 'FAILED';

export interface Manifest {
  readonly unit: string;
  readonly family: Family;
  readonly argv: readonly string[];
  readonly envOverrides: Readonly<Record<string, string>>;
  readonly cleanRoom: CleanRoomProof;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly cliVersion: string;
  readonly modelReported: string | null;
  readonly tokenUsage: Readonly<Record<string, number>> | null;
  /** Files in the config home AFTER the run. A Codex turn leaves ~332 files of
   *  auto-fetched vendor plugin cache; recording the count keeps that visible
   *  without committing it. */
  readonly postRunFileCount: number;
  /** Read back from the rollout log, not asserted by the caller. Codex has no
   *  `--ask-for-approval` flag, so this recorded value is the only evidence the
   *  run could not have been prompted. The runner refuses a value other than
   *  "never" for codex. */
  readonly recordedApprovalPolicy: string | null;
  readonly bundleSha256: string;
  readonly integrity: EchoVerdict;
  readonly outcome: Outcome;
}

/**
 * The outcome is derived, never declared. One function computes it from the
 * three facts that decide it, so no caller can set a field claiming a review
 * counted when it did not. Only `counted` may be triaged as a review.
 */
export function outcomeOf(run: {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly integrity: EchoVerdict;
}): Outcome {
  if (run.timedOut || run.exitCode !== 0) return 'FAILED';
  if (run.integrity.kind === 'failed') return 'INTEGRITY_FAILED';
  if (run.integrity.kind === 'unverified') return 'INTEGRITY_UNVERIFIED';
  return 'counted';
}

/**
 * Codex rollout record types worth keeping as provenance. All four are measured
 * present in a real rollout log. `world_state` carries the resolved model id and
 * `token_usage_record` the only total_tokens figure the CLI emits anywhere.
 * `event_msg` and `response_item` are deliberately absent: they are the message
 * bodies this stripping exists to drop.
 */
export const CODEX_KEEP: readonly string[] = [
  'session_meta', 'turn_context', 'world_state', 'token_usage_record',
];

/** Gemini stream-json events carrying the model id and the token breakdown. */
export const GEMINI_KEEP: readonly string[] = ['init', 'result'];

/**
 * The full rollout log restates the entire bundle. Committing that per family
 * per unit would multiply the repository for no evidentiary gain, so only the
 * metadata records survive.
 */
export function stripSessionLog(jsonl: string, keep: readonly string[]): string {
  return jsonl
    .split(/\r?\n/)
    .map((line) => parseRecord(line))
    .filter((record): record is Record<string, unknown> => record !== undefined)
    .filter((record) => typeof record.type === 'string' && keep.includes(record.type))
    .map((record) => JSON.stringify(record))
    .join('\n');
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  if (line.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
