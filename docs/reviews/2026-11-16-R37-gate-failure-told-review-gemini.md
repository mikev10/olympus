BASE: 1a34231
HEAD: 5ff110d
packages/core/src/station/machine.ts
c04d2f58c61e96e246146db35cb5b9e1

I have evaluated the code against the invariants, with no prior context or lookups performed. The adversarial framing is correct and appropriate for this domain: a builder cannot be trusted to report its own status, and its outputs must be structurally airgapped from the LLM prompt.

### 1. `gateRetry` provides stale feedback when the last verify was an `attempt-failed`
**packages/api/src/line.ts:846** — a tradeoff I would have made differently — **Medium**

**The issue:** 
When the builder is retried, `gateRetry` attempts to tell it why the gate failed by reading the latest decision. It correctly clears the feedback if the last decision was a `task-conflict`, recognizing that the gate never judged the code. However, it completely ignores `attempt-failed` decisions. 

If iteration 1 fails the gate, and iteration 2 fails during `verify` due to a driver or sandbox refusal (e.g., a check's sandbox fails to provision, yielding an `attempt-failed` decision), the task state becomes `'failed'` and it is sent back to `build` for iteration 3. When iteration 3 asks `gateRetry` for feedback, the function skips the `attempt-failed` decision and retrieves the `gate-failed` decision from iteration 1. The builder is falsely told that its iteration 2 code failed the gate with the exact same checks as iteration 1, even though its tree was never judged.

**Resolution:** 
In `gateRetry`, if the latest decision at the `verify` station is `attempt-failed`, the function should return `undefined` (telling nothing), identical to how it handles `task-conflict`.

### 2. `untrustedReason` is typed as a plain string, bypassing I7 compiler protections
**packages/api/src/line.ts:792** — a tradeoff I would have made differently — **Low**

**The issue:** 
The new field `GateFailedCheck.untrustedReason` is typed as a plain `string | null`. While the logic currently successfully prevents it from reaching a prompt (because `gateRetrySuffix` deliberately ignores the field entirely), the lack of the `UntrustedText` or `UntrustedPayload` brand means the I7 type-system and ESLint rules (`i7/no-untrusted-sink`, etc.) will not protect this field if a future change accidentally concatenates it into a string or prompt.

**Resolution:** 
Type `untrustedReason` using the appropriate untrusted envelope type (e.g., `UntrustedText | null`), matching the protection applied to other untrusted inputs in the system.

### 3. Assessment of Mechanisms (Sound)

The primary mechanisms under review are well-constructed and fail closed against the stated threats:

*   **Prompt Injection Protection:** The mechanism in `gateRetrySuffix` is fundamentally sound. By discarding all variable text from the container and restricting the payload strictly to `checkId` (which is drawn from the cryptographically hashed and locked manifest, not the container) and `cause` (a closed enum like `'exit-code'` or `'no-result'`), the code creates a structural airgap. There is no path for the builder to get bytes it controls into its own next prompt through this mechanism.
*   **Status / Event Stream Integrity:** The mechanism in `lastFailureOf` that matches a parked task's `gate-failed` decision to its `unstarted` reasons is sound. It loops through `state.evidenceRefs` in reverse to find the latest evidence. Because `verify` always writes an `EvidenceBundle` synchronously before recording a `gate-failed` decision, and no other branch can write an evidence bundle and later park the task without a masking decision (like `task-conflict`), it will never retrieve mismatched untrusted reasons. The event stream correctly labels the derived outputs as data.