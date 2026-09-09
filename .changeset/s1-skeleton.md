---
"@olympus-ai/api": minor
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": minor
---

S1: the walking skeleton. Three stubs, three stations, one fixture task, one
gate verdict, and a runtime that refuses to carry a run above L1 while any
of them is wired.

`@olympus-ai/api` is new: `startRun` is the programmatic entry point (the
runtime as a service, of which an in-process call is the first form), the
line runs `spec`, `build`, and `verify` over a `ComponentGraph` with locks
re-verified on the way into each station, and `unsafeComponents` reads every
component's `unsafe` declaration before a run starts. `SKELETON_LINE` is the
line's own declaration: no policy engine, no tamper analysis, no
claim/evidence diff, no station beyond the three.

`StubVault` (vault, in-memory, real SHA-256 locks, `ifVersion` guarded run
state), `StubSandboxProvider` (sandbox, host execution with no container),
and `StubDriver` (core, a canned claim and no model call) each implement
their contract exactly and declare what they cannot enforce. `core`, `vault`,
and `sandbox` gain a `test` script and include their tests in the package
program.

Conformance: `I5.stubs-declare-unsafe` pins each declaration with a
compile-ok fixture, `I5.unsafe-component-refused-above-l1` runs the entry
point and requires the refusal at L2 and L3 naming all four components and a
passing gate at L1, and the I9 terminal scan now covers `@olympus-ai/api`.
The tsconfig `paths` map gains `api`, and `vitest.config.ts` derives
`resolve.alias` from that map through the one reader in `kit/paths.ts`, which
`I8.fixture-paths-match-published-entries` now shares. No pending entry is
added or paid; `pending-baseline.json` is untouched.
