# External review of R15's review fixes, codex, 2026-10-12

An adversarial review of the R15 review fixes: suite checks that run the base's
own test framework over the tests they name (D-R15-04), the `node_modules`
filter on what a task's diff carries into `verify` (D-R15-05), and the stricter
base-record reader (D-R15-06). One of two reviews run from the same prompt and
bundle; the other is `2026-10-12-R15-base-run-fixes-review-gemini.md`. Both are
triaged in `2026-10-12-R15-base-run-fixes-triage.md`, which cites this review's
numbered findings as `codex-1` and `codex-2`, and its closing remark on
`test-design` crash safety as `codex-obs`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 58.5 s. Ingestion `complete`: 64,276
  input tokens against a floor of 39,430. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `60aa761b132c711cb993f037422366d7fa31a60f5e02a0b0129aab97799aaf9b`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. codex-2 and gemini-2 both defeat the
  `node_modules` carry filter, by different mechanisms (a runner dependency
  outside `node_modules`; a case-variant directory name). codex-1 and gemini-1
  both concern a suite count that does not evidence execution, by different
  mechanisms (a static count beside an unauthenticated runner; extra selected
  suites dropped from the count). Neither pair is the same defect.
- **Date:** 2026-10-12 (run started 2026-10-12T22:21Z).
- **Bundle:** `2026-10-12-R15-base-run-fixes-review-bundle.txt`, SHA-256
  `31e6c759093ed7fc652f6acafdf4d5f7b134a8f17d09f766334c7ecde01370d5`, base
  `2dcd5d2` ("R15: triage of the external reviews", untagged), head `94fe9c3`
  ("R15: name the dependency-install issue (#40)"). The range is two commits.
  It held 29 of the 32 changed paths in full or as whole-function diffs; the
  three documentation paths (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`,
  and the earlier triage) were excluded, and so was every unchanged file.
  Prompt: `2026-10-12-R15-base-run-fixes-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no lookups, and that its constructions were derived
  from source, not executed. A self-report; not independently verifiable.
- **Coverage, and any gap:** items 1 (codex-1, codex-2), 2 (the suite count
  as tautological within codex-1), 4 and 6 (a "sound within narrower
  boundaries" list naming no language escape hatch), and 7 (two framing
  distinctions, and that crash safety through `test-design` cannot be
  established from the range) were answered. Items 3 and 5 got no finding of
  their own; item 3 is touched only by the sound-list remark that unstarted
  checks are recorded as unstarted.
- **Citations:** line numbers are positions on the new side of the bundle's
  diffs, not repository lines. Treat them as hints; the triage locates each
  construct by name.

---

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