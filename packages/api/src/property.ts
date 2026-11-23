/**
 * Property checks on the line (R25). The base's test framework runs the
 * locked property files, as it runs acceptance tests. Ahead of it the runtime
 * loads its own preload, written by the base set's property adapter, which
 * pins the seed and the case count and reports every run. The verdict is the
 * runtime's comparison of those reports against the pin and against every
 * registration the adapter found statically, and it is carried as the
 * result's `expectation`: what the check observed, compared with what it
 * was expected to observe (A-P8-01, D-R25-02).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAdapterSet, type PropertyAdapter, type PropertyPin, type PropertySite } from '@olympus-ai/adapters';
import type { BaseMismatch } from '@olympus-ai/core';
import type { CheckResult, CheckSpec, ExpectationMismatch, ExpectationOutcome, PropertyCheckSpec, PropertyEvidence, PropertyRun } from '@olympus-ai/integrity';
import type { RequestProblem } from './validate.js';

/** Where the preload's directory is mounted in a property check's sandbox: read-only, beside the tree and never in it. */
export const PROPERTY_MOUNT = '/property-preload';
const PRELOAD = 'preload.mjs';

/** The base's property framework, or null where its stack has none. Read from the base, which no task wrote. */
export async function propertyAdapterOf(base: string): Promise<PropertyAdapter | null> {
  try {
    return (await buildAdapterSet(base, { provider: null, coverage: null })).property;
  } catch {
    return null;
  }
}

/** Everything one property check's run needs beyond a suite check's: the mount, the environment, the pin, and what must report. */
export interface PreparedProperty {
  readonly adapter: PropertyAdapter;
  readonly pin: PropertyPin;
  readonly sites: readonly PropertySite[];
  readonly mount: { readonly source: string; readonly target: string; readonly mode: 'ro' };
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Writes the preload for `check` under `scratch`, a directory of the run's
 * that is not the Vault, and reads the registrations from `tree`. Admission
 * refused a check with no adapter or no registration, so either here is a
 * base or a tree that has changed since, and the check does not start.
 */
export async function prepareProperty(base: string, tree: string, check: PropertyCheckSpec, scratch: string): Promise<{ ok: true; prepared: PreparedProperty } | { ok: false; reason: string }> {
  const adapter = await propertyAdapterOf(base);
  if (adapter === null) return { ok: false, reason: `the base's stack has no property framework, so property check ${check.id} has nothing to pin its runs with` };
  let sites: PropertySite[];
  try {
    sites = await registrationsIn(adapter, tree, check.tests);
  } catch (error) {
    return { ok: false, reason: `property check ${check.id}'s files could not be read: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (sites.length === 0) return { ok: false, reason: `property check ${check.id}'s files register no property with ${adapter.framework}` };
  // A fresh marker per run, so no line a test printed by chance reads as a report.
  const pin: PropertyPin = { seed: check.seed, numRuns: check.numRuns, marker: randomBytes(16).toString('hex') };
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  await writeFile(join(scratch, PRELOAD), adapter.preload(pin, check.tests));
  return {
    ok: true,
    prepared: { adapter, pin, sites, mount: { source: scratch, target: PROPERTY_MOUNT, mode: 'ro' }, env: adapter.environment(`${PROPERTY_MOUNT}/${PRELOAD}`) },
  };
}

/** Every registration in the named files of `tree`, in file then line order. */
async function registrationsIn(adapter: PropertyAdapter, tree: string, tests: readonly string[]): Promise<PropertySite[]> {
  const sites: PropertySite[] = [];
  for (const test of tests) sites.push(...(await adapter.registrations(join(tree, ...test.split('/')), test)));
  return sites;
}

/** What a property check's process showed: its evidence, read from the reports, and the runtime's comparison of it against the pin. */
export function propertyResult(prepared: PreparedProperty, exec: { readonly exitCode: number; readonly stdout: string }): Pick<CheckResult, 'property' | 'expectation'> {
  const runs = prepared.adapter.reports(exec.stdout, prepared.pin);
  const property: PropertyEvidence | null = runs === null ? null : { seed: prepared.pin.seed, numRuns: prepared.pin.numRuns, runs };
  return { property, expectation: propertyOutcome(prepared.pin, prepared.sites, exec.exitCode, property) };
}

const siteKey = (file: string, line: number): string => `${file}:${String(line)}`;

/**
 * The comparison (D-R25-02). It holds only when all of these are true:
 * - the process exited 0;
 * - its reports could be read;
 * - every registration reported at least once;
 * - every report sits at a registration;
 * - every report ran on the pinned seed;
 * - no report failed;
 * - every report ran at least the pinned cases.
 * Each way it fails is named, so the evidence says which.
 */
export function propertyOutcome(pin: Pick<PropertyPin, 'seed' | 'numRuns'>, sites: readonly PropertySite[], exitCode: number, evidence: PropertyEvidence | null): ExpectationOutcome {
  const mismatches: ExpectationMismatch[] = [];
  if (exitCode !== 0) mismatches.push({ field: 'exitCode', expected: '0', observed: String(exitCode) });
  if (evidence === null) {
    mismatches.push({ field: 'reports', expected: 'every report readable', observed: 'a report that could not be read' });
  } else {
    const registered = new Set(sites.map((s) => siteKey(s.file, s.line)));
    const reported = new Map<string, PropertyRun[]>();
    for (const run of evidence.runs) {
      const key = siteKey(run.file, run.line);
      if (!registered.has(key)) {
        mismatches.push({ field: 'reports', expected: 'each run at a registration in a locked file', observed: run.file === '' ? 'a run in no locked file' : `a run at ${key}, which registers no property` });
        continue;
      }
      reported.set(key, [...(reported.get(key) ?? []), run]);
    }
    for (const site of sites) {
      const key = siteKey(site.file, site.line);
      const runs = reported.get(key);
      if (runs === undefined) {
        mismatches.push({ field: key, expected: `${String(pin.numRuns)} cases on seed ${String(pin.seed)}`, observed: 'no report' });
        continue;
      }
      for (const run of runs) {
        if (run.seed !== pin.seed) mismatches.push({ field: `${key}.seed`, expected: String(pin.seed), observed: String(run.seed) });
        if (run.failed) mismatches.push({ field: `${key}.failed`, expected: 'false', observed: `failed after ${String(run.casesRun)} cases, counterexample ${run.counterexample ?? 'unprinted'}` });
        else if (run.casesRun < pin.numRuns) mismatches.push({ field: `${key}.casesRun`, expected: `at least ${String(pin.numRuns)}`, observed: String(run.casesRun) });
      }
    }
  }
  const [first, ...rest] = mismatches;
  return first === undefined ? { held: true } : { held: false, mismatches: [first, ...rest] };
}

/**
 * Whether a property check did on the base what it declared, or how it did
 * not. `passes` is met only when the comparison held. `fails` is met only
 * by a run that failed on the pinned seed at a registration: a check that
 * exited non-zero because nothing ran did not fail (I5). A suite count below
 * the named files is `suite-count`, as for any suite check.
 */
export function propertyBaseCause(check: PropertyCheckSpec, result: CheckResult): BaseMismatch['cause'] | undefined {
  const outcome = result.expectation;
  if (check.onBase === 'passes') {
    if (outcome?.held === true) return undefined;
    return result.property?.runs.some((r) => r.failed) === true ? 'contrary' : 'suite-count';
  }
  const failed = result.property?.runs.some((r) => r.failed && r.seed === check.seed && r.file !== '') === true;
  if (failed) return undefined;
  return outcome?.held === true ? 'contrary' : 'no-result';
}

/**
 * Why the property checks cannot be admitted over the base (R25, I5):
 * - a property check on a base whose stack has no property framework;
 * - a named file that cannot be read;
 * - a file that registers no property;
 * - a file with two registrations on one line, which no report could tell apart.
 */
export async function propertyAdmissionProblems(checks: readonly CheckSpec[], base: string): Promise<RequestProblem[]> {
  const problems: RequestProblem[] = [];
  const pinned = checks.flatMap((check, i) => (check.kind === 'property' ? [{ check, at: `manifest.checks[${String(i)}]` }] : []));
  if (pinned.length === 0) return problems;
  const adapter = await propertyAdapterOf(base);
  for (const { check, at } of pinned) {
    if (adapter === null) {
      problems.push({ path: `${at}.kind`, code: 'unbound', message: `${at} is a property check, and the base's stack has no property framework to pin its runs; a property check needs fast-check 4 declared beside vitest 4` });
      continue;
    }
    for (const [j, test] of check.tests.entries()) {
      const one = `${at}.tests[${String(j)}]`;
      let sites: PropertySite[];
      try {
        sites = await adapter.registrations(join(base, ...test.split('/')), test);
      } catch (error) {
        problems.push({ path: one, code: 'unbound', message: `${one}: '${test}' cannot be read for its properties: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      if (sites.length === 0) {
        problems.push({ path: one, code: 'no-property', message: `${one}: '${test}' registers no property with ${adapter.framework}, so the check would run no case` });
        continue;
      }
      const lines = sites.map((s) => s.line);
      const shared = [...new Set(lines.filter((line, k) => lines.indexOf(line) !== k))];
      if (shared.length > 0) {
        problems.push({ path: one, code: 'unbound', message: `${one}: '${test}' registers two properties on line ${shared.join(', ')}, and a report is located by line` });
      }
    }
  }
  return problems;
}
