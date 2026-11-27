BASE: reviewed/R58
HEAD: 061f9f3
packages/sandbox/test/upstream.ts
111f3c77d9c6e1eee9b2b75e9cb83561

I had no prior project context and performed no lookups. This is a static review of the supplied text; I did not run tests.

1. **packages/sandbox/src/local/relay.ts:360 — factually wrong — medium — An absent or null tier is silently treated as priceable.**  
   `tierOpenai` leaves `offTier` false for both `undefined` and `null`. A Responses answer containing valid token usage but no `service_tier`, or `"service_tier": null`, therefore passes this check. The same applies inside `response.completed`. Nothing here establishes that the answer used the default rate.

   This is a concrete validation gap, not a demonstrated exploit against a particular upstream: the task cannot directly author upstream metadata. It becomes an underpricing path if an upstream omits tier metadata while serving a different rate. **Resolve by** refusing further forwarding when the final tier is missing or null, or explicitly limiting this exception to a trusted endpoint configuration that guarantees default pricing. Add whole-body and streaming cases for both values. Confidence: high about acceptance; upstream exploitability is unestablished.

2. **packages/sandbox/src/local/relay.ts:389–390 — unclear — medium — Missing output usage is deliberately estimated, contrary to the stated invariant.**  
   `takeResponses` accepts readable input without readable output. The supplied Responses tests explicitly require the relay to charge a ceiling and continue forwarding after such answers. Thus a successful answer with `usage: { input_tokens: 1000 }` passes the implemented policy without its actual output usage being known.

   This is not evidence that the ceiling necessarily underprices the answer. It is evidence that the implementation and tests enforce a different contract from “missing or unreadable usage … must stop the spending” and “never estimated.” **Resolve by** marking incomplete usage unreadable and refusing subsequent requests, or revising the stated invariant to explicitly permit conservative ceiling accounting. Confidence: high about the mismatch.

The following mechanisms look sound within the supplied code and trust boundary:

- The search-model expression catches the specified suffixes and optional dates at both provisioning and relay startup. Tests exercise both checks with otherwise valid configurations. It is a naming restriction, however, not proof that every accepted model is token-only.
- Responses tier inspection reaches both whole bodies and `response.completed`. Unexpected non-null values mark the answer off-tier; the supplied tests exercise subsequent refusal for whole and streamed answers.
- `relayCreateArgs` removes the source from arguments and preserves read-only root, dropped capabilities, and absence of mounts. `startRelay` supplies runtime-owned source through stdin. Task-controlled workspace files have no demonstrated route into that delivery.
- Delivery failures, unsuccessful readiness, and empty container IDs lead to failure and cleanup attempts. The shown lifecycle code does not convert these errors into successful provisioning.
- The Windows quoting calculation handles quotes, spaces, and trailing backslashes, and counts UTF-16 code units through JavaScript string length. Its strict `< 32767` assertion leaves room for the terminator. The synthetic oversized-table and source-in-argument checks are meaningful, not tautologies.

I found no demonstrated language-level escape through casts, declaration merging, or type predicates in the shown changes. Runtime meter validation prevents a TypeScript assertion alone from bypassing its checks. Nor did I find a shown skipped-test or exception path that establishes a false pass.

The framing is appropriate, but the bundle does not include the relay’s request admission, model lookup, or final accounting functions. Consequently, I cannot establish whether an attacker-controlled model value bypasses the checked table, whether concurrent requests escape serialization, or exactly how an off-tier answer affects recorded dollars. Those require inspecting the actual omitted functions; comments describing them are insufficient evidence. The two findings above also expose a framing conflict: the stated invariant demands stricter treatment of unknown billing information than the implementation’s intentional compatibility and ceiling-accounting rules.