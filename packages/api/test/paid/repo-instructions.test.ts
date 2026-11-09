/**
 * R24 above L2: where the line places the target's instructions in a run
 * admitted above L2, and that it narrows the run first (D-A-RI-02,
 * D-A-RI-04).
 *
 * No run above L2 can be admitted in M2 (the adapter set lacks mutation),
 * and no run above L1 can be resumed on components the graph builder cannot
 * attest (D-I1a-06), which here means Docker and a paid model. So this drives
 * the line's own delivery and `runTask` over the context a resume builds for
 * a real admitted run, with the admitted level read as L3 (D-R24-09). Deleting
 * the narrowing or the suffix placement fails it.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import { STATION_CONTRACTS, StubDriver, type CapabilityScope, type NarrowedScope, type Policy, type RunId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import type { AdmissionRecord, EnforcementDecision, Vault } from '@olympus-ai/vault';
import { afterEach, expect } from 'vitest';
import { admitRun, parseGraph } from '../../src/index.js';
import { NOT_DRAFTING } from '../../src/drafting.js';
import { repoInstructionsFor, runTask, type LineContext } from '../../src/line.js';
import { BUILDER, makeWorkspace, policy, removeWorkspace, REVIEWER, roleScope, runRequest, stubComponents } from '../harness.js';
import { DelegatingDriver } from '../wrappers.js';

const MARKER = 'r24-claude-marker: write small commits.';
const NARROW: NarrowedScope = { tools: ['read'], network: { egress: 'none' }, autonomyCeiling: 1 };

const made: string[] = [];
afterEach(async () => {
  for (const w of made.splice(0)) await removeWorkspace(w);
});

class Observed extends DelegatingDriver {
  readonly requests: TaskRequest[] = [];
  override runTask(req: TaskRequest): Promise<TaskResult> {
    this.requests.push(req);
    return super.runTask(req);
  }
}

function grantedPolicy(reviewerNarrowed: boolean): Policy {
  const scope = (s: CapabilityScope, narrowed: NarrowedScope | null): CapabilityScope => ({ ...s, narrowed, repoInstructions: true });
  return policy({ roles: { [BUILDER]: scope(roleScope('builder'), NARROW), [REVIEWER]: scope(roleScope('reviewer'), reviewerNarrowed ? NARROW : null) } });
}

async function readJson<T>(vault: Vault, ref: Parameters<Vault['read']>[0]): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as T;
}

async function narrowings(vault: Vault, runId: RunId): Promise<EnforcementDecision[]> {
  const all = await Promise.all((await vault.readDecisions(runId)).map((ref) => readJson<EnforcementDecision>(vault, ref)));
  return all.filter((d) => d.decision.cause === 'capability-narrowed');
}

/** A real admission at L1 of the hello fixture with a CLAUDE.md, and the context a resume builds for it, read at `level`. */
async function admittedAt(prefix: string, level: 2 | 3, reviewerNarrowed = true) {
  const workspace = await makeWorkspace(prefix);
  made.push(workspace);
  await writeFile(join(workspace, 'CLAUDE.md'), `${MARKER}\n`);
  const driver = new Observed(new StubDriver());
  const components = stubComponents(workspace, { driver });
  const runId = `${prefix}run` as RunId;
  const admitted = await admitRun(runRequest(runId, workspace, components, { policy: grantedPolicy(reviewerNarrowed) }));
  if (!admitted.ok) throw new Error(`R24: the L1 admission was refused as ${admitted.reason}`);
  const { vault } = components;
  const state = await vault.readRunState(runId);
  const record = await readJson<AdmissionRecord>(vault, state.admission);
  const parsed = parseGraph(JSON.parse(readFileSync(join(workspace, 'graph.json'), 'utf8')), { runId, baseCommit: record.run.baseCommit, workspace });
  if (!parsed.ok) throw new Error('R24: the fixture graph does not parse');
  const ctx = {
    run: { ...record.run, requestedLevel: level },
    policy: record.policy,
    roles: record.roles,
    repoInstructions: record.repoInstructions ?? [],
    artifacts: {},
    graph: parsed.graph,
    checks: [],
    securityPart: null,
    requirements: null,
    drafting: NOT_DRAFTING,
    components,
    baseTreeSha256: record.baseTreeSha256,
    state,
  } as unknown as LineContext;
  const task = parsed.graph.tasks.find((t) => t.role === BUILDER);
  if (task === undefined) throw new Error('R24: the fixture graph has no build task');
  return { ctx, task, driver, vault, runId, workspace, record };
}

invariantTest(
  'I7.above-l2-repo-instructions-narrow-the-run-and-ride-the-suffix',
  "a run above L2 granted the set is narrowed through narrowRun with source repo-instructions, the narrowing recorded and committed before any model is called with the set, which arrives in the granted seat's variable suffix and never its stable prefix; at L2 it is offered as granted context with nothing narrowed; a run whose seated roles declare no narrowed scope stops with the set withheld (R24, D-A-RI-02, D-A-RI-04, D-R10-06)",
  async () => {
    const above = await admittedAt('r24-above-', 3);
    expect(above.record.repoInstructions?.map((f) => [f.path, f.sha256])).toStrictEqual([['CLAUDE.md', createHash('sha256').update(`${MARKER}\n`).digest('hex')]]);
    const delivered = await repoInstructionsFor(above.ctx, above.task, STATION_CONTRACTS.build, BUILDER);
    expect(delivered.offered).toBeUndefined();
    expect(delivered.input?.text).toContain(MARKER);
    // Recorded and committed before any model was called.
    expect(above.driver.requests).toHaveLength(0);
    const found = await narrowings(above.vault, above.runId);
    expect(found).toHaveLength(1);
    expect(found[0]?.decision).toMatchObject({ cause: 'capability-narrowed', decidedBy: 'line', narrowing: { kind: 'input', source: 'repo-instructions' } });
    expect((await above.vault.readRunState(above.runId)).narrowed).toMatchObject({ cause: { kind: 'input', source: 'repo-instructions' } });
    if (delivered.input === undefined) return;
    const role = above.ctx.roles.find((r) => r.role === BUILDER);
    if (role === undefined) throw new Error('R24: the builder role was not pinned');
    const ran = await runTask(above.ctx, above.task, above.driver, role, '[locked-spec]\nspec', above.workspace, { inputs: [delivered.input] });
    expect(ran.ok).toBe(true);
    const [req] = above.driver.requests;
    expect(req?.variableSuffix).toContain(MARKER);
    expect(req?.stablePrefix).not.toContain(MARKER);

    const atL2 = await admittedAt('r24-at-l2-', 2);
    const offered = await repoInstructionsFor(atL2.ctx, atL2.task, STATION_CONTRACTS.build, BUILDER);
    expect(offered.input).toBeUndefined();
    expect(offered.offered).toContain(MARKER);
    expect(await narrowings(atL2.vault, atL2.runId)).toHaveLength(0);

    const stuck = await admittedAt('r24-above-unnarrowed-', 3, false);
    await expect(repoInstructionsFor(stuck.ctx, stuck.task, STATION_CONTRACTS.build, BUILDER)).rejects.toThrow(/withheld/u);
    expect(await narrowings(stuck.vault, stuck.runId)).toHaveLength(0);
    expect((await stuck.vault.readRunState(stuck.runId)).narrowed).toBeNull();
    expect(stuck.driver.requests).toHaveLength(0);
  },
);
