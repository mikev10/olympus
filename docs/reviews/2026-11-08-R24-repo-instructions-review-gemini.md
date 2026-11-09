BASE: 0cc8f46
HEAD: 2a6e69e
packages/vault/src/types.ts
74fde741ead3330e52425f3418cb73d8

I had no prior context and performed no lookups.

packages/compiler/src/compile.ts:147 — tautological check — high — The check `if (bytes.byteLength > max)` is tautological if `readCapped(handle, max)` guarantees it returns at most `max` bytes. If a file is smaller than `max` at the time of `stat` but grows beyond `max` before being read, it will be silently truncated to `max` bytes and accepted. This violates the invariant that a file is never truncated. — Resolve it by passing `max + 1` to `readCapped` and checking if `bytes.byteLength > max`, or by stating the file again after the read.

packages/compiler/src/instructions.ts:94 — fails open (DoS) — medium — The `!overSet` condition is used to ensure the `set-too-large` refusal is only pushed once, but because the `return` statement is inside the same `if` block, it prevents returning early for any subsequent files. An adversary controlling the base repository can create millions of small files in `.claude/rules/`; once the 32 KiB limit is reached, `overSet` becomes true, the `if` block is skipped for all remaining files, and execution falls through to read, hash, and append every single file to the `files` array. This causes unbounded memory consumption and crashes the admission process. — Resolve it by moving the `return` statement outside the `!overSet` check (e.g., `if (total > REPO_INSTRUCTIONS_MAX_BYTES) { if (!overSet) { ... } return; }`).

The framing of the adversarial question was highly appropriate. All other mechanisms—such as the TOCTOU protection on symlinks, dropping the front matter securely without reading it as config, narrowing before releasing untrusted input in the suffix above L2, and protecting `test-design` from instructions—were assessed as sound.