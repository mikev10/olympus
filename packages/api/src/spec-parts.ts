/**
 * The two spec parts R19 adds beside the security part (R17): what the
 * acceptance checks need to run, and the drafter's assumptions and open
 * questions. Each is a JSON file locked with the spec. A drafted spec carries
 * both; a supplied spec may, and must carry the run requirements when its
 * acceptance tests are drafted, since they are the test drafter's only view of
 * the repository.
 *
 * Parsed here from the bytes the runtime read, so the part a station reads is
 * the part that was locked. Nothing here is a model's account of anything: a
 * part that does not parse is refused or sent back, never repaired (I5).
 */
import { isAbsolute, posix, win32 } from 'node:path';
import type { RequestProblem } from './validate.js';

/** Where every draft of a run lives in the tree, beside the repository's own files (R19). */
export const DRAFT_DIR = '.drafts';

/**
 * What the acceptance checks need to run, written by whoever wrote the spec:
 * the command a person runs the tests with, the framework, where the tests
 * live, and the public interface a check calls (R19).
 */
export interface RunRequirements {
  readonly testCommand: readonly [string, ...string[]];
  readonly framework: string;
  /** Repository-relative: where the acceptance tests live, so the framework finds them. */
  readonly testDirectory: string;
  readonly publicInterface: string;
}

/** Each point the intent left undecided and what the drafter chose, and each question it could not settle (R19). */
export interface Questions {
  readonly assumptions: ReadonlyArray<{ readonly point: string; readonly chose: string }>;
  readonly openQuestions: readonly string[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function extraKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

/**
 * Whether `path` is a repository-relative directory a draft may be written
 * under: relative, inside the tree, not the tree itself, and not the drafts
 * directory, where nothing a framework runs belongs.
 */
export function isDraftableDirectory(path: string): boolean {
  if (path.trim() === '' || isAbsolute(path) || win32.isAbsolute(path) || path.includes('\\')) return false;
  const normal = posix.normalize(path).replace(/\/+$/, '');
  if (normal === '.' || normal === '' || normal.startsWith('../') || normal === '..') return false;
  const first = normal.split('/')[0];
  return first !== DRAFT_DIR && first !== '.git';
}

export function parseRunRequirements(value: unknown, at: string): { ok: true; part: RunRequirements } | { ok: false; problems: RequestProblem[] } {
  const problems: RequestProblem[] = [];
  const report = (path: string, message: string): void => {
    problems.push({ path, code: 'not-a-spec-part', message });
  };
  if (!isRecord(value)) {
    report(at, 'the run-requirements part is an object with testCommand, framework, testDirectory, and publicInterface');
    return { ok: false, problems };
  }
  for (const key of extraKeys(value, ['testCommand', 'framework', 'testDirectory', 'publicInterface'])) report(`${at}.${key}`, `'${key}' is not a field of the run-requirements part`);
  const command = value.testCommand;
  if (!Array.isArray(command) || command.length === 0 || !command.every(isText)) report(`${at}.testCommand`, 'testCommand is an argument vector: a non-empty list of non-empty strings');
  if (!isText(value.framework)) report(`${at}.framework`, 'framework names the test framework');
  if (!isText(value.testDirectory) || !isDraftableDirectory(value.testDirectory)) {
    report(`${at}.testDirectory`, `testDirectory is a repository-relative directory inside the tree, and not ${DRAFT_DIR}/ or .git/`);
  }
  if (!isText(value.publicInterface)) report(`${at}.publicInterface`, 'publicInterface says what a check calls');
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    part: {
      testCommand: [...(command as [string, ...string[]])],
      framework: value.framework as string,
      testDirectory: posix.normalize(value.testDirectory as string).replace(/\/+$/, ''),
      publicInterface: value.publicInterface as string,
    },
  };
}

export function parseQuestions(value: unknown, at: string): { ok: true; part: Questions } | { ok: false; problems: RequestProblem[] } {
  const problems: RequestProblem[] = [];
  const report = (path: string, message: string): void => {
    problems.push({ path, code: 'not-a-spec-part', message });
  };
  if (!isRecord(value)) {
    report(at, 'the questions part is an object with assumptions and openQuestions');
    return { ok: false, problems };
  }
  for (const key of extraKeys(value, ['assumptions', 'openQuestions'])) report(`${at}.${key}`, `'${key}' is not a field of the questions part`);
  const assumptions = value.assumptions;
  if (!Array.isArray(assumptions) || !assumptions.every((a) => isRecord(a) && isText(a.point) && isText(a.chose) && extraKeys(a, ['point', 'chose']).length === 0)) {
    report(`${at}.assumptions`, 'assumptions is a list of { point, chose }: what the intent left open, and what was chosen');
  }
  const open = value.openQuestions;
  if (!Array.isArray(open) || !open.every(isText)) report(`${at}.openQuestions`, 'openQuestions is a list of questions; an empty list says there are none');
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    part: {
      assumptions: (assumptions as Array<{ point: string; chose: string }>).map(({ point, chose }) => ({ point, chose })),
      openQuestions: [...(open as string[])],
    },
  };
}
