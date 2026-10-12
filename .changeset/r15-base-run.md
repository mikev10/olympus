---
"@olympus-ai/core": minor
"@olympus-ai/integrity": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
---

R15: checks run on the base before build. `CheckSpec` splits by kind: an
acceptance check must declare `onBase: 'fails' | 'passes'`, a behavioral check
may, and no other kind can. Admission refuses an undeclared acceptance check,
a declaration on another kind, and a manifest with no required declared check
declared `'fails'`. At the `test-design` exit the line runs every declared
check over a fresh read-only copy of the base with no egress, before any
driver is invoked, records the results once through the new
`Vault.recordBaseRun` (read back with `readBaseRun`, `VaultRefKind`
`'base-run'`), and refuses the exit with the new `StationRefusal` reason
`'base-mismatch'` when a check does not do what it declared, does not start,
or runs over suites that cannot be counted. A resume judges the stored record
and runs nothing again. `EvidenceBundle` gains a required `baseRun` reference.
