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