# External review of R56, codex, 2026-11-24

The Codex family's review of R56 (the relay forwards only the server tools a task was granted), given the prompt and bundle below and nothing else. Triage: `2026-11-24-R56-relay-server-tools-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** codex-1 was raised by Codex alone; Gemini raised no findings and assessed the same mechanism (`charge` and the usage reader) as sound.
- **Date:** 2026-11-24
- **Bundle:** `2026-11-24-R56-relay-server-tools-review-bundle.txt`, SHA-256 `5c338a9ee173eafe7a39e0f1cbd0b9e9dacef6c9aca66f1a9746248f858929f6` (the manifest's `bundleSha256`), base `03518f9` (`reviewed/R53`), head `fb1206b` (R56's tip before review: the A-R56-01 record and the relay grant). Every new file in full and every modified file as a function-context diff, 50 sections. `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. The range also held two post-R53 commits from other work (A-R40-02 and a tooling note). Prompt: `2026-11-24-R56-relay-server-tools-review-prompt.txt`.
- **Citations:** line numbers refer to positions in the bundle, not the repository. They are hints, and each was resolved to the construct it names before verification.
- **Prior context and lookups:** the reviewer stated no prior context and no external lookups, and that local execution was blocked. This is a self-report and is not independently verifiable.
- **Coverage, and any gap:** one finding under item 1. Items 2 and 3 were answered in prose: no tautological assertion and no exception-to-pass path found. Item 4 was answered in passing (casts in the sandbox cannot reach the trusted runtime). Item 5 was not addressed separately. Item 6 named four sound mechanisms. Item 7 judged the framing appropriate and named the open question it left.

---

Prior context: none. External lookups: none. I reviewed the prompt’s bundle; local execution was blocked, so I ran no tests and did not verify the SHA-256.

BASE: 03518f9  
HEAD: fb1206b  
packages/vault/src/types.ts  
99d1e029ba2638eefc7964b6a9adb194

1. **packages/sandbox/src/local/relay.ts:343 and :458 — unclear — medium — An intermediate search count can suppress conservative charging after an interrupted stream.**

   `usageReader.take()` stores any readable `server_tool_use` count without recording whether it is final. `charge()` uses that stored count whenever present; it falls back to `max_uses` only when the count is absent.

   Concrete construction: offer the granted search with `max_uses: 8` and request streaming. If an early usage event reports zero searches, subsequent searches execute, and the stream ends before updated usage arrives, the relay charges zero searches. Missing final output usage triggers the token ceiling, but does not invalidate the earlier search count. Subsequent calls can therefore continue with search spending omitted.

   **Confidence:** high in this accounting behavior; uncertain whether the provider emits an intermediate search counter and whether a sandbox-triggered disconnect produces the necessary upstream termination. The supplied mock places searches only in the final event (`packages/sandbox/test/upstream.ts:231`), so its streaming test does not resolve this.

   **Resolution:** establish terminal completeness separately for server-tool usage. On an incomplete stream or unreadable final counter, charge at least the offered ceiling and any larger observed count. Add a regression with an initial zero counter, subsequent tool execution, and no terminal usage. Capture actual provider streaming behavior to establish exploitability.

I found **no confirmed construction that obtains an ungranted server tool** in the shown request-validation code.

The following mechanisms look sound within the stated trust boundary:

- **Exact grant enforcement:** `anthropicTools()` rejects unknown typed tools and non-null `mcp_servers` or `container` before forwarding (`relay.ts:611`, `:687`). Own-property checks prevent prototype-member names becoming grants.
- **Grant validation:** `checkServerTools()` rejects absent lists, unsupported types, duplicate entries, invalid prices, and grants under unsupported dialects (`relay.ts:1035`). The relay independently checks its environment at startup (`:221`).
- **Policy wiring:** the three production callers pass the call’s tools. Claude’s mapping enumerates its own fixed entries and returns copied grants (`packages/drivers/claude-code/src/driver.ts:433`). Sandbox TypeScript casts or module augmentation cannot alter that trusted runtime.
- **Missing counters:** when no search counter was ever readable, charging `max_uses` is conservative, provided the provider enforces that ceiling.

I found no tautological newly added assertion or shown exception-to-pass path. The fake upstream tests verify relay arithmetic, but do not establish actual provider counter timing or the pinned CLI’s request format. The shown comment-stripping transformation preserves newlines; I found no demonstrated semantic change from it.

The adversarial framing is appropriate. The key unresolved question is **whether accounting remains conservative when a request has already caused tool execution but its response is incomplete**. Trusted configuration replacement and host-process type escapes are outside this attacker’s capabilities and would not constitute sandbox bypasses.