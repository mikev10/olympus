/**
 * R28: what resolves a code finding. Each assertion drives the real code over
 * a real git checkout: the filesystem Vault, the history walk, and the
 * findings reader. A finding is resolved only when a later merged run's change
 * rewrote a hunk holding the cited line, mapped through history to that run's
 * base, and that run's accepted evidence shows its coverage check passed with
 * a line of the hunk executed (D-R28-01). Every other case leaves it open.
 */
import type { ModelFamily, ModelIdentity, RunId, TaskId, VaultRef } from '@olympus-ai/core';
import type { CheckResult } from '@olympus-ai/integrity';
import type { AdmissionRecord, EvidenceBundle, FindingOutcomeEntry, NightlyRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { LINES, ago, walkOn, withObserve, type Rig } from './observe.js';

const api = async () => import('@olympus-ai/api');

const RUN_S = 'run-s' as RunId;
const RUN_R = 'run-r' as RunId;
const TASK_S = 't-s' as TaskId;
const TASK_R = 't-r' as TaskId;
const PATH = 'a.txt';
/** The line the review seat cites in S's pushed tree. */
const CITED = 5;
const REVIEWER: ModelIdentity = { provider: 'openai', family: 'gpt' as ModelFamily, model: 'gpt-x', version: '1' };
const ZERO = '0'.repeat(64);

/** What R's accepted evidence says about the coverage of its change. */
interface Scenario {
  /** `covering`: an executed line inside the hunk; `outside`: executed lines only outside it; `none`: no changed-line coverage at all. */
  readonly lines: 'covering' | 'outside' | 'none';
  /** The coverage check's exit code: 0 passed. */
  readonly coverageExit: number;
  /** Whether a commit between S's merge and R's base rewrites the cited line, so it cannot be mapped to R's base. */
  readonly rewriteBetween: boolean;
}

interface Built {
  readonly findingsRef: VaultRef;
  readonly evidenceRef: VaultRef;
  readonly rMerge: string;
  /** The cited line as it stands at R's base, and R's head-side line that rewrote it. */
  readonly target: number;
}

const PASSING: Scenario = { lines: 'covering', coverageExit: 0, rewriteBetween: false };

async function admit(vault: Vault, runId: RunId): Promise<VaultRef> {
  // The admission's other fields are not read by the walk or the findings reader; the record is the one `seedAdmitted` writes.
  return vault.recordAdmission({ run: { id: runId }, roles: [], stack: 'unsupported', artifacts: { observationPlan: { source: 'none' } } } as unknown as AdmissionRecord);
}

function check(exitCode: number): CheckResult {
  return { checkId: 'coverage', exitCode, stdout: '', stderr: '', suiteCount: null, expectation: null, findings: null, property: null, durationMs: 1, startedAt: new Date().toISOString() };
}

/**
 * Builds S (a merged run whose review seat cites `a.txt` line 5 in the tree it
 * pushed), a commit on main between S and R, and R (a merged run whose change
 * rewrites the cited line as it stands at R's base), with R's evidence as the
 * scenario says. Nothing is walked.
 */
async function build(rig: Rig, s: Scenario): Promise<Built> {
  const { vault, repo } = rig;
  const sMerge = await repo.merge('feature-s', { [PATH]: LINES(12, { 9: 'nine, by s' }) }, 'S change');
  const sHead = repo.git(['rev-parse', `${sMerge}^2`]);
  // Either two lines inserted above the cited line, which shifts it to 7, or the cited line itself rewritten.
  if (s.rewriteBetween) await repo.commit({ [PATH]: LINES(12, { [CITED]: 'five, rewritten on main', 9: 'nine, by s' }) }, 'rewrite five');
  else await repo.commit({ [PATH]: `top 1\ntop 2\n${LINES(12, { 9: 'nine, by s' })}` }, 'insert two lines above');
  const target = s.rewriteBetween ? CITED : CITED + 2;
  const rText = s.rewriteBetween
    ? LINES(12, { [CITED]: 'five, fixed by r', 9: 'nine, by s' })
    : `top 1\ntop 2\n${LINES(12, { [CITED]: 'five, fixed by r', 9: 'nine, by s' })}`;
  const rMerge = await repo.merge('feature-r', { [PATH]: rText }, 'R change');
  const rBase = repo.git(['rev-parse', `${rMerge}^1`]);
  const rHead = repo.git(['rev-parse', `${rMerge}^2`]);
  const mergedAt = ago(10_000);

  // S: its review seat's committed result, and the findings record read from it.
  const sAdmission = await admit(vault, RUN_S);
  const result = await vault.recordTaskResult(RUN_S, {
    taskId: TASK_S, claim: { narrative: 'done', filesChanged: [PATH] }, events: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, wallClockMs: 0 }, model: REVIEWER, contractVersion: '1',
  });
  const findingsRef = await vault.recordReviewFindings({
    runId: RUN_S, taskId: TASK_S, seat: 'review', result, reviewer: REVIEWER, tree: null, readable: true,
    findings: [{ kind: 'located', category: 'untested-behavior', path: PATH, line: CITED }], collectedBy: 'runtime',
  });
  await vault.commitRunState({
    runId: RUN_S, admission: sAdmission, station: 'observe', stations: [], phase: 'working', tasks: { [TASK_S]: 'passed' }, attempts: {}, results: { [TASK_S]: result },
    evidenceRefs: [], violations: [], approvals: [], reviews: [], drafts: {}, usage: [], cancelled: null, halted: null, narrowed: null, version: '0',
  }, '0');
  await vault.recordIntegration({
    runId: RUN_S, kind: 'merged', repository: 'octo/hello', baseBranch: 'main', baseCommit: repo.git(['rev-parse', `${sMerge}^1`]), branch: `factory/${RUN_S}`, commit: sHead,
    pullRequest: 1, url: 'https://github.com/octo/hello/pull/1', collectedBy: 'runtime', mergeCommit: sMerge, mergedAt,
  });

  // R: one passed task whose evidence names the changed lines its coverage check saw run.
  const rAdmission = await admit(vault, RUN_R);
  const executed = s.lines === 'outside' ? [1, 2] : [target];
  const bundle: EvidenceBundle = {
    runId: RUN_R, taskId: TASK_R, baseCommit: rBase, baseTreeSha256: ZERO, baseRun: { runId: RUN_R, kind: 'base-run', hash: ZERO },
    diff: [{ path: PATH, change: 'modified', sha256: ZERO }], diffSha256: ZERO, checks: [check(s.coverageExit)], unstarted: [],
    claim: { narrative: 'fixed', filesChanged: [PATH] }, claimEvidenceDiff: [], harnessImage: 'no-sandbox',
    tamper: {
      assertionsWeakened: [], skipMarkersAdded: [], suppressionMarkersAdded: [], testsDeleted: [], snapshotsRegenerated: [], protectedPathsTouched: [],
      coverageDelta: s.lines === 'none' ? null : 1,
      changedLines: s.lines === 'none' ? null : { check: 'coverage', files: [{ path: PATH, executed, unexecuted: [] }] },
    },
    notCarried: [], install: null, collectedBy: 'runtime', driverProvenanceId: 'conformance', contractVersion: '1',
  };
  const evidenceRef = await vault.writeEvidence(bundle);
  await vault.commitRunState({
    runId: RUN_R, admission: rAdmission, station: 'observe', stations: [], phase: 'working', tasks: { [TASK_R]: 'passed' }, attempts: {}, results: {},
    evidenceRefs: [evidenceRef], violations: [], approvals: [], reviews: [], drafts: {}, usage: [], cancelled: null, halted: null, narrowed: null, version: '0',
  }, '0');
  await vault.recordIntegration({
    runId: RUN_R, kind: 'merged', repository: 'octo/hello', baseBranch: 'main', baseCommit: rBase, branch: `factory/${RUN_R}`, commit: rHead,
    pullRequest: 2, url: 'https://github.com/octo/hello/pull/2', collectedBy: 'runtime', mergeCommit: rMerge, mergedAt,
  });
  return { findingsRef, evidenceRef, rMerge, target };
}

async function walked(rig: Rig, date: string): Promise<void> {
  const record = await walkOn(rig, date);
  if (record.outcome.kind !== 'completed') throw new Error(`the walk on ${date} was refused: ${JSON.stringify(record.outcome)}`);
}

/** A control: the same store and history but for one fact, after which the finding must stay open. */
async function staysOpen(prefix: string, s: Scenario, what: string): Promise<void> {
  await withObserve(prefix, async (rig) => {
    await build(rig, s);
    await walked(rig, '2026-11-05');
    const outcomes = await rig.vault.readFindingOutcomes();
    if (outcomes.length !== 0) throw new Error(`I2: ${what}, yet the finding was given an outcome: ${JSON.stringify(outcomes.map((e) => e.record))}`);
  });
}

function onlyResolution(outcomes: readonly FindingOutcomeEntry[], b: Built): void {
  if (outcomes.length !== 1) throw new Error(`I2: a covered change wrote ${String(outcomes.length)} outcomes, not one: ${JSON.stringify(outcomes.map((e) => e.record))}`);
  const [entry] = outcomes;
  if (entry === undefined) throw new Error('I2: no outcome was read');
  const { finding, outcome } = entry.record;
  if (finding.source.kind !== 'review' || finding.source.record.hash !== b.findingsRef.hash || finding.source.record.runId !== RUN_S || finding.index !== 0) {
    throw new Error(`I2: the outcome names another finding: ${JSON.stringify(finding)}`);
  }
  if (outcome.kind !== 'resolved' || outcome.resolution.kind !== 'covered-change') throw new Error(`I2: the finding was not resolved by a covered change: ${JSON.stringify(outcome)}`);
  const r = outcome.resolution;
  const h = r.hunk;
  const ok = r.runId === RUN_R && r.mergeCommit === b.rMerge && r.path === PATH && r.line === b.target
    && h.oldStart === b.target && h.oldLines === 1 && h.newStart === b.target && h.newLines === 1
    && r.executed.length === 1 && r.executed[0] === b.target
    && r.evidence.runId === b.evidenceRef.runId && r.evidence.kind === 'evidence' && r.evidence.hash === b.evidenceRef.hash;
  if (!ok) throw new Error(`I2: the resolution does not name R, its merge commit, the hunk holding the mapped line, the executed line, and R's evidence: ${JSON.stringify(r)}`);
}

export const CODE_FINDING_RESOLVED_BY_COVERED_CHANGE = runtime({
  id: 'I2.code-finding-resolved-by-covered-change',
  title: "a review seat's code finding is resolved only by a later merged change that rewrote the cited line, mapped through history to its base, where that run's passing coverage check executed a line of the hunk; no coverage, a failed check, executed lines outside the hunk, or a line the history rewrote leaves it open, and a second pass writes nothing",
  timeoutMs: 180_000,
  run: async () => {
    const { resolveCodeFindings } = await api();
    await withObserve('r28-resolved-', async (rig) => {
      const b = await build(rig, PASSING);
      await walked(rig, '2026-11-05');
      const first = await rig.vault.readFindingOutcomes();
      onlyResolution(first, b);
      // (e) Neither a second walk nor a second pass over R writes a second outcome.
      await rig.repo.commit({ 'b.txt': 'b, later\n' }, 'later');
      await walked(rig, '2026-11-06');
      const again = await resolveCodeFindings(rig.vault, rig.repo.dir, RUN_R, () => new Date().toISOString());
      if (again.resolved !== 0 || again.unreadable.length !== 0) throw new Error(`I2: a second pass over R resolved again: ${JSON.stringify(again)}`);
      const after = await rig.vault.readFindingOutcomes();
      onlyResolution(after, b);
      if (after[0]?.sha256 !== first[0]?.sha256) throw new Error('I2: the outcome was rewritten by a second pass');
    });
    await staysOpen('r28-nolines-', { ...PASSING, lines: 'none' }, "R's evidence names no changed-line coverage");
    await staysOpen('r28-failed-', { ...PASSING, coverageExit: 1 }, "R's coverage check failed");
    await staysOpen('r28-outside-', { ...PASSING, lines: 'outside' }, "R's executed lines are all outside the hunk");
    await staysOpen('r28-unmapped-', { ...PASSING, rewriteBetween: true }, "the cited line was rewritten between S and R's base, so it cannot be mapped");
  },
});

export const RECORD_FINDING_NEVER_RESOLVED = runtime({
  id: 'I5.record-finding-never-resolved',
  title: "a nightly reviewer's finding that cites a record is never resolved, even by a walk that resolves a code finding, and is listed open",
  timeoutMs: 60_000,
  run: async () => {
    const { listFindings } = await api();
    await withObserve('r28-record-', async (rig) => {
      const b = await build(rig, PASSING);
      const nightly: NightlyRecord = {
        schedule: 'findings-review', template: 'nightly-findings-review', date: '2026-11-04', startedAt: ago(20_000), endedAt: ago(19_000),
        outcome: { kind: 'completed' }, findings: [], integrity: null, security: null, observation: null, collectedBy: 'runtime',
        review: {
          subject: null, role: null, usage: null, egress: null, claim: null,
          seat: { reviewer: { role: null, driver: null, model: REVIEWER }, authors: [], independence: 'no-author', level: 0 },
          findings: [{ kind: 'record', category: 'violation', record: `${RUN_S}/violation`, candidate: { none: 'budget' } }],
        },
      };
      const hash = await rig.vault.recordNightly(nightly);
      await walked(rig, '2026-11-05');
      // The walk did resolve the code finding beside it.
      onlyResolution(await rig.vault.readFindingOutcomes(), b);
      const listed = (await listFindings(rig.vault)).find((f) => f.id === `nightly:${hash}:0`);
      if (listed === undefined) throw new Error('I5: the record finding is not listed');
      if (listed.cites.kind !== 'record') throw new Error(`I5: the record finding is listed as citing ${JSON.stringify(listed.cites)}`);
      if (listed.outcome.kind !== 'open') throw new Error(`I5: a finding citing a record was given an outcome: ${JSON.stringify(listed.outcome)}`);
    });
  },
});

export const R28_FINDINGS_RESOLUTION: readonly LocalAssertion[] = [CODE_FINDING_RESOLVED_BY_COVERED_CHANGE, RECORD_FINDING_NEVER_RESOLVED];
