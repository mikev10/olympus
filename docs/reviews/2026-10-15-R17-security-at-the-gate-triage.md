# Triage of the external reviews of R17, 2026-10-16

Two reviews of R17, security at the gate, run from one prompt and one bundle
(`2026-10-15-R17-security-at-the-gate-review-bundle.txt`, SHA-256
`43a91606360262b20accc1b50a066e01e134096bcc3b06cc9d804be07bbb91b5`, base
`6f1da42` (`reviewed/R15`), head `a1d5b8e`):

- `2026-10-15-R17-security-at-the-gate-review-codex.md`: gpt-6-astra, family
  codex, outcome `counted`
- `2026-10-15-R17-security-at-the-gate-review-gemini.md`:
  gemini-3.1-pro-preview, family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended, and the text beneath each header still does.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 7 | 3 | 4 | 0 | 0 |
| gemini | 1, plus an assessment | 1 | 0 | 0 | 0 |

One finding was raised by both families: codex-2 and gemini-1 describe the
same mechanism. One claim in gemini's assessment (`gemini-obs`) holds only in
part, against codex-4.

Each finding went to a verifier with fresh context, given the finding's text
and the repository, and not told who wrote the code. codex-5 and codex-6 were
settled by running them: temporary tests in `packages/adapters` and
`packages/api`, deleted afterwards. The rest were settled by reading the code,
because the real scanners need Docker. Only one step in the codex-2 chain was
left unread by its verifier, and the triage read it
(`packages/api/src/gate.ts:19`). No tracked file changed during verification.

## Summary

| Finding | Claim | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 / gemini-1 | A check with `deniesRule` and `required: false` satisfies the `test-design` denial requirement and can never fail `verify` | codex, gemini | holds | fix now |
| codex-1 | Removing scanner config names from the scan copy removes their bytes from inspection too, directories included | codex | holds | fix now |
| codex-4 | A credential in a file name reaches the Vault through a finding's path | codex | holds in part: the path channel is real; the diff record carries the same path whatever the findings hold | fix the findings channel; known limit for the diff path |
| codex-3 | `deniesRule` shows a label exists, not that a denied caller was exercised | codex | holds in part: true, and already a stated limit; the check manifest is the client's, not the agent's | known limit |
| codex-5 | Collapsing whitespace inside literals collides two different matched programs | codex | holds in part: only an in-place, whitespace-only variant of a finding the base already has (executed) | known limit |
| codex-6 | Marker counts per file miss a moved marker and a second marker on one line | codex | holds; consequence is low because both scanners run with suppression disabled (executed) | known limit |
| codex-7 | A provisioning failure after a scanner found a secret discards that iteration's findings | codex | holds in part: the record gap is real; the retry re-runs every check, and an exhausted retry parks | known limit |
| gemini-obs | Secrets are isolated from the Vault | gemini | holds in part: see codex-4 | answered by codex-4 |

## codex-2 / gemini-1: an optional denial check satisfies the rule

**Checked.** `denialRefusal` (`packages/api/src/security.ts:132`) builds the
set of denied rules from every acceptance or behavioral check that carries
`deniesRule`, and never reads `required`. Admission (`packages/api/src/validate.ts:382-387`)
requires only that `deniesRule` be a non-empty string on an acceptance or
behavioral check. A behavioral check need not declare `onBase`
(`validate.ts:405`). At the gate, `requiredShortfall`
(`packages/api/src/gate.ts:19`) returns no shortfall for a check that is not
required.

**Found.** The construction holds as both reviewers wrote it. A behavioral
check with `deniesRule: 'owner-only'`, `required: false` and no `onBase` is
admitted, satisfies `test-design`, gets no base run, and fails every `verify`
without effect. The spec says a denial check "gets R15's base run like any
other acceptance check", so it also departs from the spec.

**Change.** Admission refuses a check that names `deniesRule` unless it is
`required: true` and declares `onBase`. A test shows each refusal, and shows
the optional form passing `test-design` before the fix.

## codex-1: the scan copy drops the bytes it strips

**Checked.** `removeNamed` (`packages/api/src/scan.ts:41-52`) removes every
entry whose base name is in the scanner's `inTreeConfig`
(`packages/adapters/src/security.ts:145,168`: `.gitleaksignore`,
`.gitleaks.toml`, `.semgrepignore`), at any depth, with `recursive: true`.
Nothing else in `packages/api/src` reserves or refuses those names. The
tamper analysis reads markers, not names. `protectedPaths` is not populated by
default, and it only escalates the `integrate` exit anyway.

**Found.** It holds. A credential written into `.gitleaks.toml`, or into any
file under a directory named `.gitleaksignore`, is never scanned for secrets.
TypeScript under a directory named `.semgrepignore` is never scanned by
Semgrep. Either passes `verify`. D-R17-03 chose to stop the scanners reading
these files. It did not choose to stop them inspecting the bytes, and nothing
records that consequence.

**Change.** The scan copy renames each matching entry to a name the scanner
does not read, instead of deleting it. The runtime refuses when that name
already exists. The bytes are still scanned and never read as configuration.
Base and `verify` copies are renamed the same way, so fingerprints stay
comparable. Stand-in scanner tests cover a secret inside `.gitleaks.toml` and
a flagged file under a `.semgrepignore` directory.

**Assumption, since verified.** That Semgrep scans files under a renamed
dot-directory. After the fix, the Docker row
`I5.static-analysis-runs-offline-on-pinned-rules` was extended with a sink
under `lib/.semgrepignore/`, and the pinned image reported it at its set-aside
path.

## codex-4: a credential in a file name

**Checked.** `renderFindings` (`packages/api/src/security.ts:174-177`) stores
the rule, `location.path`, the line and the fingerprint. The secret itself is
held only as the input to the fingerprint (`packages/adapters/src/security.ts:84`).
The path is stored verbatim, and the same `Finding` objects stay in
`result.findings` (`packages/api/src/scan.ts:108`). gitleaks reports `File` as
metadata, so a file named after the credential it contains is reported with
the credential in its path. The diff record stores `{ path, change }`
(`packages/api/src/line.ts:1305`), so that path reaches the Vault whatever the
findings hold. Raw scanner `stderr` is stored too (`scan.ts:105`), under
`--log-level error` and `--quiet`. The verifier could not run it without
Docker.

**Found.** It holds in part. The findings channel is one R17 added, and the
value it leaks is the value the scan found. D-R17-02 says "no secret reaches
the Vault", and that is not true for this construction. The diff-path channel
is older than R17 and does not depend on the scan at all. An agent can put any
string in a file name.

**Change.** When a secret finding's path contains the secret's value, the
gitleaks parser replaces the value with the finding's fingerprint, so the
rendered path never carries it. A test covers a credential-named file. The
diff-path channel becomes a known limit: a new D-R17 entry with an issue
naming the owner of the evidence record. `stderr` is part of the same entry,
as unverified.

## codex-3: a label, not an exercised denial

**Checked.** The positive control for `RULE_NEEDS_A_DENIAL_CHECK`
(`packages/conformance/src/registry/security.ts:193`) is a required behavioral
check whose command is `process.exit(0)`. It satisfies the requirement and
contacts nothing.

**Found.** It holds in part. The code enforces that each rule is named by a
locked check, and nothing more. No code could show that a command reaches the
product. The unit's stated limit (`docs/plan/DECOMPOSITION.md:1254-1258`)
already says the denial checks are only as complete as the security part the
person approved. The check manifest is the submitting client's, which the
person approves at `test-design`, and the build agent cannot change it after
the lock. So this is a weak guarantee resting on human review. It is not a
hole the agent can use.

**Outcome.** A known limit, as codex's item 7 phrased it: the requirement is
declared coverage, not exercised authorization. A D-R17 entry states it, so
nothing describes the check as more. The codex-2 fix does not close it.

## codex-5: whitespace collapsed inside literals

**Checked and run.** `staticFingerprint` (`packages/adapters/src/security.ts:89-90`)
hashes the rule, the path, and the matched text with `\s+` collapsed. The line
is left out by design (D-R17-02). `eval("a  b")` and `eval("a b")` gave the
same fingerprint, and `newFindings` returned no new finding.

**Found.** It holds in part. `newFindings` (`security.ts:191`) counts
occurrences, so an extra copy still fails as new. The collision hides only an
in-place, whitespace-only rewrite of a finding the base already had, in the
same file and under the same rule. That is a finding the base already
accepted, give or take literal whitespace.

**Outcome.** A known limit, recorded beside D-R17-02. The tolerance for
reformatting was the point of collapsing whitespace. Language-aware
normalization would be the reversal.

## codex-6: marker counts

**Checked and run.** `markersAdded` (`packages/api/src/tamper.ts:239-273`)
counts the lines carrying each marker, per file. A marker counts as added
when the head's count exceeds the base's. Run: a marker moved from a comment
to a code line gave `[]`. A second marker on a line that already carried one
gave `[]`. A second marker-bearing line in the same file was flagged.

**Found.** It holds as written. Its consequence is low.
`--ignore-gitleaks-allow` (`packages/adapters/src/security.ts:150`) and
`--disable-nosem` (`:173`) mean a suppressed finding is still reported, and it
fails as new wherever the marker sits. What a moved marker escapes is the
`suppression-added` violation, and with it the `human-required` escalation at
`integrate`. D-R17-04 keeps the diff read as the control for an image that
drops those flags. Within that role, counts per file were the chosen
semantics, so that moving existing lines does not fail a change.

**Outcome.** A known limit, recorded beside D-R17-04: "added" means a higher
count of marker-bearing lines per file.

## codex-7: findings lost on a later provisioning failure

**Checked.** In `verify`, a provisioning failure returns `spendRetry` from
inside the check loop (`packages/api/src/line.ts:1100-1104`). `results` is
local, so the write at `:1202` and the `gate-failed` decision at `:1207-1211`
are not reached. `spendRetry` (`:564-574`) re-enters `verify`, which re-runs
every check. Once the retries are exhausted, `park` (`:260-269`) records a
`station-refused` decision and the run stops. The non-security provisioning
failure at `:1119-1121` has the same shape.

**Found.** It holds in part. That attempt's findings are not recorded. The
secret is re-detected on the next attempt, and an exhausted retry parks the
run, so nothing advances or merges. The record lacks a "found" entry only when
no later attempt gets a clean provision, and then it shows a park.

**Outcome.** A known limit, in a new D-R17 entry. Writing partial results
before a retry would change the shape of the enforcement record for every
infrastructure failure, which is outside this unit.

## gemini-obs: the assessment

Gemini's description of the suppression flags and the base comparison agrees
with what the triage found (codex-6). Its statement that only the rule,
location and fingerprint reach the Vault is correct about what is rendered.
It misses that the location's path is agent-controlled (codex-4). Items 1, 3,
4 and 7 of the prompt came back empty from gemini.
