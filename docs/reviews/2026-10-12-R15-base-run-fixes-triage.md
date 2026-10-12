# Triage of the external reviews of R15's review fixes, 2026-10-12

Two reviews of the R15 review fixes, run from one prompt and one bundle
(`2026-10-12-R15-base-run-fixes-review-bundle.txt`, SHA-256
`31e6c759093ed7fc652f6acafdf4d5f7b134a8f17d09f766334c7ecde01370d5`, base
`2dcd5d2`, head `94fe9c3`):

- `2026-10-12-R15-base-run-fixes-review-codex.md`: gpt-6-astra, family codex,
  outcome `counted`
- `2026-10-12-R15-base-run-fixes-review-gemini.md`: gemini-3.1-pro-preview,
  family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 2 numbered, 1 remark | 1 | 1 | 0 | 0 |
| gemini | 2 | 1 | 1 | 0 | 0 |

No finding was raised by both families. codex-2 and gemini-2 both defeat the
`node_modules` carry filter of D-R15-05, but by different mechanisms. codex-1
and gemini-1 both concern a suite count that is not evidence of execution, and
those mechanisms differ too. Each finding was checked by a reviewer with fresh
context, given the finding text and the repository. gemini-1's consequence and
gemini-2 were then run on this machine against vitest 4.1.11 and the repo's own
workspace functions, using scratch directories outside the repository; no
tracked file changed. The triage also ran the honest-runner form of codex-2,
described below. codex-1 was settled by reading the code. Its construction
needs a fabricated runner in the base, and reading shows nothing that would
stop one.

## Summary

| Finding | Claim | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| gemini-2 | A case-variant `Node_Modules` directory escapes the carry filter and overwrites the base's runner on a case-insensitive filesystem | gemini | holds (executed) | fix now |
| codex-2 | The runner loads change-writable code outside `node_modules`, so the change can set the judge's exit code | codex | holds in part: the fabricated-launcher form needs codex-1's premise; an honest vitest `globalSetup` file does the same (executed) | maintainer decision: known limit, recommended |
| codex-1 | The base's installed runner is not authenticated, so a fabricated launcher passes with a statically derived suite count | codex | holds | maintainer decision: known limit, recommended |
| gemini-1 | At `verify`, `suitesRun` drops suites the runner selects but the check does not name | gemini | holds in part: the drop is real; an extra file cannot turn the named failure into a pass (executed) | fix now |
| codex-obs | Crash safety through `test-design` cannot be established from the range | codex | not a finding: the range does not change transition ordering, and the reviewer claims no defect | no change |

## gemini-2: a case-variant `node_modules` is carried

**Claim.** `inDependencyTree` matches `node_modules` case-sensitively. On a
case-insensitive filesystem, a task can rename the directory to `Node_Modules`,
edit the runner, and have the edit carried into the verified tree, where it
resolves to the base's runner path.

**Checked.** `inDependencyTree` (`packages/api/src/workspace.ts`) is
`path.split('/').includes('node_modules')`. `dependencyEntry` and tamper's
`skipDirectory` (`packages/api/src/tamper.ts`) use the same exact spelling.
The filter in the verify path of `packages/api/src/line.ts` is the only carry
filter, and its output reaches `composeDiff`, `materialize`, and `apply`.

**Run.** On this Windows machine the probe built a base with
`node_modules/vitest/vitest.mjs` = `GOOD`, copied it to a start tree and a
work tree, renamed the work tree's `node_modules` to `Node_Modules`, and wrote
`EVIL` into the file. `ownDiff` returned:

- `Node_Modules/vitest/vitest.mjs` as added. `inDependencyTree` returned false,
  so the entry was carried.
- `node_modules/vitest/vitest.mjs` as removed. `inDependencyTree` returned true,
  so the entry was dropped.

`composeDiff` against the base reported the carried path as modified. The real
`materialize` produced a tree whose `node_modules/vitest/vitest.mjs` reads
`EVIL`. `notCarried` was empty. The materialized directory is still spelled
`node_modules`, so tamper skips it and no finding is raised.

On a case-sensitive host, `Node_Modules` is a separate directory that `node`
never resolves, so there it does nothing. The only remaining barrier is a
policy whose `writableGlobs` is narrower than the build station's `**`, which
is policy-dependent and not structural.

**Verdict.** Holds. It defeats D-R15-05 on the host the runtime is developed
on, with no record and no escalation.

**Outcome.** Fix now. Compare path segments case-insensitively in
`inDependencyTree` and `dependencyEntry`. A case-variant directory is then not
carried: it is recorded in `notCarried` and escalates, as any `node_modules`
write does. On a case-sensitive host, the same rule also leaves out a
`Node_Modules` directory that would have been harmless. That costs nothing,
because no supported stack resolves one.

## codex-2: the runner loads change-writable code outside `node_modules`

**Claim.** A base launcher that imports `../../tools/judge.mjs` runs the
change's edit of that helper. The edit is carried, because its path has no
`node_modules` segment. Escalation, if any, does not prevent acceptance at
`verify`.

**Checked.** The construction holds as described. The edit is carried by the
filter in the verify path of `line.ts`. A `.mjs` helper is not a config file
(`packages/adapters/src/config-files.ts`), it is not named by a pinned argv (a
suite check pins none), and it matches no protected path unless policy lists
it. The task is passed from check shortfalls alone. Escalation applies only at
the `integrate` exit, as an approval a human sees, and here there is nothing to
escalate. The fabricated-launcher form, though, needs a base whose installed
runner imports a repository file. That is codex-1's premise, not a second
defect.

**Run: the honest-runner form, found in triage.** The question was whether an
unmodified vitest has the same route. It does. In a scratch project running
vitest 4.1.11:

- `vitest.config.mjs` names `globalSetup: ['./tools/gs.mjs']`.
- `src/a.test.ts` fails (`expect(1).toBe(2)`).
- `tools/gs.mjs` calls `process.exit(0)`.

`node node_modules/vitest/vitest.mjs run src/a.test.ts` exited 0 after
printing only the `RUN` banner, and no test ran. A teardown that set
`process.exitCode = 0` instead did not flip the result (exit 1). `globalSetup`
runs in the runner's own process, where vitest does not intercept
`process.exit`, unlike a test worker (see gemini-1).

Take a base whose config already names a `globalSetup` file, which is common.
A build that rewrites that file:

- is carried and unflagged;
- passes `verify` with the statically derived suite count of 1;
- escalates nothing;
- and leaves a record saying the named test failed before and passed after,
  when it never ran.

The config file's own comment (`config-files.ts`) leaves files a config names
by path to the policy's protected-path list. No default covers them.

**Verdict.** Holds in part. The defect as stated, a fabricated launcher
importing a helper, is codex-1. The honest-runner form holds independently,
and it is the more serious of the two. It needs no deceptive base, only a
build that takes the easiest path to a green check.

**Outcome.** A maintainer decision. Two routes are possible:

- **(A) Fix now in R15.** The vitest and jest adapters name the files their
  base config loads into the runner's own process (`globalSetup`, and for
  completeness `setupFiles`, custom reporters, environments, and other
  path-named hooks). Those files would be held to the base the way D-R15-05
  holds `node_modules`. This rests on reading paths out of a config that may
  compute them, which is not verified. Any hook missed is the same false
  record.
- **(B) Recommended: known limit with an owner.** Add D-R15-07 to
  `docs/decisions.md`, plus a pending entry under I3 in the conformance
  registry (`packages/conformance/src/registry/base-run.ts`) that is counted
  until it is closed. Both name a new issue: *the runner's own process loads
  only base-fixed code*. The issue covers codex-1 and codex-2 together. The
  honest fix is one mechanism, a runner and runner inputs the change cannot
  reach, and it sits next to the runtime install that #40 already names. An
  enumerated hook list closes only part of the hole and still claims the
  property.

The choice is the maintainer's, because the last R15 triage refused to keep a
false record as a known limit (D-R15-04). (B) is recommended because (A)'s
property cannot be made whole by enumeration. Shipping (A) would let the code
claim a boundary it does not hold. Recording (B) states the gap where it is
counted.

## codex-1: the base's runner is not authenticated

**Claim.** A base with a fabricated `node_modules/vitest/vitest.mjs` that exits
on a flag file passes admission, because the launcher is a file and the
adapter's static model selects the named test. It fails on the base and passes
at `verify` without loading a test, and the static suite count is recorded
both times.

**Checked.** `runnerMissing` (`packages/api/src/verification.ts`) checks only
that the runner path is a regular file. `suiteBindingProblems` adds the
adapter's static `selectSuites`, which reads files and config and never
executes the launcher. `suitesRun` derives the count from the same static
model, in a call separate from the `sandbox.exec` that produces the exit code,
both at the base run and at `verify` in `line.ts`. Nothing ties the count to
the process having loaded a test.

The flag file lies outside `node_modules`, so it is carried. The construction
needs the base to carry a fabricated runner. The prompt's threat model gives
the party that, but "the easiest path gets taken" makes it unlikely in
practice.

**Verdict.** Holds. The record would say the named test failed before and
passed after when no test ran, which is the class of false record D-R15-04
exists to remove.

**Outcome.** A maintainer decision, joined to codex-2's: route (B) is
recommended for both, as one issue. Authenticating a runner means either
digesting the runner's whole transitive install against published packages or
provisioning the runner at run time outside the tree. Either is new machinery
next to #40's runtime install, and R15's out-of-scope list excludes that
install. It is not a review fix.

## gemini-1: extra selected suites are dropped at `verify`

**Claim.** At `verify`, `suitesRun` keeps only the named suites from the
runner's selection, so a change that adds a file the selection rule also takes
in is run but not counted. The reviewer's example was
`src/a.test.ts.malicious.ts`, and its suggested consequence was that this file
calls `process.exit(0)` to report a pass.

**Checked.** In `suitesRun` (`packages/api/src/verification.ts`), the
acceptance branch filters `selectSuites` down to `named` before counting.
Admission refuses extras on the base (`suiteBindingProblems`), but the tree at
`verify` is the base plus the change, and nothing at `verify` compares the
selection with the names.

The reviewer's file does not match vitest's default include and is never
selected. `src/a.test.tsx` and `sub/src/a.test.ts` are both selected for the
name `src/a.test.ts`, by the substring rule D-R15-04 copied from vitest.

**Run.** With vitest 4.1.11:

- `src/a.test.ts` is failing.
- `src/a.test.tsx` calls `process.exit(0)` at top level.

`vitest run src/a.test.ts` ran both files and reported `Test Files 2 failed
(2)`, exit 1. Vitest intercepts `process.exit` in test workers, and any failed
file fails the run, so an extra suite can add a failure but never remove one.

**Verdict.** Holds in part:

- **The defect holds.** The record can say one suite ran when the runner loaded
  two, which is not "exactly what the runner was made to load".
- **The stated consequence does not hold.** An extra test file cannot forge a
  pass. Code the named test imports was always the change's to write, and
  `globalSetup` is the route that does forge one (codex-2).

**Outcome.** Fix now, because it is small and fails closed. At `verify`, a suite
check whose runner would load a suite it does not name gets no suite count, and
a check that requires a count fails on a null (`gate.ts`). A test in
`verification.test.ts` (or the line test) adds `src/a.test.tsx` beside a named
`src/a.test.ts`. It must be shown failing on the current `suitesRun`, which
counts 1, before the fix is trusted.

## codex-obs: crash safety through `test-design`

The reviewer says it cannot establish resume safety across the `test-design`
exit, because the transition code is not in the range. It claims no defect.
The range does not change transition ordering. The resume behaviour of the
base run, a recorded result reused and never re-run, is R15's original scope,
and the earlier triage covered it. No change.
