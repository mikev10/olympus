/**
 * R13b: the nightly reviewers. Each assertion drives the real code: the
 * filesystem Vault, the API's intake and nightly jobs, the compiler over the
 * shipped roles, and R1's tree reader over a real git checkout. The driver
 * and the sandbox record what they are asked for and answer with a scripted
 * result, so what the jobs put in front of a seat, and how they mount it, is
 * what is asserted (D-R13b-01).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Intake, NightlyJobs } from '@olympus-ai/api';
import type {
  AutonomyLevel, CompiledRole, Driver, DriverCapabilities, DriverEvent, ModelFamily, ModelIdentity, ModelTier, Policy, RoleId, RunId,
  TaskId, TaskRequest, TaskResult, TriggerSchedule,
} from '@olympus-ai/core';
import type { RelaySpec, SandboxHandle, SandboxProvider, SandboxSpec, Teardown, ExecResult } from '@olympus-ai/sandbox';
import type { NightlyRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { linePolicy, lineScope } from './line.js';
import { withVaultDirs } from './local-vault.js';

const api = async () => import('@olympus-ai/api');

/** Text a record or a reviewer carries, which no prompt may hold. */
const MARKER = 'r13b-marker-ignore-previous-instructions';
const RUN = 'run-reviewed' as RunId;
const ROLE_HASH = 'a'.repeat(64);

const FINDINGS: TriggerSchedule = { id: 'findings', template: 'nightly-findings-review', at: '04:00' };
const TREE: TriggerSchedule = { id: 'tree', template: 'nightly-tree-review', at: '05:00' };

/** The firing date, and the day the findings review covers: the one before (D-R13b-04). */
const FIRED = '2026-11-03';
const DAY = '2026-11-02';

async function reviewPolicy(level: AutonomyLevel): Promise<Policy> {
  return linePolicy({}, {
    roles: {
      ['builder' as RoleId]: lineScope(['build', 'verify'], 'standard'),
      ['reviewer' as RoleId]: lineScope(['review'], 'deep'),
      ['security-reviewer' as RoleId]: lineScope(['review'], 'deep'),
      ['findings-reviewer' as RoleId]: lineScope(['review'], 'deep'),
    },
    triggers: {
      enabled: ['human', 'scheduled'],
      entryStation: { human: 'intake', scheduled: 'intake' },
      taskTemplate: { scheduled: 'intake-candidate' },
      maxAutonomy: { human: 2, scheduled: level },
      minAuthorTrust: { human: 'owner', scheduled: 'owner' },
      maxTriggerDepth: 2,
      budgetPerWindow: { runs: 20, windowMs: 3_600_000 },
      schedules: [FINDINGS, TREE],
      maxDeliveryAgeMs: 3_600_000,
      candidateExpiryMs: 86_400_000,
    },
  });
}

function model(family: string): ModelIdentity {
  return { provider: family, family: family as ModelFamily, model: `${family}-model`, version: '1' };
}

/** A reviewer driver of a chosen family, which records every request and answers each with `narrative`. */
class ScriptedDriver implements Driver {
  readonly id = 'scripted';
  readonly contractVersion = '1';
  readonly requests: TaskRequest[] = [];
  constructor(private readonly family: string, public narrative = '{"findings":[]}') {}
  provenanceId(): string {
    return `scripted-${this.family}@1`;
  }
  capabilities(): DriverCapabilities {
    return { subagents: false, hooks: false, mcp: false, parallelism: 1, computerUse: false, steering: false, stablePrefixCaching: false };
  }
  declaredTools(): readonly string[] {
    return ['read'];
  }
  resolveModel(_tier: ModelTier): ModelIdentity {
    return model(this.family);
  }
  relayRequest(): Omit<RelaySpec, 'budget'> {
    const price = { inputPerMTok: 1, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, cacheWrite1hPerMTok: 2 };
    return {
      upstream: 'https://api.example.invalid', paths: ['/v1/messages'], header: 'x-api-key', scheme: 'raw', credential: 'k', urlVariable: 'MODEL_BASE_URL',
      meter: { dialect: 'anthropic-messages', prices: { [model(this.family).model]: price } },
    };
  }
  runTask(req: TaskRequest): Promise<TaskResult> {
    this.requests.push(req);
    return Promise.resolve({
      taskId: req.taskId, claim: { narrative: this.narrative, filesChanged: [] }, events: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, wallClockMs: 0 },
      model: this.resolveModel(req.tier), contractVersion: this.contractVersion,
    });
  }
  cancel(_taskId: TaskId): Promise<void> {
    return Promise.resolve();
  }
  emitArtifacts(_roles: CompiledRole[], _targetDir: string): Promise<void> {
    return Promise.resolve();
  }
  on(_kind: DriverEvent['kind'], _handler: (e: DriverEvent) => void): void {
    // Nothing fires.
  }
}

/** Records every sandbox asked for, with what its one mount held when it was provisioned. */
class RecordingProvider implements SandboxProvider {
  readonly id = 'recording';
  readonly provisioned: Array<{ readonly spec: SandboxSpec; readonly listed: readonly string[] }> = [];
  async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    this.provisioned.push({ spec, listed: (await readdir(spec.mounts.workspace.source)).sort() });
    return `h${String(this.provisioned.length)}` as SandboxHandle;
  }
  exec(): Promise<ExecResult> {
    return Promise.reject(new Error('a reviewer seat runs no command of the runtime\'s'));
  }
  destroy(): Promise<Teardown> {
    return Promise.resolve({ meter: { kind: 'unmetered' }, egress: { kind: 'none' } });
  }
  capabilities() {
    return { computerUse: false, gpu: false, os: 'linux' as const, persistent: false, remote: false };
  }
}

/** A git checkout whose `main` holds three files; returns the head commit. */
async function checkout(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=r13b@example.invalid', '-c', 'user.name=r13b', '-c', 'core.autocrlf=false', ...args], { stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  await writeFile(join(dir, 'package.json'), '{ "name": "target" }\n');
  await writeFile(join(dir, 'index.js'), 'const a = 1;\nconst b = 2;\nmodule.exports = a + b;\n');
  await writeFile(join(dir, 'README.md'), '# target\n');
  git('add', '.');
  git('commit', '-q', '-m', 'target');
  return git('rev-parse', 'HEAD').toString().trim();
}

interface Rig {
  readonly vault: Vault;
  readonly intake: Intake;
  readonly jobs: NightlyJobs;
  readonly driver: ScriptedDriver;
  readonly sandbox: RecordingProvider;
  readonly head: string;
  /** Moves the runtime's clock. */
  readonly at: (iso: string) => void;
}

async function withReview<T>(prefix: string, family: string, body: (rig: Rig) => Promise<T>): Promise<T> {
  const { Intake: IntakeClass, NightlyJobs: Jobs, SCANNERS } = await api();
  const { DEFAULT_ROLES_DIRECTORY } = await import('@olympus-ai/compiler');
  const { LocalVault } = await import('@olympus-ai/vault');
  return withVaultDirs(prefix, async (dirs, base) => {
    const vault = new LocalVault(dirs);
    const target = join(base, 'target');
    const head = await checkout(target);
    const sandbox = new RecordingProvider();
    const driver = new ScriptedDriver(family);
    let clock = Date.parse(`${FIRED}T04:00:00.000Z`);
    const now = () => clock;
    const jobs = new Jobs({
      vault, sandbox, workspaces: { root: join(base, 'trees'), user: { uid: 1000, gid: 1000 } }, limits: null, scanners: SCANNERS,
      target: { checkout: target, branch: 'main' }, seat: { driver, roles: DEFAULT_ROLES_DIRECTORY, image: 'none' }, now,
    });
    const intake = new IntakeClass({ vault, secrets: () => undefined, jobs, now });
    return body({ vault, intake, jobs, driver, sandbox, head, at: (iso) => { clock = Date.parse(iso); } });
  });
}

/** One call a builder of `family` made for the run, and one its reviewer made, which is no author's (D-R13b-05). */
async function seedRun(vault: Vault, head: string, family = 'claude'): Promise<void> {
  const call = (taskId: string, station: 'build' | 'review', role: string, f: string) => vault.recordUsage({
    runId: RUN, taskId: taskId as TaskId, station, attempt: 1, model: model(f), role: { id: role as RoleId, sha256: ROLE_HASH }, driver: `scripted-${f}@1`,
    reading: { kind: 'unmetered' }, timing: { startedAt: `${DAY}T09:00:00.000Z`, endedAt: `${DAY}T09:01:00.000Z` }, collectedBy: 'runtime',
  });
  await call('build-1', 'build', 'builder', family);
  await call('review-1', 'review', 'reviewer', 'judge');
  await vault.recordIntegration({
    runId: RUN, kind: 'merged', repository: 'owner/target', baseBranch: 'main', baseCommit: head, branch: 'factory/run', commit: head,
    pullRequest: 1, url: 'https://example.invalid/pull/1', mergeCommit: head, mergedAt: `${DAY}T09:30:00.000Z`, collectedBy: 'runtime',
  });
  // A decision of the reviewed day whose host is the agent's text (I7).
  await vault.recordDecision({
    runId: RUN, taskId: 'build-1' as TaskId, station: 'build', decidedAt: `${DAY}T10:00:00.000Z`, occurrence: 'r13b-seed',
    decision: { cause: 'egress-connection', decidedBy: 'egress-proxy', connection: { verdict: 'refused', host: `${MARKER}.example`, at: `${DAY}T10:00:00.000Z` } },
    collectedBy: 'runtime',
  });
}

async function recordOn(vault: Vault, schedule: string, date: string): Promise<NightlyRecord> {
  const entry = (await vault.readNightly()).find((e) => e.record.schedule === schedule && e.record.date === date);
  if (entry === undefined) throw new Error(`R13b: no nightly record for ${schedule} on ${date}`);
  return entry.record;
}

function prompt(req: TaskRequest): string {
  return `${req.stablePrefix}\n${req.variableSuffix}`;
}

const FAMILY_DIFFERS = runtime({
  id: 'I6.nightly-reviewer-family-differs-from-every-author',
  title: "each nightly reviewer's family is checked against every author's through seatReviewer: where the policy lets scheduled work reach L3, a reviewer sharing an author's family is refused before it is called, and one of another family is seated and graded different-family; a judging seat's call is no author",
  run: async () => {
    for (const schedule of [FINDINGS, TREE]) {
      await withReview('r13b-family-same-', 'claude', async ({ vault, intake, driver, head }) => {
        await seedRun(vault, head);
        await intake.fire(await reviewPolicy(3), schedule, FIRED);
        const record = await recordOn(vault, schedule.id, FIRED);
        if (record.outcome.kind !== 'refused' || !record.outcome.refusals.some((r) => r.cause === 'seat-refused')) {
          throw new Error(`I6: ${schedule.template} seated a reviewer of its author's family at L3: ${JSON.stringify(record.outcome)}`);
        }
        if (driver.requests.length !== 0) throw new Error(`I6: ${schedule.template} called a refused seat`);
      });
      await withReview('r13b-family-other-', 'gpt', async ({ vault, intake, driver, head }) => {
        await seedRun(vault, head);
        await intake.fire(await reviewPolicy(3), schedule, FIRED);
        const record = await recordOn(vault, schedule.id, FIRED);
        const seat = record.review?.seat;
        if (record.outcome.kind !== 'completed' || seat?.independence !== 'different-family' || driver.requests.length !== 1) {
          throw new Error(`I6: ${schedule.template} did not seat a reviewer of another family: ${JSON.stringify(record.outcome)} ${JSON.stringify(seat)}`);
        }
        if (seat.authors.length !== 1 || seat.authors[0]?.model.family !== 'claude') throw new Error(`I6: the authors are not the builder alone: ${JSON.stringify(seat.authors)}`);
      });
    }
  },
});

const REDUCED_RECORDED = runtime({
  id: 'I6.nightly-reduced-independence-is-recorded',
  title: "below L3, a nightly reviewer that shares an author's family is seated and its record names the reduced grade, the authors, and the level it was checked at, never different-family",
  run: async () => {
    for (const schedule of [FINDINGS, TREE]) {
      await withReview('r13b-reduced-', 'claude', async ({ vault, intake, head }) => {
        await seedRun(vault, head);
        await intake.fire(await reviewPolicy(1), schedule, FIRED);
        const record = await recordOn(vault, schedule.id, FIRED);
        const seat = record.review?.seat;
        if (record.outcome.kind !== 'completed' || seat === undefined || seat === null) throw new Error(`I6: ${schedule.template} was not seated below L3: ${JSON.stringify(record.outcome)}`);
        if (seat.independence === 'different-family' || seat.independence === 'no-author' || seat.level !== 1 || seat.authors.length !== 1) {
          throw new Error(`I6: ${schedule.template} did not record reduced independence: ${JSON.stringify(seat)}`);
        }
      });
    }
  },
});

const TYPED_FIELDS_ONLY = runtime({
  id: 'I7.nightly-reviewer-gets-typed-fields-only',
  title: "the findings reviewer is given the day's records as runtime ids and typed fields: a host the agent chose, a violation's detail, and every other text a record carries never reach its prompt",
  run: async () => {
    await withReview('r13b-typed-', 'gpt', async ({ vault, intake, driver, head }) => {
      await seedRun(vault, head);
      const violation = await vault.recordViolation({
        runId: RUN, taskId: 'build-1' as TaskId, kind: 'prompt-injection', role: 'builder' as RoleId, driverProvenanceId: 'scripted-claude@1', contractVersion: '1',
        detectedAt: `${DAY}T11:00:00.000Z`, detail: { note: MARKER },
      });
      await vault.recordDecision({
        runId: RUN, taskId: 'build-1' as TaskId, station: 'build', decidedAt: `${DAY}T11:00:00.000Z`, occurrence: 'r13b-violation',
        decision: { cause: 'violation-recorded', decidedBy: 'line', violation }, collectedBy: 'runtime',
      });
      await intake.fire(await reviewPolicy(1), FINDINGS, FIRED);
      const [request] = driver.requests;
      if (request === undefined) throw new Error('I7: the findings reviewer was never seated over a day that held records');
      const text = prompt(request);
      if (text.includes(MARKER)) throw new Error("I7: a record's text reached the findings reviewer's prompt");
      if (!text.includes('egress-connection') || !text.includes('prompt-injection')) throw new Error("I7: the day's records are not in the prompt as typed fields");
      const record = await recordOn(vault, FINDINGS.id, FIRED);
      if (record.review?.subject?.kind !== 'day' || JSON.stringify(record.review.subject).includes(MARKER)) throw new Error('I7: the recorded subject holds text a record carried');
    });
  },
});

const CLAIM_NEVER_PROMPTED = runtime({
  id: 'I7.nightly-claim-never-enters-a-prompt',
  title: "a nightly reviewer's text is kept as its claim in the nightly record, and the next night's findings reviewer, given that day, is never given it",
  run: async () => {
    await withReview('r13b-claim-', 'gpt', async ({ vault, intake, driver, at }) => {
      driver.narrative = JSON.stringify({ findings: [{ category: 'unchecked-input', path: 'index.js', line: 2, note: MARKER }] });
      at(`${DAY}T05:00:00.000Z`);
      await intake.fire(await reviewPolicy(1), TREE, DAY);
      const tree = await recordOn(vault, TREE.id, DAY);
      if (tree.review?.claim?.narrative.includes(MARKER) !== true) throw new Error("I7: the reviewer's text is not kept as its claim");
      if (!tree.review.findings.some((f) => f.kind === 'tree')) throw new Error('I7: the located finding was not recorded');
      driver.narrative = '{"findings":[]}';
      at(`${FIRED}T04:00:00.000Z`);
      await intake.fire(await reviewPolicy(1), FINDINGS, FIRED);
      const later = driver.requests.at(-1);
      if (later === undefined || driver.requests.length !== 2) throw new Error('I7: the findings reviewer was not seated over the day the tree review ran');
      if (prompt(later).includes(MARKER)) throw new Error("I7: a reviewer's claim reached a later prompt");
      if (!prompt(later).includes('trigger:')) throw new Error("I7: the day's trigger decisions, the tree finding's candidate among them, are not in the prompt");
    });
  },
});

const UNLOCATED_REFUSED = runtime({
  id: 'I5.nightly-unlocated-finding-is-refused',
  title: 'a whole-tree finding naming a file the tree does not hold, a line its file does not have, or a category outside the closed list, and a findings-review finding naming no record of the day, is refused and recorded as refused, never a candidate; an unreadable result refuses the job',
  run: async () => {
    await withReview('r13b-unlocated-', 'gpt', async ({ vault, intake, driver, head }) => {
      await seedRun(vault, head);
      driver.narrative = JSON.stringify({
        findings: [
          { category: 'unchecked-input', path: 'index.js', line: 3 },
          { category: 'unchecked-input', path: 'missing.js', line: 1 },
          { category: 'unchecked-input', path: 'index.js', line: 4 },
          { category: 'anything-at-all', path: 'index.js', line: 1 },
        ],
      });
      await intake.fire(await reviewPolicy(1), TREE, FIRED);
      const tree = await recordOn(vault, TREE.id, FIRED);
      const kinds = tree.review?.findings.map((f) => (f.kind === 'refused' ? f.cause : f.kind)).join(',');
      if (kinds !== 'tree,unlocated,unlocated,unrecordable') throw new Error(`I5: the tree findings were not each located or refused: ${String(kinds)}`);
      const candidates = (await vault.readTriggerDecisions()).filter((e) => e.decision.source === `nightly:${TREE.id}` && e.candidate !== null);
      if (candidates.length !== 1 || candidates[0]?.candidate?.schema !== 'nightly-tree-finding') throw new Error(`I5: ${String(candidates.length)} candidates for one located finding`);

      driver.narrative = JSON.stringify({ findings: [{ category: 'violation', record: `decision:${'0'.repeat(64)}` }] });
      await intake.fire(await reviewPolicy(1), FINDINGS, FIRED);
      const findings = await recordOn(vault, FINDINGS.id, FIRED);
      const [only] = findings.review?.findings ?? [];
      if (only?.kind !== 'refused' || only.cause !== 'unknown-record') throw new Error(`I5: a finding naming no record of the day was not refused: ${JSON.stringify(only)}`);
    });
    await withReview('r13b-unreadable-', 'gpt', async ({ vault, intake, driver, head }) => {
      await seedRun(vault, head);
      driver.narrative = 'I looked and everything is fine.';
      await intake.fire(await reviewPolicy(1), TREE, FIRED);
      const record = await recordOn(vault, TREE.id, FIRED);
      if (record.outcome.kind !== 'refused' || !record.outcome.refusals.some((r) => r.cause === 'result-unreadable')) throw new Error('I5: an unreadable result was recorded as no findings');
    });
  },
});

const TREE_READ_ONLY_DENY_ALL = runtime({
  id: 'I4.nightly-tree-reviewer-is-read-only-deny-all',
  title: "the whole-tree reviewer's sandbox mounts the default branch's tree read-only as its only mount, under deny-all with the model relay alone, and runs under the security-reviewer role; the findings reviewer's mount is empty",
  run: async () => {
    await withReview('r13b-deny-all-', 'gpt', async ({ vault, intake, driver, sandbox, head }) => {
      await seedRun(vault, head);
      await intake.fire(await reviewPolicy(1), TREE, FIRED);
      await intake.fire(await reviewPolicy(1), FINDINGS, FIRED);
      const [tree, day] = sandbox.provisioned;
      if (tree === undefined || day === undefined) throw new Error(`I4: ${String(sandbox.provisioned.length)} sandboxes for two seats`);
      for (const { spec } of [tree, day]) {
        if (spec.mounts.workspace.mode !== 'ro' || spec.mounts.others.length !== 0) throw new Error('I4: a nightly seat was mounted writable or given a second mount');
        if (spec.egress.mode !== 'deny-all' || spec.egress.allow.length !== 0) throw new Error(`I4: a nightly seat was granted egress: ${JSON.stringify(spec.egress)}`);
        if (spec.relay === undefined) throw new Error('I4: a nightly seat was given no metered relay');
      }
      if (tree.listed.join(',') !== 'README.md,index.js,package.json') throw new Error(`I4: the tree seat's mount is not the tree alone: ${tree.listed.join(',')}`);
      if (day.listed.length !== 0) throw new Error(`I4: the findings seat's mount is not empty: ${day.listed.join(',')}`);
      if (driver.requests[0]?.role.role !== 'security-reviewer' || driver.requests[1]?.role.role !== 'findings-reviewer') throw new Error('I4: a nightly seat ran under another role');
    });
  },
});

const REVIEW_CHANGES_NO_RUN = runtime({
  id: 'I2.nightly-review-changes-no-run',
  title: "neither nightly reviewer writes under any run: every run's records are the same objects, by name and by content, after both jobs ran and recorded findings as before",
  run: async () => {
    await withReview('r13b-no-run-', 'gpt', async ({ vault, intake, driver, head }) => {
      await seedRun(vault, head);
      const runs = async () => {
        const out: string[] = [];
        // Name and content: an object rewritten in place under its old name is a write too.
        for await (const object of vault.listObjects()) if (object.path.startsWith('runs/')) out.push(`${object.path} ${createHash('sha256').update(object.bytes).digest('hex')}`);
        return out.sort().join('\n');
      };
      const before = await runs();
      driver.narrative = JSON.stringify({ findings: [{ category: 'unchecked-input', path: 'index.js', line: 1 }] });
      await intake.fire(await reviewPolicy(1), TREE, FIRED);
      const decision = (await vault.readDecisions(RUN))[0];
      driver.narrative = JSON.stringify({ findings: [{ category: 'violation', record: `decision:${decision?.hash ?? ''}` }] });
      await intake.fire(await reviewPolicy(1), FINDINGS, FIRED);
      const findings = await recordOn(vault, FINDINGS.id, FIRED);
      if (!findings.review?.findings.some((f) => f.kind === 'record')) throw new Error('I2: the findings review recorded no finding to test against');
      if ((await runs()) !== before) throw new Error('I2: a nightly reviewer wrote under a run');
    });
  },
});

export const R13B_I2: readonly LocalAssertion[] = [REVIEW_CHANGES_NO_RUN];
export const R13B_I4: readonly LocalAssertion[] = [TREE_READ_ONLY_DENY_ALL];
export const R13B_I5: readonly LocalAssertion[] = [UNLOCATED_REFUSED];
export const R13B_I6: readonly LocalAssertion[] = [FAMILY_DIFFERS, REDUCED_RECORDED];
export const R13B_I7: readonly LocalAssertion[] = [TYPED_FIELDS_ONLY, CLAIM_NEVER_PROMPTED];
