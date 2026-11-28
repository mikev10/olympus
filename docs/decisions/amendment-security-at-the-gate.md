# Decisions: security at the gate (amendment)

## Amendment: security at the gate, and two recorded constraints

Gaps found on 2026-10-11 by checking the line against the week's announcements
of hosted security agents (OpenAI's Codex Security Cloud, after Cursor's
Security Review): two vendors had split security review from general code
review, and the line has no security control on a change at all. R1's secret
scan reads one commit and caps a level; `CheckKind` has no security kind; the
spec has no security content; P7's taxonomy has no suppression marker. Each row
was checked against the code on `v2` at 62147bc. No package changes; the
amendment adds R17, extends R7, R9, and R13, and records two constraints.

The two constraints come from the same week's announcements: a hosted agent
API with computer use, and a proposed event extension to MCP. Neither changes
a unit; each is recorded where the unit that meets it will read it. The vendor
facts they cite come from public coverage of the announcements and are not
checkable from this repository.

### D-A-SC-01: security is checks, spec content, and tamper detection, as R17 in M2

- **Ambiguous:** the announcements frame security as an agent: a model that scans, triages, deduplicates, and drafts fixes. The line could take that as a new role at `review`, or as a station.
- **Chosen:** a unit with no model in it. Two check kinds, `'secret-scan'` and `'static-analysis'`, each in an image its `CheckSpec` pins and with configuration locked at `test-design`, run by the runtime at `verify` and required by admission; typed findings the runtime judges; a required security part in every spec; a denial check locked for each authorization rule the spec names; and an inline scanner suppression the diff adds failing the check and recording a `suppression-marker` violation. A model reviewing for security is a seat in R9's matrix, recorded and not interpreted until the M3 panel.
- **Must hold:** findings are the runtime's (I2). The scanner reads its configuration from the runtime's mount, never from the workspace (I3). A manifest without the security checks is refused, and an adapter set without static analysis names the missing control and is refused at L3 (I5). Each refusal reaches P14's record naming its cause.
- **Rejected:** a security agent that triages or fixes. A finding a model triages away is a status a model reported (I2), and a fix it drafts outside a run is a change with no spec. A finding fails the change, and the next iteration is the fix.
- **Contract amendments, owed by the unit's pull request:** listed in R17. The largest is that a check gains an image and a mounted configuration of its own: today every check runs in the host's one `checkImage` with the workspace as its only mount (`packages/api/src/line.ts`, `workspaceOnly`).
- **Why:** the claim is that a false-done is caught at the gate. A change that passes its tests while committing a credential is done by every measure the line has today, and wrong.
- **Why M2:** it needs R15's base run, and M1's scope is closed.
- **Reverse:** drop the spec part and the denial checks, and keep the two check kinds; they stand alone.
- **Confirmed** by the maintainer, 2026-10-11.

### D-A-SC-02: only findings absent from the base fail a change

- **Ambiguous:** a target with existing findings would fail every change if `verify` counted all of them, and a target with none would be indistinguishable from one whose scanner never ran.
- **Both options extend R15.** R15's base run and its `'fails'`/`'passes'` declaration cover acceptance checks only. Either option extends the base run to the two security kinds, and R15's text gains that sentence.
- **Option A:** require a clean base. The security checks run on the base and must find nothing; a base with findings refuses at the `test-design` exit. Every finding at `verify` fails. Simple, and unusable on most real repositories until someone clears their backlog.
- **Option B:** the runtime records the base run's findings' fingerprints as the base set. At `verify` a finding whose fingerprint is not in the set fails; one in it is recorded and does not. A scanner whose fingerprint depends on line position cannot be pinned, or must be pinned with a fingerprint the runtime derives from rule, file, and a hash of the match.
- **Must hold:** the base set is written by the runtime to the Vault beside R15's base results, and a resume reads it rather than running it again. A check that does not start is a refusal, never an empty set.
- **Known limit:** under B, a change that moves a finding to another file, or changes the matched text, gives it a new fingerprint and fails. That is a false refusal, which costs throughput and is never a safety failure. A fingerprint that included the line number would fail on any line inserted above an existing finding, which is why one is refused.
- **Chosen: B**, with the maintainer. A gate that only a clean repository can pass would keep R17 off the repositories that most need it, and a finding already on the base is not one the change made.
- **Reverse:** Option A.

### D-A-SC-03: dependency audits run nightly, not at `verify`

- **Ambiguous:** a dependency audit is the most common security check and the one most targets already run, so it looks like a third check kind.
- **Chosen:** R13's third job. An audit reads an advisory database over the network, and `verify` runs with `deny-all` egress. Granting `verify` egress for one check widens every check's sandbox. A vulnerability published after merge is also a property of the date, not of the change, so a nightly job over the default branch finds it where a gate would not.
- **Must hold:** the audit runs in its own sandbox, whose egress allowlist names the advisory host alone; R17's checks in the same job keep `deny-all`. No run locks the job's images and configuration, so policy pins them. Findings become `intake` candidates as typed fields (I7), and a human admits them. The job never opens a change.
- **Reverse:** an audit check at `verify` against an advisory snapshot pinned into the image, at the cost of the snapshot going stale.
- **Confirmed** by the maintainer, 2026-10-11.

### D-A-DD-01: the Codex constraint stands against the Agents API, and notes the open harness

- **Found:** OpenAI's Agents API now exposes computer use and Codex's multi-agent coordination, run on OpenAI's infrastructure. Coverage of DevDay 2026 also reports that the Codex harness is open source.
- **Chosen:** no change to the constraint. A hosted harness is outside the mount layer, the egress allowlist, and the egress-held credential, and is refused above L1. A dated note records both facts, and that the second, unverified here, would make the in-sandbox driver cheaper. The driver's author checks the licence and source first.
- **Why:** a second family is what R9 and real I6 independence wait on, so a cheaper route to the Codex driver is worth recording where its author will read it.
- **Confirmed** by the maintainer, 2026-10-11.

### D-A-DD-02: event subscriptions are granted capabilities, whatever their transport

- **Found:** OpenAI supports the proposed MCP Events specification for automations in ChatGPT, as webhook delivery. The specification is a draft with no accepted proposal in MCP.
- **Chosen:** a recorded constraint, not a unit and not a dependency. The M2 trigger framework may use either webhooks or MCP Events. Either way the payload is untrusted (I7), the subscription is granted in policy (I4), and the delivery-verification secret is held where P12 holds credentials.
- **Why:** a subscription that delivers into the line is a standing capability. Treating it as configuration would let a trigger widen what reaches the line without a versioned policy edit.
- **Reverse:** drop the note; it binds nothing yet.
- **Confirmed** by the maintainer, 2026-10-11.

### D-R15-01: the boundary R15 was confirmed on

- **Ambiguous:** the R15 entry had no out-of-scope list, no runnable acceptance criteria, and no contract amendments, though it cannot be built without four. It did not say whether the check declared `'fails'` must be `required`, what a declaration on another kind means, or what happens to a run admitted before it.
- **Chosen:** the entry gains all three, in the same shape as R17's (`DECOMPOSITION.md`, R15). The check declared `'fails'` must be `required`, since an optional check does not hold `verify`'s gate. A declaration on a check of another kind is refused at admission. An acceptance check over a base whose suites cannot be counted refuses, as `verify`'s gate does. A run admitted before R15 does not resume, with no migration. The M2 trigger framework's spec is a separate amendment, not this unit's. Contract amendments land with the unit, following R14 and R2.
- **Confirmed** by the maintainer, 2026-10-11.
- **Reverse:** each binding is one rule in `parseManifest` or the base run, removable alone.

### D-R15-02: a behavioral check may declare what it does on the base

- **Found:** an acceptance check is a suite check, so `verify`'s gate refuses one whose suites cannot be counted (`packages/api/src/gate.ts`), and suites are counted only where vitest or jest is declared. With D-R15-01 requiring a required acceptance check declared `'fails'`, a repository with no test framework could never cross `test-design`, which retired the unanalysed-suite path (D-I1a) and the M1 proof's manifest shape, whose reproduction is a behavioral check.
- **Chosen:** a behavioral check may also declare `onBase`, and a required acceptance or behavioral check declared `'fails'` satisfies the rule. Every declared check runs over the base. An acceptance check still needs a countable suite there, as at `verify`; a behavioral check runs the product rather than a runner, so its exit code alone decides unless it pins `expectedSuiteCount`. A declaration on any other kind is still refused. The hello fixture's reproduction is behavioral, so it keeps no test framework.
- **Confirmed** by the maintainer, 2026-10-11, over the alternative of refusing every repository without vitest or jest at `test-design`.
- **Reverse:** narrow `DeclaredCheckSpec` to acceptance alone, and rewrite the unanalysed-suite assertions to expect the `suite-count` refusal.

### D-R15-03: a reproduction that names the file the change writes escalates `integrate`

- **Found:** a path a pinned command names is protected (D-P7-10), and `commandPaths` splits every argument on whitespace and quotes (`packages/api/src/tamper.ts`). A check declared `'fails'` usually reads the file the change must write, so naming it makes every run's change a protected-path touch, which raises the `integrate` exit to a human. The hello fixture's reproduction did exactly this.
- **Chosen:** no runtime change in R15. The fixture's script builds the file's name rather than spelling it, and the interaction is recorded here. Whether a file named only by a declared check's reading of it should count as a dispatch is D-P7-10's question, and R16, whose reproductions will name their files, is where it bites.
- **Reverse:** spell the name in the fixture; every fixture run then stops at the `integrate` approval with the path named.

### D-R15-04: a suite check runs the base's own test framework over exactly what it names (external review, codex-1)

- **Found:** a suite count was an inventory of the tree, never evidence that the command ran those suites. `countSuites` enumerated the tree's test files from config, and the line attached that number to every suite check's result, whatever the pinned command did. An acceptance check declared `'fails'` with `expectedSuiteCount: 1` and a command that only tested whether a file existed passed the base run and `verify` while no test ran. Run end to end on the hello rig: base exit 1 with suites 1, `verify` exit 0 with suites 1, no tamper finding, no escalation. `verify` had counted this way since P6, so `verify`'s evidence could say "the acceptance suite failed before and passed after" when nothing ran. That makes the record false, which is the one thing the product claims it is not. R15's own spec sentence, "a test file the runner never loaded is not a reproduction", was not true of the code.
- **Chosen,** with the maintainer on 2026-10-12, over keeping it as a known limit owned by M3, and over a report written by the runner: a `unit` or `acceptance` check pins no command. The runtime starts the framework the base declares, from the base's own install, with an argument vector the adapter builds (`TestFrameworkAdapter.runner`, `invocation`). An acceptance check names its tests (`AcceptanceCheckSpec.tests`); a unit check runs every configured suite. Admission refuses, with the new codes, the following:
  - a suite check that pins a command (`not-applicable`), and `tests` on any other kind;
  - `expectedSuiteCount` on an acceptance check, which its tests already fix;
  - a check of no known kind (`not-a-kind`);
  - a test name holding `:`, which vitest reads as a line filter, or `\` (`not-runnable`);
  - and, read from the snapshot (`unbound`): a suite check over a base with no supported framework or with no runner installed at the adapter's path; a named test that is not an admitted acceptance test; and a set of named tests the framework would not run exactly, either because one is not a suite it loads or because its selection rule takes in a suite nobody named.

  The recorded suite count is the number of named tests the runner selects in the tree it ran over, or for a unit check every suite the framework is configured to run. An acceptance check requires every named test, so one the runner does not load fails the gate as `suite-count`. A suite check whose runner is missing where it runs has not started, and is recorded as unstarted rather than as `node`'s exit code 1 for a module it cannot find.
- **Both suite kinds,** with the maintainer: a unit check's count was the same inventory.
- **The selection rules are copied from each runner's published source,** as D-P8-05 does for enumeration. Vitest 3.2.4 and 4.1.11 share `filterFiles` (`dist/chunks/cli-api.*.js`): a suite is kept when its path relative to `test.dir`, lower-cased, contains the filter as given or the filter's own path relative to `test.dir`. That is a substring, so `./src/a.test.ts` also selects `sub/src/a.test.ts`. That case is in the admission tests, and it is refused. Jest 29.7.0 and 30.2.0 take `--runTestsByPath` arguments as paths (`SearchSource.findTestsByPaths`): resolved, and kept only if they are test files. The vitest model is held to vitest 4 itself, which lists the files each filter selects (`packages/api/test/runner-agreement.test.ts`). Vitest 3's rule is the same source text, but it has not been executed against vitest 3, since only vitest 4 is installed. The jest rule has not been executed against jest either.
- **Rejected:**
  - **A report written by the runner of which tests ran.** It is written inside the process that runs the code under test, so the change could forge it. `countSuites` refuses to read runner output for that reason.
  - **Recording codex-1 as a known limit.** That ships a gate whose evidence can be false. M3 owns whether an executed test judges the right thing, not whether one ran at all.
- **Known limits, stated:**
  - **The runner shares its process with the code under test.** A test imports the product, so product code can exit the process (jest honours `process.exit`) or reach into the runner's state. The exit code is the runner's only as far as the code under test leaves it alone. What catches a suite that passes without judging is mutation testing (M3), beside D-P7-11.
  - **A runner that loaded the test can still fail for a reason other than the defect** (R15's known limit, M3).
  - **Vitest writes a snapshot a suite lacks unless it runs in CI mode,** and the argument vector cannot set `CI`. A written snapshot is reported by tamper analysis as regenerated. Jest is started with `--ci`.
  - **At `verify`, a named test's filter can also select a suite the change added under a path that contains it.** That can only add a failure, never a pass, so it is not refused there.
  - **A repository whose runner is not installed at `node_modules/vitest/vitest.mjs` or `node_modules/jest/bin/jest.js`** (hoisted above the repository, say) is refused at admission. It is never run with something else.
- **Contract amendments:**
  - `CheckSpec` gains `UnitCheckSpec` and `SuiteCheckSpec`. `AcceptanceCheckSpec` gains `tests` and loses `command` and `expectedSuiteCount`.
  - `TestFrameworkAdapter` gains `runner`, `invocation`, and `selectSuites`.
  - `RequestProblemCode` gains `not-a-kind`, `not-applicable`, `not-runnable`, and `unbound`.
  - `suiteCountFor` is replaced by `suiteRunner`, `commandOf`, `runnerMissing`, `suitesRun`, and `suiteBindingProblems` in `verification.ts`, and `requiredSuites` in `gate.ts`.
- **Reverse:** give `SuiteCheckSpec` its `command` back and restore `suiteCountFor`. Every conformance entry named `I5.suite-check-runs-what-it-names` then fails, as it should.

### D-R15-05: what a task writes under node_modules is recorded and escalated, and never carried (found in the R15 triage)

- **Found:** no external reviewer raised this. It turned up while the triage checked codex-1's fix against the code. A task's diff left out `.git` alone (`packages/api/src/workspace.ts`), so what a builder wrote under `node_modules` was carried into the tree `verify` ran over, and tamper analysis skips `node_modules` entirely (`packages/api/src/tamper.ts`, `skipDirectory`). A check whose command named its runner, `node node_modules/…/index.js`, was protected by name (D-P7-10) and still unflagged, because the walk never reached the path. On the hello rig, with vitest declared, a builder that rewrote that file turned a check from exit 1 on the base to exit 0 at `verify`. `protectedPathsTouched` was empty and no escalation was raised; only L1's own approval stopped the run. The runner is an artifact the agent could write, and it is the artifact that judges the agent, which is what I3 forbids. The agent under judgment could do this, not only the manifest's author. It predates R15 and defeats the one thing R15 shows.
- **Chosen,** with the maintainer on 2026-10-12, over refusing the task and over mounting the base's `node_modules` read-only over each check's tree: nothing a task writes in a directory named `node_modules`, at any depth, is carried into the tree the checks run over. Every check, and the runner a suite check starts, runs over the base's dependency trees. What was written is recorded in the new `EvidenceBundle.notCarried`, by package directory (`node_modules/vitest`, `node_modules/@scope/pkg`, or a file sitting directly in `node_modules`). Each entry escalates the `integrate` exit and reaches the review seat as a finding.
- **Why not refuse:** a builder that runs the tests writes the runner's cache under `node_modules/.vite`, so every such build would be refused for doing its job.
- **Why not a read-only mount:** it needs a second mount in every check's sandbox spec, and the diff would still carry files that nothing judges into the tree `integrate` reads.
- **Known limit:** a change that needs a dependency the base did not install cannot pass `verify`. Its checks run over the base's dependencies and fail, honestly, naming what is missing. A runtime install from the lockfile, in the check's sandbox and before any check, is the way through. No unit owns it; it is filed as issue #40 rather than absorbed here.
- **Only `node_modules`:** every stack the adapters support is a Node stack. A new stack's adapter names its own dependency trees.
- **Reverse:** carry every path again in `verify`'s `ownDiff` filter and drop `notCarried`. `I3.dependency-trees-are-the-bases` then fails.

### D-R15-06: the base record's reader refuses an incomplete result (external review, codex-obs)

- **Found:** `baseRunProblem` accepted a result with no `suiteCount` and any numeric exit code. A missing count reads as `undefined`, which is neither `null` nor below any number, so the suite-count rule passed it. A `NaN` exit code is written as `null` and read back as a failure, which a check declared `'fails'` counts as a reproduction. Only the runtime writes the record, so neither has happened; the reader exists to refuse a record that is not whole, and this one would not have.
- **Chosen:** each result's exit code is an integer, and its suite count is an integer of zero or more, or `null`. The stub vault keeps to provenance and write-once, as it does for every record.
- **Reverse:** loosen `isBaseResult` in `packages/vault/src/local/vault.ts`.

### D-R15-07: the dependency filter ignores case, and a suite check counts nothing when its runner would load an unnamed suite (external review of the fixes, gemini-2 and gemini-1)

- **Found (gemini-2):** `inDependencyTree` and `dependencyEntry` matched `node_modules` case-sensitively. On a case-insensitive filesystem, a task that renamed its tree's `node_modules` to `Node_Modules` and edited the runner had the edit carried as `Node_Modules/vitest/vitest.mjs`, and `materialize` wrote it over the base's `node_modules/vitest/vitest.mjs`. The rename's removals were dropped as dependency paths. Run on Windows: the verified tree's runner held the task's content, `notCarried` was empty, and tamper skipped the still lower-case directory, so nothing was recorded and nothing escalated. It defeated D-R15-05 on the host the runtime is developed on.
- **Found (gemini-1):** at `verify`, `suitesRun` counted only the named tests among those the runner selects, so a suite the change added that the selection rule also takes in ran uncounted. Vitest's rule is a substring, so `src/a.test.tsx` and `sub/src/a.test.ts` are both selected for `src/a.test.ts`. Admission refused extras on the base only. The reviewer's consequence, an extra file forging a pass, does not hold: run on vitest 4.1.11, a `process.exit(0)` in an extra test file is intercepted in the worker and counted as a failed file, exit 1.
- **Chosen:** a path segment is a dependency tree when it is `node_modules` in any case, and its entry keeps the spelling the task wrote. A suite check whose runner would load a suite it does not name records no suite count, which fails it as `suite-count` (`requiredShortfall`). On a case-sensitive host, a `Node_Modules` directory is also left out; nothing resolves it, so that costs nothing.
- **Reverse:** compare `node_modules` exactly in `packages/api/src/workspace.ts`, and filter the selection to the named tests in `suitesRun`. The two tests under D-R15-05's and D-R15-04's describe blocks in `packages/api/test/verification.test.ts` then fail.

### D-R15-08: the runner's own process can still load code the change can reach (external review of the fixes, codex-1 and codex-2; known limit, owned by M3)

- **Found (codex-1):** nothing authenticates the base's installed runner. Admission checks that the runner path is a regular file and that the adapter's static selection model takes the named tests. The recorded suite count comes from that model, in a call separate from the process that produced the exit code. A base whose `node_modules/vitest/vitest.mjs` exits 1 unless a flag file exists fails on the base, and passes at `verify` once the build writes the flag, with a count of 1 both times and no test run.
- **Found (codex-2, and its honest-runner form in triage):** the runner loads files outside `node_modules` that the change can write. With an unmodified vitest 4.1.11, a `globalSetup` file that calls `process.exit(0)` makes the run exit 0 with no test run, because vitest intercepts `process.exit` in workers, not in its own process. A base whose config already names a `globalSetup` file lets a build that rewrites it pass `verify` with nothing flagged: the file is not a config file (`packages/adapters/src/config-files.ts`), no pinned argv names it, and it is protected only where policy lists it. The record then says the named test failed before and passed after, when it never ran.
- **Chosen,** with the maintainer on 2026-10-13: a known limit, counted as the pending entry `I3.runner-process-loads-only-base-code` (owner M3; the I3 baseline goes from 2 to 3) and tracked as issue #42. The alternative was having the adapters enumerate the hooks a config loads into the runner's process (`globalSetup`, setup files, reporters, environments) and hold those to the base. It was rejected: a config can compute those paths, and any hook the list misses leaves the same false record while the code claims the boundary. Closing it needs one mechanism for both routes: a runner, and the inputs its process loads, that the change cannot write. That is either provisioned by the runtime outside the tree or authenticated and held to the base. It sits beside the runtime install of #40, which R15's out-of-scope list excludes.
- **Until then:** a suite check's pass is evidence about a runner and a `globalSetup` that cooperated. A `vitest.config.*` change that adds a `globalSetup` is a config change, and it escalates `integrate` (D-P7-10). An edit to a `globalSetup` file the base already names escalates only where policy protects it.
- **Reverse:** not applicable. Closing the issue removes the pending entry and lowers the baseline.
