/**
 * Execution reconciliation (`I8.external-assertion-execution-reconciled`).
 *
 * An `ExternalAssertion` is a claim with three parts: a package, a file, and
 * an assertion id. Until this module existed the registry could only check
 * that all three were *present* — the package exists, the file exists, the
 * file quotes the id — and presence is satisfied by a comment, a skipped
 * test, or a test that runs and fails. So the registry refused every external
 * assertion rather than count one on that evidence.
 *
 * What it checks now is that the test ran and passed, read from the report the
 * owning package's own suite wrote (`run-report.ts`), bound to the tree by a
 * content hash. Every way that can fail is its own refusal with its own
 * message, because "not reconciled" collapses a missing report and a failing
 * test into one word and the two call for different work.
 *
 * Fail closed (I5). Nothing here has a fallback: a report that is absent, from
 * another tree, from another package, or written by a kit that did not know a
 * field this one needs is a refusal, never a reason to accept the assertion on
 * weaker evidence.
 */
import { RUN_REPORT_PATH, RUN_REPORT_VERSION, packageTreeHash, readRunReport } from './run-report.js';
import type { ExternalAssertion } from './types.js';
import { workspacePackages, type WorkspacePackage } from './workspace.js';

/**
 * Why an external assertion was not accepted. The five the P5 acceptance
 * criteria name are `report-missing`, `tree-changed`, `id-not-run`,
 * `test-skipped`, and `test-failed`; the rest are structural defects in the
 * registry record or the report itself, which are worth telling apart from a
 * test that simply did not pass.
 */
export type ReconciliationRefusal =
  | 'package-unknown'
  | 'report-missing'
  | 'report-version'
  | 'report-foreign'
  | 'tree-changed'
  | 'tree-moved-during-run'
  | 'title-mismatch'
  | 'id-not-run'
  | 'file-mismatch'
  | 'test-skipped'
  | 'test-failed'
  | 'test-incomplete';

export interface ReconciliationAccepted {
  readonly ok: true;
  /** Package and file the passing test actually ran in. */
  readonly ranIn: string;
}

export interface ReconciliationRefused {
  readonly ok: false;
  readonly refusal: ReconciliationRefusal;
  /** One line, naming the id, what was looked for, and what was found. */
  readonly detail: string;
}

export type ReconciliationVerdict = ReconciliationAccepted | ReconciliationRefused;

export interface ReconcileOptions {
  /** The workspace packages to resolve names against. Default: the real workspace. */
  readonly packages?: readonly WorkspacePackage[];
}

function refuse(refusal: ReconciliationRefusal, detail: string): ReconciliationRefused {
  return { ok: false, refusal, detail };
}

/**
 * Whether the owning package ran this assertion and it passed.
 *
 * The tree hash is recomputed here rather than trusted from the report: a
 * report carries the hash of the tree it was written from, and comparing it
 * against the tree as it is now is the whole of the freshness check. Edit a
 * source file after the run and the two differ, which is a refusal and not an
 * approximation of one.
 */
export function reconcileExternalAssertion(
  assertion: ExternalAssertion,
  options: ReconcileOptions = {},
): ReconciliationVerdict {
  const packages = options.packages ?? workspacePackages();
  const pkg = packages.find((p) => p.name === assertion.package);
  if (pkg === undefined) {
    return refuse(
      'package-unknown',
      `${assertion.id}: no workspace package named ${assertion.package}; the registry points at a package that does not exist`,
    );
  }

  const report = readRunReport(pkg.dir);
  if (report === undefined) {
    return refuse(
      'report-missing',
      `${assertion.id}: ${assertion.package} has no ${RUN_REPORT_PATH}. Run that package's tests (pnpm test) before the registry; `
        + 'an assertion nobody ran is not coverage',
    );
  }
  if (report.version !== RUN_REPORT_VERSION) {
    return refuse(
      'report-version',
      `${assertion.id}: ${assertion.package} wrote a version ${String(report.version)} report and this kit reads version `
        + `${String(RUN_REPORT_VERSION)}; run that package's tests again`,
    );
  }
  if (report.package !== assertion.package) {
    return refuse(
      'report-foreign',
      `${assertion.id}: ${RUN_REPORT_PATH} under ${assertion.package} says it was written by ${report.package}`,
    );
  }

  const current = packageTreeHash(pkg.dir);
  if (current !== report.treeHash) {
    return refuse(
      'tree-changed',
      `${assertion.id}: ${assertion.package} has changed since its tests ran (report ${report.treeHash.slice(0, 12)}, `
        + `tree ${current.slice(0, 12)}); the report is evidence about other bytes than the ones being evaluated`,
    );
  }

  // The inputs did not move while the run was happening. A report whose two
  // hashes disagree describes results from one tree carrying the identity of
  // another, and neither is evidence about the tree in front of us.
  if (report.startedFromHash !== report.treeHash) {
    return refuse(
      'tree-moved-during-run',
      `${assertion.id}: ${assertion.package} started its run against ${report.startedFromHash.slice(0, 12)} and ended against `
        + `${report.treeHash.slice(0, 12)}; the source changed while the tests were running, so the results belong to neither tree`,
    );
  }

  const carrying = report.tests.filter((t) => t.id === assertion.id);
  if (carrying.length === 0) {
    return refuse(
      'id-not-run',
      `${assertion.id}: ${assertion.package} ran ${String(report.tests.length)} assertion test(s) and none carried this id. `
        + 'A file that quotes an id has not run it',
    );
  }

  const notPassed = carrying.find((t) => t.state !== 'passed');
  if (notPassed !== undefined) {
    const refusal: ReconciliationRefusal =
      notPassed.state === 'skipped' ? 'test-skipped' : notPassed.state === 'failed' ? 'test-failed' : 'test-incomplete';
    return refuse(
      refusal,
      `${assertion.id}: ${assertion.package} reported '${notPassed.name}' as ${notPassed.state} in ${notPassed.module}`,
    );
  }

  const inNamedFile = carrying.find((t) => t.module === assertion.file);
  if (inNamedFile === undefined) {
    const ran = [...new Set(carrying.map((t) => t.module))].join(', ');
    return refuse(
      'file-mismatch',
      `${assertion.id}: the registry says ${assertion.package} ${assertion.file}, and it passed in ${ran}`,
    );
  }

  // The test that passed is the assertion the registry registered, not merely
  // a passing test whose name carries the id. Matching on the id alone proved
  // "a test in this file quoted this id", which `test('[driver.hooks] x', () =>
  // {})` satisfies, and so does any test nested under a describe block named
  // for the id. The name `invariantTest` builds is `[id] title`, so requiring
  // it binds the report to the registry's own words -- and a title that drifts
  // between the two is then a refusal rather than a silent divergence.
  const expected = `[${assertion.id}] ${assertion.title}`;
  if (inNamedFile.name !== expected) {
    return refuse(
      'title-mismatch',
      `${assertion.id}: the registry registers '${expected}' and ${assertion.package} reported '${inNamedFile.name}'. `
        + 'A passing test carrying the id is not the assertion unless it is the one the registry names',
    );
  }

  return { ok: true, ranIn: `${assertion.package} ${inNamedFile.module}` };
}
