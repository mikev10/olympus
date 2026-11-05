# Triage of R13b's external reviews, 2026-11-05

Reviews: `2026-11-05-R13b-nightly-reviewers-review-codex.md` (gpt-6-astra, `counted`) and
`2026-11-05-R13b-nightly-reviewers-review-gemini.md` (gemini-3.1-pro-preview, `counted` on its second run; the first,
`.attempt-1`, was `FAILED` on HTTP 402 and returned no reply). Both replies' SHA-256 matched their manifests'
`replySha256` before the headers were prepended.

**Counts.** Codex: 4 findings. 2 hold, 2 hold in part, 0 do not hold. Gemini: 3 findings. 1 holds, 1 holds in
part, 1 does not hold. Both families raised one finding. Fixed: 3. Known limits: 2. Rejected: 1.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-2 | The tree review grades against authors merged since its last run, not every author of the tree | both | holds; the code is the spec's wording | known limit, waits on the maintainer |
| codex-2 | An unreadable violation is projected as `unreadable` and the job completes | codex | holds | fixed, `1408479` |
| codex-3 | A readable empty answer completes a review; repository instruction files could steer it | codex | holds in part: the first half | known limit; the instruction-file half does not hold |
| codex-4 | The changes-no-run assertion compares names, not contents | codex | holds | fixed, `e9f6e41` |
| gemini-1 | A task id reaches the findings reviewer's prompt unvalidated | gemini | holds in part: the mechanism is wrong | fixed, `38913f1` |
| gemini-3 | A day with no records is recorded as "completed, nothing found" | gemini | does not hold | rejected |

Every finding was checked by a subagent with fresh context against the cited code, and the fixed ones by a test
that failed before the fix.

## codex-1 / gemini-2: the author window

**Checked:** `mergedSince` and `treeReview` in `packages/api/src/nightly-review.ts`. `grade` too, and the
spec's whole-tree reviewer paragraph in `docs/plan/R13-nightly.md`.

**Found:** `mergedSince` keeps a run only when its `mergedAt` is after the `startedAt` of the schedule's last
completed tree review, and `authorsOf` reads those runs alone. The tree is the whole head checkout. So an older
author's code is reviewed with that author absent from the grade. When nothing merged since the last run, the
grade is `no-author` at any level. The mechanism is as both reviewers describe it. But the spec says the family
"differs from every author of merged work since the job's last completed run", and D-R13b-05 chose that window
deliberately. The record keeps `subject.merged` and `subject.since` beside the grade, so the grade is stated
against the window it covers.

**Consequence:** the property the reviewers expect, independence from every author of the tree, is not the one
the spec asks for. A reader who takes `different-family` as independence from the whole tree reads more into it
than the record claims.

**Outcome:** no change. Grading against every merged run's authors changes a deliverable, so it is the
maintainer's call (CLAUDE.md, working rule 6). Recorded in D-R13b-10.

## codex-2: an unreadable violation

**Checked:** `dayItems` and `decisionFields`.

**Found:** the violation read sat in `try { … } catch { violation = null }`, and `decisionFields` projected
`violation: 'unreadable'`. A day naming a violation the store could not read was reviewed without it, and
`{"findings":[]}` completed the job. A decision that could not be read already threw into `store-unreadable`, so
the violation path was the file's one lenient read.

**Fix:** the catch is removed. The read throws into the existing `store-unreadable` refusal, and no reviewer is
seated. `I5.nightly-unlocated-finding-is-refused` seeds a decision naming a violation the store does not hold.
It failed before the fix (`a day naming a violation the store could not read was reviewed: {"kind":"completed"}`)
and passes after it.

## codex-3: an empty answer

**Checked:** the result reading in `findingsReview` and `treeReview`, the tree seat's mount, and both drivers'
instruction-file handling.

**Found:** the first half holds. A readable `{"findings":[]}` over a nonempty subject completes the job. The
runtime can establish that the result was in the required format, and nothing it has can establish that the
subject was examined. The second half does not hold for the shipped drivers. The tree is mounted read-only, and
a planted `AGENTS.md` or `CLAUDE.md` would be in the mount, but the Codex driver passes `--ignore-user-config`
and `-c project_doc_max_bytes=0`, and the Claude Code driver passes `--setting-sources ''`.
`I3.codex-workspace-instructions-not-loaded` and `I3.workspace-instructions-not-loaded` plant those files and
show none is loaded.

**Outcome:** no code change, because no available mechanism observes attention. Recorded as a known limit in
D-R13b-10: an empty completed review is the reviewer's claim of nothing found, not runtime-observed coverage. This
is also the reviewer's answer to prompt item 7, and it is right.

## codex-4: the changes-no-run assertion

**Checked:** `I2.nightly-review-changes-no-run` in `packages/conformance/src/registry/nightly-review.ts`.

**Found:** the snapshot joined the `path` of each `runs/` object and never read `bytes`. An object rewritten in
place under its old name left the snapshot unchanged. Content-named objects would be caught elsewhere by a hash
mismatch, but objects named by run or by id would not.

**Fix:** the snapshot holds each object's path and SHA-256. A throwaway test over a `LocalVault` rewrote one run
object in place. The path-only snapshot was unchanged by it, and the new snapshot changed. The test was deleted
afterwards.

## gemini-1: the task id in the prompt

**Checked:** `decisionFields`, `parseGraph` in `packages/api/src/validate.ts`, and how `items` reach the prompt.

**Found:** `taskId` was projected into every decision's fields, and the items reach the prompt through
`JSON.stringify` as plain text. The stated mechanism is wrong: task ids come from the requested task graph, which
no drafting model writes. The defect holds anyway. `parseGraph` checks only that an id is non-empty, unreserved,
and unique, with no character class. So a requester's text reached the reviewer's prompt, against D-R13b-04's own
rule that only enumerated, id, or count fields are projected.

**Options:** keep the task id only when it is in the run id's class, or drop it. A class admits instruction-shaped
tokens such as the conformance marker (`r13b-marker-ignore-previous-instructions`). Dropping it costs the reviewer
nothing it needs, since a finding names a record id and each record keeps its run and station. Chosen: drop it.

**Fix:** `taskId` is removed from `decisionFields`' base. `I7.nightly-reviewer-gets-typed-fields-only` seeds the
violation decision with the marker as its task id. It failed before the fix (`a record's text reached the findings
reviewer's prompt`) and passes after it.

## gemini-3: an empty day

**Checked:** `findingsReview`'s empty-day branch, `empty`, and `UNSEATED`.

**Found:** a day with no record seats no reviewer and returns no refusal, so the outcome is `completed`. But the
record's subject is the day with an empty item list, and its `role`, `seat`, `usage`, `egress`, and `claim` are
null. A seat that found nothing has all of them. D-R13b-09 records the choice. A quiet day is the normal case, and
refusing it would make every quiet day read as a failure.

**Outcome:** rejected. The record does not claim that a review was performed.
