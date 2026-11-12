/**
 * Changed-line coverage from coverage.py's JSON report (`coverage json`,
 * format 3): per file, `executed_lines` and `missing_lines`. The report is
 * written by a check in the sandbox; this adapter reads it on the host and
 * runs nothing.
 *
 * A changed line is an obligation when a statement starts on it, by
 * coverage.py's own measure (D-R29-02): each statement's first line,
 * decorators and the `def` both, `elif`, `except`, and `case` lines, and a
 * module's or class's docstring; not `global`, `nonlocal`, a function's
 * docstring, `else:`, or `finally:`. The report may add obligations and
 * never remove one, so a `# pragma: no cover` thins nothing (D-P8-09).
 */
import { join } from 'node:path';
import type { SyntaxNode } from '@lezer/common';
import { isConfigFile } from '../config-files.js';
import { diffTrees, exists, readRegularFile, SOURCE_FILE_CAP, toPosix, VCS_DIRECTORIES } from '../files.js';
import { changedLines, splitLines } from '../line-diff.js';
import { refuse } from '../refusal.js';
import { isDependencyTree } from '../trees.js';
import type { CoverageAdapter, TestFrameworkAdapter } from '../types.js';
import { REPORT_CAP } from '../coverage.js';
import { childrenOf, lineOf, parsePython, statementsOf, type PythonModule } from './parse.js';

export interface CoveragePyOptions {
  /** Absolute host path of the JSON report the coverage check wrote. */
  readonly report: string;
  /** The tree's root as the process that wrote the report saw it, e.g. `/workspace`. */
  readonly sourceRoot: string;
  /** Used to exclude test files from the lines that must be covered. */
  readonly tests: TestFrameworkAdapter;
}

interface FileLines { readonly executed: ReadonlySet<number>; readonly measured: ReadonlySet<number> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lines(key: string, field: string, value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((n) => Number.isInteger(n) && (n as number) > 0)) {
    refuse('malformed-report', `the entry for ${key} has no ${field} list of line numbers`);
  }
  return value as number[];
}

const DOCSTRING_BODY = new Set(['FunctionDefinition']);

/** The lines coverage.py counts as statements, read from the source. */
export function executablePythonLines(module: PythonModule): Set<number> {
  const out = new Set<number>();
  const add = (node: SyntaxNode): void => { out.add(lineOf(module, node.from)); };
  module.tree.iterate({
    enter: (ref) => {
      const node = ref.node;
      const name = node.name;
      if (name === 'Decorator' || name === 'MatchClause') add(node);
      else if (name === 'elif' || name === 'except') add(node);
      else if (name === 'FunctionDefinition' || name === 'ClassDefinition') {
        const keyword = childrenOf(node).find((c) => c.name === 'def' || c.name === 'class' || c.name === 'async');
        add(keyword ?? node);
      } else if (name.endsWith('Statement') && name !== 'DecoratedStatement' && name !== 'ScopeStatement') {
        if (name === 'ExpressionStatement' && isFunctionDocstring(node)) return;
        add(node);
      }
    },
  });
  return out;
}

/** A string alone as the first statement of a function's body: its docstring, which carries no line of its own. */
function isFunctionDocstring(node: SyntaxNode): boolean {
  const [only] = childrenOf(node);
  if (only?.name !== 'String' && only?.name !== 'ContinuedString') return false;
  const body = node.parent;
  if (body?.name !== 'Body' || body.parent === null || !DOCSTRING_BODY.has(body.parent.name)) return false;
  return statementsOf(body)[0]?.from === node.from;
}

export class CoveragePyAdapter implements CoverageAdapter {
  readonly #options: CoveragePyOptions;

  constructor(options: CoveragePyOptions) {
    this.#options = options;
  }

  async #readReport(): Promise<Map<string, FileLines>> {
    const { report, sourceRoot } = this.#options;
    if (!(await exists(report))) refuse('missing-report', `no coverage report at ${report}`);
    let value: unknown;
    try {
      value = JSON.parse(await readRegularFile(report, REPORT_CAP));
    } catch (error) {
      if (error instanceof SyntaxError) refuse('malformed-report', `${report} is not JSON: ${error.message}`);
      throw error;
    }
    if (!isRecord(value) || !isRecord(value.files)) refuse('malformed-report', `${report} is not a coverage.py JSON report: it has no files object`);
    const prefix = `${sourceRoot.replaceAll('\\', '/').replace(/\/+$/u, '')}/`;
    const out = new Map<string, FileLines>();
    const keys = Object.keys(value.files);
    for (const key of keys) {
      const entry = value.files[key];
      if (!isRecord(entry)) refuse('malformed-report', `the entry for ${key} is not an object`);
      const executed = lines(key, 'executed_lines', entry.executed_lines);
      const missing = lines(key, 'missing_lines', entry.missing_lines);
      const normal = key.replaceAll('\\', '/');
      // coverage.py names a file under the directory it ran in relative to it, and any other absolutely.
      const path = normal.startsWith(prefix) ? normal.slice(prefix.length) : normal.startsWith('/') ? null : normal.replace(/^\.\//u, '');
      if (path !== null) out.set(path, { executed: new Set(executed), measured: new Set([...executed, ...missing]) });
    }
    if (keys.length > 0 && out.size === 0) refuse('malformed-report', `${report} names ${String(keys.length)} files and none under ${sourceRoot}, so it is not a report on this tree`);
    return out;
  }

  async changedLineCoverage(base: string, head: string): Promise<number> {
    const report = await this.#readReport();
    const tests = new Set((await this.#options.tests.enumerateSuites(head)).map((file) => toPosix(file)));
    const headPosix = toPosix(head).replace(/\/+$/u, '');
    const isSource = (path: string): boolean => path.endsWith('.py') && !isConfigFile(path) && !tests.has(`${headPosix}/${path}`);
    const changes = await diffTrees(base, head, isSource, { skipDirectory: (name) => isDependencyTree(name) || VCS_DIRECTORIES.has(name) });
    let total = 0;
    let covered = 0;
    for (const { path, change } of changes) {
      if (change === 'removed') continue;
      const after = await readRegularFile(join(head, path), SOURCE_FILE_CAP);
      const before = change === 'added' ? '' : await readRegularFile(join(base, path), SOURCE_FILE_CAP);
      const changed = changedLines(change === 'added' ? [] : splitLines(before), splitLines(after));
      const entry = report.get(path);
      const executable = executablePythonLines(parsePython(after, path));
      for (const line of entry?.measured ?? []) executable.add(line);
      for (const line of changed) {
        if (!executable.has(line)) continue;
        total++;
        if (entry?.executed.has(line) === true) covered++;
      }
    }
    return total === 0 ? 1 : covered / total;
  }
}
