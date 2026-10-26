# External review of R6, gemini, 2026-10-24

An adversarial review of R6: the driver for any OpenAI-compatible chat
endpoint, the relay's second usage dialect and credential scheme, and the
runtime's seating of the new driver. One of two reviews run from the same
prompt and bundle; the other is `2026-10-24-R6-openai-compatible-review-codex.md`.
Both are triaged in `2026-10-24-R6-openai-compatible-triage.md`, which cites
this review's findings as `gemini-1` and `gemini-2`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`generativelanguage/v1beta`), offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration. Exit 0, not timed out,
  171.9 s. Ingestion `complete`: 86,683 prompt tokens against a floor of
  59,999. Integrity `verified`. Outcome `counted`. Reply SHA-256 as the runner
  wrote it:
  `76785527b71879ea7f05cac1563c1faa72d0c4daf63c95c51d956ca3a2b4caff`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `c89c72e`.
- **Cross-family agreement:** neither gemini-1 nor gemini-2 was raised by
  codex. gemini-1 and codex-2 reach the same consequence through different
  mechanisms and are not paired.
- **Date:** 2026-10-24 (run started 2026-10-25T22:54Z).
- **Bundle:** `2026-10-24-R6-openai-compatible-review-bundle.txt`, SHA-256
  `256ed8c0b1843dee21fcda94566010d41c2c706c68688053e933fbd4e7b3057c`, base
  `d039910` (`reviewed/R19`), head `bd07193` ("R6: Driver: any
  OpenAI-compatible endpoint"), one commit. It held 42 of the 46 changed paths:
  the new `drivers/openai-compatible` package and its tests, the relay's
  `openai-chat` dialect and `bearer` credential, the graph and host seating in
  `api`, the conformance registry entries, the changeset, and the lockfile; new
  files in full and modified files as whole-function diffs. The four design
  documents (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`,
  `docs/plan/F1-spine.md`, `docs/plan/R6-openai-compatible.md`) were excluded.
  Prompt: `2026-10-24-R6-openai-compatible-review-prompt.txt`.
- **Citations:** line numbers are positions in the reviewer's reading of the
  bundle, not the repository. Treat them as hints, not locations.

- **Prior context and lookups:** the reviewer stated it had no prior context
  and made no external lookups. This is a self-report and cannot be
  independently verified.
- **Coverage, and any gap:** items 1 (gemini-1), 2 (gemini-2), and 6 were
  answered; item 4 only through the sound-mechanisms list (integer checks on
  `n` and usage). Items 3 (fail-open), 5 (configuration), and 7 (framing) came
  back empty.

---

BASE: d039910
HEAD: bd07193
pnpm-lock.yaml
e8e31272f8ea4cad32a76d59985ecbc6

I had no prior context and performed no external lookups. 

Here are the findings from the review:

### 1. `packages/drivers/openai-compatible/src/driver.ts:312` — factually wrong — high
**The concrete bypass:** The driver attempts to protect the budget and model identity invariants by having a relay container enforce them. However, it implements the model call by running `node --eval` *inside the provisioned sandbox* via `provider.exec`. Because the sandbox's root filesystem is writable (as enforced by I1), an agent granted the `Bash`, `Write`, or `Edit` tools can easily overwrite `/usr/bin/node` (or place a script earlier in `$PATH`) with a malicious executable. 

When the driver makes its next turn, it runs the attacker's script instead of real Node. The script can ignore the relay entirely and simply print a forged JSON response (e.g., `{"status": 200, "body": "{\"model\": \"test-fast\", ...}"}`). This allows the agent to:
- **Spend without the relay counting it:** The relay is bypassed entirely, enabling infinite generation.
- **Spoof model identity:** The forged output includes whatever model name the driver expects, attributing answers to the declared model family that were not produced by it.

The tests (`OPENAI_COMPATIBLE_FAMILY_IS_DECLARED` and `MODEL_RELAY_ENFORCES_BUDGET_OPENAI_CHAT`) actually fail if the driver checks are removed, satisfying the prompt's condition, but they mock the behavior or run in pristine sandboxes where `node` hasn't been overwritten, completely missing this bypass.

**What would resolve it:** Do not execute model calls from inside the untrusted sandbox. The driver runs on the host and should make the HTTP POST request to the relay directly from the host.

### 2. `packages/drivers/openai-compatible/test/invariants.test.ts:133` — factually wrong — medium
**The concrete issue:** The test `I4.openai-compatible-credential-not-readable-by-the-task` is tautological. It claims to prove that the driver implementation does not leak the endpoint's credential into the sandbox (by checking processes, files, and environment). However, the `OpenAICompatibleDriver` is only ever initialized with the credential's *name* (the string `"openai-compatible-endpoint"`), never the actual secret value. 

The provider holds the actual secret and injects it directly into the separate relay container. Because the driver code under test physically does not possess the credential, it is impossible for the driver to leak it. The test will therefore pass regardless of what the code under test actually does.

**What would resolve it:** Acknowledge that the driver cannot leak a value it does not have. This property is guaranteed by the architecture (the provider and relay isolation) rather than the driver code, so a driver-level test is meaningless and should be removed or repurposed.

### 3. Sound Mechanisms
*(As requested, an assessment of what is sound and why)*
- **Path Resolution & Tool Execution:** `tools.ts` uses `posix.resolve` to allow writing and editing files in absolute paths (e.g. `../../usr/bin`). This is sound because the tools are executed entirely within the sandbox isolated layer. It safely prevents host filesystem access and honors the default deny/I1 constraints.
- **Relay Configuration & Escapes:** The `relay.ts` endpoint checking correctly falls back to refusing unsupported routes. The regex matching (`/\/chat\/completions$/.test(path)`) correctly excludes query strings via URL parsing and explicitly prevents traversal or trailing-slash bypasses (returning `'unmeterable'` which fails closed).
- **Type Coercion Protections:** The budget checking logic (`openaiCeiling` and usage extraction) correctly uses `Number.isInteger(v) && v > 0`. This safely prevents generic erasure or type-coercion escape hatches where an attacker might pass arrays, floats, or strings (e.g., `n: "2"`) to manipulate limits. 
- **Graph Attestation:** The use of `instanceof` to verify trusted drivers in `graph.ts` is sound, as the runtime controls the wired instances and a simple wrapper failing the check ensures the system fails closed.