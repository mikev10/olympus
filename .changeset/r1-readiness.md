---
"@olympus-ai/readiness": minor
---

R1: a new `readiness` package. `scan()` copies one repository's tree at one
commit and runs seventeen probes over it. Most run in fresh sandboxes over that
copy, and the rest are static reads or a caller-supplied branch-protection
checker. The scan derives an autonomy ceiling of L0, L1, or L2 (never L3) and
names the probe that holds it. `resolveWithReadiness()` applies that ceiling as
the fourth term of the effective-level formula: it calls the policy engine
unchanged and only ever refuses on top of the engine's own verdict. A refusal
names every term that bound it (readiness, the global cap, the station cap, or
the role ceiling) instead of a bare `exceeds-cap`. An unscanned repository
passes `NOT_SCANNED`, which is an explicit state and never `undefined`.
Nothing wires the ceiling into run creation yet.
