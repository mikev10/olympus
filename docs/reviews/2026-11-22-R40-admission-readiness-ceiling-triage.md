# Triage of R40's external reviews, 2026-11-22

Two reviews, both `counted`, neither rerun: codex (gpt-6-astra, 63,422 input
tokens against a floor of 39,211) and gemini (gemini-3.1-pro-preview, 54,907
against the same floor). Each reply's SHA-256 matched its manifest's
`replySha256` before its header was prepended. The replies were committed
untouched in a67b9c4; that commit first landed as 7624eb2 on another
session's branch (`amend/r53-image-id`), because the shared checkout was
switched under this session, and was cherry-picked here with the same bytes.

**Counts.** Codex raised 5 findings: 2 hold (codex-4, codex-5), 2 hold in
part (codex-2, codex-3), and 1 holds as described but is the specified design
(codex-1); none was wholly wrong. Gemini raised 4: 1 holds in part
(gemini-1), 2 hold as described but are the specified design (gemini-2,
gemini-3), 1 holds in part (gemini-4). Findings both families raised: 2
mechanisms (no scanner, no enforcement; the base commit read twice).
Findings that did not hold in the part that decided severity: gemini-1's
branch-pointer route, codex-3's missing-command example, gemini-4's
exhaustion consequence. Every finding was checked against the code; codex-2
and gemini-1 by experiment, the rest by reading and by a fresh-context
checker, and each applied fix by a test shown failing first where one could
fail.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 / gemini-1 | The scan resolves the base commit again after the snapshot, so the two can read different trees | both | holds in part: the moving-branch route does not hold, the replace-ref route does | fixed, 4c8de92 |
| codex-1 / gemini-2 / gemini-3 | A run with no scan port, or a record before R40, gets no readiness refusal, and conformance asserts that | both | holds as behaviour; it is what F1 specifies | not fixed; put to the maintainer |
| codex-3 | The install and clean fixtures accept any non-zero exit | codex | holds in part: exit 127 does not match; any other failure did | fixed, 1b95f03 |
| codex-4 | The resume assertion never calls `resumeRun` | codex | holds | fixed, 34978a0 |
| codex-5 | `recorded` reads every exception as "no state" | codex | holds | fixed, fa77484 |
| gemini-4 | The report cache is unbounded, a memory-exhaustion route | gemini | holds in part: unbounded, yes; exhaustion is impractical | fixed, 09e8473 |
| codex framing | Admission-time ceiling versus resume-time ceiling should be stated | codex | holds as an observation; by design | recorded, D-R40-08 |

## codex-2 / gemini-1: the base commit read twice

**Checked.** `snapshotBase` (`packages/api/src/workspace.ts:242-247`)
resolves `baseCommit` and refuses it unless it already is its own full object
name, so a branch name such as `main` never reaches `readinessAt`. Gemini's
construction (move the branch pointer between the snapshot and the scan) and
the branch half of Codex's do not hold. Codex's own caveat — "how repository
replacement mechanisms are handled" — does. Built in a scratch repository:
commit A with `f` = `benign`, commit B with `f` = `malicious`,
`git replace A B`. `git rev-parse A^{commit}` printed A, and
`git cat-file -p A:f` printed `malicious`; with `--no-replace-objects` it
printed `benign`. The target repository is the party's to control, so a
replace ref added or removed between the snapshot and the scan makes one
commit name read as two trees, and the recorded ceiling describes a tree the
run does not run on.

**Fix.** Every git invocation in `packages/readiness/src/tree.ts`, which
both the snapshot (`materialize`, via `workspace.ts:33`) and the scan use,
passes `--no-replace-objects`. A commit name then reads its own content at
every moment, so the two reads see one tree. The test `reads the commit it
names, never a replacement for it` failed against the old code (`['f.txt',
'g.txt']` where `['f.txt']` was expected) and passes. **Option rejected:**
scanning the snapshot's tree rather than the commit, which would change the
scan's interface and leave the recorded commit name still ambiguous under
replace refs. This also makes D-R40-04's "a commit's tree cannot change" true,
which it was not before (D-R40-07).

## codex-1 / gemini-2 / gemini-3: no scan, no enforcement

**Checked.** `readinessAt` records `not-scanned` with `no-scanner` when the
request carries no port, and `admissionRefusal` refuses only over a `scanned`
term (`packages/api/src/run.ts`), so such a run is bounded by the policy
terms alone; `I4.readiness-absence-is-recorded` asserts exactly that. Gemini's
"silently elevates the limit to L3" overstates it: an unscanned L3 run is
still bound by the policy caps and refused at admission while its adapters
lack any control. Codex's "whether the production host always supplies a
scanner is not established" is answered in the code: `factory-host` always
builds one and hands it to the server (`packages/api/src/host/main.ts:127`).

**Why not fixed.** The behaviour is the one `docs/plan/F1-spine.md` states:
"The term is present only when a scan ran, and its absence leaves the other
three unchanged rather than reading as clearance. Absence must be a state the
type makes explicit." D-R40-03 chose it on that ground. Both families read
the fail-closed invariant as requiring a scan above L0, and that reading is
defensible: a library caller or a server without a scanner admits with no
readiness check at all. Changing it changes the spine, which is an amendment
and not a review fix. Put to the maintainer with a recommendation (D-R40-09).

## codex-3: fixtures that accept any failure

**Checked.** Both rows used `/ exited [1-9]\d*: /`. The exit-127 example does
not hold: `judged` (`packages/readiness/src/scan.ts:403-409`) writes
`exited 127 (command not found): …`, which the pattern does not match. Any
other non-zero exit did match, so an install that failed for the network, or
a build that failed for another reason, passed the fixture.

**Fix.** The patterns name the failure each fixture was built for, read from
a scan of the fixtures: the install's tail carries npm's `npm help ci` usage
block, which `npm ci` prints when it refuses a lockfile out of step with its
manifest; the clean build's tail carries Node's `code: 'ENOENT', syscall:
'access', path: 'dist/prebuilt.js'`. The probe that read those details set
both patterns to one that cannot match, which failed with the details shown,
and the fixture run passes with the new patterns. **Residual:** the detail
keeps 400 characters of output, so npm's "in sync" line itself is cut; the
usage block identifies the refusal class, not the sentence.

## codex-4: the resume assertion never resumed

**Checked, by the fresh-context checker:** `I5.resume-holds-the-recorded-readiness-ceiling`
called `admissionRefusal` on edited records and never `resumeRun`; deleting
the call in `resumeRun` would have left it green.

**Fix.** The assertion now records a run whose only admission record holds a
ceiling below its level (the Vault admits a run once, so it is a second run
id with the first run's state), calls `resumeRun`, and requires
`readiness-refused` with the run's state unmoved. With `resumeRun`'s
`admissionRefusal` call disabled, it fails (the resume runs on and stops
later, on the missing base); restored, it passes.

## codex-5: every exception read as absence

**Checked.** `recorded` caught everything. The Vault exports `isNoRunState`
(`packages/vault/src/errors.ts:8`), documented as the only failure that means
absence. **Fix.** `recorded` returns false only for that error and rethrows
any other.

## gemini-4: the unbounded cache

**Checked.** The map had no bound. Each new entry needs a full scan of a
commit that exists in the checkout, minutes of sandboxed install and tests,
and the route needs the host's token, so exhausting memory through it is
impractical; the defect is real and the consequence is not. **Fix.** The
cache keeps at most 64 reports, dropping the oldest (`remember`, unit
tested).

## Codex's framing note: admission time and resume time

Codex asks that the contract say whether the ceiling binds at admission or
at every resume. It binds at admission and is re-read from the record on
resume, as the adapter controls are (D-P8-03): a resume does not rescan, so
protection removed while a run is stopped is not seen by it. Recorded as
D-R40-08. Not fixed: a rescan on every resume is a new behaviour, and whether
the line should re-check mutable prerequisites at resume is a question for
the units that own resume and integration.

## Not applied

- codex-1 / gemini-2 / gemini-3: a spine amendment, for the maintainer
  (D-R40-09).
- Codex's note on malformed scanner results (`level: undefined`): the scanner
  is a trusted component, as the prompt stated; rejected as outside the
  attacker's reach, with no change.
