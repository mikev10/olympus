/**
 * Runtime validation of the caller-supplied task. `readonly`, `boolean`, and
 * `string` in the types say nothing about what arrives at run time through a
 * cast or from JavaScript, and the verdict reads these fields, so a value the
 * verdict cannot trust is refused before anything is locked, provisioned, or
 * committed (I5). The authoritative manifest, pinned at test-design and read
 * from the Vault rather than from the caller, is P6's; this is the least the
 * skeleton can insist on. Added after the S1 external review
 * (docs/reviews/2026-09-09-S1-walking-skeleton-adversarial-triage.md,
 * findings 1, 3, and 7). Each problem is a field path and a code a machine
 * reads, with a message for a person beside them.
 */
import { isAbsolute, posix, win32 } from 'node:path';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { FixtureTask } from './run.js';

export type RequestProblemCode =
  /** A required list has no entries. */
  | 'missing'
  /** A string that must have content is blank, or is not a string. */
  | 'empty'
  /** An id or a path is listed twice. */
  | 'duplicate'
  /** `task.workspace` must be an absolute path. */
  | 'not-absolute'
  /** A locked path must be workspace-relative, not absolute. */
  | 'absolute'
  /** A locked path contains a `..` segment and could leave the workspace. */
  | 'escapes'
  /** `CheckSpec.required` must be a boolean. */
  | 'not-boolean'
  /** `CheckSpec.expectedSuiteCount` must be a non-negative integer when present. */
  | 'not-integer'
  /** No check is required, so no check could fail the gate. */
  | 'none-required';

export interface RequestProblem {
  /** The field, as a path into the request: `task.checks[1].id`. */
  readonly path: string;
  readonly code: RequestProblemCode;
  readonly message: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Every reason the task cannot be run as given; empty when it can. */
export function taskProblems(task: FixtureTask): RequestProblem[] {
  const problems: RequestProblem[] = [];
  const report = (path: string, code: RequestProblemCode, message: string): void => {
    problems.push({ path, code, message });
  };
  if (!isNonEmptyString(task.id)) report('task.id', 'empty', 'task.id must be a non-empty string');
  if (!isNonEmptyString(task.workspace) || !isAbsolute(task.workspace)) {
    report('task.workspace', 'not-absolute', 'task.workspace must be an absolute path');
  }
  lockedPathProblems(task.lockedPaths, report);
  checkProblems(task.checks, report);
  return problems;
}

type Report = (path: string, code: RequestProblemCode, message: string) => void;

/**
 * Locked paths are workspace-relative and stay inside it. The vault and the
 * build station both resolve them against the workspace; an absolute path or
 * a `..` segment would let the two name different files, or a file outside
 * the root the lock claims to cover.
 */
function lockedPathProblems(paths: unknown, report: Report): void {
  if (!Array.isArray(paths) || paths.length === 0) {
    report('task.lockedPaths', 'missing', 'task.lockedPaths must name at least one file; nothing locked is not a lock');
    return;
  }
  const list: readonly unknown[] = paths;
  const seen = new Set<string>();
  list.forEach((path, i) => {
    const at = `task.lockedPaths[${String(i)}]`;
    if (!isNonEmptyString(path)) {
      report(at, 'empty', `${at} must be a non-empty workspace-relative path`);
      return;
    }
    if (posix.isAbsolute(path) || win32.isAbsolute(path)) {
      report(at, 'absolute', `${at}: '${path}' is absolute; locked paths are workspace-relative`);
    }
    if (path.split(/[\\/]/).includes('..')) {
      report(at, 'escapes', `${at}: '${path}' contains a '..' segment and could leave the workspace`);
    }
    if (seen.has(path)) report(at, 'duplicate', `${at}: '${path}' is listed twice`);
    seen.add(path);
  });
}

/** The fields the verdict reads: id (unique), command, required (a boolean), expectedSuiteCount (an integer when present). */
function checkProblems(checks: unknown, report: Report): void {
  if (!Array.isArray(checks) || checks.length === 0) {
    report('task.checks', 'missing', 'task.checks must name at least one check; no check is not a verification');
    return;
  }
  const list: readonly unknown[] = checks;
  const seen = new Set<string>();
  let required = 0;
  list.forEach((check, i) => {
    const at = `task.checks[${String(i)}]`;
    if (typeof check !== 'object' || check === null) {
      report(at, 'empty', `${at} must be a CheckSpec`);
      return;
    }
    const c = check as Partial<Record<keyof CheckSpec, unknown>>;
    if (!isNonEmptyString(c.id)) report(`${at}.id`, 'empty', `${at}.id must be a non-empty string`);
    else if (seen.has(c.id)) {
      report(`${at}.id`, 'duplicate', `${at}.id '${c.id}' is listed twice; a duplicate id lets one result stand in for another`);
    } else seen.add(c.id);
    if (!isNonEmptyString(c.command)) report(`${at}.command`, 'empty', `${at}.command must be a non-empty string`);
    if (typeof c.required !== 'boolean') {
      report(`${at}.required`, 'not-boolean', `${at}.required must be a boolean, not ${typeof c.required}`);
    } else if (c.required) required += 1;
    const count = c.expectedSuiteCount;
    if (count !== undefined && !(typeof count === 'number' && Number.isInteger(count) && count >= 0)) {
      report(`${at}.expectedSuiteCount`, 'not-integer', `${at}.expectedSuiteCount must be a non-negative integer when present`);
    }
  });
  if (required === 0) {
    report('task.checks', 'none-required', 'task.checks: at least one check must be required; a gate no check can fail is not a gate');
  }
}
