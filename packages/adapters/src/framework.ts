/**
 * `TestFrameworkAdapter` for vitest and for jest. Parsing, comparison, and
 * marker detection are the same for both — they share `expect`, the chai
 * forms vitest adds are recorded as what they are, and each framework's own
 * markers are detected in either — so the two differ only in enumeration.
 */
import { compareAssertions, extractAssertions } from './assertions.js';
import { jestSuites, vitestSuites } from './discovery.js';
import { readRegularFile, SOURCE_FILE_CAP } from './files.js';
import { extractSkipMarkers } from './markers.js';
import { refuse } from './refusal.js';
import { parseModule, syntaxErrors } from './static.js';
import type { Assertion, AssertionDelta, TestFrameworkAdapter } from './types.js';
import type { JestMajor, VitestMajor } from './versions.js';

async function parseTestFile(file: string): Promise<ReturnType<typeof parseModule>> {
  const sf = parseModule(await readRegularFile(file, SOURCE_FILE_CAP), file);
  const errors = syntaxErrors(sf);
  // A file the parser cannot read would yield fewer assertions than it holds, which reads as a deletion.
  if (errors.length > 0) refuse('unparseable', `${file} does not parse: ${errors.join('; ')}`);
  return sf;
}

abstract class ExpectFrameworkAdapter implements TestFrameworkAdapter {
  abstract readonly stack: string;
  abstract enumerateSuites(dir: string): Promise<string[]>;

  async parseAssertions(file: string): Promise<Assertion[]> {
    return extractAssertions(await parseTestFile(file), file);
  }

  compareAssertions(before: Assertion[], after: Assertion[]): AssertionDelta {
    return compareAssertions(before, after);
  }

  async detectSkipMarkers(file: string): Promise<string[]> {
    return extractSkipMarkers(await parseTestFile(file));
  }
}

/**
 * Enumerates each tree with the rules of the vitest major that tree
 * declares, so a base on vitest 3 and a head on vitest 4 are each counted
 * the way their own runner would count them.
 */
export class VitestAdapter extends ExpectFrameworkAdapter {
  readonly stack: string;
  constructor(major: VitestMajor) {
    super();
    this.stack = `vitest@${String(major)}`;
  }

  enumerateSuites(dir: string): Promise<string[]> {
    return vitestSuites(dir);
  }
}

export class JestAdapter extends ExpectFrameworkAdapter {
  readonly stack: string;
  constructor(major: JestMajor) {
    super();
    this.stack = `jest@${String(major)}`;
  }

  enumerateSuites(dir: string): Promise<string[]> {
    return jestSuites(dir);
  }
}
