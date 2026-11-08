# Triage of the external reviews of R10, 2026-11-07

Reviews: `2026-11-07-R10-trust-ratchet-review-codex.md` (gpt-6-astra, codex)
and `2026-11-07-R10-trust-ratchet-review-gemini.md` (gemini-3.1-pro-preview,
gemini). Both runs `counted` on the first attempt, with no rerun: codex took in
98,900 input tokens and gemini 95,761, against a floor of 66,721, and both
echoed all four bundle markers. Each reply's SHA-256 matched its manifest's
`replySha256` before the header was prepended.

Each finding was checked against the repository by a fresh-context agent
that was given the finding's text and the files it cites. Every finding that
predicted a behaviour was then reproduced as a failing test before it was
fixed.

**Counts.** Codex raised 4 numbered findings, plus test-coverage notes and an
aside, triaged here as two more. Gemini raised 2. One defect was raised by
both families: codex-3 and gemini-1.

| Family | Raised | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 6 | 5 | 1 | 0 |
| gemini | 2 | 1 | 0 | 1 |

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-3 / gemini-1 | a drafter can write a sensitive path; the critic's tree gets it back after omission, and it can be locked | both | holds | fixed, 7f73c16 |
| codex-1 | a sensitive spec or acceptance-test file is removed from the tree, but its text still reaches every seat as context | codex | holds | fixed, 3890514 and d651bf6 |
| codex-2 | a batch sibling can narrow the run while a task's sandbox is provisioned, and the task then calls the model with the wider scope it read before | codex | holds in part | fixed, 4e5d8e4 |
| codex-4 | a non-tree-relative sensitive glob (`/secrets/key.txt`) validates and matches nothing | codex | holds | fixed, 5561b48 |
| codex test notes | the second input is never delivered; `history()` and `mounted()` mask read errors; no failed-commit case | codex | holds | fixed, 94bb83b |
| codex aside | the Vault does not validate a stored narrowing's `level` | codex | holds | fixed, b216948 |
| gemini-2 | the `narrowed.level > requested` guard in `levelOf` is unreachable | gemini | does not hold | rejected |

## codex-3 / gemini-1: a drafter can write a sensitive path

**Checked.** In `api/src/drafting.ts`, drafted entries were checked only by
`writesOutsideGrant` against the role's writable globs. The critic's tree was
copied, `omitWithheld` was applied, and then `writeFiles` wrote every
`record.files` entry back into it. `renderDraft(record)` also put the draft
in the critic's context. All three parts were confirmed.

**Reproduced.** `sensitiveDraftGoesBack` (conformance `drafting.ts`)
classifies `.drafts/**` and drafts a spec. Before the fix, the draft was
accepted and nothing was sent back.

**Fix.** A drafted path that any sensitive class matches is a runtime
problem, `sensitive-path`, which sends the draft back. It is never handed to
the critic, approved, or locked. This applies whatever the drafter is
granted, because a locked draft becomes every later seat's context
(D-R10-09). It is enforced at the one place a draft is recorded, so the
critic's tree and its rendered context are both covered.

## codex-1: a sensitive locked artifact reaches seats as context text

**Checked.** `build`, `review`, and the test drafter read the spec and the
tests through `readText` and offer them as `locked-spec` and
`acceptance-tests` context. Tree omission does not touch that text.
Confirmed.

**Reproduced.** A policy classifying `spec.md` was admitted (new case in
`I4.sensitive-path-absent-from-an-ungranted-tree`).

**Options.** (a) Filter each seat's context by its grants and refuse the seat
when required context is withheld. (b) Refuse at admission any run whose
admitted artifact a sensitive class matches. The spec and the tests are
context every seat needs, so (a) refuses every seat, which is the same
outcome as (b), only later and recorded many times. **Chose (b)**
(D-R10-09). Drafted artifacts are covered by the fix above.

**Fix.** `sensitiveArtifacts` in `api/src/run.ts` refuses with
`sensitive-artifact` (3890514). d651bf6 adds that code to the closed
`RequestProblemCode` union, without which the api package did not compile.

## codex-2: a call under a scope read before a sibling narrowed the run

**Checked.** Build tasks in a batch run concurrently (`runLine`'s
`Promise.allSettled`). `runTask` read `scopeFor` before awaiting
`sandbox.provision`, and nothing read the scope again before the driver
call. Confirmed.

**Holds in part.** A model call already in flight when a run narrows ends
under its own scope by the amendment's design (D-A-TR-03), and it never
receives the input. The gap the finding names is narrower: the provisioning
window, before any call had started. That gap is real.

**Reproduced.** `raceAcrossABatch` holds `ra`'s provisioning until `rb`'s
input commits the narrowing. Before the fix, `ra` was handed
`["read","write"]` after the narrowing.

**Fix.** `runTask` checks, with no await between the check and the call,
whether the narrowing changed since the scope was read. If it did, the call
is not made, and the attempt is retried under the narrowed scope (D-R10-10).
The test confirms that `ra` still reaches a model, narrowed, on its retry.
The rejected alternative, resolving every batch member's input before
provisioning, covers only input known at the batch's start.

## codex-4: a sensitive glob that is not tree-relative

**Checked.** `validateSensitivePaths` required only non-empty strings.
`picomatch('/secrets/key.txt', {dot:true})` returned false for
`secrets/key.txt` (run by the verifier). Confirmed.

**Fix.** The validator refuses a glob with a leading `/` or `./`, a drive
letter, a backslash, or an empty, `.`, or `..` segment. Six rejected forms
and two accepted ones are asserted (5561b48).

## codex test notes: coverage gaps and failure masking

**Checked.** `inputFor` is called only by `build`, so the "second input" on
resume was never delivered. `history()` and `mounted()` turned every read
error into absence. No assertion failed a narrowed-state commit. All three
were confirmed.

**Fix (94bb83b).**
- A second run with two independent build tasks now delivers a second input
  from another source. It checks that every delivery went to that task,
  narrowed, that each committed narrowing is unchanged, and that only one
  `capability-narrowed` decision was recorded.
- `history()` and `mounted()` treat only `ENOENT` as absent.
- The withholding assertion adds a store whose narrowed-state commit fails.
  The input reaches no model and nothing narrowed is committed.

The assertion's title was corrected to say what it now proves.

## codex aside: the stored narrowing's level is not validated

**Checked.** `requireRunState` checked `at`, `cause`, and `cause.kind` only.
Confirmed.

**Fix (b216948).** The filesystem Vault refuses a stored narrowing whose
`level` is not 0 to 3 or whose cause is not one of the three. Five new vault
tests cover this, four of them failing before the fix.

## gemini-2: the guard in `levelOf` is unreachable

**Checked.** It is unreachable for a narrowing that `planNarrowing` produced.
However, `RunState.narrowed` is also read back from the store on every
resume, and the verifier confirmed it reaches `levelOf` from there.

**Rejected.** The clamp keeps a stored level from ever raising an exit above
the level the run was admitted at. With b216948 the Vault also refuses an
out-of-range level, but the clamp still bounds an in-range level above the
request, which no store check can see. Removing it would let a stored value
widen what the run reads its approvals at. Defense in depth is kept, and
nothing changed.

## Acceptance after the fixes

The unit's full acceptance criteria were rerun after the last fix. The
results are in the PR thread and in the triage report.
