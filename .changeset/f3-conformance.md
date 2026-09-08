---
"@olympus-ai/conformance": minor
"@olympus-ai/core": patch
"@olympus-ai/vault": patch
"@olympus-ai/integrity": patch
"@olympus-ai/sandbox": patch
"@olympus-ai/triggers": patch
"@olympus-ai/adapters": patch
---

F3: the conformance kit and the invariant registry. `@olympus-ai/conformance`
compiles annotated fixtures to prove that violations of I1-I10 fail to
typecheck, runs repository-level checks for the rest, and maps every
invariant and every capability claim to its assertions or to the unit that
owes them. Every package gains a `lint` script under the single workspace
ESLint configuration.
