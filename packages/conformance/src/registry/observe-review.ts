/**
 * R8a's external review (`docs/reviews/2026-11-05-R8a-post-merge-attribution-triage.md`).
 * Each assertion is the construction a reviewer described, built over a real
 * git checkout and the real jobs, written to fail against the code the review
 * read before the fix it names was applied.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunId } from '@olympus-ai/core';
import type { ObservationRecord } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import {
  CHECKS, LINES, RUN_A, RUN_B, WINDOW_MS, ago, checkFailure, kinds, mergedRun, seedMerge, signed, walkOn, withObserve,
} from './observe.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

/** How old a merge must be for its window to have closed: the window, plus the policy's delivery age, which a close waits out. */
const DELIVERY_AGE_MS = 3_600_000;
const PAST_CLOSE = WINDOW_MS + DELIVERY_AGE_MS + 60_000;

const DROPPED_MERGE_REFUSED = runtime({
  id: 'I5.observe-dropped-merge-is-refused',
  title: "a run's merge commit no longer on the default branch's first-parent history, and a last head reachable only through a second parent, are each refused as rewritten history and never closed clean (codex-1, gemini-2)",
  run: async () => {
    // The merge lands after the last walk, then the branch is reset under it, the merge kept on another branch.
    await withObserve('r8a-dropped-', async (rig) => {
      await walkOn(rig, '2026-11-05');
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      await seedMerge(rig.vault, RUN_A, a, ago(PAST_CLOSE));
      rig.repo.git(['branch', 'kept', a]);
      rig.repo.git(['reset', '-q', '--hard', 'HEAD~1']);
      const record = await walkOn(rig, '2026-11-06');
      if (kinds(await rig.vault.readObservations(RUN_A), 'window-closed').length > 0) throw new Error('I5: a merge dropped from the branch was closed clean');
      if (record.outcome.kind !== 'refused' || !record.outcome.refusals.some((r) => r.cause === 'history-rewritten')) throw new Error(`I5: a dropped merge was ${JSON.stringify(record.outcome)}`);
    });
    // The last head survives only as a second parent of a merge that keeps a tree from before the change.
    await withObserve('r8a-second-parent-', async (rig) => {
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      await seedMerge(rig.vault, RUN_A, a, ago(10_000));
      await walkOn(rig, '2026-11-05');
      rig.repo.git(['checkout', '-q', '-b', 'before', `${a}^1`]);
      await rig.repo.commit({ 'b.txt': 'b, elsewhere\n' }, 'elsewhere');
      rig.repo.git(['merge', '-q', '-s', 'ours', '--no-edit', 'main']);
      rig.repo.git(['branch', '-f', 'main', 'HEAD']);
      rig.repo.git(['checkout', '-q', 'main']);
      const record = await walkOn(rig, '2026-11-06');
      if (record.outcome.kind !== 'refused' || !record.outcome.refusals.some((r) => r.cause === 'history-rewritten')) {
        throw new Error(`I5: a last head kept only as a second parent was ${JSON.stringify(record.outcome)}`);
      }
    });
  },
});

const CLOSES_ONLY_WHAT_THE_HEAD_COVERED = runtime({
  id: 'I5.observe-closes-only-what-the-head-covered',
  title: 'a window still open when the walk read the head is not closed by that walk, however long the walk takes after it (codex-2)',
  run: async () => {
    await withObserve('r8a-head-time-', async (rig) => {
      const mergedAt = Date.now() - PAST_CLOSE + 120_000;
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      await seedMerge(rig.vault, RUN_A, a, new Date(mergedAt).toISOString());
      // A clock that moves a minute on every read: the window closes during the walk, after the head was read.
      rig.clock.now = mergedAt + PAST_CLOSE - 120_000 - 60_000;
      rig.clock.tick = 60_000;
      await walkOn(rig, '2026-11-05');
      if (kinds(await rig.vault.readObservations(RUN_A), 'window-closed').length > 0) throw new Error('I5: a window closed over time after the head the walk read');
    });
  },
});

const EARLY_SIGNAL_JOINS_ITS_RUN = runtime({
  id: 'I7.observe-early-signal-joins-its-run',
  title: "a failed check on a run's merge commit, delivered before the run's merge was recorded, counts against that run and not as unattributed (codex-3)",
  run: async () => {
    const { deriveOutcomes } = await api();
    await withObserve('r8a-early-', async (rig) => {
      const mergedAt = ago(PAST_CLOSE);
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      await signed(rig, CHECKS, checkFailure(a));
      await seedMerge(rig.vault, RUN_A, a, mergedAt);
      await walkOn(rig, '2026-11-05');
      const o = deriveOutcomes([await mergedRun(rig.vault, RUN_A, mergedAt, a)], {}, { observations: (await rig.vault.readObservations(null)).map((e) => e.record) });
      const escaped = o.safety.escapedFalseDone;
      if (escaped.kind !== 'rate' || escaped.count !== 1) throw new Error(`I7: an early failure did not count against its run: ${JSON.stringify(escaped)}`);
      if (o.safety.observed.unattributed !== 0) throw new Error("I7: a failure on a run's merge commit was counted unattributed");
    });
  },
});

const WINDOW_WAITS_FOR_LATE_DELIVERIES = runtime({
  id: 'I5.observe-window-waits-for-late-deliveries',
  title: "a window closes only once the policy's delivery age has also passed, so a failed check the window covered and GitHub could still deliver is not shut out (codex-4)",
  run: async () => {
    await withObserve('r8a-late-', async (rig) => {
      const mergedAt = Date.now() - WINDOW_MS - 60_000;
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      await seedMerge(rig.vault, RUN_A, a, new Date(mergedAt).toISOString());
      await walkOn(rig, '2026-11-05');
      if (kinds(await rig.vault.readObservations(RUN_A), 'window-closed').length > 0) throw new Error('I5: a window closed before a delivery it covers could arrive');
      rig.clock.now = mergedAt + PAST_CLOSE;
      await walkOn(rig, '2026-11-06');
      const closed = kinds(await rig.vault.readObservations(RUN_A), 'window-closed');
      if (closed.length !== 1) throw new Error('I5: the window did not close once the delivery age passed');
    });
  },
});

const WHOLE_REVERSAL_WITH_EDITS = runtime({
  id: 'I2.observe-whole-reversal-with-other-edits-is-a-rollback',
  title: "a commit that inverts every hunk of a change and also edits something else is a rollback, recorded as matched on its hunks rather than its patch id, and never dropped (codex-5, gemini-1)",
  run: async () => {
    await withObserve('r8a-whole-', async (rig) => {
      const a = await rig.repo.merge('feature-a', { 'a.txt': LINES(12, { 2: 'two, changed' }), 'c.txt': 'c\n' }, 'Add c');
      await seedMerge(rig.vault, RUN_A, a, ago(10_000));
      rig.repo.git(['revert', '-m', '1', '--no-commit', a]);
      await rig.repo.commit({ 'b.txt': 'b, and an unrelated edit\n' }, 'tidy');
      await walkOn(rig, '2026-11-05');
      const found = kinds(await rig.vault.readObservations(RUN_A), 'rollback');
      if (found.length !== 1 || found[0]?.signal.kind !== 'rollback' || found[0].signal.match !== 'all-hunks') throw new Error(`I2: a whole reversal with another edit was ${JSON.stringify(found)}`);
    });
  },
});

const ATTRIBUTES_DO_NOT_BLIND_THE_DIFF = runtime({
  id: 'I2.observe-attributes-do-not-blind-the-diff',
  title: "a .gitattributes that marks the changed files -diff or binary hides neither a rollback of them nor a partial reversal (gemini-3)",
  run: async () => {
    await withObserve('r8a-attributes-', async (rig) => {
      await rig.repo.commit({ '.gitattributes': '*.txt -diff\n*.dat binary\n' }, 'attributes');
      const a = await rig.repo.merge('feature-a', { 'a.txt': LINES(12, { 2: 'two, changed' }), 'd.dat': 'data\n' }, 'Change a');
      await seedMerge(rig.vault, RUN_A, a, ago(10_000));
      rig.repo.git(['revert', '-m', '1', '--no-edit', a]);
      await walkOn(rig, '2026-11-05');
      if (kinds(await rig.vault.readObservations(RUN_A), 'rollback').length !== 1) throw new Error('I2: a rollback of files the repository marks -diff or binary was not found');
      // A partial reversal is matched on hunks, which an attribute that suppresses the text diff would leave empty.
      const b = await rig.repo.merge('feature-b', { 'e.txt': LINES(12, { 2: 'two, b', 10: 'ten, b' }) }, 'Change e');
      await seedMerge(rig.vault, RUN_B, b, ago(10_000));
      await rig.repo.commit({ 'e.txt': LINES(12, { 10: 'ten, b' }) }, 'tidy e');
      await walkOn(rig, '2026-11-06');
      if (kinds(await rig.vault.readObservations(RUN_B), 'partial-reversal').length !== 1) throw new Error('I2: a partial reversal of a file the repository marks -diff was not found');
    });
  },
});

const MALFORMED_CLOSURE_REFUSED = runtime({
  id: 'I5.observe-malformed-closure-is-refused',
  title: "a window-closed observation without its window, opening time, commit date, and valid times is refused by the store, written or read, never taken as a clean close (codex-7)",
  run: async () => {
    await withObserve('r8a-malformed-', async (rig) => {
      const bare = { runId: RUN_A, change: 'a'.repeat(40), signal: { kind: 'window-closed', at: { at: 'anything', source: 'runtime' } }, recordedAt: new Date().toISOString(), collectedBy: 'runtime' };
      let refused = false;
      try {
        await rig.vault.recordObservation(bare as unknown as ObservationRecord);
      } catch {
        refused = true;
      }
      if (!refused) throw new Error('I5: the store accepted a window-closed record with no window, opening, or commit date');
      // Planted straight into the store, it is a fault on read, never a record to count.
      await seedMerge(rig.vault, RUN_A, 'a'.repeat(40), ago(10_000));
      const { createHash } = await import('node:crypto');
      const bytes = Buffer.from(JSON.stringify(bare));
      const dir = join(rig.store, 'runs', RUN_A, 'observations');
      const { mkdir } = await import('node:fs/promises');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${createHash('sha256').update(bytes).digest('hex')}.json`), bytes);
      let unread = false;
      try {
        await rig.vault.readObservations(RUN_A);
      } catch {
        unread = true;
      }
      if (!unread) throw new Error('I5: a malformed window-closed record was read as an observation');
    });
  },
});

const HISTORY_NEEDS_THE_CHECK_ROUTE = runtime({
  id: 'I5.observe-history-needs-the-check-route',
  title: "a policy that schedules observe-history without routing ci-failure to observe-signal through a subscription is refused, so no closed window reads as free of failed checks that were never collected (codex-8)",
  run: async () => {
    const { DEFAULT_POLICY_DOCUMENT, validatePolicyDocument } = await core();
    const triggers = {
      ...DEFAULT_POLICY_DOCUMENT.triggers,
      enabled: ['human', 'scheduled'] as const,
      entryStation: { human: 'intake' as const, scheduled: 'intake' as const },
      taskTemplate: { scheduled: 'intake-candidate' as const },
      maxAutonomy: { human: 2 as const, scheduled: 0 as const },
      minAuthorTrust: { human: 'owner' as const, scheduled: 'owner' as const },
      maxDeliveryAgeMs: DELIVERY_AGE_MS, candidateExpiryMs: 86_400_000,
      observe: { windowMs: WINDOW_MS },
      schedules: [{ id: 'observe', template: 'observe-history' as const, at: '04:00' }],
    };
    const out = validatePolicyDocument({ ...DEFAULT_POLICY_DOCUMENT, triggers: { ...triggers, enabled: [...triggers.enabled] } });
    if (out.ok || !out.defects.some((d) => d.path === 'triggers.schedules' && d.problem.includes('ci-failure'))) {
      throw new Error(`I5: observe-history validated with no route for failed checks: ${JSON.stringify(out.ok ? [] : out.defects)}`);
    }
  },
});

const RUN_LEAVES_OBSERVE = runtime({
  id: 'I2.observe-closed-run-leaves-observe',
  title: "a run whose window the walk closed is committed out of observe, phase exiting, by the runtime; one whose window is open stays working (codex, coverage)",
  run: async () => {
    await withObserve('r8a-leave-', async (rig) => {
      const a = await rig.repo.merge('feature-a', { 'c.txt': 'c\n' }, 'Add c');
      const b = await rig.repo.merge('feature-b', { 'd.txt': 'd\n' }, 'Add d');
      const RUN_C = 'run-c' as RunId;
      await seedMerge(rig.vault, RUN_A, a, ago(PAST_CLOSE));
      await seedMerge(rig.vault, RUN_C, b, ago(10_000));
      for (const runId of [RUN_A, RUN_C]) {
        await rig.vault.commitRunState({
          runId, admission: { runId, kind: 'admission', hash: 'c'.repeat(64) }, station: 'observe', stations: [{ station: 'observe', enteredAt: new Date().toISOString() }], phase: 'working',
          tasks: {}, attempts: {}, results: {}, evidenceRefs: [], violations: [], approvals: [], reviews: [], drafts: {}, usage: [], cancelled: null, halted: null, version: '0',
        }, '0');
      }
      await walkOn(rig, '2026-11-05');
      const closed = await rig.vault.readRunState(RUN_A);
      if (closed.station !== 'observe' || closed.phase !== 'exiting') throw new Error(`I2: a closed run is ${closed.phase} at ${closed.station}`);
      const open = await rig.vault.readRunState(RUN_C);
      if (open.phase !== 'working') throw new Error('I2: a run whose window is open was moved out of observe');
    });
  },
});

export const R8A_REVIEW_I2: readonly LocalAssertion[] = [WHOLE_REVERSAL_WITH_EDITS, ATTRIBUTES_DO_NOT_BLIND_THE_DIFF, RUN_LEAVES_OBSERVE];
export const R8A_REVIEW_I5: readonly LocalAssertion[] = [
  DROPPED_MERGE_REFUSED, CLOSES_ONLY_WHAT_THE_HEAD_COVERED, WINDOW_WAITS_FOR_LATE_DELIVERIES, MALFORMED_CLOSURE_REFUSED, HISTORY_NEEDS_THE_CHECK_ROUTE,
];
export const R8A_REVIEW_I7: readonly LocalAssertion[] = [EARLY_SIGNAL_JOINS_ITS_RUN];
