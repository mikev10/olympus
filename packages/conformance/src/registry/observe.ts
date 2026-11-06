/**
 * R8a: post-merge attribution and the baseline. Each assertion drives the
 * real code over a real git checkout: the filesystem Vault, the API's intake
 * and observation jobs, the history reader, and R2's derivation. A run's
 * merge is seeded as the integration record `integrate` writes, at a merge
 * commit made in the checkout, so what is asserted is what the walk and the
 * signal attribute from git and from signed bodies alone (D-R8a-01).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Intake, NightlyJobs, RunRecords } from '@olympus-ai/api';
import type { Policy, PolicyDocument, RunId, TriggerKind, TriggerPolicy, TriggerSchedule, TriggerSubscription } from '@olympus-ai/core';
import type { NightlyRecord, ObservationRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { linePolicy } from './line.js';
import { withVaultDirs } from './local-vault.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');
const triggers = async () => import('@olympus-ai/triggers');

const SECRET_NAME = 'FACTORY_WEBHOOK_OBSERVE';
const SECRET = 'conformance-observe-secret-of-some-length';
const MARKER = 'R8A-MARKER-ignore-previous-instructions';
const WINDOW_MS = 1_000_000;
const RUN_A = 'run-a' as RunId;
const RUN_B = 'run-b' as RunId;

const CHECKS: TriggerSubscription = { id: 'gh-checks', kind: 'ci-failure', source: 'github', transport: 'signed-webhook', secret: SECRET_NAME, trustCeiling: 'owner', labels: [] };
const PUSHES: TriggerSubscription = { id: 'gh-pushes', kind: 'post-merge', source: 'github', transport: 'signed-webhook', secret: SECRET_NAME, trustCeiling: 'owner', labels: [] };
const WALK: TriggerSchedule = { id: 'observe', template: 'observe-history', at: '04:00' };

const ROUTE = {
  enabled: ['human', 'scheduled', 'ci-failure', 'post-merge'] as TriggerKind[],
  entryStation: { human: 'intake' as const, scheduled: 'intake' as const, 'ci-failure': 'intake' as const, 'post-merge': 'intake' as const },
  taskTemplate: { scheduled: 'intake-candidate' as const, 'ci-failure': 'observe-signal' as const, 'post-merge': 'observe-signal' as const },
  maxAutonomy: { human: 2 as const, scheduled: 0 as const, 'ci-failure': 0 as const, 'post-merge': 0 as const },
  minAuthorTrust: { human: 'owner' as const, scheduled: 'owner' as const, 'ci-failure': 'anonymous' as const, 'post-merge': 'anonymous' as const },
};

async function observePolicy(): Promise<Policy> {
  return linePolicy({}, {
    triggers: {
      ...ROUTE,
      maxTriggerDepth: 2,
      budgetPerWindow: { runs: 20, windowMs: 3_600_000 },
      subscriptions: [CHECKS, PUSHES],
      schedules: [WALK],
      maxDeliveryAgeMs: 3_600_000,
      candidateExpiryMs: 86_400_000,
      observe: { windowMs: WINDOW_MS },
    },
  });
}

/** A git checkout, run with a fixed identity and, where given, fixed dates. */
function gitIn(dir: string) {
  return (args: readonly string[], date?: string): string => execFileSync('git', ['-C', dir, '-c', 'user.email=r8a@example.invalid', '-c', 'user.name=r8a', '-c', 'core.autocrlf=false', ...args], {
    stdio: 'pipe', encoding: 'utf8',
    env: { ...process.env, ...(date === undefined ? {} : { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }) },
  }).trim();
}

const LINES = (n: number, change: Readonly<Record<number, string>> = {}): string => Array.from({ length: n }, (_, i) => change[i + 1] ?? `line ${String(i + 1)}`).join('\n') + '\n';

interface Repo {
  readonly dir: string;
  readonly git: ReturnType<typeof gitIn>;
  /** Commits `files` on a branch off main and merges it with --no-ff, as GitHub's merge method does; returns the merge commit. */
  merge(branch: string, files: Readonly<Record<string, string>>, subject: string, date?: string): Promise<string>;
  /** Commits `files` straight onto main; returns the commit. */
  commit(files: Readonly<Record<string, string>>, message: string, date?: string): Promise<string>;
}

async function repo(dir: string): Promise<Repo> {
  await mkdir(dir, { recursive: true });
  const git = gitIn(dir);
  git(['init', '-q', '-b', 'main']);
  const write = async (files: Readonly<Record<string, string>>): Promise<void> => {
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
    git(['add', '-A']);
  };
  await write({ 'a.txt': LINES(12), 'b.txt': 'b\n' });
  git(['commit', '-q', '-m', 'base'], '2026-09-01T00:00:00Z');
  return {
    dir, git,
    async merge(branch, files, subject, date) {
      git(['checkout', '-q', '-b', branch]);
      await write(files);
      git(['commit', '-q', '-m', `${subject} work`], date);
      git(['checkout', '-q', 'main']);
      git(['merge', '-q', '--no-ff', branch, '-m', subject], date);
      return git(['rev-parse', 'HEAD']);
    },
    async commit(files, message, date) {
      await write(files);
      git(['commit', '-q', '-m', message], date);
      return git(['rev-parse', 'HEAD']);
    },
  };
}

/** The record `integrate` writes once GitHub has merged a run's pull request (A-I1b-01). */
async function seedMerge(vault: Vault, runId: RunId, mergeCommit: string, mergedAt: string): Promise<void> {
  await vault.recordIntegration({
    runId, kind: 'merged', repository: 'octo/hello', baseBranch: 'main', baseCommit: mergeCommit, branch: `olympus/${runId}`, commit: mergeCommit,
    pullRequest: 1, url: 'https://github.com/octo/hello/pull/1', collectedBy: 'runtime', mergeCommit, mergedAt,
  });
}

interface Rig {
  readonly vault: Vault;
  readonly repo: Repo;
  readonly jobs: NightlyJobs;
  readonly intake: Intake;
  readonly policy: Policy;
  /** The walk's clock, in ms; set before a firing to move it. */
  readonly clock: { now: number };
}

async function withObserve<T>(prefix: string, body: (rig: Rig) => Promise<T>, target: 'checkout' | 'missing' = 'checkout'): Promise<T> {
  const { Intake: IntakeClass, NightlyJobs: Jobs, SCANNERS } = await api();
  const { LocalVault } = await import('@olympus-ai/vault');
  return withVaultDirs(prefix, async (dirs, base) => {
    const vault = new LocalVault(dirs);
    const r = await repo(join(base, 'target'));
    const clock = { now: Date.now() };
    const jobs = new Jobs({
      vault, sandbox: unusedSandbox(), workspaces: { root: join(base, 'trees'), user: { uid: 1000, gid: 1000 } }, limits: null, scanners: SCANNERS,
      target: { checkout: target === 'checkout' ? r.dir : join(base, 'no-such-checkout'), branch: 'main' }, now: () => clock.now,
    });
    const intake = new IntakeClass({ vault, secrets: (name) => (name === SECRET_NAME ? SECRET : undefined), jobs });
    return body({ vault, repo: r, jobs, intake, policy: await observePolicy(), clock });
  });
}

/** The walk provisions no sandbox; one that is asked for fails the assertion. */
function unusedSandbox() {
  const fail = (): never => {
    throw new Error('R8a: the history walk asked for a sandbox');
  };
  return { id: 'unused', provision: fail, exec: fail, destroy: fail, capabilities: () => ({ computerUse: false, gpu: false, os: 'linux' as const, persistent: false, remote: false }) };
}

async function walkOn(rig: Rig, date: string): Promise<NightlyRecord> {
  await rig.intake.fire(rig.policy, WALK, date);
  const entry = (await rig.vault.readNightly()).find((e) => e.record.schedule === WALK.id && e.record.date === date);
  if (entry === undefined) throw new Error(`R8a: no walk record for ${date}`);
  return entry.record;
}

const kinds = (records: ReadonlyArray<{ record: ObservationRecord }>, kind: ObservationRecord['signal']['kind']): ObservationRecord[] =>
  records.map((e) => e.record).filter((r) => r.signal.kind === kind);

async function signed(rig: Rig, subscription: TriggerSubscription, payload: unknown): Promise<string> {
  const { signBody } = await triggers();
  const body = Buffer.from(JSON.stringify(payload));
  const outcome = await rig.intake.deliver(rig.policy, subscription, signBody(body, SECRET), body);
  return outcome.outcome;
}

function checkFailure(sha: string, extra: Readonly<Record<string, unknown>> = {}): unknown {
  return {
    action: 'completed',
    check_run: { id: 4242, head_sha: sha, conclusion: 'failure', completed_at: new Date().toISOString().replace(/\.\d+Z$/u, 'Z'), name: `${MARKER} lint`, output: { title: MARKER, summary: MARKER }, ...extra },
    repository: { full_name: 'octo/hello' },
  };
}

function push(after: string, pushedAt: number): unknown {
  return { ref: 'refs/heads/main', after, head_commit: { message: MARKER }, repository: { full_name: 'octo/hello', default_branch: 'main', pushed_at: pushedAt } };
}

/** A merged run's records as R2 reads them, with the observations the store holds for it. */
async function mergedRun(vault: Vault, runId: RunId, mergedAt: string): Promise<RunRecords> {
  return {
    runId, ending: 'merged', requestedLevel: 2, stack: 'vitest@4', startedAt: mergedAt, mergedAt, approvalsSpent: 1,
    tasks: [], decisions: [], usage: [], cost: null, reviewGrade: 'different-family', critiques: [],
    observations: (await vault.readObservations(runId)).map((e) => e.record),
  };
}

const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

// ---------------------------------------------------------------------------

const ROLLBACK_BY_DIFF_ALONE = runtime({
  id: 'I2.observe-rollback-is-found-by-diff-alone',
  title: "a revert whose message names another run's change is attributed to the change its diff inverts, and a commit titled \"Revert\" whose diff inverts nothing is attributed to none",
  run: async () => {
    await withObserve('r8a-diff-', async (rig) => {
      const a = await rig.repo.merge('feature-a', { 'a.txt': LINES(12, { 2: 'two, changed by a' }), 'c.txt': 'c\n' }, 'Add c');
      const b = await rig.repo.merge('feature-b', { 'd.txt': 'd\n' }, 'Add d');
      await seedMerge(rig.vault, RUN_A, a, ago(10_000));
      await seedMerge(rig.vault, RUN_B, b, ago(10_000));
      // Titled as a revert of A, naming A's commit, and inverting nothing.
      const decoy = await rig.repo.commit({ 'b.txt': 'b, edited\n' }, `Revert "Add c"\n\nThis reverts commit ${a}.`);
      // A's real inverse, whose message names B.
      rig.repo.git(['revert', '-m', '1', '--no-edit', a]);
      rig.repo.git(['commit', '-q', '--amend', '-m', `Revert "Add d"\n\nThis reverts commit ${b}.`]);
      const revert = rig.repo.git(['rev-parse', 'HEAD']);
      const record = await walkOn(rig, '2026-11-05');
      if (record.outcome.kind !== 'completed') throw new Error(`I2: the walk was refused: ${JSON.stringify(record.outcome)}`);
      const onA = kinds(await rig.vault.readObservations(RUN_A), 'rollback');
      const onB = await rig.vault.readObservations(RUN_B);
      if (onA.length !== 1 || onA[0]?.signal.kind !== 'rollback' || onA[0].signal.commit !== revert) throw new Error(`I2: A's rollback by diff was not found: ${JSON.stringify(onA)}`);
      if (onB.some((e) => e.record.signal.kind === 'rollback' || e.record.signal.kind === 'partial-reversal')) throw new Error('I2: a revert message naming B attributed a rollback to B');
      const all = [...(await rig.vault.readObservations(RUN_A)), ...onB, ...(await rig.vault.readObservations(null))];
      if (all.some((e) => 'commit' in e.record.signal && e.record.signal.commit === decoy)) throw new Error('I2: a commit titled "Revert" that inverts nothing was attributed');
    });
  },
});

const PARTIAL_REPORTED_APART = runtime({
  id: 'I5.observe-partial-reversal-is-reported-apart',
  title: "a commit that inverts some of a change's hunks and not all is a partial reversal, reported on its own line and never counted as a rollback or a failure",
  run: async () => {
    const { deriveOutcomes } = await api();
    await withObserve('r8a-partial-', async (rig) => {
      const mergedAt = ago(2 * WINDOW_MS);
      const a = await rig.repo.merge('feature-a', { 'a.txt': LINES(12, { 2: 'two, changed', 10: 'ten, changed' }) }, 'Edit a twice');
      await seedMerge(rig.vault, RUN_A, a, mergedAt);
      const partial = await rig.repo.commit({ 'a.txt': LINES(12, { 10: 'ten, changed' }) }, 'tidy line two');
      await walkOn(rig, '2026-11-05');
      const own = await rig.vault.readObservations(RUN_A);
      const found = kinds(own, 'partial-reversal');
      if (found.length !== 1 || found[0]?.signal.kind !== 'partial-reversal' || found[0].signal.commit !== partial || found[0].signal.hunks !== 1 || found[0].signal.of !== 2) {
        throw new Error(`I5: the partial reversal was not reported as one of two hunks: ${JSON.stringify(found)}`);
      }
      if (kinds(own, 'rollback').length > 0) throw new Error('I5: a partial reversal was recorded as a rollback');
      const o = deriveOutcomes([await mergedRun(rig.vault, RUN_A, mergedAt)]);
      if (o.safety.observed.partialReversals.olympus !== 1 || o.safety.observed.rollbacks.olympus !== 0) throw new Error(`I5: the counts are ${JSON.stringify(o.safety.observed)}`);
      if (o.safety.escapedFalseDone.kind !== 'rate' || o.safety.escapedFalseDone.count !== 0) throw new Error('I5: a partial reversal was counted as an escaped false-done');
    });
  },
});

const SIGNAL_BY_COMMIT_ALONE = runtime({
  id: 'I7.observe-signal-is-attributed-by-commit-alone',
  title: "a failed check is recorded against the run whose merge commit it names whatever its other fields say, a commit no run merged is recorded unattributed, and no candidate is written",
  run: async () => {
    await withObserve('r8a-signal-', async (rig) => {
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      const b = await rig.repo.merge('feature-b', { 'd.txt': 'd\n' }, 'Add d');
      await seedMerge(rig.vault, RUN_A, a, ago(10_000));
      await seedMerge(rig.vault, RUN_B, b, ago(10_000));
      // Every field but the commit names B.
      const answered = await signed(rig, CHECKS, checkFailure(a, { external_id: RUN_B, check_suite: { head_branch: `olympus/${RUN_B}`, head_sha: b }, pull_requests: [{ number: 2, head: { sha: b } }] }));
      if (answered !== 'observed') throw new Error(`I7: the signal was answered ${answered}`);
      const onA = kinds(await rig.vault.readObservations(RUN_A), 'check-failure');
      if (onA.length !== 1 || onA[0]?.signal.kind !== 'check-failure' || onA[0].signal.checkRun !== '4242') throw new Error(`I7: the failure was not recorded against A by its commit: ${JSON.stringify(onA)}`);
      if ((await rig.vault.readObservations(RUN_B)).length > 0) throw new Error("I7: fields naming B attributed a signal to B");
      const stray = await rig.repo.commit({ 'b.txt': 'b, straight onto main\n' }, 'direct');
      await signed(rig, CHECKS, checkFailure(stray));
      const beside = kinds(await rig.vault.readObservations(null), 'check-failure');
      if (beside.length !== 1 || beside[0]?.runId !== null || beside[0].change !== stray) throw new Error(`I7: a commit no run merged was not recorded unattributed: ${JSON.stringify(beside)}`);
      const entries = await rig.vault.readTriggerDecisions();
      if (entries.some((e) => e.candidate !== null)) throw new Error('I7: a signal wrote a candidate');
      if (!entries.every((e) => e.decision.outcome.kind === 'observed')) throw new Error(`I7: a signal's decision is ${JSON.stringify(entries.map((e) => e.decision.outcome))}`);
    });
  },
});

const TEMPLATES_ON_THEIR_KINDS = runtime({
  id: 'I7.observe-templates-are-valid-only-on-their-kinds',
  title: 'observe-signal validates on post-merge and ci-failure alone and records only extracted fields; observe-history validates on scheduled alone',
  run: async () => {
    const { DEFAULT_POLICY_DOCUMENT, validatePolicyDocument } = await core();
    const doc = (t: Partial<TriggerPolicy>): PolicyDocument => ({
      ...DEFAULT_POLICY_DOCUMENT,
      triggers: { ...DEFAULT_POLICY_DOCUMENT.triggers, ...ROUTE, maxDeliveryAgeMs: 3_600_000, candidateExpiryMs: 86_400_000, observe: { windowMs: WINDOW_MS }, ...t },
    });
    const valid = validatePolicyDocument(doc({ schedules: [WALK] }));
    if (!valid.ok) throw new Error(`I7: the whole observe route was refused: ${JSON.stringify(valid.defects)}`);
    const issueRoute = {
      enabled: [...ROUTE.enabled, 'issue'] as TriggerKind[],
      entryStation: { ...ROUTE.entryStation, issue: 'intake' as const },
      maxAutonomy: { ...ROUTE.maxAutonomy, issue: 0 as const },
      minAuthorTrust: { ...ROUTE.minAuthorTrust, issue: 'owner' as const },
    };
    const refusedAt = (t: Partial<TriggerPolicy>, path: string, what: string): void => {
      const out = validatePolicyDocument(doc(t));
      if (out.ok || !out.defects.some((d) => d.path === path)) throw new Error(`I7: ${what} validated, or was refused elsewhere: ${JSON.stringify(out.ok ? [] : out.defects)}`);
    };
    refusedAt({ ...issueRoute, taskTemplate: { ...ROUTE.taskTemplate, issue: 'observe-signal' } }, 'triggers.taskTemplate.issue', 'observe-signal on issue');
    refusedAt({ taskTemplate: { ...ROUTE.taskTemplate, scheduled: 'observe-signal' } }, 'triggers.taskTemplate.scheduled', 'observe-signal on scheduled');
    refusedAt({ schedules: [{ id: 'sig', template: 'observe-signal', at: '05:00' }] }, 'triggers.schedules[0].template', 'a schedule naming observe-signal');
    refusedAt({ taskTemplate: { ...ROUTE.taskTemplate, 'ci-failure': 'observe-history' } }, 'triggers.taskTemplate.ci-failure', 'observe-history on ci-failure');
    refusedAt({ taskTemplate: { ...ROUTE.taskTemplate, 'post-merge': 'observe-history' } }, 'triggers.taskTemplate.post-merge', 'observe-history on post-merge');

    // What a signal records is the extracted fields: nothing else the body carries reaches the record.
    await withObserve('r8a-fields-', async (rig) => {
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      await seedMerge(rig.vault, RUN_A, a, ago(10_000));
      await signed(rig, CHECKS, checkFailure(a));
      await signed(rig, PUSHES, push(a, Math.floor(Date.now() / 1000)));
      const stored = JSON.stringify(await rig.vault.readObservations(RUN_A));
      if (stored.includes(MARKER)) throw new Error('I7: text outside the extracted fields reached an observation');
      if (kinds(await rig.vault.readObservations(RUN_A), 'pushed').length !== 1) throw new Error('I7: the push was not recorded as a provider-reported landing');
    });
  },
});

const UNREADABLE_HISTORY_REFUSED = runtime({
  id: 'I5.observe-unreadable-history-is-refused',
  title: 'a checkout the walk cannot read, and a recorded head the branch no longer descends from, are each a refusal naming its cause and never an empty walk',
  run: async () => {
    await withObserve('r8a-missing-', async (rig) => {
      const record = await walkOn(rig, '2026-11-05');
      if (record.outcome.kind !== 'refused' || !record.outcome.refusals.some((r) => r.part === 'history' && r.cause === 'history-unreadable')) {
        throw new Error(`I5: an unreadable checkout was ${JSON.stringify(record.outcome)}`);
      }
      if (record.observation?.to !== null) throw new Error('I5: an unreadable checkout recorded a head it walked to');
    }, 'missing');
    await withObserve('r8a-rewritten-', async (rig) => {
      await rig.repo.commit({ 'b.txt': 'b, one\n' }, 'one');
      const first = await walkOn(rig, '2026-11-05');
      if (first.outcome.kind !== 'completed') throw new Error(`I5: the first walk was refused: ${JSON.stringify(first.outcome)}`);
      // The branch is rewritten under the head the walk recorded.
      rig.repo.git(['reset', '-q', '--hard', 'HEAD~1']);
      await rig.repo.commit({ 'b.txt': 'b, rewritten\n' }, 'rewritten');
      const second = await walkOn(rig, '2026-11-06');
      if (second.outcome.kind !== 'refused' || !second.outcome.refusals.some((r) => r.cause === 'history-rewritten')) throw new Error(`I5: a rewritten range was ${JSON.stringify(second.outcome)}`);
      if (second.observation?.to !== null || second.observation.walked !== 0) throw new Error('I5: a rewritten range was recorded as walked');
    });
  },
});

export const OPEN_WINDOW_IN_NO_DENOMINATOR = runtime({
  id: 'I5.observe-open-window-is-in-no-denominator',
  title: "a run whose window has not closed is in no denominator, even with a rollback recorded, and is counted as observing; one whose window passed is moved out of observe with P14's record",
  run: async () => {
    const { deriveOutcomes } = await api();
    await withObserve('r8a-open-', async (rig) => {
      const oldMerge = ago(2 * WINDOW_MS);
      const freshMerge = ago(10_000);
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      const b = await rig.repo.merge('feature-b', { 'd.txt': 'd\n' }, 'Add d');
      await seedMerge(rig.vault, RUN_A, a, oldMerge);
      await seedMerge(rig.vault, RUN_B, b, freshMerge);
      rig.repo.git(['revert', '-m', '1', '--no-edit', b]);
      await walkOn(rig, '2026-11-05');
      if (kinds(await rig.vault.readObservations(RUN_B), 'rollback').length !== 1) throw new Error("I5: B's rollback was not recorded");
      if (kinds(await rig.vault.readObservations(RUN_B), 'window-closed').length !== 0) throw new Error("I5: B's window closed before it passed");
      if (kinds(await rig.vault.readObservations(RUN_A), 'window-closed').length !== 1) throw new Error("I5: A's window did not close once it passed");
      const decisions = await Promise.all((await rig.vault.readDecisions(RUN_A)).map(async (ref) => JSON.parse(new TextDecoder().decode(await rig.vault.read(ref))) as { decision: { cause: string; decidedBy: string } }));
      if (!decisions.some((d) => d.decision.cause === 'observation-closed' && d.decision.decidedBy === 'observe')) throw new Error("I5: A's window closed with no record in P14's");
      const o = deriveOutcomes([await mergedRun(rig.vault, RUN_A, oldMerge), await mergedRun(rig.vault, RUN_B, freshMerge)]);
      const escaped = o.safety.escapedFalseDone;
      if (escaped.kind !== 'rate' || escaped.sample !== 1 || escaped.count !== 0) throw new Error(`I5: an open window entered a denominator: ${JSON.stringify(escaped)}`);
      if (o.safety.observed.observing !== 1 || o.safety.observed.perRun[RUN_B] !== 'observing') throw new Error(`I5: B is not counted as observing: ${JSON.stringify(o.safety.observed)}`);
    });
  },
});

const WINDOW_REQUIRED = runtime({
  id: 'I5.observe-window-is-required',
  title: 'a policy that names observe-signal or observe-history with no observation window is refused, and no window is implied',
  run: async () => {
    const { DEFAULT_POLICY_DOCUMENT, validatePolicyDocument } = await core();
    const base = { ...DEFAULT_POLICY_DOCUMENT.triggers, ...ROUTE, maxDeliveryAgeMs: 3_600_000, candidateExpiryMs: 86_400_000 };
    const signalOnly = validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, triggers: base });
    if (signalOnly.ok || !signalOnly.defects.some((d) => d.path === 'triggers.observe')) throw new Error('I5: observe-signal with no window validated');
    const walkOnly = validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, triggers: { ...base, taskTemplate: { scheduled: 'intake-candidate' }, enabled: ['human', 'scheduled'], schedules: [WALK] } });
    if (walkOnly.ok || !walkOnly.defects.some((d) => d.path === 'triggers.observe')) throw new Error('I5: observe-history with no window validated');
    const zero = validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, triggers: { ...base, observe: { windowMs: 0 } } });
    if (zero.ok) throw new Error('I5: a window of zero validated');
    const whole = validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, triggers: { ...base, observe: { windowMs: WINDOW_MS } } });
    if (!whole.ok) throw new Error(`I5: a policy with its window was refused: ${JSON.stringify(whole.defects)}`);
  },
});

const RATES_BOUND_AND_BASELINE = runtime({
  id: 'I2.observe-rates-carry-bound-and-baseline',
  title: "R2's escaped rate carries its sample and bound, the baseline sits beside each rate, time to restore keeps provider-reported and committer-claimed times apart, and a one-parent change's lead time is not measurable",
  run: async () => {
    const { deriveOutcomes, outcomes } = await api();
    await withObserve('r8a-rates-', async (rig) => {
      const mergedAt = ago(2 * WINDOW_MS);
      const m = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c', '2026-10-01T00:00:00Z');
      await seedMerge(rig.vault, RUN_A, m, mergedAt);
      const direct = await rig.repo.commit({ 'e.txt': 'e\n' }, 'Add e', '2026-10-01T01:00:00Z');
      await rig.repo.merge('feature-f', { 'f.txt': 'f\n' }, 'Add f', '2026-10-01T02:00:00Z');
      rig.repo.git(['revert', '-m', '1', '--no-edit', m], '2026-10-01T03:00:00Z');
      const rollback = rig.repo.git(['rev-parse', 'HEAD']);
      rig.repo.git(['revert', '--no-edit', direct], '2026-10-01T04:00:00Z');
      // The run's rollback landed by a push GitHub reported; the baseline's did not.
      const pushedAt = Math.floor(Date.now() / 1000);
      await signed(rig, PUSHES, push(rollback, pushedAt));
      await walkOn(rig, '2026-11-05');
      rig.clock.now += WINDOW_MS + 1;
      await walkOn(rig, '2026-11-06');

      const run = await mergedRun(rig.vault, RUN_A, mergedAt);
      const o = deriveOutcomes([run], {}, { observations: (await rig.vault.readObservations(null)).map((e) => e.record) });
      const escaped = o.safety.escapedFalseDone;
      if (escaped.kind !== 'rate' || escaped.count !== 1 || escaped.sample !== 1 || escaped.bound.side !== 'upper' || !(escaped.bound.value > 0)) {
        throw new Error(`I2: the escaped rate carries no sample and bound: ${JSON.stringify(escaped)}`);
      }
      const base = o.safety.observed.changeFailure.baseline;
      if (base.kind !== 'rate' || base.count !== 1 || base.sample !== 4) throw new Error(`I2: the baseline is not beside the rate: ${JSON.stringify(o.safety.observed.changeFailure)}`);
      const own = o.throughput.timeToRestore.olympus;
      if (own.providerReported.kind !== 'distribution' || own.providerReported.median !== pushedAt * 1000 - Date.parse(mergedAt) || own.committerClaimed.kind !== 'no-sample') {
        throw new Error(`I2: Olympus's time to restore combines sources: ${JSON.stringify(own)}`);
      }
      const theirs = o.throughput.timeToRestore.baseline;
      if (theirs.committerClaimed.kind !== 'distribution' || theirs.committerClaimed.median !== 3 * 3_600_000 || theirs.providerReported.kind !== 'no-sample') {
        throw new Error(`I2: the baseline's time to restore combines sources: ${JSON.stringify(theirs)}`);
      }
      const lead = o.throughput.baselineLeadTime;
      if (lead.committerClaimed.kind !== 'distribution' || lead.committerClaimed.sample !== 1 || lead.notMeasurable !== 3) throw new Error(`I2: lead time is ${JSON.stringify(lead)}`);
      if (!o.boundAssumption.includes('not independent')) throw new Error('I2: the report does not say its bounds assume independent runs');
      // The store-wide report reads the baseline beside the runs too.
      const whole = await outcomes(rig.vault);
      if (whole.safety.observed.changeFailure.baseline.kind !== 'rate') throw new Error('I2: the report read no baseline');
    });
  },
});

export const R8A_I2: readonly LocalAssertion[] = [ROLLBACK_BY_DIFF_ALONE, RATES_BOUND_AND_BASELINE];
export const R8A_I5: readonly LocalAssertion[] = [PARTIAL_REPORTED_APART, UNREADABLE_HISTORY_REFUSED, OPEN_WINDOW_IN_NO_DENOMINATOR, WINDOW_REQUIRED];
export const R8A_I7: readonly LocalAssertion[] = [SIGNAL_BY_COMMIT_ALONE, TEMPLATES_ON_THEIR_KINDS];
