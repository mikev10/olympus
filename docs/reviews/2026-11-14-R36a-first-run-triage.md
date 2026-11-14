# Triage of R36a's external reviews, 2026-11-14

Replies: `2026-11-14-R36a-first-run-review-codex.md` (gpt-6-astra, outcome `counted`, 110,644 input tokens against a floor of 75,263) and `2026-11-14-R36a-first-run-review-gemini.md` (gemini-3.1-pro-preview, `counted`, 109,241 against 75,263). The bundle's SHA-256 is `d2c0aa21…06bd`, and both manifests name it. Each reply's SHA-256 matched its manifest's `replySha256` before the header was added. The untouched replies are in a9718a8. No rerun was needed.

**Counts.** Codex raised 4 findings: 1 holds, 3 hold in part, 0 do not hold. Gemini raised 3: 1 holds, 1 holds in part, 1 does not hold. Neither family raised a finding the other also raised. Five findings were fixed on the unit branch, one was recorded with an owner (#158), and one was rejected.

Every finding went to one fresh-context verifier, which got the finding's text and the cited files and nothing else. It built cases codex-4(1) and codex-4(2) in a scratch repository. A test written before each fix settles every fixed finding: each test failed against the old code and passes against the new.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | `controls-unavailable` comes after the cost branch, so a person approves a figure for a run that is then refused | codex | holds | fixed, 97fc0bc |
| codex-2 | A sandbox exec failure in `verify` records no `attempt-failed` and reaches no `lastFailure` | codex | holds in part | recorded, #158 |
| codex-3 | The leaked-file search treats an unreadable subtree as empty and does not show that a task ran | codex | holds in part | fixed, 7851012 |
| codex-4 | `commitFixture` keeps earlier index entries, and attributes still transform blobs | codex | holds in part | fixed, 7b829fa |
| gemini-1 | `admittedEntries` stops at a node carrying `path` and `sha256`, so artifacts can be hidden | gemini | does not hold | rejected |
| gemini-2 | The attempt log line interpolates the task id unflattened, so lines can be forged | gemini | holds | fixed, e9b9795 |
| gemini-3 | An existing base throws a plain `Error`, which surfaces as a 500 rather than a refusal | gemini | holds in part | fixed, 938343c |

## codex-1: the controls refusal after the cost estimate

**Checked.** In `admission` (`packages/api/src/run.ts`), `unavailableControls` was computed before the cost branch, but `admissionRefusal(unrecorded)` ran after it. The verifier found two further checks after the cost branch: `candidate-expired` and the candidate's `already-admitted`.

**Found.** The controls refusal holds. The two candidate checks repeat checks made at the start of admission (`candidateFor`, the `already-admitted`, `dismissed` and `candidate-expired` arms). They are re-checked at the moment the candidate is spent, so they refuse only a candidate that changed while the run was being admitted. They have to stay at the spend point to keep a candidate to one run, so they stay where they are.

**Consequence.** As the reviewer said, nothing is spent. A person can be asked to approve a figure for a run that is refused anyway, which is #145's own class of bug.

**Changed.**
- The controls refusal now comes before the cost branch. The comment now says why the candidate checks follow it.
- `I5.adapter-refusal-refuses-l3-end-to-end` now admits with no figure approved. It failed against the old order (`got cost-unapproved`) and passes against the new one.

## codex-2: a verify-time exec failure is not reported as an attempt

**Checked.**
- The catch around a behavioral check's `sandbox.exec` in `verify` (`packages/api/src/line.ts`) records the check as `unstarted`, with its reason, in the evidence bundle.
- That catch calls no `spendRetry`.
- `lastFailureOf` (`run.ts`) reads only a `retries-exhausted` park.

**Found.** The facts hold. The consequence does not match the reviewer's framing. `attempt-failed` is the record of a retry spent on a failed driver, sandbox or runtime attempt, and an exec failure in `verify` spends no retry; it was deliberately an unstarted check (A-P6-02). The run still fails closed. What is missing is visibility: `status` and `events` do not show that cause.

**Decided.** Recorded, not fixed here. Extending coverage means a new cause, or a change to the meaning of `attempt-failed`'s `retries`, and `DecisionCause` is a contract type. It is filed as #158, with the proposed fix.

## codex-3: the leaked-file search

**Checked.** `everyPath` (`packages/conformance/src/registry/first-run.ts`) caught every `readdir` failure and returned `[]`. The assertion accepted any line refusal (`refusalOf`) and required only a `base` entry.

**Found.**
- The silent catch holds. No realistic fault triggers it, since the runtime makes these directories itself, but it would let the assertion pass without searching.
- The second part also holds: the assertion showed that no `.env` remained after the run, not that none stood in a tree while a model worked in it.

**Changed.**
- `everyPath` now throws on any unreadable directory.
- The assertion now wires a stub driver that walks the run's trees from inside each `runTask`. It requires that a task was handed to the driver and that a `tasks/` tree stood while it ran, and it searches every walk.
- With the base fix reverted, the assertion fails and names `tasks/hello.1/start/.env` and `tasks/hello.1/work/.env`, as well as the base.

## codex-4: `commitFixture`

**Checked.** The verifier constructed both cases.

**Found.**
- **(1) holds.** After a commit of the whole directory, `commitFixture(dir, { paths: ['wanted.txt'] })` still committed `extra.txt`, because the index was never reset. No caller relied on that: the only `paths` caller uses a new repository.
- **(2) holds as a documentation defect.** With `*.txt text eol=lf` in the fixture's own `.gitattributes`, `git add` still normalises line endings when `core.autocrlf=false`. No fixture in the repository carries such attributes. A fixture's own attributes are what the user's own commit would honour, so suppressing them would make a fixture commit differ from a real one.

**Changed.**
- Every call now starts from an empty index (`git read-tree --empty`).
- The doc comment now says the commit is a function of the directory and the options, and that the fixture's own `.gitattributes` still applies.
- New test `packages/conformance/test/kit/git.test.ts` covers (1). It failed against the old code with `extra.txt` present.

## gemini-1: `admittedEntries` traversal

**Checked.**
- `admittedEntries` (`run.ts`) does stop at a node carrying `path` and `sha256`.
- Its input is `admitted.admitted.artifacts`, which the runtime builds from fixed keys out of validated records. It is not the request's object.
- `artifactProblems` (`packages/api/src/validate.ts`) reads only the named keys.
- `sensitiveArtifacts` uses a separate walk that recurses everywhere.

**Found.** Not in the code. A requester cannot put `path` or `sha256` on the root or on any intermediate node of the object the walk sees, so no artifact can be hidden from the overlay or the sensitivity check.

**Decided.** Rejected. Nothing changed.

## gemini-2: the attempt log line

**Checked.**
- `attemptLine` (`packages/api/src/http/server.ts`) flattened only `untrustedDetail`.
- Task ids are checked only as non-empty, non-reserved and unique (`validate.ts`), so a newline is admitted.
- A run id is limited to `[A-Za-z0-9._-]`. The source is one of three literals.
- A layer comes from the adapter that threw. It is not set by the requester, but it is not constrained either.

**Found.** It holds. The requester who supplies the graph can forge only lines about their own run, so the severity is low.

**Changed.**
- The task id, the layer and the detail are all flattened.
- New test `packages/api/test/attempt-line.test.ts` failed against the old code and passes against the new.

## gemini-3: a run that already has a base

**Checked.**
- `snapshotBase` (`packages/api/src/workspace.ts`) threw a plain `Error` for an existing base, and admission rethrew it, so the HTTP layer answered 500.
- A base with no state is reachable, left by an admission that stopped between the snapshot and the state write.
- This predates R36a (`eab6a44:packages/api/src/workspace.ts:228`).
- **The verifier's correction.** R36a's catch discards the run before rethrowing, so a retry cleared a stale base. It would equally discard a base that a concurrent admission of the same run id had just made.

**Found.** It holds in part. The 500 is real, and the reviewer's fix (throw `BaseRefusal`) would keep the discard and so keep the concurrent-admission hazard.

**Changed.**
- A new `BaseExists` (a `BaseRefusal`) is answered as `invalid-request` with the new code `exists` at `runId`, and the base is left where it stands. A base an admission did not make is not that admission's to delete.
- A base left by a stopped admission therefore now needs a new run id, rather than being cleared by a retry. That is the fail-closed choice.
- New test in `packages/api/test/admission.test.ts` failed against the old code with the thrown error and passes against the new.
- **Reverse:** discard in the `BaseExists` arm too.

## Framing (item 7)

- **Codex** called the framing appropriate, with two qualifications:
  - Uncommitted admitted run files are an intended exception to commit-byte identity. That is D-R36a-10's overlay, and committed ones are held to the commit.
  - "Untrusted text never enters a prompt" is literally too broad, since specs and drafts are prompt material by design. Noted; the property this unit owes is that failure text never becomes an instruction or a status, and neither reviewer found a crossing.
- **Gemini** endorsed the framing.
- Codex also named two boundaries it could not judge from the bundle: `resolveCommit` and `materializeCommit` come from `@olympus-ai/readiness` and are not in the diff. Those were reviewed with their own unit and are unchanged here.
