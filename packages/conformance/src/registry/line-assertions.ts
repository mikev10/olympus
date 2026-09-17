/**
 * The runtime assertions P4 owes, one per behaviour of the station line, each
 * registered under the invariant it protects (i2.ts, i3.ts, i4.ts, i5.ts,
 * i6.ts). They live together because they share one rig and one fixture;
 * the invariant files hold the entries.
 *
 * Each drives the real line over the filesystem Vault. Where a refusal is
 * required, the assertion also runs the control, the same run with the one
 * thing removed that should cause it, so no assertion passes on a line that
 * refuses everything.
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunOutcome } from '@olympus-ai/api';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type { AutonomyLevel, ModelFamily, ModelIdentity, RunState, StationContractTable, TaskId } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { LockManifest, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import {
  comparable,
  HELLO_REVIEW,
  HELLO_TASK,
  linePolicy,
  readArtifact,
  readRecord,
  refusalOf,
  stubDriver,
  withLine,
  writeManifest,
} from './line.js';

const api = async () => import('@olympus-ai/api');

function stateOf(outcome: RunOutcome, context: string): RunState {
  const refusal = refusalOf(outcome, context);
  if (refusal.state === null) throw new Error(`${context}: the refusal carries no run state`);
  return refusal.state;
}

/** Wraps a Vault so a test can act between two of its calls; every method forwards. */
function around(inner: Vault, hooks: { beforeLock?: (by: string) => Promise<void>; afterCommit?: (count: number) => void }): Vault {
  let commits = 0;
  return {
    read: (ref) => inner.read(ref),
    lock: async (runId, paths, by): Promise<LockManifest> => {
      if (hooks.beforeLock !== undefined) await hooks.beforeLock(by);
      return inner.lock(runId, paths, by);
    },
    verifyLocks: (runId) => inner.verifyLocks(runId),
    writeEvidence: (b) => inner.writeEvidence(b),
    recordViolation: (v) => inner.recordViolation(v),
    recordAdmission: (a) => inner.recordAdmission(a),
    recordTaskResult: (runId, r) => inner.recordTaskResult(runId, r),
    readRunState: (runId) => inner.readRunState(runId),
    commitRunState: async (s, ifVersion) => {
      const stored = await inner.commitRunState(s, ifVersion);
      commits += 1;
      hooks.afterCommit?.(commits);
      return stored;
    },
  };
}

export const TRANSITION_REVERIFIES_LOCKS: LocalAssertion = runtime({
  id: 'I3.transition-reverifies-locks',
  title:
    'a locked artifact an agent rewrites during build is caught by the lock re-verification on the way out of build: the run records a lock-tamper violation naming the path and both hashes, writes no evidence, and a resume refuses it; an artifact changed while a run waits at an approval is caught at that exit on resume',
  run: async () => {
    await withLine('p4-i3-build-', async (rig) => {
      const { startRun, resumeRun } = await api();
      const writer = await stubDriver({
        during: async () => {
          await writeFile(join(rig.dirs.artifacts, 'spec.md'), '# hello\n\nThe capability, quietly widened by the agent.\n');
        },
      });
      const components = await rig.components({ driver: writer, reviewer: writer });
      const refusal = refusalOf(await startRun(await rig.request(components)), 'I3');
      if (refusal.at !== 'build' || refusal.transition.reason !== 'lock-tamper') {
        throw new Error(`I3: a spec rewritten during build was refused at ${refusal.at} as '${refusal.transition.reason}', not at build as lock-tamper`);
      }
      const [tampered] = refusal.transition.tampered;
      if (refusal.transition.tampered.length !== 1 || tampered?.path !== 'spec.md' || tampered.expected === tampered.actual) {
        throw new Error(`I3: the refusal named ${JSON.stringify(refusal.transition.tampered)}; expected spec.md with two different hashes`);
      }
      const state = await rig.state();
      if (state.evidenceRefs.length !== 0) throw new Error('I3: evidence was written for a task whose locked spec changed under it');
      const [ref] = state.violations;
      if (state.violations.length !== 1 || ref === undefined) throw new Error(`I3: ${String(state.violations.length)} violations were recorded, expected one`);
      const violation = await readRecord<IntegrityViolation>(components.vault, ref);
      if (violation.kind !== 'lock-tamper') throw new Error(`I3: the violation recorded is '${violation.kind}'`);

      // A fresh process resuming the run does not get past the violation.
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components() }), 'I3 resume');
      if (resumed.transition.reason !== 'violation') {
        throw new Error(`I3: a resumed run with a recorded violation was refused as '${resumed.transition.reason}', not 'violation'`);
      }
    });

    await withLine('p4-i3-exit-', async (rig) => {
      const { startRun, resumeRun, approveStation } = await api();
      const components = await rig.components();
      const waiting = refusalOf(await startRun(await rig.request(components)), 'I3 control');
      if (waiting.at !== 'integrate' || waiting.transition.reason !== 'approval-required') {
        throw new Error(`I3: the untouched run did not reach the integrate approval (${waiting.at}, ${waiting.transition.reason}); the control is broken`);
      }
      // Changed while nobody was running: only the exit's own verification can see it.
      await writeFile(join(rig.dirs.artifacts, 'acceptance.md'), '# hello: acceptance\n\n- nothing is required\n');
      const approved = await approveStation({ runId: rig.runId, key: 'integrate:1', approvedBy: 'conformance', vault: components.vault });
      if (!approved.ok) throw new Error(`I3: the integrate approval was refused (${approved.message})`);
      const exit = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components() }), 'I3 exit');
      if (exit.at !== 'integrate' || exit.transition.reason !== 'lock-tamper') {
        throw new Error(`I3: an acceptance file changed during the wait was not refused at the integrate exit (${exit.at}, ${exit.transition.reason})`);
      }
    });
  },
});

export const STATION_LOCKS_THE_ADMITTED_ARTIFACT: LocalAssertion = runtime({
  id: 'I3.station-locks-the-admitted-artifact',
  title:
    'an artifact changed between admission and the station that locks it is refused at that lock as a tamper against its admission hash, with a violation recorded, rather than locked as it now is and then verified clean against itself',
  run: async () => {
    await withLine('p4-i3-admit-', async (rig) => {
      const { startRun } = await api();
      const base = await rig.components();
      const vault = around(base.vault, {
        beforeLock: async (by) => {
          if (by === 'test-design') await writeFile(join(rig.dirs.artifacts, 'acceptance.md'), '# swapped after admission\n');
        },
      });
      const outcome = await startRun(await rig.request({ ...base, vault }));
      const refusal = refusalOf(outcome, 'I3');
      if (refusal.at !== 'test-design' || refusal.transition.reason !== 'lock-tamper') {
        throw new Error(`I3: an acceptance file swapped before its lock was refused at ${refusal.at} as '${refusal.transition.reason}'`);
      }
      const [entry] = refusal.transition.tampered;
      if (entry?.path !== 'acceptance.md') throw new Error(`I3: the tamper named ${JSON.stringify(refusal.transition.tampered)}`);
      if ((await rig.state()).violations.length !== 1) throw new Error('I3: no violation was recorded for the swapped artifact');
    });
  },
});

export const APPROVAL_OUTCOME_GATES_THE_STATION: LocalAssertion = runtime({
  id: 'I4.approval-outcome-gates-the-station',
  title:
    'a blocked approval cell refuses the station exit, cannot be approved, and holds on resume; a human-required cell refuses until approveStation records a grant for exactly that station and level, and a resume then advances; the stricter of the contract floor and the policy cell applies, so integrate needs a human even where the policy says auto; and a grant crosses one exit, so a station re-entered after a failed verify waits for its own approval',
  run: async () => {
    await withLine('p4-i4-blocked-', async (rig) => {
      const { startRun, resumeRun, approveStation } = await api();
      const components = await rig.components();
      const blocked = refusalOf(await startRun(await rig.request(components, { policy: await linePolicy({ 'review:1': 'blocked' }) })), 'I4 blocked');
      if (blocked.at !== 'review' || blocked.transition.reason !== 'approval-blocked' || blocked.transition.key !== 'review:1') {
        throw new Error(`I4: a blocked review:1 cell was refused at ${blocked.at} as '${blocked.transition.reason}'`);
      }
      const approval = await approveStation({ runId: rig.runId, key: 'review:1', approvedBy: 'conformance', vault: components.vault });
      if (approval.ok) throw new Error('I4: a blocked exit was approved');
      const again = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components() }), 'I4 blocked resume');
      if (again.transition.reason !== 'approval-blocked') throw new Error(`I4: a resumed run got past a blocked exit ('${again.transition.reason}')`);
    });

    await withLine('p4-i4-human-', async (rig) => {
      const { startRun, resumeRun, approveStation } = await api();
      const driver = await stubDriver();
      const components = await rig.components({ driver, reviewer: driver });
      const policy = await linePolicy({ 'spec:1': 'human-required', 'integrate:1': 'auto' });
      const waiting = refusalOf(await startRun(await rig.request(components, { policy })), 'I4 human');
      if (waiting.at !== 'spec' || waiting.transition.reason !== 'approval-required' || waiting.transition.key !== 'spec:1') {
        throw new Error(`I4: a human-required spec:1 cell was refused at ${waiting.at} as '${waiting.transition.reason}'`);
      }
      if (driver.requests.length !== 0) throw new Error('I4: a task ran past an exit that was waiting for a human');
      const vault = components.vault;
      for (const key of ['spec:2', 'plan:1'] as const) {
        const wrong = await approveStation({ runId: rig.runId, key, approvedBy: 'conformance', vault });
        if (wrong.ok) throw new Error(`I4: an approval of ${key} was recorded while the run waited at spec:1`);
      }
      const right = await approveStation({ runId: rig.runId, key: 'spec:1', approvedBy: 'conformance', vault });
      if (!right.ok) throw new Error(`I4: the approval of spec:1 was refused (${right.message})`);

      // The policy says integrate:1 is auto; the contract's floor still holds.
      const floor = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components() }), 'I4 floor');
      if (floor.at !== 'integrate' || floor.transition.reason !== 'approval-required') {
        throw new Error(`I4: after the spec approval the run stopped at ${floor.at} as '${floor.transition.reason}', not at the integrate floor`);
      }
      const integrate = await approveStation({ runId: rig.runId, key: 'integrate:1', approvedBy: 'conformance', vault });
      if (!integrate.ok) throw new Error(`I4: the integrate approval was refused (${integrate.message})`);
      const done = await resumeRun({ runId: rig.runId, components: await rig.components() });
      if (!done.ok) throw new Error(`I4: the fully approved run did not complete (${done.reason})`);
    });

    // A grant authorises one exit, not the station. A failed verify sends the
    // task back to `build`, and the second `build` exit is a gate nobody has
    // approved: the first visit's grant is spent and does not stand in for it.
    await withLine('p4-i4-revisit-', async (rig) => {
      const { startRun, resumeRun, approveStation } = await api();
      const driver = await stubDriver();
      const sandbox = await failsFirstCheck();
      const components = await rig.components({ driver, reviewer: driver, sandbox });
      const policy = await linePolicy({ 'build:1': 'human-required' });
      const first = refusalOf(await startRun(await rig.request(components, { policy })), 'I4 first build exit');
      if (first.at !== 'build' || first.transition.reason !== 'approval-required') {
        throw new Error(`I4: the first build exit ended at ${first.at} as '${first.transition.reason}'`);
      }
      const vault = components.vault;
      const granted = await approveStation({ runId: rig.runId, key: 'build:1', approvedBy: 'conformance', vault });
      if (!granted.ok) throw new Error(`I4: the first build approval was refused (${granted.message})`);

      const second = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components({ driver, reviewer: driver, sandbox }) }), 'I4 rebuild');
      const built = driver.requests.filter((r) => r.taskId === HELLO_TASK).length;
      if (built !== 2) throw new Error(`I4: the failed check did not send the task back to build; it was built ${String(built)} time(s)`);
      if (second.at !== 'build' || second.transition.reason !== 'approval-required' || second.transition.key !== 'build:1') {
        throw new Error(`I4: the rebuilt task crossed the human-required build exit on the first visit's grant (${second.at}, '${second.transition.reason}')`);
      }
      const grants = (await rig.state()).approvals;
      if (grants.length !== 1 || grants[0]?.usedAt === null) throw new Error(`I4: the spent grant is recorded as ${JSON.stringify(grants)}`);

      const again = await approveStation({ runId: rig.runId, key: 'build:1', approvedBy: 'conformance', vault });
      if (!again.ok) throw new Error(`I4: the second visit to build could not be approved in its own right (${again.message})`);
      const onward = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components({ driver, reviewer: driver, sandbox }) }), 'I4 onward');
      if (onward.at !== 'integrate') throw new Error(`I4: after the second approval the run stopped at ${onward.at}`);
    });
  },
});

export const STATION_MISSING_CAPABILITY_REFUSED: LocalAssertion = runtime({
  id: 'I5.station-missing-capability-refused',
  title:
    'a driver lacking a capability its station requires is refused with capability-missing naming the station and the capability, at admission before anything is recorded, and on resume before anything runs; the same run with the capability declared proceeds',
  run: async () => {
    await withLine('p4-i5-cap-', async (rig) => {
      const { startRun, resumeRun } = await api();
      const lacking = await stubDriver({ capabilities: { parallelism: 0 } });
      const admitted = await rig.components({ driver: lacking, reviewer: await stubDriver() });
      const refusal = refusalOf(await startRun(await rig.request(admitted)), 'I5 admission');
      const t = refusal.transition;
      if (t.reason !== 'capability-missing' || t.station !== 'build' || t.capability !== 'parallelism' || refusal.state !== null) {
        throw new Error(`I5: a build driver with parallelism 0 was refused as ${JSON.stringify(t)} with state ${JSON.stringify(refusal.state)}`);
      }
      if (lacking.requests.length !== 0) throw new Error('I5: the driver lacking the capability was called');
      let recorded = true;
      try {
        await rig.state();
      } catch {
        recorded = false;
      }
      if (recorded) throw new Error('I5: a run refused at admission left run state behind');

      // The control: the same run admitted with the capability declared.
      const waiting = refusalOf(await startRun(await rig.request(await rig.components())), 'I5 control');
      if (waiting.transition.reason !== 'approval-required') throw new Error(`I5: the control run was refused as '${waiting.transition.reason}'`);

      // Resumed with a reviewer that lacks it: refused before anything runs, state untouched.
      const before = await rig.state();
      const reviewer = await stubDriver({ capabilities: { parallelism: 0 } });
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components({ reviewer }) }), 'I5 resume');
      if (resumed.transition.reason !== 'capability-missing' || resumed.transition.station !== 'review') {
        throw new Error(`I5: a resume with an incapable reviewer was refused as ${JSON.stringify(resumed.transition)}`);
      }
      if ((await rig.state()).version !== before.version) throw new Error('I5: the refused resume committed run state');
    });
  },
});

export const TASK_ATTEMPTS_ARE_BOUNDED: LocalAssertion = runtime({
  id: 'I5.task-attempts-are-bounded',
  title:
    'a task whose gate keeps failing parks with iterations-exhausted after the build contract\'s maxIterations, and one whose driver keeps failing parks with retries-exhausted after retry.max; both counts are committed run state, and a resume with a working driver refuses the parked run rather than resetting them',
  run: async () => {
    const { STATION_CONTRACTS } = await import('@olympus-ai/core');
    const { maxIterations, retry } = STATION_CONTRACTS.build;
    await withLine('p4-i5-iter-', async (rig) => {
      const { startRun } = await api();
      await writeManifest(rig.dirs, [{ id: 'always-fails', kind: 'unit', command: 'node -e process.exit(1)', required: true, timeoutMs: 10_000 }]);
      const driver = await stubDriver({ narrative: 'all tests pass' });
      const refusal = refusalOf(await startRun(await rig.request(await rig.components({ driver, reviewer: driver }))), 'I5 iterations');
      const t = refusal.transition;
      if (t.reason !== 'parked' || t.cause !== 'iterations-exhausted' || t.limit !== maxIterations || t.task !== HELLO_TASK) {
        throw new Error(`I5: a gate that always fails ended as ${JSON.stringify(t)}`);
      }
      if (driver.requests.length !== maxIterations) throw new Error(`I5: the task was built ${String(driver.requests.length)} times, not ${String(maxIterations)}`);
      const attempts = (await rig.state()).attempts[HELLO_TASK];
      if (attempts?.iterations !== maxIterations) throw new Error(`I5: run state records ${JSON.stringify(attempts)} for the parked task`);
    });

    await withLine('p4-i5-retry-', async (rig) => {
      const { startRun, resumeRun } = await api();
      const failing = await stubDriver({ failing: true });
      const refusal = refusalOf(await startRun(await rig.request(await rig.components({ driver: failing }))), 'I5 retries');
      const t = refusal.transition;
      if (t.reason !== 'parked' || t.cause !== 'retries-exhausted' || t.limit !== retry.max) {
        throw new Error(`I5: a driver that always fails ended as ${JSON.stringify(t)}`);
      }
      if (failing.requests.length !== retry.max + 1) throw new Error(`I5: the failing driver was called ${String(failing.requests.length)} times`);
      const before = await rig.state();
      const resumed = refusalOf(await resumeRun({ runId: rig.runId, components: await rig.components() }), 'I5 resume');
      if (resumed.transition.reason !== 'parked') throw new Error(`I5: a resume with a working driver unparked the task ('${resumed.transition.reason}')`);
      if (JSON.stringify((await rig.state()).attempts) !== JSON.stringify(before.attempts)) throw new Error('I5: a resume changed the spent attempt counts');
    });
  },
});

export const OVER_REQUEST_REFUSED_AT_ADMISSION: LocalAssertion = runtime({
  id: 'I5.over-request-refused-at-admission',
  title:
    'a requested level above the cap at any station the run will enter is refused at admission, naming the station and, where one acts, the role, before anything is recorded; the same request within every cap is admitted',
  run: async () => {
    const cases = [
      { station: 'review', role: 'reviewer', caps: { review: 0 } },
      { station: 'integrate', role: null, caps: { integrate: 0 } },
    ] as const;
    for (const c of cases) {
      await withLine(`p4-i5-cap-${c.station}-`, async (rig) => {
        const { startRun } = await api();
        const policy = await linePolicy({}, { stationCaps: c.caps });
        const outcome = await startRun(await rig.request(await rig.components(), { policy }));
        if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.station !== c.station || outcome.role !== c.role || outcome.refusal.reason !== 'exceeds-cap') {
          throw new Error(`I5: L1 against a ${c.station} cap of L0 ended as ${JSON.stringify(outcome)}`);
        }
        let recorded = true;
        try {
          await rig.state();
        } catch {
          recorded = false;
        }
        if (recorded) throw new Error(`I5: the over-request at ${c.station} left run state behind`);
        const within = await startRun(await rig.request(await rig.components(), { requestedLevel: 0, policy }));
        if (!within.ok && within.reason === 'policy-refused') throw new Error(`I5: L0 within the ${c.station} cap was refused`);
      });
    }
  },
});

export const RESUME_DERIVES_STATE_FROM_THE_VAULT: LocalAssertion = runtime({
  id: 'I2.resume-derives-state-from-the-vault',
  title:
    'a run stopped after any one of its committed states and resumed by a fresh process reaches the same station, phase, task statuses, attempt counts, results, approvals, and review seats as the same run uninterrupted; a resume takes its level and policy from the admission record, and starting an admitted run again at another level is refused',
  run: async () => {
    const { startRun, resumeRun } = await api();
    let expected: unknown;
    let commits = 0;
    await withLine('p4-i2-whole-', async (rig) => {
      const base = await rig.components();
      const counted = around(base.vault, { afterCommit: (n) => { commits = n; } });
      expected = comparable(stateOf(await startRun(await rig.request({ ...base, vault: counted })), 'I2 uninterrupted'));
      const again = await startRun(await rig.request(await rig.components(), { requestedLevel: 0 }));
      if (again.ok || again.reason !== 'invalid-request' || !again.problems.some((p) => p.code === 'already-admitted')) {
        throw new Error(`I2: starting an admitted run again at L0 ended as ${again.ok ? 'ok' : again.reason}`);
      }
    });
    if (commits < 10) throw new Error(`I2: the uninterrupted run committed ${String(commits)} states; the rig is not exercising the line`);

    for (let stopAfter = 1; stopAfter <= commits; stopAfter += 1) {
      await withLine(`p4-i2-stop${String(stopAfter)}-`, async (rig) => {
        const base = await rig.components();
        const stopping = around(base.vault, {
          afterCommit: (n) => {
            if (n === stopAfter) throw new Error(`stopped after commit ${String(n)}`);
          },
        });
        let stopped = false;
        try {
          await startRun(await rig.request({ ...base, vault: stopping }));
        } catch {
          stopped = true;
        }
        if (!stopped) throw new Error(`I2: the run was not stopped after commit ${String(stopAfter)}`);
        const resumed = stateOf(await resumeRun({ runId: rig.runId, components: await rig.components() }), `I2 resumed after commit ${String(stopAfter)}`);
        const got = comparable(resumed);
        if (JSON.stringify(got) !== JSON.stringify(expected)) {
          throw new Error(`I2: stopped after commit ${String(stopAfter)} and resumed, the run reached ${JSON.stringify(got)}; uninterrupted it reached ${JSON.stringify(expected)}`);
        }
      });
    }
  },
});

/** A sandbox whose first check exits non-zero and whose later ones pass, so exactly one verify fails. */
async function failsFirstCheck(): Promise<SandboxProvider> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  let checks = 0;
  return {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    provision: (spec) => inner.provision(spec),
    destroy: (handle) => inner.destroy(handle),
    exec: async (handle, cmd) => {
      checks += 1;
      const result = await inner.exec(handle, cmd);
      return checks === 1 ? { ...result, exitCode: 1 } : result;
    },
  };
}

function identity(family: string): ModelIdentity {
  return { provider: 'conformance', family: family as ModelFamily, model: 'm', version: '1' };
}

export const REVIEW_SEAT_FAMILY_CHECK: LocalAssertion = runtime({
  id: 'I6.review-seat-family-check',
  title:
    'every review seat compares the reviewer family with each author family read from the recorded results: at L0-L2 a same-family seat is filled and run state records reduced independence, and a different family records independent; at L3 a same-family reviewer is refused and the run does not advance (asserted on the machine, since the line refuses every run above L1 until P6)',
  run: async () => {
    const { seatReviewer } = await import('@olympus-ai/core');
    const review = 'review-1' as TaskId;
    const authors = [identity('claude')];
    for (const level of [0, 1, 2] as AutonomyLevel[]) {
      const seat = seatReviewer(review, authors, identity('claude'), level);
      if (!seat.ok || seat.seat.independence !== 'reduced') throw new Error(`I6: a same-family seat at L${String(level)} was ${JSON.stringify(seat)}`);
    }
    const l3 = seatReviewer(review, authors, identity('claude'), 3);
    if (l3.ok || l3.reason !== 'same-family-reviewer') throw new Error(`I6: a same-family reviewer at L3 was ${JSON.stringify(l3)}`);
    const l3Other = seatReviewer(review, authors, identity('gpt'), 3);
    if (!l3Other.ok || l3Other.seat.independence !== 'independent') throw new Error('I6: a different-family reviewer at L3 was not seated as independent');

    for (const [family, independence] of [['stub', 'reduced'], ['other-family', 'independent']] as const) {
      await withLine(`p4-i6-${independence}-`, async (rig) => {
        const { startRun } = await api();
        const author = await stubDriver();
        const reviewer = await stubDriver({ family });
        const state = stateOf(await startRun(await rig.request(await rig.components({ driver: author, reviewer }))), 'I6');
        const [seat] = state.reviews;
        if (state.reviews.length !== 1 || seat === undefined) throw new Error(`I6: ${String(state.reviews.length)} seats were recorded, expected one`);
        if (seat.task !== HELLO_REVIEW || seat.independence !== independence || seat.reviewer.family !== family || seat.authors[0]?.family !== 'stub') {
          throw new Error(`I6: a ${family} reviewer of a stub author was recorded as ${JSON.stringify(seat)}`);
        }
      });
    }
  },
});

export const REVIEWER_RECEIVES_NO_AUTHOR_MATERIAL: LocalAssertion = runtime({
  id: 'I6.reviewer-receives-no-author-material',
  title:
    "the reviewer's TaskRequest carries the locked spec and the runtime's check results and never the author's narrative or the plan, although the line offers both; a contract table or a single review contract widened past the compiler is refused before anything is assembled",
  run: async () => {
    const SENTINEL = 'AUTHOR-NARRATIVE-SENTINEL: every test passes';
    await withLine('p4-i6-context-', async (rig) => {
      const { startRun } = await api();
      const author = await stubDriver({ narrative: SENTINEL });
      const reviewer = await stubDriver({ family: 'other-family' });
      await startRun(await rig.request(await rig.components({ driver: author, reviewer })));
      const [req] = reviewer.requests;
      if (reviewer.requests.length !== 1 || req === undefined) throw new Error(`I6: the reviewer was called ${String(reviewer.requests.length)} times`);
      const context = `${req.stablePrefix}\n${req.variableSuffix}`;
      if (context.includes('AUTHOR-NARRATIVE-SENTINEL')) throw new Error("I6: the author's narrative reached the reviewer");
      if (context.includes('"dependencySet"') || context.includes('[plan]') || context.includes('[task-graph]')) {
        throw new Error('I6: the plan reached the reviewer');
      }
      if (!context.includes((await readArtifact(rig.dirs, 'spec.md')).trim())) throw new Error('I6: the reviewer was not given the locked spec');
      if (!context.includes('hello-exit-zero')) throw new Error("I6: the reviewer was not given the runtime's check results");
      const [authorReq] = author.requests;
      if (authorReq === undefined || authorReq.stablePrefix.includes('AUTHOR-NARRATIVE-SENTINEL')) throw new Error('I6: the control is broken');
    });

    const { STATION_CONTRACTS, contractTableProblems, grantedContext } = await import('@olympus-ai/core');
    const widened = {
      ...STATION_CONTRACTS,
      review: { ...STATION_CONTRACTS.review, allowedContext: [...STATION_CONTRACTS.review.allowedContext, 'author-narrative', 'plan'] },
    } as unknown as StationContractTable;
    const problems = contractTableProblems(widened).filter((p) => p.station === 'review');
    if (problems.length !== 2) throw new Error(`I6: a review contract granting the narrative and the plan produced ${JSON.stringify(problems)}`);
    let assembled = true;
    try {
      grantedContext(widened.review, { 'author-narrative': SENTINEL });
    } catch {
      assembled = false;
    }
    if (assembled) throw new Error('I6: context was assembled for a review contract that grants the author narrative');
  },
});
