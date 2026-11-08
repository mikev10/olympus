# External review of R10, gemini, 2026-11-07

An adversarial review of the trust ratchet: admission and mid-run narrowing,
the narrowed scope the line hands each task, the withheld-input API, and
sensitive-path omission. Triage: `2026-11-07-R10-trust-ratchet-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct
  `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools.
  `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1 (a drafter can write a sensitive path,
  which the critic is then handed) was raised by codex too, as codex-3.
  gemini-2 was raised by gemini alone.
- **Date:** 2026-11-07
- **Bundle:** `2026-11-07-R10-trust-ratchet-review-bundle.txt`, SHA-256
  `34ee893d43e5f4ae1685431fdc22acaf681464032b5dbb76403596ef7d6401fd`, base
  `7502a2a` (`reviewed/R8b`), head `0edf3ae` (the unit's implementation).
  New files in full and modified files as function-context diffs;
  `docs/decisions.md`, `docs/plan/`, `docs/reviews/`, and `pnpm-lock.yaml`
  excluded. Prompt: `2026-11-07-R10-trust-ratchet-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior project
  context and made no external lookups. That is a self-report and cannot be
  verified independently.
- **Coverage, and any gap:** the reply answers items 1 and 2 only. Items 3
  (fails open), 4 (language escape hatches), 5 (configuration), 6 (what is
  sound), and 7 (whether the framing is right) came back empty. That silence
  is not an endorsement.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository. They are hints, located during triage.

---

BASE: reviewed/R8b
HEAD: 0edf3ae
packages/vault/test/stub.test.ts
1c218aa6beb0d73c297ee20f246ed2cc

I have no prior context about this project, and I have not performed any external lookups. 

### Findings

**1. `packages/api/src/drafting.ts:394` (and `695`)** — factually wrong — High — A drafter task can write to a sensitive path and replace it unseen. In `draft`, the written files are checked via `writesOutsideGrant` against the role's `writableGlobs`, which does not automatically exclude sensitive paths (since sensitive paths are governed by `withheldGlobs`). Any sensitive file written by the drafter is accepted into `DraftRecord.files`. Later in `critique` (line 695), `writeFiles` applies `record.files` to the critic's workspace *after* `omitWithheld` has already removed sensitive files from the base tree. The critic then sees and reviews the sensitive file, and upon human approval, the draft is locked into the run. Verification (`verify`) never catches this because it only runs on `build` tasks, completely bypassing the restriction.
*Resolve by:* In `draft`, pass the drafted entries through `withheldOf(withheldGlobs(ctx, DRAFT_ROLES[station].drafter), ...)` and append matches to `read.problems` (or refuse outright) to reject drafts that write to sensitive paths.

**2. `packages/core/src/trigger/admission.ts:172`** — factually wrong — Low — The condition `narrowed.level > requested` in `levelOf` is tautological. Both `narrowAtAdmission` and `narrowRun` use `planNarrowing` to compute the narrowed level. `planNarrowing` initializes `level = requested` and only lowers it based on `autonomyCeiling`s. Thus, `narrowed.level` is strictly less than or equal to `requested`, making `narrowed.level > requested` mathematically impossible to be true in the code under test. 
*Resolve by:* Simplifying the function to `return narrowed === null ? requested : narrowed.level;`.