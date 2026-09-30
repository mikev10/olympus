BASE: reviewed/P7  
HEAD: 5762bb2  
packages/vault/src/types.ts  
d860616fd001ecc16bc412f629d082de

No prior project context. No external lookups. I reviewed the bundle supplied in the prompt; a local filesystem listing was blocked. I did not run tests or independently verify the file’s SHA-256. Line numbers below are approximate; function names identify the cited constructs.

1. **`packages/api/src/line.ts:520` (`runTask`), `packages/sandbox/src/local/provider.ts:745` (`#dismantle`) — factually wrong — high — Sidecar decisions take effect before their Vault records, with an unrecoverable interruption window.**

   Make a permitted connection, receive a proxy refusal, or trigger a relay refusal, then stop the runtime before `sandbox.destroy()` returns and `recordEgress()`/`recordDecision()` finishes. The action already happened; its decision is absent from the Vault.

   There is an especially clear window after `#dismantle()` reads the logs and removes the sidecars: the only remaining copy awaiting recording is in process memory. Stopping there loses both the Vault entry and its source. Sandbox ownership is held in an in-memory map, and the supplied resume path does not recover these pending logs.

   Throwing when collection fails prevents subsequent progress; it cannot undo an already opened connection or delivered refusal. The conformance scenarios collect normally and do not exercise this window.

   **Resolve:** For eventual recording, persist a recoverable, run/task/station-bound outbox before removing the source logs, and acknowledge collection only after Vault persistence. For the literal “in the Vault before taking effect” requirement, the sidecar needs a synchronous runtime recording acknowledgment before acting. An after-stop collector cannot provide that guarantee.

2. **`packages/api/src/line.ts:365` (`startAttempt`, `spendRetry`), `packages/api/src/line.ts:800` (`verify`) — factually wrong — high — Parks are committed before their enforcement decisions.**

   Exhaust retries or iterations. Both retry/start exhaustion paths commit `tasks[task.id] = 'parked'` before returning the refusal to `runLine()`. Verification likewise commits a parked status before a later loop iteration records the refusal.

   Stop immediately after that commit. The authoritative state already parks the task, but no park decision exists. A decision-store failure at the subsequent write produces the same state. A later resume may record another refusal, but it does not make the original operation record-before-effect.

   `recordViolation()` has a related window: it persists the violation before writing the `violation-recorded` decision. A stop between those writes leaves a recorded finding absent from the enforcement log.

   **Resolve:** Write the park decision before committing the parked state, and bind the state change to that decision. Make violation persistence and its decision atomic, or recoverably linked. Test interruption immediately after each durable write; assert the record exists whenever the protected state exists.

3. **`packages/sandbox/src/local/proxy.ts:146`, `packages/sandbox/src/local/proxy.ts:219` — factually wrong — high — Malformed requests receive unrecorded refusals, and the closing count certifies the omission.**

   Send:

   ```http
   GET / HTTP/1.1
   Host: example.com
   Connection: close
   ```

   The absolute-form check returns 400 without calling `record()`. A malformed HTTP request reaching `clientError` also receives an unlogged 400.

   After shutdown, a proxy that handled only these requests writes `connections: 0`; `egressLogFrom()` accepts the empty account. Its count measures calls to `record()`, so it cannot detect refusal branches that never call it.

   The table’s refused-egress row supplies a synthetic, already logged refusal. The real proxy test exercises a disallowed host, not these branches.

   **Resolve:** Record protocol and target-validation refusals before responding, with a null host where necessary. Add raw-request tests that assert both the response and the collected decision.

4. **`packages/api/src/run.ts:400` (`admissionRefusalOf`, `admission`), `packages/api/src/validate.ts:105` (`requestProblems`), `packages/vault/src/local/vault.ts:250` (`decisionProblem`) — factually wrong — medium — An unchecked numeric field carries arbitrary caller text into a decision.**

   Submit an otherwise valid L1 request with:

   ```json
   { "approvedCostUsd": { "text": "caller-chosen payload" } }
   ```

   The shown request validator never checks this field. Strict inequality against `worstCase.usd` produces `cost-unapproved`; `admissionRefusalOf()` copies the object into the decision. The Vault validates the envelope and cause/decider pairing, but not this payload, and stores it.

   No hostile runtime component is necessary. JavaScript or JSON input bypasses the TypeScript annotation. The table tests `approvedCostUsd: 0`, so this malformed record remains uncovered.

   **Resolve:** Validate the field as an allowed finite numeric value or null. Reject malformed values through the path/code-only invalid-request representation, and validate each decision payload at the Vault boundary.

5. **`packages/api/src/decisions.ts:25`, `packages/vault/src/local/vault.ts:355` (`storeObject`) — factually wrong — medium — Distinct decisions can collapse into one content-addressed entry.**

   Send concurrent identical invalid approval requests for the same run. Those recorded in the same millisecond have identical run, task, station, time, cause, key and reason. They therefore have identical serialized bytes and the same hash.

   `storeObject()` treats the second exclusive-create collision as success. Both refusals can return, while `readDecisions()` exposes one entry. This is loss during insertion, separate from the explicitly deferred problem of detecting deleted entries.

   **Resolve:** Give each decision occurrence a unique runtime-generated identifier. Preserve that identifier across retries of the same occurrence. Add a concurrent-request test comparing completed decisions with distinct stored occurrences.

   **Confidence:** High in the collision mechanism; reproducing it over HTTP depends on requests reaching recording within the same millisecond.

6. **`packages/conformance/src/registry/decisions.ts:100` (`expectDecision`), `:484` (`violation-recorded`), `:590` (`failsClosed`) — factually wrong — medium — The table proves selected examples, not every write site or write-before-effect ordering.**

   A concrete surviving mutation is to replace the claim-mismatch branch’s `recordViolation(ctx, ...)` with `ctx.components.vault.recordViolation(...)`. The violation still exists, satisfying the supplied older verification assertion, but its enforcement decision disappears. The table’s sole violation scenario is a capability escape, so it does not detect that omission.

   Likewise, the egress rows manufacture `PROXIED` records through `reportingProvider()`. They test collection into the Vault, not whether every real proxy refusal generates a record.

   `failsClosed()` also accepts **any** exception from its line scenario. It does not establish that the decision write was attempted or that protected state remained unchanged. An unrelated exception before recording satisfies that individual check. These checks are not universally tautological, but they can pass without establishing the property named.

   **Resolve:** Cover distinct producer paths and interruption boundaries, assert expected write attempts and unchanged protected state on failure, and mutation-test removal of individual writes. Keep producer tests separate from collector tests and explicitly connect their coverage.

7. **`packages/conformance/src/registry/decisions.ts:524` (`stationRefusalReasons`) — factually wrong — medium — The “unconstructed” assertion recognizes syntax, not all constructions of the refusal type.**

   Its scanner requires an unquoted property named `reason` and a direct string-literal initializer. A correctly typed construction using either of these forms escapes detection:

   ```ts
   reason: ('gate-failed' as const)
   ```

   ```ts
   'reason': 'gate-failed'
   ```

   The first fails `isStringLiteral(initializer)`; the second fails `name.getText(sf) === 'reason'`. Existing positive controls still find other refusals, so the scan passes while the marked arm is now constructed.

   This is a conformance escape available to a routine code change, not an ability the sandbox attacker has to modify runtime code.

   **Resolve:** Use a constrained, exhaustively checked construction mechanism or behavioral reachability assertions. If retaining the scanner, reject unsupported construction forms and test its handling of quoted/computed keys, aliases, assertions, spreads and generic helpers.

8. **`packages/sandbox/src/local/proxy.ts:158`, `packages/sandbox/src/local/proxy.ts:194` — unclear — medium — “Opened” and “tunnelled” are recorded before either operation succeeds.**

   Request an allowlisted host on a closed port. The proxy records `opened` or `tunnelled`, then the connection fails and the client receives 502. The supplied type documentation describes requests forwarded and tunnels joined; the implementation records permission to attempt those operations.

   **Resolve:** Define these verdicts as authorization decisions and name them accordingly, or record connection establishment/failure separately. Test an allowlisted but unreachable destination.

   **Confidence:** High in the execution ordering; whether this is a false record depends on the intended verdict semantics.

9. **`packages/api/src/line.ts:760` (`verify`, claim-mismatch branch), `packages/vault/src/types.ts:166` (`EnforcementDecision`) — unclear — low — The framing prohibits an input the implementation deliberately uses.**

   A model can claim it changed a file that the runtime’s diff does not contain. `claimEvidenceDiff(result.claim, own)` then causes a claim-mismatch violation and a `violation-recorded` decision. Changing only the model’s claim changes whether that decision exists.

   Thus “nothing a model returned is an input to a recorded decision” is false literally, even though this branch deliberately avoids changing task status.

   **Resolve:** Distinguish model-supplied authority from runtime evaluation of untrusted evidence. A useful invariant is that model assertions cannot directly establish success or grant authority; runtime checks may still record that those assertions are false.

The mechanisms I assess as sound within their stated boundaries are:

- Ordinary admission/station refusal returns and approval commits await their decision write. A rejected write propagates before those particular effects.
- JSON serialization prevents host text from injecting another prefixed log line. Agent stdout is not the stream `readEgress()` reads.
- The parser rejects malformed prefixed records, missing closing records, count mismatches and decisions after closure. This establishes consistency of emitted records, not coverage of every decision branch.
- The local Vault enforces the collector literal and top-level cause/decider pairing. Those checks are useful validation, although neither authenticates a caller by itself.
- The closed `DecisionCause` union and mapped table require ordinary typed additions to acquire rows. They do not establish that those rows exercise every implementation path.

The adversarial framing is appropriate, especially because process-stop timing is explicitly controlled. It should ask separately whether a decision is **durably recorded before its effect**, **recoverably collected afterward**, and **faithfully attributed**. Those are different guarantees here.

Finally, caller-chosen text is not inherently a failure: hosts, approval principals and identifiers intentionally contain it. I found no shown path from the new decision log into a prompt. The relevant questions are whether such text occupies validated data fields, falsely claims authority, or later becomes instructions.