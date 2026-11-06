/**
 * Post-merge observation (R8a, `docs/plan/R8-observe.md`). Two templates
 * feed it, and neither seats a model, opens a change, or starts a run
 * (D-A-LC-03):
 *
 * - `observe-signal` records a `post-merge` push or a `ci-failure` against
 *   the change whose commit the event names, read from the kind's extracted
 *   fields alone and attributed by commit identity alone (I7, D-A-OB-02). A
 *   commit no run merged is kept beside the runs, unattributed.
 * - `observe-history` walks the default branch's first-parent history from
 *   the last head it recorded, finds rollbacks and partial reversals by diff
 *   alone (D-A-OB-04), opens a window for every change no run made, and
 *   closes every window whose time has passed (D-A-OB-03). A history it
 *   cannot read is a refusal, never an empty walk (I5).
 *
 * Every record is the runtime's: from git, from a signed body's typed
 * fields, or from the runtime's clock, and each time says which (D-A-OB-06).
 */
import { randomUUID } from 'node:crypto';
import type { Policy, RunId } from '@olympus-ai/core';
import { resolveCommit } from '@olympus-ai/readiness';
import {
  isNoRunState, type NightlyRefusal, type ObservationCoverage, type ObservationEntry, type ObservationRecord, type ObservationSignal,
  type OpenedChange, type SourcedTime, type Vault,
} from '@olympus-ai/vault';
import {
  changeInverse, classifyReversal, commitDiff, commitOf, firstParentChain, firstParents, leadTimeOf,
  type BranchCommit, type ChangeInverse, type CommitDiff,
} from './history.js';
import { readIntegration } from './line.js';

/** The checkout the walk reads and the branch runs merge into: the target's default branch. */
export interface ObserveTarget {
  readonly checkout: string;
  readonly branch: string;
}

/** A run's merge, as its integration record holds it. */
interface MergedRun {
  readonly runId: RunId;
  readonly mergeCommit: string;
  readonly mergedAt: string;
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/** Every run's merge, by merge commit, from the runtime's own integration records: never a payload's say-so. */
async function mergedRuns(vault: Vault): Promise<Map<string, MergedRun>> {
  const out = new Map<string, MergedRun>();
  for (const runId of await vault.listRuns()) {
    for (const r of await readIntegration(vault, runId)) {
      if (r.kind === 'merged') out.set(r.mergeCommit, { runId, mergeCommit: r.mergeCommit, mergedAt: r.mergedAt });
    }
  }
  return out;
}

/**
 * One signal from a verified delivery's extracted fields (D-A-OB-02). The
 * change is the commit the event names; the run is the one whose recorded
 * merge commit that is, or none. `signedAt` is the body's own time, which
 * GitHub signed: provider-reported.
 */
export async function recordSignal(
  vault: Vault, now: () => number, kind: 'post-merge' | 'ci-failure', fields: Readonly<Record<string, string>>, signedAt: number,
): Promise<string> {
  const commit = fields.commit;
  if (commit === undefined) throw new Error(`observe: a ${kind} signal's fields name no commit`);
  const at: SourcedTime = { at: new Date(signedAt).toISOString(), source: 'provider-reported' };
  let signal: ObservationSignal;
  if (kind === 'ci-failure') {
    const { checkRun, conclusion } = fields;
    if (checkRun === undefined || conclusion === undefined) throw new Error('observe: a ci-failure signal names no check run or conclusion');
    signal = { kind: 'check-failure', commit, at, checkRun, conclusion };
  } else {
    signal = { kind: 'pushed', commit, at };
  }
  const run = (await mergedRuns(vault)).get(commit);
  const record: ObservationRecord = {
    runId: run?.runId ?? null, change: commit, signal, recordedAt: new Date(now()).toISOString(), collectedBy: 'runtime',
  };
  return vault.recordObservation(record);
}

export interface Walked {
  readonly refusals: NightlyRefusal[];
  readonly observation: ObservationCoverage;
}

/** One change whose window is open, with what the walk compares later commits against. */
interface OpenChange {
  readonly change: string;
  readonly runId: RunId | null;
  readonly opened: SourcedTime;
  inverse?: ChangeInverse;
}

const closes = (entries: readonly ObservationEntry[]): boolean => entries.some((e) => e.record.signal.kind === 'window-closed');

/**
 * The walk (D-A-OB-02, D-R8a-06 to D-R8a-10). Reversals are recorded before
 * any window is closed, so a revert the walk reaches counts against a window
 * that closes in the same walk (D-R8a-07).
 */
export async function walkHistory(vault: Vault, target: ObserveTarget | null, policy: Policy, now: () => number): Promise<Walked> {
  const refusals: NightlyRefusal[] = [];
  const coverage = { branch: target?.branch ?? null, from: null as string | null, to: null as string | null, walked: 0, opened: [] as OpenedChange[], closed: [] as string[], signals: 0 };
  const done = (): Walked => ({ refusals, observation: { ...coverage } });
  const windowMs = policy.triggers.observe?.windowMs;
  if (windowMs === undefined) {
    refusals.push({ part: 'policy', cause: 'no-window', detail: 'the policy names no observation window, so no window can close' });
    return done();
  }
  if (target === null) {
    refusals.push({ part: 'target', cause: 'no-target', detail: 'this host names no default branch to walk' });
    return done();
  }
  const { checkout, branch } = target;
  const stamp = (): string => new Date(now()).toISOString();

  // What the store already holds: every merge, every observation, and every earlier walk.
  const merged = await mergedRuns(vault);
  const runObservations = new Map<RunId, readonly ObservationEntry[]>();
  for (const run of merged.values()) runObservations.set(run.runId, await vault.readObservations(run.runId));
  const beside = await vault.readObservations(null);
  const closedBaseline = new Set(beside.filter((e) => e.record.signal.kind === 'window-closed').map((e) => e.record.change));
  const walks = (await vault.readNightly()).filter((e) => e.record.observation !== null);
  const lastTo = [...walks].reverse().find((e) => e.record.observation?.to != null)?.record.observation?.to ?? null;
  const openedBefore = new Map<string, OpenedChange>();
  for (const w of walks) for (const o of w.record.observation?.opened ?? []) if (!closedBaseline.has(o.change)) openedBefore.set(o.change, o);
  // A provider-reported landing time, where a push was recorded for a commit (D-R8a-08).
  const pushed = new Map<string, SourcedTime>();
  for (const e of [...beside, ...[...runObservations.values()].flat()]) if (e.record.signal.kind === 'pushed') pushed.set(e.record.signal.commit, e.record.signal.at);

  const openRuns = [...merged.values()].filter((r) => !closes(runObservations.get(r.runId) ?? []));
  let head: string;
  let commits: BranchCommit[];
  try {
    head = await resolveCommit(checkout, `refs/heads/${branch}`);
    let from = lastTo;
    if (from === null) {
      // The first walk starts before the oldest merge still observed, so a revert of it already on the branch is found (D-R8a-10).
      const oldest = [...openRuns].sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))[0];
      from = oldest === undefined ? head : ((await commitOf(checkout, oldest.mergeCommit)).parents[0] ?? null);
    }
    coverage.from = from;
    // The walk's start and every change still watched must be on the branch's own first-parent history. One an
    // ancestor only through a merge's second parent, or dropped by a reset, is history rewritten under the record,
    // never a change left to close clean (codex-1, gemini-2).
    const chain = await firstParentChain(checkout, head);
    if (from !== null && !chain.has(from)) {
      refusals.push({ part: 'history', cause: 'history-rewritten', detail: `${from}, where the walk last stopped, is not on ${branch}'s first-parent history at ${head}` });
      return done();
    }
    const dropped = [...openRuns.map((r) => r.mergeCommit), ...openedBefore.keys()].filter((c) => !chain.has(c));
    if (dropped.length > 0) {
      refusals.push({ part: 'history', cause: 'history-rewritten', detail: `changes still watched are no longer on ${branch}'s first-parent history at ${head}: ${dropped.join(', ')}` });
      return done();
    }
    commits = from === head ? [] : await firstParents(checkout, from, head);
  } catch (error) {
    refusals.push({ part: 'history', cause: 'history-unreadable', detail: describe(error) });
    return done();
  }

  try {
    // Changes already open precede the range; one inside it opens when the walk passes it.
    const inRange = new Set(commits.map((c) => c.commit));
    const open: OpenChange[] = [];
    const pending = new Map<string, OpenChange>();
    for (const r of openRuns) {
      const change: OpenChange = { change: r.mergeCommit, runId: r.runId, opened: { at: r.mergedAt, source: 'provider-reported' } };
      if (inRange.has(r.mergeCommit)) pending.set(r.mergeCommit, change);
      else open.push(change);
    }
    for (const o of openedBefore.values()) open.push({ change: o.change, runId: null, opened: { at: o.firstSeen, source: 'runtime' } });
    const closedRuns = new Set([...merged.values()].filter((r) => !openRuns.includes(r)).map((r) => r.mergeCommit));

    for (const commit of commits) {
      if (open.length > 0) {
        const diff: CommitDiff = await commitDiff(checkout, commit);
        for (const change of open) {
          change.inverse ??= await changeInverse(checkout, await commitOf(checkout, change.change));
          const found = classifyReversal(change.inverse, diff);
          if (found.kind === 'none') continue;
          const at = pushed.get(commit.commit) ?? { at: commit.committedAt, source: 'committer-claimed' as const };
          const signal: ObservationSignal = found.kind === 'rollback'
            ? { kind: 'rollback', commit: commit.commit, at, committedAt: commit.committedAt, match: found.match }
            : { kind: 'partial-reversal', commit: commit.commit, at, hunks: found.hunks, of: found.of };
          await vault.recordObservation({ runId: change.runId, change: change.change, signal, recordedAt: stamp(), collectedBy: 'runtime' });
          coverage.signals += 1;
        }
      }
      coverage.walked += 1;
      const run = pending.get(commit.commit);
      if (run !== undefined) open.push(run);
      else if (!merged.has(commit.commit) && !closedRuns.has(commit.commit) && !closedBaseline.has(commit.commit)) {
        // A change no run made: the baseline. Its window opens when the walk first sees it (D-R8a-09).
        const opened: OpenedChange = { change: commit.commit, firstSeen: stamp(), committedAt: commit.committedAt, leadTime: await leadTimeOf(checkout, commit) };
        coverage.opened.push(opened);
        open.push({ change: opened.change, runId: null, opened: { at: opened.firstSeen, source: 'runtime' } });
      }
    }
    coverage.to = head;

    // Windows close after every reversal is recorded (D-R8a-07).
    const firstSeen = new Map<string, OpenedChange>([...openedBefore, ...coverage.opened.map((o) => [o.change, o] as const)]);
    for (const change of open) {
      if (now() < Date.parse(change.opened.at) + windowMs) continue;
      const committedAt = (await commitOf(checkout, change.change)).committedAt;
      const record: ObservationRecord = {
        runId: change.runId, change: change.change, recordedAt: stamp(), collectedBy: 'runtime',
        signal: { kind: 'window-closed', at: { at: stamp(), source: 'runtime' }, windowMs, opened: change.opened, committedAt, leadTime: change.runId === null ? (firstSeen.get(change.change)?.leadTime ?? null) : null },
      };
      const sha = await vault.recordObservation(record);
      coverage.closed.push(change.change);
      if (change.runId !== null) {
        await vault.recordDecision({
          runId: change.runId, taskId: null, station: 'observe', decidedAt: stamp(), occurrence: randomUUID(),
          decision: { cause: 'observation-closed', decidedBy: 'observe', observation: sha, windowMs }, collectedBy: 'runtime',
        });
      }
    }
  } catch (error) {
    // The range is walked again next time; a reversal already recorded is the same signal, counted once (D-R8a-07).
    coverage.to = null;
    refusals.push({ part: 'history', cause: 'history-unreadable', detail: describe(error) });
  }
  try {
    await leaveObserve(vault, merged);
  } catch (error) {
    refusals.push({ part: 'store', cause: 'store-unreadable', detail: `a run whose window closed could not be moved out of observe: ${describe(error)}` });
  }
  return done();
}

/**
 * Every run whose window has closed and whose state still says it is being
 * watched is moved out, phase `exiting` at `observe` (D-R8a-04). Run after
 * every walk, so a close whose state commit failed is finished by the next.
 */
async function leaveObserve(vault: Vault, merged: ReadonlyMap<string, MergedRun>): Promise<void> {
  for (const run of merged.values()) {
    if (!closes(await vault.readObservations(run.runId))) continue;
    let state;
    try {
      state = await vault.readRunState(run.runId);
    } catch (error) {
      if (isNoRunState(error)) continue;
      throw error;
    }
    if (state.station !== 'observe' || state.phase !== 'working') continue;
    await vault.commitRunState({ ...state, phase: 'exiting' }, state.version);
  }
}
