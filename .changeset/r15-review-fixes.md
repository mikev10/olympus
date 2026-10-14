---
"@olympus-ai/integrity": minor
"@olympus-ai/adapters": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
---

R15 review fixes. A `unit` or `acceptance` check pins no command: the
runtime starts the base's installed test framework through the new
`TestFrameworkAdapter.runner`, `invocation`, and `selectSuites`, over exactly
the locked tests an acceptance check names (`AcceptanceCheckSpec.tests`) or
every configured suite for a `UnitCheckSpec`, and records as the suite count
what that runner was made to load. Admission refuses a suite check that pins
a command, an unknown kind, and named tests the base's framework would not run
exactly (`not-applicable`, `not-a-kind`, `not-runnable`, `unbound`). What a
task writes under `node_modules` is not carried into the tree the checks run
over; `EvidenceBundle.notCarried` records it by package and it escalates
`integrate`. `LocalVault` refuses a base record whose result lacks a suite
count or carries a non-integer exit code.
