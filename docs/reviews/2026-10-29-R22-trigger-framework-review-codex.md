Prior context: none. External lookups: none. I reviewed the bundle embedded in the prompt. Local command execution was blocked, so I did not run the project’s tests or verify the file’s SHA-256.

BASE: reviewed/R21  
HEAD: ed7a140  
pnpm-lock.yaml  
f76ca1d77868e92c262cdc0ab5fe852a

I found enforcement and conformance gaps below, but no demonstrated path in the shown implementation by which an unauthenticated sender directly starts a run or places delivery text into a model request.

1. **`packages/conformance/lint/untrusted-sink.js:17` — factually wrong — medium — wrapping a payload defeats the sink rule.**

   `isUntrusted` recognizes named types and union/intersection members, but does not follow properties or array elements. For example:

   ```ts
   const box = { raw: payload.raw };
   const widened: { raw: unknown } = box;
   const bytes = widened.raw as Uint8Array;
   const text = new TextDecoder().decode(bytes);
   ```

   The first initializer preserves the raw type. The second widens a property through assignment of an ordinary object, which `isUntrusted` does not recognize. The final cast starts from `unknown`, rather than `UntrustedText`. Likewise, `JSON.stringify(box)` escapes the direct-argument check.

   This defeats the claimed combination of sink checking and scanning casts from untrusted types. The supplied fixtures exercise direct values, not this construction.

   **Resolution:** add container-widening and serialization fixtures, and track nested untrusted values or restrict their movement through a much smaller audited interface. Include generic erasure and type-predicate narrowing in those tests. Confidence is high from inspection; confirm the complete construction against the actual lint and cast-scan implementations.

2. **`packages/api/src/intake.ts:130` — factually wrong — medium — stored payload bytes lose their untrusted type entirely.**

   The candidate stores the original delivery as an ordinary `base64: string`. Any runtime consumer can recover arbitrary issue text with:

   ```ts
   const text = Buffer.from(candidate.body.base64, 'base64').toString('utf8');
   ```

   No `UntrustedText` cast, widening, or coercion occurs. The sink rule therefore cannot protect this representation. This is a second escape route independent of finding 1.

   The shown admission path does not perform that decoding, so this is **an enforcement gap, not an existing delivery-to-prompt exploit**. It matters to the requested conformance question: a future consumer can introduce such a flow without violating the advertised static boundary.

   The payload-isolation assertion also observes only the builder driver: `admitWith` constructs a separate reviewer, but returns only `driver` for inspection. A regression forwarding decoded payload text exclusively to the reviewer would evade that assertion.

   **Resolution:** preserve an opaque type for stored payload bytes, audit decoding independently of representation, and inspect requests to every driver seat. Add a mutation that sends decoded body text only to the reviewer and require conformance to fail.

3. **`packages/api/src/run.ts:846` — factually wrong — medium — expiration and admission are separate, conflicting decisions.**

   Candidate expiry is checked before role loading, rubric loading, workspace snapshotting, and other asynchronous work. The eventual `markCandidateAdmitted` checks existence and exclusive admission, but not expiration.

   A concrete interleaving is:

   - Admission A reads an unexpired candidate, then spends time snapshotting.
   - The expiry deadline passes.
   - Admission B reads the candidate, records it as expired, and refuses.
   - A creates the admission mark and proceeds.

   The candidate can therefore be both expired and admitted. No malicious Vault or token holder is required; overlapping legitimate requests suffice. Workspace size can influence the interval. The sequential “already admitted” and “already expired” tests do not cover this case.

   **Resolution:** make expiry and consumption mutually exclusive at the authoritative claim operation, checking the runtime clock there. Test the interleaving with a barrier before the claim. Confidence: high.

4. **`packages/api/src/schedule.ts:77` — factually wrong — medium — a schedule reload changes the record but not the firing time.**

   Timers retain the original `schedule`. At firing, the callback finds the latest schedule by ID and passes it to `intake.fire`, without checking whether its current time is due. It then rearms the original schedule at line 85.

   Start with `nightly` at `02:00`, then change policy to `18:00` before the timer fires. At `02:00`, the service records a candidate under the updated policy anyway, and continues scheduling at `02:00`. Newly added schedules also receive no timer because the schedule list is captured only at startup.

   Separately, a timer delayed by host suspension fires using its old planned date without distinguishing a missed firing from an on-time firing. The restart-recovery test does not exercise timer execution or policy changes.

   **Resolution:** reconcile timers with current policy, verify that each firing is currently due, and explicitly classify late firings. Test changed times, added schedules, and delayed callbacks. Confidence: high.

5. **`packages/core/src/policy/validation.ts:423` — factually wrong — low — `entryStation` validates as configuration but does not determine behavior.**

   A non-human trigger must declare an `entryStation`, and any valid station ID satisfies that requirement. But intake always creates a candidate, and admission constructs the run at `intake`; neither applies the configured station.

   Thus `entryStation: { issue: 'integrate' }` can satisfy the relational validator while behaving identically to `'intake'`. The conformance assertion proves the key exists, not that its value has meaning.

   **Resolution:** for this unit, reject unsupported entry stations and require `'intake'`. Implementing arbitrary station entry would exceed the stated scope. Confidence: high.

The following mechanisms look sound within the stated trust boundary:

- **Signature verification:** `packages/triggers/src/webhook.ts:24` rejects missing signatures and empty secrets, validates the digest shape, and compares fixed-length HMACs with `timingSafeEqual`.
- **Delivery ordering:** the HTTP route resolves the subscription before buffering the body; intake verifies before extracting and checks the stored digest before parsing. Replay protection is explicitly scoped to the subscription.
- **Single-service budgeting:** `Intake` serializes delivery and schedule work through the same queue. That protects the read-budget/write-candidate sequence within one instance. It does not establish a store-wide budget across multiple host processes.
- **Trigger admission:** `packages/core/src/trigger/admission.ts:47` checks enabled kinds, missing caps, trust floors, depth, and seated-role grants, and refuses over-cap autonomy instead of clamping it.
- **Current prompt separation:** admission takes trigger metadata from the candidate and intent from the authenticated principal. The shown code does not turn extracted fields or the body into instructions.
- **Once-only consumption:** the exclusive admission mark prevents two successful claims of the same candidate, assuming the exclusive-create helper behaves as specified. The expiry race is a separate property.

I did **not** identify an entire new R22 assertion that is tautological regardless of its implementation. Missing adversarial cases are weaker evidence, not tautologies. Nor do the shown trigger assertions generally turn thrown exceptions into passes: the failed-write test requires a subsequent successful retry. However, it injects failure *before* the filesystem write, so it does not prove recovery from a partially completed real write. The shared test helpers and exclusive-create implementation are not shown sufficiently to certify their failure behavior.

The framing is useful, with one qualification: separate **reachable attacks against this runtime** from **runtime changes that its conformance suite would fail to catch**. The lint escapes belong to the latter category; workspace code cannot invoke host functions merely by importing their types.

Also, bounded character classes do not establish that text cannot convey instructions. A branch such as `refs/heads/ignore-previous-instructions` passes the shown schema. What currently protects the model is the absence of a delivery-to-prompt path, not the absence of spaces. The stronger review question is which values actually reach each model seat, through every representation, and whether a test fails when that boundary is deliberately crossed.