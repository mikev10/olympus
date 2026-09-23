/**
 * Bytes per token measured on a real 403,661-byte bundle: 3.18 for Codex
 * (127,096 input tokens) and 3.20 for Gemini (126,072). The floor divides by 5,
 * well below both, so tokenizer variance cannot fail an honest run — while the
 * two measured failures (32,893 tokens when Gemini navigated with grep; 24,181
 * when Codex could not read the file) land far beneath it.
 *
 * The strongest integrity signal in the design, and worth what its source is
 * worth. The count is produced by the vendor's API service — Google's
 * `usageMetadata.promptTokenCount` — or by the locally installed Codex process,
 * in its own rollout log. Neither comes from the model whose text is under
 * review, and the model is the untrusted party here: it cannot set this number.
 * The API service and the installed CLI are trusted, and against a vendor that
 * fabricates its own telemetry no check in this design holds (D-TOOLING-02).
 * "Cannot be faked" is the wrong claim unless it names who cannot fake it.
 *
 * What it proves is a lower bound: a count at or above the floor says a payload
 * of about this size was taken in. It is not proof that every byte arrived, and
 * it is not evidence of attention — a model can take in a whole bundle and reason
 * about a tenth of it. It does catch truncation AND navigation: a reviewer that
 * reads selectively takes in a fraction of the bundle.
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
