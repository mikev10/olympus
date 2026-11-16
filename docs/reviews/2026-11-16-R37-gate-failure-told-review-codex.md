BASE: 1a34231  
HEAD: 5ff110d  
packages/core/src/station/machine.ts  
c04d2f58c61e96e246146db35cb5b9e1

I have no prior project context and performed no lookups. This is a source-only review of the supplied bundle; I did not run tests.

1. **packages/api/src/run.ts:1937; packages/api/src/line.ts:827 — factually wrong — medium — Wall-clock timestamps do not reliably identify the latest decision.** Both readers select the greatest `decidedAt`, breaking ties using enumeration order. The supplied code explicitly describes Vault decision enumeration as hash order, not recording order (`packages/conformance/src/registry/decisions.ts`, conflict-park scenario).

   Construction: record failure A, then failure B after the host clock moves backward. Both status and retry select A. Equal timestamps also select whichever hash enumerates last. For retry, a failed gate followed by a conflict with the same timestamp can incorrectly preserve the old gate feedback—or the reverse can suppress new feedback. No malicious Vault or runtime code is needed.

   **Resolution:** persist a monotonic decision sequence or explicit state references identifying the relevant decision. Test equal timestamps and backward clock movement with differently ordered records. Confidence: high in the ordering defect; ordinary equal-millisecond occurrence depends on execution timing.

2. **packages/conformance/src/registry/gate-retry.ts:99–111 — factually wrong — medium — The event assertion passes with HTTP gate events completely removed.** The test invokes `admission.admitted.drive` with its own `onGateFailed` callback and checks the collected callback arguments. Delete the new `onGateFailed` handler from `createApiServer`: this assertion still passes, but an attached SSE client receives no `gate-failed` events.

   This is not a wholly tautological test: removing the line’s hook invocation does fail it. Its coverage stops before the server capability it purports to protect.

   **Resolution:** add an HTTP-level assertion that attaches an SSE subscriber before releasing a controlled failing check, then verifies the received event names, counts, and payloads. Deleting the server publication must fail that assertion. Confidence: high.

The central injection boundary appears sound under the stated threat model. `gateRetrySuffix` explicitly projects only `checkId` and `cause`; extra properties cannot leak through structural typing. Its caller reads runtime decisions, while verification constructs check IDs from the pinned specs. Check output, filenames, and startup-error text have no demonstrated route into this suffix. A builder can influence which checks fail, but that is the intended feedback channel.

`gateFailure` also preserves the decision’s cause: matching unstarted evidence only supplies `untrustedReason` for `no-result`. The SSE writer JSON-encodes payloads, so embedded newlines in an error cannot create another SSE event. Rendering safety beyond that transport is not shown.

Neither new assertion is inherently tautological. Removing retry suffix delivery should fail the first; removing status enrichment or the line hook should fail the second. However, the first exercises only one `exit-code` failure, and the second never checks that its startup-error marker stays out of subsequent prompts. They do not establish every cause, cross-process replay, or latest-failure ordering.

I found no concrete new fail-open gate acceptance or TypeScript escape available to the builder in the shown changes. The `as EnforcementDecision` casts are not runtime validation, but exploiting them would require crossing the explicitly trusted records/runtime boundary; calling them an attacker bypass here would misstate the threat model.

The adversarial framing is appropriate for tracing data provenance, but the strongest demonstrated problems are ordering and observability. I would additionally ask: **Does every consumer identify the same recorded failure, in execution order, and does an executable assertion cover its actual delivery boundary?**