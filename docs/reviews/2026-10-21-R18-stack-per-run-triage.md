# Triage of the external reviews of R18, 2026-10-21

Two reviews of R18, the stack recorded per run, run from one prompt and one
bundle (`2026-10-21-R18-stack-per-run-review-bundle.txt`, SHA-256
`bae66f76ef94fb1e048d9c572a0ff9ac258fda009660a9e6a10364e415b0e9c0`, base
`7f3fe7a` (`reviewed/R4`), head `f41f5a5`):

- `2026-10-21-R18-stack-per-run-review-codex.md`: gpt-6-astra, family codex,
  outcome `counted`
- `2026-10-21-R18-stack-per-run-review-gemini.md`: gemini-3.1-pro-preview,
  family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended, and the text beneath each header still does.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 3, plus a framing note (codex-7) | 1 (codex-3) | 1 (codex-2) | 0 | 2 (codex-1, codex-7) |
| gemini | 0, plus four assessments | — | — | — | — |

gemini's four assessments: gemini-2 and gemini-3 hold; gemini-1 holds in part
(it is right about every rate and silent on the spec's meaning of
`unrecorded`, which codex-2 shows the code departs from); gemini-7 holds in
part (right that the stack label cannot be substituted, wrong that the
adversary has no leverage on a stack's rates, as codex-1 and codex-7 show).

One mechanism was raised by both families, with opposite assessments: codex-2
and gemini-1, a stop between writing the admission record and committing the
first run state. Both are right about different parts of it. The framing was
addressed by both (codex-7, gemini-7) and they disagree.

No finding is a defect R18 introduced into a rate. codex-1 and codex-3 predate
R18: the constructs are at the base commit and R18 did not touch them. codex-2
is in a branch that predates R18, but R18 is the unit that set the stack to
`null` there, and its own spec says what that `null` means.

Each finding went to a verifier with fresh context, given the finding's text
and the repository, and not told who wrote the code. codex-3 was settled by
running it: the verifier made the line stop recording evidence and the two
cited tests still passed (source restored, `git status` clean). codex-1 and
codex-2 were settled by reading, and the write order, the reader, and the
missing-state branch were then re-read in this session.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A stop after `verify` writes a failed bundle and before the state commit hides that failure from the stack's false-done and first-pass yield | codex | holds; belongs to another unit (predates R18; owner proposed below) | known limit (proposed D-R18-06), issue |
| codex-2 | An admission with no run state is read as `stack: null`, though its record names a stack | codex, gemini (as sound) | holds in part: the spec departure holds; no rate is affected | known limit and spec correction (proposed D-R18-07), same issue |
| codex-3 | Two line tests return early, and pass, when no evidence was recorded | codex | holds; already owned by issue #48 | no change in R18 |
| codex-7 | Excluding unfinished runs lets whoever controls stops leave likely failures out of a stack's autonomy sample | codex | holds; belongs to R10 | recorded in proposed D-R18-06 |
| gemini-1 | The same stop fails closed and cannot pollute any stack's rates | gemini | holds in part; see codex-2 | — |
| gemini-2 | The Vault checks and `recordedStack` admit no escape hatch | gemini | holds | — |
| gemini-3 | The park cause survives a stop between its two writes | gemini | holds | — |
| gemini-7 | The framing is wrong: the adversary has no leverage on a stack's rates | gemini | holds in part; see codex-1, codex-7 | — |

## codex-1: a failed verdict written but not committed disappears from the rates

**Claim.** `verify` writes its evidence bundle before the state commit that
references it; `readRunRecords` reads only `state.evidenceRefs`. A stop between
the two, then a resume that passes, leaves the failure durable but invisible:
caught false-done records no failure and first-pass yield records a pass.

**Checked.** In `packages/api/src/line.ts` the verify path calls
`vault.writeEvidence` (`:1318`), records the gate-failed decision (`:1325`),
and only then parks or commits with `evidence: ref` (`:1331`, `:1332`); the
commit appends the reference to `evidenceRefs` (`:1515`). `readRunRecords`
(`packages/api/src/outcomes.ts:196-206`) builds every attempt from
`state.evidenceRefs` alone; the Vault interface has no way to list a run's
evidence independently of state. First-pass yield reads `task.attempts[0]`
(`:331-335`), including `fpStack`; caught false-done counts one attempt per
bundle (`:302-309`), including `fdStack`. A task found `running` on resume is
replayed as the same iteration (D-P4 replay rule, `decisions.md` near line
1371), so the replay's bundle becomes the task's first recorded attempt.

**What survives.** The gate-failed decision is recorded before the commit, so
`decisionsByCause` and `refusalsByReason` do count the failure. The two views
then disagree, which is how the gap would be seen.

**Consequence.** Only on a run stopped at that point, a failure is dropped
from the attempt-based rates, and always in the direction that flatters the
stack. It does not move a run between stacks, as the reviewer said.

**Ownership.** `writeEvidence` before the commit is from P4 (296e28d), and the
`evidenceRefs` read from 2dc1f11; both are inside `reviewed/R4`. R18 added
new readers of the same attempts. No entry in `docs/decisions.md` records this
gap. The fix is a reader that finds a run's evidence without its state, as
`readUsage` already does for usage records (A-I1a-05), which is a Vault
interface change outside R18's deliverables.

**Verdict:** holds; belongs to another unit. It must be closed before any
policy reads a per-stack attempt rate (R10).

## codex-2: an orphaned admission is read as naming no stack

**Claim.** A stop after `recordAdmission` and before `commitRunState` leaves an
admission record that names the stack; `readRunRecords` takes the missing-state
branch and returns `stack: null`, contradicting the distinction between "no
record names a stack" and a recorded stack.

**Checked.** `readRunRecords` (`packages/api/src/outcomes.ts:161-185`) reads
state first; on `NoRunState` it returns `stack: null`, `ending: 'unfinished'`,
no tasks, without reading the admission. It cannot: the Vault interface reaches
the admission record only through `state.admission`. Re-admission of the same
id is refused by the Vault (`packages/vault/src/local/vault.ts:556-558`), so
the run is stuck as the reviewer says, but run ids are minted with
`randomUUID()` (`packages/api/src/http/server.ts:252`), so re-admission with the
same id needs a caller supplying its own.

**The spec.** R18's entry in `docs/plan/DECOMPOSITION.md` says "`unrecorded`
means no record names a stack" and that `RunRecords.stack` is `null` "for a
run with no admission record or one admitted before this unit". An orphaned
admission is neither, so the code departs from the unit's own deliverable 3 in
this one case.

**Consequence.** None in any rate. A run with no state has no tasks, so it adds
nothing to caught false-done or first-pass yield; it is `unfinished`, so it is
outside the autonomy ratio's denominator (`outcomes.ts:315`). The `unrecorded`
key receives no count from it. The loss is a field on a stuck run's record.
gemini-1 is right about all of this.

**Verdict:** holds in part. The departure from the spec holds; the reviewer's
own limit, that no rate is contaminated, is correct. The faithful fix is the
same state-independent read as codex-1 (an admission found by run id), so it
is proposed as a known limit with the same owner, and the spec's sentence is
corrected to state the case rather than left contradicting the code.

## codex-3: two line tests pass with no evidence recorded

**Claim.** The tests at `packages/api/test/line.test.ts:283` and `:311` return
early when `state.evidenceRefs` has no first entry.

**Checked.** Both read `const [ref] = state.evidenceRefs;` then
`if (ref === undefined) return;`; the first asserts only that the task parked,
the second only that it passed. The same guard is at `:180` (partly covered by
`toHaveLength(1)` at `:176`) and `:445` (unreachable by design: `:443` expects
no evidence). The tamper-report test at `:324` throws instead.

**Run.** With `line.ts:1515` changed to append no evidence, the two cited tests
passed and the tamper-report test failed. Source restored.

**Ownership.** The guards come from 296e28d (2026-09-14) and 22079d2
(2026-09-23); `git diff reviewed/R4` adds none. This is R4's codex-3, already
open as issue #48 with the same remedy.

**Verdict:** holds; already owned by #48. No change in R18.

## codex-7: unfinished runs can be selected out of a stack's sample

**Claim.** The autonomy ratio excludes unfinished runs
(`outcomes.ts:314-315`), so a party controlling stops can keep successes and
leave likely failures unfinished. The reviewer calls it selection bias, not
wrong arithmetic, and asks whether the evidence accounts for all initiated runs
and interrupted attempts.

**Checked.** The exclusion is R2's rule (unfinished runs stay out of run-level
rates; `decisions.md` near line 3692); the population count still reports
`unfinished`, so the excluded runs are visible beside the rate, but nothing
reads the two together. codex-1 is the per-attempt form of the same question.

**Verdict:** holds; belongs to R10, the unit that will decide oversight from
these rates. R18's out-of-scope list excludes any policy reading a per-stack
rate.

## gemini-1: the admission stop fails closed

Re-admission refused, resume refused, the run `unfinished` with no tasks and
out of every rate: each holds against the code (see codex-2). It does not
address that the record names a stack the reader reports as none.
**Holds in part.**

## gemini-2: the Vault checks and the reader

Both stores refuse a stack that is not a non-empty `string`; `recordedStack`
(`outcomes.ts:150-153`) reads through `unknown` and returns `null` for anything
else. Codex reached the same assessment. **Holds.**

## gemini-3: the park cause across a stop

`parkRefusal` (`packages/core/src/station/machine.ts:299-325`) uses the
recorded cause where present and derives one otherwise; a recorded
`conflicts-exhausted` with no conflict recorded falls through to the derived
cause rather than failing open. The claim that `last` can never be undefined
there was not traced to every park call site; the fallback makes it
non-load-bearing. **Holds.**

## gemini-7: the framing

Right that the label cannot be substituted: the stack comes from one detection
and trusted writers. Wrong that the adversary therefore has no leverage on a
stack's rates: control of stops reaches them through codex-1 and codex-7
without touching the label. **Holds in part.**

## Changes

None is a code change. Confirmed by the maintainer, 2026-10-21.

1. `docs/decisions.md`, **D-R18-06** (known limit): codex-1 and codex-7, owned
   by R10 as a prerequisite for reading any per-stack rate, with an issue for
   the state-independent evidence read.
2. `docs/decisions.md`, **D-R18-07** (known limit): codex-2, the same owner
   and issue; `docs/plan/DECOMPOSITION.md` R18 deliverable 3 amended to say a
   run with no state reads `null` even where an admission record exists.
3. Issue #48: a comment that R18's review raised it again (codex-3).
