/**
 * Shared set-up for the line tests: a fresh copy of the hello fixture as the
 * workspace, a policy that grants the two roles the fixture graph schedules,
 * and drivers whose model family a test can choose. Test code only.
 */
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  StrictPolicyEngine,
  StubDriver,
  type ApprovalKey,
  type ApprovalOutcome,
  type CapabilityScope,
  type DriverCapabilities,
  type ModelFamily,
  type ModelIdentity,
  type ModelTier,
  type Policy,
  type PolicyDocument,
  type RoleId,
  type RunId,
  type TaskRequest,
  type TaskResult,
} from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';
import { localWorkspaceStore, type ComponentGraph, type RunRequest, type WorkspaceStore } from '../src/index.js';
import { DelegatingDriver } from './wrappers.js';

export const HELLO = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'hello');
export const BASE_COMMIT = '0'.repeat(40);
export const BUILDER = 'builder' as RoleId;
export const REVIEWER = 'reviewer' as RoleId;

export const HELLO_CHECK: CheckSpec = {
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

export async function writeChecks(workspace: string, checks: readonly unknown[]): Promise<void> {
  await writeFile(join(workspace, 'verify.json'), JSON.stringify({ checks }));
}

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

export function stubComponents(workspace: string, overrides: Partial<ComponentGraph> = {}): ComponentGraph {
  const driver = new StubDriver();
  return { vault: new StubVault(workspace), sandbox: new StubSandboxProvider(), driver, reviewer: driver, workspaces: storeFor(workspace), ...overrides };
}

export function runRequest(runId: RunId, workspace: string, components: ComponentGraph, overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId,
    baseCommit: BASE_COMMIT,
    requestedLevel: 1,
    workspace,
    artifacts: ARTIFACTS,
    policy: policy(),
    components,
    ...overrides,
  };
}
