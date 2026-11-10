# Triage of R35's external reviews, 2026-11-10

Reviews: `2026-11-10-R35-runnable-release-review-codex.md` (gpt-6-astra,
counted, 64,815 input tokens against a floor of 37,897) and
`2026-11-10-R35-runnable-release-review-gemini.md` (gemini-3.1-pro-preview,
counted, 56,186 against 37,897). One run per family; no reruns. Both replies
matched their manifests' `replySha256` before their headers were prepended.

**Counts.** Codex: 9 findings; 8 hold in full, 1 holds in part. Gemini: 5
findings; all hold. None of the 14 failed to hold. Four defects were raised
by both families independently (codex-2/gemini-4, codex-4/gemini-1,
codex-7/gemini-3, codex-8/gemini-2), so the 14 findings are 10 distinct
defects. All 10 were fixed on the unit branch. One part of one finding
(codex-4's second claim) is rejected as out of scope, and one consequence of
codex-9 is filed as issue #131.

Every finding was verified before any fix: by one fresh-context subagent
given each finding's text and the files it cites, and by running the case
where it could be run. Each fix that changes covered behaviour was shown
failing against the old behaviour first.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | Release script's JSON quoting under `shell: true` lets a POSIX shell expand `$()` and backticks | codex | holds | fixed, f717046 |
| codex-2 / gemini-4 | Packaged assertion runs `node <target>`, never the `node_modules/.bin` commands the README puts on PATH | both | holds | fixed, 0f88c99 |
| codex-3 | Deleting start-up's symlink-probe call fails no test | codex | holds | fixed, 0f88c99 |
| codex-4 / gemini-1 | Version regex matches the changeset body or a YAML comment | both | holds; codex-4's second part (installed version is 4.5.16) rejected | fixed, 86d32de |
| codex-5 | Start-up lists environment problems, then the endpoint file and symlink in a later start; a short token passes the table | codex | holds | fixed, e53803f |
| codex-6 | Help tests check the table against itself, not what the parser sends | codex | holds in part | fixed, b15c689 |
| codex-7 / gemini-3 | Above-cap examples test passes on any non-201 | both | holds; worse than stated | fixed, 564202b |
| codex-8 / gemini-2 | README test never checks the Secret column, and not by position | both | holds | fixed, 2a3f11b |
| codex-9 | Generated install manifest named `olympus-local-release` | codex | holds; the scan it cites does not cover `scripts/` | fixed, f717046; scan gap filed as #131 |
| gemini-5 | `as unknown as ReadinessReport` hides contract drift in the route test fixture | gemini | holds | fixed, 6015d20 |

## codex-1: shell expansion in the release script

**Checked:** `scripts/local-release.ts`, `run`. It built one command line with
each argument wrapped by `JSON.stringify` and ran it with `shell: true`. Run
under Git's bash, `echo "x-$(echo PWNED)"` printed `x-PWNED`; under `cmd.exe`
it did not expand. The subagent agreed on the mechanism and noted that every
argument is literal except the target directory, which the caller names. So
the consequence is a path with `$` or a backtick being expanded or run, on
POSIX, from the caller's own argument. It is a correctness and safety defect
in a tool, not a remote exploit.

**Fix:** off Windows, `spawnSync` with an argument array and no shell. On
Windows, where `pnpm` and `npm` are `.cmd` shims that only a shell starts, an
argument containing a character `cmd.exe` interprets (`" % ^ & | < > !` or a
newline) is refused, never escaped. Rejected: escaping for `cmd.exe`, which has
no quoting it honours in every position. New tooling test
`scripts/test/local-release.test.ts`: a `$(...)` and backtick argument arrives
as text, and on Windows each interpreted character is refused.

## codex-2 / gemini-4: the linked commands were never run

**Checked:** `packages/conformance/src/registry/release.ts`, `installedBin` and
every spawn. Both executables ran as `process.execPath <manifest target>`; no
code looked at `node_modules/.bin`. Codex labels it factually wrong, medium;
Gemini a tradeoff, low. Both describe the same mechanism.

**Fix:** `linkedBin` requires `node_modules/.bin/<name>` (`.cmd` on Windows)
and every command runs through it: through a shell for the Windows shim, and
directly elsewhere, where the link's shebang and executable bit are what run.
The manifest checks (JavaScript target, shebang, inside the install) stay.
Teardown and timeouts stop the whole process tree on Windows, since the shim's
child is `cmd.exe`. During the mutation run an orphaned host proved that
killing `cmd.exe` alone was not enough; it was stopped by hand.
**Shown failing:** with `--no-bin-links` added to the install, the assertion
fails with "npm linked no factory-host into node_modules/.bin".

## codex-3: the symlink probe's call was untested

**Checked:** the probe is tested as a helper (`host-config.test.ts`); the only
source check of `main.ts` was about `process.env`; the packaged assertion runs
where links work. Deleting the call failed nothing.

**Fix:** a phase of the packaged assertion starts the fully configured host
with `FACTORY_TREES` under a regular file, which can hold no link, and requires
the refusal before it listens. **Shown failing:** with the probe's guard in
`checkStartup` changed so it never runs, the assertion fails.

## codex-4 / gemini-1: the version check could be satisfied by prose

**Checked by running:** the regex matched both a front matter followed by a
body line `"olympus-ai": major` and a commented `# "olympus-ai": major` inside
the front matter. Gemini rates it high, Codex medium. The consequence is that
a changeset bumping nothing could stand in for the pending major. Today P9's
`.changeset/p9-cli.md` holds a real one, so nothing is wrong yet. Medium.

**Fix:** `bumpsMajor` reads only the lines between the first two `---` lines,
skips blanks and comments, refuses any other line not shaped
`"<package>": <bump>`, and never reads the body. A test covers both bypasses.
Every existing changeset parses under the stricter reader.

**Rejected part:** "the locally installed CLI is still 4.5.16." True, and by
design: versioning happens at release, and release automation is out of scope
(D-R35-04). The check proves the next release cannot be 4.x, which is the
claim made.

## codex-5: problems surfaced across starts

**Checked:** `main.ts` refused on `readHostConfig` before reading the endpoint
file or probing the trees. `readHostConfig` required only a non-empty token,
while `createApiServer` refuses one under 32 characters later. Both still fail
closed, but contradict the one-list claim.

**Fix:** `checkStartup` in `config.ts` runs every check whose input is set:
the table, the token length (`MIN_TOKEN_LENGTH`, now exported from the
server), the endpoint file, and the symlink probe. It returns one list, and
`main.ts` reads the environment only through it. A test sets a missing
variable, a short token, an unreadable endpoint file, and trees under a file,
and gets all four in one refusal. Before the fix no single call returned more
than the first group. Checks that need a missing variable's value (composing
the host) still wait, which the entry's refusal before listening allows.

## codex-6: the help tests were a shared oracle

**Checked:** the help test generated cases from the table it tested. One
`cli.test.ts` case sends a single `--spec` end to end, but no test asserted the
request body, and none repeated a flag. Holds in part: the reviewer's claim
that the acceptance test only looked for "Unknown option" is right for that
test, while `cli.test.ts` covers one ordinary create.

**Fix:** tests drive `create` with every flag, `--spec` and `--tests` repeated,
and compare the whole request body; then the drafting flags, `approve`,
`reject`, and `outcomes`, comparing each URL and body. **Shown failing:** with
`multiple: true` removed from `--spec`, the body test fails.

## codex-7 / gemini-3: the above-cap test proved nothing

**Checked by running:** the L2 create was refused `unsafe-above-l1`, the stub
graph's own refusal of every run above L1 for its stub components, before any
policy cap or cost was considered. So the test would pass with no cap in the
policy at all. That is worse than either reviewer said; both guessed a cost
refusal or an unrelated error.

**Fix:** the test loads the shipped `examples/policy.yaml` through the policy
file loader and asks the policy engine for each seated role at its station: L1
is granted and L2 refused `exceeds-cap`. **Shown failing:** with the example
raised to L2 (the global cap, each role's ceiling, and the human trigger), it
fails. Rejected: keeping an L2 create through the server, which no stub graph
can admit.

## codex-8 / gemini-2: the README test did not read columns

**Checked:** each row was searched for `| yes |` or `| no |` anywhere, and the
Secret column was never checked. **Fix:** cells are split by position and
Required and Secret compared separately. **Shown failing:** with
`FACTORY_PRINCIPAL` documented as secret, the test fails; the old one passed
it.

## codex-9: a Greek name in the generated install manifest

**Checked:** `scripts/local-release.ts` wrote `name: 'olympus-local-release'`.
The subagent confirmed it would be a hit under the scan's rules: only the
`@olympus-ai/` scope is stripped and only the exact string `olympus-ai` is
exempt. It also confirmed that the I10 scan
(`packages/conformance/src/registry/i10.ts`) covers workspace packages and not
`scripts/`, so nothing would have caught it. The invariant is broken whether
or not a scan sees it.

**Fix:** renamed `factory-local-release`. Extending the scan to `scripts/` is
a change under `packages/conformance/` that the unit does not declare, so it
is filed as issue #131, not absorbed.

## gemini-5: the cast in the readiness fixture

**Checked:** `readiness-route.test.ts` built its report as
`{...} as unknown as ReadinessReport`, and that fixture lacked `heldBy`, which
the contract requires. **Fix:** typed as `ReadinessReport` with no cast, and
`heldBy` added.

## Coverage the reviews did not give

- Gemini left item 7, whether the framing was right, unanswered.
- Codex answered it. It judged the framing appropriate if runtime attacks and
  assertion mutations are kept apart, and named what the bundle omitted and
  it could not assess: `resolveCommit`'s handling of option-shaped revisions,
  how the scan contains repository-controlled commands, and whether an invalid
  policy refuses start-up. Those are R1's and P3's, already reviewed at their
  own tags. Against the code: `resolveCommit` refuses an empty or `-`-leading
  revision and resolves with `--verify` to `^{commit}`
  (`packages/readiness/src/tree.ts:27-37`). An invalid policy file does not
  stop start-up: it refuses each run's admission and each readiness scan, and
  the scheduler starts with no policy (`server.ts` `listen`). Recorded, not
  changed: refusing start-up over a policy is a behaviour change the entry
  does not ask for.

## Acceptance after the fixes

Rerun in full after the last fix. Results are in the session report and in
the pull request.
