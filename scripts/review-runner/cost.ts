/**
 * Gemini 3.1 Pro bills a whole request at its long-context rate once the
 * prompt passes 200k tokens: input goes from $2 to $4 per million tokens, and
 * output, thinking included, from $12 to $18. I1a's 681,058-byte payload
 * counted 206,196 tokens and crossed it, so each of its two calls cost about
 * $1.4 where a payload under the line costs about $0.7 (D-TOOLING-07).
 *
 * The runner cannot ask Google for the count first. `countTokens` takes the
 * payload, which is egress, and an egress refused on its answer would leave the
 * bundle with Google and no manifest saying so. The ceiling is therefore in
 * bytes, checked locally before anything is sent, and set from the lowest
 * bytes-per-token ratio any Gemini run has measured: 3.16, P8's 408,788 bytes
 * at 129,275 tokens. Every other run measured between 3.26 and 3.64, and a
 * higher ratio means fewer tokens, so 600,000 bytes is at most about 190k
 * tokens on everything measured so far.
 *
 * The ceiling holds for both families. A bundle Gemini cannot take at the
 * standard rate cannot get the unit its two reviews, and Codex alone is not a
 * review of the unit.
 */
export const PROMPT_TOKEN_TIER = 200_000;
export const BYTES_PER_TOKEN_LOW = 3.16;
export const PAYLOAD_BYTES_CEILING = 600_000;

/**
 * Standard paid-tier prices for prompts at or under the tier, in dollars per
 * million tokens, as Google's pricing page listed them on 2026-10-04. Thinking
 * tokens are billed as output.
 */
const INPUT_PER_MILLION = 2;
const OUTPUT_PER_MILLION = 12;

/**
 * Output a run is assumed to bill: the most thinking any run has used (34,274
 * tokens, I1a) rounded up, plus a reply larger than any yet returned (1,329,
 * P12). An estimate, never a cap: the request still allows 65,536.
 */
const ASSUMED_OUTPUT_TOKENS = 36_500;

export interface CostEstimate {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly dollars: number;
}

/** An upper estimate for a payload under the ceiling, for the dry run to print. */
export function estimateGeminiCost(payloadBytes: number): CostEstimate {
  const inputTokens = Math.ceil(payloadBytes / BYTES_PER_TOKEN_LOW);
  const dollars = (inputTokens * INPUT_PER_MILLION + ASSUMED_OUTPUT_TOKENS * OUTPUT_PER_MILLION) / 1_000_000;
  return { inputTokens, outputTokens: ASSUMED_OUTPUT_TOKENS, dollars };
}
