/**
 * Support for the registry assertions that drive the station line (P4).
 *
 * Every assertion here runs the real line in `@olympus-ai/api` over the real
 * filesystem Vault, so a resume reopens the store a previous process wrote,
 * and over the stub sandbox and stub drivers, so no Docker daemon or model is
 * needed to prove what the machine does. Packages are reached through their
 * published entries and imported at run time, the way the Vault and policy
 * assertions reach theirs, so the conformance package keeps no `package.json`
 * dependency on any of them (D-F3-04).
 */
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BuiltGraph, GraphParts, RunOutcome, RunRequest, WorkspaceStore } from '@olympus-ai/api';
import type {
  ApprovalKey,
  ApprovalOutcome,
  CapabilityScope,
  CompiledRole,
  Driver,
  DriverCapabilities,
  DriverEvent,
  ModelFamily,
  ModelIdentity,
  ModelTier,
  Policy,
  PolicyDocument,
  RoleId,
  RunId,
  RunState,
  TaskGraph,
  TaskId,
  TaskRequest,
  TaskResult,
} from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { Vault } from '@olympus-ai/vault';
import { workspaceRoot } from '../kit/workspace.js';
import { withVaultDirs, type VaultDirs } from './local-vault.js';

/** `parts` as a built graph: itself when `buildGraph` already made it, else built now. */
export async function built(parts: GraphParts): Promise<BuiltGraph> {
  const { buildGraph, isBuilt } = await import('@olympus-ai/api');
  return isBuilt(parts) ? parts : buildGraph({ ...(await scannersFor(parts.sandbox)), ...parts });
}

/** The fixture the api package's own tests drive: a spec, an acceptance file, a one-check manifest, and a graph of one build task and its review. */
export const HELLO_FIXTURE = join('packages', 'api', 'test', 'fixtures', 'hello');

export const HELLO_TASK = 'hello' as TaskId;
export const HELLO_REVIEW = 'hello-review' as TaskId;

export const ARTIFACTS: RunRequest['artifacts'] = {
  spec: ['spec.md'],
  acceptanceTests: ['acceptance.md'],
  verificationManifest: 'verify.json',
  taskGraph: 'graph.json',
  specParts: { security: 'security.json' },
};

const M1: readonly string[] = ['intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review', 'integrate'];

/** A role's scope as the rig grants it: every path writable unless `writableGlobs` narrows it. */
export function lineScope(stations: CapabilityScope['stations'], tier: ModelTier, writableGlobs: readonly string[] = ['**']): CapabilityScope {
  return {
    stations,
    writableGlobs: [...writableGlobs],
    tools: ['read'],
    network: { egress: 'none' },
    tier,
    tierByStation: {},
    escalation: 'none',
    autonomyCeiling: 2,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
  };
}

/**
 * A policy granting the two roles the fixture graph schedules, with every M1
 * station at L0 and L1 set to `auto` unless `cells` says otherwise, so each
 * assertion holds exactly the gate it names. `integrate` keeps its own
 * `human-required` floor whatever the cell says.
 */
export async function linePolicy(cells: Partial<Record<ApprovalKey, ApprovalOutcome>> = {}, overrides: Partial<PolicyDocument> = {}): Promise<Policy> {
  const { StrictPolicyEngine } = await import('@olympus-ai/core');
  const auto = Object.fromEntries(M1.flatMap((station) => [0, 1].map((level) => [`${station}:${String(level)}`, 'auto'])));
  return new StrictPolicyEngine().resolvePolicy({
    globalCap: 2,
    stationCaps: {},
    approvals: { ...auto, ...cells },
    roles: { ['builder' as RoleId]: lineScope(['build', 'verify'], 'standard'), ['reviewer' as RoleId]: lineScope(['review'], 'deep') },
    protectedPaths: ['.github/**'],
    triggers: {
      enabled: ['human'],
      entryStation: { human: 'intake' },
      taskTemplate: {},
      maxAutonomy: { human: 2 },
      minAuthorTrust: { human: 'owner' },
      maxTriggerDepth: 2,
      budgetPerWindow: { runs: 20, windowMs: 3_600_000 },
    },
    concurrency: { maxParallelTasks: 1, maxConflictRetries: 0 },
    ...overrides,
  });
}

export interface DriverOptions {
  /** The model family every resolved identity and result reports. Default: the stub's own. */
  readonly family?: string;
  readonly capabilities?: Partial<DriverCapabilities>;
  readonly narrative?: string;
  /** Called inside runTask before the stub answers: how an agent writes to the workspace. */
  readonly during?: (req: TaskRequest) => Promise<void>;
  /** Every call rejects, like a provider that cannot be reached. */
  readonly failing?: boolean;
}

export interface ObservedDriver extends Driver {
  readonly requests: TaskRequest[];
}

/** A stub driver a test configures, delegating to the real `StubDriver` for everything it does not change. */
export async function stubDriver(options: DriverOptions = {}): Promise<ObservedDriver> {
  const { StubDriver } = await import('@olympus-ai/core');
  const inner = new StubDriver(options.narrative === undefined ? {} : { claim: { narrative: options.narrative, filesChanged: [] } });
  const requests: TaskRequest[] = [];
  const resolveModel = (tier: ModelTier): ModelIdentity => {
    const base = inner.resolveModel(tier);
    return options.family === undefined ? base : { ...base, family: options.family as ModelFamily };
  };
  return {
    id: inner.id,
    contractVersion: inner.contractVersion,
    requests,
    provenanceId: () => inner.provenanceId(),
    capabilities: () => ({ ...inner.capabilities(), ...options.capabilities }),
    declaredTools: () => inner.declaredTools(),
    resolveModel,
    relayRequest: () => inner.relayRequest(),
    runTask: async (req: TaskRequest): Promise<TaskResult> => {
      requests.push(req);
      if (options.failing === true) throw new Error('the model provider is unreachable');
      if (options.during !== undefined) await options.during(req);
      const result = await inner.runTask(req);
      return { ...result, model: resolveModel(req.tier) };
    },
    cancel: (taskId: TaskId) => inner.cancel(taskId),
    emitArtifacts: (roles: CompiledRole[], targetDir: string) => inner.emitArtifacts(roles, targetDir),
    on: (kind: DriverEvent['kind'], handler: (e: DriverEvent) => void) => {
      inner.on(kind, handler);
    },
  };
}

/** What the hello fixture's acceptance check reads: the change its spec asks for, and absent from the base (D-A-BF-01). */
export const HELLO_FILE = 'hello.txt';

/**
 * `driver` doing the hello fixture's work: each builder task writes
 * `hello.txt` through the sandbox it was handed, as an agent would, and
 * claims it. The fixture's acceptance check fails on the base and passes over
 * this change, so a run whose builder changed nothing parks at `verify`
 * rather than passing a gate the change never had to meet. Every other call
 * goes to `driver` unchanged, so what an assertion observes of it holds.
 */
export function doingTheWork<D extends Driver>(driver: D, sandbox: SandboxProvider): D {
  return new Proxy(driver, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        if (req.role.role === ('builder' as RoleId)) {
          const wrote = await sandbox.exec(req.sandbox, ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(HELLO_FILE)}, 'hello')`]);
          if (wrote.exitCode !== 0) throw new Error(`the hello fixture's work did not land in task ${req.taskId}: ${wrote.stderr}`);
        }
        const result = await target.runTask(req);
        if (req.role.role !== ('builder' as RoleId) || result.claim.filesChanged.includes(HELLO_FILE)) return result;
        return { ...result, claim: { ...result.claim, filesChanged: [...result.claim.filesChanged, HELLO_FILE] } };
      };
    },
  });
}

export interface RigOptions {
  /**
   * `false` leaves the builder as given, for an assertion whose builder makes
   * a change of its own and whose manifest declares a reproduction for it:
   * one whose grant does not cover `hello.txt`, or whose image has no node.
   */
  readonly work?: boolean;
}

export interface LineRig {
  readonly dirs: VaultDirs;
  readonly runId: RunId;
  /**
   * The roles directory every request is admitted with: the shipped `builder`
   * and `reviewer`, copied beside the Vault and the workspace, inside neither,
   * so an assertion can edit one (D-A-RC-01).
   */
  readonly roles: string;
  /** The runtime's trees for the run: beside the Vault and the workspace, inside neither. */
  readonly workspaces: WorkspaceStore;
  /** A fresh component graph over the same store, as a new process would open it, built through `buildGraph`. */
  components(overrides?: Partial<GraphParts>, options?: RigOptions): Promise<BuiltGraph>;
  /** `components` is built here when it is not already, so an assertion can override one slot of a built graph by spreading it. */
  request(components: GraphParts, overrides?: Partial<RunRequest>): Promise<RunRequest>;
  /** A run state, read back from the store. */
  state(): Promise<RunState>;
}

/** The worst-case figure for the graph file as it stands, or null when the graph does not resolve under the policy. */
async function approvedFigure(req: RunRequest): Promise<number | null> {
  try {
    const { worstCaseCost } = await import('@olympus-ai/api');
    const parsed = JSON.parse(await readFile(join(req.workspace, req.artifacts.taskGraph), 'utf8')) as { tasks: TaskGraph['tasks'] };
    return worstCaseCost({ tasks: parsed.tasks, edges: [] }, req.policy).usd;
  } catch {
    return null;
  }
}

/** The hello fixture in a fresh artifact root, a fresh store beside it, and a way to open both again. */
export async function withLine<T>(prefix: string, body: (rig: LineRig) => Promise<T>): Promise<T> {
  return withVaultDirs(prefix, async (dirs, base) => {
    await cp(join(workspaceRoot(), HELLO_FIXTURE), dirs.artifacts, { recursive: true });
    const workspaces = await storeAt(join(base, 'trees'));
    const { DEFAULT_ROLES_DIRECTORY } = await import('@olympus-ai/compiler');
    const roles = join(base, 'roles');
    await cp(DEFAULT_ROLES_DIRECTORY, roles, { recursive: true });
    const runId = `${prefix.replace(/[^A-Za-z0-9]/g, '')}run` as RunId;
    const open = async (): Promise<Vault> => {
      const { LocalVault } = await import('@olympus-ai/vault');
      return new LocalVault(dirs);
    };
    const rig: LineRig = {
      dirs,
      runId,
      roles,
      workspaces,
      components: async (overrides = {}, options = {}) => {
        const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
        const sandbox = overrides.sandbox ?? new StubSandboxProvider();
        const stub = await stubDriver();
        const given = overrides.driver ?? stub;
        const driver = options.work === false ? given : doingTheWork(given, sandbox);
        // One stub in both seats, as before the builder did the work: a reviewer it never writes as.
        const reviewer = overrides.driver === undefined ? driver : stub;
        return built({ vault: await open(), sandbox, reviewer, workspaces, ...(await scannersFor(sandbox)), ...overrides, driver });
      },
      request: async (parts, overrides = {}) => {
        const components = await built(parts);
        await scanned(dirs, components);
        const req: RunRequest = {
          runId,
          baseCommit: '0'.repeat(40),
          requestedLevel: 1,
          workspace: dirs.artifacts,
          artifacts: ARTIFACTS,
          policy: await linePolicy(),
          roles,
          components,
          approvedCostUsd: null,
          ...overrides,
        };
        // A person who read the worst-case figure approved it, unless the assertion says otherwise (D-P9-03).
        return Object.hasOwn(overrides, 'approvedCostUsd') ? req : { ...req, approvedCostUsd: await approvedFigure(req) };
      },
      state: async () => (await open()).readRunState(runId),
    };
    return body(rig);
  });
}

/**
 * A workspace store at `root`. On a host with uids it runs as this process,
 * which is who its copies are writable by; on one without, the user is
 * named, because there is nothing to derive it from.
 */
export async function storeAt(root: string): Promise<WorkspaceStore> {
  const { localWorkspaceStore } = await import('@olympus-ai/api');
  return process.getuid === undefined ? localWorkspaceStore({ root, user: { uid: 0, gid: 0 } }) : localWorkspaceStore({ root });
}

/**
 * The hello fixture's reproduction (D-A-BF-01): a behavioral check declared
 * `'fails'`, since the base has no `hello.txt` and the rig's builder writes
 * one. Its script builds the file's name rather than spelling it: a path a
 * pinned command names is protected (D-P7-10), so spelling it would make
 * every run's change a protected-path touch (D-R15-03). A manifest an assertion writes carries it unless the assertion
 * declares a check of its own, so an assertion about something else is not
 * refused at admission for having nothing to reproduce.
 */
export const HELLO_REPRODUCTION = {
  id: 'hello-written',
  kind: 'behavioral',
  onBase: 'fails',
  command: ['node', '-e', "const fs = require('node:fs'); const file = ['hello', 'txt'].join('.'); process.exit(fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === 'hello' ? 0 : 1)"],
  required: true,
  timeoutMs: 10_000,
} as const;

function declaresOne(checks: readonly unknown[]): boolean {
  return checks.some((c) => typeof c === 'object' && c !== null && (c as { onBase?: unknown }).onBase !== undefined);
}

/** `asWritten` writes `checks` alone, for an assertion about what admission makes of a manifest. */
export async function writeManifest(dirs: VaultDirs, checks: readonly unknown[], options: { asWritten?: boolean } = {}): Promise<void> {
  const written = options.asWritten === true || declaresOne(checks) ? checks : [...checks, HELLO_REPRODUCTION];
  if (options.asWritten === true) AS_WRITTEN.add(dirs.artifacts);
  else AS_WRITTEN.delete(dirs.artifacts);
  await writeFile(join(dirs.artifacts, 'verify.json'), JSON.stringify({ checks: written }));
}

export async function readRecord<T>(vault: Vault, ref: Parameters<Vault['read']>[0]): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as T;
}

export async function readArtifact(dirs: VaultDirs, path: string): Promise<string> {
  return readFile(join(dirs.artifacts, path), 'utf8');
}

/** The refusal payload on the line, or a failure naming what the outcome was instead. */
export function refusalOf(outcome: RunOutcome, context: string): Extract<RunOutcome, { reason: 'refused' }> {
  if (outcome.ok || outcome.reason !== 'refused') {
    throw new Error(`${context}: expected a refusal on the line, got ${outcome.ok ? 'a completed run' : outcome.reason}`);
  }
  return outcome;
}

/**
 * The part of a run state two runs of the same work must agree on: everything
 * but versions, timestamps, and content hashes that carry them.
 *
 * `attempts.starts` is deliberately not here. It counts driver invocations, and
 * an interrupted run makes more of them than an uninterrupted one by design — a
 * replayed attempt is spent, not free (A-P4-06). `startsAtLeast` carries the
 * part that must still hold: a resume never invokes the driver fewer times than
 * the work required, so a resume cannot buy itself a cheaper run.
 */
export function comparable(state: RunState): unknown {
  return {
    station: state.station,
    phase: state.phase,
    tasks: state.tasks,
    attempts: Object.fromEntries(Object.entries(state.attempts).map(([id, a]) => [id, { iterations: a.iterations, retries: a.retries }])),
    startsAtLeast: Object.fromEntries(Object.entries(state.attempts).map(([id, a]) => [id, a.starts >= a.iterations])),
    results: Object.keys(state.results).sort(),
    evidence: state.evidenceRefs.length,
    violations: state.violations.length,
    approvals: state.approvals.map((grant) => grant.key),
    reviews: state.reviews,
  };
}

/** The stand-in scanners a rig's graph runs, over a sandbox that runs no image (R17). */
export async function standInScanners(): Promise<NonNullable<GraphParts['scanners']>> {
  const { STAND_IN_SECRET_SCANNER, STAND_IN_STATIC_ANALYSIS_SCANNER } = await import('@olympus-ai/adapters');
  return { secretScan: STAND_IN_SECRET_SCANNER, staticAnalysis: STAND_IN_STATIC_ANALYSIS_SCANNER };
}

/** The stand-in secret scan every rig's manifest pins unless it pins one of its own (R17). */
export async function secretScanCheck(): Promise<Record<string, unknown>> {
  const { STAND_IN_SECRET_SCAN_IMAGE } = await import('@olympus-ai/adapters');
  return { id: 'secret-scan', kind: 'secret-scan', image: STAND_IN_SECRET_SCAN_IMAGE, config: null, required: true, timeoutMs: 30_000 };
}

/** The stand-in static analysis a rig's manifest pins over a workspace with a package.json, whose stack has the slot (R17). */
export async function staticAnalysisCheck(): Promise<Record<string, unknown>> {
  const { STAND_IN_STATIC_ANALYSIS_IMAGE } = await import('@olympus-ai/adapters');
  return { id: 'static-analysis', kind: 'static-analysis', image: STAND_IN_STATIC_ANALYSIS_IMAGE, config: 'rules: []\n', required: true, timeoutMs: 30_000 };
}

/** Artifact roots whose manifest an assertion wrote as it stands, for what admission makes of it. */
const AS_WRITTEN = new Set<string>();

/**
 * The manifest as the rig admits it: with the security checks the workspace's
 * stack must be scanned with, added when the manifest pins none of a kind.
 * Read when the request is made rather than when the manifest is written,
 * since an assertion may give the workspace a package.json, and with it the
 * static-analysis slot, after writing it (R17). A manifest written as it
 * stands is left alone.
 */
async function scanned(dirs: VaultDirs, components: BuiltGraph): Promise<void> {
  if (AS_WRITTEN.has(dirs.artifacts)) return;
  const file = join(dirs.artifacts, 'verify.json');
  let manifest: { checks?: unknown };
  try {
    manifest = JSON.parse(await readFile(file, 'utf8')) as { checks?: unknown };
  } catch {
    return;
  }
  if (!Array.isArray(manifest.checks)) return;
  // Each security check pins the image the graph's scanner for its kind runs, so one manifest serves a stand-in graph and a real one.
  const images: Record<string, string> = { 'secret-scan': components.scanners.secretScan.image, 'static-analysis': components.scanners.staticAnalysis.image };
  const repinned = (manifest.checks as unknown[]).map((c) => {
    const kind = typeof c === 'object' && c !== null ? (c as { kind?: unknown }).kind : undefined;
    return typeof kind === 'string' && Object.hasOwn(images, kind) ? { ...(c as object), image: images[kind] } : c;
  });
  const kinds = new Set(repinned.map((c) => (typeof c === 'object' && c !== null ? (c as { kind?: unknown }).kind : undefined)));
  const added: unknown[] = [];
  if (!kinds.has('secret-scan')) added.push({ ...(await secretScanCheck()), image: images['secret-scan'] });
  const node = await readFile(join(dirs.artifacts, 'package.json')).then(() => true, () => false);
  if (node && !kinds.has('static-analysis')) added.push({ ...(await staticAnalysisCheck()), image: images['static-analysis'] });
  const checks = [...repinned, ...added];
  if (JSON.stringify(checks) !== JSON.stringify(manifest.checks)) await writeFile(file, JSON.stringify({ ...manifest, checks }));
}

/**
 * The stand-in scanners over a sandbox that runs no image, and none over a
 * real daemon, whose graph then runs the declared scanners' images (R17).
 */
export async function scannersFor(sandbox: SandboxProvider): Promise<Pick<GraphParts, 'scanners'>> {
  const { LocalDockerProvider } = await import('@olympus-ai/sandbox');
  return sandbox instanceof LocalDockerProvider ? {} : { scanners: await standInScanners() };
}
