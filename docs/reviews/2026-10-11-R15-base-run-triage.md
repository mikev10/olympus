# Triage of the external reviews of R15, 2026-10-11

Two reviews of R15 (acceptance checks run on the base before build), run from
one prompt and one bundle (`2026-10-11-R15-base-run-review-bundle.txt`,
SHA-256 `12ac8e51720e701a0f2d53b4b83faf953ac013ee7deff49d7bb2a5b9ad48e248`,
base `2dc1f11` `reviewed/R2`, head `3f61372`):

- `2026-10-11-R15-base-run-review-codex.md`: gpt-6-astra, family codex,
  outcome `counted`
- `2026-10-11-R15-base-run-review-gemini.md`: gemini-3.1-pro-preview, family
  gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended.

The triage also records one finding no reviewer raised, `triage-1`, found
while codex-1's fix was checked against the code. It is counted apart from
the reviewers' findings.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 1 numbered, 1 remark | 2 | 0 | 0 | 0 |
| gemini | 6 | 0 | 4 | 2 | 0 |

No finding was raised by both families in the same form. codex-1 and gemini-4
share a construction (a file name built up inside the command), and codex's
closing remark is close to gemini-1; they are paired below where the mechanism
is shared, not the conclusion. Every finding was checked against the code by a
reviewer with fresh context that was given the finding and the files, and the
load-bearing claims were then re-read at the cited constructs. codex-1,
gemini-2 and gemini-4 were run end to end through `startRun` on the hello rig
with the stub sandbox (scratch probes outside the repository; no tracked file
changed). The others were settled by reading the code and its existing tests.
`triage-1` was found and run the same way.

The first recommendation for codex-1 was to record it as a known limit. The
maintainer rejected that: the gap makes the evidence record false, and that
the record is not false is the claim the product makes. The decision was
taken again on merit, and both codex-1 and `triage-1` were fixed on the unit
branch as an amendment to R15 (D-R15-04, D-R15-05).

## Summary

| Finding | Claim | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A suite count from the tree's inventory stands in for tests the command never ran | codex | holds | fixed: suite checks run the base framework over what they name (D-R15-04) |
| codex-obs | The base record's reader accepts a result with no `suiteCount` and a non-finite exit code | codex | holds | fixed (D-R15-06) |
| triage-1 | The build can rewrite the runner under `node_modules` and turn a failing check green, unflagged | none: found in triage | holds | fixed: `node_modules` writes are not carried, are recorded, and escalate (D-R15-05) |
| gemini-1 | The adversarial question is wrong: exit codes are enforced, meaning is not | gemini | holds in part | no change; folds into codex-1 |
| gemini-2 | A test file missing on the base fails, which counts as a reproduction | gemini | does not hold (premise); residue is a stated known limit | reject |
| gemini-3 | Editing a `package.json` script makes a behavioral check pass unflagged | gemini | does not hold as stated | reject |
| gemini-4 | A built-up file name escapes protected-path escalation | gemini | holds in part | already recorded (D-R15-03, D-P7-10); no change |
| gemini-5 | `value.checks as CheckSpec[]` keeps unvalidated properties | gemini | holds in part | reject (pre-existing, inert) |
| gemini-6 | `declaredChecks`' predicate tests `onBase` alone, not `kind` | gemini | holds in part | reject (latent only) |

## codex-1: an inventory counted as an execution

**Claim.** `runOnBase` counts the tree's suites once and attaches that count to
every declared check's result; `baseMismatches` accepts it without anything
showing the command loaded those suites. A required acceptance check declared
`'fails'` with `expectedSuiteCount: 1`, whose command only tests whether a file
exists, passes the base run and `verify` while no test ever runs. gemini-4's
built-up name keeps that file out of protected-path analysis.

**Checked.** `countSuites` (`packages/api/src/verification.ts:59`) enumerates
suites from files through the adapters and never sees the command; it is called
once per base run (`packages/api/src/line.ts:365`) and its number attached to
each result through `suiteCountFor` (`:387`). `baseMismatches`
(`packages/api/src/base.ts:42-45`) tests only that the count is known and not
below `expectedSuiteCount`. `parseManifest` checks that a command is an argument
vector; nothing ties it to a runner or to the admitted acceptance tests.

**Ran.** A rig with the conformance fixture's `withSuite` (a vitest
`package.json` and an empty test file) and one required acceptance check
declared `'fails'`, `expectedSuiteCount: 1`, command `node -e` testing for
`['hello','txt'].join('.')`. Base: exit 1, suites 1, no mismatch. `verify`:
exit 0, suites 1; every tamper list empty, `protectedPathsTouched: []`. The run
stopped at `integrate` only for the policy's L1 approval, with no escalation.

**Found.** The finding holds. The count is an inventory, not evidence of
execution. Two qualifications decide its weight:

- **Who can exploit it is the manifest's author, not the build agent.** The
  command is admitted, hash-locked at `test-design`, and refused as tampering if
  build changes it. Build gains only from a check that was weak when written.
- **It is not R15's mechanism.** `verify` has counted and attached the same way
  since P6 (`line.ts:1021`, `:1049`); `gate.ts`, `verification.ts` and
  `tamper.ts` are unchanged in the range. D-P8-13 already states that the count
  comes from configuration alone and does not see filters in the command, and
  D-P7-11 gives "what an unchanged assertion executes" to M3.

What is R15's own is the claim. The spec says "a test file the runner never
loaded is not a reproduction", and `base.ts:22-25` says a short count means
"the runner may never have loaded the test". The code establishes that the
tests exist, not that the command loaded them. The spec and the comment claim
more than the runtime does.

**Outcome: fixed (D-R15-04).** Confirmed by the maintainer, covering both
suite kinds.
- **What changed:** a `unit` or `acceptance` check pins no command. The
  runtime starts the base's installed framework (`TestFrameworkAdapter.runner`,
  `invocation`) over exactly the locked tests an acceptance check names, or
  over every configured suite for a unit check. The recorded count is what
  that runner selects in the tree it ran over (`suitesRun`). Admission
  refuses a pinned command, a named test that is not an admitted acceptance
  test or that the framework does not run as a suite, and a set the
  framework's selection rule would widen (`suiteBindingProblems`).
- **The selection rules come from each runner's published source.** vitest's
  model is held to vitest 4 itself (`packages/api/test/runner-agreement.test.ts`).
- **The rejected alternative:** a report written by the runner is produced
  inside the process that runs the code under test, so the change could forge
  it. It was rejected for that reason.
- **Assertion:** `I5.suite-check-runs-what-it-names` runs codex's
  construction and has it refused at admission. The probe above, run against
  the code as reviewed, is the same construction passing.

## codex-obs: the base record's reader is lax where the rest of the Vault is strict

**Claim.** Codex's item 4 remarks, without numbering it, that `baseRunProblem`
permits a result lacking `suiteCount` and a non-finite numeric exit code, and
that the stub vault checks only provenance and write-once. Codex declined to
call it a bypass, since only the runtime writes the record.

**Checked.** `baseRunProblem` (`packages/vault/src/local/vault.ts`, new in the
range) requires each result to carry a string `checkId` and
`typeof exitCode === 'number'`, and nothing about `suiteCount`. In
`baseMismatches` a missing `suiteCount` reads as `undefined`, so
`counted === null` is false and `undefined < n` is false: the `suite-count`
mismatch never fires on a suite check whose count is absent. A `NaN` or
`Infinity` exit code is accepted as a number.

**Found.** The finding holds as a defect of the reader; its consequence is
latent. The only writer is the runtime (`line.ts:387` writes a number or null,
the exit code comes from `sandbox.exec`), `collectedBy: 'runtime'` is enforced,
and no agent writes the Vault. But the reader exists to refuse a record that is
not whole, and this one would pass a record that silently disables the
suite-count rule. That is a fail-open on the one rule R15 adds to the read.

**Outcome: fixed (D-R15-06).** `isBaseResult` requires an integer exit code
and a suite count that is a non-negative integer or null. The two new
assertions in `packages/vault/test/local.test.ts` failed against the code as
reviewed and pass now.

## triage-1: the change could replace its own judge

**Found** while checking codex-1's fix against the code; no reviewer raised
it. A task's diff left out `.git` alone (`packages/api/src/workspace.ts`), so
what a builder wrote under `node_modules` was carried into the tree `verify`
ran over. Tamper analysis skips `node_modules` (`packages/api/src/tamper.ts`,
`skipDirectory`), so even a runner the command names (D-P7-10) was unflagged.

**Ran.** The hello rig with vitest declared, and a check whose command runs a
script under `node_modules`. The builder rewrote that script to exit 0. Base:
exit 1. `verify`: exit 0, `protectedPathsTouched: []`, no escalation. Only
L1's own approval stopped the run.

**Found.** It holds, and it is the worst defect in the triage. The runner is
something the agent under judgment can write, which is what I3 forbids. It
predates R15, and it defeats what R15 exists to show.

**Outcome: fixed (D-R15-05).** The maintainer chose to drop these writes and
record them, over refusing the task and over a read-only mount.
- **What changed:** nothing a task writes under `node_modules` is carried, so
  every check runs over the base's dependency trees. What was written is
  recorded in `EvidenceBundle.notCarried` by package and escalates
  `integrate`.
- **Assertions:** `I3.dependency-trees-are-the-bases`, plus two line tests.
  Each failed with the old carry rule restored: the builder that rewrote the
  runner left its task `passed`.
- **Known limit:** a change that needs a dependency the base lacks fails
  `verify` until the runtime installs from the lockfile, which is to be filed as an
  issue.

## gemini-1: the framing

**Claim.** The records always show a check failing on the base and passing
after, because exit codes are enforced; the real question is whether the agent
can satisfy the gate without the semantic intent.

**Found.** Holds in part. The records do faithfully report exit codes, and an
exit code is not proof that the right test failed for the right reason. That is
R15's stated known limit (owned by M3), and codex-1 shows a sharper form of it.
"Always show" overstates: a check that does not start is recorded as unstarted
and refuses (`base.ts:33-35`, the `I5.unstarted-base-check-refuses` entry).

**Outcome: no change.** It is covered by the known limit and by the decision on
codex-1.

## gemini-2: a missing test file counted as a reproduction

**Claim.** The base run copies the base without the diff that adds the
acceptance tests, so a test script submitted with the change is missing there,
`node new_test.js` exits non-zero, and that counts as reproducing the defect.

**Checked.** The base snapshot is the admission workspace
(`packages/api/src/run.ts:519`); the acceptance tests and manifest are admitted
artifacts in it, and there is no diff at `test-design`. `runOnBase` refuses a
base in which any admitted artifact is missing or changed (`line.ts:363-364`,
recorded as `lock-tamper`), and `verify` refuses if build changes one
(`line.ts:1019-1020`).

**Ran.** `["node","new_test.js"]` naming an unadmitted script absent from the
base: recorded as a result with exit 1 and "Cannot find module", not as
unstarted. Build creating that file: a protected-path touch under D-P7-10,
escalated at `integrate`.

**Found.** The premise does not hold: admitted tests are in the base and locked.
What remains, a command naming a script that is not admitted and is absent from
the base, counts as a failure; that is exactly the known limit the prompt and
the spec state ("a module a feature has not built yet"), and build supplying
the script is escalated.

**Outcome: reject.**

## gemini-3: a package script edited to pass

**Claim.** A behavioral check running `npm run test:behavioral` passes after a
diff rewrites that script in an unlocked `package.json`.

**Checked.** `protectedPathsTouched` (`packages/api/src/tamper.ts:162-169`)
includes every configuration file the manifest adapter reports, which covers
`**/package.json` (`packages/adapters/src/config-files.ts`), and
`packages/api/test/tamper.test.ts:155` asserts a `package.json` touch is
reported. The touch is carried into the `integrate` gate as an escalation
(`tamper.ts:202`, `line.ts:183`) under every station's
`protectedPathPolicy: 'escalate'`.

**Found.** Does not hold as stated: the configuration is not unflagged; the
edit stops the run at `integrate` for a human, naming the path. Escalation
rather than refusal is P7's design (D-P7-01), unchanged in this range.

**Outcome: reject.**

## gemini-4: a built-up file name escapes escalation

**Claim.** A command that builds a file name (`['my','bypass.txt'].join('')`)
keeps it out of `analyzeTamper`, so the diff can add the file and the check
passes at `verify` after failing on the base.

**Ran.** The same reproduction with the name built up: `protectedPathsTouched:
[]`. Spelled out: `["hello.txt"]`, escalated at `integrate`.

**Found.** Holds in part. The evasion is real; `commandPaths`
(`tamper.ts:55-60`) splits on whitespace, `=` and quotes only. It is not
"tautological": the command is written by the manifest's author and locked
before build. What is bypassed is an escalation, not a refusal. The case that
matters, a command that runs a script through a built-up name so build can
rewrite it unflagged, is the limit of D-P7-10's protection by name, and R15
already records the trick and its interaction (D-R15-03) and hands the question
to D-P7-10 and R16.

**Outcome: no change.** Already recorded.

## gemini-5: the manifest cast

**Found.** Holds in part. The cast is at `packages/api/src/validate.ts:177` and
dates from 22079d28 (2026-09-23), before this range. Downstream code reads
`id`, `command`, `required`, `timeoutMs`, `expectedSuiteCount`, `kind` and
`onBase`, and the manifest is hash-locked, so extra properties are inert.
(`kind` is not checked against the known set; a bogus kind is treated as a
non-suite, non-declarable check and an `onBase` on it is refused, so it is not
a route here. Pre-existing.)

**Outcome: reject.**

## gemini-6: the `declaredChecks` predicate

**Found.** Holds in part. `base.ts:15` narrows on `onBase !== undefined` alone.
No path today carries `onBase` on another kind: `ctx.checks` is reached only
through `parseManifest`, including on resume (`run.ts:284`, `:627`), and
`checkProblems` refuses `onBase` on any other kind as `not-declarable`. Adding
the kind test would fix no live defect.

**Outcome: reject.**
