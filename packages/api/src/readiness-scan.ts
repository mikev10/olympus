/**
 * Readiness reachable from the host (R35, #125): R1's scan over the host's
 * working copy at one revision, with the host's own sandbox provider, check
 * image, limits, and sandbox user, the policy's protected paths, and a GitHub
 * branch-protection checker. It writes nothing. Admission reads its ceiling
 * through `ceilingAt` (R40), which keeps each report in memory so a run sent
 * again after its cost was approved is not scanned twice (D-R40-04).
 */
import { createHash } from 'node:crypto';
import { NPM_REGISTRY, PYPI_REGISTRIES, resolveCommit, scan, SECRET_SCAN_IMAGE, type BranchProtectionChecker, type ReadinessReport } from '@olympus-ai/readiness';
import type { BuiltGraph } from './graph.js';
import type { AdmissionReadiness } from './run.js';
import { loadPolicyFile } from './policy-file.js';

/** Resolves a revision first, so a bad one is refused before a stream opens, then scans that commit. */
export interface ReadinessScanner extends AdmissionReadiness {
  resolve(revision: string): Promise<string>;
  scan(commit: string): Promise<ReadinessReport>;
}

export interface ReadinessScannerOptions {
  readonly components: BuiltGraph;
  /** The working copy runs are admitted from: `FACTORY_REPOSITORY`. Read, never written. */
  readonly repository: string;
  /** Read at each scan, as each run's admission reads it, for its protected paths. */
  readonly policyFile: string;
  readonly branchProtection: BranchProtectionChecker | null;
}

/** The wall clocks R1's own end-to-end fixture runs a real repository under. */
const TIMEOUTS = { installMs: 300_000, probeMs: 180_000, coldProvisionMs: 60_000 } as const;

export function readinessScanner(options: ReadinessScannerOptions): ReadinessScanner {
  const { profile } = options.components;
  if (profile === null) throw new Error('readiness: the host has no sandbox profile, so a scan has no image to run in');
  const scanAt = (checkout: string, commit: string, protectedPaths: readonly string[]): Promise<ReadinessReport> =>
    scan({
      checkout,
      revision: commit,
      provider: options.components.sandbox,
      // Node with npm and corepack: the image the line's checks run the stack's tools in.
      image: profile.checkImage,
      secretScanImage: SECRET_SCAN_IMAGE,
      limits: profile.limits,
      user: options.components.workspaces.user,
      timeouts: TIMEOUTS,
      registries: NPM_REGISTRY,
      pythonRegistries: PYPI_REGISTRIES,
      protectedPaths,
      branchProtection: options.branchProtection,
      });
  // Each report by checkout, commit, and protected paths: the three inputs a scan reads that a commit does not fix.
  const reports = new Map<string, ReadinessReport>();
  return {
    resolve: (revision) => resolveCommit(options.repository, revision),
    scan: async (commit) => scanAt(options.repository, commit, await protectedPathsOf(options.policyFile)),
    ceilingAt: async (checkout, commit) => {
      const protectedPaths = await protectedPathsOf(options.policyFile);
      const key = createHash('sha256').update(JSON.stringify([checkout, commit, protectedPaths])).digest('hex');
      const cached = reports.get(key);
      // Branch protection is the one input that changes under a fixed key: a hit stands only while it reads as recorded.
      if (cached !== undefined && (await protectionStands(cached, options.branchProtection))) return cached.ceiling;
      reports.delete(key);
      const report = await scanAt(checkout, commit, protectedPaths);
      reports.set(key, report);
      return report.ceiling;
    },
  };
}

async function protectedPathsOf(policyFile: string): Promise<readonly string[]> {
  const loaded = await loadPolicyFile(policyFile);
  // No policy, no protected paths to probe against: refused rather than scanned against none (I5).
  if (!loaded.ok) throw new Error(`readiness: the policy file is refused (${loaded.code}): ${loaded.message}`);
  return loaded.policy.protectedPaths;
}

/**
 * Whether a cached report's branch-protection probe still reads as it did:
 * the checker answers now as the probe recorded it. A checker that fails, or
 * a probe the report holds no answer for, does not stand, and the commit is
 * scanned again (I5).
 */
export async function protectionStands(report: ReadinessReport, checker: BranchProtectionChecker | null): Promise<boolean> {
  const probe = report.probes.find((p) => p.probe === 'integrate.branch-protection');
  if (probe === undefined) return false;
  if (checker === null) return probe.outcome === 'indeterminate';
  if (probe.outcome === 'indeterminate') return false;
  try {
    const answer = await checker.check();
    return answer.protected === (probe.outcome === 'supported');
  } catch {
    return false;
  }
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/**
 * Whether GitHub protects the integration branch: the `protected` field of
 * `GET /repos/{owner}/{repo}/branches/{branch}`, which read access answers.
 * Any other answer throws, which the probe records as indeterminate (I5).
 */
export class GitHubBranchProtection implements BranchProtectionChecker {
  readonly name: string;
  readonly #url: string;
  readonly #token: string;

  constructor(options: { readonly repository: string; readonly branch: string; readonly token: string; readonly apiBase?: string }) {
    if (!REPOSITORY.test(options.repository)) throw new Error(`readiness: ${options.repository} is not owner/name`);
    if (options.branch === '' || options.token === '') throw new Error('readiness: a branch-protection checker needs a branch and a token');
    this.name = `github:${options.repository}@${options.branch}`;
    this.#url = `${(options.apiBase ?? 'https://api.github.com').replace(/\/+$/u, '')}/repos/${options.repository}/branches/${encodeURIComponent(options.branch)}`;
    this.#token = options.token;
  }

  async check(): Promise<{ readonly protected: boolean; readonly detail: string }> {
    const res = await fetch(this.#url, {
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`GitHub answered ${String(res.status)} for ${this.name}`);
    const body: unknown = await res.json();
    const value = typeof body === 'object' && body !== null ? (body as { protected?: unknown }).protected : undefined;
    if (typeof value !== 'boolean') throw new Error(`GitHub's answer for ${this.name} has no protected field`);
    return { protected: value, detail: value ? `${this.name} is a protected branch` : `${this.name} is not protected` };
  }
}
