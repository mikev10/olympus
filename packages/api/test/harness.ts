/**
 * Shared set-up for the line tests: a fresh copy of the hello fixture as the
 * workspace, a policy that grants the two roles the fixture graph schedules,
 * and drivers whose model family a test can choose. Test code only.
 */
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ROLES_DIRECTORY } from '@olympus-ai/compiler';
import {
  StrictPolicyEngine,
  StubDriver,
  type ApprovalKey,
  type ApprovalOutcome,
  type CapabilityScope,
  type Driver,
  type DriverCapabilities,
  type ModelFamily,
  type ModelIdentity,
  type ModelTier,
  type Policy,
  type PolicyDocument,
  type RoleId,
  type RunId,
  type TaskGraph,
  type TaskRequest,
  type TaskResult,
} from '@olympus-ai/core';
import { STAND_IN_SECRET_SCAN_IMAGE, STAND_IN_SECRET_SCANNER, STAND_IN_STATIC_ANALYSIS_IMAGE, STAND_IN_STATIC_ANALYSIS_SCANNER } from '@olympus-ai/adapters';
import type { OtherCheckSpec } from '@olympus-ai/integrity';
import { StubSandboxProvider, type SandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';
import { buildGraph, isBuilt, localWorkspaceStore, worstCaseCost, type BuiltGraph, type GraphParts, type RunRequest, type WorkspaceStore } from '../src/index.js';
import { DelegatingDriver } from './wrappers.js';

export const HELLO = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hello');
export const BASE_COMMIT = '0'.repeat(40);
export const BUILDER = 'builder' as RoleId;
export const REVIEWER = 'reviewer' as RoleId;

export const HELLO_CHECK: OtherCheckSpec = {
  id: 'hello-exit-zero',
  kind: 'compile',
  command: ['node', '-e', 'process.exit(0)'],
  required: true,
  timeoutMs: 10_000,
};

export const ARTIFACTS = {
  spec: ['spec.md'],
  acceptanceTests: ['acceptance.md'],
  verificationManifest: 'verify.json',
  taskGraph: 'graph.json',
  specParts: { security: 'security.json' },
} as const;

export async function makeWorkspace(prefix: string): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), prefix));
  await cp(HELLO, workspace, { recursive: true });
  return workspace;
}

/**
 * The store beside a test workspace, never inside it. On a host with uids it
 * runs as the test's own; on one without, the stub sandbox ignores the user,
 * so root is as good a name as any.
 */
export function storeFor(workspace: string): WorkspaceStore {
  const user = process.getuid === undefined ? { uid: 0, gid: 0 } : undefined;
  return localWorkspaceStore(user === undefined ? { root: `${workspace}.store` } : { root: `${workspace}.store`, user });
}

export async function removeWorkspace(workspace: string): Promise<void> {
  await rm(`${workspace}.store`, { recursive: true, force: true });
  await rm(workspace, { recursive: true, force: true });
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

/** `asWritten` writes `checks` alone, for a test of what admission makes of a manifest. */
export async function writeChecks(workspace: string, checks: readonly unknown[], options: { asWritten?: boolean } = {}): Promise<void> {
  const reproduced = options.asWritten === true || declaresOne(checks) ? checks : [...checks, HELLO_REPRODUCTION];
  const scanned = (c: unknown): boolean => typeof c === 'object' && c !== null && (c as { kind?: unknown }).kind === 'secret-scan';
  const written = options.asWritten === true || reproduced.some(scanned) ? reproduced : [...reproduced, SECRET_SCAN_CHECK];
  await writeFile(join(workspace, 'verify.json'), JSON.stringify({ checks: written }));
}

/** The stand-in scanners every test graph runs, over a stub sandbox that runs no image (R17). */
export const STAND_IN_SCANNERS = { secretScan: STAND_IN_SECRET_SCANNER, staticAnalysis: STAND_IN_STATIC_ANALYSIS_SCANNER } as const;

/** The stand-in secret scan a manifest a test writes carries unless it pins one, as the fixture's does. */
export const SECRET_SCAN_CHECK = { id: 'secret-scan', kind: 'secret-scan', image: STAND_IN_SECRET_SCAN_IMAGE, config: null, required: true, timeoutMs: 30_000 } as const;

/** The stand-in static analysis a manifest pins over a workspace with a package.json, whose stack has the slot. */
export const STATIC_ANALYSIS_CHECK = { id: 'static-analysis', kind: 'static-analysis', image: STAND_IN_STATIC_ANALYSIS_IMAGE, config: 'rules: []', required: true, timeoutMs: 30_000 } as const;

export async function writeGraph(workspace: string, tasks: readonly unknown[]): Promise<void> {
  await writeFile(join(workspace, 'graph.json'), JSON.stringify({ tasks }));
}

export async function readSpec(workspace: string): Promise<string> {
  return readFile(join(workspace, 'spec.md'), 'utf8');
}

function scope(stations: CapabilityScope['stations'], tier: ModelTier): CapabilityScope {
  return {
    stations,
    writableGlobs: ['**'],
    tools: ['read', 'write'],
    network: { egress: 'none' },
    tier,
    tierByStation: {},
    escalation: 'none',
    autonomyCeiling: 2,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
  };
}

/** The scope the fixture policy grants each of its two roles. */
export function roleScope(role: 'builder' | 'reviewer'): CapabilityScope {
  return role === 'builder' ? scope(['build', 'verify'], 'standard') : scope(['review'], 'deep');
}

/** Every M1 station at L0 and L1 set to `auto`, so a test that wants a gate to hold sets that one cell. `integrate`'s own floor still holds. */
const AUTO_BELOW_L2: Partial<Record<ApprovalKey, ApprovalOutcome>> = Object.fromEntries(
  ['intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review', 'integrate'].flatMap((station) =>
    [0, 1].map((level) => [`${station}:${String(level)}`, 'auto']),
  ),
);

export function policyDocument(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    globalCap: 2,
    stationCaps: {},
    approvals: { ...AUTO_BELOW_L2 },
    roles: { [BUILDER]: roleScope('builder'), [REVIEWER]: roleScope('reviewer') },
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
  };
}

export function policy(overrides: Partial<PolicyDocument> = {}): Policy {
  return new StrictPolicyEngine().resolvePolicy(policyDocument(overrides));
}

export function approvals(cells: Partial<Record<ApprovalKey, ApprovalOutcome>>): Partial<PolicyDocument> {
  return { approvals: { ...AUTO_BELOW_L2, ...cells } };
}

/** A stub whose model family, capabilities, or claim a test chooses; every result reports the family it resolves. */
export class ChosenDriver extends DelegatingDriver {
  readonly requests: TaskRequest[] = [];
  private readonly family: string;
  private readonly declared: Partial<DriverCapabilities>;

  constructor(options: { family?: string; capabilities?: Partial<DriverCapabilities>; narrative?: string } = {}) {
    super(new StubDriver(options.narrative === undefined ? {} : { claim: { narrative: options.narrative, filesChanged: [] } }));
    this.family = options.family ?? 'stub';
    this.declared = options.capabilities ?? {};
  }

  override capabilities(): DriverCapabilities {
    return { ...this.inner.capabilities(), ...this.declared };
  }

  override resolveModel(tier: ModelTier): ModelIdentity {
    return { ...this.inner.resolveModel(tier), family: this.family as ModelFamily };
  }

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    this.requests.push(req);
    const result = await this.inner.runTask(req);
    return { ...result, model: this.resolveModel(req.tier) };
  }
}

/** `parts` as a built graph: itself when it already is one, else built now. */
export function built(parts: GraphParts): BuiltGraph {
  return isBuilt(parts) ? parts : buildGraph({ scanners: STAND_IN_SCANNERS, ...parts });
}

/** What the hello fixture's reproduction reads: the change its spec asks for, absent from the base (D-A-BF-01). */
export const HELLO_FILE = 'hello.txt';

/**
 * `driver` doing the hello fixture's work: each builder task writes
 * `hello.txt` through the sandbox it was handed, as an agent would, and
 * claims it, so the fixture's reproduction passes over the change after
 * failing over the base. Every other call goes to `driver` unchanged.
 * Wrapping a wrapped driver replaces its sandbox rather than adding a second
 * write, so a test that swaps the graph's sandbox writes through the new one.
 */
export function doingTheWork<D extends Driver>(driver: D, sandbox: SandboxProvider): D {
  const inner = (UNWRAPPED.get(driver) ?? driver) as D;
  const wrapped = new Proxy(inner, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        if (req.role.role !== BUILDER) return target.runTask(req);
        const wrote = await sandbox.exec(req.sandbox, ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(HELLO_FILE)}, 'hello')`]);
        if (wrote.exitCode !== 0) throw new Error(`the hello fixture's work did not land in task ${req.taskId}: ${wrote.stderr}`);
        const result = await target.runTask(req);
        if (result.claim.filesChanged.includes(HELLO_FILE)) return result;
        return { ...result, claim: { ...result.claim, filesChanged: [...result.claim.filesChanged, HELLO_FILE] } };
      };
    },
  });
  UNWRAPPED.set(wrapped, inner);
  return wrapped;
}

const UNWRAPPED = new WeakMap<Driver, Driver>();

/** The roles every request is admitted with: the shipped `builder` and `reviewer`, outside every workspace a test makes. */
export const ROLES = DEFAULT_ROLES_DIRECTORY;

/** The stub graph, built: every run on it is refused above L1 for the stubs' own declarations. Its builder does the fixture's work. */
export function stubComponents(workspace: string, overrides: Partial<GraphParts> = {}): BuiltGraph {
  const sandbox = overrides.sandbox ?? new StubSandboxProvider();
  const stub = new StubDriver();
  const driver = doingTheWork(overrides.driver ?? stub, sandbox);
  // One stub in both seats, as before the builder did the work: a reviewer it never writes as.
  const reviewer = overrides.driver === undefined ? driver : stub;
  return buildGraph({ vault: new StubVault(workspace), sandbox, reviewer, workspaces: storeFor(workspace), scanners: STAND_IN_SCANNERS, ...overrides, driver });
}

/**
 * A request as a person who read the worst-case figure and approved it would
 * send, unless the test says otherwise. The figure comes from the graph file
 * as it stands when the request is made; a graph a test cannot resolve gets
 * null, and admission refuses for the reason that makes it unresolvable.
 */
/** `components` is built here when it was not already, so a test can override one slot of a built graph by spreading it. */
export function runRequest(runId: RunId, workspace: string, parts: GraphParts, overrides: Partial<RunRequest> = {}): RunRequest {
  const req: RunRequest = {
    runId,
    baseCommit: BASE_COMMIT,
    requestedLevel: 1,
    workspace,
    artifacts: ARTIFACTS,
    policy: policy(),
    roles: ROLES,
    components: working(built(parts)),
    approvedCostUsd: null,
    ...overrides,
  };
  return Object.hasOwn(overrides, 'approvedCostUsd') ? req : { ...req, approvedCostUsd: approvedFigure(req) };
}

/** `graph` with its builder doing the fixture's work through the graph's own sandbox, whichever the test put there. */
function working(graph: BuiltGraph): BuiltGraph {
  const driver = doingTheWork(graph.driver, graph.sandbox);
  return { ...graph, driver, reviewer: UNWRAPPED.get(graph.reviewer) === UNWRAPPED.get(graph.driver) && UNWRAPPED.has(graph.reviewer) ? driver : graph.reviewer };
}

function approvedFigure(req: RunRequest): number | null {
  try {
    const parsed = JSON.parse(readFileSync(join(req.workspace, req.artifacts.taskGraph), 'utf8')) as { tasks: TaskGraph['tasks'] };
    return worstCaseCost({ tasks: parsed.tasks, edges: [] }, req.policy).usd;
  } catch {
    return null;
  }
}
