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
}

const PROMPT_SUFFIX = '-review-prompt.txt';
const BUNDLE_SUFFIX = '-review-bundle.txt';

/**
 * Pure over a directory listing so it is testable without a filesystem. The
 * unit id keeps its case by convention, so matching is case sensitive: a lazy
 * case-insensitive match would let `p5` and `P5` resolve to the same artifacts
 * and quietly review the wrong thing.
 */
export function findUnitArtifacts(fileNames: readonly string[], unit: string): UnitArtifacts {
  const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2})-${escapeForRegExp(unit)}-(.+)${escapeForRegExp(PROMPT_SUFFIX)}$`);

  const candidates = fileNames
    .map((name) => ({ name, match: pattern.exec(name) }))
    .flatMap(({ name, match }) =>
      match === null ? [] : [{ name, date: match[1] ?? '', slug: match[2] ?? '' }],
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const chosen = candidates[0];
  if (chosen === undefined) {
    throw new Error(`no review prompt in docs/reviews/ for unit ${unit}`);
  }

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

  return { date: chosen.date, slug: chosen.slug, promptFile: chosen.name, bundleFile, matchingPairs };
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
