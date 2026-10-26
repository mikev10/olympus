# External review of R6, codex, 2026-10-24

An adversarial review of R6: the driver for any OpenAI-compatible chat
endpoint, the relay's second usage dialect and credential scheme, and the
runtime's seating of the new driver. One of two reviews run from the same
prompt and bundle; the other is `2026-10-24-R6-openai-compatible-review-gemini.md`.
Both are triaged in `2026-10-24-R6-openai-compatible-triage.md`, which cites
this review's findings as `codex-1` to `codex-5`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 96.2 s. Ingestion `complete`: 90,794
  input tokens against a floor of 59,999. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `43611a0dd938d1ad037484effa6ef81718a2e8e105411d6c1c818dd2f5dd263a`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `c89c72e`.
- **Cross-family agreement:** none of codex-1 to codex-5 was raised by gemini.
  codex-2 and gemini-1 reach the same consequence, an answer recorded under a
  model that did not produce it, through different mechanisms (a lying
  endpoint, and a replaced `node` in the sandbox), so they are not paired.
- **Date:** 2026-10-24 (run started 2026-10-25T22:53Z).
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

- **Prior context and lookups:** the reviewer stated it had no prior project
  context and made no external lookups, and that it did not run the tests or
  verify the bundle's hash. These are self-reports and cannot be independently
  verified.
- **Coverage, and any gap:** items 1 (codex-1, codex-2, codex-3), 2 (codex-4,
  and a closing statement that no assertion is wholly tautological), 3
  (codex-5), 4 (it found no TypeScript escape hatch reachable by this
  adversary), 6, and 7 (that the framing overstates what the runtime can prove
  about a hostile endpoint's identity and billing) were answered. Item 5
  (configuration satisfied without doing what it appears to) got no separate
  answer; codex-2 touches it.

---

BASE: d039910  
HEAD: bd07193  
pnpm-lock.yaml  
e8e31272f8ea4cad32a76d59985ecbc6

I had no prior project context and performed no external lookups. This is a static review of the supplied inline bundle; I did not run tests or independently verify the file’s SHA-256.

1. **packages/sandbox/src/local/relay.ts:243 — factually wrong — high — Metering trusts the party the threat model makes adversarial.**

   Return a successful completion with `usage: { prompt_tokens: 0, completion_tokens: 0 }` after performing expensive inference. `takeOpenai` accepts these as readable counts. Repeated sandbox requests can therefore consume upstream resources without advancing the token or dollar totals. Reporting all prompt tokens as cached also substitutes the configured cache rate for the input rate.

   There is a second route at **relay.ts:440**: the settlement logic treats an answered request as chargeable only for a 2xx status. An endpoint that performs inference and returns 503 can incur charges while the relay treats the response as free. The driver refuses that task, but sandbox processes can make further relay requests themselves.

   The tests supply cooperative usage figures and check arithmetic against those figures. They do not establish actual expenditure independently.

   **Resolution:** distinguish “usage reported by the endpoint” from enforced actual expenditure. Either trust an authenticated accounting service outside the adversary’s control or reserve a conservative, independently enforceable charge before forwarding. Unknown billing outcomes must not become free calls. Confidence: high.

2. **packages/drivers/openai-compatible/src/driver.ts:354 — factually wrong — high — Matching an attacker-controlled model name does not authenticate model identity.**

   Have model B produce the answer, but return the requested model A’s identifier in `model`. The equality check succeeds, and the result records A with the operator’s configured family. No operator configuration needs to change.

   The identity assertion in **test/invariants.test.ts:170** tests an explicitly different or missing identifier. It establishes mismatch rejection, not that answers came from the declared model or family. Its endpoint normally echoes `request.model`, which demonstrates how easily the check can be satisfied.

   **Resolution:** treat the configured endpoint’s identity mapping as an explicit trust assumption, supported by independently trusted deployment provenance if actual family separation is required. Describe this check as consistency validation. No additional validation of the same untrusted string can prove the stronger property. Confidence: high.

3. **packages/sandbox/src/local/relay.ts:416 — factually wrong — high — The budget is a stop-after-crossing threshold, not a spending ceiling.**

   A sandbox can submit a priced model with a very large positive `max_completion_tokens` and `n`. `openaiCeiling` accepts their product, and `metered` forwards while the relay is not already exhausted. It does not reserve the request’s possible cost against the remaining budget.

   Even with honest usage reporting, one accepted request can exceed the remaining grant substantially. Serialization limits the overshoot to one request; it does not limit that request’s size. Large input prompts add another source of overshoot.

   **packages/conformance/src/registry/local-relay.ts:449** explicitly tests two calls costing $0.002 each under a $0.003 budget and requires both to succeed. Thus the assertion passes while the strict spending property is violated.

   **Resolution:** reserve bounded input and output expenditure before forwarding, enforce request limits against the remaining allowance, and reconcile afterwards. Alternatively, explicitly change the policy contract to allow a bounded overshoot. The bundle documents the current behavior, but it conflicts with the question’s hard spending invariant. Confidence: high.

4. **packages/drivers/openai-compatible/test/invariants.test.ts:36 — factually wrong — medium — The host-isolation assertion does not test its claimed negative property.**

   The test proves that expected writes appear in the mounted workspace, a marker exists inside the container, and recorded provider calls use the expected handle. It never checks that the marker is absent on the host or monitors host-side execution.

   A mutation that preserves the existing sandbox operations and additionally performs a host write would pass these checks. Watching `provider.exec` records calls through that provider; it does not detect additional filesystem or process calls elsewhere.

   **Resolution:** add an independently observed host canary outside the workspace and Vault, plus host filesystem/process instrumentation or an equivalent restriction. Mutation-test an additional host write and host execution path. The current production code shows no such host operation; this finding concerns the assertion’s claimed coverage. Confidence: high.

5. **packages/drivers/openai-compatible/test/invariants.test.ts:110 — factually wrong — low — File-absence checks turn arbitrary read failures into passing evidence.**

   Both forbidden-file checks use `.catch(() => 'absent')`. Permission errors, directory reads, or other I/O failures become indistinguishable from nonexistence. A readable file containing the literal text `absent` also satisfies the assertion.

   Other checks in this test still provide meaningful protection, particularly the expected refusal events and absence of tool execs. This is a defect in the file-absence evidence, not proof that the complete grant test always passes.

   **Resolution:** use `lstat` and accept only `ENOENT`; propagate every other error. Confidence: high.

Several mechanisms are sound within the stated boundary:

- **Tool dispatch:** `driver.ts:390` checks the host-held grant set before invoking `runTool`. Exact string membership prevents prototype names or invented tool names from becoming grants. The test exercises real, otherwise available tools while withholding their grants.
- **Host execution isolation in the shown implementation:** `tools.ts:114` sends operations through the supplied sandbox exec function. Paths are arguments, and Write content is stdin. Shell metacharacters in a filename do not become host shell syntax. This relies on the trusted provider and mount enforcement.
- **Credential placement:** `relay.ts:369` writes the credential into the outbound request; `call.ts:20` contains no credential. The relay uses a fixed TLS upstream and does not follow redirects. The credential test includes positive controls that demonstrate its filesystem and process searches can detect a planted secret.
- **Refusal helpers:** the new `refusalOf` helpers require `DriverRefusal`, rethrow unrelated exceptions, and fail when nothing throws. The shown new suites do not silently skip unavailable Docker or OpenSSL.

I found no attacker-reachable TypeScript cast, declaration-merging, module-augmentation, or generic-erasure bypass in the supplied changes. The family brand is a cast after string validation; it establishes representation, not provenance. Forging a trusted provider or modifying runtime objects would exceed the specified attacker powers.

The framing is appropriate for sandbox confinement and tool authorization, but it overstates what this protocol can prove about a hostile endpoint. Actual model identity and actual billing require a trust anchor outside the endpoint’s own response fields. The review should separate those assumptions from properties the runtime can enforce independently. Also, authorized workspace writes deliberately reach host storage through the mount; the isolation property should concern host execution and writes outside authorized mounts.

No complete new assertion is demonstrably wholly tautological. Several are materially narrower than their descriptions, and no supplied mutation results establish that every claimed property fails when removed.