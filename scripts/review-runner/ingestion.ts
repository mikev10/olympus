/**
 * Bytes per token measured on a real 403,661-byte bundle: 3.18 for Codex
 * (127,096 input tokens) and 3.20 for Gemini (126,072). The floor divides by 5,
 * well below both, so tokenizer variance cannot fail an honest run — while the
 * two measured failures (32,893 tokens when Gemini navigated with grep; 24,181
 * when Codex could not read the file) land far beneath it.
 *
 * This is the strongest integrity signal in the design, stronger than the nonce:
 * the count is measured by the vendor's API, not reported by the model, so a
 * reviewer cannot fake it. It catches truncation AND navigation — a reviewer that
 * reads selectively ingests a fraction of the bundle.
 */
export const BYTES_PER_TOKEN_FLOOR = 5;

export type IngestionVerdict =
  | { readonly kind: 'complete'; readonly inputTokens: number; readonly floor: number }
  | { readonly kind: 'short'; readonly inputTokens: number; readonly floor: number }
  | { readonly kind: 'unreported'; readonly floor: number };

export function verifyIngestion(payloadBytes: number, inputTokens: number | null): IngestionVerdict {
  const floor = Math.floor(payloadBytes / BYTES_PER_TOKEN_FLOOR);
  if (inputTokens === null) return { kind: 'unreported', floor };
  return inputTokens >= floor
    ? { kind: 'complete', inputTokens, floor }
    : { kind: 'short', inputTokens, floor };
}
