BASE: reviewed/R15
HEAD: a1d5b8e
packages/vault/test/stub.test.ts
0cf0cedeb7466b22a4f7e3fa24cfea57

I had no prior context about this project and performed no external lookups. 

### Findings

packages/api/src/security.ts:133 — factually wrong — high — An authorization rule denial check can be entirely bypassed by configuring the corresponding `acceptance` or `behavioral` check with `required: false`. The `denialRefusal` function considers the rule "exercised" because it sweeps the checks array for `deniesRule` without checking their `required` status. However, the verification gate (`requiredShortfall`) completely ignores failures from optional checks. This allows the configuration to satisfy the `denial-check-missing` requirement at `test-design` while creating a tautological check that will never fail the run at `verify`, even if the agent completely removes or breaks the authorization logic. To resolve this, update `denialRefusal` to only accept checks where `c.required === true`, or update `checkProblems` in `packages/api/src/validate.ts` to mandate `required: true` for any check defining `deniesRule`.

### Assessment of Mechanisms

The overall design of the deterministic security checks is exceptionally sound, specifically regarding how it handles scanner suppression markers:
- **Scanner Suppression Blindness:** By invoking gitleaks with `--ignore-gitleaks-allow` and Semgrep with `--disable-nosem`, the runtime completely strips the scanners' native ability to suppress findings. This is a brilliant fail-closed mechanism. Because the scanners are blind to suppression markers, they will *always* report the finding.
- **Fingerprinting & Base Comparison:** If an agent attempts to use a suppression marker to hide a newly introduced malicious finding, the scanner will report it anyway. `newFindings` will compare its fingerprint against the base findings. Since the code (Semgrep) or secret (gitleaks) is new, the fingerprint will be entirely novel, and the check will immediately fail with `new-finding`.
- **Harmless Marker Movement:** Because the scanners report everything, if an agent merely moves an existing suppression marker (or an existing secret) without introducing a new vulnerability, `newFindings` accurately cancels it out. The `markersAdded` check exists strictly to penalize the explicit *addition* of new suppression markers, but the system does not actually rely on `markersAdded` to detect hidden vulnerabilities—the scanners themselves catch them.
- **Vault Exfiltration:** The system successfully isolates secrets from the Vault. The unredacted secret is only kept in memory to compute the SHA-256 fingerprint, and `exec.stdout` is discarded and replaced by `renderFindings` which only writes the rule, location, and fingerprint to the Vault.