BASE: e37aab6
HEAD: 288555b
packages/vault/src/types.ts
ea01ba80ce4ac3dd9f22ebc035c6189a

I reviewed the code based on the provided invariants and adversarial constraints. I did not use any prior context or external searches.

### 1. `merge()` skips the base-movement check if the PR is already merged
**File:** `packages/api/src/integrate.ts`  
**Line:** 161 (inside `GitHubIntegrator.merge`)  
**Type:** Factually wrong  
**Severity:** High  

**Concrete bypass:**  
The runtime's security model dictates that a merged change must be exactly what the checks verified, meaning the base branch must not have moved (`#baseUnmoved`). However, if an attacker manually merges the PR on GitHub *after* the base branch has moved, `pull.merged_at` will be non-null. The `merge()` function assumes any existing merge was done by a previous aborted drive of the runtime, and it immediately accepts `pull.merge_commit_sha` without calling `this.#baseUnmoved(opened.baseCommit)`. 

When the human subsequently approves the gate, the runtime accepts this externally created merge commit. This violates "merge after the base moved" and "Fail closed ... a moved base stops the run", as the code merged on GitHub combines the verified diff with unverified base changes.

**Resolution:**  
Call `await this.#baseUnmoved(opened.baseCommit)` even when `pull.merged_at !== null`, or explicitly verify that the PR's `merge_commit_sha` has `opened.baseCommit` as its first parent.

### 2. The PR's base branch is never verified, allowing merges into arbitrary branches
**File:** `packages/api/src/integrate.ts`  
**Line:** 147 (in `open`) and 168 (in `merge`)  
**Type:** Factually wrong  
**Severity:** High  

**Concrete bypass:**  
When the runtime checks an existing PR in `open()` or fetches it in `merge()`, it never checks `pull.base.ref === this.baseBranch`. Because the attacker has write access to the repository (implied by their ability to move the base branch), they can log into GitHub and change the PR's target base branch from `main` to `attacker-branch`. 

When the runtime calls `PUT /pulls/{pull.number}/merge`, GitHub will merge the verified tree into `attacker-branch`. However, the runtime builds the `IntegrationMerged` record using `opened.baseBranch` (which is hardcoded to `this.baseBranch`). This makes the Vault record falsely claim the code was merged into the configured base branch.

**Resolution:**  
In both `open()` and `merge()`, verify that `pull.base.ref === this.baseBranch` and throw an error if it does not match.

### 3. A run that accepts no changes is transiently reported as `passed` while destined to halt
**File:** `packages/api/src/run.ts`  
**Line:** 1073 (in `runStanding`)  
**Type:** Factually wrong  
**Severity:** Medium  

**Concrete bypass:**  
If a task makes no changes (`diff.length === 0`), `openAccepted` exits early and does not create an `IntegrationOpened` Vault record. When a human approves the exit, the client polls `status`. `runStanding` sees that the unspent grant is present, evaluates the `integration` array, finds it empty, and tautologically assumes there is no integrator. It returns `{ standing: 'passed' }`.

However, the background drive running `runLine` will reach `mergeAccepted`, see that `integrator !== null`, but find no `opened` record. It will throw an error ("a run that merged nothing is not done") and halt the run. This leaves the run transiently reported as `passed` to the client when its merge is half-completed and doomed to fail.

**Resolution:**  
`runStanding` should not assume that an empty integration array means the run is done if it hasn't verified whether an integrator is configured or if the drive has successfully completed.

### 4. Configuration parsing accepts an empty string as GID 0
**File:** `packages/api/src/host/main.ts`  
**Line:** 31 (in `containerUser`)  
**Type:** Factually wrong  
**Severity:** Low  

**Concrete bypass:**  
The runtime intends to enforce that `FACTORY_CONTAINER_UID` and `FACTORY_CONTAINER_GID` must both be provided, or neither. However, if an operator sets `UID=1000` but explicitly leaves `GID=''` (empty string), `Number('')` evaluates to `0` in JavaScript. `Number.isInteger(0)` returns true, bypassing the validation check and silently defaulting the container group to `0` (root group) rather than refusing the configuration. 

**Resolution:**  
Check `uid === ''` and `gid === ''` explicitly before passing them to `Number()`, or use `parseInt` with strict validation.