export interface UnitArtifacts {
  readonly date: string;
  readonly slug: string;
  readonly promptFile: string;
  readonly bundleFile: string;
  /** How many `<date>-<unit>-<slug>` prompt-and-bundle pairs matched this unit,
   *  the chosen one included. Several is ordinary: units are legitimately
   *  re-bundled, so the newest date wins and that is deliberate. Refusing on
   *  several would break re-bundling and would require deleting a tracked
   *  record to unblock a run. What was wrong is that the selection was silent
   *  (gemini-1), so the count travels with the choice and is printed and
   *  recorded in the manifest. */
  readonly matchingPairs: number;
  /** Prompt files at the newest date passed over because this family already
   *  has a counted review of them. A unit reviewed in halves bundles several
   *  pairs on one date, and without this the second half could never be sent:
   *  the first, already counted, would win every time (D-TOOLING-08). */
  readonly skippedCounted: readonly string[];
}

const PROMPT_SUFFIX = '-review-prompt.txt';
const BUNDLE_SUFFIX = '-review-bundle.txt';

/**
 * Pure over a directory listing so it is testable without a filesystem. The
 * unit id keeps its case by convention, so matching is case sensitive: a lazy
 * case-insensitive match would let `p5` and `P5` resolve to the same artifacts
 * and quietly review the wrong thing.
 */
export function findUnitArtifacts(
  fileNames: readonly string[],
  unit: string,
  isCounted: (pairStem: string) => boolean = () => false,
): UnitArtifacts {
  const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-${escapeForRegExp(unit)}-(.+)${escapeForRegExp(PROMPT_SUFFIX)}$`);

  const candidates = fileNames
    .map((name) => ({ name, match: pattern.exec(name) }))
    .flatMap(({ name, match }) =>
      match === null ? [] : [{ name, date: match[1] ?? '', slug: match[2] ?? '' }],
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const newest = candidates[0];
  if (newest === undefined) {
    throw new Error(`no review prompt in docs/reviews/ for unit ${unit}`);
  }

  // Only the newest date is eligible: an older pair was superseded by a
  // re-bundle, and sending it would review code that is no longer the unit's.
  // Within that date, a pair this family has already counted is passed over.
  // None left keeps the newest, so the runner's counted refusal still fires;
  // more than one left is a choice the runner will not make by sort order.
  const sameDate = candidates.filter((candidate) => candidate.date === newest.date);
  const stemOf = (candidate: { readonly date: string; readonly slug: string }): string =>
    `${candidate.date}-${unit}-${candidate.slug}`;
  const skipped = sameDate.filter((candidate) => isCounted(stemOf(candidate)));
  const open = sameDate.filter((candidate) => !skipped.includes(candidate));
  if (open.length > 1) {
    throw new Error(
      `unit ${unit} has ${String(open.length)} review prompts dated ${newest.date} with no counted review ` +
        `from this family (${open.map((candidate) => candidate.name).join(', ')}), and choosing between them is not the runner's to do`,
    );
  }
  const chosen = open[0] ?? newest;

  const bundleOf = (candidate: { readonly date: string; readonly slug: string }): string =>
    `${candidate.date}-${unit}-${candidate.slug}${BUNDLE_SUFFIX}`;

  const bundleFile = bundleOf(chosen);
  if (!fileNames.includes(bundleFile)) {
    throw new Error(`unit ${unit} has a review prompt but no bundle: expected ${bundleFile}`);
  }
  // Counted after the chosen pair is known, so selection is unchanged: a
  // prompt whose bundle is missing still refuses rather than falling back to
  // an older pair.
  const matchingPairs = candidates.filter((candidate) => fileNames.includes(bundleOf(candidate))).length;

  const skippedCounted = open.length === 0 ? [] : skipped.map((candidate) => candidate.name);

  return { date: chosen.date, slug: chosen.slug, promptFile: chosen.name, bundleFile, matchingPairs, skippedCounted };
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
