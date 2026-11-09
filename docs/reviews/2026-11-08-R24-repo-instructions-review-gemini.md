# External review of R24, gemini, 2026-11-08

The external Gemini review of R24, repository instructions as granted context: the reader, admission and resume, delivery in the line, and the contract tables. The triage is `2026-11-08-R24-repo-instructions-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-2 (reading continues past the set's cap) was raised by Codex too, as part of codex-1. gemini-1 was raised by Gemini alone.
- **Date:** 2026-11-08
- **Bundle:** `2026-11-08-R24-repo-instructions-review-bundle.txt`, SHA-256 `00248ca7f80a6df2647672c1ad36d0166a7d3f6d703206482b422bf0c588f0c2` (the manifest's `bundleSha256`), base `0cc8f46` (`reviewed/R10`), head `2a6e69e` (the unit's tip when the review was requested). It held every new file in full and every modified file as a diff with each changed function whole; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-08-R24-repo-instructions-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated no prior context and no lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 2, 3, 6, and 7 answered; items 1, 4, and 5 received no finding of their own.
- **Citations:** line numbers refer to positions in the bundle, not the repository; each was located in the code during triage.

---

BASE: 0cc8f46
HEAD: 2a6e69e
packages/vault/src/types.ts
74fde741ead3330e52425f3418cb73d8

I had no prior context and performed no lookups.

packages/compiler/src/compile.ts:147 — tautological check — high — The check `if (bytes.byteLength > max)` is tautological if `readCapped(handle, max)` guarantees it returns at most `max` bytes. If a file is smaller than `max` at the time of `stat` but grows beyond `max` before being read, it will be silently truncated to `max` bytes and accepted. This violates the invariant that a file is never truncated. — Resolve it by passing `max + 1` to `readCapped` and checking if `bytes.byteLength > max`, or by stating the file again after the read.

packages/compiler/src/instructions.ts:94 — fails open (DoS) — medium — The `!overSet` condition is used to ensure the `set-too-large` refusal is only pushed once, but because the `return` statement is inside the same `if` block, it prevents returning early for any subsequent files. An adversary controlling the base repository can create millions of small files in `.claude/rules/`; once the 32 KiB limit is reached, `overSet` becomes true, the `if` block is skipped for all remaining files, and execution falls through to read, hash, and append every single file to the `files` array. This causes unbounded memory consumption and crashes the admission process. — Resolve it by moving the `return` statement outside the `!overSet` check (e.g., `if (total > REPO_INSTRUCTIONS_MAX_BYTES) { if (!overSet) { ... } return; }`).

The framing of the adversarial question was highly appropriate. All other mechanisms—such as the TOCTOU protection on symlinks, dropping the front matter securely without reading it as config, narrowing before releasing untrusted input in the suffix above L2, and protecting `test-design` from instructions—were assessed as sound.