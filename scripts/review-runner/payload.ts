import { createHash } from 'node:crypto';

/**
 * The delimiters around the inlined bundle. They must not resemble anything the
 * reviewer is asked to find. The bundle's section headers are `===== path =====`
 * and its last line is `=== BUNDLE END === <nonce>`; a delimiter shaped like
 * either would be reported back as "the last section" or "the last line", and
 * every run would fail its echo check.
 */
export const BEGIN = '<<<BEGIN REVIEW BUNDLE>>>';
export const END = '<<<END REVIEW BUNDLE>>>';

/**
 * The exact text sent to BOTH reviewers. Neither is asked to read a file: on
 * 2026-09-21 Gemini's CLI navigated a file with grep instead of reading it, and
 * Codex's read-only sandbox on Windows could not read one at all. Inlined, both
 * ingested the whole bundle. The opening delimiter names the bundle file so the
 * committed prompt's reference to it by filename still resolves.
 */
export function composePayload(promptText: string, bundleFileName: string, bundleText: string): string {
  return `${promptText.trimEnd()}\n\n${BEGIN} ${bundleFileName}\n${bundleText.replace(/\n+$/, '')}\n${END}\n`;
}

/** A string is hashed as its UTF-8 bytes; bytes are hashed as they are. */
export function sha256(data: string | Uint8Array): string {
  const hash = createHash('sha256');
  if (typeof data === 'string') hash.update(data, 'utf8');
  else hash.update(data);
  return hash.digest('hex');
}
