/**
 * Changed-line coverage from the istanbul JSON report (`coverage-final.json`)
 * that c8, istanbul, vitest's `v8` and `istanbul` providers, and jest's
 * `json` reporter all write. The report is produced by a check run inside
 * the sandbox; this adapter only reads it, on the host, and never runs the
 * suite itself.
 *
 * A line counts when a changed line of `head` is executable: istanbul's own
 * rule, a line on which some statement starts (lib-coverage
 * `getLineCoverage`). It is covered when one of those statements ran. A
 * changed source file the report does not mention is not skipped: its
 * executable lines count, and none of them is covered, because a file the
 * suite never loaded is the least-covered file there is.
 */
import { join } from 'node:path';
import ts from 'typescript';
import { isConfigFile } from './config-files.js';
import { diffTrees, exists, readRegularFile, SOURCE_FILE_CAP, toPosix, VCS_DIRECTORIES } from './files.js';
import { changedLines, splitLines } from './line-diff.js';
import { refuse } from './refusal.js';
import { parseModule } from './static.js';
import type { CoverageAdapter, TestFrameworkAdapter } from './types.js';

/** A report for a large repository runs to tens of megabytes; this bounds what one may cost to read. */
export const REPORT_CAP = 256 * 1024 * 1024;

const SOURCE = /\.(?:[mc]?[jt]sx?)$/;
const DECLARATION = /\.d\.[mc]?ts$/;

export interface IstanbulCoverageOptions {
  /** Absolute host path of the report the coverage check wrote. */
  readonly report: string;
  /**
   * The directory the report's file paths are under: the tree's root as the
   * process that wrote the report saw it, e.g. `/workspace` inside the
   * sandbox. Required, because a report written in a container names paths
   * that do not exist on the host.
   */
  readonly sourceRoot: string;
  /** Used to exclude test files from the lines that must be covered. */
  readonly tests: TestFrameworkAdapter;
}

interface Location { line: number; column: number }
type LineHits = ReadonlyMap<number, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLocation(value: unknown): value is Location {
  return isRecord(value) && Number.isInteger(value.line) && (value.line as number) >= 0 && Number.isInteger(value.column);
}

/** Validates one file entry and returns, per line, the highest hit count of any statement starting on it. */
function lineHits(key: string, entry: unknown): LineHits {
  if (!isRecord(entry) || !isRecord(entry.statementMap) || !isRecord(entry.s)) {
    refuse('malformed-report', `the entry for ${key} has no statementMap and s objects`);
  }
  const counts = entry.s;
  const lines = new Map<number, number>();
  for (const [id, range] of Object.entries(entry.statementMap)) {
    if (!isRecord(range) || !isLocation(range.start) || !isLocation(range.end)) {
      refuse('malformed-report', `statement ${id} of ${key} has no start and end location`);
    }
    const hits = counts[id];
    if (typeof hits !== 'number' || !Number.isInteger(hits) || hits < 0) {
      refuse('malformed-report', `statement ${id} of ${key} has no hit count`);
    }
    const line = range.start.line;
    lines.set(line, Math.max(lines.get(line) ?? 0, hits));
  }
  return lines;
}

/**
 * The lines on which something istanbul would instrument starts, read from
 * the source on the host.
 *
 * It follows istanbul-lib-instrument's own visitor rather than "a TypeScript
 * statement starts here", because the two differ in three places that decide
 * whether a changed line is an obligation. A variable declaration carries no
 * counter of its own: the counter goes on each declarator's initialiser,
 * which is a line of its own where the value is written under the name. An
 * arrow function with an expression body has that body counted, since the
 * instrumenter rewrites it into a block with a return. A class property's
 * initialiser is counted the same way.
 */
function executableLines(text: string, fileName: string): Set<number> {
  const sf = parseModule(text, fileName);
  const lines = new Set<number>();
  const add = (node: ts.Node): void => {
    lines.add(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
  };
  const visit = (node: ts.Node): void => {
    const typeOnly = ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
      || ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) || ts.isExportDeclaration(node)
      || (ts.isModuleDeclaration(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) === true);
    if (typeOnly) return;
    const counted = ts.isStatement(node) && !ts.isBlock(node) && !ts.isEmptyStatement(node)
      && !ts.isFunctionDeclaration(node) && !ts.isClassDeclaration(node) && !ts.isVariableStatement(node);
    if (counted) add(node);
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.initializer !== undefined) add(node.initializer);
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) add(node.body);
    node.forEachChild(visit);
  };
  visit(sf);
  return lines;
}

export class IstanbulCoverageAdapter implements CoverageAdapter {
  readonly #options: IstanbulCoverageOptions;

  constructor(options: IstanbulCoverageOptions) {
    this.#options = options;
  }

  /** Every file entry in the report under `sourceRoot`, keyed by its path relative to it. */
  async #readReport(): Promise<Map<string, LineHits>> {
    const { report, sourceRoot } = this.#options;
    if (!(await exists(report))) refuse('missing-report', `no coverage report at ${report}`);
    let value: unknown;
    try {
      value = JSON.parse(await readRegularFile(report, REPORT_CAP));
    } catch (error) {
      if (error instanceof SyntaxError) refuse('malformed-report', `${report} is not JSON: ${error.message}`);
      throw error;
    }
    if (!isRecord(value)) refuse('malformed-report', `${report} is not a JSON object keyed by file`);
    const prefix = `${toPosix(sourceRoot).replace(/\/+$/, '')}/`;
    const files = new Map<string, LineHits>();
    const keys = Object.keys(value);
    for (const key of keys) {
      const normal = key.replaceAll('\\', '/');
      if (normal.startsWith(prefix)) files.set(normal.slice(prefix.length), lineHits(key, value[key]));
    }
    if (keys.length > 0 && files.size === 0) {
      refuse('malformed-report', `${report} names ${String(keys.length)} files and none under ${sourceRoot}, so it is not a report on this tree`);
    }
    return files;
  }

  async changedLineCoverage(base: string, head: string): Promise<number> {
    const report = await this.#readReport();
    const tests = new Set((await this.#options.tests.enumerateSuites(head)).map((file) => toPosix(file)));
    const headPosix = toPosix(head).replace(/\/+$/, '');
    const isSource = (path: string): boolean =>
      SOURCE.test(path) && !DECLARATION.test(path) && !isConfigFile(path) && !tests.has(`${headPosix}/${path}`);

    const changes = await diffTrees(base, head, isSource, {
      skipDirectory: (name) => name === 'node_modules' || VCS_DIRECTORIES.has(name),
    });
    let total = 0;
    let covered = 0;
    for (const { path, change } of changes) {
      if (change === 'removed') continue;
      const after = await readRegularFile(join(head, path), SOURCE_FILE_CAP);
      const before = change === 'added' ? '' : await readRegularFile(join(base, path), SOURCE_FILE_CAP);
      const changed = changedLines(change === 'added' ? [] : splitLines(before), splitLines(after));
      const hits = report.get(path);
      // The report may add obligations and never remove one. Taking the denominator from the
      // report alone lets the file being judged decide what counts: an entry with an empty
      // statement map, or one an `istanbul ignore` comment thinned out, would leave nothing to
      // cover and read as covered in full. The repository's own exclusions are not honoured
      // (D-P8-09), and an ignore comment is one of them.
      const executable = executableLines(after, path);
      for (const line of hits?.keys() ?? []) executable.add(line);
      for (const line of changed) {
        if (!executable.has(line)) continue;
        total++;
        if ((hits?.get(line) ?? 0) > 0) covered++;
      }
    }
    // No executable line changed, so no changed line is uncovered.
    return total === 0 ? 1 : covered / total;
  }
}
