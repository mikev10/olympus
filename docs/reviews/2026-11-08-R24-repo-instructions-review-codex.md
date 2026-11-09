# External review of R24, codex, 2026-11-08

The external Codex review of R24, repository instructions as granted context: the reader, admission and resume, delivery in the line, and the contract tables. The triage is `2026-11-08-R24-repo-instructions-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** codex-1 (the set's cap does not bound what is rendered) was raised by Gemini too, as gemini-2 (reading continues past the cap). codex-2 and codex-3 were raised by Codex alone.
- **Date:** 2026-11-08
- **Bundle:** `2026-11-08-R24-repo-instructions-review-bundle.txt`, SHA-256 `00248ca7f80a6df2647672c1ad36d0166a7d3f6d703206482b422bf0c588f0c2` (the manifest's `bundleSha256`), base `0cc8f46` (`reviewed/R10`), head `2a6e69e` (the unit's tip when the review was requested). It held every new file in full and every modified file as a diff with each changed function whole; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-08-R24-repo-instructions-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated no prior project context and no external lookups, and that a local directory listing was blocked. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1, 5, 6, and 7 answered; item 4 answered as none found; items 2 (tautological checks) and 3 (fails open) received no finding of their own.
- **Citations:** line numbers refer to positions in the bundle, not the repository; each was located in the code during triage.

---

BASE: 0cc8f46
HEAD: 2a6e69e
packages/vault/src/types.ts
74fde741ead3330e52425f3418cb73d8

No prior project context. No external lookups. I reviewed the inline bundle; a local directory-listing attempt was blocked. I did not run tests or independently verify the bundle’s SHA-256.

1. **packages/compiler/src/instructions.ts:36; packages/api/src/line.ts:931 — factually wrong — medium — The set’s byte cap does not bound the context it produces.**

   Construct 1,000 empty `.claude/rules/*.md` files with distinct filenames approximately 240 characters long. Their combined content size is zero, so neither content-byte cap rejects them. Every file nevertheless becomes a record and a rendered heading containing its full path. The resulting instruction context exceeds 240 KB before other context is added.

   This defeats the stated reason for the set cap: keeping the system argument within its size limit. It can produce an admitted run whose model invocation fails, and also permits unbounded enumeration and admission-record overhead. This is an availability defect, not evidence of a capability escalation or silent truncation.

   **Resolve:** bound file count and aggregate path/record overhead, and check the complete rendered prompt against the delivery channel’s limit before admission succeeds. Add a many-empty-files test. **Confidence: high.**

2. **packages/api/test/paid/repo-instructions.test.ts:110 — factually wrong — medium — The above-L2 test does not establish production suffix delivery.**

   The test calls `repoInstructionsFor` itself, then explicitly passes its returned input to `runTask`. It also supplies a constant stable prefix containing no repository instructions.

   Delete the new `{ inputs }` forwarding from production `build`, `review`, or drafting calls: this test still passes. The lower-level functions remain correct while a granted production seat silently receives no instructions above L2. The negative prefix assertion also cannot establish that production callers never put the text there: the test constructed that prefix itself.

   **Resolve:** exercise the actual station delivery functions with a controlled above-L2 context, capturing their driver requests. Require that deleting production input forwarding fails the test. Keep the current test as a helper-level test. **Confidence: high.**

3. **packages/api/src/drafting.ts:382 — unclear — low — “No instruction text reaches test-design” is stronger than the boundary implemented here.**

   A granted spec drafter receives repository instructions and writes the spec. An instruction such as “include this testing directive verbatim in the specification” can therefore influence the artifact subsequently delivered as `locked-spec` to test-design. Locking authenticates the approved spec’s bytes; it does not establish that those bytes contain no repository-derived instructions.

   This is not a demonstrated deterministic bypass: it requires the drafter to copy the text and the resulting spec to pass the approval process. But the direct grant check alone cannot prove the absolute information-flow property in the question.

   **Resolve:** specify whether the intended guarantee is *no direct repository-instruction delivery to test-design*, with the approved spec explicitly trusted, or whether repository-derived directives must also be excluded from the spec. The latter needs a separate approval/content boundary. **Confidence: high about the distinction; model compliance is uncertain.**

The following mechanisms look sound within the stated threat model:

- **Admission-time pinning:** admission reads the snapshot and supplies those strings to the line; resume validates the recorded set rather than rereading current repository instructions (`packages/api/src/run.ts:1038`, `:1261`). The attacker cannot replace these strings merely by writing a task workspace.
- **Explicit delivery gating:** `repoInstructionsFor` checks both the contract grant and policy scope before rendering or narrowing. Test-design’s contract excludes this grant (`packages/api/src/line.ts:949`; `packages/core/src/station/contracts.ts:185`).
- **Default deny:** the policy validator accepts only a boolean and defaults an absent `repoInstructions` to false (`packages/core/src/policy/validation.ts:447`).
- **Above-L2 release ordering:** `narrowRun` records and commits narrowing before releasing the input; `runTask` checks release membership and narrowed state before delivery (`packages/api/src/line.ts:906`). Failures on this path stop delivery.
- **Individual-file checks:** the reader rejects listed links and non-files; `readListed` checks opened-file identity, enforces the file cap, and uses fatal UTF-8 decoding (`packages/compiler/src/compile.ts:121`). This assessment assumes the trusted snapshot implementation preserves entries sufficiently for those checks.

I found no reachable TypeScript cast, declaration-merging, generic-erasure, or type-predicate exploit under this attacker model. Those require control of runtime code or its callers that the question explicitly excludes. Likewise, accepting an absent legacy instruction set in `repoInstructionsProblem` is not an attacker-controlled record-deletion route when the Vault and admission-reference integrity are trusted.

The adversarial framing is appropriate for admission and explicit delivery. Its strongest wording needs qualification: the code can enforce which recorded context channel supplies text, but cannot establish that no downstream approved artifact ever repeats that text.