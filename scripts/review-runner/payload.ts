import { createHash } from 'node:crypto';

/**
 * The exact text sent to BOTH reviewers. Neither is asked to read a file: on
 * 2026-09-21 Gemini's CLI navigated a file with grep instead of reading it, and
 * Codex's read-only sandbox on Windows could not read one at all. Inlined, both
 * ingested the whole bundle. The opening delimiter names the bundle file so the
 * committed prompt's reference to it by filename still resolves.
 *
 * **The delimiters carry the bundle's own end nonce**, which `bundleMarkers`
 * read from the bundle and which is generated fresh per bundle — so no text
 * that already exists in the bundle can spell either delimiter. Before this,
 * bundle content containing a bare `<<<END REVIEW BUNDLE>>>` closed the block
 * as far as the reviewer could tell, and anything after it read as the prompt
 * talking rather than as material under review (codex-3, gemini-4).
 *
 * That is the whole of what this fixes: the bundle can no longer forge the
 * boundary, so the reviewer can always tell where the material ends. It does
 * **not** stop a model following an instruction it finds inside the bundle.
 * Nothing available does, the bundle has to reach the model as text, and this
 * must not be described as if it were a defence against that (D-TOOLING-03).
 *
 * The delimiters must also not resemble anything the reviewer is asked to find.
 * The bundle's section headers are `===== path =====` and its last line is
 * `=== BUNDLE END === <nonce>`; a delimiter shaped like either would be
 * reported back as "the last section" or "the last line", and every run would
 * fail its echo check.
 *
 * `endNonce` is a `string`, not `string | null`: the runner refuses a bundle
 * with no nonce at step 4, before this is reached, and the type says so.
 *
 * **The echo request is repeated after the closing delimiter.** On 2026-09-23
 * Gemini twice skipped the prompt's opening request for the four echo values
 * when the bundle was 540 KB (P6), though it had honoured the identical prompt
 * at 398 KB (P8): an instruction read once, ~168k tokens before the model
 * answers, can be lost. `ECHO_REMINDER` is fixed runner text, the same for
 * every unit, and it names the four values without stating any of them, so
 * copying it satisfies no part of the echo check. It lies outside the
 * delimiters, so it is the runner speaking, not bundle material, and it is
 * covered by the payload hash like everything else sent.
 */
export const ECHO_REMINDER =
  'The review bundle ends at the line above. Before any finding, state on four ' +
  'separate lines the four values the prompt asked for: the BASE: value, the ' +
  "HEAD: value, the file path in the bundle's final section header, and the " +
  "32-character value on the bundle's very last line, copied exactly. If you " +
  'cannot read all four, say so and stop.';

export function composePayload(
  promptText: string,
  bundleFileName: string,
  bundleText: string,
  endNonce: string,
): string {
  const begin = `<<<BEGIN REVIEW BUNDLE ${endNonce}>>>`;
  const end = `<<<END REVIEW BUNDLE ${endNonce}>>>`;
  return `${promptText.trimEnd()}\n\n${begin} ${bundleFileName}\n${bundleText.replace(/\n+$/, '')}\n${end}\n\n${ECHO_REMINDER}\n`;
}

/** A string is hashed as its UTF-8 bytes; bytes are hashed as they are. */
export function sha256(data: string | Uint8Array): string {
  const hash = createHash('sha256');
  if (typeof data === 'string') hash.update(data, 'utf8');
  else hash.update(data);
  return hash.digest('hex');
}
