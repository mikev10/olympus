---
"@olympus-ai/conformance": minor
---

F3 amendment after maintainer review. The registry reports four states
(`partial` separates an invariant with live assertions and owed work from one
with nothing owed), ratchets every pending count against a committed baseline
(`pending-baseline.json`: a count above it fails CI, a decrease shows as a
delta, and the ratchet is itself a registered assertion), and proves with a
fixture that the I7 cast scan sees through `raw as unknown as string`.
`FixtureCompiler.build` exposes the program for scan-based fixtures;
`castFixture`, `checkCastFixture`, and the baseline reader are new kit
exports. The remaining I7 sinks are recorded as a pending assertion owned by
M2 rather than as an open hole.
