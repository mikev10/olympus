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
import { dirname, join, relative, resolve } from 'node:path';
import { toPosix, walkFiles, workspacePackages } from './workspace.js';

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
export const RUN_REPORT_VERSION = 2;

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
  /**
   * The hash taken before the run started. Equal to `treeHash` on a run whose
   * inputs did not move underneath it; different when they did, which is a
   * report about two trees and evidence about neither.
   */
  readonly startedFromHash: string;
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

/**
 * Extensions that are inputs to a run. An allow-list rather than a deny-list:
 * a directory holds whatever a tool left in it -- an editor's scratch file, a
 * log, a coverage fragment written after the run started -- and hashing those
 * makes the report mismatch for reasons that have nothing to do with the code.
 * The failure is closed, so it costs a re-run rather than a false pass, but a
 * check that refuses at random teaches people to re-run until it passes.
 */
const INPUT_EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.yaml', '.yml', '.md', ''];

/** Files never hashed: incremental-build state, which changes without the source changing. */
function isInput(path: string): boolean {
  if (path.endsWith('.tsbuildinfo')) return false;
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  const extension = dot <= 0 ? '' : base.slice(dot);
  return INPUT_EXTENSIONS.includes(extension);
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
  const hash = createHash('sha256');
  for (const root of executionInputs(dir)) {
    const files = walkFiles(root.dir, { extensions: [''], skipDirs: NOT_INPUT }).filter(isInput);
    hash.update(`package:${root.name}:`);
    for (const file of files.sort()) {
      const rel = toPosix(relative(root.dir, file));
      const content = readFileSync(file);
      hash.update(`${String(rel.length)}:${rel}:${String(content.length)}:`);
      hash.update(content);
    }
  }
  return hash.digest('hex');
}

/**
 * Every package whose source the run executes: the owning package and each
 * workspace package it depends on, transitively, in a stable order.
 *
 * One directory is not the tree being evaluated. The driver's assertions run
 * the sandbox provider and the contracts, so a report that hashed only the
 * driver stayed valid across a change to `@olympus-ai/sandbox` -- and
 * `I1.driver-executes-inside-the-sandbox` is an assertion *about* that
 * provider. The registry would have accepted yesterday's evidence for today's
 * mount layer.
 *
 * A workspace dependency is one resolved through the workspace rather than the
 * registry; a versioned dependency is pinned by the lockfile, which is hashed
 * separately as a root input.
 */
function executionInputs(dir: string): Array<{ name: string; dir: string }> {
  const byName = new Map(workspacePackages().map((pkg) => [pkg.name, pkg]));
  const owner = workspacePackages().find((pkg) => toPosix(resolve(pkg.dir)) === toPosix(resolve(dir)));
  const roots: Array<{ name: string; dir: string }> = [];
  const seen = new Set<string>();

  const visit = (name: string, packageDir: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    roots.push({ name, dir: packageDir });
    for (const dependency of workspaceDependenciesOf(packageDir)) {
      const resolved = byName.get(dependency);
      if (resolved !== undefined) visit(resolved.name, resolved.dir);
    }
  };

  visit(owner?.name ?? toPosix(resolve(dir)), dir);
  roots.sort((a, b) => a.name.localeCompare(b.name));
  return roots;
}

/** Dependency names in a package manifest that resolve through the workspace. */
function workspaceDependenciesOf(dir: string): string[] {
  const manifest = join(dir, 'package.json');
  if (!existsSync(manifest)) return [];
  const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) return [];
  const names: string[] = [];
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const block: unknown = (parsed as Record<string, unknown>)[field];
    if (typeof block !== 'object' || block === null) continue;
    for (const [name, range] of Object.entries(block as Record<string, unknown>)) {
      if (typeof range === 'string' && range.startsWith('workspace:')) names.push(name);
    }
  }
  return names;
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
  const { version, package: name, startedFromHash, treeHash, generatedAt, tests } = record;
  if (
    typeof version !== 'number'
    || typeof name !== 'string'
    || typeof startedFromHash !== 'string'
    || typeof treeHash !== 'string'
    || typeof generatedAt !== 'string'
    || !Array.isArray(tests)
  ) {
    throw new Error(`conformance: ${toPosix(file)} is missing fields a run report must have`);
  }
  return { version, package: name, startedFromHash, treeHash, generatedAt, tests: tests.map(toReportedTest(file)) };
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
