# External review of R8a, gemini, 2026-11-05

This is the gemini family's review of R8a, post-merge attribution and the baseline. The reply follows the header unchanged. The triage covering both reviews is `2026-11-05-R8a-post-merge-attribution-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** Raised gemini-1 with codex-5 and gemini-2 with codex-1. Raised alone: gemini-3.
- **Date:** 2026-11-05
- **Bundle:** `2026-11-05-R8a-post-merge-attribution-review-bundle.txt`, SHA-256 `972319244dcf87c895c3e7bd72e79b09911cf84a3cf827b85b4a75b2210f8c8b`, base `reviewed/R13b`, head `9ecba3a` (the unit branch as shipped in PR #100). The bundle holds every new file in full and every modified file as a function-context diff. It excludes `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml`. Prompt: `2026-11-05-R8a-post-merge-attribution-review-prompt.txt`.
- **Prior context and lookups:** It stated that it performed no lookups and held no prior context. This is a self-report and cannot be verified independently.
- **Coverage, and any gap:** Items 1, 3, 6, and 7 were answered. Items 2, 4, and 5 had no entry.
- **Citations:** Line numbers are positions in the bundle's new-side diff hunks, not in the repository. Each finding was located by its function before it was judged.

---

BASE: reviewed/R13b
HEAD: 9ecba3a
packages/vault/src/types.ts
0cad6e8534028c02a53b887af149fec0

I performed no lookups and held no prior context about this project.

### 1. `classifyReversal` fails open on mixed rollbacks
packages/api/src/history.ts:183 — the concrete bypass — high

An attacker can completely hide a rollback by reverting the change and including an unrelated modification (e.g., adding a blank line to another file) in the same commit. The extra modification changes the commit's overall diff hash, so `later.patchId === change.inversePatchId` evaluates to `false`. The code then falls through to the partial-reversal check: `hunks > 0 && hunks < change.inverseHunks.length`. Because the commit includes *all* of the change's inverted hunks, `hunks` will equal `change.inverseHunks.length`. The strict less-than condition evaluates to `false`, causing `classifyReversal` to return `{ kind: 'none' }`. The rollback is entirely ignored, and the run will be marked as clean.

**Resolution:** If `hunks === change.inverseHunks.length`, it should be classified as a rollback (or a failure) even if the patch IDs differ. 

### 2. Dropped merge commits evade detection and are marked clean
packages/api/src/observe.ts:135-136 — the concrete bypass — high

An attacker can merge a run, and before its observation window closes, force-push the default branch to drop the merge commit entirely (or drop it between scheduled walks). `walkHistory` checks only that the previous walk's head (`from`) is an ancestor of the new `head`, so it fails to detect if an open run's merge commit was removed, provided `from` remains in the history. The orphaned commit is placed into `open` (as it is not in `inRange`). Because it is no longer on the branch, no subsequent commit will be evaluated as its rollback. When its window expires, `commitOf` successfully retrieves its metadata from the git object store (which retains un-garbage-collected objects), a `window-closed` event is recorded, and the change is marked clean despite being rejected from the line.

**Resolution:** In `walkHistory`, explicitly verify that the `mergeCommit` of every run in `openRuns` (or at least those about to close) is still an ancestor of `head`. If it is not, record it as a failure or fail the walk with `history-rewritten`.

### 3. `.gitattributes` blinds the diff mechanism, hiding rollbacks
packages/api/src/history.ts:104-106 — fails open — high

`git diff-tree` respects `.gitattributes` by default. An attacker (or a legitimate developer) can commit a `.gitattributes` file that marks files as `binary` or `-diff`. When `changeInverse` and `commitDiff` run against the host-side checkout, `git diff-tree` will output `Binary files ... differ` instead of text hunks. Consequently, `patchId` will evaluate to `null` and `hunkKeys` will return an empty array. `classifyReversal` will immediately return `{ kind: 'none' }` for any rollback involving these files. This causes the observation layer to fail open, marking rolled-back changes as clean.

**Resolution:** Pass `-a` or `--text` to the `git diff-tree` invocation in the `patch` function to force Git to treat all files as text and ignore `binary` attributes for the purpose of computing diffs.

### Soundness Assessment & Framing

The adversarial framing is exactly right for this code. The mechanisms for HMAC webhook signature verification, vault deduplication, budget constraints, and temporal tracking are highly rigorous and sound against forging or replay attacks. The use of `committer-claimed` vs `provider-reported` strongly mitigates metadata forgery, tracking the exact boundaries of what is cryptographically proven.

However, the observation layer places misplaced trust in Git's porcelain semantics (`.gitattributes`), and its pure-functional reliance on local history state without verifying the continued existence of the commit on the actual branch creates critical blind spots. The core Vault invariants successfully fail closed, but the Git parsing abstractions fail open under adversarial branch and configuration manipulation.