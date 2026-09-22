/**
 * The `AdapterSet` for one repository. Every slot is either an adapter that
 * works for this stack or `null` with the reason recorded, and
 * `unavailableControls()` names every control the set lacks — the null slots
 * and every behavioral kind it does not carry — so a stack this package
 * cannot serve is loud about it and cannot run at L3 (I5).
 */
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { CliBehavioralAdapter } from './behavioral.js';
import { IstanbulCoverageAdapter } from './coverage.js';
import { jestDiscovery, vitestDiscovery } from './discovery.js';
import { JestAdapter, VitestAdapter } from './framework.js';
import { ConfigManifestAdapter } from './manifest.js';
import { declaredRange, readPackageManifest, type PackageManifest } from './manifest-file.js';
import { AdapterRefusal } from './refusal.js';
import type { AdapterSet, BehavioralAdapter, CoverageAdapter, ManifestAdapter, MutationAdapter, TestFrameworkAdapter } from './types.js';

/** Every kind `BehavioralAdapter.kind` admits. A set missing one names it. */
export const BEHAVIORAL_KINDS: ReadonlyArray<BehavioralAdapter['kind']> = ['cli', 'http', 'browser'];

export type Control = 'test' | 'coverage' | 'mutation' | 'manifest' | `behavioral:${BehavioralAdapter['kind']}`;

export interface AdapterSetOptions {
  /** The provider CLI scenarios run through, or null to build a set with no behavioral adapter. */
  readonly provider: SandboxProvider | null;
  /** Where the coverage check's report is, or null when no coverage check has run. */
  readonly coverage: { readonly report: string; readonly sourceRoot: string } | null;
}

/**
 * The controls a set lacks, derived from its slots rather than taken from
 * its own `unavailableControls()`: a set that under-reports is still caught.
 */
export function missingControls(set: AdapterSet): Control[] {
  const missing: Control[] = [];
  if (set.test === null) missing.push('test');
  if (set.coverage === null) missing.push('coverage');
  if (set.mutation === null) missing.push('mutation');
  if (set.manifest === null) missing.push('manifest');
  const kinds = new Set(set.behavioral.map((b) => b.kind));
  for (const kind of BEHAVIORAL_KINDS) if (!kinds.has(kind)) missing.push(`behavioral:${kind}`);
  return missing;
}

export class TypeScriptAdapterSet implements AdapterSet {
  readonly stack: string;
  readonly test: TestFrameworkAdapter | null;
  readonly coverage: CoverageAdapter | null;
  /** Mutation testing is M3. */
  readonly mutation: MutationAdapter | null = null;
  readonly behavioral: BehavioralAdapter[];
  readonly manifest: ManifestAdapter | null;
  /** Why each unavailable control is unavailable, in words a maintainer can act on. */
  readonly reasons: ReadonlyMap<Control, string>;

  constructor(parts: {
    test: TestFrameworkAdapter | null;
    coverage: CoverageAdapter | null;
    behavioral: BehavioralAdapter[];
    manifest: ManifestAdapter | null;
    reasons: ReadonlyMap<Control, string>;
  }) {
    this.stack = parts.test?.stack ?? 'unsupported';
    this.test = parts.test;
    this.coverage = parts.coverage;
    this.behavioral = parts.behavioral;
    this.manifest = parts.manifest;
    this.reasons = parts.reasons;
  }

  unavailableControls(): string[] {
    return missingControls(this);
  }
}

/**
 * The test adapter, or null with the reason recorded. Every refusal on the
 * way — an unreadable package.json, a framework declared twice, a config that
 * cannot be read statically — becomes a named gap in the set rather than a
 * throw, so the set always says what it lacks; discovery runs now for the
 * same reason, rather than surprising the first caller to enumerate.
 */
async function testAdapter(root: string, manifest: PackageManifest, reasons: Map<Control, string>): Promise<TestFrameworkAdapter | null> {
  try {
    const vitest = declaredRange(manifest, 'vitest');
    const jest = declaredRange(manifest, 'jest');
    if (vitest !== undefined && jest !== undefined) {
      reasons.set('test', 'both vitest and jest are declared, and which suite is authoritative is not something to guess');
      return null;
    }
    if (vitest !== undefined) return new VitestAdapter((await vitestDiscovery(root)).rules.major);
    if (jest !== undefined) return new JestAdapter((await jestDiscovery(root)).rules.major);
  } catch (error) {
    if (!(error instanceof AdapterRefusal)) throw error;
    reasons.set('test', error.message);
    return null;
  }
  reasons.set('test', 'neither vitest nor jest is declared in package.json');
  return null;
}

/** The manifest, or null with every manifest-dependent control's reason recorded. */
async function manifestOf(root: string, reasons: Map<Control, string>): Promise<PackageManifest | null> {
  let manifest: PackageManifest | null;
  let why = 'the repository has no package.json';
  try {
    manifest = await readPackageManifest(root);
  } catch (error) {
    if (!(error instanceof AdapterRefusal)) throw error;
    manifest = null;
    why = error.message;
  }
  if (manifest === null) {
    reasons.set('test', `${why}, so no test framework is declared`);
    reasons.set('manifest', `${why}, and the config files this package knows are Node.js files`);
  }
  return manifest;
}

export async function buildAdapterSet(root: string, options: AdapterSetOptions): Promise<TypeScriptAdapterSet> {
  const reasons = new Map<Control, string>();
  const manifest = await manifestOf(root, reasons);
  const test = manifest === null ? null : await testAdapter(root, manifest, reasons);
  const hasManifest = manifest !== null;

  let coverage: CoverageAdapter | null = null;
  if (test === null) reasons.set('coverage', 'coverage is read against the test framework, and there is none for this stack');
  else if (options.coverage === null) reasons.set('coverage', 'no coverage report location was given');
  else coverage = new IstanbulCoverageAdapter({ ...options.coverage, tests: test });

  reasons.set('mutation', 'mutation testing is M3');
  const behavioral: BehavioralAdapter[] = [];
  if (options.provider === null) reasons.set('behavioral:cli', 'no sandbox provider was given to run CLI scenarios through');
  else behavioral.push(new CliBehavioralAdapter(options.provider));
  reasons.set('behavioral:http', 'HTTP scenarios need a probe the product cannot reach, which P11 delivers');
  reasons.set('behavioral:browser', 'browser scenarios are R3');

  return new TypeScriptAdapterSet({
    test,
    coverage,
    behavioral,
    manifest: hasManifest ? new ConfigManifestAdapter() : null,
    reasons,
  });
}
