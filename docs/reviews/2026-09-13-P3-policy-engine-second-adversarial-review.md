# Second external review of P3, 2026-09-13

The verbatim findings of a second external adversarial review of the policy
engine, run against the same bundle as the first so the two are comparable.
The first review and its triage are `2026-09-13-P3-policy-engine-adversarial-review.md`
and `...-triage.md`; the request that produced both is
`2026-09-11-P3-policy-engine-review-request.md`. The triage of this one is the
companion file `2026-09-13-P3-policy-engine-second-adversarial-triage.md`.

## Source

- **Reviewer:** not named by the maintainer at handover beyond "another model",
  after the first review was run with Grok. Family: **unrecorded — fill in
  before tagging.** Conditions: the reviewer reported reviewing only the
  attached bundle, with no repository access, and said it "locally checked the
  relevant JavaScript semantics".
- **Family rotation:** ChatGPT reviewed F3 and S1; Gemini reviewed P1 and P2;
  Grok reviewed P3 first. This is the second review of one unit, which is new —
  prior units had one each. Its purpose was corroboration across families, and
  it delivered: two findings reproduce the first review's, and **two are
  findings the first review did not make at all.**
- **Date:** 2026-09-13.
- **Bundle:** base `f1127eb` (`reviewed/P2`), head `6dd2688`, SHA-256
  `df7302c9…4612afe` — **the same bundle the first reviewer received**, by
  design, so a disagreement between the two is about the reviewers and not
  about what they were shown. The reviewer confirmed the attachment was present
  and independently read the range off it as `reviewed/P2..6dd2688`.
- **Important consequence of that choice:** this review describes the tree
  **before** the first triage's fixes landed (commit `43f38de`). Its findings 1
  and 4 had already been fixed by the time it arrived. That is recorded rather
  than silently dropped, because "already fixed" and "not a defect" are
  different verdicts, and the corroboration is evidence in its own right.
- **Prior context and lookups:** the reviewer stated it used no prior project
  context, performed no external, web, or project lookups, and read only the
  attachment. **A self-report, not independently verifiable.**
- **Coverage, and any gap:** all seven numbered prompt items were answered. It
  reported no tautological assertion and explained why it would not call the
  weaker ones tautological; it reported no fail-open path other than the `NaN`
  case it raised as finding 3; it inventoried the language escape hatches and
  the configuration questions. **Item 7 was answered at length and is again the
  most consequential content** — it argued the framing is right only under a
  stated threat model, named the threat model the findings depend on, and
  proposed a sharper question. It also said the I7 half of the prompt was
  premature for this unit.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository, and several are stale against current `HEAD` for the reason
  above. Every finding was located by opening the construct it names; all five
  were executed against current `HEAD`.

---

Prior context: none used; I set aside any prior project context. Lookups: no external/web/project lookups. I reviewed only the attached `olympus-P3-review.txt` and locally checked the relevant JavaScript semantics. The attachment is present and identifies the reviewed range as `reviewed/P2..6dd2688`. 

1. **`packages/core/src/policy/validation.ts:251-274` — factually wrong — high — the “no wildcard” egress validator accepts wildcards inside the allowed array form.** A document with an otherwise-valid scope and `network: { egress: ['*'] }` is accepted. So are `['all']`, `['*.example.com']`, `['https://example.com']`, or any other nonblank string: array entries are tested only with `isNonEmptyString`. This directly contradicts the stated representation being an explicit list of *hosts* with “no wildcard.” `resolvePolicy` then preserves that value and `resolveCapabilities` returns it unchanged. If the eventual egress enforcer recognizes `*` or glob syntax, this becomes unrestricted egress from a document the validator accepted; even if that consumer happens to do exact matching, the validator is still accepting values outside its claimed domain. The test named “egress admits no wildcard” checks only a bare scalar `'all'`, not `['*']`.   **Resolve it:** define the exact host grammar here and reject wildcard/metacharacter, scheme/path/CIDR forms unless each is intentionally part of that grammar; add `['*']`, `['all']`, `['*.example.com']` and non-host strings as refusal cases. **Confidence:** high that invalid host/wildcard strings are accepted; medium-high on the exact downstream widening because the enforcement matcher is outside the supplied source.

2. **`packages/core/src/policy/engine.ts:77-81, 173-181, 204-213` — factually wrong — medium — role lookup is prototype-sensitive, so “undefined role means refusal” is not total and can become an actual grant after prototype pollution.** `cloneRoles` creates an ordinary object, then both runtime lookups use `policy.roles[role]` rather than an own-property check. With an ordinary valid policy that defines no `reviewer`, `(Object.prototype as any).reviewer = <scope-shaped object>` makes `resolveCapabilities('reviewer' as RoleId, 'build', policy)` see the inherited scope and return it as a grant. Without prior pollution, reserved/prototype names are still bad: an ungranted role of `__proto__`, `constructor`, `toString`, etc. resolves to an inherited object/function, so the subsequent `scope.stations.includes(...)` throws instead of returning `capability-missing`. The validator explicitly worries about prototype names, but the runtime lookup reintroduces the prototype as an authority source.   The validation tests only check that authored `__proto__` is rejected; they do not exercise an ungranted prototype-named runtime role.  **Resolve it:** use `Object.hasOwn(policy.roles, role)` before reading, and preferably construct dynamic keyed maps with a null prototype. Add runtime tests for `__proto__`, `constructor`, `toString`, and a deliberately polluted `Object.prototype`. **Confidence:** high on the behavior; medium on exploit reachability because obtaining the grant requires prototype pollution elsewhere, while the exception path needs only an escaped/unvalidated role ID.

3. **`packages/core/src/policy/engine.ts:170-201` / `packages/core/src/policy/constants.ts:47-51` — factually wrong — medium — malformed autonomy requests can return success because the runtime method relies exclusively on an erased TypeScript type.** The project already has a runtime `isAutonomyLevel` guard, but `resolveAutonomy` does not call it. A concrete construction is `resolveAutonomy(Number.NaN as AutonomyLevel, 'build', BUILDER, validPolicy)`: in JavaScript, `NaN > cap` is false, so the method returns `{ ok: true, level: NaN }`. That violates the stated I5 rule that unsupported input is a refusal; it is especially problematic because success is exactly the signal the caller is warned not to misinterpret.   The over-request tests cover only valid members `0..3`, so they cannot expose this.  **Resolve it:** runtime-guard `requested` before any arithmetic, either in `resolveAutonomy` or at a single demonstrably mandatory boundary immediately before it. The current refusal union may need a malformed/unsupported-input reason if no existing reason is semantically correct. **Confidence:** high on the behavior; whether this method is intended to be a runtime trust boundary rather than an internal typed-only method is the only uncertainty.

4. **`packages/core/src/policy/engine.ts:158-168` — a tradeoff I would have made differently — medium — validation and resolution are separable at runtime, so a cast can bypass the validator entirely.** `validatePolicyDocument(unknown)` is the actual runtime narrowing boundary, but exported `resolvePolicy` accepts a plain structural `PolicyDocument` and performs no validation. TypeScript does not enforce the assertion that validation is “the only path” to such a value. For example, a caller can construct an object with `globalCap: 99` and a role `autonomyCeiling: 99`, cast it through `unknown as PolicyDocument`, call `resolvePolicy`, then receive an ordinary successful L3 result; the validator would have rejected both 99s. The same issue applies more generally to a forged `Policy` supplied directly to the two lookup methods.  This is **not** a policy-file bypass if the future loader is guaranteed to call `validatePolicyDocument` correctly, so I would not rate it high under a policy-author-only threat model. It is, however, the principal `as`/`any`/type-erasure escape hatch in this source. **Resolve it:** make the runtime-safe path impossible to skip—for example, have resolution itself accept `unknown` and validate, or keep the unchecked resolver private behind the validator. A TypeScript brand alone is not a security boundary because it can also be asserted away. **Confidence:** high technically, with reachability dependent on the intended trust boundary.

5. **`packages/core/src/policy/validation.ts:307-346` — unclear — low — trigger configuration fields are validated independently, not relationally.** An `enabled` kind need not have `taskTemplate`, `entryStation`, `maxAutonomy`, or `minAuthorTrust` entries. Thus `enabled: ['ci-failure']` with those per-kind maps empty is a valid document. The shipped default itself has `human` enabled but an empty `taskTemplate`.  I am **not calling this an I7 bypass**, because trigger admission is explicitly outside this unit: a later admission implementation can and should refuse when an enabled trigger lacks a predeclared template. But if `enabled` is supposed to mean “fully admissible,” the configuration can currently satisfy the schema without supplying what that name appears to promise. **Resolve it:** specify whether these maps are intentionally partial and missing entries mean “refuse at admission.” If not, validate relational completeness for every enabled kind. **Confidence:** high on what the validator accepts; low on whether that acceptance is contrary to the intended contract.

I did **not find a policy-specific tautological assertion** in the supplied tests. There are weak assertions—for example, “two resolutions of one document agree” proves determinism but little about authorization—but it can fail and therefore is not tautological. The approval cross-product test shares inputs with the implementation, but separate tests pin the exact ten stations, exact four levels, and the count `40`, so I would not characterize it as “passes regardless of the code.” The egress test is more important: it is not tautological, just materially incomplete because its title promises “no wildcard” while its cases never try a wildcard in the array form.  

On fail-open behavior, I found no skipped policy test, missing attachment, or empty-result convention that grants access. The concrete unsupported-input success is the `NaN` autonomy case above. The prototype-role case throws rather than producing the required refusal; that is not by itself a demonstrated “exception becomes pass” because no supplied caller catches it and continues, but it does violate the stated refusal semantics. I also would not treat the conformance fixture proving that the inventory parameter is mandatory as a runtime security boundary: `as any` or JavaScript can bypass the compile check. Fortunately, omitting it at runtime makes `new Set(undefined)` empty, so a policy with tool grants is refused rather than admitted; the actual runtime inventory comparison itself is sound for the values it receives.  

The mechanisms I assess as sound, subject to the findings above, are the field-by-field document rebuild and unknown-key refusal; the closed station/autonomy/approval guards; approval completion to `human-required`; the minimum-of-three cap arithmetic **for valid inputs**; exact refusal rather than downgrade for valid over-requests; tool-inventory comparison against an actually supplied inventory; and the copy/freeze strategy. The freeze is deep enough for the capability-bearing structures shown here: scope arrays, egress arrays, nested network/budget, role scopes, trigger maps, approvals, caps, paths and concurrency are copied before being frozen. The tests also verify both post-resolution document mutation and mutation of returned scopes rather than merely checking `Object.isFrozen`.    The `filled as Record<ApprovalKey, ApprovalOutcome>` assertion also looks justified by the generated cross-product plus runtime count; I do not see that assertion itself opening a capability path. 

The adversarial framing is right for **I4/I5 if the adversary controls policy/request data but not arbitrary code in the process**. The review exposes why that boundary needs to be explicit: if `as any`, forged `Policy` objects, or arbitrary prototype mutation are considered attacker capabilities, TypeScript types cannot be part of the security argument and findings 2–4 become dominant. I would then ask, “What exact untrusted runtime values can reach each exported authorization method, and what runtime check makes each one authoritative?”

For **I7**, the requested adversarial question is premature for this unit. There is no event payload → template → prompt path in the supplied source, and trigger admission is explicitly out of scope. Here the useful question is narrower: “Can policy-shaped input create a template selector outside a known trigger kind, or create a configuration hole that later code might fill permissively?” The key/value-domain part looks sound; the relational completeness question in finding 5 is the unresolved part.
