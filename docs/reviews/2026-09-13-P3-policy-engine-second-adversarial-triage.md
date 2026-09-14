# Triage of the second P3 external review, 2026-09-13

The review is `2026-09-13-P3-policy-engine-second-adversarial-review.md`. It was
run against the **same bundle** as the first review (`6dd2688`, SHA-256
`df7302c9…`), deliberately, so that a disagreement between the two is about the
reviewers rather than about what they were shown. The first review and its
triage are `2026-09-13-P3-policy-engine-adversarial-review.md` and `…-triage.md`.

**Consequence of reviewing the same bundle:** this reviewer saw the tree
*before* the first triage's fixes landed (`43f38de`). Two of its five findings
had already been fixed by the time it arrived. Those are recorded as
corroboration, not as new defects — "already fixed" and "not a defect" are
different verdicts.

## Counts

- **Hold, and were reproduced by execution against current `HEAD`:** 3 —
  findings 2, 3, 5
- **Hold, and had already been fixed by the first triage:** 2 — findings 1, 4
- **Do not hold:** 0
- **Fixed on the unit branch by this triage:** 2 — findings 2, 3
- **Recorded as a contract decision with a new pending entry:** 1 — finding 5
- **Residual sub-requests rejected with a reason:** 1 — the `['all']` case
  inside finding 1

**The case for the second review is settled by findings 2 and 3.** Neither
appears anywhere in the first review. One of them — the prototype-chain grant —
is the only finding across both reviews that produced an actual ungranted
capability on an otherwise valid policy, with no type assertion needed at the
call site.

**Calibration.** Nothing was wrong about the code. One severity is arguably
high rather than the "medium" given (finding 2's grant half), and one finding
was *understated*: finding 3 named `NaN`, and `-1` and `2.5` turned out to do
the same thing. The reviewer separated behaviour from reachability carefully in
every finding and hedged its confidence on exactly the points where the answer
lay outside the bundle.

| # | Finding | Verdict | Outcome |
|---|---|---|---|
| 1 | Egress array accepts `['*']` and other non-hosts | **Holds** — already fixed as D-P3-08 | Corroborates first review; `['all']` residual rejected |
| 2 | Role lookup reads the prototype chain | **Holds** — reproduced, a real grant | **Fixed** — D-P3-11 |
| 3 | A malformed autonomy level returns success | **Holds** — reproduced, and broader than reported | **Fixed** — D-P3-12 |
| 4 | Resolution is separable from validation | **Holds** — already fixed as D-P3-09 | Corroborates first review; its correction to D-P3-09 accepted into D-P3-14 |
| 5 | Trigger maps are validated independently, not relationally | **Holds** as an ambiguity; out of scope | **Recorded** — D-P3-13, pending entry owned by M2 |

---

## 1. Egress array accepts non-hosts — already fixed, corroborated

**Verified against current `HEAD`:**

```
F1 now: refused
```

This is the first review's finding 1, found independently by a second family,
and fixed before this review arrived (D-P3-08). Both reviewers reached it by the
same route — noticing that the bare-string refusal and the array path disagree —
and both flagged that the existing test's title promised more than its cases
delivered. That criticism was correct and is also now closed: the suite tries
`['*']`, `['*.example.com']`, `['0.0.0.0/0']`, `['https://example.com']` and a
whitespace-bearing entry.

**One sub-request is rejected.** The reviewer asked that `['all']` be refused
alongside `['*']`. It is not. `all` is a syntactically valid DNS label denoting
a single host; refusing it would be guessing at semantics, and `any`,
`everything` and `world` would have equal claim to the same treatment. The bare
string `'all'` is refused because the only valid bare string is `'none'`, not
because `all` carries meaning. D-P3-08's rule is *an entry denotes one host*,
and `all` does. Recorded rather than quietly ignored, because two reviewers
raised the same asymmetry and a future reader deserves the reasoning.

---

## 2. Role lookup reads the prototype chain — fixed

**Claim.** `cloneRoles` builds an ordinary object and both lookups use
`policy.roles[role]`, so a polluted `Object.prototype` turns an undefined role
into a grant, and an ungranted role named for a prototype member throws instead
of refusing.

**Verified by execution, against current `HEAD` — the first triage's fixes did
not touch this:**

```
F2 polluted role resolves: GRANTED
F2 role "toString": THREW: TypeError
F2 role "constructor" via resolveAutonomy: THREW: TypeError
```

**Holds, both halves.** This is the most serious finding across both reviews.
Every other bypass in either review needed a type assertion at the call site —
a caller lying to the compiler. This one needs an ordinary valid policy and
prototype pollution somewhere else in the process, and it produces a real
`{ ok: true }` capability grant for a role the policy does not define.

**Severity, honestly.** The grant half depends on prototype pollution existing
elsewhere, which is a conditional precondition and why the reviewer said medium;
that hedge is fair. The throw half has no precondition at all beyond an
unvalidated role id, and a `TypeError` is not the refusal the contract promises:
it carries no reason, and a caller that catches it has nothing to record.

**Worth recording:** `validateRoles` already refused `__proto__`, `constructor`
and `prototype` as *authored* role ids. The validator was worrying about
prototype names while the runtime lookup handed the prototype back its
authority. Guarding the input and not the lookup is half a control.

**Fixed.** The role map is built on `Object.create(null)` and read only through
`scopeFor`, which uses `Object.hasOwn`. Both, not either — the null prototype
closes it now, the `hasOwn` keeps it closed if a later edit rebuilds the map
ordinarily. `ownStationCap` gives the station caps the same treatment; they were
reachable by the same route and were saved only by an ordering accident that put
the station check first.

**Asserted.** `I4.role-lookup-ignores-the-prototype-chain`. Mutation-checked —
restoring the plain object produces:

```
I4: the resolved role map has a prototype, so an undefined role can be answered by it
```

---

## 3. A malformed autonomy level returns success — fixed

**Claim.** `resolveAutonomy(NaN as AutonomyLevel, …)` returns
`{ ok: true, level: NaN }`, because `NaN > cap` is `false`.

**Verified by execution, and it is broader than reported:**

```
F3 level NaN:      GRANTED level=NaN
F3 level -1:       GRANTED level=-1
F3 level 2.5:      GRANTED level=2.5
F3 level Infinity: refused (exceeds-cap)
```

Only `Infinity` was refused, and only because `Infinity > 3` happens to be
true. **The finding was understated, not overstated** — every non-member below
the cap was answered with success carrying itself as the granted level.

**Why success is the worst available answer here.** This unit's whole I5 story
is that an over-request is refused rather than downgraded, because a caller that
receives a level proceeds believing it was granted what it asked for. A caller
receiving `{ ok: true, level: NaN }` does precisely that, holding a level
nothing downstream can honour.

**Fixed** with the `isAutonomyLevel` predicate the package already had — the
reviewer correctly noticed it existed and was not being used. It throws rather
than returning a refusal: `PolicyRefusal.reason` has no arm for a malformed
argument, and widening that union is an F2 contract edit, which is an amendment
and on this unit's out-of-scope list. The throw matches D-P3-09's precedent —
a value that lies about its type gets an exception, not a refusal object.

**`station` was deliberately not guarded.** An invented station fails
`scope.stations.includes(station)` and refuses with `station-forbidden`, which
is a correct refusal reached by the normal path.

**Asserted.** `I5.malformed-autonomy-level-refused`, with all four real levels
as the control. Mutation-checked.

---

## 4. Resolution is separable from validation — already fixed, corroborated

**Verified against current `HEAD`:**

```
F4 now: refused
```

This is the first review's finding 2, found independently, and fixed as
D-P3-09. Both reviewers constructed the same case — `globalCap: 99` cast through
`unknown as PolicyDocument` — and both reached the same conclusion about the
remedy.

**The reviewer improved on the fix's reasoning, and the correction is
accepted.** D-P3-09 described branding the validated document as "the stronger
fix". The reviewer: *"A TypeScript brand alone is not a security boundary
because it can also be asserted away."* That is right, and D-P3-09 overstated
it. The correction is recorded in D-P3-14 rather than edited quietly into
D-P3-09, because overstating what a type buys is the exact error that decision
now exists to name.

**One part remains open and is recorded as a known limit.** The reviewer noted
the same issue "applies more generally to a forged `Policy` supplied directly to
the two lookup methods". True, and not fixed: revalidating an entire policy on
every lookup moves a load-time cost onto every call. Under the threat model now
written down in D-P3-14, a `Policy` comes from `resolvePolicy`, which validates.
If that threat model ever widens to in-process adversaries this is the first
thing that must change.

---

## 5. Trigger maps are validated independently — recorded, owned by M2

**Verified by execution:**

```
F5 enabled ci-failure with empty maps: ACCEPTED
F5 default enabled: ["human"]
F5 default taskTemplate: {}
```

**Holds as an ambiguity rather than a defect,** which is how the reviewer
framed it — it explicitly declined to call it an I7 bypass, because trigger
admission is out of scope for this unit. It asked for the contract to be stated
rather than for code to change.

**Stated, in D-P3-13:** the maps are partial by contract. `enabled` means "this
kind is not switched off", not "this kind is fully admissible". The relational
check belongs at admission and not in the validator, because admission is the
only place that knows whether a named template exists — a validator enforcing
completeness against a template registry that does not exist would be checking a
name against nothing.

**But the hole is real,** and I7 holds only while a trigger selects a
pre-declared template. An enabled kind with no declared template is exactly the
gap a permissive admission implementation would fill from the payload. So it is
registered rather than described: `I7.enabled-trigger-declares-a-template`,
owner M2, raising the I7 baseline from 2 to 3.

---

## Sections outside the numbered findings

- **Tautological assertions: none found,** and the reviewer showed its working
  rather than asserting it — it distinguished *weak* from *tautological* (the
  determinism test is weak but can fail), and it checked whether the approval
  cross-product test was circular, concluding it is not because separate tests
  pin the ten stations, the four levels and the count independently.
- **Fail-open paths: none beyond finding 3.** It checked the mandatory-inventory
  conformance fixture specifically and observed, correctly, that a compile
  fixture is not a runtime boundary — then went further and checked what
  actually happens at run time: omitting the argument makes `new Set(undefined)`
  empty, so a policy with tool grants is refused rather than admitted. Fails
  closed. No change.
- **Escape hatches:** it agreed the `as Record<ApprovalKey, ApprovalOutcome>`
  assertion is justified by the generated cross-product plus the runtime count,
  matching the first review's conclusion and the first triage's reasoning.
- **Freeze depth:** it traced every capability-bearing structure and confirmed
  each is copied before being frozen, and noted approvingly that the tests
  exercise real mutation rather than checking `Object.isFrozen`.

## Framing — accepted, and it produced the most valuable entry in either triage

The reviewer accepted the adversarial question conditionally and named the
condition: the framing is right *"if the adversary controls policy/request data
but not arbitrary code in the process"*, and if in-process code is in the threat
model then *"TypeScript types cannot be part of the security argument"*.

That threat model was not written down anywhere. It is now, in **D-P3-14**,
together with its corollary: no type in this package is part of the security
argument, and every exported method that answers an authorization question
carries a runtime check that does not depend on its parameter types.

It also judged the I7 half of the prompt premature for this unit — there is no
payload-to-template-to-prompt path in the source — and proposed a narrower
question. Accepted; the next review request for a policy-shaped unit should ask
that question instead of restating I7 in full.

## Gates after the fixes

`pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r test` and `pnpm conformance` were
re-run in full. Results are in the session report accompanying this triage.
