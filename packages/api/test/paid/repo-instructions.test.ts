/**
 * R24 above L2: where the line places the target's instructions in a run
 * admitted above L2, and that it narrows the run first (D-A-RI-02,
 * D-A-RI-04).
 *
 * No run above L2 can be admitted in M2 (the adapter set lacks mutation),
 * and no run above L1 can be resumed on components the graph builder cannot
 * attest (D-I1a-06), which here means Docker and a paid model. So this
 * drives the real line, `runLine`, over exactly the context `resumeRun`
 * builds for a real admitted run, with the admitted level read as L3: the
 * build and review steps deliver the set as they would in production, and
 * dropping their forwarding fails it (D-R24-09, codex-2).
 *
 * It is in the paid suite because that is the package's one reported suite;
 * it calls no model.
 */
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import { StubDriver, type CapabilityScope, type NarrowedScope, type Policy, type RunId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import type { AdmissionRecord, EnforcementDecision, Vault } from '@olympus-ai/vault';
import { afterEach, expect } from 'vitest';
import { admitRun, loadLine } from '../../src/index.js';
import { runLine, type LineContext } from '../../src/line.js';
import { approvals, BUILDER, makeWorkspace, policy, removeWorkspace, REVIEWER, roleScope, runRequest, stubComponents } from '../harness.js';
import { DelegatingDriver } from '../wrappers.js';

const MARKER = 'r24-claude-marker: write small commits.';
const NARROW: NarrowedScope = { tools: ['read'], network: { egress: 'none' }, autonomyCeiling: 1 };

const made: string[] = [];
afterEach(async () => {
  for (const w of made.splice(0)) await removeWorkspace(w);
});

/** A driver recording each request, and whether the run was already narrowed when it was called. */
class Observed extends DelegatingDriver {
  readonly requests: TaskRequest[] = [];
  readonly narrowedAtCall: boolean[] = [];
  vault: Vault | null = null;
  runId: RunId | null = null;
  override async runTask(req: TaskRequest): Promise<TaskResult> {
    this.requests.push(req);
    if (this.vault !== null && this.runId !== null) this.narrowedAtCall.push((await this.vault.readRunState(this.runId)).narrowed !== null);
    return super.runTask(req);
  }
}

/** Both roles granted the set at ceiling 3, each narrowed to `NARROW` unless `reviewerNarrowed` is false, every exit below integrate auto at L0 to L3. */
function grantedPolicy(reviewerNarrowed: boolean): Policy {
  const scope = (s: CapabilityScope, narrowed: NarrowedScope | null): CapabilityScope => ({ ...s, autonomyCeiling: 3, narrowed, repoInstructions: true });
  const cells = Object.fromEntries(['intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review'].flatMap((s) => [2, 3].map((l) => [`${s}:${String(l)}`, 'auto' as const])));
  const base = policy();
  return policy({
    ...approvals(cells),
    globalCap: 3,
    roles: { [BUILDER]: scope(roleScope('builder'), NARROW), [REVIEWER]: scope(roleScope('reviewer'), reviewerNarrowed ? NARROW : null) },
    triggers: { ...base.triggers, maxAutonomy: { human: 3 } },
  });
}

async function readJson<T>(vault: Vault, ref: Parameters<Vault['read']>[0]): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as T;
}

async function narrowings(vault: Vault, runId: RunId): Promise<EnforcementDecision[]> {
  const all = await Promise.all((await vault.readDecisions(runId)).map((ref) => readJson<EnforcementDecision>(vault, ref)));
  return all.filter((d) => d.decision.cause === 'capability-narrowed');
}

/** A real admission at L1 of the hello fixture with a CLAUDE.md, driven by the real line from the context a resume builds, its level read as `level`. */
async function drivenAt(prefix: string, level: 2 | 3, reviewerNarrowed = true) {
  const workspace = await makeWorkspace(prefix);
  made.push(workspace);
  await writeFile(join(workspace, 'CLAUDE.md'), `${MARKER}\n`);
  const builder = new Observed(new StubDriver());
  const reviewer = new Observed(new StubDriver());
  const components = stubComponents(workspace, { driver: builder, reviewer });
  const runId = `${prefix}run` as RunId;
  const admitted = await admitRun(runRequest(runId, workspace, components, { policy: grantedPolicy(reviewerNarrowed) }));
  if (!admitted.ok) throw new Error(`R24: the L1 admission was refused as ${admitted.reason}: ${JSON.stringify(admitted)}`);
  const { vault } = components;
  for (const d of [builder, reviewer]) {
    d.vault = vault;
    d.runId = runId;
  }
  const state = await vault.readRunState(runId);
  const record = await readJson<AdmissionRecord>(vault, state.admission);
  const loaded = await loadLine(vault, record, state);
  // As `resumeRun` assembles it, with the admitted level read as `level`.
  const ctx: LineContext = {
    run: { ...record.run, requestedLevel: level },
    policy: record.policy,
    roles: record.roles,
    repoInstructions: record.repoInstructions ?? [],
    artifacts: loaded.artifacts,
    graph: loaded.graph,
    checks: loaded.checks,
    securityPart: loaded.securityPart,
    requirements: loaded.requirements,
    drafting: loaded.drafting,
    components,
    baseTreeSha256: record.baseTreeSha256,
    state,
  };
  const outcome = await runLine(ctx).catch((error: unknown) => error);
  return { builder, reviewer, vault, runId, record, outcome };
}

function seat(requests: readonly TaskRequest[], role: string): TaskRequest {
  const found = requests.find((r) => r.role.role === role);
  if (found === undefined) throw new Error(`R24: no ${role} request was made`);
  return found;
}

invariantTest(
  'I7.above-l2-repo-instructions-narrow-the-run-and-ride-the-suffix',
  "a run above L2 granted the set is narrowed through narrowRun with source repo-instructions, the narrowing recorded and committed before any model is called with the set, which the line's build and review steps place in each granted seat's variable suffix and never its stable prefix; at L2 the same steps place it in the prefix with nothing narrowed; a run whose seated roles declare no narrowed scope stops with the set withheld (R24, D-A-RI-02, D-A-RI-04, D-R10-06)",
  async () => {
    const above = await drivenAt('r24-above-', 3);
    expect(above.record.repoInstructions?.map((f) => [f.path, f.sha256])).toStrictEqual([['CLAUDE.md', createHash('sha256').update(`${MARKER}\n`).digest('hex')]]);
    const found = await narrowings(above.vault, above.runId);
    expect(found).toHaveLength(1);
    expect(found[0]?.decision).toMatchObject({ cause: 'capability-narrowed', decidedBy: 'line', narrowing: { kind: 'input', source: 'repo-instructions' } });
    expect(found[0]?.taskId).toBe('hello');
    // Every model call came after the narrowing was committed.
    expect(above.builder.narrowedAtCall.length).toBeGreaterThan(0);
    expect([...above.builder.narrowedAtCall, ...above.reviewer.narrowedAtCall].every(Boolean)).toBe(true);
    for (const req of [seat(above.builder.requests, BUILDER), seat(above.reviewer.requests, REVIEWER)]) {
      expect(req.variableSuffix).toContain(MARKER);
      expect(req.stablePrefix).not.toContain(MARKER);
    }

    const atL2 = await drivenAt('r24-at-l2-', 2);
    expect(await narrowings(atL2.vault, atL2.runId)).toHaveLength(0);
    for (const req of [seat(atL2.builder.requests, BUILDER), seat(atL2.reviewer.requests, REVIEWER)]) {
      expect(req.stablePrefix.startsWith('[repo-instructions]\n')).toBe(true);
      expect(req.stablePrefix).toContain(MARKER);
      expect(req.variableSuffix).not.toContain(MARKER);
    }

    const stuck = await drivenAt('r24-above-unnarrowed-', 3, false);
    expect(stuck.outcome).toBeInstanceOf(Error);
    expect(await narrowings(stuck.vault, stuck.runId)).toHaveLength(0);
    expect((await stuck.vault.readRunState(stuck.runId)).narrowed).toBeNull();
    expect([...stuck.builder.requests, ...stuck.reviewer.requests].some((r) => `${r.stablePrefix}${r.variableSuffix}`.includes(MARKER))).toBe(false);
  },
);
