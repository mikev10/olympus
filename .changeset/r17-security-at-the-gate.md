---
"@olympus-ai/integrity": minor
"@olympus-ai/core": minor
"@olympus-ai/adapters": minor
"@olympus-ai/readiness": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
"olympus-ai": minor
---

R17: security at the gate. `CheckKind` gains `secret-scan` and
`static-analysis`, each a `SecurityCheckSpec` that pins an image by digest
and its rules as text, and no command. Admission refuses a manifest that pins
no secret-scan check, or no static-analysis check over a stack with a
static-analysis slot, and a security check of any image but the one declared
for its kind. The runtime runs each over a copy of the tree with the
scanner's in-tree ignore files removed, its rules on a second read-only
mount, with no egress, at the base and at `verify`. `CheckResult` gains
`findings`, fingerprinted by the runtime independent of line (D-R17-02); only
a finding the base does not account for fails the check (`new-finding`), and
a suppression marker the diff adds fails it (`suppression-added`) and is
recorded as a `suppression-marker` violation (`TamperReport` gains
`suppressionMarkersAdded`). Every failed `verify` iteration, of any check, is
recorded as a `station-refused` decision with its `gate-failed` refusal, now
decided by the line (D-R17-06). The scanners are gitleaks 8.21.2, whose image
moves from `readiness` to `adapters` and is re-exported, and Semgrep 1.95.0,
the TypeScript set's new `staticAnalysis` slot; a set without one names
`static-analysis` among its missing controls.

Every spec carries a security part, `RequestedArtifacts.specParts.security`,
locked with the spec (`AdmissionRecord.artifacts.specParts`). A spec without
one is refused at `spec` (`spec-part-missing`), and an authorization rule it
names with no acceptance or behavioral check naming it in `deniesRule` refuses
the `test-design` exit (`denial-check-missing`). `BaseMismatch.declared`
admits `null` for a security check with no readable findings on the base. A
run admitted before this does not resume.

The conformance registry adds ten R17 assertions under I2, I3, and I5, two of
them over the real images (needs Docker), and the P14 table's two new rows; its `station:gate-failed` row, unconstructed
until now, is a scenario.

The CLI's `create` takes `--security-part <path>`, sent as
`artifacts.specParts.security`; the HTTP create body accepts it as its one
optional artifact key.
