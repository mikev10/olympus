/**
 * The run report and the reporter that writes it: the evidence side of
 * execution reconciliation. `kit/reconcile.ts` decides what to do with a
 * report; these tests are about the report being right in the first place.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { ConformanceRunReporter } from '../../src/kit/reporter.js';
import {
  RUN_REPORT_DIR,
  RUN_REPORT_VERSION,
  assertionIdInName,
  packageTreeHash,
  readRunReport,
  runReportFile,
  writeRunReport,
} from '../../src/kit/run-report.js';
import type { TestModule } from 'vitest/node';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'conformance-run-report-'));
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: '@olympus-ai/sample' })}\n`);
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, RUN_REPORT_DIR), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('assertionIdInName', () => {
  test('reads the id out of a name invariantTest wrote', () => {
    expect(assertionIdInName('[I1.mount-rejects-second-rw] a second rw mount is refused')).toBe('I1.mount-rejects-second-rw');
    expect(assertionIdInName('suite > [driver.hooks] a hook fires')).toBe('driver.hooks');
  });
  test('is undefined for a name carrying no id, so an ordinary test never lands in the report', () => {
    expect(assertionIdInName('a plain test name')).toBeUndefined();
    expect(assertionIdInName('an [empty] bracket is not an id')).toBe('empty');
  });
});

describe('packageTreeHash', () => {
  test('is stable across calls on an unchanged tree', () => {
    expect(packageTreeHash(dir)).toBe(packageTreeHash(dir));
  });

  test('changes when a file changes', () => {
    const before = packageTreeHash(dir);
    writeFileSync(join(dir, 'src', 'index.ts'), 'export const value = 2;\n');
    expect(packageTreeHash(dir)).not.toBe(before);
  });

  test('changes when a file is renamed, though the bytes are the same', () => {
    // Content alone would collide here, which is why the path is hashed too:
    // deleting the file an assertion lives in must not leave the hash intact.
    const before = packageTreeHash(dir);
    const text = readFileSync(join(dir, 'src', 'index.ts'), 'utf8');
    rmSync(join(dir, 'src', 'index.ts'));
    writeFileSync(join(dir, 'src', 'renamed.ts'), text);
    expect(packageTreeHash(dir)).not.toBe(before);
  });

  test('ignores the report directory, so writing a report does not invalidate the hash it carries', () => {
    const before = packageTreeHash(dir);
    writeRunReport(dir, {
      version: RUN_REPORT_VERSION,
      package: '@olympus-ai/sample',
      startedFromHash: before,
      treeHash: before,
      generatedAt: new Date().toISOString(),
      tests: [],
    });
    expect(packageTreeHash(dir)).toBe(before);
  });

  test('ignores dependencies and build output', () => {
    const before = packageTreeHash(dir);
    mkdirSync(join(dir, 'node_modules', 'left-pad'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n');
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.js'), 'export const value = 1;\n');
    writeFileSync(join(dir, 'tsconfig.tsbuildinfo'), '{}');
    expect(packageTreeHash(dir)).toBe(before);
  });
});

describe('readRunReport', () => {
  test('is undefined when the package never ran', () => {
    expect(readRunReport(dir)).toBeUndefined();
  });

  test('round-trips what was written', () => {
    const report = {
      version: RUN_REPORT_VERSION,
      package: '@olympus-ai/sample',
      startedFromHash: 'abc',
      treeHash: 'abc',
      generatedAt: '2026-01-01T00:00:00.000Z',
      tests: [{ id: 'I1.x', name: '[I1.x] a title', state: 'passed' as const, module: 'test/x.test.ts' }],
    };
    writeRunReport(dir, report);
    expect(readRunReport(dir)).toEqual(report);
  });

  test('throws on a report missing fields, rather than reading it as an absence', () => {
    // An absent report means "did not run" and a malformed one means "someone
    // broke the reporter". Collapsing the two would hide the second.
    writeFileSync(runReportFile(dir), JSON.stringify({ version: RUN_REPORT_VERSION, package: '@olympus-ai/sample' }));
    expect(() => readRunReport(dir)).toThrow('missing fields');
  });

  test('throws on a test recorded in a state vitest does not report', () => {
    writeFileSync(
      runReportFile(dir),
      JSON.stringify({
        version: RUN_REPORT_VERSION,
        package: '@olympus-ai/sample',
        startedFromHash: 'abc',
        treeHash: 'abc',
        generatedAt: '2026-01-01T00:00:00.000Z',
        tests: [{ id: 'I1.x', name: '[I1.x] a title', state: 'probably-fine', module: 'test/x.test.ts' }],
      }),
    );
    expect(() => readRunReport(dir)).toThrow("unknown state 'probably-fine'");
  });
});

/**
 * A stand-in for the shape the reporter reads off vitest: the modules it is
 * handed, each with the tests it collected and how each ended. Cast because
 * TestModule is a class vitest constructs; only these members are touched.
 */
function fakeModule(relativeModuleId: string, cases: ReadonlyArray<{ name: string; state: string }>): TestModule {
  return {
    relativeModuleId,
    children: {
      allTests: function* () {
        for (const c of cases) yield { fullName: c.name, result: () => ({ state: c.state }) };
      },
    },
  } as unknown as TestModule;
}

describe('ConformanceRunReporter', () => {
  test('records every test carrying an assertion id, with the file and the state, and skips the rest', () => {
    new ConformanceRunReporter({ packageDir: dir }).onTestRunEnd([
      fakeModule('test/live.test.ts', [
        { name: '[driver.hooks] a hook fires', state: 'passed' },
        { name: 'an ordinary test', state: 'passed' },
      ]),
      fakeModule('test/other.test.ts', [{ name: '[driver.mcp] only the named servers', state: 'failed' }]),
    ]);

    const report = readRunReport(dir);
    expect(report?.package).toBe('@olympus-ai/sample');
    expect(report?.treeHash).toBe(packageTreeHash(dir));
    expect(report?.tests).toEqual([
      { id: 'driver.hooks', name: '[driver.hooks] a hook fires', state: 'passed', module: 'test/live.test.ts' },
      { id: 'driver.mcp', name: '[driver.mcp] only the named servers', state: 'failed', module: 'test/other.test.ts' },
    ]);
  });

  test('a failing run overwrites the report a passing run left, so a stale pass cannot vouch for it', () => {
    const reporter = new ConformanceRunReporter({ packageDir: dir });
    reporter.onTestRunEnd([fakeModule('test/live.test.ts', [{ name: '[driver.hooks] a hook fires', state: 'passed' }])]);
    reporter.onTestRunEnd([fakeModule('test/live.test.ts', [{ name: '[driver.hooks] a hook fires', state: 'failed' }])]);
    expect(readRunReport(dir)?.tests[0]?.state).toBe('failed');
  });

  test('refuses to write a report for a directory that is not a package', () => {
    const notAPackage = mkdtempSync(join(tmpdir(), 'conformance-not-a-package-'));
    try {
      expect(() => {
        new ConformanceRunReporter({ packageDir: notAPackage }).onTestRunEnd([]);
      }).toThrow('no package.json');
    } finally {
      rmSync(notAPackage, { recursive: true, force: true });
    }
  });
});
