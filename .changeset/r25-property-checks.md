---
"@olympus-ai/core": minor
"@olympus-ai/integrity": minor
"@olympus-ai/adapters": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
"@olympus-ai/benchmark": minor
"@olympus-ai/compiler": patch
---

Property checks (R25). `CheckKind` gains `'property'`. A `PropertyCheckSpec` names locked property files, declares what it does on the base, and pins a seed and a case count. `AdapterSet.property` holds fast-check 4 beside vitest 4, or null. The runtime runs a property check under the base's vitest, with its own preload ahead of it. The preload sets the pinned seed and case count, and every property reports from the `fc.assert` call that registered it. A check is refused in five cases: the set has no slot, a file registers no property, a property runs fewer cases than pinned, it runs on another seed, or it does not report. `CheckResult.property` records the seed, the cases run, and the shrunk counterexample. The test drafter may draft a property check, and its role says how. Policy gains `propertyPerAuthorizationRule`, false when absent. When it is set, every authorization rule needs a required property check naming it in `deniesRule`, beside its denial check. Corpus v2 adds `edge-case-only` and a `line-with-properties` arm.
