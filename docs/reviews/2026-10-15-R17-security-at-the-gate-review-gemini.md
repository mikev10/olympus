# External review of R17, gemini, 2026-10-16

An adversarial review of R17, security at the gate: the `secret-scan` and
`static-analysis` check kinds, the runtime-made scan copy, fingerprinting and
the base comparison, suppression-marker detection over the diff, the security
part, and the `test-design` denial-check refusal. One of two reviews run from
the same prompt and bundle; the other is
`2026-10-15-R17-security-at-the-gate-review-codex.md`. Both are triaged in
`2026-10-15-R17-security-at-the-gate-triage.md`, which cites this review's
single finding as `gemini-1` and its assessment section as `gemini-obs`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools. `cleanRoom` is `null` because an API call loads no local
  configuration. 284.0 s. Ingestion `complete`: 108,337 input tokens against a
  floor of 75,016. Integrity `verified`. Outcome `counted`. Reply SHA-256 as
  the runner wrote it:
  `ac8f0d46adcd028895e6f9f55b4b58305ce30f7fb25852df511b6fdd0beccea1`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** gemini-1 was raised by codex too, as codex-2: the
  same mechanism, an optional check satisfying the denial-check requirement.
  gemini raised nothing alone. Its assessment that the Vault isolation is sound
  is contested by codex-4.
- **Date:** 2026-10-16 (run started 2026-10-16T12:45Z).
- **Bundle:** `2026-10-15-R17-security-at-the-gate-review-bundle.txt`, SHA-256
  `43a91606360262b20accc1b50a066e01e134096bcc3b06cc9d804be07bbb91b5`, base
  `6f1da42` (`reviewed/R15`), head `a1d5b8e` ("R17: Security at the gate"),
  one commit. It held 52 of the 54 changed paths, new files in full and
  modified files as whole-function diffs; `docs/decisions.md` and
  `docs/plan/DECOMPOSITION.md` were excluded, and so was every unchanged file.
  Prompt: `2026-10-15-R17-security-at-the-gate-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context
  and performed no external lookups. This is a self-report and is not
  independently verifiable; the call offered no tools.
- **Coverage, and any gap:** one finding, gemini-1, which answers items 2 and 5
  (it calls the check tautological and the configuration satisfiable without
  effect), and an assessment section answering item 6. Items 1, 3 and 4 came
  back empty, and so did item 7: the reviewer did not say whether the framing
  was right. None of that silence is an endorsement.
- **Citations:** line numbers are positions on the new side of the bundle's
  diffs, not located repository lines. The triage reopened each cited
  construct by name.

---

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