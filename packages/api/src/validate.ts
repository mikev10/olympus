/**
 * Runtime validation of what a caller hands the runtime. `readonly`,
 * `boolean`, and `string` in the types say nothing about what arrives at run
 * time through a cast or from JavaScript, and the line reads these fields, so
 * a value it cannot trust is refused before anything is admitted, locked,
 * provisioned, or committed (I5). Each problem is a field path and a code a
 * machine reads, with a message for a person beside them.
 *
 * Two of the artifacts are parsed, not only hashed: the verification manifest
 * and the task graph. They are validated here, at admission, from the same
 * bytes whose hash the admission record keeps, and the station that locks each
 * refuses a lock whose hash differs (A-P4-03). So the manifest `verify` runs and
 * the graph `build` schedules are the ones validated here.
 */
import { isAbsolute, posix, win32 } from 'node:path';
import { isAutonomyLevel } from '@olympus-ai/core';
import type { RoleId, RunId, Task, TaskGraph, TaskId } from '@olympus-ai/core';
import type { SecurityScanner } from '@olympus-ai/adapters';
import type { CheckKind, CheckSpec, SecurityCheckKind, SecurityCheckSpec } from '@olympus-ai/integrity';
import type { RequestedArtifacts } from './run.js';

export type RequestProblemCode =
  /** A required list has no entries. */
  | 'missing'
  /** A string that must have content is blank, or is not a string. */
  | 'empty'
  /** A run id that is not one directory name, so neither the Vault nor the workspace store can hold it (D-P14-14). */
  | 'unusable'
  /** An id or a path is listed twice. */
  | 'duplicate'
  /** `workspace` must be an absolute path. */
  | 'not-absolute'
  /** An artifact path must be workspace-relative, not absolute. */
  | 'absolute'
  /** An artifact path contains a `..` segment and could leave the workspace. */
  | 'escapes'
  /** `CheckSpec.required` must be a boolean. */
  | 'not-boolean'
  /** `CheckSpec.command` must be an argument vector: an array of strings whose first names a program (A-P6-01). */
  | 'not-argv'
  /** `CheckSpec.expectedSuiteCount` must be a non-negative integer when present. */
  | 'not-integer'
  /** No check is required, so no check could fail the gate. */
  | 'none-required'
  /** An acceptance check does not declare `onBase` as `'fails'` or `'passes'`; there is no default (D-A-BF-01). */
  | 'undeclared'
  /** A check of a kind that does not run over the base declares `onBase`, which nothing would act on. */
  | 'not-declarable'
  /** No required acceptance or behavioral check is declared `'fails'`, so the run has nothing to show the change did. */
  | 'none-fails-on-base'
  /** `CheckSpec.kind` is not one of the kinds a check can be. */
  | 'not-a-kind'
  /** A field the check's kind does not take: a command on a suite check, tests on any other, a count an acceptance check's tests already fix (D-R15-04). */
  | 'not-applicable'
  /** A named test the runner would not read as one file: a `:` vitest takes for a line filter. */
  | 'not-runnable'
  /** A named test the base's test framework does not run as one exact suite, or a suite check over a base with no test framework (D-R15-04). */
  | 'unbound'
  /** `requestedLevel` is not one of 0, 1, 2, 3. */
  | 'not-a-level'
  /** `approvedCostUsd` is neither a finite number nor null. */
  | 'not-a-cost'
  /** An artifact could not be read from the workspace. */
  | 'unreadable'
  /** An artifact that must be JSON is not. */
  | 'not-json'
  /** A task names a station no task may be scheduled at. */
  | 'bad-station'
  /** A task depends on a task the graph does not hold, or on one it may not depend on. */
  | 'bad-dependency'
  /** The graph's dependencies form a cycle, so it cannot finish. */
  | 'cycle'
  /** A build task no review task covers, so its work would reach integrate unreviewed. */
  | 'unreviewed'
  /** The policy does not validate. */
  | 'invalid-policy'
  /** The run already has state: it was admitted once, and is resumed, not started again. */
  | 'already-admitted'
  /** The workspace store and the workspace lie one inside the other. */
  | 'overlaps'
  /** A role's egress allowlist names a host the git remote is reached on (D-I1b-05). */
  | 'reaches-git-remote'
  /** A security check's image is not pinned by digest, or is not the image declared for its kind (R17). */
  | 'not-pinned'
  /** A security check's `config` is neither text nor null, or is null for a scanner with no rules of its own. */
  | 'not-config'
  /** A security check is optional; a scanner nothing holds the gate to is not a control (I5). */
  | 'not-required'
  /** A security part that is not one: neither `none` with its reason nor every field the part requires (R17). */
  | 'not-a-security-part';

export interface RequestProblem {
  /** The field, as a path into the request or an artifact: `graph.tasks[1].dependsOn[0]`. */
  readonly path: string;
  readonly code: RequestProblemCode;
  readonly message: string;
}

type Report = (path: string, code: RequestProblemCode, message: string) => void;

function collector(): { problems: RequestProblem[]; report: Report } {
  const problems: RequestProblem[] = [];
  return { problems, report: (path, code, message) => problems.push({ path, code, message }) };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export interface RequestFields {
  readonly runId: unknown;
  readonly baseCommit: unknown;
  readonly requestedLevel: unknown;
  readonly workspace: unknown;
  readonly artifacts: unknown;
  readonly approvedCostUsd: unknown;
}

/**
 * A run id names a directory in the Vault and in the workspace store, so it is
 * one path segment and nothing that could leave either. The same rule as
 * `LocalVault`'s, held here so an id neither can name is refused before
 * anything is written, a decision included (D-P14-01, D-P14-14).
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Every reason the request's own fields cannot be admitted; empty when they can. The artifacts' contents are checked separately, once read. */
export function requestProblems(req: RequestFields): RequestProblem[] {
  const { problems, report } = collector();
  if (!isNonEmptyString(req.runId)) report('runId', 'empty', 'runId must be a non-empty string');
  else if (!RUN_ID.test(req.runId)) {
    report('runId', 'unusable', `runId must match ${String(RUN_ID)}; it names a directory and may not leave one`);
  }
  if (!isNonEmptyString(req.baseCommit)) report('baseCommit', 'empty', 'baseCommit must be a non-empty string');
  if (!isAutonomyLevel(req.requestedLevel)) report('requestedLevel', 'not-a-level', 'requestedLevel must be one of 0, 1, 2, 3');
  // Checked here as well as at the HTTP layer: a cost-unapproved refusal records this value (External review of P14, codex-4).
  if (req.approvedCostUsd !== null && (typeof req.approvedCostUsd !== 'number' || !Number.isFinite(req.approvedCostUsd))) {
    report('approvedCostUsd', 'not-a-cost', 'approvedCostUsd must be a finite number or null');
  }
  if (!isNonEmptyString(req.workspace) || !isAbsolute(req.workspace)) {
    report('workspace', 'not-absolute', 'workspace must be an absolute path');
  }
  artifactProblems(req.artifacts, report);
  return problems;
}

/**
 * Artifact paths are workspace-relative and stay inside it. The Vault and
 * every station resolve them against the workspace; an absolute path or a
 * `..` segment would let the two name different files. A path listed under
 * two artifacts is a duplicate, since the second station's lock of it would
 * be refused.
 */
function artifactProblems(artifacts: unknown, report: Report): void {
  if (typeof artifacts !== 'object' || artifacts === null) {
    report('artifacts', 'missing', 'artifacts must name the spec, the acceptance tests, the verification manifest, and the task graph');
    return;
  }
  const a = artifacts as Partial<Record<keyof RequestedArtifacts, unknown>>;
  const seen = new Set<string>();
  const one = (at: string, path: unknown): void => {
    if (!isNonEmptyString(path)) {
      report(at, 'empty', `${at} must be a non-empty workspace-relative path`);
      return;
    }
    if (posix.isAbsolute(path) || win32.isAbsolute(path)) report(at, 'absolute', `${at}: '${path}' is absolute; artifact paths are workspace-relative`);
    if (path.split(/[\\/]/).includes('..')) report(at, 'escapes', `${at}: '${path}' contains a '..' segment and could leave the workspace`);
    if (seen.has(path)) report(at, 'duplicate', `${at}: '${path}' is listed twice`);
    seen.add(path);
  };
  for (const list of ['spec', 'acceptanceTests'] as const) {
    const paths = a[list];
    if (!Array.isArray(paths) || paths.length === 0) {
      report(`artifacts.${list}`, 'missing', `artifacts.${list} must name at least one file; nothing locked is not a lock`);
      continue;
    }
    const entries: readonly unknown[] = paths;
    entries.forEach((path, i) => {
      one(`artifacts.${list}[${String(i)}]`, path);
    });
  }
  one('artifacts.verificationManifest', a.verificationManifest);
  one('artifacts.taskGraph', a.taskGraph);
  const parts = a.specParts;
  if (parts !== undefined) {
    if (typeof parts !== 'object' || parts === null || Array.isArray(parts)) {
      report('artifacts.specParts', 'empty', 'artifacts.specParts must be an object naming each part\'s file');
    } else {
      const p = parts as Record<string, unknown>;
      for (const key of Object.keys(p)) {
        if (key !== 'security') report(`artifacts.specParts.${key}`, 'not-applicable', `artifacts.specParts.${key} is not a part a spec carries; the security part is the only one`);
      }
      if (p.security !== undefined) one('artifacts.specParts.security', p.security);
    }
  }
}

/** The manifest's checks, or the problems that keep it from being one. */
export function parseManifest(value: unknown): { ok: true; checks: CheckSpec[] } | { ok: false; problems: RequestProblem[] } {
  const { problems, report } = collector();
  const checks = typeof value === 'object' && value !== null && 'checks' in value ? value.checks : undefined;
  checkProblems(checks, report);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    checks: (checks as CheckSpec[]).map((check): CheckSpec => {
      if (check.kind === 'acceptance') {
        const [first, ...rest] = check.tests;
        const tests: readonly [string, ...string[]] = [first, ...rest];
        return { ...check, tests };
      }
      if (check.kind === 'unit' || isSecuritySpec(check)) return { ...check };
      const [program, ...args] = check.command;
      return { ...check, command: [program, ...args] };
    }),
  };
}

const CHECK_KINDS: ReadonlySet<string> = new Set<CheckKind>(['compile', 'typecheck', 'lint', 'unit', 'acceptance', 'behavioral', 'coverage', 'mutation', 'secret-scan', 'static-analysis']);

/** The kinds a scanner runs, whose invocation is the runtime's and whose image and rules the manifest pins (D-R17-01). */
const SECURITY_KINDS: ReadonlySet<string> = new Set<SecurityCheckKind>(['secret-scan', 'static-analysis']);

function isSecuritySpec(check: CheckSpec): check is SecurityCheckSpec {
  return SECURITY_KINDS.has(check.kind);
}

/** An image pinned by digest: a name, `@sha256:`, and 64 lowercase hex digits. A tag can be moved; a digest cannot. */
const PINNED_IMAGE = /^[^\s@]+@sha256:[0-9a-f]{64}$/;

/**
 * A security check's own fields: an image pinned by digest, rules as text or
 * null, required, and no command, since the scanner's arguments are the
 * runtime's (D-R17-01). Whether the image is the one declared for the kind
 * is admission's, which knows the stack's scanners.
 */
function securityFieldProblems(c: Partial<Record<keyof SecurityCheckSpec, unknown>>, at: string, report: Report): void {
  if (typeof c.image !== 'string' || !PINNED_IMAGE.test(c.image)) {
    report(`${at}.image`, 'not-pinned', `${at}.image must be an image pinned by digest, name@sha256:<64 hex>; a tag is not a pin`);
  }
  if (c.config !== null && typeof c.config !== 'string') {
    report(`${at}.config`, 'not-config', `${at}.config must be the scanner's rules as text, or null for the image's own`);
  }
  if (c.required === false) {
    report(`${at}.required`, 'not-required', `${at} is a ${String(c.kind)} check, and must be required: a scanner whose findings hold nothing is not a control`);
  }
}

/**
 * Every security check the manifest must pin and every image it may: a
 * `secret-scan` check of the secret scanner's image, and, where the stack
 * has a static-analysis scanner, a `static-analysis` check of its image,
 * each refused naming the kind (I5). A check pins no rules only where its
 * scanner has rules of its own.
 */
export function securityProblems(
  checks: readonly CheckSpec[],
  scanners: { readonly secretScan: SecurityScanner; readonly staticAnalysis: SecurityScanner | null },
): RequestProblem[] {
  const { problems, report } = collector();
  const declared: Readonly<Record<SecurityCheckKind, SecurityScanner | null>> = {
    'secret-scan': scanners.secretScan,
    'static-analysis': scanners.staticAnalysis,
  };
  const pinned = new Set<SecurityCheckKind>();
  checks.forEach((check, i) => {
    if (check.kind !== 'secret-scan' && check.kind !== 'static-analysis') return;
    const at = `manifest.checks[${String(i)}]`;
    pinned.add(check.kind);
    const scanner = declared[check.kind];
    if (scanner === null) {
      report(`${at}.kind`, 'unbound', `${at} is a static-analysis check, and the base's stack has no static-analysis scanner to run it`);
      return;
    }
    if (check.image !== scanner.image) {
      report(`${at}.image`, 'not-pinned', `${at}.image is ${check.image}; a ${check.kind} check runs ${scanner.image}, the image declared for its kind`);
    }
    if (check.config === null && scanner.defaultConfig === null) {
      report(`${at}.config`, 'not-config', `${at}.config is null, and the ${check.kind} scanner has no rules of its own; the check must pin them`);
    }
  });
  for (const kind of ['secret-scan', 'static-analysis'] as const) {
    if (declared[kind] !== null && !pinned.has(kind)) {
      report('manifest.checks', 'missing', `manifest.checks pins no ${kind} check; every run is scanned for it (R17)`);
    }
  }
  return problems;
}

/**
 * The files an acceptance check runs: workspace-relative, inside it, each
 * once, and each a single file to the runner. That each is an admitted
 * acceptance test the base's framework runs as one suite is admission's,
 * which reads the base (D-R15-04).
 */
function testsProblems(tests: unknown, at: string, report: Report): void {
  if (!Array.isArray(tests) || tests.length === 0) {
    report(at, 'missing', `${at} must name at least one locked acceptance test; a check that runs no test shows nothing`);
    return;
  }
  const list: readonly unknown[] = tests;
  const seen = new Set<string>();
  list.forEach((test, i) => {
    const one = `${at}[${String(i)}]`;
    if (!isNonEmptyString(test)) report(one, 'empty', `${one} must be a non-empty workspace-relative path`);
    else if (posix.isAbsolute(test) || win32.isAbsolute(test)) report(one, 'absolute', `${one}: '${test}' must be relative to the workspace`);
    else if (test.split(/[\\/]/).includes('..')) report(one, 'escapes', `${one}: '${test}' contains a '..' segment and could leave the workspace`);
    else if (test.includes('\\')) report(one, 'not-runnable', `${one}: '${test}' must use '/' separators, as the runner's sandbox does`);
    else if (test.includes(':')) report(one, 'not-runnable', `${one}: '${test}' contains ':', which vitest reads as a line filter rather than part of a file`);
    else if (seen.has(test)) report(one, 'duplicate', `${one}: '${test}' is listed twice`);
    else seen.add(test);
  });
}

/**
 * I5: a command is run exactly as pinned or not at all. A string would need a
 * grammar the runtime invents, and a vector with a non-string in it has no
 * exact form to run, so both are refused rather than approximated (A-P6-01).
 */
function commandProblems(command: unknown, at: string, report: Report): void {
  if (!Array.isArray(command)) {
    report(at, 'not-argv', `${at} must be an argument vector, an array of strings; a string would need a grammar the runtime would have to invent`);
    return;
  }
  const argv: readonly unknown[] = command;
  if (argv.length === 0) {
    report(at, 'empty', `${at} is an empty argument vector; there is no program to run`);
    return;
  }
  const bad = argv.findIndex((arg) => typeof arg !== 'string');
  if (bad !== -1) report(`${at}[${String(bad)}]`, 'not-argv', `${at}[${String(bad)}] is not a string; an argument vector has no other element`);
  else if (!isNonEmptyString(argv[0])) report(`${at}[0]`, 'empty', `${at}[0] must name the program to run`);
}

/**
 * The fields the verdict reads: id (unique), kind (a known one), command
 * (every kind but a suite kind), tests (an acceptance check's), required (a
 * boolean), expectedSuiteCount (an integer when present, never on an
 * acceptance check), and what each acceptance
 * check, and any behavioral check that declares one, does on the base
 * (D-A-BF-01, D-R15-02).
 */
function checkProblems(checks: unknown, report: Report): void {
  if (!Array.isArray(checks) || checks.length === 0) {
    report('manifest.checks', 'missing', 'manifest.checks must name at least one check; no check is not a verification');
    return;
  }
  const list: readonly unknown[] = checks;
  const seen = new Set<string>();
  let required = 0;
  let reproduces = 0;
  list.forEach((check, i) => {
    const at = `manifest.checks[${String(i)}]`;
    if (typeof check !== 'object' || check === null) {
      report(at, 'empty', `${at} must be a CheckSpec`);
      return;
    }
    const c = check as Partial<Record<keyof CheckSpec, unknown>>;
    if (!isNonEmptyString(c.id)) report(`${at}.id`, 'empty', `${at}.id must be a non-empty string`);
    else if (seen.has(c.id)) {
      report(`${at}.id`, 'duplicate', `${at}.id '${c.id}' is listed twice; a duplicate id lets one result stand in for another`);
    } else seen.add(c.id);
    if (typeof c.kind !== 'string' || !CHECK_KINDS.has(c.kind)) {
      report(`${at}.kind`, 'not-a-kind', `${at}.kind must be one of ${[...CHECK_KINDS].join(', ')}`);
    }
    // A suite check's result is a test runner's, and the runner is the runtime's to start: a pinned
    // command could be anything, and the suites counted would then be an inventory of the tree (D-R15-04).
    const suite = c.kind === 'unit' || c.kind === 'acceptance';
    const security = typeof c.kind === 'string' && SECURITY_KINDS.has(c.kind);
    if (suite && c.command !== undefined) {
      report(`${at}.command`, 'not-applicable', `${at} is a ${String(c.kind)} check, which pins no command: the runtime runs the base's test framework itself`);
    } else if (security && c.command !== undefined) {
      report(`${at}.command`, 'not-applicable', `${at} is a ${String(c.kind)} check, which pins no command: the runtime runs the scanner its image is declared for`);
    } else if (!suite && !security) commandProblems(c.command, `${at}.command`, report);
    const s = check as Partial<Record<keyof SecurityCheckSpec, unknown>>;
    if (security) securityFieldProblems(s, at, report);
    else {
      for (const field of ['image', 'config'] as const) {
        if (s[field] !== undefined) report(`${at}.${field}`, 'not-applicable', `${at}.${field} is named on a check that is not a security check`);
      }
    }
    const denies = (check as { deniesRule?: unknown }).deniesRule;
    if (denies !== undefined) {
      if (c.kind !== 'acceptance' && c.kind !== 'behavioral') {
        report(`${at}.deniesRule`, 'not-applicable', `${at}.deniesRule is named on a check that is neither an acceptance nor a behavioral check; a denial is exercised by a locked acceptance check`);
      } else if (!isNonEmptyString(denies)) report(`${at}.deniesRule`, 'empty', `${at}.deniesRule must name an authorization rule of the spec's security part`);
    }
    if (c.kind === 'acceptance') testsProblems(c.tests, `${at}.tests`, report);
    else if (c.tests !== undefined) {
      report(`${at}.tests`, 'not-applicable', `${at}.tests is named on a check that is not an acceptance check; no other kind runs named tests`);
    }
    if (typeof c.required !== 'boolean') {
      report(`${at}.required`, 'not-boolean', `${at}.required must be a boolean, not ${typeof c.required}`);
    } else if (c.required) required += 1;
    const count = c.expectedSuiteCount;
    if (c.kind === 'acceptance' && count !== undefined) {
      report(`${at}.expectedSuiteCount`, 'not-applicable', `${at}.expectedSuiteCount restates its tests: an acceptance check's runner must load every test it names`);
    } else if (count !== undefined && !(typeof count === 'number' && Number.isInteger(count) && count >= 0)) {
      report(`${at}.expectedSuiteCount`, 'not-integer', `${at}.expectedSuiteCount must be a non-negative integer when present`);
    }
    // I5: no default. A check that may pass on the base is a guard and says so; silence is not a declaration.
    const declarable = c.kind === 'acceptance' || c.kind === 'behavioral';
    if (!declarable && c.onBase !== undefined) {
      report(`${at}.onBase`, 'not-declarable', `${at}.onBase is declared on a check that is neither an acceptance nor a behavioral check; no other kind runs on the base`);
    } else if (c.kind === 'acceptance' || c.onBase !== undefined) {
      if (c.onBase !== 'fails' && c.onBase !== 'passes') {
        report(`${at}.onBase`, 'undeclared', `${at} must declare onBase as 'fails' or 'passes'; there is no default`);
      } else if (c.onBase === 'fails' && c.required === true) reproduces += 1;
    }
    // The timeout is the wall clock of the sandbox the check runs in, so it must be one (codex-7).
    const timeout = c.timeoutMs;
    if (!(typeof timeout === 'number' && Number.isInteger(timeout) && timeout > 0)) {
      report(`${at}.timeoutMs`, 'not-integer', `${at}.timeoutMs must be a positive integer of milliseconds`);
    }
  });
  if (required === 0) {
    report('manifest.checks', 'none-required', 'manifest.checks: at least one check must be required; a gate no check can fail is not a gate');
  }
  // An optional check does not hold verify's gate, so it cannot show what the change did (D-R15-01).
  if (reproduces === 0) {
    report('manifest.checks', 'none-fails-on-base', "manifest.checks: at least one required acceptance or behavioral check must declare onBase 'fails'; a run with nothing failing before the change has nothing to show the change did");
  }
}

export interface GraphBinding {
  readonly runId: RunId;
  readonly baseCommit: string;
  readonly workspace: string;
}

/**
 * The task graph, bound to its run, or the problems that keep it from being
 * one. At M1 a graph schedules `build` and `review` tasks only. A build task
 * depends only on build tasks; a review task depends on at least one build
 * task and on nothing else; every build task is covered by a review task, so
 * no work reaches `integrate` unreviewed; and the dependencies are acyclic, so
 * the graph can finish.
 */
export function parseGraph(value: unknown, bind: GraphBinding): { ok: true; graph: TaskGraph } | { ok: false; problems: RequestProblem[] } {
  const { problems, report } = collector();
  const raw = typeof value === 'object' && value !== null && 'tasks' in value ? value.tasks : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    report('graph.tasks', 'missing', 'graph.tasks must hold at least one task');
    return { ok: false, problems };
  }
  const entries: readonly unknown[] = raw;
  const ids = new Set<string>();
  const stationOf = new Map<string, string>();
  entries.forEach((entry, i) => {
    const t = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const at = `graph.tasks[${String(i)}]`;
    if (!isNonEmptyString(t.id)) report(`${at}.id`, 'empty', `${at}.id must be a non-empty string`);
    else if (ids.has(t.id)) report(`${at}.id`, 'duplicate', `${at}.id '${t.id}' is listed twice`);
    else {
      ids.add(t.id);
      if (typeof t.station === 'string') stationOf.set(t.id, t.station);
    }
    if (t.station !== 'build' && t.station !== 'review') {
      report(`${at}.station`, 'bad-station', `${at}.station must be 'build' or 'review'; M1 schedules tasks at no other station`);
    }
    if (!isNonEmptyString(t.role)) report(`${at}.role`, 'empty', `${at}.role must be a non-empty string`);
    if (!Array.isArray(t.dependsOn) || !t.dependsOn.every(isNonEmptyString)) {
      report(`${at}.dependsOn`, 'empty', `${at}.dependsOn must be a list of task ids`);
    }
    if (!Array.isArray(t.dependencySet) || t.dependencySet.length === 0 || !t.dependencySet.every(isNonEmptyString)) {
      report(`${at}.dependencySet`, 'missing', `${at}.dependencySet must name at least one glob`);
    }
  });
  if (problems.length > 0) return { ok: false, problems };

  const tasks = entries as ReadonlyArray<{ id: string; station: 'build' | 'review'; role: string; dependsOn: string[]; dependencySet: string[] }>;
  const reviewed = new Set<string>();
  tasks.forEach((t, i) => {
    const at = `graph.tasks[${String(i)}].dependsOn`;
    t.dependsOn.forEach((dep, j) => {
      const depStation = stationOf.get(dep);
      if (depStation === undefined) report(`${at}[${String(j)}]`, 'bad-dependency', `${at}[${String(j)}]: '${dep}' is not a task in the graph`);
      else if (depStation !== 'build') {
        report(`${at}[${String(j)}]`, 'bad-dependency', `${at}[${String(j)}]: '${dep}' is a ${depStation} task; tasks depend only on build tasks`);
      } else if (t.station === 'review') reviewed.add(dep);
    });
    if (t.station === 'review' && t.dependsOn.length === 0) {
      report(at, 'bad-dependency', `${at}: a review task must depend on the build task it reviews`);
    }
  });
  tasks.forEach((t, i) => {
    if (t.station === 'build' && !reviewed.has(t.id)) {
      report(`graph.tasks[${String(i)}]`, 'unreviewed', `graph.tasks[${String(i)}]: build task '${t.id}' is covered by no review task`);
    }
  });
  if (!tasks.some((t) => t.station === 'build')) report('graph.tasks', 'missing', 'graph.tasks must hold at least one build task');
  const cycle = findCycle(tasks);
  if (cycle !== undefined) report('graph.tasks', 'cycle', `graph.tasks: the dependencies cycle through ${cycle.join(' -> ')}`);
  if (problems.length > 0) return { ok: false, problems };

  const bound: Task[] = tasks.map((t) => ({
    id: t.id as TaskId,
    runId: bind.runId,
    station: t.station,
    role: t.role as RoleId,
    dependsOn: t.dependsOn.map((dep) => dep as TaskId),
    baseCommit: bind.baseCommit,
    dependencySet: [...t.dependencySet],
    worktreePath: bind.workspace,
    attempt: 1,
  }));
  const edges = bound.flatMap((task) => task.dependsOn.map((dep) => ({ from: dep, to: task.id })));
  return { ok: true, graph: { tasks: bound, edges } };
}

function findCycle(tasks: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>): string[] | undefined {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const mark = state.get(id);
    if (mark === 'done') return undefined;
    if (mark === 'visiting') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'visiting');
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const found = visit(dep);
      if (found !== undefined) return found;
    }
    path.pop();
    state.set(id, 'done');
    return undefined;
  };
  for (const t of tasks) {
    const found = visit(t.id);
    if (found !== undefined) return found;
  }
  return undefined;
}
