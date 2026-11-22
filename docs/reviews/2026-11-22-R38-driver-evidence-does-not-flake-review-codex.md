BASE: reviewed/R52
HEAD: 8314a7d
packages/sandbox/src/local/relay.ts
bfae41adad626471aee7e20984d84e6c

No prior project context. I reviewed the supplied text and looked up official OpenAI documentation to verify upstream billing semantics; I did not search for the project or author. I did not execute tests.

1. **packages/sandbox/src/local/relay.ts:538 — factually wrong — high — Omitting `service_tier` bypasses the explicit refusal of `auto`.**

   Construction: send an otherwise valid, priced request with a positive output ceiling and omit `service_tier`. The guard accepts it and forwards the original body. OpenAI resolves omission through the project’s configured tier, just as it does `auto`; omission does not force `default`. With a project default of priority and a default-rate price table, the relay undercounts dollars despite counting tokens correctly. The requester need not control project settings—only encounter that configuration. [Official service-tier settings](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects/subresources/service_tier_settings/methods/retrieve)

   **Resolution:** require explicit `service_tier: 'default'`, or normalize omission to that value before forwarding. Test an upstream that resolves omitted tiers to priority. **Confidence: high; deployment exposure depends on project configuration.**

2. **packages/sandbox/src/local/relay.ts:539 — unclear — medium — Absence of `web_search_options` does not establish absence of billed search.**

   Construction, conditional on the permitted price table: select a Chat Completions search model, supply an output ceiling and `service_tier: 'default'`, and omit `web_search_options`. This guard accepts it. OpenAI documents that Chat Completions search models always search before responding; the options field is not the sole switch enabling search. A token-price entry alone therefore cannot establish that the model has no additional search charge. [Official web-search documentation](https://developers.openai.com/api/docs/guides/tools-web-search)

   **Resolution:** prohibit search-performing models in this dialect unless their additional charges are accounted for. Check the price-table validation and permitted models, which are not shown, to determine whether this construction is currently reachable. **Confidence: high in the guard’s limitation; uncertain about reachable configurations.**

3. **packages/drivers/claude-code/test/invariants.test.ts:261 — unclear — medium — The assertion’s evidence does not cover instructions loaded during tool use.**

   The two executions grant either no tools or only `Skill`, and the recorder always returns text ending the turn. Consequently, the comparison never exercises a file read, skill invocation, or later request following a tool result.

   A concrete regression this test cannot distinguish is a CLI that suppresses startup instruction discovery but loads a nested `CLAUDE.md` or path-scoped rule when `Read` accesses a matching file. Plant that instruction and have the model request the matching read in a real task: the later session could receive it while this assertion still passes. This is a coverage construction, **not evidence that the pinned CLI currently behaves that way**.

   **Resolution:** add a scripted recording response that triggers relevant granted tools and compare subsequent requests, with controls proving that the delayed-loading plants activate when isolation is removed. Alternatively, narrow the registered claim to startup discovery for the exercised grants. **Confidence: high about the coverage gap; actual CLI behavior requires checking.**

The following mechanisms look sound within their demonstrated scope:

- **relay.ts:616:** the unmeterable-request check precedes `send()`. Explicit nondefault tiers, non-null search options, audio output, nontext modalities, and recognized audio-input parts are refused before forwarding.
- **claims.test.ts:51:** requiring attributed requests, then checking every captured system prompt for the child’s instructions and against the parent’s instructions, is meaningful evidence. Removing role injection would fail it; a model cannot manufacture a passing answer.
- **invariants.test.ts:269, 288, 315:** nonempty capture, exact body comparison, and the positive control prevent empty-versus-empty equality and an insensitive recorder from establishing the claim. Registry and test titles match in the supplied changes.

I found no demonstrated tautological assertion, skip-to-pass path, or exploitable TypeScript cast under the stated trust boundary. The casts do not themselves validate JSON, but the relevant session fields receive runtime checks. Supplying a malicious provider through a type escape would require control explicitly excluded here.

The adversarial framing fits relay request validation. For the assertions, the sharper question is which **driver regressions and instruction-loading paths** they detect. `driver.subagents` proves role-text placement and parent-role exclusion for its fixture; it does not prove exclusive semantic influence or model obedience. No concrete way to forge that fixture’s passing evidence under the stated trusted-component assumptions is established by this bundle.