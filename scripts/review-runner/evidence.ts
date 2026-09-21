import type { CleanRoomProof } from './cleanroom.ts';
import type { IngestionVerdict } from './ingestion.ts';
import type { EchoVerdict } from './integrity.ts';

export type Family = 'codex' | 'gemini';

export type Outcome = 'counted' | 'INTEGRITY_FAILED' | 'INTEGRITY_UNVERIFIED' | 'FAILED';

/** An environment map that has been through `redactEnv`: every value is either
 *  allowlisted as a non-secret or the literal string "<redacted>". `redactEnv`
 *  is the only function that may produce one — a plain `Record<string, string>`
 *  cannot be assigned where this type is required. */
export type RedactedEnv = Readonly<Record<string, string>> & { readonly __brand: 'RedactedEnv' };

/** A URL proved to carry no query string and no embedded credentials.
 *  `keylessUrl` is the only function that may produce one. */
export type KeylessUrl = string & { readonly __brand: 'KeylessUrl' };

/** The only environment values a manifest may record verbatim. Every other
 *  variable's value becomes "<redacted>". Default deny, because a name pattern
 *  cannot anticipate every secret: DATABASE_URL carries a password and matches
 *  no _KEY/_TOKEN/_SECRET suffix. */
export const RECORDABLE_ENV: readonly string[] = ['CODEX_HOME', 'HOME', 'USERPROFILE'];

export function redactEnv(env: Readonly<Record<string, string>>): RedactedEnv {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    out[name] = RECORDABLE_ENV.includes(name) ? value : '<redacted>';
  }
  // The single construction site of the brand: every value above is either an
  // allowlisted non-secret or the literal "<redacted>".
  return out as RedactedEnv;
}

export function keylessUrl(url: string): KeylessUrl {
  const parsed = new URL(url);
  if (parsed.search !== '' || parsed.username !== '' || parsed.password !== '') {
    // Do not include `url` in this message: an error that echoes a URL carrying
    // a key is an error that commits the key.
    throw new Error('refusing a URL with a query string or credentials: a key must travel in a header');
  }
  // The single construction site of the brand.
  return url as KeylessUrl;
}

/** How the reviewer was reached. Neither variant ever holds a secret's value. */
export type Invocation =
  | {
      readonly kind: 'cli';
      readonly command: string;
      readonly argv: readonly string[];
      readonly envOverrides: RedactedEnv;
    }
  | {
      readonly kind: 'api';
      readonly method: 'POST';
      /** The endpoint, which carries no key: the key travels in a header. */
      readonly url: KeylessUrl;
      readonly modelRequested: string;
      /** Header NAMES only. Values are never recorded. */
      readonly headerNames: readonly string[];
    };

export interface Manifest {
  readonly unit: string;
  readonly family: Family;
  readonly invocation: Invocation;
  /** null means this transport loads no local configuration home at all — the
   *  API call, which reads no GEMINI.md, no settings.json, no extensions and no
   *  sessions. That is a different fact from an empty listing: an empty listing
   *  is a clean room that was built and then proved empty, while null is a
   *  transport that never had a clean room to build. Do not treat them as
   *  equivalent. */
  readonly cleanRoom: CleanRoomProof | null;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly cliVersion: string;
  readonly modelReported: string | null;
  readonly tokenUsage: Readonly<Record<string, number>> | null;
  readonly payloadSha256: string;
  readonly payloadBytes: number;
  readonly ingestion: IngestionVerdict;
  /** Files in the config home AFTER the run. A Codex turn leaves ~332 files of
   *  auto-fetched vendor plugin cache; recording the count keeps that visible
   *  without committing it. null carries the same meaning as `cleanRoom: null`
   *  above — this transport loads no local configuration home at all, which is
   *  a different fact from a count of zero. */
  readonly postRunFileCount: number | null;
  /** Read back from the rollout log, not asserted by the caller. Codex has no
   *  `--ask-for-approval` flag, so this recorded value is the only evidence the
   *  run could not have been prompted. `outcomeOf` fails a cli run whose value
   *  is anything but "never". */
  readonly recordedApprovalPolicy: string | null;
  readonly bundleSha256: string;
  readonly integrity: EchoVerdict;
  /** SHA-256 of the exact bytes written to the reply `.md`, hashed from the
   *  buffer that was written; null when no reply file was written. It ties the
   *  committed reply to this run: a reply edited afterwards, a triage header
   *  prepended to it included, no longer matches. `outcomeOf` does not read it. */
  readonly replySha256: string | null;
  readonly outcome: Outcome;
}

/** The facts the outcome is decided by. Every one is a manifest field, so
 *  `outcomeOf(manifest)` reproduces the outcome the manifest records, and a
 *  verifier re-deriving it gets the same answer. */
export interface OutcomeFacts {
  readonly invocation: { readonly kind: Invocation['kind'] };
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly recordedApprovalPolicy: string | null;
  readonly ingestion: IngestionVerdict;
  readonly integrity: EchoVerdict;
}

/**
 * The outcome is derived, never declared. One function computes it from the
 * facts that decide it, so no caller can set a field claiming a review
 * counted when it did not. Only `counted` may be triaged as a review.
 * Ingestion is checked before the echo verdict because it is the harder fact:
 * measured by the vendor rather than reported by the model. A reviewer that
 * grepped its way to the nonce would echo every marker correctly and still
 * have ingested only a fraction of the bundle; only the token count catches it.
 */
export function outcomeOf(run: OutcomeFacts): Outcome {
  if (run.timedOut || run.exitCode !== 0) return 'FAILED';
  // A cli run whose recorded policy is not "never" could have been prompted,
  // and nothing else can show it was not.
  if (run.invocation.kind === 'cli' && run.recordedApprovalPolicy !== 'never') return 'FAILED';
  if (run.ingestion.kind !== 'complete') return 'INTEGRITY_FAILED';
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
