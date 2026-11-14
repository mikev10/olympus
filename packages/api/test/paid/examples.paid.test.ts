/**
 * The shipped example, run for real (R36a): `examples/` — the policy, the
 * roles, the rubrics, and the run files — exactly as shipped, on the composed
 * host with the Claude Code driver in every seat, drafting its spec from an
 * intent as the README's first run does, through every gate a person holds
 * at L1, to a pull request merged on the GitHub held in process that the
 * composed line's paid case uses (D-I1a-07). No file outside `examples/` is
 * written but the user repository's own `package.json` and lockfile.
 *
 * **These assertions call the model, so they cost money, and they need a
 * Docker daemon and `ANTHROPIC_API_KEY`.** They fail without either and are
 * never skipped. CI runs them only under the `run-driver` label, once per
 * tree. The run's measured cost is printed, for the pull request.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashedLockfile } from '@olympus-ai/adapters';
import { FakeGitHub } from '@olympus-ai/conformance/fake-github';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { RunId } from '@olympus-ai/core';
import type { UsageRecord } from '@olympus-ai/vault';
import { afterAll, beforeAll, expect } from 'vitest';
import { approveStation, composeHost, loadPolicyFile, parseGraph, readUsage, resumeRun, runStanding, startRun, worstCaseCost, type BuiltGraph, type RunOutcome, type RunRequest } from '../../src/index.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'examples');
const runId = 'paid-example' as RunId;
/** The README's smallest first run: the spec drafted from this intent. */
const INTENT = 'Add hello.txt at the repository root, saying hello.';

let base: string;
let github: FakeGitHub;
let components: BuiltGraph;
let outcome: RunOutcome;
let gates: string[];
let usage: UsageRecord[];

beforeAll(async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key === '') throw new Error('the paid example suite needs ANTHROPIC_API_KEY; it is never skipped');
  base = await mkdtemp(join(tmpdir(), 'paid-example-'));
  const repository = join(base, 'repository');
  // A user's JavaScript repository, with the run files copied in as the README says; the commit holds only its own files.
  await mkdir(repository, { recursive: true });
  await writeFile(join(repository, 'package.json'), JSON.stringify({ name: 'user-repo', private: true }));
  await writeFile(join(repository, 'package-lock.json'), hashedLockfile('user-repo', []));
  await mkdir(join(base, 'store'), { recursive: true });
  github = new FakeGitHub({ token: 'paid-example-token' });
  await github.start();
  const baseCommit = await github.seed(repository);
  await cp(join(EXAMPLES, 'run'), join(repository, 'run'), { recursive: true });
  components = await composeHost({
    store: join(base, 'store'),
    repository,
    trees: join(base, 'trees'),
    modelKey: key,
    git: { repository: github.repository, baseBranch: github.baseBranch, token: 'paid-example-token', apiBase: github.apiBase },
  });
  const loaded = await loadPolicyFile(join(EXAMPLES, 'policy.yaml'));
  if (!loaded.ok) throw new Error(`the example policy does not load: ${JSON.stringify(loaded)}`);
  const request: RunRequest = {
    runId,
    baseCommit,
    requestedLevel: 1,
    workspace: repository,
    intent: { text: INTENT, from: 'principal' },
    artifacts: { spec: 'draft', acceptanceTests: ['run/acceptance.md'], verificationManifest: 'run/verify.json', taskGraph: 'run/graph.json' },
    policy: loaded.policy,
    roles: join(EXAMPLES, 'roles'),
    rubrics: join(EXAMPLES, 'rubrics'),
    components,
    approvedCostUsd: null,
  };
  // The figure `create` prints, approved exactly, as a person does.
  const graph = parseGraph(JSON.parse(await readFile(join(repository, 'run', 'graph.json'), 'utf8')), { runId, baseCommit, workspace: repository });
  if (!graph.ok) throw new Error(`the example graph does not parse: ${JSON.stringify(graph.problems)}`);
  outcome = await startRun({ ...request, approvedCostUsd: worstCaseCost(graph.graph, loaded.policy, ['spec']).usd });
  // Each gate the policy holds for a person, approved as `olympus-ai approve` does: a drafted exit by its draft's hash.
  gates = [];
  for (let gate = 0; gate < 6 && !outcome.ok && outcome.reason === 'refused' && outcome.transition.reason === 'approval-required'; gate++) {
    const { standing } = await runStanding(components.vault, runId);
    if (standing.standing !== 'awaiting-approval') break;
    gates.push(standing.key);
    const approved = await approveStation({ runId, key: standing.key, draft: standing.draft?.draft.sha256 ?? null, approvedBy: 'paid-example', vault: components.vault });
    if (!approved.ok) throw new Error(`approving ${standing.key} was refused: ${approved.message}`);
    outcome = await resumeRun({ runId, components });
  }
  usage = await readUsage(components.vault, await components.vault.readRunState(runId));
}, 2_400_000);

afterAll(async () => {
  await github.stop();
  await rm(base, { recursive: true, force: true });
});

invariantTest(
  'I5.shipped-example-merges-on-the-real-driver',
  "the shipped examples, unmodified, drafting the spec from the README's intent, run on the composed host with the Claude Code driver in every seat through each gate a person holds at L1 — the drafted spec, the tests, and the merge — to a pull request merged into the base branch; paid (#145, #148 to #152, #154)",
  async ({ annotate }) => {
    // The measured cost, for the pull request (R36a acceptance), as a test annotation the reporter prints.
    const metered = usage.filter((r) => r.reading.kind === 'metered');
    const cost = metered.reduce((sum, r) => sum + (r.reading.kind === 'metered' ? r.reading.costUsd : 0), 0);
    await annotate(`cost $${cost.toFixed(4)} over ${String(metered.length)} metered calls; gates ${gates.join(', ')}; ${metered.map((r) => `${r.taskId}@${r.station} ${JSON.stringify(r.reading)}`).join('; ')}`);
    expect(outcome, JSON.stringify(outcome).slice(0, 2000)).toMatchObject({ ok: true });
    expect(gates).toEqual(['spec:1', 'test-design:1', 'integrate:1']);
    const [pull] = github.pulls();
    expect(pull?.merged).toBe(true);
    if (pull?.mergeCommit == null) return;
    expect(github.head(github.baseBranch)).toBe(pull.mergeCommit);
    // What merged is the change the spec asked for, and not the run's own files.
    const files = github.files(pull.mergeCommit);
    expect(new TextDecoder().decode(files.get('hello.txt')?.bytes).trim()).toBe('hello');
    expect([...files.keys()].some((path) => path.startsWith('run/') || path.startsWith('.drafts/'))).toBe(false);
  },
);
