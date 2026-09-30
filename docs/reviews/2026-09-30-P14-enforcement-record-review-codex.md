# External review of P14, codex, 2026-09-30

An adversarial pre-merge review of P14 (the enforcement record): the runtime's
single write path for decisions and its call sites in `run.ts` and `line.ts`,
the egress proxy's decision log and its read at teardown, the Vault's
acceptance rule for a decision, and the conformance table keyed by every cause.
One of two reviews run from the same prompt and bundle; the other is
`2026-09-30-P14-enforcement-record-review-gemini.md`. Both are triaged in
`2026-09-30-P14-enforcement-record-triage.md`, which cites this review's
findings as `codex-1` to `codex-9`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`: `configHome` `["auth.json"]`, `workDir` `[]`. Exit 0, not timed
  out, 215.7 s. Ingestion `complete`: 154,526 input tokens against a floor of
  113,126. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `8a08ae0fd6cc686138869ea832d395907e804afcc8481b2b31a35b7c23b6e5e6`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex-3 (the proxy's 400 refusals are not
  logged) was raised by gemini too, as gemini-1. codex-1 (egress verdicts lost
  between the proxy acting and the Vault holding the record) pairs with
  gemini-2, which describes the same mechanism from a failed log read rather
  than an interrupted process. codex-2, codex-4 to codex-9 were raised by codex
  alone.
- **Date:** 2026-09-30 (run started 2026-09-30T20:40Z).
- **Bundle:** `2026-09-30-P14-enforcement-record-review-bundle.txt`, SHA-256
  `dcb8b51f87c93a0cc6e209fe2ac9f69c99ea1ff255a84fd4ebf4403e76fa6596`, base
  `329c049` (`reviewed/P7`), head `5762bb2` (the last P14 implementation
  commit). It held the full contents of every changed source, test, registry,
  and skill file, `CLAUDE.md`, and the changeset; the changed docs
  (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`, `docs/plan/F1-spine.md`,
  `docs/plan/WORKFLOW.md`, `docs/plan/WORKFLOW-DIAGRAM.md`) were listed in the
  diffstat and excluded. Prompt:
  `2026-09-30-P14-enforcement-record-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated "No prior project context.
  No external lookups", that a local filesystem listing was blocked, and that it
  ran no tests, so its findings are from source, not reproduced. A self-report,
  not independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Items 1
  and 3 are answered by codex-1 to codex-5 and codex-8, item 2 by codex-6 and
  codex-7, item 4 in part by codex-4 (a JSON value bypassing a TypeScript
  annotation) and codex-7 (`as const` and quoted keys escaping a source scan),
  item 6 in the closing list, and item 7 by codex-9 and the closing paragraphs,
  which propose separating "durably recorded before its effect", "recoverably
  collected afterward", and "faithfully attributed". Item 5 (configuration
  satisfied without doing what it appears to) was not addressed.
- **Citations:** line numbers refer to positions in the reviewed source files
  as the bundle carried them, not to the repository at any later commit. They
  are hints; the triage located each construct by name.

---

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