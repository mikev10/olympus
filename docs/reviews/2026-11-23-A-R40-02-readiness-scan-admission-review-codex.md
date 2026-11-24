BASE: 03518f9  
HEAD: a320a01  
packages/vault/src/types.ts  
8fb8eb939017393c762e433152d61f66

I had no prior project context and performed no lookups. This review uses the inline bundle; I did not independently verify its SHA-256 or execute tests.

- **packages/conformance/src/registry/admission-readiness.ts:166 — factually wrong — medium — The new unscanned-resume behavior is tested only through the helper, not through resume.** Both `not-scanned` and absent readiness terms are passed directly to `admissionRefusal`. The actual `resumeRun` exercise at lines 180–184 uses a **scanned** record with ceiling zero. A resume implementation that invokes admission refusal only for scanned records—or discards `readiness-unscanned`—would pass these assertions while resuming legacy unscanned runs above L0. This is a concrete coverage gap, not evidence that the current resume implementation does that. **Resolution:** exercise `resumeRun` with each unscanned record shape at L1; require `readiness-unscanned`, unchanged run state, no driver invocation, and the corresponding recorded refusal. Confidence: high.

I found **no demonstrated admission or resume bypass within the stated attacker capabilities** in the supplied code. The following mechanisms are sound within their visible boundaries:

- **Missing-scan refusal:** `packages/api/src/run.ts:730–740` exempts exactly L0 and refuses every other level whose readiness discriminator is not `scanned`. This covers absent legacy terms as well as explicit `not-scanned` terms.
- **Subtractive ceiling:** `packages/api/src/run.ts:741–748` returns a refusal when the requested level exceeds the recorded ceiling; it never assigns a higher level or grants policy capabilities.
- **Refusal precedence inside the helper:** `packages/api/src/run.ts:727–729` returns `controls-unavailable` for L3 with missing controls before examining readiness. The changed assertion at `packages/conformance/src/registry/verification.ts:387–396` distinguishes missing controls from readiness refusal when controls are available.
- **Commit binding at the port boundary:** `packages/api/src/run.ts:1065–1070` awaits the port and rejects an answer naming another commit. A rejected promise or mismatched commit does not become a successful readiness term in this function.
- **Refusal encoding:** `packages/api/src/run.ts:1109–1110` explicitly maps the new outcome into the stored refusal representation.

The fixed-ceiling ports do not prove repository readiness. For example, `packages/benchmark/src/line.ts:43–45` returns L2 without examining the checkout, and `throughTheLine` selects it at line 267. Thus benchmark runs satisfy admission through a trusted declaration. Under your explicit trust boundary, this is **not a caller-controlled bypass**: the shown callers select these ports as runtime configuration. Their existence alone does not establish that a production service can reach one. The bundle does not include enough production wiring to establish isolation either.

I found no tautological assertion or exception-to-pass conversion in the changed readiness tests shown. The casts elsewhere in the bundle do not establish a readiness escape: manufacturing a trusted record or replacing a trusted port inside the runtime would exceed the attacker’s capabilities. Similarly, accepting the newest successful paid retry is an explicit tooling tradeoff, not evidence that an exception is treated as success.

The framing is appropriate, with an evidence limit: **port invocation and enforcement of its trusted answer** are what this change can establish; actual scanning depends on the selected port. The bundle omits the bodies of admission orchestration, resume, production scanner wiring, and record loading. Consequently, I cannot verify end-to-end check ordering, crash recovery, or production reachability of the fixed ports. In particular, ordering branches in `admissionRefusal` does not by itself prove that controls are checked before `readinessAt` executes or throws. Those call sites are the next evidence needed—not an assumed vulnerability.