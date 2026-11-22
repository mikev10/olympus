/**
 * The first run, for real (R36a, extended by R36b): `init`'s output — the
 * policy, roles, and rubrics it copies from the shipped examples, and the
 * manifest and graph it writes for the stack it detects — on the composed
 * host with the Claude Code driver in every seat, drafting the spec and the
 * tests as the README's first run does, through every gate a person holds at
 * L1, to a pull request merged on the GitHub held in process that the
 * composed line's paid case uses (D-I1a-07). No file is written by hand: the
 * repository is the calc corpus repository's product files, vitest 4 with a
 * hashed lockfile, and everything else is `init`'s.
 *
 * **These assertions call the model, so they cost money, and they need a
 * Docker daemon and `ANTHROPIC_API_KEY`.** They fail without either and are
 * never skipped. CI runs them only under the `run-driver` label, once per
 * tree. The run's measured cost is printed, for the pull request.
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeGitHub } from '@olympus-ai/conformance/fake-github';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { RunId } from '@olympus-ai/core';
import type { UsageRecord } from '@olympus-ai/vault';
import { afterAll, beforeAll, expect } from 'vitest';
import { approveStation, composeHost, initSetup, loadPolicyFile, parseGraph, readUsage, resumeRun, runStanding, startRun, worstCaseCost, type BuiltGraph, type RunOutcome, type RunRequest } from '../../src/index.js';

const CALC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'corpus', 'v1', 'repos', 'calc');
const runId = 'paid-init' as RunId;
/** The README's first run: the spec and the tests drafted from this intent. */
const INTENT = 'Add a function multiply(a, b) to src/math.ts that returns the product of two finite numbers, exported beside add.';

let base: string;
let github: FakeGitHub;
let components: BuiltGraph;
let outcome: RunOutcome;
let gates: string[];
let usage: UsageRecord[];
/** What the run recorded, printed only when it did not merge, so a failure in CI carries its own evidence. */
let records: string[];

beforeAll(async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key === '') throw new Error('the paid init suite needs ANTHROPIC_API_KEY; it is never skipped');
  base = await mkdtemp(join(tmpdir(), 'paid-init-'));
  const repository = join(base, 'repository');
  // A user's TypeScript repository: its own files, committed, with a GitHub origin, as a clone has.
  await mkdir(join(repository, 'test'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) await cp(join(CALC, file), join(repository, file));
  await cp(join(CALC, 'src'), join(repository, 'src'), { recursive: true });
  await cp(join(CALC, 'test', 'math.test.ts'), join(repository, 'test', 'math.test.ts'));
  await mkdir(join(base, 'store'), { recursive: true });
  github = new FakeGitHub({ token: 'paid-example-token' });
  await github.start();
  const baseCommit = await github.seed(repository);
  execFileSync('git', ['-C', repository, 'remote', 'add', 'origin', `https://github.com/${github.repository}.git`], { stdio: 'ignore' });
  // init, as the README has it: the setup outside the repository, the run files under .factory/, uncommitted.
  const config = join(base, 'config');
  const setup = await initSetup({ repository, configDirectory: config, baseBranch: github.baseBranch, hostHasUids: process.getuid !== undefined });
  if (!setup.ok) throw new Error(`init refused the repository: ${JSON.stringify(setup)}`);
  components = await composeHost({
    store: join(base, 'store'),
    repository,
    trees: join(base, 'trees'),
    modelKey: key,
    git: { repository: github.repository, baseBranch: github.baseBranch, token: 'paid-example-token', apiBase: github.apiBase },
  });
  const loaded = await loadPolicyFile(join(config, 'policy.yaml'));
  if (!loaded.ok) throw new Error(`init's policy does not load: ${JSON.stringify(loaded)}`);
  const request: RunRequest = {
    runId,
    baseCommit,
    requestedLevel: 1,
    workspace: repository,
    intent: { text: INTENT, from: 'principal' },
    artifacts: { spec: 'draft', acceptanceTests: 'draft', verificationManifest: '.factory/verify.json', taskGraph: '.factory/graph.json' },
    policy: loaded.policy,
    roles: join(config, 'roles'),
    rubrics: join(config, 'rubrics'),
    components,
    approvedCostUsd: null,
  };
  // The figure `create` prints, approved exactly, as a person does.
  const graph = parseGraph(JSON.parse(await readFile(join(repository, '.factory', 'graph.json'), 'utf8')), { runId, baseCommit, workspace: repository });
  if (!graph.ok) throw new Error(`init's graph does not parse: ${JSON.stringify(graph.problems)}`);
  outcome = await startRun({ ...request, approvedCostUsd: worstCaseCost(graph.graph, loaded.policy, ['spec', 'test-design']).usd });
  // Each gate the policy holds for a person, approved as `approve` does: a drafted exit by its draft's hash.
  gates = [];
  for (let gate = 0; gate < 6 && !outcome.ok && outcome.reason === 'refused' && outcome.transition.reason === 'approval-required'; gate++) {
    const { standing } = await runStanding(components.vault, runId);
    if (standing.standing !== 'awaiting-approval') break;
    gates.push(standing.key);
    const approved = await approveStation({ runId, key: standing.key, draft: standing.draft?.draft.sha256 ?? null, approvedBy: 'paid-init', vault: components.vault });
    if (!approved.ok) throw new Error(`approving ${standing.key} was refused: ${approved.message}`);
    outcome = await resumeRun({ runId, components });
  }
  const state = await components.vault.readRunState(runId);
  usage = await readUsage(components.vault, state);
  const text = async (ref: Parameters<typeof components.vault.read>[0]): Promise<string> => new TextDecoder().decode(await components.vault.read(ref)).slice(0, 3000);
  records = [
    ...(await Promise.all(state.evidenceRefs.map(async (ref) => `evidence ${await text(ref)}`))),
    ...(await Promise.all(Object.entries(state.results).map(async ([task, ref]) => `result ${task} ${await text(ref)}`))),
    ...(await Promise.all((await components.vault.readDecisions(runId)).map(async (ref) => `decision ${await text(ref)}`))),
  ];
}, 2_400_000);

afterAll(async () => {
  await github.stop();
  await rm(base, { recursive: true, force: true });
});

invariantTest(
  'I5.init-setup-merges-on-the-real-driver',
  "init's output on a TypeScript repository with vitest, with no file written by hand, drafting the spec and the tests from the README's intent, runs on the composed host with the Claude Code driver in every seat through each gate a person holds at L1 — the drafted spec, the drafted tests, and the merge — to a pull request merged into the base branch; paid (R36a, R36b)",
  async ({ annotate }) => {
    // The measured cost, for the pull request (R36a acceptance), as a test annotation the reporter prints.
    const metered = usage.filter((r) => r.reading.kind === 'metered');
    const cost = metered.reduce((sum, r) => sum + (r.reading.kind === 'metered' ? r.reading.costUsd : 0), 0);
    await annotate(`cost $${cost.toFixed(4)} over ${String(metered.length)} metered calls; gates ${gates.join(', ')}; ${metered.map((r) => `${r.taskId}@${r.station} ${JSON.stringify(r.reading)}`).join('; ')}`);
    if (!outcome.ok) await annotate(`run records:\n${records.join('\n')}`);
    expect(outcome, JSON.stringify(outcome).slice(0, 2000)).toMatchObject({ ok: true });
    expect(gates).toEqual(['spec:1', 'test-design:1', 'integrate:1']);
    const [pull] = github.pulls();
    expect(pull?.merged).toBe(true);
    if (pull?.mergeCommit == null) return;
    expect(github.head(github.baseBranch)).toBe(pull.mergeCommit);
    // What merged is the change the spec asked for, and not the run's own files.
    const files = github.files(pull.mergeCommit);
    expect(new TextDecoder().decode(files.get('src/math.ts')?.bytes)).toMatch(/export function multiply/u);
    expect([...files.keys()].some((path) => path.startsWith('.factory/') || path.startsWith('.drafts/'))).toBe(false);
  },
);
