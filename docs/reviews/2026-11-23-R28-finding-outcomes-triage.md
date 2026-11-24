# Triage of R28's external reviews, 2026-11-23

Two counted reviews of the same bundle (`2026-11-23-R28-finding-outcomes-review-bundle.txt`, SHA-256 `96afaf3a…790c75`): Codex (gpt-6-astra) and Gemini (gemini-3.1-pro-preview). Neither family was rerun. Each finding was checked against the code by a verifier given only the finding and the files, not told who wrote them; each verdict below rests on that check and, where a fix landed, on a test shown failing first.

**Counts.** Codex raised 6 findings, Gemini 3. Two defects were raised by both (codex-1 with gemini-2, codex-2 with gemini-1).

| Verdict | Codex | Gemini |
|---|---|---|
| Holds, fixed here | 3 (codex-2, codex-5, codex-6) | 1 (gemini-1) |
| Holds, but it is the rule the maintainer chose (recorded) | 1 (codex-1) | 1 (gemini-2) |
| Holds, known limit with an owner | 2 (codex-3, codex-4) | 0 |
| Does not hold | 0 | 1 (gemini-3) |

| Finding | One line | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-2 | "resolved" needs only an executed line somewhere in the hunk that rewrote the cited line, not the cited problem fixed; a critic finding resolves on any change to its file | both | holds; it is A-R28-01's chosen rule | recorded, D-R28-08; an amendment if the rule should tighten |
| codex-2 / gemini-1 | refused findings and unreadable results leave the rates' denominator; a malformed critic element discards the valid findings beside it | both | holds | fixed, d9c5a8c |
| codex-3 | identical citations count as independent findings, inflating the rate and its sample | Codex | holds | known limit, owner R11 (D-R28-08) |
| codex-4 | a report the workload writes can assert hits that never ran | Codex | holds; M3's | known limit, already pending as `I3.coverage-report-is-not-writable-by-the-suite` (owner M3) |
| codex-5 | "unmeasured" is decided from the window's runs, so a resolution by a later run outside it reads unmeasured, and any run's failed attempt makes every group measured | Codex | holds | fixed, d9c5a8c |
| codex-6 | the stack line-report assertion compares a fraction with itself | Codex | holds in part (the equality only) | fixed, 2327ec4 |
| gemini-3 | line 0 is accepted and crashes the Vault write | Gemini | does not hold | none |

## codex-1 / gemini-2: what "resolved" proves

**Checked.** `resolveCodeFindings` keeps the executed lines inside the holding hunk's new-side range and resolves when any is present; the cited line itself need not have run, and a whole-file rewrite is one hunk. `resolveCriticFindings` resolves on any change in the cited file's hash, a comment included. Both confirmed by the verifier against `packages/api/src/findings.ts`.

**Verdict.** Holds as a description, and it is exactly the rule D-A-FO-01 chose ("a changed line of that hunk executed"; "its file changed between the draft it was raised against and the locked draft"). Tightening it changes what the amendment asked for, so it is not a review fix (WORKFLOW, step 6). Gemini's proposal, to require the cited line itself in the executed set, has no line to point at: the hunk rewrote it, so the base-side line has no head-side twin. Codex's proposal, to name the outcomes for what they prove ("covered edit", "draft changed") and keep remediation as a separate, independently checked outcome, is an amendment. Recorded in D-R28-08 with the recommendation that the maintainer decide whether to rename the resolution kinds before R11 reads the rates.

## codex-2 / gemini-1: the denominator

**Checked.** `raisedFindings` yielded located findings only; an unreadable seat result held none and nothing read its `readable` flag; `readCriticResult` returned one unreadable refusal from inside its loop when any one element was malformed, discarding the located findings already read. All three confirmed.

**Fix (d9c5a8c).** Gemini proposed counting refused findings as raised and open; that would put findings nothing can resolve into a resolved rate's denominator, so a seat whose findings are mostly unlocatable would read as never acted on, which is a measurement no input made. Chosen instead: each rate group now carries `refused` and `unreadable` counts beside `raised`, drawn from the same records (`findingGaps`), so a seat emitting what cannot be located is seen, not hidden, and the rates stay over findings an outcome can exist for. A malformed critic element is now refused alone as `unrecordable`, the located findings beside it are kept, and the draft still goes back. Tests shown failing first: `packages/api/test/findings.test.ts` ("say how many findings each group refused…"), `packages/api/test/drafting.test.ts` ("refuses a malformed element on its own…"). The earlier test that listed element-level shapes as unreadable now expects each as `unrecordable`; envelope-level shapes still read unreadable.

## codex-3: repetition

**Checked.** No deduplication: one finding per array index, each resolved by the same hunk and counted in rate and sample. Confirmed.

**Verdict.** Holds. Deduplicating identical citations is evaded by citing a neighbouring line, and no rule here can tell two real problems on one line from one repeated; R11, which reads these rates to choose seats, is where a seat gaming its count matters. Known limit, owner R11 (D-R28-08). The bound's stated independence assumption already says runs on one repository are not independent; repeated findings within one result are worse, and D-R28-08 says so.

## codex-4: forged coverage

**Checked.** Both adapters take executed lines from the report's hit counts; the runtime refuses every pinned coverage check today (`line.ts`, `coverageReport`), so no real run reaches it.

**Verdict.** Holds, and it is M3's: the pending registry entry `I3.coverage-report-is-not-writable-by-the-suite` (owner M3) names it. No change here.

## codex-5: when a resolved rate is measured

**Checked.** Findings are windowed by their run's admission; outcomes are not; and `measured` was `runs.some(r => r.lineCoverage)` over the windowed runs, with `lineCoverage` true for any bundle, a failed attempt's included. Confirmed.

**Fix (d9c5a8c).** A group's resolved rate is measured where a resolution is on record, or where any run in the store (not only the window) recorded line coverage in a passed task's last bundle. Test shown failing first: `findings.test.ts` ("measure a resolved rate where a resolution exists…").

## codex-6: the stack assertion

**Checked.** `changedLineCoverage` is `coverageFraction(changedLineReport(…))`, so the assertion's equality was the same computation twice; its other checks had teeth but no fixture-specific lines. Confirmed in part.

**Fix (2327ec4).** Each stack fixture now states the lines it changes and the report covers, read off the fixture by hand, and the assertion requires exactly those and a fraction of one half. Shown failing against an adapter made to report one extra executed line, then reverted.

## gemini-3: line 0

**Checked.** `CHAR_CLASSES.decimal` is `/^[1-9][0-9]{0,18}$/u`, so `0` is out of class and the finding is refused `unrecordable` (`line:out-of-class`); `packages/api/test/findings.test.ts` sends line 0 and expects exactly that. Nothing reaches the Vault.

**Verdict.** Does not hold. No change.

## After the fixes

The full acceptance criteria were rerun on the branch at 2327ec4: `pnpm -r typecheck` and `pnpm lint` clean; every non-paid package's tests pass (api 338, adapters 898, vault 110, core 172, sandbox 207, cli 29, benchmark 47, openai-compatible 41, readiness 23, compiler 38); `pnpm conformance` fails only on the paid suites' reports (`driver-claude-code`, `driver-codex`, `api test/paid/`) and the two registry checks that aggregate them, which CI's `run-driver` job settles.
