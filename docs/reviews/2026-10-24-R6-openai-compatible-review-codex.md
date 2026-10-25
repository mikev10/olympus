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