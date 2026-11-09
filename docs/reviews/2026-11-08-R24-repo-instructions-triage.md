# Triage of the R24 external reviews, 2026-11-08

Two reviews, both `counted`, of bundle `2026-11-08-R24-repo-instructions-review-bundle.txt` (SHA-256 `00248ca7…f0c2`, `reviewed/R10`..`2a6e69e`): Codex (`gpt-6-astra`, 95,634 input tokens against a floor of 64,407) and Gemini (`gemini-3.1-pro-preview`, 92,183 against the same floor). Each reply's SHA-256 matched its manifest's `replySha256` before its header was prepended. No family was rerun.

**Counts.** Codex: 3 findings — 1 holds, 1 holds (test weakness), 1 holds in part. Gemini: 2 findings — 1 holds in part, 1 does not hold. One defect was raised by both families (codex-1 with gemini-2). Findings that did not hold: Codex 0, Gemini 1.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | The set's cap counts content bytes only, so many empty long-named files pass it while their paths and headings reach the seat | codex, gemini (with gemini-2) | holds | fixed, 0ce1428, bcab15d |
| gemini-2 | Once the cap is passed, reading continues over every remaining file | gemini, codex (with codex-1) | holds in part: reading continues; nothing fails open, since the set is still refused | fixed, 0ce1428, bcab15d |
| codex-2 | The above-L2 test calls the delivery helper and `runTask` itself, so deleting a station's forwarding leaves it green | codex | holds | fixed, ac7bd6c |
| codex-3 | A granted spec drafter can carry instruction text into the spec that test-design later reads | codex | holds in part: the path exists and predates R24 | rejected as a defect of R24; recorded below |
| gemini-1 | `readListed`'s post-read size check is tautological, so a file that grows after its stat is truncated and accepted | gemini | does not hold | rejected |

Every finding was verified against the code before anything changed: codex-1 and gemini-2 by running the construction, the other three by a fresh-context reader given only the finding and the files.

## codex-1 and gemini-2: the set's cap

**Checked.** A probe through `readRepoInstructions` over a base holding 1,000 empty `.claude/rules/*.md`, each with a 205-character name: admitted, 1,000 files, 221,000 bytes of paths, every one of which `renderRepoInstructions` (`packages/api/src/line.ts`) puts in a heading. A second probe with six files of a quarter of the cap each: refused as `set-too-large` at the fifth, but the reader went on to read the sixth. Code: `packages/compiler/src/instructions.ts`, `total += read.bytes.byteLength` and the `!overSet` guard.

**Found.** codex-1 holds: the cap did not bound what a seat is given, and a set the driver's argv cannot carry was admitted. The consequence is a run that fails at the driver rather than at admission, which is the refusal-first rule turned around; no grant widens and nothing is truncated. gemini-2 holds in part: the reader did keep reading past the cap, but the set was still refused, so it is a cost bound, not a fail-open. Its "unbounded memory" is real only in count, since each file is still capped.

**Changed.** Each file now costs its bytes, its path, and a 16-byte heading allowance (`REPO_INSTRUCTION_HEADING_BYTES`); nothing is read once the cap is passed; the set's cap is 36 KiB, so a single file at the 32 KiB file cap still fits with its heading. D-R24-03 is corrected to match. A new case in `I5.refused-instruction-file-refuses-admission` plants the thousand empty files; it failed against the old reader (the run was admitted and refused later, at a station) and passes now, with exactly one refusal. Options weighed: a file-count cap alone, rejected because it leaves long paths unbounded; checking the rendered text against the driver's limit at admission, rejected because the rendered size depends on which files each seat's sensitive-path filter drops, and the cap must hold for the largest.

## codex-2: the above-L2 test bypassed the production steps

**Checked.** `packages/api/test/paid/repo-instructions.test.ts` called `repoInstructionsFor` itself and passed its input to `runTask` by hand, with a prefix it wrote itself. The forwarding sites are the build step, the review step, and the drafter and critic in `drafting.ts`.

**Found.** Holds. Deleting any production forwarding left the test green.

**Changed.** The test now builds the context exactly as `resumeRun` does, through `loadLine` (exported from `run.ts` for it; it reads records and returns data, and grants nothing), with the admitted level read as L3, and drives `runLine`. It asserts one narrowing with source `repo-instructions` at the build task, every model call after the narrowing was committed, the set in the builder's and reviewer's suffix and never their prefix, the same steps placing it in the prefix at L2 with nothing narrowed, and a run with an unnarrowable seat stopping with the set withheld. Replacing the build step's `{ inputs }` with `{}` fails it; restoring it passes. The drafter and critic forwarding is still covered only by the L0 to L2 conformance assertion (`I3.test-design-never-receives-repo-instructions` shows the spec drafter receiving the set); a drafted run above L2 needs drafting drivers this test does not wire, and adds no new placement logic.

## codex-3: instruction text carried into the spec

**Checked.** `STATION_CONTRACTS.spec` grants `repo-instructions`; the spec drafter's tree is `copyTree(base, start)` (`drafting.ts`), unchanged since R19, so it could already read `CLAUDE.md` before R24; test-design is granted `locked-spec` alone.

**Found.** Holds in part. A drafter can copy repository text into a spec, and test-design then reads it as part of the locked spec. That is not new to R24, and it is not a breach of the rule R24 owns: test-design is given the locked spec and nothing else, and what a spec may contain is judged at the spec station's exit, where a drafted spec waits for approval.

**Outcome.** Rejected as a defect of this unit. The distinction codex-3 draws (no direct delivery, versus no repository-derived content anywhere upstream of the oracle) is real and is recorded here; the second would need a content boundary on drafted specs, which no unit owns and R24's out-of-scope list ("any change to what `test-design` sees") excludes.

## gemini-1: the post-read size check

**Checked.** `readCapped` in `packages/compiler/src/compile.ts` allocates `max + 1` bytes, so a file that grew past the cap after its stat is read as `max + 1` bytes and refused as `too-large` by the check after it.

**Found.** Does not hold. The check is live, and the growth case is refused, not truncated. The function predates R24 (R20); R24 moved it into `readListed` unchanged.

**Outcome.** Rejected; nothing changed.

## Acceptance after the fixes

Rerun after the three fix commits: see the merge-gate report on the pull request (#107).
