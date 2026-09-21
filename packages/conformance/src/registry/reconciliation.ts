/**
 * Support for `I8.external-assertion-execution-reconciled`.
 *
 * The mechanism under test decides whether an assertion that lives in another
 * package's suite counts. Proving it needs a package with a run report, so
 * this builds one in a temporary directory rather than asserting against a
 * real sibling: a real package's report exists only after its tests ran, and
 * an assertion that passed or failed depending on whether someone had run
 * another suite first would prove nothing either way.
 *
 * Every case is a refusal except the first. That is the point of the entry:
 * before it, a package, a file, and a quoted id were all the registry could
 * see, and every one of them is satisfied by a test that never ran.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { external } from '../kit/assert.js';
import { reconcileExternalAssertion, type ReconciliationRefusal } from '../kit/reconcile.js';
import {
  RUN_REPORT_VERSION,
  packageTreeHash,
  writeRunReport,
  type ConformanceRunReport,
  type ReportedTest,
  type ReportedTestState,
} from '../kit/run-report.js';
import type { ExternalAssertion, WorkspacePackage } from '../index.js';

const PACKAGE_NAME = '@olympus-ai/reconciliation-fixture';
const TEST_FILE = 'test/live.test.ts';
const ASSERTION_ID = 'I8.fixture-assertion';
const ASSERTION_TITLE = 'a fixture assertion, registered as living in another package';

const ASSERTION: ExternalAssertion = external({
  id: ASSERTION_ID,
  title: ASSERTION_TITLE,
  level: 'runtime',
  package: PACKAGE_NAME,
  file: TEST_FILE,
});

function passingTest(overrides: Partial<ReportedTest> = {}): ReportedTest {
  return {
    id: ASSERTION_ID,
    name: `[${ASSERTION_ID}] ${ASSERTION_TITLE}`,
    state: 'passed',
    module: TEST_FILE,
    ...overrides,
  };
}

interface FixturePackage {
  readonly dir: string;
  readonly entry: WorkspacePackage;
  /** Writes a report whose tree hash is the tree as it stands now. */
  report: (tests: readonly ReportedTest[], overrides?: Partial<ConformanceRunReport>) => void;
}

async function withFixturePackage(body: (pkg: FixturePackage) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'conformance-reconcile-'));
  try {
    await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: PACKAGE_NAME, private: true }, null, 2)}\n`, 'utf8');
    mkdirSync(join(dir, 'test'), { recursive: true });
    await writeFile(join(dir, TEST_FILE), `invariantTest('${ASSERTION_ID}', '${ASSERTION_TITLE}', () => undefined);\n`, 'utf8');
    const entry: WorkspacePackage = {
      name: PACKAGE_NAME,
      dir,
      relativeDir: 'tmp/reconciliation-fixture',
      main: undefined,
      types: undefined,
      entry: undefined,
      isPrivate: true,
    };
    await body({
      dir,
      entry,
      report: (tests, overrides = {}) => {
        writeRunReport(dir, {
          version: RUN_REPORT_VERSION,
          package: PACKAGE_NAME,
          startedFromHash: packageTreeHash(dir),
          treeHash: packageTreeHash(dir),
          generatedAt: new Date().toISOString(),
          tests,
          ...overrides,
        });
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function requireAccepted(pkg: FixturePackage, because: string): void {
  const verdict = reconcileExternalAssertion(ASSERTION, { packages: [pkg.entry] });
  if (!verdict.ok) {
    throw new Error(`I8: ${because} was refused as ${verdict.refusal}: ${verdict.detail}`);
  }
  const expected = `${PACKAGE_NAME} ${TEST_FILE}`;
  if (verdict.ranIn !== expected) {
    throw new Error(`I8: reconciliation accepted the assertion but reported it ran in '${verdict.ranIn}', not '${expected}'`);
  }
}

function requireRefused(
  packages: readonly WorkspacePackage[],
  expected: ReconciliationRefusal,
  because: string,
): void {
  const verdict = reconcileExternalAssertion(ASSERTION, { packages });
  if (verdict.ok) {
    throw new Error(`I8: ${because} was accepted; an assertion nobody ran and passed is not coverage`);
  }
  if (verdict.refusal !== expected) {
    throw new Error(`I8: ${because} was refused as '${verdict.refusal}', expected '${expected}': ${verdict.detail}`);
  }
  if (!verdict.detail.includes(ASSERTION_ID)) {
    throw new Error(`I8: the refusal for ${because} does not name the assertion: ${verdict.detail}`);
  }
}

/** Throws unless reconciliation accepts exactly the passing case and refuses each other one by its own name. */
export async function assertReconciliationRefuses(): Promise<void> {
  await withFixturePackage(async (pkg) => {
    const only = [pkg.entry];

    requireRefused(only, 'report-missing', 'a package that never ran its tests');

    pkg.report([passingTest()]);
    requireAccepted(pkg, 'a test that ran and passed in the file the registry names');

    requireRefused([], 'package-unknown', 'an assertion pointing at a package the workspace does not have');

    pkg.report([passingTest({ id: 'I8.some-other-assertion', name: '[I8.some-other-assertion] other' })]);
    requireRefused(only, 'id-not-run', 'a report in which no test carries the id');

    for (const state of ['skipped', 'failed', 'pending'] as const) {
      const expected: ReconciliationRefusal =
        state === 'skipped' ? 'test-skipped' : state === 'failed' ? 'test-failed' : 'test-incomplete';
      pkg.report([passingTest({ state: state satisfies ReportedTestState })]);
      requireRefused(only, expected, `a test reported as ${state}`);
    }

    pkg.report([passingTest({ module: 'test/somewhere-else.test.ts' })]);
    requireRefused(only, 'file-mismatch', 'a passing test in a file other than the one the registry names');

    pkg.report([passingTest()], { package: '@olympus-ai/someone-else' });
    requireRefused(only, 'report-foreign', 'a report claiming to come from another package');

    pkg.report([passingTest()], { version: RUN_REPORT_VERSION + 1 });
    requireRefused(only, 'report-version', 'a report written to a shape this kit does not read');

    // Last, because it changes the tree every earlier case depended on: a
    // passing report, then a source edit, and the report is evidence about
    // bytes that are no longer there.
    pkg.report([passingTest()]);
    requireAccepted(pkg, 'a freshly reported passing test');
    await writeFile(join(pkg.dir, TEST_FILE), '// the assertion was deleted after the report was written\n', 'utf8');
    requireRefused(only, 'tree-changed', 'a report written before the package was edited');
  });

  // A test whose name carries the id but is not the registered assertion. The
  // id alone proved only that some passing test in the file quoted it, which a
  // one-line tautology satisfies; the registry's own title is what makes the
  // report point at the assertion rather than at a name.
  await withFixturePackage(async (pkg) => {
    const only = [pkg.entry];
    pkg.report([passingTest({ name: `[${ASSERTION_ID}] coverage` })]);
    await Promise.resolve();
    requireRefused(only, 'title-mismatch', 'a passing test carrying the id under a different title');
  });

  // A run whose inputs moved while it was running. The results belong to the
  // tree it started against and the hash to the tree it ended against, so the
  // report is evidence about neither.
  await withFixturePackage(async (pkg) => {
    const only = [pkg.entry];
    pkg.report([passingTest()], { startedFromHash: 'a-tree-that-is-not-this-one' });
    await Promise.resolve();
    requireRefused(only, 'tree-moved-during-run', 'a run whose source changed between its start and its end');
  });
}
