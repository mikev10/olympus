/**
 * The bundle's own header and final section header, used to prove the reviewer
 * received the whole file. Gemini's read path carries an undocumented ~2000
 * line cutoff and bundles run to ~10000 lines; a truncated bundle otherwise
 * yields a confident review of code nobody read.
 */
export interface BundleMarkers {
  readonly base: string;
  readonly head: string;
  readonly finalSection: string;
}

export type EchoVerdict =
  | { readonly kind: 'verified' }
  | { readonly kind: 'unverified'; readonly absent: readonly string[] }
  | { readonly kind: 'failed'; readonly absent: readonly string[] };

const SECTION_HEADER = /^===== (.+) =====$/;

export function bundleMarkers(bundleText: string): BundleMarkers {
  const lines = bundleText.split(/\r?\n/);
  const base = fieldValue(lines, 'BASE:');
  const head = fieldValue(lines, 'HEAD:');

  let finalSection: string | undefined;
  for (const line of lines) {
    const match = SECTION_HEADER.exec(line);
    if (match !== null) finalSection = match[1];
  }
  if (finalSection === undefined) {
    throw new Error('bundle has no "===== <path> =====" section header');
  }
  return { base, head, finalSection };
}

function fieldValue(lines: readonly string[], field: string): string {
  const line = lines.find((l) => l.startsWith(field));
  if (line === undefined) throw new Error(`bundle has no ${field} line`);
  const value = line.slice(field.length).trim();
  if (value === '') throw new Error(`bundle ${field} line has no value`);
  return value;
}

/**
 * Three outcomes, not two. A reply echoing nothing came from a prompt written
 * before the echo was required, which is unverified rather than wrong. A reply
 * echoing some markers but not others is a mismatch and fails. Both are
 * refusals; only `verified` counts.
 */
export function verifyEcho(markers: BundleMarkers, replyText: string): EchoVerdict {
  const expected: ReadonlyArray<readonly [string, string]> = [
    ['base', markers.base],
    ['head', markers.head],
    ['finalSection', markers.finalSection],
  ];
  const absent = expected.filter(([, value]) => !replyText.includes(value)).map(([name]) => name);

  if (absent.length === 0) return { kind: 'verified' };
  if (absent.length === expected.length) return { kind: 'unverified', absent };
  return { kind: 'failed', absent };
}
