/**
 * `TestFrameworkAdapter` for pytest 8.4+ and 9 (R29). Suites are enumerated
 * by pytest's rules from the tree's own config; assertions, skip markers,
 * and cases from the parse. The runner is the interpreter the runtime's
 * install copied into `.venv`, starting pytest with no plugin autoloaded, no
 * doctest collection, and no cache written into a read-only tree
 * (D-R29-06).
 */
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Assertion, AssertionDelta, TestFrameworkAdapter } from '../types.js';
import type { PytestMajor, PytestRules } from './config.js';
import { pythonSources, pytestSelection, pytestSuites } from './discovery.js';
import { fnmatch } from './ini.js';
import { readPython } from './parse.js';
import { comparePythonAssertions, extractAssertions, readTestFile, skipReferences, spellPython } from './tests.js';

/**
 * How the runner starts pytest: under `-I`, so neither the working directory
 * nor a `PYTHON*` variable is on `sys.path` while pytest is imported, and a
 * `pytest.py`, `pytest.pyc`, or `sitecustomize.py` in the tree cannot stand
 * in for the installed runner. The tree then joins the path last, which is
 * where `python -m pytest` would have made its modules importable, behind
 * the standard library and the install, so no file in it shadows either
 * (codex-1, D-R29-15).
 */
export const PYTEST_BOOTSTRAP = 'import os, sys; sys.path.append(os.getcwd()); import pytest; raise SystemExit(pytest.console_main())';

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
    return [this.runner, '-I', '-c', PYTEST_BOOTSTRAP, '--disable-plugin-autoload', '-p', 'no:cacheprovider', '-p', 'no:doctest', ...(tests ?? []).map(asArgument)];
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

  /**
   * A test module's or conftest's markers as `readTestFile` reads them; any
   * other module's skip references alone, since `pytest.skip` and `os._exit`
   * stop a test from any module it imports (gemini-1). A module's own
   * `sys.exit` is not one: under pytest it fails the test that reaches it.
   */
  async detectSkipMarkers(file: string): Promise<string[]> {
    const module = await readPython(file);
    const name = basename(file);
    if (name === 'conftest.py' || this.#rules.pythonFiles.some((p) => fnmatch(name, p))) return readTestFile(module, this.#rules).skips;
    return skipReferences(module, { module: true });
  }

  /** Every module in the tree: pytest's skip is a function, and any module a test imports can call it (gemini-1). */
  skipSources(dir: string): Promise<string[]> {
    return pythonSources(dir);
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
