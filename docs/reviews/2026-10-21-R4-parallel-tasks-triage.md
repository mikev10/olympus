# Triage of the external reviews of R4, 2026-10-21

Two reviews of R4, parallel task execution, run from one prompt and one bundle
(`2026-10-21-R4-parallel-tasks-review-bundle.txt`, SHA-256
`5cac0a5a6590b0027eb6a2cad9b8e3c5d0782c8016d607fcfb1d1740826863f1`, base
`be3540f` (`reviewed/R17`), head `3ce72ad`):

- `2026-10-21-R4-parallel-tasks-review-codex.md`: gpt-6-astra, family codex,
  outcome `counted`
- `2026-10-21-R4-parallel-tasks-review-gemini.md`: gemini-3.1-pro-preview,
  family gemini, outcome `counted` (second attempt; the first returned HTTP 402
  and was `FAILED`, archived as `*.attempt-1.*`, not triaged)

Both replies matched their manifests' `replySha256` before their headers were
prepended, and the text beneath each header still does.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 3 | 3 | 0 | 0 | 0 |
| gemini | 0, plus an assessment | — | — | — | — |

No finding was raised by both families. gemini answered only items 6 and 7;
two claims in its assessment (`gemini-obs`) are contradicted by codex-1 and
codex-2, both of which held.

All three codex findings hold. Two of them (codex-1, codex-2) describe defects
that predate R4: the same construct is at the base commit, and R4 edited the
function around it without introducing or removing the defect. codex-3 is in
tests R4 did not touch.

Each finding went to a verifier with fresh context, given the finding's text
and the repository, and not told who wrote the code. codex-1 and codex-2 were
settled by running them: temporary tests in `packages/drivers/claude-code` and
`packages/core`, deleted afterwards (`git status` clean). codex-3 was settled by
reading the tests and the diff over the range.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | Three callers on one sandbox: two followers both await the leader, then both run at once | codex | holds | fixed (D-R4-09) |
| codex-2 | A task parked for exhausted starts on its last iteration is recorded as `iterations-exhausted` | codex | holds | known limit (D-R4-10), issue #47 |
| codex-3 | `if (ref === undefined) return;` lets two line tests pass with no evidence recorded | codex | holds | issue #48 |
| gemini-obs | `#bounded` and replay accounting judged sound | gemini | holds in part | no change; see codex-1, codex-2 |

## codex-1: the per-sandbox lock admits two followers at once

**Claim.** In `#serialized` (`packages/drivers/claude-code/src/driver.ts`),
callers B and C on a handle held by A both read A's promise as `previous`,
await it, and then both enter `#bounded` without re-checking the handle.

**Checked.** `#serialized` reads `#inFlight.get(handle)`, awaits it, and only
then calls `#bounded(body)` and `#inFlight.set(handle, running)`. Nothing
reserves the handle before the await, so every caller that arrived while A ran
resumes in the same tick and proceeds. A fourth caller then queues behind
whichever of B and C set the map last.

**Run.** A temporary test drove three `runTask` calls on one sandbox handle
against a fake provider whose task exec holds for 50 ms: at most 2 execs were
inside the sandbox at once, where 1 is the contract. With A rejecting (exit 1),
the result is the same; the `.catch(() => undefined)` swallows it.

**Contract.** D-P5-11 and D-A-PT-02 say one in-flight invocation per sandbox
handle, and the comment on `#serialized` repeats it. The existing test
(`driver.test.ts`, one follower) cannot see the defect.

**Consequence.** The line provisions a fresh sandbox per task before calling
`runTask`, so it never puts three calls on one handle; the global four-call
bound holds. The defect is reachable by a direct driver caller, or by
`spawnSubagent` calls that share their parent's `req.sandbox`. Latent in a
documented driver contract, not a live line bug. Severity: medium, as the
reviewer said.

**Ownership.** The same construct is at `be3540f` (P5). R4 rewrote this
function to put `#bounded` behind it and restated the per-sandbox promise in
D-A-PT-02, so the claim this defect breaks is one R4 made. The fix is internal
to the function and changes no interface.

**Verdict:** holds.

## codex-2: start exhaustion on the last iteration is recorded as failed gates

**Claim.** `parkRefusal` (`packages/core/src/station/machine.ts`) sets
`byStarts` only when `gatedIterations(attempts) < maxIterations`; replays on the
last iteration raise `starts` without `iterations`, so a park for exhausted
starts there is recorded as `iterations-exhausted`.

**Checked.** `startAttempt` (`packages/api/src/line.ts`) commits
`iterations + 1` before the attempt runs and a replay bumps only `starts`
(`tier.ts` says the same). At iteration 3 of build (max 3, start limit 9 with no
conflicts), with two failed gates, `gatedIterations` is 3, so `byStarts` is
false. Repeated stops between the driver call and its commit drive `starts` to
9; the next start parks.

**Run.** A temporary test called `parkRefusal` with a build task and
`{ iterations: 3, retries: 0, conflicts: [], starts: 9 }`: cause
`iterations-exhausted`, limit 3, message "its gate failed on all 3 iterations".
The existing restart test covers only iteration 1, where `byStarts` is true.

**Consequence.** Behaviour is unchanged: the task parks either way, safely. The
enforcement record is wrong: `park` writes the refusal as a `station-refused`
decision, and on resume `nextStep` re-derives the refusal from state and
records the same mislabel. No reader branches on the cause outside tests and
conformance, which exercise genuine gate failures.

**Why the reviewer's fix is not enough.** Passing the cause from `startAttempt`
into `park` corrects the first record only; the resume re-derives from counts,
and the counts cannot tell this case from a genuine exhaustion (three
iterations each spending both retries also reach `starts` 9 with the third gate
failed). A correct fix needs a state fact that records the cause, which is a
change to the committed run-state shape.

**Ownership.** The same predicate is at `be3540f` (`attempts.iterations <
maxIterations`, A-P4-06); R4 replaced `iterations` with `gatedIterations`
without changing this case. The defect predates R4 and is not about parallel
execution.

**Verdict:** holds.

## codex-3: two line tests pass with no evidence recorded

**Claim.** The "required check that cannot be started" test in
`packages/api/test/line.test.ts`, and the suite-count test beside it, return
early when `state.evidenceRefs` is empty.

**Checked.** Both read `const [ref] = state.evidenceRefs;` then
`if (ref === undefined) return;`, with no length assertion before. The first
asserts only that the task parked; the second only that it passed. A regression
that recorded no evidence passes both. The same early return appears at five
more places in the file, and `if (req === undefined) return;` at one.

**Ownership.** `git diff be3540f 3ce72ad` touches neither test; both predate R4.
The reviewer said so too.

**Verdict:** holds.

## gemini-obs: the assessment

gemini judged the commit queue, serial acceptance, conflict detection, the
concurrency ceiling, `#bounded`, the gate arithmetic and the replay accounting
sound. Most of that agrees with codex's own assessment and with the code. Two
parts do not hold whole: `#bounded` is sound as a global bound, but the
per-sandbox lock in front of it is not (codex-1); and the replay accounting is
sound for the bound but not for the recorded cause (codex-2). Its claim that the
framing was "exactly right" and that every vector is neutralized is recorded as
its view; it left items 1 to 5 empty, including the fail-open branch codex-3
found.

## What changed

The maintainer confirmed the three recommended outcomes.

- **codex-1, fixed.** `#serialized` in
  `packages/drivers/claude-code/src/driver.ts` re-checks the handle after every
  wait and claims it with no await between the check and the claim. A new
  `driver.test.ts` case runs three tasks on one sandbox, once with the first
  settling and once with it rejecting, and asserts one call inside at a time.
  Both cases failed against the old function (2 at once) before the fix and
  pass after it. Recorded as D-R4-09, with a changeset.
- **codex-2, known limit.** Recorded as D-R4-10, owned by issue #47; no code
  changed.
- **codex-3, issue #48.** No code changed in R4.

Gates after the fix: `pnpm typecheck` passes. `eslint` passes over the tracked
tree; its only errors are in the maintainer's local, untracked handoff hook.
`pnpm test` passes except for what needs a credential or Docker: the driver's
live-model claims test refuses without `ANTHROPIC_API_KEY`, and conformance
reports the external driver and paid-line assertions as not run here. Those
are settled by `pnpm conformance` in CI after `run-driver`.
`git grep maxConflictRetries -- packages/api/src` prints the line's use of it,
and `git ls-files -- .plan/` prints nothing.
