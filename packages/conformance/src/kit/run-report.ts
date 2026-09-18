/**
 * The conformance run report: what a package's own test suite recorded about
 * the assertions it ran, so the registry can count an assertion that lives in
 * another package (`ExternalAssertion`) instead of refusing it.
 *
 * Why a report at all. The registry cannot import a sibling's tests — that is
 * the workspace cycle D-F3-04 exists to prevent — and it cannot re-run them
 * either: P5's capability assertions call a real model, so a second run is a
 * second bill for an answer the first run already has. The package writes
 * down what it ran; the registry reads it and decides whether to believe it.
 *
 * Why a tree hash and not a timestamp. A report is only evidence about the
 * code it was produced from. An mtime comparison is not that: a checkout, a
 * `touch`, a clock skew between a container and its host, and a file restored
 * from a cache all move mtimes without moving content, in both directions. The
 * hash is over the bytes of every input file in the package, so a report
 * either belongs to the tree being evaluated or it does not, and the answer is
 * the same on every machine.
 *
 * The report is a build artifact and is never committed. A tracked report
 * would be a claim about a run nobody can see, which is exactly the shape I2
 * rejects everywhere else.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { toPosix, walkFiles } from './workspace.js';

/** Directory, relative to a package root, holding the report. Gitignored. */
export const RUN_REPORT_DIR = '.conformance';

/** File name inside `RUN_REPORT_DIR`. */
export const RUN_REPORT_NAME = 'run.json';

/** `.conformance/run.json`, POSIX, for messages and for .gitignore. */
export const RUN_REPORT_PATH = `${RUN_REPORT_DIR}/${RUN_REPORT_NAME}`;

/**
 * Bumped when the shape changes. A report written by an older kit is refused
 * rather than read optimistically: a field this kit expects and that kit never
 * wrote would otherwise read as absent, and absent means "did not run".
 */
export const RUN_REPORT_VERSION = 1;

/**
 * The four states vitest reports. `pending` means collected but never
 * finished — a run that was cut short. Only `passed` is evidence; the other
 * three are each their own refusal at the registry.
 */
export type ReportedTestState = 'passed' | 'failed' | 'skipped' | 'pending';

export interface ReportedTest {
  /** The assertion id the test name carries, e.g. `driver.hooks`. */
  readonly id: string;
  /** The full test name as vitest reported it, suites included. */
  readonly name: string;
  readonly state: ReportedTestState;
  /** The test file, relative to the package root, POSIX separators. */
  readonly module: string;
}

export interface ConformanceRunReport {
  readonly version: number;
  /** package.json `name` of the package that ran. */
  readonly package: string;
  /** Hash over every input file in the package at the moment the run ended. */
  readonly treeHash: string;
  readonly generatedAt: string;
  /** Every test whose name carried an assertion id, in the order vitest reported them. */
  readonly tests: readonly ReportedTest[];
}

/**
 * Directories never hashed: dependencies and build output are not inputs, and
 * the report directory cannot be an input to the hash the report carries.
 */
const NOT_INPUT = ['node_modules', 'dist', 'coverage', '.git', RUN_REPORT_DIR];

/** Files never hashed: incremental-build state, which changes without the source changing. */
function isInput(path: string): boolean {
  return !path.endsWith('.tsbuildinfo');
}

/**
 * A hash over the bytes of every input file in `dir`, keyed by path.
 *
 * Path and content both, and a length prefix on each: hashing contents alone
 * would not notice a file renamed, and concatenating without a delimiter lets
 * two different trees produce one byte stream (the `ab` + `c` / `a` + `bc`
 * collision). Sorted, so directory-read order never changes the answer.
 */
export function packageTreeHash(dir: string): string {
  const files = walkFiles(dir, { extensions: [''], skipDirs: NOT_INPUT }).filter(isInput);
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    const rel = toPosix(relative(dir, file));
    const content = readFileSync(file);
    hash.update(`${String(rel.length)}:${rel}:${String(content.length)}:`);
    hash.update(content);
  }
  return hash.digest('hex');
}

/** `[I1.some-assertion] a title` -> `I1.some-assertion`; undefined when the name carries no id. */
export function assertionIdInName(name: string): string | undefined {
  const match = /\[([A-Za-z0-9.-]+)\]/.exec(name);
  return match?.[1];
}

/** Absolute path of a package's report. */
export function runReportFile(packageDir: string): string {
  return join(packageDir, RUN_REPORT_DIR, RUN_REPORT_NAME);
}

export function writeRunReport(packageDir: string, report: ConformanceRunReport): void {
  const file = runReportFile(packageDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

/**
 * The report a package wrote, or undefined when it has none. A file that
 * exists but is not a report of this shape throws: a half-written or
 * hand-edited report is a defect to see, not an absence to route around.
 */
export function readRunReport(packageDir: string): ConformanceRunReport | undefined {
  const file = runReportFile(packageDir);
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`conformance: ${toPosix(file)} is not a run report`);
  }
  const record: Record<string, unknown> = { ...parsed };
  const { version, package: name, treeHash, generatedAt, tests } = record;
  if (
    typeof version !== 'number'
    || typeof name !== 'string'
    || typeof treeHash !== 'string'
    || typeof generatedAt !== 'string'
    || !Array.isArray(tests)
  ) {
    throw new Error(`conformance: ${toPosix(file)} is missing fields a run report must have`);
  }
  return { version, package: name, treeHash, generatedAt, tests: tests.map(toReportedTest(file)) };
}

function toReportedTest(file: string): (value: unknown) => ReportedTest {
  const states: readonly string[] = ['passed', 'failed', 'skipped', 'pending'];
  return (value: unknown): ReportedTest => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`conformance: ${toPosix(file)} holds a test entry that is not an object`);
    }
    const entry: Record<string, unknown> = { ...value };
    const { id, name, state, module } = entry;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof state !== 'string' || typeof module !== 'string') {
      throw new Error(`conformance: ${toPosix(file)} holds a test entry with missing or mistyped fields`);
    }
    if (!states.includes(state)) {
      throw new Error(`conformance: ${toPosix(file)} holds test '${name}' in unknown state '${state}'`);
    }
    return { id, name, state: state as ReportedTestState, module };
  };
}
