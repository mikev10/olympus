BASE: 2dcd5d2  
HEAD: 94fe9c3  
packages/vault/test/stub.test.ts  
7b87d325a1f3b0b1d319880a7755e912

No prior project context; no lookups performed. Reviewed only the supplied bundle. These are source-derived constructions, not executed reproductions.

1. **packages/api/src/verification.ts:107 — factually wrong — high — An installed filename is accepted as proof of a functioning test runner.**

   Declare Vitest in the base’s `package.json`, provide one locked, discoverable `a.test.ts`, and submit a required acceptance check naming it with `onBase: 'fails'`. Put this at `node_modules/vitest/vitest.mjs`:

   ```js
   import { existsSync } from 'node:fs';
   process.exit(existsSync('completion.flag') ? 0 : 1);
   ```

   Admission checks that the launcher is a file and that the adapter’s discovery model selects the named test. Neither establishes that the installed launcher implements that model.

   The base process exits 1 without loading any test. Build writes `completion.flag`; verification exits 0, again without loading any test. `runOnBase` nevertheless records the statically derived suite count at **packages/api/src/line.ts:394**. The verification path uses the same approach.

   This satisfies the gate with fabricated execution evidence despite using trusted runtime components and preserving every locked test. The suite-count check is tautological here: a discoverable filename supplies the count independently of execution.

   **Resolution:** Establish trusted runner provenance and obtain execution/completion evidence through a mechanism the tested process cannot forge. File discovery can establish intended selection, but cannot establish execution. **Confidence: high.**

2. **packages/api/src/line.ts:1009 — factually wrong — high — Protecting `node_modules` does not protect the runner’s executable dependencies outside that directory.**

   A separate construction keeps the installed launcher unchanged throughout the run. Supply this base launcher:

   ```js
   import '../../tools/judge.mjs';
   ```

   Initially, `tools/judge.mjs` contains `process.exit(1)`. Use the same discoverable, locked acceptance test and declaration as above. During build, change the helper to `process.exit(0)` within the task’s writable grant.

   The dependency filter carries that edit because its path has no `node_modules` segment. Verification executes the unchanged launcher, which loads the changed judge and exits successfully without loading the named test. `notCarried` remains empty.

   This is an executable-judge substitution, not the excluded question of whether an executed assertion adequately tests behavior. Even if tamper analysis escalates the helper edit, the shown verification code derives task status from check shortfalls; escalation does not prevent acceptance at `verify`.

   **Resolution:** Preserve and enforce the runner’s execution dependency boundary, including loaders, configuration and executable extensions outside `node_modules`. Separate mutable product inputs from immutable judging machinery. Authenticating only the launcher would not close this construction. **Confidence: high.**

The following mechanisms look sound within their narrower boundaries:

- **Manifest validation:** `packages/api/src/validate.ts:177` validates before casting. It rejects unknown kinds, suite commands, invalid declarations and malformed named-test lists. No concrete bypass through casts, `any`, declaration merging, module augmentation, generic erasure or type predicates is demonstrated under the stated exclusion of attacker code inside the runtime.
- **Missing results and unknown counts:** `packages/api/src/base.ts:31` and `packages/api/src/gate.ts:18` reject missing required results and unknown required suite counts. The shown execution catches record an unstarted check rather than inventing success.
- **Vault numeric validation:** `packages/vault/src/local/vault.ts:283` rejects omitted suite counts and non-integer exit codes. This closes those representation errors; it cannot establish that an otherwise well-formed count describes execution.
- **Dependency filtering:** `packages/api/src/workspace.ts:209` correctly detects literal `/`-separated `node_modules` path segments at any depth. It prevents carrying ordinary edits under those paths, subject to the workspace’s unseen path-normalization behavior.

The adversarial framing is appropriate, but two distinctions matter. Required guards may explicitly pass on the base, and behavioral checks need not name suites; the promised failure-before-change applies to at least one required declared check, not every required check. Also, an observed process exit is not independently authenticated test execution: the repository-controlled program chooses that exit.

I cannot establish crash-safe passage through `test-design` from this range. Its transition/resume implementation is absent; the included resume test covers an already-recorded refusal, not every committed interruption point. That requires inspecting the omitted transition ordering, rather than inventing a bypass from this bundle.