# Triage of the R13a external reviews, 2026-11-03

Two reviews, both `counted` on the first run, with no reruns:
- **Codex:** `gpt-6-astra`, 98,286 input tokens against a floor of 65,616.
- **Gemini:** `gemini-3.1-pro-preview`, 95,450 input tokens against the same floor.

Each reply's SHA-256 matched its manifest's `replySha256` before its header was prepended. The untouched replies are in `0dd73b9`.

**Counts.**
- **Codex:** 6 findings. 5 hold and 1 holds in part. 5 were fixed, 1 is a known limit (issue #97), and codex-4's unfixed remainder is recorded in issue #96.
- **Gemini:** 4 findings. 3 hold and 1 holds in part. All 4 were fixed, and gemini-2's unfixed remainder is in issue #96.
- **Did not hold:** none from either family.
- **Raised by both families:** three mechanisms (codex-3 / gemini-4 / gemini-1, and codex-4 / gemini-2).

**Verification.** Every finding was checked against the cited code by a fresh-context agent that had only the findings' text and the files. All seven distinct mechanisms were confirmed. Where a test could be built, it was then constructed and run against the old behaviour and failed. One departure from the skill: the seven mechanisms went to one verifying agent, not one agent each, to spare the weekly subagent budget.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | An audit report from any exit counts, an empty report is whole, and a dangling `via` is skipped | codex | holds | fixed, 2dfd2c4 |
| codex-2 | The audit succeeds without any recorded contact with the advisory host | codex | holds in part | fixed, cfd5534; residual in #96 |
| codex-3 | An unanchored GHSA id is returned whole, and rejected values are still stored in the record | codex, gemini (gemini-4, gemini-1) | holds | fixed, 2dfd2c4 and cfd5534 |
| codex-4 | The comparison baseline has no trust anchor | codex, gemini (gemini-2) | holds in part | partial fix, cfd5534; residual in #96 |
| codex-5 | A throw in `readNightly`, the audit copy, or teardown writes no record | codex | holds | fixed, cfd5534 |
| codex-6 | Static analysis accepts `rules: []` | codex | holds | known limit, issue #97 (R17's rule semantics) |
| gemini-1 | Unchecked rule, path, and fingerprint reach the record and the decision key | gemini, codex (codex-3) | holds | fixed, cfd5534 |
| gemini-2 | Forging the latest nightly record defeats the comparison | gemini, codex (codex-4) | holds in part | as codex-4 |
| gemini-3 | A dummy `package-lock.json` beside `pnpm-lock.yaml` makes npm the stack audited | gemini | holds | fixed, cfd5534 |
| gemini-4 | `ruleOf` returns the whole `github_advisory_id` | gemini, codex (codex-3) | holds | fixed, 2dfd2c4 |

## codex-1: audit exit and report consistency

- **Checked:** `NPM_AUDITOR.parse` and `PNPM_AUDITOR.parse` in `packages/adapters/src/audit.ts`, and `#audit` in `packages/api/src/nightly.ts`.
- **Found:**
  - Both parsers accepted `{"auditReportVersion":2,"vulnerabilities":{},"metadata":{}}` and its pnpm equivalent.
  - `#audit` never read the exit code once a report parsed.
  - A string-valued `via` was skipped without checking that the package it names is in the report.
- **Changed:**
  - `parse` now takes the exit code, and a report is whole only where npm or pnpm exited 0 with nothing found or 1 with findings.
  - A `via` naming a package the report does not hold makes the report partial.
  - Four adapter tests cover these cases and failed before the change.
- **Not closed:** the report is still the pinned image's process output. Its completeness is the limit recorded in #96.

## codex-2: contact with the advisory host

- **Checked:** `#audit`. The teardown egress log was stored but never read.
- **Changed:** a parsed report counts only where the proxied egress log shows a connection to the policy's advisory host that was not refused. Otherwise the audit is refused as `advisory-unreachable`. The row `I5.nightly-audit-without-contact-is-refused` failed before the change.
- **Not closed:** a connection is evidence of contact, not of a complete response (#96).

## codex-3, gemini-1, gemini-4: what enters the record

- **Checked:** `ruleOf`. It tested an unanchored GHSA regex and returned the whole field.
- **Checked:** `#finding`. It stored raw values even when `recordFinding` refused them, and an unlocated finding skipped the schema entirely.
- **Changed:** `ruleOf` now returns the GHSA id it extracts and never the field around it.
- **Changed:** `#finding` checks scanner, rule, path, and line against `nightly-finding`, and the fingerprint against 64 hex characters, before any record holds them. An unlocated finding is checked with a stand-in line that is not kept. A finding that fails becomes `security-unrecordable`, naming each field and the rule it broke and none of its values. That variant is a new member of `NightlyFinding`, in `packages/vault/src/types.ts`, a gate path R13a declares.
- **Tests:** the row `I7.nightly-record-holds-checked-fields-only` feeds a scanner rule and path carrying a marker string. It failed when the schema check was removed by mutation.

## codex-4, gemini-2: the baseline's trust anchor

- **Found:** `#integrity` took the latest nightly record by date, and `readNightly` trusts the file name. A record stored under its own new hash, with the original removed, passed every check.
- **Changed:** the baseline is used only if the schedule's `job` firing for that date names its hash. Otherwise:
  - the substitution is a `record-drift` finding and a `baseline-unrecorded` refusal;
  - nothing is compared against it.
- **Changed:** every record a firing names must still be held.
- **Tests:** the row `I5.nightly-baseline-must-be-the-recorded-one` failed before the change.
- **Not closed:** both families are right that a party who can rewrite every file, the firing decisions included, defeats any check made from inside the store. That needs an anchor outside it, which is out of reach for this unit. Recorded as issue #96 with no owning unit yet. D-R13a-09 records the limit.

## codex-5: failures that wrote no record

- **Checked:** `readNightly` was called outside any catch, and in `#audit` the file copy and read, and the `destroy` in the finally block, were unguarded.
- **Changed:** `run` catches any failure no part handled and writes the record refused, as `job` / `job-failed`. `#integrity` reads the nightly records inside a catch and keeps its other checks going.
- **Tests:** the row `I5.nightly-job-failure-is-recorded` corrupts the previous record and failed before the change.

## codex-6: empty static-analysis rules

- **Checked:** `validateNightlyScanner` accepts any non-empty text.
- **Why not fixed:** R17's verification manifests pin rule text the same way, so the gap is in how R17's scanners treat rules, not in the nightly job. Whether Semgrep 1.95 refuses an empty ruleset was not verified here.
- **Outcome:** issue #97.

## gemini-3: two lockfiles

- **Checked:** `#audit` used `AUDITORS.find`, which puts npm first.
- **Changed:** a root holding more than one known lockfile, supported or not, is refused as `unsupported-stack`, naming them. The row `I5.nightly-audit-ambiguous-lockfiles-refused` failed before the change.

## After the fixes

- `pnpm typecheck` and `pnpm lint` are clean.
- All 13 nightly rows pass.
- The full acceptance rerun is recorded in the PR.
