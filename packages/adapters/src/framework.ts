/**
 * `TestFrameworkAdapter` for vitest and for jest. Parsing, comparison, and
 * marker detection are the same for both — they share `expect`, the chai
 * forms vitest adds are recorded as what they are, and each framework's own
 * markers are detected in either — so the two differ only in enumeration.
 */
import { compareAssertions, extractAssertions } from './assertions.js';
import { jestSuites, treeRelative, vitestSelection, vitestSuites } from './discovery.js';
import { readRegularFile, SOURCE_FILE_CAP } from './files.js';
import { extractCases, extractSkipMarkers } from './markers.js';
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

/**
 * A named test as a runner argument: `./`-led, so a file whose name begins
 * with `-` is never read as an option, and resolved against the root the
 * runner starts in.
 */
function asArgument(test: string): string {
  return `./${test}`;
}

abstract class ExpectFrameworkAdapter implements TestFrameworkAdapter {
  abstract readonly stack: string;
  abstract readonly runner: string;
  abstract invocation(tests: readonly string[] | null): readonly [string, ...string[]];
  abstract selectSuites(dir: string, tests: readonly string[]): Promise<string[]>;
  /** Whether a test's first parameter is the framework's test context, which can skip it: vitest's, not jest's `done`. */
  protected abstract readonly testContext: boolean;
  abstract enumerateSuites(dir: string): Promise<string[]>;

  async parseAssertions(file: string): Promise<Assertion[]> {
    return extractAssertions(await parseTestFile(file), file);
  }

  compareAssertions(before: Assertion[], after: Assertion[]): AssertionDelta {
    return compareAssertions(before, after);
  }

  async detectSkipMarkers(file: string): Promise<string[]> {
    return extractSkipMarkers(await parseTestFile(file), this.testContext);
  }

  async enumerateCases(file: string): Promise<string[]> {
    return extractCases(await parseTestFile(file), file);
  }
}

/**
 * Enumerates each tree with the rules of the vitest major that tree
 * declares, so a base on vitest 3 and a head on vitest 4 are each counted
 * the way their own runner would count them.
 */
export class VitestAdapter extends ExpectFrameworkAdapter {
  readonly stack: string;
  /** The package's own launcher in both supported majors, run by node so no shell shim is between. */
  readonly runner = 'node_modules/vitest/vitest.mjs';
  protected readonly testContext = true;
  constructor(major: VitestMajor) {
    super();
    this.stack = `vitest@${String(major)}`;
  }

  /** `run`, never watch. A file is a filter to vitest, so `selectSuites` says what it selects. */
  invocation(tests: readonly string[] | null): readonly [string, ...string[]] {
    return ['node', this.runner, 'run', ...(tests ?? []).map(asArgument)];
  }

  selectSuites(dir: string, tests: readonly string[]): Promise<string[]> {
    return vitestSelection(dir, tests.map(asArgument));
  }

  enumerateSuites(dir: string): Promise<string[]> {
    return vitestSuites(dir);
  }
}

export class JestAdapter extends ExpectFrameworkAdapter {
  readonly stack: string;
  /** The `jest` package's `bin` in both supported majors. */
  readonly runner = 'node_modules/jest/bin/jest.js';
  protected readonly testContext = false;
  constructor(major: JestMajor) {
    super();
    this.stack = `jest@${String(major)}`;
  }

  /**
   * `--ci`, so a snapshot the suite lacks fails rather than being written.
   * `--runTestsByPath` takes each file as a path rather than a pattern: jest
   * resolves it and keeps it only if it is a test file (`findTestsByPaths`,
   * jest-core 29.7.0 and 30.2.0 `SearchSource`).
   */
  invocation(tests: readonly string[] | null): readonly [string, ...string[]] {
    return tests === null ? ['node', this.runner, '--ci'] : ['node', this.runner, '--ci', '--runTestsByPath', ...tests.map(asArgument)];
  }

  async selectSuites(dir: string, tests: readonly string[]): Promise<string[]> {
    const named = new Set(tests);
    return treeRelative(dir, await jestSuites(dir)).filter((suite) => named.has(suite));
  }

  enumerateSuites(dir: string): Promise<string[]> {
    return jestSuites(dir);
  }
}
