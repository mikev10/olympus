---
"@olympus-ai/conformance": minor
---

F3 amendment after an external adversarial review of the conformance kit.
Six findings fixed: the protected-paths guard now covers the manifests and
test and compiler configuration that CI's four commands read, and matches the
`gate-change` label by exact element rather than substring; a new I7
assertion refuses any inline `eslint-disable` or configuration comment in
package sources that names one of the three I7 rules or silences every rule;
`compileOkSource` refuses `expect-error` annotations and requires zero
diagnostics like `compileOk`; the capability-key assertions check key-set
equality in both directions and reject index signatures and empty sets
(`keysEqual` is a new kit export); external assertions are refused outright
until execution reconciliation exists, recorded as
`I8.external-assertion-execution-reconciled` owed to P2, and no longer count
toward an entry's state; and the I6 seat obligation now states that reduced
independence is reportable at L0-L2 only while L3 refuses a same-family
reviewer. `verifyExternalAssertion` and the `root` evaluation option are
removed. Six further findings are recorded as known limits of type-level
fixtures in `docs/decisions.md`, and the triage is recorded in
`docs/reviews/`.
