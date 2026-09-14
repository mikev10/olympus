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
import type { ComponentGraph, RunOutcome, RunRequest } from '@olympus-ai/api';
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
  TaskId,
  TaskRequest,
  TaskResult,
} from '@olympus-ai/core';
import type { Vault } from '@olympus-ai/vault';
import { workspaceRoot } from '../kit/workspace.js';
import { withVaultDirs, type VaultDirs } from './local-vault.js';

/** The fixture the api package's own tests drive: a spec, an acceptance file, a one-check manifest, and a graph of one build task and its review. */
export const HELLO_FIXTURE = join('packages', 'api', 'test', 'fixtures', 'hello');

export const HELLO_TASK = 'hello' as TaskId;
export const HELLO_REVIEW = 'hello-review' as TaskId;

export const ARTIFACTS: RunRequest['artifacts'] = {
  spec: ['spec.md'],
  acceptanceTests: ['acceptance.md'],
  verificationManifest: 'verify.json',
  taskGraph: 'graph.json',
};

const M1: readonly string[] = ['intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review', 'integrate'];

function scope(stations: CapabilityScope['stations'], tier: ModelTier): CapabilityScope {
  return {
    stations,
    writableGlobs: ['**'],
    tools: ['read'],
    network: { egress: 'none' },
    tier,
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
    roles: { ['builder' as RoleId]: scope(['build', 'verify'], 'standard'), ['reviewer' as RoleId]: scope(['review'], 'deep') },
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
    resolveModel,
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

export interface LineRig {
  readonly dirs: VaultDirs;
  readonly runId: RunId;
  /** A fresh component graph over the same store, as a new process would open it. */
  components(overrides?: Partial<ComponentGraph>): Promise<ComponentGraph>;
  request(components: ComponentGraph, overrides?: Partial<RunRequest>): Promise<RunRequest>;
  /** A run state, read back from the store. */
  state(): Promise<RunState>;
}

/** The hello fixture in a fresh artifact root, a fresh store beside it, and a way to open both again. */
export async function withLine<T>(prefix: string, body: (rig: LineRig) => Promise<T>): Promise<T> {
  return withVaultDirs(prefix, async (dirs) => {
    await cp(join(workspaceRoot(), HELLO_FIXTURE), dirs.artifacts, { recursive: true });
    const runId = `${prefix.replace(/[^A-Za-z0-9]/g, '')}run` as RunId;
    const open = async (): Promise<Vault> => {
      const { LocalVault } = await import('@olympus-ai/vault');
      return new LocalVault(dirs);
    };
    const rig: LineRig = {
      dirs,
      runId,
      components: async (overrides = {}) => {
        const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
        const driver = await stubDriver();
        return { vault: await open(), sandbox: new StubSandboxProvider(), driver, reviewer: driver, ...overrides };
      },
      request: async (components, overrides = {}) => ({
        runId,
        baseCommit: '0'.repeat(40),
        requestedLevel: 1,
        workspace: dirs.artifacts,
        artifacts: ARTIFACTS,
        policy: await linePolicy(),
        components,
        ...overrides,
      }),
      state: async () => (await open()).readRunState(runId),
    };
    return body(rig);
  });
}

export async function writeManifest(dirs: VaultDirs, checks: readonly unknown[]): Promise<void> {
  await writeFile(join(dirs.artifacts, 'verify.json'), JSON.stringify({ checks }));
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

/** The part of a run state two runs of the same work must agree on: everything but versions, timestamps, and content hashes that carry them. */
export function comparable(state: RunState): unknown {
  return {
    station: state.station,
    phase: state.phase,
    tasks: state.tasks,
    attempts: state.attempts,
    results: Object.keys(state.results).sort(),
    evidence: state.evidenceRefs.length,
    violations: state.violations.length,
    approvals: state.approvals.map((grant) => grant.key),
    reviews: state.reviews,
  };
}
