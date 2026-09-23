/**
 * Markers from the bundle that prove the reviewer received the whole file.
 * The end nonce is a random 32-char hex string at the very tail; only content
 * that exists solely at the tail can prove the tail arrived. Gemini's read
 * path carries an undocumented ~2000 line cutoff and bundles run to ~10000
 * lines. The nonce proves delivery of the tail; it does not prove the reviewer
 * reasoned about all of it, only that they received all of it.
 */
export interface BundleMarkers {
  readonly base: string;
  readonly head: string;
  readonly finalSection: string;
  readonly endNonce: string | null;
}

/**
 * Three outcomes. `verified` when the tail proof is present and echoed. `failed`
 * when a tail proof is demanded (bundle has nonce) but not satisfied by the reply.
 * `unverified` when no tail proof could exist (bundle predates the nonce convention)
 * — not the same as a reviewer failing the check. Only `verified` counts as success;
 * both `failed` and `unverified` are refusals, but they diagnose different problems.
 */
export type EchoVerdict =
  | { readonly kind: 'verified' }
  | { readonly kind: 'unverified'; readonly absent: readonly string[] }
  | { readonly kind: 'failed'; readonly absent: readonly string[] };

const SECTION_HEADER = /^===== (.+) =====$/;
const END_NONCE = /^=== BUNDLE END === ([0-9a-f]{32})$/;

export function bundleMarkers(bundleText: string): BundleMarkers {
  const lines = bundleText.split(/\r?\n/);
  const base = fieldValue(lines, 'BASE:');
  const head = fieldValue(lines, 'HEAD:');

  // Two properties the rest of the design leans on, checked here where every
  // run passes: the nonce is the LAST non-empty line, and there is exactly one
  // nonce-shaped line. Both were specified before — in `review-request`'s
  // markdown, as commands an operator runs and reads. A guard someone has to
  // remember to run is not a guard (codex-4). A bundle that fails either is
  // refused before anything is sent, so the refusal costs no egress.
  const nonces: Array<{ readonly nonce: string; readonly index: number }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line !== undefined) {
      const match = END_NONCE.exec(line);
      if (match !== null) {
        const nonce = match[1];
        if (nonce !== undefined) nonces.push({ nonce, index: i });
      }
    }
  }
  if (nonces.length > 1) {
    // A reviewer that read the whole bundle can echo the earlier value and be
    // recorded as having failed a check it passed — a refusal that throws away
    // a good review.
    throw new Error(
      `bundle has more than one "=== BUNDLE END === <nonce>" line (${String(nonces.length)}); exactly one is allowed, ` +
        'on the last non-empty line. Regenerate it with `>` rather than `>>`.',
    );
  }
  const only = nonces[0];
  let endNonce: string | null = null;
  let nonceIndex = -1;
  if (only !== undefined) {
    if (lines.slice(only.index + 1).some((line) => line.trim() !== '')) {
      // The section scan stops at the nonce, so `finalSection` would name a
      // header from above it while the bundle's real last section sat below —
      // and the prompt's instruction to read the very last line would be false.
      throw new Error(
        'bundle has content after its "=== BUNDLE END === <nonce>" line: the nonce must be on the last ' +
          'non-empty line, or the echo proves delivery only as far as the nonce',
      );
    }
    endNonce = only.nonce;
    nonceIndex = only.index;
  }

  let finalSection: string | undefined;
  const searchUntil = nonceIndex >= 0 ? nonceIndex : lines.length;
  for (let i = 0; i < searchUntil; i += 1) {
    const line = lines[i];
    if (line !== undefined) {
      const match = SECTION_HEADER.exec(line);
      if (match !== null) finalSection = match[1];
    }
  }
  if (finalSection === undefined) {
    throw new Error('bundle has no "===== <path> =====" section header');
  }
  return { base, head, finalSection, endNonce };
}

function fieldValue(lines: readonly string[], field: string): string {
  const line = lines.find((l) => l.startsWith(field));
  if (line === undefined) throw new Error(`bundle has no ${field} line`);
  const value = line.slice(field.length).trim();
  if (value === '') throw new Error(`bundle ${field} line has no value`);
  return value;
}

/**
 * What this cannot separate: a reply that echoes the four markers because the
 * bundle told it to satisfies this check exactly as an honest one does. The
 * material under review has to reach the model as text, so the project's rule
 * that payloads are data and never instructions does not hold for the bundle
 * (D-TOOLING-03). The payload's nonce-bearing delimiters stop the bundle forging
 * the boundary; they do not stop a model following an instruction inside it, and
 * nothing available does.
 */
export function verifyEcho(markers: BundleMarkers, replyText: string): EchoVerdict {
  // Bundle predates the nonce convention: no tail proof could exist. This is an
  // artifact-age problem, not a reviewer problem. The check was never put to this
  // reviewer; they cannot fail a check that did not apply to them.
  if (markers.endNonce === null) {
    return { kind: 'unverified', absent: ['endNonce'] };
  }
  const expected: ReadonlyArray<readonly [string, string]> = [
    ['base', markers.base],
    ['head', markers.head],
    ['finalSection', markers.finalSection],
    ['endNonce', markers.endNonce],
  ];
  const absent = expected.filter(([, value]) => !replyText.includes(value)).map(([name]) => name);

  return absent.length === 0 ? { kind: 'verified' } : { kind: 'failed', absent };
}
