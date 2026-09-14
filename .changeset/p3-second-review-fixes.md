---
"@olympus-ai/core": patch
"@olympus-ai/conformance": patch
---

P3 second review fixes. Role lookup read the prototype chain, so a polluted
`Object.prototype` turned an undefined role into a real grant and a role named
`toString` threw instead of refusing; the role map is now built on a null
prototype and read only through an `Object.hasOwn` guard (D-P3-11).
`resolveAutonomy` compared an erased type numerically, so `NaN`, `-1` and `2.5`
were each answered `{ ok: true }` carrying themselves as the granted level; the
level is now guarded with the predicate the package already had (D-P3-12).

Trigger maps stay partial by contract and admission owes the relational check,
registered as `I7.enabled-trigger-declares-a-template`, owner M2 (D-P3-13).
D-P3-14 states the threat model the unit's argument depends on, and corrects
D-P3-09: a TypeScript brand is not a security boundary.

New live assertions `I4.role-lookup-ignores-the-prototype-chain` and
`I5.malformed-autonomy-level-refused`; I7 baseline rises 2 to 3.
