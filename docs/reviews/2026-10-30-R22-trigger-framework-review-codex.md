# External review of R22, codex, 2026-10-30

The Codex family's adversarial review of R22, the trigger framework: the
webhook delivery path, the GitHub extractor and field schemas, admission from
a candidate, the daily schedule, and the sink lint rule. The triage is in
`2026-10-30-R22-trigger-framework-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under
  a read-only sandbox with recorded approval policy `never`. It ran in an
  empty scratch working directory, with a scratch config home holding only
  `auth.json` and an environment of `CODEX_HOME` alone. The manifest's
  `cleanRoom` holds the pre-run listing of both.
- **Cross-family agreement:** codex-1 was raised by Gemini too (gemini-1).
  codex-2 to codex-7 were raised by Codex alone.
- **Date:** 2026-10-30
- **Bundle:** `2026-10-30-R22-trigger-framework-review-bundle.txt`, SHA-256 `a5f725b70b458b7ef63a28b7242ed07ecb1c7493d552dfc5c101a365e5dd3d4d`, base `reviewed/R21`, head `d71b5fb` (R22's tip after the first review attempt's outputs were committed; those outputs are excluded). It holds every file new since the base in full and every modified file as a function-context diff. Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` (D-TOOLING-10). Prompt: `2026-10-30-R22-trigger-framework-review-prompt.txt`.
- **Prior context and lookups:** the reviewer reported no prior context and
  no external lookups. It also reported one local file-listing attempt, which
  the sandbox blocked. This is a self-report and cannot be verified
  independently.
- **Coverage, and any gap:** items 1, 4, 6, and 7 are answered directly.
  Items 2 and 3 are answered in one closing sentence: no wholly tautological
  assertion and no exception-to-pass path were found. Item 5 is folded into
  codex-5.
- **Citations:** line numbers refer to positions in the bundle's files, not the repository. They are hints, and each finding was located by its construct.

---

BASE: reviewed/R21  
HEAD: d71b5fb  
packages/vault/src/types.ts  
1898c5917cb053634fc65e6f613d7bbb

I had no prior project context and performed no external lookups. I reviewed the complete inline bundle. A local file-listing attempt was blocked; no tests were executed or SHA-256 verification performed. References below use new-side source lines.

1. **packages/conformance/lint/untrusted-sink.js:17 — factually wrong — high — wrapping defeats the claimed serialization boundary.**

   This passes the rule’s relevant checks:

   ```ts
   const wrapped = { payload };
   const text = JSON.stringify(wrapped);
   ```

   `wrapped` is neither named `UntrustedPayload` nor `UntrustedText`. Its inferred property retains the original type, so initializing it does not trigger the opaque-slot check either. Serialization nevertheless traverses the envelope and its raw bytes. No cast, explicit `any`, or string coercion is necessary.

   Generic erasure provides another construction:

   ```ts
   function erase<T>(value: T): unknown {
     return value;
   }
   const text = JSON.stringify(erase(payload));
   ```

   The return expression is typed `T`; the argument’s contextual type preserves the inferred payload type. Neither matches the rule’s widening condition.

   The existing lint fixture exercises direct values, so these constructions need not break conformance. **Resolve:** add nested-container and generic-erasure fixtures and track untrusted contents across these operations, or restrict payload handling to a small audited interface. High confidence from source inspection; verify against the actual TypeScript checker and ESLint configuration. This is an assurance bypass, not evidence of an existing HTTP-to-prompt path.

2. **packages/conformance/src/registry/triggers.ts:147 — factually wrong — medium — the “no driver request” assertion leaves the reviewer unobserved.**

   `admitWith` constructs separate builder and reviewer drivers, but returns only the builder driver for request inspection. The payload assertion serializes that driver’s requests alone.

   A regression that includes candidate body text only in a reviewer request can therefore preserve this assertion’s pass. Moreover, `CandidateRecord.body.base64` is an ordinary string: decoding it would not require a cast from either untrusted type, so the new lint mechanism would not catch that route automatically.

   **Resolve:** capture every seated driver and inspect every request. Include a negative control that deliberately leaks the marker only to the reviewer. High confidence.

3. **packages/api/src/run.ts:846 — factually wrong — medium — expiry is checked before potentially lengthy admission work, rather than when the candidate is consumed.**

   Admission captures its time at line 882, checks expiry, then awaits role/rubric reads, workspace snapshotting, and other checks before marking the candidate admitted.

   Concrete construction: begin admission immediately before expiry; let snapshotting finish afterward. The candidate is still admitted. With concurrent requests, another admission can mark it expired during that interval; `markCandidateAdmitted` does not reject the expired mark.

   The conformance test uses a candidate already two days old, so it misses both cases. **Resolve:** make consumption an atomic state transition that checks expiry using a fresh runtime timestamp and excludes expired candidates. Add an admission-crosses-deadline test. High confidence; no malicious Vault is required.

4. **packages/api/src/schedule.ts:75 — factually wrong — medium — refreshed policy does not control the firing time.**

   `arm(schedule)` retains the startup schedule. The callback fetches the latest schedule by ID, but fires it on the old timer and rearms using the old object.

   Start with `nightly` at `02:00`, then change policy to `18:00` before the firing. At `02:00`, the service records a candidate using the latest policy even though its configured time is now `18:00`. Newly added schedules also receive no timer until restart.

   The supplied schedule assertion starts and immediately stops the scheduler; it does not exercise a timer firing or policy change. **Resolve:** reconcile timers against current policy and recheck whether a firing is due before recording it. Test changed times, additions, and removals. High confidence.

5. **packages/core/src/policy/validation.ts:555 — factually wrong — medium — `entryStation` can validate without governing execution.**

   The relational validator requires an entry-station key for non-human kinds but accepts any station ID. Admission never reads that value and constructs the run at `intake`.

   Thus `entryStation: { issue: 'integrate' }` can satisfy validation while admission behaves exactly as if it said `intake`. For `human`, the relational check does not even require the entry-station key.

   This does **not** demonstrate skipping stations; it demonstrates configuration accepted without its apparent effect. **Resolve:** for this unit, require the supported entry station to be `intake`, including for enabled human runs, or implement explicitly defined routing semantics. Add tests for present-but-unsupported values. High confidence.

6. **packages/api/src/intake.ts:61 — unclear — medium — budget enforcement depends on an unenforced single-instance assumption.**

   Serialization belongs to one `Intake` instance. Two service instances sharing a Vault can concurrently read zero candidates under a budget of one, then write different signed deliveries under different digest keys. Exclusive creation prevents duplicate delivery records but does not arbitrate the shared budget.

   The supplied budget assertion sends deliveries sequentially, so it passes under this construction.

   **Resolve:** enforce exclusive service ownership of a store, or reserve budget atomically in the Vault. Add concurrent delivery tests across separate instances. The race is clear; deployment reachability is uncertain because the supplied source does not establish whether sharing a store is prevented elsewhere.

7. **packages/core/src/trigger/schemas.ts:45 — factually wrong — low — the character classes do not require a whole-string match.**

   JavaScript’s `$` anchor permits matching immediately before a final line terminator. Consequently, the repository class accepts `"octo/hello\n"`; the byte cap does not prevent this.

   The conformance fixture uses an embedded newline followed by more text, which is rejected, and misses the terminal-newline case. **Resolve:** use a strict end-of-input assertion or verify that the matched length equals the input length; add terminal-line-terminator cases.

   High confidence in the validation defect. I have not established a genuine GitHub delivery that can carry such a repository name, so this is not a demonstrated remote injection.

Several mechanisms appear sound within the stated trust model:

- HMAC verification covers the exact bytes and compares fixed-length digests with `timingSafeEqual`; absent or empty secrets refuse.
- The HTTP route checks subscription membership before calling the body reader and enforces a streaming byte cap.
- Replay identity includes the body digest, with decision and candidate passed together to one exclusive-create operation. Crash guarantees depend on the existing helper, whose implementation is not shown.
- Admission refuses missing caps/floors and over-cap requests; it does not lower requested autonomy.
- Current candidate admission copies kind, identity, and lineage—not payload text—into the run. I found no demonstrated existing delivery-to-model injection.
- The exclusive admitted marker prevents two successful candidate consumptions, although expiry is not part of that transition.

I found no wholly tautological new trigger assertion and no explicit exception-to-pass path in those assertions. Their weaknesses are narrower observations and missing constructions, as identified above. I did not establish additional declaration-merging, module-augmentation, or type-predicate exploits from the supplied source.

The adversarial framing is appropriate, provided two questions remain separate: **can external input cross today’s runtime boundary, and can conformance certify a future change that breaks it?** TypeScript and lint are development controls, not isolation from code executing inside the runtime. Under your threat model, calling trusted components directly or forging runtime objects is not an attack. The concrete concerns here are admission timing, policy enforcement, and assurance gaps—not an established ability for a webhook sender to start a run or supply its intent.