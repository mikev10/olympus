# Triage of the A-R40-02 external reviews, 2026-11-23

Two counted reviews of `2026-11-23-A-R40-02-readiness-scan-admission-review-bundle.txt` (SHA-256 `984dd867…0e0e9`), the A-R40-02 amendment and the tooling commit merged to `v2` after `reviewed/R53`, reviewed beside R28 because the two together exceeded the runner's payload ceiling. Codex (gpt-6-astra) and Gemini (gemini-3.1-pro-preview), each on its first run. Each finding was checked against the code by a verifier given only the finding and the files.

**Counts.** Codex 1 finding, Gemini 1. None raised by both. Neither family reported an admission or resume bypass; both assessed the missing-scan refusal, the subtractive ceiling, and the check order as sound.

| Verdict | Codex | Gemini |
|---|---|---|
| Holds, fixed here | 1 (codex-1) | 0 |
| Does not hold | 0 | 1 (gemini-1) |

| Finding | One line | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | the unscanned-resume refusal is asserted only through `admissionRefusal`, never through `resumeRun` | Codex | holds | fixed, 9549f48 |
| gemini-1 | the "record at its ceiling" check feeds an L1 run an L2 ceiling, so a `>`/`>=` bug would pass | Gemini | does not hold | none |

## codex-1: the resume path

**Checked.** In `I5.resume-holds-the-recorded-readiness-ceiling`, the `not-scanned` and pre-R40 records were refused only by calling `admissionRefusal` directly; the one `resumeRun` drove a scanned record with ceiling 0. No other test resumed an unscanned record. Confirmed.

**Fix (9549f48).** The assertion now resumes a `not-scanned` record and a record with no readiness term, each at L1, and requires `readiness-unscanned` with the run's state unchanged. Shown failing against a `resumeRun` made to let `readiness-unscanned` through, then reverted.

## gemini-1: the ceiling boundary

**Checked.** The record that check reads comes from an `admitRun` with `requestedLevel: 1` and `readiness: port(1)`, so the run sits exactly at its ceiling; `ADMISSION_REFUSES_ABOVE_THE_READINESS_CEILING` does the same. `admissionRefusal` compares with `>`; changing it to `>=` fails both. The reviewer read the rig's default L2 port in place of the `port(1)` this assertion passes.

**Verdict.** Does not hold. No change.

## Out of scope noted by Codex

Codex observed that the fixed-ceiling ports given to rigs and the benchmark prove nothing about a repository's readiness, and that the bundle did not include enough production wiring to show none is reachable from the service. Under the stated trust boundary those ports are trusted rig components, and A-R40-02's decision record names them as such; this is not a finding against the amendment.
