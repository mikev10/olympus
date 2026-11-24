/**
 * R28: findings, located where they were raised, and what became of them
 * (D-A-FO-01, D-R28-01). A review seat's finding names a file and a line of
 * the tree it reviewed, or is refused with its cause; it never moves its
 * task's status. An outcome is a write-once runtime record; a finding with
 * none is open. R2 counts them per seat kind and per family, and says a
 * resolved rate it had no input for is unmeasured rather than zero.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModelFamily, TaskId, TaskRequest } from '@olympus-ai/core';
import type { NightlyRecord, ReviewFindingsRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { R28_DRAFTING } from './drafting.js';
import { HELLO_REVIEW, readRecord, stubDriver, withLine } from './line.js';
import { FINDING_DISMISSAL_IS_A_PERSONS, FINDING_DISMISSAL_THROUGH_THE_CLI } from './findings-http.js';
import { CODE_FINDING_RESOLVED_BY_COVERED_CHANGE, RECORD_FINDING_NEVER_RESOLVED } from './findings-resolution.js';
import { EVERY_STACK_REPORTS_CHANGED_LINES } from './stacks.js';
import { inTask, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');

const SECURITY = `${HELLO_REVIEW}.security` as TaskId;
const NOTE = 'REVIEW-NOTE-SENTINEL';

/** Each review seat's findings records, by task, read back from the store. */
async function findingsOf(vault: Vault, runId: string): Promise<Map<TaskId, ReviewFindingsRecord[]>> {
  const out = new Map<TaskId, ReviewFindingsRecord[]>();
  for (const ref of await vault.readReviewFindings(runId as never)) {
    const record = await readRecord<ReviewFindingsRecord>(vault, ref);
    out.set(record.taskId, [...(out.get(record.taskId) ?? []), record]);
  }
  return out;
}

/** Drives the hello run with an author that writes three lines, and both review seats answering `narrative`. */
async function reviewedRun<T>(prefix: string, narrative: string, body: (vault: Vault, runId: string, state: Awaited<ReturnType<Parameters<Parameters<typeof withLine>[1]>[0]['state']>>) => Promise<T>): Promise<T> {
  return withLine(prefix, async (rig) => {
    const { startRun } = await api();
    const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
    const sandbox = new StubSandboxProvider();
    const author = await stubDriver({ during: async (req: TaskRequest) => { await inTask(sandbox, req, writes({ 'src/change.ts': 'one\ntwo\nthree\n' })); } });
    const reviewer = await stubDriver({ family: 'other-family', narrative });
    const components = await rig.components({ sandbox, driver: author, reviewer });
    await startRun(await rig.request(components, {}));
    return body(components.vault, rig.runId, await rig.state());
  });
}

export const REVIEW_FINDINGS_NEVER_MOVE_STATUS: LocalAssertion = runtime({
  id: 'I2.review-findings-never-move-status',
  title:
    "each review seat's findings are recorded beside its committed result, located in the tree it reviewed under the reviewer model the runtime recorded, each refused one with its cause, and none carrying the reviewer's note; and each seat's task passes exactly as it does with no finding (R28, D-P4-07)",
  run: async () => {
    const narrative = JSON.stringify({ findings: [
      { category: 'spec-mismatch', path: 'src/change.ts', line: 2, note: NOTE },
      { category: 'spec-mismatch', path: 'src/change.ts', line: 9 },
      { category: 'spec-mismatch', path: 'src/absent.ts', line: 1 },
    ] });
    await reviewedRun('r28-review-findings-', narrative, async (vault, runId, state) => {
      if (state.tasks[HELLO_REVIEW] !== 'passed' || state.tasks[SECURITY] !== 'passed') throw new Error(`I2: a seat with findings did not pass as one without: ${JSON.stringify(state.tasks)}`);
      const records = await findingsOf(vault, runId);
      const review = records.get(HELLO_REVIEW)?.find((r) => r.result.hash === state.results[HELLO_REVIEW]?.hash);
      const security = records.get(SECURITY)?.find((r) => r.result.hash === state.results[SECURITY]?.hash);
      if (review === undefined || security === undefined) throw new Error(`I2: a seat's findings are not recorded beside its committed result: ${JSON.stringify([...records.keys()])}`);
      const expected = [
        { kind: 'located', category: 'spec-mismatch', path: 'src/change.ts', line: 2 },
        { kind: 'refused', cause: 'unlocated', defects: [] },
        { kind: 'refused', cause: 'unlocated', defects: [] },
      ];
      if (!review.readable || JSON.stringify(review.findings) !== JSON.stringify(expected)) throw new Error(`I2: the review seat's findings were recorded as ${JSON.stringify(review.findings)}`);
      // The security seat's categories are its own questions; a reviewer's category is out of its class there.
      if (!security.findings.every((f) => f.kind === 'refused' && f.cause === 'unrecordable' && f.defects.some((d) => d.field === 'category'))) {
        throw new Error(`I2: the security seat recorded a category its role does not ask: ${JSON.stringify(security.findings)}`);
      }
      if (review.reviewer.family !== 'other-family' || review.seat !== 'review' || security.seat !== 'security') throw new Error(`I2: the findings record names the seat ${JSON.stringify([review.seat, review.reviewer])}`);
      if (JSON.stringify([review, security]).includes(NOTE)) throw new Error("I7: a reviewer's note entered a findings record");
    });
  },
});

export const UNREADABLE_REVIEW_IS_NOT_CLEAN: LocalAssertion = runtime({
  id: 'I5.unreadable-review-result-is-never-no-findings',
  title:
    "a review seat whose final message is not the findings object is recorded unreadable with no findings, never as having found nothing, and its task passes as before; nothing is listed for it (R28)",
  run: async () => {
    await reviewedRun('r28-review-unreadable-', 'The change looks fine to me.', async (vault, runId, state) => {
      if (state.tasks[HELLO_REVIEW] !== 'passed') throw new Error(`I5: an unreadable review changed its task's status: ${JSON.stringify(state.tasks)}`);
      const review = (await findingsOf(vault, runId)).get(HELLO_REVIEW)?.find((r) => r.result.hash === state.results[HELLO_REVIEW]?.hash);
      if (review === undefined || review.readable || review.findings.length !== 0) throw new Error(`I5: an unreadable review was recorded as ${JSON.stringify(review)}`);
      const { listFindings } = await api();
      if ((await listFindings(vault)).length !== 0) throw new Error('I5: an unreadable review listed a finding');
    });
  },
});

/** A nightly tree reviewer's record holding one tree finding and one record finding, as the store keeps it. */
function nightly(date: string): NightlyRecord {
  const model = { provider: 'conformance', family: 'nightly-family' as ModelFamily, model: 'm', version: '1' };
  return {
    schedule: 'nightly-tree', template: 'nightly-tree-review', date, startedAt: `${date}T00:00:00.000Z`, endedAt: `${date}T00:01:00.000Z`,
    outcome: { kind: 'completed' }, findings: [], integrity: null, security: null, observation: null, collectedBy: 'runtime',
    review: {
      subject: { kind: 'tree', branch: 'main', commit: 'a'.repeat(40), files: 1, merged: [], since: 'none', unattributed: false },
      role: null, seat: { reviewer: { role: null, driver: 'conformance@1', model }, authors: [], independence: 'no-author', level: 'L1' }, usage: null, egress: null, claim: null,
      findings: [
        { kind: 'tree', category: 'unchecked-input', path: 'index.js', line: 2, candidate: { none: 'budget' } },
        { kind: 'record', category: 'violation', record: `decision:${'0'.repeat(64)}`, candidate: { none: 'budget' } },
        { kind: 'refused', cause: 'unlocated', defects: [] },
      ],
    },
  } as unknown as NightlyRecord;
}

async function withStore<T>(body: (vault: Vault) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'r28-store-'));
  try {
    const { LocalVault } = await import('@olympus-ai/vault');
    return await body(new LocalVault({ store: join(base, 'store'), artifacts: join(base, 'artifacts') }));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

export const FINDING_WITHOUT_OUTCOME_IS_OPEN: LocalAssertion = runtime({
  id: 'I5.finding-without-outcome-is-open',
  title:
    'a located finding with no outcome record lists as open, never resolved; a refused finding is never listed; and a second outcome for a finding is refused, writing nothing, so its first stands (R28)',
  run: async () => {
    await withStore(async (vault) => {
      const { listFindings, dismissFinding } = await api();
      await vault.recordNightly(nightly('2026-11-20'));
      const listed = await listFindings(vault);
      if (listed.length !== 2 || listed.some((f) => f.outcome.kind !== 'open')) throw new Error(`I5: findings with no outcome listed as ${JSON.stringify(listed)}`);
      const [first] = listed;
      if (first === undefined) throw new Error('I5 control: nothing listed');
      const done = await dismissFinding(vault, first.id, 'duplicate', new Date().toISOString());
      if (done.kind !== 'dismissed') throw new Error(`I5 control: the first dismissal was ${JSON.stringify(done)}`);
      const again = await dismissFinding(vault, first.id, 'not-a-defect', new Date().toISOString());
      if (again.kind !== 'decided' || again.outcome.kind !== 'dismissed' || again.outcome.cause !== 'duplicate') throw new Error(`I5: a second outcome was not refused: ${JSON.stringify(again)}`);
      const stored = await vault.readFindingOutcomes();
      if (stored.length !== 1 || stored[0]?.record.outcome.kind !== 'dismissed') throw new Error(`I5: a second outcome was written: ${JSON.stringify(stored)}`);
      const direct = await vault.recordFindingOutcome({ ...stored[0].record, outcome: { kind: 'dismissed', cause: 'not-reproducible' }, at: new Date().toISOString() });
      if (direct !== null) throw new Error('I5: the store wrote a second outcome for one finding');
    });
  },
});

export const FINDING_RATES_PER_SEAT_AND_FAMILY: LocalAssertion = runtime({
  id: 'I5.finding-rates-say-what-they-could-not-measure',
  title:
    "R2 derives resolved, dismissed, and open over findings raised, per seat kind and per reviewer family, each with its sample and bound; a group holding a code finding, where no run recorded line coverage, has its resolved rate unmeasured, never 0 of n (R28, D-R28-01)",
  run: async () => {
    await withStore(async (vault) => {
      const { outcomes, listFindings, dismissFinding } = await api();
      await vault.recordNightly(nightly('2026-11-20'));
      const [first] = await listFindings(vault);
      if (first === undefined) throw new Error('I5 control: nothing listed');
      await dismissFinding(vault, first.id, 'not-a-defect', new Date().toISOString());
      const { findings } = await outcomes(vault);
      const seat = findings.bySeat['nightly:nightly-tree-review'];
      const family = findings.byFamily['nightly-family'];
      if (seat === undefined || family === undefined || seat.raised !== 2 || family.raised !== 2) throw new Error(`I5: the findings were counted as ${JSON.stringify(findings)}`);
      if (seat.resolved.kind !== 'unmeasured') throw new Error(`I5: a resolved rate with no line coverage read ${JSON.stringify(seat.resolved)}`);
      if (seat.dismissed.kind !== 'rate' || seat.dismissed.count !== 1 || seat.dismissed.sample !== 2 || seat.dismissed.bound.side !== 'upper') throw new Error(`I5: the dismissed rate is ${JSON.stringify(seat.dismissed)}`);
      if (seat.open.kind !== 'rate' || seat.open.count !== 1 || seat.open.sample !== 2) throw new Error(`I5: the open rate is ${JSON.stringify(seat.open)}`);
      const window = await outcomes(vault, { from: '2026-11-21T00:00:00.000Z' });
      if (Object.keys(window.findings.bySeat).length !== 0) throw new Error('I5: a nightly finding outside the window was counted');
    });
  },
});

export const R28_ASSERTIONS = {
  I2: [REVIEW_FINDINGS_NEVER_MOVE_STATUS, CODE_FINDING_RESOLVED_BY_COVERED_CHANGE, FINDING_DISMISSAL_IS_A_PERSONS, FINDING_DISMISSAL_THROUGH_THE_CLI, ...R28_DRAFTING.I2],
  I5: [UNREADABLE_REVIEW_IS_NOT_CLEAN, RECORD_FINDING_NEVER_RESOLVED, FINDING_WITHOUT_OUTCOME_IS_OPEN, FINDING_RATES_PER_SEAT_AND_FAMILY, ...R28_DRAFTING.I5],
  I8: [EVERY_STACK_REPORTS_CHANGED_LINES],
} as const;
