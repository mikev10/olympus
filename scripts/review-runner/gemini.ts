import type { KeylessUrl } from './evidence.ts';
import { keylessUrl } from './evidence.ts';
import { DEFAULT_TIMEOUT_MS } from './codex.ts';

/**
 * Pinned, which the rest of this design avoids — every other reviewer picks
 * its own default model, but a direct API call has to name one. There is
 * deliberately NO fallback list: if this preview model is retired, the call
 * must fail loudly (a 404 from Google) rather than quietly retry against a
 * weaker model nobody chose as the adversary. The probe script that measured
 * this endpoint used a fallback loop for convenience; production code must
 * not. `modelVersion` on the response is recorded separately (see
 * `GeminiResult.modelVersion`) so the manifest still shows what actually ran.
 */
export const GEMINI_MODEL = 'gemini-3.1-pro-preview';

const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Measured 2026-09-21: Gemini applies its own default output limit, and a
// long review that reaches it comes back cut off mid-sentence. Set explicitly
// so a truncated reply can never be mistaken for a short-but-complete one.
const MAX_OUTPUT_TOKENS = 32_768;

export interface GeminiPart {
  readonly text: string;
}

export interface GeminiContent {
  readonly role: 'user';
  readonly parts: readonly GeminiPart[];
}

export interface GeminiRequestBody {
  readonly contents: readonly GeminiContent[];
  readonly generationConfig: { readonly maxOutputTokens: number };
}

export interface GeminiRequest {
  readonly url: KeylessUrl;
  readonly body: GeminiRequestBody;
  /** Header NAMES only, mirroring `Invocation['headerNames']` — the key's
   *  value never passes through this builder. `callGemini` is the only place
   *  it is read, and it goes straight into a header at call time. */
  readonly headerNames: readonly string[];
}

/**
 * Builds the request deterministically from the payload alone — there is no
 * key parameter for this function to receive or return, so there is nothing
 * here for a key to leak through. The URL is built through `keylessUrl`,
 * which refuses a query string, so a key cannot land in the URL even by
 * mistake.
 *
 * The body deliberately carries NO `tools` field and NO `toolConfig` field.
 * That absence is the entire reason this transport replaced the Gemini CLI:
 * with no tools offered, the model has nothing to navigate the bundle with
 * and must read it directly.
 */
export function geminiRequest(payload: string): GeminiRequest {
  return {
    url: keylessUrl(GEMINI_ENDPOINT),
    body: {
      contents: [{ role: 'user', parts: [{ text: payload }] }],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    },
    headerNames: ['x-goog-api-key', 'content-type'],
  };
}

export interface GeminiResult {
  /** The joined reply text. Null whenever `complete` is false — a truncated
   *  or empty reply must never be handed back looking like a normal one. */
  readonly reply: string | null;
  /** Null when absent from the response, never guessed. */
  readonly modelVersion: string | null;
  /** Null when absent from the response, never guessed. */
  readonly promptTokenCount: number | null;
  readonly complete: boolean;
  /** Why `complete` is false: the candidate's `finishReason` when it was
   *  anything other than "STOP", or a plain description when there was no
   *  candidate or no text at all. Null when `complete` is true. */
  readonly incompleteReason: string | null;
}

/**
 * Walks a dotted path through parsed JSON, `unknown` all the way down.
 * Mirrors `codex.ts`'s helper of the same name and job.
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

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  // JSON-parse boundary: narrowed to a non-null, non-array object; anything
  // else (including an array) becomes an empty record so every lookup below
  // falls through to "absent" rather than guessing at shape.
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): readonly unknown[] {
  // JSON-parse boundary: `Array.isArray` narrows to `any[]`; recast to
  // `unknown[]` immediately so nothing downstream is implicitly `any`.
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/**
 * Reads a Gemini `generateContent` response defensively. `modelVersion` and
 * `promptTokenCount` are read independently of the candidate and are `null`
 * when absent, never guessed. A response with no candidates, a
 * `finishReason` other than `"STOP"`, or a candidate with no text parts is
 * reported through `incompleteReason` rather than returned as an empty reply
 * — an empty or truncated reply returned as if normal would read as a review
 * that found nothing, which is worse than a refusal.
 */
export function parseGeminiResponse(response: unknown): GeminiResult {
  const record = asRecord(response);

  const modelVersionRaw = getPath(record, ['modelVersion']);
  const modelVersion = typeof modelVersionRaw === 'string' ? modelVersionRaw : null;

  const promptTokenCountRaw = getPath(record, ['usageMetadata', 'promptTokenCount']);
  const promptTokenCount = typeof promptTokenCountRaw === 'number' ? promptTokenCountRaw : null;

  const candidates = asArray(getPath(record, ['candidates']));
  if (candidates.length === 0) {
    return { reply: null, modelVersion, promptTokenCount, complete: false, incompleteReason: 'no candidates' };
  }

  const candidate = asRecord(candidates[0]);
  const finishReasonRaw = getPath(candidate, ['finishReason']);
  const finishReason = typeof finishReasonRaw === 'string' ? finishReasonRaw : null;
  if (finishReason !== 'STOP') {
    return {
      reply: null,
      modelVersion,
      promptTokenCount,
      complete: false,
      incompleteReason: finishReason ?? 'no finishReason',
    };
  }

  const parts = asArray(getPath(candidate, ['content', 'parts']));
  const texts: string[] = [];
  for (const part of parts) {
    const partRecord = asRecord(part);
    // Gemini 3.1 Pro is a thinking model: a part flagged thought === true
    // carries the model's private reasoning, not its answer. Splicing that
    // into the reply would commit the model's working to a review file as
    // though it were a finding, so it is skipped. Checked strictly against
    // `true` so a part with `thought` absent or false is still included.
    if (getPath(partRecord, ['thought']) === true) continue;
    const text = getPath(partRecord, ['text']);
    if (typeof text === 'string') texts.push(text);
  }

  if (texts.length === 0) {
    return { reply: null, modelVersion, promptTokenCount, complete: false, incompleteReason: 'no text parts' };
  }

  return { reply: texts.join(''), modelVersion, promptTokenCount, complete: true, incompleteReason: null };
}

/**
 * A fetch-shaped function, injectable so tests never have to touch the
 * network. The global `fetch` satisfies this type structurally, so callers
 * that want the real network do not have to pass anything at all. Narrower
 * than `typeof fetch` on purpose: `json()` returns `Promise<unknown>` here,
 * not `Promise<any>`, so nothing downstream of a real or fake response is
 * implicitly `any`.
 */
export type FetchLike = (
  input: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly signal: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  readonly json: () => Promise<unknown>;
  readonly text: () => Promise<string>;
}>;

export interface CallGeminiOptions {
  /** Defaults to `process.env`. Injectable so a real key never has to touch
   *  an actual environment variable in a test. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Defaults to the global `fetch`. Injectable so tests never touch the
   *  network. */
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
}

/**
 * Thrown by `callGemini` for a non-2xx response. Carries the status and the
 * response body — never the request, never its headers, never the key. Task
 * 8 writes failures into files, so an error that echoed its request would be
 * an error that committed the key.
 */
export class GeminiRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`Gemini API request failed: HTTP ${String(status)} ${statusText} — ${body}`);
    this.name = 'GeminiRequestError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Reads `GEMINI_API_KEY` from the environment at call time and sends it only
 * in the `x-goog-api-key` header — built from `geminiRequest`'s own
 * `headerNames`, never a second independent list — and never in the URL.
 * Refuses before sending if the key is absent, so a missing key never even
 * reaches `fetch`.
 */
export async function callGemini(payload: string, options: CallGeminiOptions = {}): Promise<GeminiResult> {
  const env = options.env ?? process.env;
  const apiKey = env.GEMINI_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    throw new Error('GEMINI_API_KEY is not set; refusing to call the Gemini API without a key');
  }

  const request = geminiRequest(payload);
  const headerValues: Readonly<Record<string, string>> = {
    'x-goog-api-key': apiKey,
    'content-type': 'application/json',
  };
  const headers: Record<string, string> = {};
  for (const name of request.headerNames) {
    const value = headerValues[name];
    if (value !== undefined) headers[name] = value;
  }

  const fetchImpl: FetchLike = options.fetchImpl ?? fetch;
  const response = await fetchImpl(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new GeminiRequestError(response.status, response.statusText, bodyText);
  }

  const json = await response.json();
  return parseGeminiResponse(json);
}
