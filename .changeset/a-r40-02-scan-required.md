---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
"@olympus-ai/benchmark": patch
---

Admission above L0 refuses when no readiness scan ran (A-R40-02). `AdmissionRefusal` gains `readiness-unscanned`; a run above L0 whose request carries no scan port, or whose record holds no scan, is refused at admission and on resume rather than admitted on the policy terms alone. The adapter-controls check now runs before the readiness check, so an L3 run lacking a control still names it. The benchmark passes its runs a declared L2 scan port.
