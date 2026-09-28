---
"@olympus-ai/sandbox": patch
"@olympus-ai/driver-claude-code": patch
---

P12 review fixes, from the external review triaged in
`docs/reviews/2026-09-25-P12-credential-relay-triage.md`.

The local provider refuses a spec whose egress allowlist names the relay's
upstream host, which would make the proxy a second route to it; `RelaySpec`
makes the refusal an obligation (D-P12-11). A relay's teardown attempts every
step and reports everything it left behind, and a failed start reports its
cleanup failure beside its cause instead of dropping it (D-P12-12).

The credential assertion searches the workspace mount at every depth, refuses
an entry it cannot read, and its control proves the scan with a nested canary
(D-P12-13). The relay suite reads only Docker's "not found" as absence, and
its startup refusals require the relay's own diagnostic beside a valid-start
control (D-P12-14).
