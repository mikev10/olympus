# Triage of R9's external reviews, 2026-11-02

Two reviews of R9, separation of duties across every seat, both `counted`:
`2026-11-02-R9-separation-of-duties-review-codex.md` (gpt-6-astra, 82,883
input tokens against a floor of 52,604) and
`2026-11-02-R9-separation-of-duties-review-gemini.md`
(gemini-3.1-pro-preview, 77,484 against 52,604). Each family ran once; there
were no reruns. Both replies' SHA-256 matched their manifests' `replySha256`
before their headers were prepended.

**Counts.** Codex: 4 findings. 3 hold (codex-2, codex-3, codex-4), 1 holds in
part (codex-1); 4 fixed. Gemini: 3 findings. 1 holds in part and is fixed
(gemini-3); 1 holds in part and is rejected (gemini-1); 1 holds as described
but its consequence and its fix do not hold, so it is rejected (gemini-2).
**Both families raised:** none as findings. Codex's closing framing remark
bears on gemini-2's mechanism. **Did not hold at all:** none, though gemini-1's
consequence and gemini-2's proposed fix did not.

Every finding was checked by a fresh-context verifier that was given the
quoted claim and the files, and was not told who wrote the code. Its answers
were weighed as evidence; where a fix was made, a test settled the question.

| Finding | Claim, restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-3 | The security seat's sandbox tree holds the acceptance tests its context is denied; the assertion never probes them | codex | holds | fixed, 3b4e730 |
| codex-1 | The reviewer's reported model becomes the seat's recorded identity when it grades weaker | codex | holds in part | fixed, b77a296 |
| codex-2 | The security seat is not given the security checks' findings its role says it reads | codex | holds | fixed, 03c05ab |
| codex-4 | The local-token scan treats an unreadable Vault file as clean | codex | holds | fixed, c8478a3 |
| gemini-3 | `readUsage` casts a record without checking its driver | gemini | holds in part | fixed, 509f2e1 |
| gemini-1 | The security task takes the review task's policy scope while its record names `security-reviewer`, so it may run with a broader scope than that role | gemini | holds in part | rejected |
| gemini-2 | The identity-equality check in `seatReviewer` cannot be true through the line | gemini | holds; the proposed fix does not | rejected |

## codex-3: the security seat's tree held the acceptance tests

**Checked.** `reviewView` built every review seat's tree from
`STATION_CONTRACTS.review.allowedContext`, whichever seat it served, and the
review contract grants `acceptance-tests`. The security seat's context was cut
by `securitySeatContract`, but its filesystem was not. The assertion's probe
list did not name `acceptance.md`, and it checked only that the two seats'
trees matched.

**Found.** The defect is as described: the grant cut was applied to the prompt
and not to the tree, so a security reviewer with a read tool could open the
acceptance tests.

**Changed.** `reviewView` takes the seat's contract, and the line passes the
one it seated. `I4.security-seat-reads-only-its-grants` probes `acceptance.md`
and requires it present in the review seat's tree and absent from the
security seat's. Run first against the old view, it failed with the security
seat holding `acceptance.md`. `I6.review-seat-reads-only-its-grants` recorded
whichever review-station task ran last; it now records the review seat by id,
with its expectation unchanged.

## codex-1: the claimed model became the recorded identity

**Checked.** `review()` seated the reviewer from the resolved model and again
from the result's model, then committed whichever seat had the weaker grade,
identity included.

**Found.** It holds in part. The claim could only lower the recorded grade,
never raise it, and at L3 a same-family claim refuses the seat, so independence
was never overstated. That part of the defect does not hold. But the committed
seat's reviewer identity was the driver's own report, with the resolved model
nowhere on the seat, and the record of who reviewed is the runtime's, not a
driver's (I2).

**Changed.** The line commits the resolved seat at the weaker of the two
grades. A new case in `I2.each-seat-identity-is-in-run-state` has a reviewer
resolve to another family and report the author's model, then requires the
seat to record the resolved family and a grade below `different-family`. Run
first against the old selection, it failed with the seat naming the reported
model. `authorsOf` still adds each result's reported model as an author: that
only widens the set the reviewer is graded against, the conservative
direction, and is unchanged.

**Alternatives.** Recording the reported model beside the seat as a claim
would need a field on `ReviewSeat`, a contract change, and adds nothing the
task result does not already hold. Not taken.

## codex-2: the security findings never reached the seat

**Checked.** A security check's `CheckResult` carries `findings`, the
runtime's parse of its scanner's report. `evidenceFacts` projected each check
to id, exit code, suite count, and whether an expectation held, and dropped
the findings. The `security-reviewer` role says the seat's context holds what
the security checks found.

**Found.** It holds. A new finding fails the gate before review, so the seat is
not the only control on one, but findings the base already had do reach
review, and the seat was given none of them.

**Changed.** The projection, extracted as `evidenceFactsOf`, carries each
finding's rule, path, and line, and `null` for a report never read, which stays
distinct from an empty list. The fingerprint is not passed: it identifies a
finding to the runtime and tells a reviewer nothing. Both review seats are
given the projection, since both hold the `evidence-bundle` grant. The test
compares two bundles that differ only in findings and requires distinct
context. Run first against the old projection, it failed with no findings
field.

**Alternatives.** Changing the role's text to stop promising findings would
have narrowed the seat to fit the code. Not taken: the unit's spec names the
evidence bundle as where the security checks' findings arrive.

## codex-4: an unreadable file passed the token scan

**Checked.** The Vault scan in `I4.local-token-reaches-no-sandbox` read each
file with `.catch(() => '')`.

**Found.** It holds, as a fail-open in the assertion, not in the runtime.

**Changed.** The catch is gone; a file that cannot be read fails the
assertion. This was not shown failing first: making a file in a fresh store
unreadable on this host has no portable construction, and the change only
removes a branch.

**Not changed.** `I4.merge-credential-reaches-no-sandbox` reads with the same
pattern (`packages/conformance/src/registry/integration.ts`, `allText`). It is
not this unit's code; it is named here for whoever next touches I1b's
assertions.

## gemini-3: the driver was not checked on read

**Checked.** `readUsage` checks `collectedBy`, the run, the task, and that
`reading` is an object, then casts. A present `driver` that was not a string
passed through to `authorsOf` and `seatReviewer`.

**Found.** It holds in part. The Vault refuses such a record on write, and no
agent writes to the Vault, so the reviewer's own low rating stands. But the
seat check's refusal of an unrecorded identity tests `=== null`, so a
malformed driver would have been compared rather than refused.

**Changed.** A present driver must be a non-empty string, or the read is
refused. An absent one reads as `null`, not recorded, as before. The test
plants a record with no driver, which reads as `null`, and one each with `5`,
`''`, `null`, and an object, each refused. Run first against the old read, it
resolved.

## gemini-1: the security task's scope is the review task's

**Checked.** `parseGraph` copies the review task, role included, into the
security task. `scopeFor` resolves tools, egress, and budget from
`task.role`. The usage record's `role` is the pinned instructions role,
`security-reviewer`.

**Found.** It holds that the scope comes from the review task's policy role
while the record names the instructions role. It does not hold that the seat
can run with a broader scope than `security-reviewer`'s: no policy grants a
`security-reviewer` scope, so there is no stricter grant to escape. The split
is the review seat's design too, which runs on its task's scope under the
`reviewer` instructions (D-A-RC-06). The record's `role` is, and was, the
instructions the call ran under.

**Rejected.** The proposed fix would make every policy define a
`security-reviewer` scope, or refuse every run, for no narrowing that exists
today. The security seat's scope equals its review task's by construction,
which is the review seat's rule (D-R9-03).

## gemini-2: the identity check cannot be true through the line

**Checked.** Reviewers run under `reviewer` or `security-reviewer`, and
`parseGraph` refuses a build task under either, so an author's identity, role
included, never equals a reviewer's on the line. Drafting seats do not use
`seatReviewer`.

**Found.** It holds that the comparison is unreachable through the line. That
is the design recorded in D-R9-04: admission refuses the graph, and the seat's
check is a fault behind it, exercised directly by
`I6.author-identity-never-reviews-its-change`. That assertion also covers the
admission refusal, so deleting either check fails it. Codex's framing remark
makes the related point: a different role name makes the identity differ
without making the model independent, which the family grade already records.

**Rejected.** The proposed fix, comparing driver and model without the role,
would refuse every seat whose reviewer runs on the author's driver and model.
Below L3 that is the single-family case the invariant says is recorded as
reduced independence, not refused. It would turn a recorded `same-model`
grade into a refusal at L0–L2, which contradicts the rule the family grade
enforces.

## Item 7: the framing

Codex answered it: a reviewer of author-written code reads author-written text,
so "never sees author material" cannot be enforced. What is enforceable is
that no channel beyond the code under review carries it. The prompt's framing
asked about the narrative channel. The remark is correct, needs no change in
this unit, and is recorded here. Gemini left item 7 empty.

## Acceptance after the fixes

Rerun after the last fix: `pnpm typecheck` and `pnpm lint` clean; the api
suite 224 passed; `@olympus-ai/driver-openai-compatible`, which calls no
model, 41 passed with its report refreshed; `pnpm conformance` 226 passed and
29 failed. Every failure is a paid external report left stale by the unit's
changes — `@olympus-ai/driver-claude-code` (12), `@olympus-ai/driver-codex`
(13), `@olympus-ai/api` `test/paid/` (2) — or one of the two meta-tests that
aggregate them. Those refresh only under the pull request's `run-driver` job.
