BASE: 7fcb611  
HEAD: 6de39c9  
pnpm-lock.yaml  
4faa137b43a3990ab5d81a669995a2ad

Prior context: none. External lookups: none. I reviewed the inline bundle. Local shell access was blocked, so I did not run tests or verify the supplied file’s SHA-256.

1. **packages/api/src/cost.ts:109 — factually wrong — high — A hard stop can erase a paid call from accounting and allow its replay.**

   Construction: let a real build call incur cost, then kill the runtime before `runTask` persists its usage. This includes the interval after `sandbox.destroy(handle)` returns but before `recordUsage` writes anything. The committed task remains `running`, with its start counted, but there is neither a usage record nor a `lost` record.

   On restart, `lostReadings` searches only existing usage records. It finds nothing for this invocation, and `nextStep` replays the running task. The eventual totals omit the first call and can still report `bound: 'exact'`. Immediately after the first interruption, an empty usage list even produces exact zero.

   Listing orphan records closes **write-before-state-commit**, but cannot close **call-before-write**. The teardown catch also cannot execute after a hard process stop. Recording egress before usage introduces another failure window.

   **Resolution:** durably identify each pending invocation before permitting spending. Reconcile every pending invocation with a durable terminal meter reading on resume; unresolved invocations must block replay and make totals incomplete. Test process termination before usage persistence, not only after `recordUsage`. **Confidence: high.**

2. **packages/drivers/claude-code/src/driver.ts:142; packages/drivers/claude-code/src/driver.ts:120 — factually wrong — medium — The recorded model is a requested alias, not a runtime measurement of the model used.**

   A normal fast-tier run already demonstrates the mismatch: `resolveModel` returns `haiku`; the driver passes that alias to the CLI, which resolves the concrete model. The line stores its earlier identity in `UsageRecord.model`. Its `version` is the CLI version, so it does not disambiguate the model either.

   More seriously, the resolved identity is not supplied as a constraint to the relay. Every tier receives the same relay configuration and the whole price table. With a policy-granted command tool, a task can attempt a direct request to the relay naming another priced model. Nothing in the shown composition binds that request to the runtime’s selected model; the sandbox’s aggregate usage would still receive the original alias.

   The alias defect is definite. Whether the direct alternate-model request succeeds requires inspection of the relay implementation, which is absent from this bundle; I am not claiming a demonstrated dollar undercharge through that route.

   The paid test’s comparison against `components.driver.resolveModel(TIER)` checks that the same selection was copied. It does not independently establish which model served the requests.

   **Resolution:** resolve a concrete model before provisioning, enforce it at the relay, and record model identity from trusted relay observations. If multiple models are intentionally allowed, record usage separately for each. Add an alternate-model request test. **Confidence: high for alias-only accounting; medium for the direct-request construction.**

The following mechanisms look sound within the shown boundaries:

- **Graph provenance:** the frozen graph and private `WeakMap` prevent a spread copy or `as BuiltGraph` cast from acquiring provenance. Ordinary delegating wrappers that omit `unsafe` remain unattested. Admission and resume both consult that record.
- **Persisted lost readings:** once a `lost` record exists, orphan discovery ensures that losing its run-state reference does not permit resume. Totals correctly preserve the lower-bound designation.
- **Missing-framework disclosure:** a recorded unavailable `test` control becomes an explicit integrate escalation, carried through both the refusal and standing. Missing or malformed control lists throw.
- **Locked artifacts:** the shown line compares admission hashes, checks task diffs and materialized artifacts, and rechecks locks at transitions. The model’s narrative does not determine the build verdict.

On language escape hatches, TypeScript brands, `readonly`, and excess-property checks alone are not security boundaries. Casts, `any`, and declaration merging can defeat compile-time claims; they cannot create the private graph provenance entry. Likewise, arbitrary prototype or Proxy manipulation by hostile runtime code would exceed your threat model. A transparent Proxy around a class using `#private` fields can also pass `instanceof` yet fail when a method executes; the graph test proves classification, not operational transparency.

I found no whole new test that passes regardless of all implementation behavior. The model-identity assertion above is circular for the stronger property, however. The explicit missing-credential failure in the paid suite is preferable to a skipped success.

The adversarial framing is appropriate, especially its inclusion of process-stop timing. The key additional question is: **what durable evidence proves that every potentially billable invocation has been accounted for?** This change establishes how to handle a recorded unknown cost, but not how to discover a call whose accounting record never existed. I cannot certify Vault isolation or relay price correctness from the composition and tests alone: their enforcing implementations are not included here.