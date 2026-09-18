/**
 * The vitest reporter that writes a package's conformance run report.
 *
 * A package contributing external assertions names this in its
 * `vitest.config.ts`:
 *
 *     import { ConformanceRunReporter } from '@olympus-ai/conformance';
 *     export default defineConfig({ test: { reporters: ['default', new ConformanceRunReporter()] } });
 *
 * A reporter rather than a wrapper around the test command, for two reasons.
 * It runs in-process at the end of every run, passing or failing, so a failing
 * suite overwrites its own last passing report instead of leaving one behind
 * to vouch for it. And `vitest.config.*` is a protected path, so adding it to
 * a package is a change the gate check makes someone acknowledge — which is
 * the point, since this file decides whether an assertion counts.
 *
 * Types are imported from `vitest/node` for the shape only; nothing from
 * vitest is loaded at run time by this module.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestModule } from 'vitest/node';
import {
  RUN_REPORT_VERSION,
  assertionIdInName,
  packageTreeHash,
  writeRunReport,
  type ConformanceRunReport,
  type ReportedTest,
  type ReportedTestState,
} from './run-report.js';

export interface ConformanceRunReporterOptions {
  /** The package root. Default: `process.cwd()`, which is where vitest runs a package's suite. */
  readonly packageDir?: string;
}

/** package.json `name` at `dir`; throws when there is none, because a report must say who ran. */
function packageName(dir: string): string {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) {
    throw new Error(`conformance: no package.json at ${dir}; the run reporter needs the package name`);
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const name: unknown = typeof parsed === 'object' && parsed !== null && 'name' in parsed ? parsed.name : undefined;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`conformance: ${file} has no name; the run reporter needs the package name`);
  }
  return name;
}

export class ConformanceRunReporter implements Reporter {
  private readonly packageDir: string;

  constructor(options: ConformanceRunReporterOptions = {}) {
    this.packageDir = options.packageDir ?? process.cwd();
  }

  onTestRunEnd(testModules: readonly TestModule[]): void {
    const tests: ReportedTest[] = [];
    for (const module of testModules) {
      for (const test of module.children.allTests()) {
        const id = assertionIdInName(test.fullName);
        if (id === undefined) continue;
        tests.push({
          id,
          name: test.fullName,
          state: test.result().state satisfies ReportedTestState,
          module: module.relativeModuleId,
        });
      }
    }
    const report: ConformanceRunReport = {
      version: RUN_REPORT_VERSION,
      package: packageName(this.packageDir),
      // Hashed after the run, so a test that wrote into its own package tree
      // invalidates the report it is part of rather than being blessed by it.
      treeHash: packageTreeHash(this.packageDir),
      generatedAt: new Date().toISOString(),
      tests,
    };
    writeRunReport(this.packageDir, report);
  }
}
