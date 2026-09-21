export interface UnitArtifacts {
  readonly date: string;
  readonly slug: string;
  readonly promptFile: string;
  readonly bundleFile: string;
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

  const bundleFile = `${chosen.date}-${unit}-${chosen.slug}${BUNDLE_SUFFIX}`;
  if (!fileNames.includes(bundleFile)) {
    throw new Error(`unit ${unit} has a review prompt but no bundle: expected ${bundleFile}`);
  }

  return { date: chosen.date, slug: chosen.slug, promptFile: chosen.name, bundleFile };
}

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
