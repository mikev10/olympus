# External review of R18, codex, 2026-10-21

An adversarial review of R18, the stack recorded per run: the detected stack
written into the admission record, both Vaults' refusal of a record that names
none, `readRunRecords` and `recordedStack` reading it back, the per-stack rates,
and the conformance assertion `I2.admission-records-the-detected-stack`; with
the park-cause amendment (A-R4-05), the README update, and the #56 sandbox test
fix in the same range. One of two reviews run from the same prompt and bundle;
the other is `2026-10-21-R18-stack-per-run-review-gemini.md`. Both are triaged
in `2026-10-21-R18-stack-per-run-triage.md`, which cites this review's numbered
findings as `codex-1` to `codex-3` and its closing paragraph on the framing as
`codex-7`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 112.5 s. Ingestion `complete`: 54,407
  input tokens against a floor of 30,831. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `0a7b141887c9e56061a0f98ce8232042f196032f9b174a47e1dc5a4244124f60`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `a5c4b7a`.
- **Cross-family agreement:** codex-2 and gemini's item 1 describe the same
  mechanism, a stop between `recordAdmission` and `commitRunState`, and reach
  opposite assessments: codex a defect, gemini sound. codex-7 and gemini's item
  7 both address the framing and disagree. codex-1 and codex-3 were raised by
  codex alone.
- **Date:** 2026-10-21
- **Bundle:** `2026-10-21-R18-stack-per-run-review-bundle.txt`, SHA-256
  `bae66f76ef94fb1e048d9c572a0ff9ac258fda009660a9e6a10364e415b0e9c0`, base
  `7f3fe7a` (`reviewed/R4`), head `f41f5a5` (R18's implementation commit on
  `unit/r18`). It held the range's three commits: the R18 change, the
  park-cause amendment (#57), and the README update (#52), with every new file
  whole and every modified file as a diff showing each changed function whole.
  Prompt: `2026-10-21-R18-stack-per-run-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no external lookups, that a workspace-listing attempt
  was blocked, and that it ran no tests. These are self-reports, not
  independently verifiable; the blocked listing agrees with the read-only empty
  scratch directory.
- **Coverage, and any gap:** items 1 and 3 answered by codex-1 to codex-3;
  item 2 answered in the assessment (the conformance assertion is not
  tautological); item 4 answered (no reachable cast or declaration-merging
  attack found); item 5 not answered separately; item 6 answered at length;
  item 7 answered (codex-7).
- **Citations:** line numbers refer to positions in the bundle's diffs, not
  the repository, and are hints. The triage located each construct in the
  repository before relying on it.

---

BASE: 7f3fe7a  
HEAD: f41f5a5  
packages/vault/test/local.test.ts  
8448ff2398d6e24e88c556aa5f6d84a6

I have no prior project context. I performed no external lookups. A workspace-listing attempt was blocked; this review uses the complete inline bundle. I did not run tests or verify the supplied file hash.

1. **packages/api/src/line.ts:1319; packages/api/src/outcomes.ts:196 — factually wrong — high — Failed attempts can disappear from a stack’s sample after a process stop.**

   `verify` writes evidence before committing its reference and verdict. `readRunRecords` reads only `state.evidenceRefs`.

   Construction: use a flaky required check. Whenever verification fails, stop after `writeEvidence` completes but before the state commit. The durable failure bundle is invisible to outcomes. Resume verification and allow a passing result to commit. The reader sees only that passing bundle: caught false-done records zero failures, and first-pass yield records success, despite earlier runtime-observed failures on that stack.

   This is an existing accounting weakness propagated into the new stack rates, not a stack-label substitution. Resolve it by durably identifying verification attempts and their verdicts, then reconciling interrupted attempts without dropping failures or double-counting replays. Add a stop-and-resume test at this write boundary.

2. **packages/api/src/run.ts:586; packages/api/src/outcomes.ts:173 — factually wrong — medium — An existing admission stack becomes `unrecorded` after an interrupted admission.**

   Stop after `recordAdmission` succeeds and before `commitRunState`. The admission record contains the detected stack, but `readRunRecords` takes the missing-state branch and returns `stack: null` and no admission timestamp.

   This contradicts the promised distinction between “no record names a stack” and a recorded stack. The shown admission path also checks only for existing state before attempting another admission, while the Vault refuses replacement of the orphaned admission.

   **Limit:** this interruption creates no task samples and is excluded from the autonomy denominator as unfinished; it does not itself contaminate another stack’s rate.

   Resolve it with independently discoverable admission records and explicit recovery of incomplete admission, or an atomic admission-and-initial-state operation.

3. **packages/api/test/line.test.ts:283, 311 — factually wrong — low — Missing evidence makes evidence assertions pass without running.**

   Both tests return successfully when `state.evidenceRefs` has no first entry. A regression that preserves the asserted task status but omits its evidence therefore passes the test for recorded check results or suite count.

   Resolve it by asserting that evidence exists and throwing if the reference is absent. The nearby tamper-report test already uses that pattern.

The central **stack-attribution wiring appears sound within the stated trust boundary**:

- `run.ts:553, 559, 579` uses one adapter set for security capability, unavailable controls, and the recorded stack.
- Both Vault implementations reject absent, empty, and non-string stacks before storing them. Their guards are runtime checks; TypeScript casts do not bypass them.
- `outcomes.ts:152` reads the stored string and returns null for a missing or invalid value. It does not redetect the current repository or consult an agent claim.
- The conformance assertion has independent expectations for `vitest@4` and `unsupported`; it is not tautological. Its coverage is narrower than the feature: it exercises local-store rejection and autonomy grouping, without directly exercising stub-store rejection or the admission interruption.
- The park amendment commits the cause together with parked status and reads that cause on resume. The supplied regression exercises the formerly ambiguous counts.
- The sandbox test’s restriction to its own object names is reasonable. Whether Docker command errors can masquerade as empty listings depends on the omitted `run` helper.
- I found no concrete defect in the README edits, though the bundle cannot substantiate all their project-wide claims.

I found no reachable cast, declaration-merging, or serialization-object attack under the assumption that runtime components and runtime-process code are trusted. Changing repository declarations to change **what detection detects** is also outside the attribution property you specified.

The adversarial framing is appropriate, but label integrity alone is insufficient. `outcomes.ts:313` deliberately excludes unfinished runs from the autonomy denominator. Someone controlling stops can therefore retain successes while leaving likely failures unfinished. That is selection bias rather than incorrect arithmetic for the documented metric. Before using these rates for oversight relief, ask whether the evidence accounts for **all initiated runs and interrupted attempts**, including adversarially selected non-completion.