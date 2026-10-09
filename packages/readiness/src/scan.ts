/**
 * One scan: one repository, one commit, every probe, one ceiling.
 *
 * The commit's tree is copied to a directory the scan owns (`tree.ts`), and
 * every executed probe runs in a fresh sandbox over that copy and nothing
 * else: no other mount, so no Vault (I1), and no network except the install,
 * which reaches the package registries named and no other host. The target
 * repository is read through git and never written (R1 §5).
 *
 * A probe the sandbox stopped — a timeout, an output overrun, a provisioning
 * failure — is `indeterminate`, and derives as `absent` (I5).
 */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAdapterSet, JestAdapter, VitestAdapter, type AdapterSet } from '@olympus-ai/adapters';
import type { EgressPolicy, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import picomatch from 'picomatch';
import { deriveCeiling } from './derive.js';
import { PROBES } from './probes.js';
import { materialize, resolveCommit } from './tree.js';
import type { ProbeEvidence, ProbeId, ProbeOutcome, ProbeResult, ReadinessCeiling, ReadinessReport } from './types.js';

/** gitleaks 8.21.2, pinned by digest so a scan's secret probe is the one its report names. */
export const SECRET_SCAN_IMAGE = 'zricethezav/gitleaks@sha256:0e99e8821643ea5b235718642b93bb32486af9c8162c8b8731f7cbdc951a7f46';

/** The public npm registry, the one host an install reaches unless the caller names others. */
export const NPM_REGISTRY: readonly string[] = ['registry.npmjs.org'];

/** The readiness term for a repository no scan has run on: explicit, never `undefined` (I4). */
export const NOT_SCANNED: ReadinessCeiling = { kind: 'not-scanned' };

/**
 * Whether the integration branch is protected. A fact that lives with the
 * host, not in the repository, so the caller supplies the port that asks it;
 * a scan given none records the probe `indeterminate` and stops below L2.
 */
export interface BranchProtectionChecker {
  /** Names the checker in the report, e.g. `github:owner/repo@main`. */
  readonly name: string;
  check(): Promise<{ readonly protected: boolean; readonly detail: string }>;
}

/**
 * Every field is required: a scan that defaulted its image, its limits, or
 * its registries would be a scan whose report could not say what it ran.
 */
export interface ScanOptions {
  /** A git repository on the host. Read, never written. */
  readonly checkout: string;
  /** The revision scanned, resolved to a commit before anything runs. */
  readonly revision: string;
  readonly provider: SandboxProvider;
  /** The build image: node with npm and corepack. The host's build profile, as the line's own sandboxes take it. */
  readonly image: string;
  readonly secretScanImage: string;
  readonly limits: { readonly cpus: number; readonly memoryMb: number; readonly pids: number };
  readonly user: { readonly uid: number; readonly gid: number };
  readonly timeouts: {
    /** The install's wall clock. */
    readonly installMs: number;
    /** Every other executed probe's wall clock. */
    readonly probeMs: number;
    /** How long a cold container may take to provision and answer before the dev-environment probe fails. */
    readonly coldProvisionMs: number;
  };
  /** The hosts the install may reach. Every other host is refused by the sandbox's egress proxy. */
  readonly registries: readonly string[];
  /** The policy's protected-path globs. */
  readonly protectedPaths: readonly string[];
  readonly branchProtection: BranchProtectionChecker | null;
}

const MOUNT = '/scan';
const TREE = `${MOUNT}/tree`;
const ENV: Readonly<Record<string, string>> = {
  HOME: `${MOUNT}/home`,
  npm_config_cache: `${MOUNT}/home/.npm`,
  npm_config_update_notifier: 'false',
  COREPACK_HOME: `${MOUNT}/home/corepack`,
  COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
  CI: 'true',
};
const DENY_ALL: EgressPolicy = { mode: 'deny-all', allow: [] };
const AGENT_INSTRUCTIONS = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/copilot-instructions.md', '.cursorrules'];
const SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
const LOCKFILES = { 'pnpm-lock.yaml': 'pnpm', 'package-lock.json': 'npm', 'npm-shrinkwrap.json': 'npm', 'yarn.lock': 'yarn' } as const;
type Manager = (typeof LOCKFILES)[keyof typeof LOCKFILES];

/** Runs `argv` with the copied tree as its working directory. The wrapper is part of the argv the report records. */
function inTree(argv: readonly string[]): string[] {
  return ['sh', '-c', `cd ${TREE} && "$@"`, 'readiness', ...argv];
}

interface Context {
  readonly options: ScanOptions;
  readonly scanDir: string;
  readonly tree: string;
  readonly files: readonly string[];
}

interface Observation {
  readonly outcome: ProbeOutcome;
  readonly detail: string;
  readonly evidence: ProbeEvidence;
}

export async function scan(options: ScanOptions): Promise<ReadinessReport> {
  const commit = await resolveCommit(options.checkout, options.revision);
  const base = await mkdtemp(join(tmpdir(), 'readiness-'));
  try {
    const scanDir = join(base, 'scan');
    const tree = join(scanDir, 'tree');
    const { files, skipped } = await materialize(options.checkout, commit, tree);
    await mkdir(join(scanDir, 'home'), { recursive: true });
    await mkdir(join(scanDir, 'out'), { recursive: true });
    const ctx: Context = { options, scanDir, tree, files };
    const seen = new Map<ProbeId, Observation>();
    const record = (id: ProbeId, o: Observation) => { seen.set(id, o); return o; };

    // Static reads first, and the secret scan, while the copy is exactly the commit's tree.
    const manifest = await readManifest(tree, files);
    const manager = record('build.pinned-manifest', pinnedManifest(manifest, files)).outcome === 'supported' ? managerOf(files) : null;
    const adapters = await adapterSet(tree);
    record('testing.adapter', adapterProbe(adapters));
    record('testing.enumerate', await enumerate(adapters, tree));
    record('testing.tamper-analysis', tamperAnalysis(adapters));
    record('integrate.protected-paths', protectedPaths(options.protectedPaths, files));
    record('docs.agent-instructions', agentInstructions(files));
    record('quality.file-size', await fileSizes(tree, files));
    record('integrate.secret-scan', await secretScan(ctx));
    record('integrate.branch-protection', await branchProtection(options.branchProtection));

    // Then the executed probes over an installed tree, each in its own fresh container.
    record('dev.cold-provision', await coldProvision(ctx));
    record('build.install', await install(ctx, manager));
    const runner = manager === 'pnpm' ? ['corepack', 'pnpm'] : ['npm'];
    record('build.clean', await build(ctx, manifest, runner));
    const framework = adapters.set?.test ?? null;
    record('testing.green-at-base', await suite(ctx, framework, 'green'));
    record('testing.coverage', await suite(ctx, framework, 'coverage'));
    record('style.lint', await tool(ctx, ['node_modules/.bin/eslint', '.'], 'a linter'));
    record('style.format', await tool(ctx, ['node_modules/.bin/prettier', '--check', '.'], 'a formatter'));
    record('style.typecheck', files.includes('tsconfig.json')
      ? await tool(ctx, ['node_modules/.bin/tsc', '--noEmit'], 'a type checker')
      : { outcome: 'absent', detail: 'there is no tsconfig.json at the root, so there is nothing to typecheck against', evidence: { via: 'static', read: 'the tree listing' } });

    const probes: ProbeResult[] = PROBES.map((p) => {
      const o = seen.get(p.id);
      if (o === undefined) throw new Error(`readiness: probe ${p.id} was declared and never observed`);
      return { probe: p.id, pillar: p.pillar, ceilingBearing: p.ceilingBearing, ...o, collectedBy: 'runtime' };
    });
    const derived = deriveCeiling(probes);
    return { commit, ceiling: { kind: 'scanned', ...derived, commit }, probes, skipped, collectedBy: 'runtime' };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

/** The ceiling a report derived. A report always carries one; only `NOT_SCANNED` stands for none. */
export function ceilingOf(report: ReadinessReport): ReadinessCeiling {
  return report.ceiling;
}

// ---- static probes ---------------------------------------------------------

type Manifest =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable'; readonly why: string }
  | { readonly kind: 'read'; readonly scripts: Readonly<Record<string, unknown>> };

async function readManifest(tree: string, files: readonly string[]): Promise<Manifest> {
  if (!files.includes('package.json')) return { kind: 'none' };
  try {
    const parsed: unknown = JSON.parse(await readFile(join(tree, 'package.json'), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { kind: 'unreadable', why: 'package.json is not an object' };
    const scripts: unknown = (parsed as Record<string, unknown>).scripts;
    return { kind: 'read', scripts: typeof scripts === 'object' && scripts !== null ? (scripts as Record<string, unknown>) : {} };
  } catch (error) {
    return { kind: 'unreadable', why: `package.json is not valid JSON: ${message(error)}` };
  }
}

function lockfilesIn(files: readonly string[]): Array<keyof typeof LOCKFILES> {
  return (Object.keys(LOCKFILES) as Array<keyof typeof LOCKFILES>).filter((name) => files.includes(name));
}

function managerOf(files: readonly string[]): Manager | null {
  const [only] = lockfilesIn(files);
  return only === undefined ? null : LOCKFILES[only];
}

function pinnedManifest(manifest: Manifest, files: readonly string[]): Observation {
  const evidence: ProbeEvidence = { via: 'static', read: 'the tree listing and package.json' };
  if (manifest.kind === 'none') return { outcome: 'absent', detail: 'the repository has no package.json at its root', evidence };
  if (manifest.kind === 'unreadable') return { outcome: 'absent', detail: manifest.why, evidence };
  const locks = lockfilesIn(files);
  if (locks.length === 0) return { outcome: 'absent', detail: 'no lockfile is committed, so a clean install cannot reproduce the dependencies', evidence };
  if (locks.length > 1) {
    return { outcome: 'absent', detail: `several lockfiles are committed (${locks.join(', ')}), and which is authoritative is not something to guess`, evidence };
  }
  return { outcome: 'supported', detail: `dependencies are pinned by ${locks.join('')}`, evidence };
}

type Adapters = { readonly set: AdapterSet; readonly reason: string | null } | { readonly set: null; readonly reason: string };

async function adapterSet(tree: string): Promise<Adapters> {
  try {
    const set = await buildAdapterSet(tree, { provider: null, coverage: null });
    return { set, reason: set.reasons.get('test') ?? null };
  } catch (error) {
    return { set: null, reason: `the adapter set could not be built: ${message(error)}` };
  }
}

function adapterProbe(adapters: Adapters): Observation {
  const evidence: ProbeEvidence = { via: 'static', read: 'buildAdapterSet over the tree (@olympus-ai/adapters)' };
  if (adapters.set === null) return { outcome: 'indeterminate', detail: adapters.reason, evidence };
  if (adapters.set.test === null) return { outcome: 'absent', detail: `no test adapter for this stack: ${adapters.reason ?? 'no reason recorded'}`, evidence };
  return { outcome: 'supported', detail: `test adapter for ${adapters.set.test.stack}`, evidence };
}

async function enumerate(adapters: Adapters, tree: string): Promise<Observation> {
  const test = adapters.set?.test ?? null;
  if (test === null) return { outcome: 'indeterminate', detail: 'no test adapter, so no suite can be enumerated', evidence: { via: 'not-run', because: 'testing.adapter' } };
  const evidence: ProbeEvidence = { via: 'static', read: `${test.stack} enumerateSuites over the tree` };
  try {
    const suites = await test.enumerateSuites(tree);
    if (suites.length === 0) return { outcome: 'absent', detail: `the ${test.stack} adapter enumerated no test files`, evidence };
    return { outcome: 'supported', detail: `${String(suites.length)} test file(s) enumerated`, evidence };
  } catch (error) {
    return { outcome: 'indeterminate', detail: `enumeration refused: ${message(error)}`, evidence };
  }
}

function tamperAnalysis(adapters: Adapters): Observation {
  const evidence: ProbeEvidence = { via: 'static', read: 'the adapter set\'s test and manifest slots' };
  if (adapters.set === null) return { outcome: 'indeterminate', detail: adapters.reason, evidence };
  const missing = [adapters.set.test === null ? 'test' : null, adapters.set.manifest === null ? 'manifest' : null].filter((m) => m !== null);
  if (missing.length > 0) {
    return { outcome: 'absent', detail: `tamper analysis compares assertions and config through the test and manifest adapters, and this stack lacks ${missing.join(' and ')}`, evidence };
  }
  return { outcome: 'supported', detail: 'test and manifest adapters are present', evidence };
}

function protectedPaths(globs: readonly string[], files: readonly string[]): Observation {
  const evidence: ProbeEvidence = { via: 'static', read: 'the policy\'s protectedPaths over the tree listing' };
  if (globs.length === 0) return { outcome: 'absent', detail: 'the policy declares no protected paths', evidence };
  const matches = picomatch([...globs], { dot: true });
  const hit = files.filter((f) => matches(f));
  if (hit.length === 0) return { outcome: 'absent', detail: `no tracked file matches the protected paths ${globs.join(', ')}`, evidence };
  return { outcome: 'supported', detail: `${String(hit.length)} tracked file(s) fall under the protected paths`, evidence };
}

function agentInstructions(files: readonly string[]): Observation {
  const evidence: ProbeEvidence = { via: 'static', read: 'the tree listing' };
  const found = files.filter((f) => AGENT_INSTRUCTIONS.includes(f) || f.startsWith('.cursor/rules/'));
  if (found.length === 0) return { outcome: 'absent', detail: `none of ${AGENT_INSTRUCTIONS.join(', ')} or .cursor/rules/ is present`, evidence };
  return { outcome: 'supported', detail: `agent instructions at ${found.join(', ')}`, evidence };
}

/** Recorded, never ceiling-bearing: the distribution, with no threshold to argue with. */
async function fileSizes(tree: string, files: readonly string[]): Promise<Observation> {
  const evidence: ProbeEvidence = { via: 'static', read: 'line counts of tracked source files' };
  const sizes: Array<{ file: string; lines: number }> = [];
  for (const file of files.filter((f) => SOURCE.test(f))) {
    try {
      const text = await readFile(join(tree, ...file.split('/')), 'utf8');
      sizes.push({ file, lines: text.split('\n').length });
    } catch {
      // A symlink to nowhere has no lines; it is not a source file to measure.
    }
  }
  if (sizes.length === 0) return { outcome: 'absent', detail: 'no tracked source files to measure', evidence };
  sizes.sort((a, b) => a.lines - b.lines);
  const at = (q: number) => sizes[Math.min(sizes.length - 1, Math.floor(q * sizes.length))]?.lines ?? 0;
  const largest = sizes[sizes.length - 1];
  return {
    outcome: 'supported',
    detail: `${String(sizes.length)} source files; median ${String(at(0.5))} lines, p90 ${String(at(0.9))}, largest ${largest?.file ?? ''} at ${String(largest?.lines ?? 0)}`,
    evidence,
  };
}

async function branchProtection(checker: BranchProtectionChecker | null): Promise<Observation> {
  if (checker === null) {
    return { outcome: 'indeterminate', detail: 'no branch-protection checker was given, so protection on the integration branch is not established', evidence: { via: 'checker', checker: 'none' } };
  }
  const evidence: ProbeEvidence = { via: 'checker', checker: checker.name };
  try {
    const answer = await checker.check();
    return { outcome: answer.protected ? 'supported' : 'absent', detail: answer.detail, evidence };
  } catch (error) {
    return { outcome: 'indeterminate', detail: `the checker failed: ${message(error)}`, evidence };
  }
}

// ---- executed probes -------------------------------------------------------

interface Ran {
  readonly evidence: Extract<ProbeEvidence, { via: 'executed' }>;
  /** Combined output, kept only to explain a failure in the detail. */
  readonly output: string;
}

/** One command in one fresh sandbox over the scan directory, destroyed after. */
async function execute(
  ctx: Context, argv: readonly string[], spec: { image?: string; mode?: 'rw' | 'ro'; egress?: EgressPolicy; wallClockMs?: number } = {},
): Promise<Ran> {
  const { options } = ctx;
  const image = spec.image ?? options.image;
  const sandbox: SandboxSpec = {
    image,
    mounts: { workspace: { source: ctx.scanDir, target: MOUNT, mode: spec.mode ?? 'rw' }, others: [] },
    egress: spec.egress ?? DENY_ALL,
    limits: { ...options.limits, wallClockMs: spec.wallClockMs ?? options.timeouts.probeMs },
    user: { ...options.user },
  };
  const evidence = (run: Ran['evidence']['run']): Ran['evidence'] => ({ via: 'executed', argv: [...argv], image, run });
  const started = performance.now();
  let handle: SandboxHandle;
  try {
    handle = await options.provider.provision(sandbox);
  } catch (error) {
    return { evidence: evidence({ kind: 'stopped', reason: `the sandbox could not be provisioned: ${message(error)}`, durationMs: elapsed(started) }), output: '' };
  }
  try {
    const result = await options.provider.exec(handle, [...argv], { env: ENV });
    const outputSha256 = createHash('sha256').update(result.stdout).update('\0').update(result.stderr).digest('hex');
    return {
      evidence: evidence({ kind: 'exited', exitCode: result.exitCode, durationMs: result.durationMs, outputSha256 }),
      output: `${result.stdout}\n${result.stderr}`.trim(),
    };
  } catch (error) {
    return { evidence: evidence({ kind: 'stopped', reason: message(error), durationMs: elapsed(started) }), output: '' };
  } finally {
    try {
      await options.provider.destroy(handle);
    } catch {
      // A sandbox its wall clock ended is already gone; the observation above stands either way.
    }
  }
}

/** Exit 0 is supported; any other exit is absent; a stopped run is indeterminate. */
function judged(ran: Ran, what: string): Observation {
  const { run } = ran.evidence;
  if (run.kind === 'stopped') return { outcome: 'indeterminate', detail: `${what} did not finish: ${run.reason}`, evidence: ran.evidence };
  if (run.exitCode === 0) return { outcome: 'supported', detail: `${what} exited 0`, evidence: ran.evidence };
  const missing = run.exitCode === 127 ? ' (command not found)' : '';
  return { outcome: 'absent', detail: `${what} exited ${String(run.exitCode)}${missing}: ${tail(ran.output)}`, evidence: ran.evidence };
}

async function secretScan(ctx: Context): Promise<Observation> {
  // --exit-code 2 separates "leaks found" from gitleaks' own failure, which exits 1.
  const ran = await execute(ctx, ['gitleaks', 'dir', 'tree', '--no-banner', '--redact', '--exit-code', '2'], { image: ctx.options.secretScanImage, mode: 'ro' });
  const { run } = ran.evidence;
  if (run.kind === 'exited' && run.exitCode === 2) return { outcome: 'absent', detail: `the secret scan found leaks: ${tail(ran.output)}`, evidence: ran.evidence };
  if (run.kind === 'exited' && run.exitCode !== 0) {
    return { outcome: 'indeterminate', detail: `the secret scan failed with exit ${String(run.exitCode)}: ${tail(ran.output)}`, evidence: ran.evidence };
  }
  return judged(ran, 'the secret scan');
}

async function coldProvision(ctx: Context): Promise<Observation> {
  const budget = ctx.options.timeouts.coldProvisionMs;
  const started = performance.now();
  const ran = await execute(ctx, ['node', '--version'], { wallClockMs: budget });
  const took = elapsed(started);
  const { run } = ran.evidence;
  if (run.kind === 'exited' && run.exitCode === 0 && took > budget) {
    return { outcome: 'absent', detail: `a cold container took ${String(took)}ms to provision and answer, over ${String(budget)}ms`, evidence: ran.evidence };
  }
  const judgedRun = judged(ran, 'a cold container');
  return judgedRun.outcome === 'supported' ? { ...judgedRun, detail: `a cold container provisioned and answered in ${String(took)}ms` } : judgedRun;
}

async function install(ctx: Context, manager: Manager | null): Promise<Observation> {
  if (manager === null) {
    return { outcome: 'absent', detail: 'there is no single pinned manifest to install from', evidence: { via: 'not-run', because: 'build.pinned-manifest' } };
  }
  if (manager === 'yarn') {
    return { outcome: 'indeterminate', detail: 'a yarn install is not one this scan performs; the install is not established', evidence: { via: 'static', read: 'yarn.lock' } };
  }
  const argv = manager === 'pnpm' ? ['corepack', 'pnpm', 'install', '--frozen-lockfile'] : ['npm', 'ci', '--no-audit', '--no-fund'];
  const ran = await execute(ctx, inTree(argv), {
    egress: { mode: 'allowlist', allow: [...ctx.options.registries] },
    wallClockMs: ctx.options.timeouts.installMs,
  });
  return judged(ran, `${manager} install from the lockfile`);
}

async function build(ctx: Context, manifest: Manifest, runner: readonly string[]): Promise<Observation> {
  const scripts = manifest.kind === 'read' ? manifest.scripts : {};
  if (typeof scripts.build === 'string') return judged(await execute(ctx, inTree([...runner, 'run', 'build'])), 'the build script in a fresh container');
  if (ctx.files.includes('tsconfig.json')) return judged(await execute(ctx, inTree(['node_modules/.bin/tsc', '--noEmit'])), 'a clean typecheck build in a fresh container');
  return { outcome: 'absent', detail: 'there is no build script and no tsconfig.json, so a clean build has nothing to run', evidence: { via: 'static', read: 'package.json scripts and the tree listing' } };
}

async function suite(ctx: Context, test: AdapterSet['test'], kind: 'green' | 'coverage'): Promise<Observation> {
  if (test === null) return { outcome: 'indeterminate', detail: 'no test adapter, so no suite can run', evidence: { via: 'not-run', because: 'testing.adapter' } };
  // A directory made empty for this run alone, so no earlier probe's file can stand in for this run's report.
  const name = `${kind}-${randomUUID()}`;
  await mkdir(join(ctx.scanDir, 'out', name));
  const out = `${MOUNT}/out/${name}`;
  let argv: string[];
  if (test instanceof VitestAdapter) {
    argv = kind === 'green'
      ? ['node_modules/.bin/vitest', 'run', '--reporter=json', `--outputFile=${out}/results.json`]
      : ['node_modules/.bin/vitest', 'run', '--coverage.enabled=true', '--coverage.reporter=json', `--coverage.reportsDirectory=${out}`];
  } else if (test instanceof JestAdapter) {
    argv = kind === 'green'
      ? ['node_modules/.bin/jest', '--ci', '--json', `--outputFile=${out}/results.json`]
      : ['node_modules/.bin/jest', '--ci', '--coverage', '--coverageReporters=json', `--coverageDirectory=${out}`];
  } else {
    return { outcome: 'indeterminate', detail: `no command is known for the ${test.stack} adapter`, evidence: { via: 'static', read: 'the adapter set' } };
  }
  const what = kind === 'green' ? 'the suite at base' : 'the suite with coverage, writing an Istanbul report';
  const ran = judged(await execute(ctx, inTree(argv)), what);
  if (ran.outcome !== 'supported') return ran;
  // An exit 0 says the runner found nothing to fail; the report says whether anything ran (I5).
  const report = await readReport(join(ctx.scanDir, 'out', name, kind === 'green' ? 'results.json' : 'coverage-final.json'));
  if (report === null) return { ...ran, outcome: 'absent', detail: `${what} exited 0 and wrote no readable report` };
  if (kind === 'green') {
    const passed = report.numPassedTests;
    const failed = report.numFailedTests;
    if (typeof passed !== 'number' || typeof failed !== 'number') return { ...ran, outcome: 'absent', detail: `${what} exited 0 and its report carries no test counts` };
    if (failed > 0) return { ...ran, outcome: 'absent', detail: `${what} exited 0 and its report counts ${String(failed)} failed` };
    if (passed < 1) return { ...ran, outcome: 'absent', detail: `${what} exited 0 and no test passed: every test was skipped, todo, or filtered out` };
    return { ...ran, detail: `${what} exited 0 with ${String(passed)} test(s) passed` };
  }
  const measured = Object.values(report).filter((entry) => typeof entry === 'object' && entry !== null && 's' in entry).length;
  if (measured === 0) return { ...ran, outcome: 'absent', detail: `${what} exited 0 and measured no file` };
  return { ...ran, detail: `${what} exited 0 and measured ${String(measured)} file(s)` };
}

/** A JSON object the sandbox wrote as a regular file, or null for anything else. */
async function readReport(path: string): Promise<Readonly<Record<string, unknown>> | null> {
  try {
    if (!(await lstat(path)).isFile()) return null;
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function tool(ctx: Context, argv: readonly string[], what: string): Promise<Observation> {
  return judged(await execute(ctx, inTree(argv)), what);
}

// ---- helpers ---------------------------------------------------------------

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}

function tail(output: string): string {
  const flat = output.replace(/\s+/gu, ' ').trim();
  return flat.length > 400 ? `…${flat.slice(-400)}` : flat || '(no output)';
}

