# Triage of the P3 external review, 2026-09-13

The review is `2026-09-13-P3-policy-engine-adversarial-review.md`; the request
that produced it, with the bundle pinned by SHA-256, is
`2026-09-11-P3-policy-engine-review-request.md`. Findings are cited by the
reviewer's own numbers.

## Counts

Five numbered findings, plus three inventory sections (6, 7, 8) that report no
defect and one framing answer (item 7 of the prompt).

- **Hold, and were reproduced by execution:** 3 — findings 1, 2, 3
- **Hold as observations naming no defect:** 2 — findings 4, 5
- **Do not hold:** 0
- **Fixed on the unit branch:** 2 — findings 1, 2
- **Recorded as a boundary with a new pending registry entry:** 1 — finding 3
- **No change, with the reason recorded:** 2 — findings 4, 5

Nothing was fixed on the reviewer's authority. Findings 1, 2 and 3 each carried
a construction, and each construction was run against the real engine before
any decision was taken; the outputs are quoted below. **This reviewer's
calibration was good:** no finding was wrong about the code, no severity was
inflated, and finding 1 explicitly asked for its own consequence to be verified
before being treated as high — which is what the verification then showed.

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| 1 | `validateEgress` refuses a bare `'*'` but accepts `['*']` | **Holds**; not a live bypass — no consumer exists | **Fixed** — D-P3-08 |
| 2 | The engine never validates the `PolicyDocument` it is handed | **Holds**; reproduced end to end | **Fixed** — D-P3-09 |
| 3 | `resolveAutonomy` ignores `approvals` and `triggers.maxAutonomy` | **Holds**; by design and declared out of scope | **Recorded** — D-P3-10, pending entry owned by P4 |
| 4 | The `as Record` in `totalApprovals` | Holds as an observation; no defect | No change, reason recorded |
| 5 | `Object.freeze` is shallow | Holds as an observation; no defect | No change, reason recorded |

---

## 1. A wildcard survives inside the egress host list — fixed

**Claim.** `validateEgress` refuses `'all'` / `'*'` as a bare string, then
accepts any non-empty string inside the array, so `{ egress: ['*'] }` validates
and is reported as the grant.

**Verified by execution.** A document carrying each entry was put through
`validatePolicyDocument`, then resolved, then read back through
`resolveCapabilities`:

```
F1 validator verdict for ["*"]: ACCEPTED
F1 resolved scope egress: ["*"]
F1 entry "*": ACCEPTED
F1 entry "*.example.com": ACCEPTED
F1 entry "all": ACCEPTED
F1 entry "0.0.0.0/0": ACCEPTED
F1 entry "::/0": ACCEPTED
```

**The defect holds. The consequence is smaller than the wording implies, and
the reviewer asked for exactly this to be checked.** There is no consumer.
`CapabilityScope.network.egress` (a `'none' | string[]`) and `SandboxSpec.egress`
(an `EgressPolicy` with `mode` and `allow`) are different types, and a search of
every package finds no code mapping one to the other — P4 or P5 would be the
first. The one component that reads an egress policy, `LocalDockerProvider`,
refuses `allowlist` outright:

```ts
// packages/sandbox/src/local/provider.ts:113
refuse('egress', 'egress.mode "allowlist" is not enforceable by this provider: …')
```

So a wildcard host list cannot reach an enforcement point today. It is a schema
gap and a trap set for whichever unit can enforce an allowlist.

**Fixed anyway,** because it is cheap, it is squarely this unit's job — schema
validation of the authored document — and leaving it means the trap is waiting
rather than closed. An entry carrying a glob wildcard, a path or prefix-length
separator, a backslash, or whitespace is now refused, naming every offending
entry. The rule is *an entry denotes a single host*, not a hostname grammar;
D-P3-08 records why the grammar was deliberately not invented here and what the
rule does not catch.

**Asserted.** `I4.egress-entry-names-one-host`, with a literal-host control so
it cannot pass by refusing everything. Mutation-checked — accepting any
non-empty entry produces:

```
I4: a policy granting egress to "*" was accepted. An egress list admits no
wildcard, so an entry that denotes a set makes a restrictive-looking policy
unrestricted.
```

---

## 2. The engine trusts a document it never validated — fixed

**Claim.** `resolvePolicy` / `resolveAutonomy` / `resolveCapabilities` never
call `validatePolicyDocument`. A caller that asserts past the compiler reaches
resolution with `globalCap: 99`, an out-of-range ceiling, or an invented station
id, and every one becomes a grant.

**Verified by execution.** A value built as `{ …, globalCap: 99 } as unknown as
PolicyDocument` was passed to the real engine:

```
F2 resolved globalCap: 99
F2 L3 at build: {"ok":true,"level":3}
F2 invented station resolves: GRANTED
```

**Holds exactly as described.** The severity judgement is worth stating
plainly: reaching this requires a type assertion at the call site, so the
compiler stops an honest caller, and under `strictTypeChecked` with
`no-explicit-any` such an assertion is a deliberate act. But the reviewer's
framing is the right one — I5 says fail closed, and a control that holds only
while every caller remembers to compose two functions in the correct order is
not closed.

**Fixed.** `resolvePolicy` now validates its argument and throws, naming the
defects, when it does not validate. This is in scope: it is fail-closed
behaviour on the unit's own entry point, and it required no contract change.

**The stronger fix was not taken, and why.** Branding the validated document so
`resolvePolicy` accepts only what `validatePolicyDocument` produced — the
`UntrustedPayload` pattern — would make the composition unskippable at compile
time rather than caught at run time. That changes
`PolicyEngine.resolvePolicy`'s signature in `packages/core/src/policy/types.ts`,
an F2 contract file, which this unit's out-of-scope list excludes and which
WORKFLOW.md classifies as an amendment. Recorded in D-P3-09 so it is not lost.

**Asserted.** `I5.malformed-document-refused-at-resolve` — four rogue documents
and a genuine one as the control. Mutation-checked — reverting the guard
produces:

```
I5: resolvePolicy accepted a global cap of 99. The parameter type is a compiler
claim, and a control that holds only while every caller remembers to validate
first is not closed.
```

---

## 3. The approvals table and trigger caps are inert here — recorded, owned by P4

**Claim.** `resolveAutonomy` reads neither `policy.approvals` nor
`triggers.maxAutonomy`, so a document can block `build:2` and cap human
triggers at L0 and still be told L2 is granted.

**Verified by execution.**

```
F3 approvals["build:2"]: blocked
F3 triggers.maxAutonomy.human: 0
F3 resolveAutonomy(2, build): {"ok":true,"level":2}
```

**Holds, and is by design.** P3's out-of-scope list says "approval
*evaluation*: P3 resolves the forty-key table, P4 reads it" and "trigger
admission (M2)". The reviewer read the boundary correctly and called it "a
boundary, not a dodge".

**Not fixed, because fixing it would widen the unit.** Making `resolveAutonomy`
consult the approvals table is P4's work, absorbed into P3 on a reviewer's
suggestion. The out-of-scope list is binding.

**But "by design" is not a control,** and a total table nobody consults is a
control that does not exist. Three things were done instead of a comment:

1. **The boundary is pinned by tests** (`policy-engine.test.ts`, "the boundary
   this engine does not cross"). A later change that makes the engine consult
   either table fails them, so that change becomes deliberate rather than
   silent.
2. **The obligation is registered against the consuming unit.**
   `I4.approval-outcome-gates-the-station`, owner P4: it must refuse to advance
   a `station:level` whose approval cell is `blocked`, require a human for
   `human-required`, and assert both. This raises the I4 baseline from 1 to 2 —
   a deliberate edit, visible in the diff, and the instrument that gets counted
   where prose does not.
3. **The reviewer's framing question is answered in D-P3-10.** Asked: which
   later callers may treat this engine's answer as sufficient? Answered: none.

---

## 4. The type assertion in `totalApprovals` — no change

The reviewer confirmed the runtime count check makes the assertion honest, and
that a future edit desynchronising `APPROVAL_KEYS` from the two total records
throws at resolve time — fail loud, not fail open. It suggested optionally
building the record without the `as`.

**Not taken.** TypeScript cannot prove a loop assigned every key of a union;
`Object.fromEntries` returns an index-signature type that is not assignable to
a total `Record<ApprovalKey, …>`; and a forty-entry literal would defeat the
derivation the cross-product exists for. The assertion plus the throw is the
honest arrangement, and the throw is what the review agreed makes it honest.

---

## 5. Shallow freeze — no change

The reviewer traced `cloneScope`, confirmed it freezes the arrays and the
nested `network` and `budget` objects, and concluded the remaining gap — a
caller replacing the `Policy` reference it holds — is "not a silent widen of
the engine's own copy". Agreed. No function that returns a value can stop a
caller reassigning its own variable.

---

## Sections 6, 7, 8 — no defect reported

The reviewer answered prompt items 2, 3, 4 and 5 substantively rather than
leaving them blank, which is worth recording because a blank item reads later
as though it had been cleared.

- **Tautological or fail-open checks: none material.** It verified that the four
  P3 registry assertions drive the real engine against a document that both
  grants and refuses, so they would fail if the engine refused everything or
  filled `auto`. It correctly noted `I4.tool-grant-requires-an-inventory` is a
  compile fixture and not a runtime proof that callers pass a real inventory —
  already recorded as `I4.driver-tool-inventory-validated`, owned by P5.
- **Language escape hatches:** the `as` in `totalApprovals` (finding 4); the
  type predicates sound, with `Object.hasOwn` on total records rejecting
  prototype keys and `isAutonomyLevel` rejecting the string `'2'`; no
  declaration merging or module augmentation; the validator's success path
  rebuilding a new object so extra keys cannot ride through; `RESERVED_ROLE_IDS`
  closing the `__proto__` path. It noted `RoleId` is accepted as any non-empty
  non-reserved string with branding only at call sites, and concluded correctly
  that this invents no tools or stations — consistent with D-P3-07.
- **Configuration that looks like a restriction and is not:** it checked the
  empty `stationCaps` reading (D-P3-06) and agreed; the empty egress array;
  `roles: {}` in the shipped default as a real deny; and `taskTemplate: {}`
  under I7 for the stated scope.

## Gates after the fixes

`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` and `pnpm conformance` were
re-run in full, not only the tests near the changes. Results are in the session
report accompanying this triage.
