/**
 * `TestFrameworkAdapter` for pytest 8.4+ and 9 (R29). Suites are enumerated
 * by pytest's rules from the tree's own config; assertions, skip markers,
 * and cases from the parse. The runner is the interpreter the runtime's
 * install copied into `.venv`, starting pytest with no plugin autoloaded, no
 * doctest collection, and no cache written into a read-only tree
 * (D-R29-06).
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Assertion, AssertionDelta, TestFrameworkAdapter } from '../types.js';
import type { PytestMajor, PytestRules } from './config.js';
import { pytestSelection, pytestSuites } from './discovery.js';
import { readPython } from './parse.js';
import { comparePythonAssertions, extractAssertions, readTestFile, spellPython } from './tests.js';

/** A named test as a runner argument: `./`-led, so a file named `-x.py` is never an option. */
function asArgument(test: string): string {
  return `./${test}`;
}

export class PytestAdapter implements TestFrameworkAdapter {
  readonly stack: string;
  readonly runner = '.venv/bin/python';
  readonly #rules: PytestRules;

  /** `rules` are the tree's own, read when its set was built; cases are named by its `python_classes` and `python_functions`. */
  constructor(rules: PytestRules) {
    this.#rules = rules;
    this.stack = `pytest@${String(rules.major satisfies PytestMajor)}`;
  }

  invocation(tests: readonly string[] | null): readonly [string, ...string[]] {
    return [this.runner, '-m', 'pytest', '--disable-plugin-autoload', '-p', 'no:cacheprovider', '-p', 'no:doctest', ...(tests ?? []).map(asArgument)];
  }

  selectSuites(dir: string, tests: readonly string[]): Promise<string[]> {
    return pytestSelection(dir, tests);
  }

  enumerateSuites(dir: string): Promise<string[]> {
    return pytestSuites(dir);
  }

  async parseAssertions(file: string): Promise<Assertion[]> {
    return extractAssertions(await readPython(file));
  }

  compareAssertions(before: Assertion[], after: Assertion[]): AssertionDelta {
    return comparePythonAssertions(before, after);
  }

  async detectSkipMarkers(file: string): Promise<string[]> {
    return readTestFile(await readPython(file), this.#rules).skips;
  }

  async enumerateCases(file: string): Promise<string[]> {
    return readTestFile(await readPython(file), this.#rules).cases;
  }

  /** The interpreter the install copied, and pytest in its `site-packages`; either missing and the check cannot start. */
  async missingRunner(tree: string): Promise<string | null> {
    const python = await stat(join(tree, '.venv', 'bin', 'python')).catch(() => null);
    if (python?.isFile() !== true) return `${this.stack}'s interpreter is not installed at ${this.runner}, so the check cannot start`;
    const lib = join(tree, '.venv', 'lib');
    const versions = (await readdir(lib, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && /^python3\.\d+$/u.test(e.name));
    for (const v of versions) {
      const init = await stat(join(lib, v.name, 'site-packages', 'pytest', '__init__.py')).catch(() => null);
      if (init?.isFile() === true) return null;
    }
    return `${this.stack} is not installed in .venv, so the check cannot start`;
  }

  spell(a: Assertion): string {
    return spellPython(a);
  }
}
