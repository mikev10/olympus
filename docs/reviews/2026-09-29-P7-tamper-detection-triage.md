# Triage of P7's external reviews, 2026-09-29

Two reviews, both `counted`: `2026-09-29-P7-tamper-detection-review-codex.md`
(gpt-6-astra, family codex) and `2026-09-29-P7-tamper-detection-review-gemini.md`
(gemini-3.1-pro-preview, family gemini). Both had ingestion `complete` and
integrity `verified`. Before its header was prepended, each reply's SHA-256
matched its manifest's `replySha256` (`e84e100b…` and `0964f956…`), and the
copies in commit `0c31d99` still hash to those values. Findings are cited by
family and number. Gemini's findings carry no numbers in its reply, so they are
numbered in the order it gives them.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 7 | 5 | 2 | 0 |
| gemini | 6 | 4 | 2 | 0 |

- **Both families raised:** four mechanisms. Context-skip aliasing (codex-2 and gemini-3). Test dependencies outside the analysed set (codex-1 and gemini-4). A script the pinned command runs (codex-5 and gemini-4). A missing test adapter (codex-6 and gemini-6). gemini-4 covers two of codex's findings.
- **Did not hold:** 0 of 13.
- **Held in part:** codex-6 and gemini-6 describe a documented choice (D-P7-06) and state a consequence that no run can reach today. codex-7's description is accurate, but the check it calls tautological does not affect what the entry proves. gemini-2's defect is real, but the consequence it states does not happen: the construction is refused, not missed.
- **Fresh-context verification:** each finding went to a subagent given the finding's text and the repository, with no account of who wrote the code. There were three subagents, grouped by file. Twelve of the thirteen findings were settled by execution: throwaway tests built each construction the reviewer described and called the real functions. codex-7 was settled by reading which inputs the entry's outcome depends on. Every verdict below agrees with its subagent.
- **Executed evidence for the fixes:** every new test was run against the unfixed sources, restored from `HEAD` for the run, and failed. That was 30 adapter cases and 6 tamper cases. All of them pass on the fixed sources.

## Findings

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 / gemini-3 | `ctx.skip` reached through an alias or a computed key skips a test with no marker | both | holds | fixed (D-P7-12) |
| codex-1 / gemini-4 (helpers) | a helper, setup file, matcher, or type the test imports can be neutered | both | holds | known limit, pending `I3.unchanged-assertion-still-judges`, M3 (D-P7-11) |
| codex-5 / gemini-4 (scripts) | a script named on the pinned command can be rewritten unreported | both | holds | fixed (D-P7-10) |
| codex-6 / gemini-6 | a stack with no test adapter reports empty test findings | both | holds in part | known limit, pending `I5.unanalysed-tests-are-not-reported-clean`, I1 (D-P7-09) |
| codex-3 | a `.each` table can shrink with no finding | codex | holds | fixed (D-P7-12) |
| codex-4 | `.only` moved between surviving files cancels out | codex | holds | fixed (D-P7-12) |
| codex-7 | the conformance fixtures pin a check that always passes | codex | holds in part | no change |
| gemini-1 | a locally shadowed `test` is read as a real test | gemini | holds | fixed (D-P7-12) |
| gemini-2 | tagged-template `.each` is skipped silently | gemini | holds in part | no change |
| gemini-5 | assertions in unreachable code are counted | gemini | holds | known limit, same pending entry as codex-1 (D-P7-11) |

### codex-2 / gemini-3: context-skip aliasing

**Checked:** `contextSkips` in `packages/adapters/src/markers.ts`. It matched only `ctx.skip()`, `ctx['skip']()` with a literal key, and a destructured `skip` under its bound name.

**Found:** the claim holds. `const omit = ctx.skip; omit();`, `const c = ctx; c.skip();`, and `ctx['sk' + 'ip']()` each gave no markers and no refusal, while the case and its assertions still read as present. The declarer path had a computed-key refusal, and the context had none. The fix also found an adjacent gap: a `...rest` of the context was not followed at all.

**Changed:** under vitest the context may only be read by a literal property, and `skip` may only be called. An alias, a computed key, `skip` taken as a value, destructuring in the body, and the context handed to a helper all refuse. `...rest` is followed as the context. Under jest the first parameter is `done`, which cannot skip and is routinely handed on (`setTimeout(done)`), so only the `skip` rules apply there. The fix exposed an error in the old code that the stricter rule would have turned into false refusals: the first parameter of a `.each` callback was treated as the context, when it is the row. The context is now looked for only where vitest puts it: first for a plain case, second for `.for`, and nowhere for `.each` or a suite. Tests: `the test context` in `packages/adapters/test/assertions.test.ts`.

### codex-1 / gemini-4 (helpers), and gemini-5: what an unchanged assertion executes

**Checked:** the analysed set in `analyzeTamper` and `testFindings` (`packages/api/src/tamper.ts`), and `isConfigFile`.

**Found:** the claim holds. With no protected paths set, rewriting `src/test-support.ts` or `setup.ts` gave `protectedPathsTouched: []` and no test finding. `setup.ts` is reported once the policy protects it. `if (false) { expect(1).toBe(2) }`, an uncalled nested function, and code after a `return` each still yielded the assertion. `config-files.ts` already states that setup files and transformers are the policy's protected-path list, not the config list. No decision named an owner for the rest.

**Why not fixed:** P7's scope is "pure functions over diffs". What an assertion still judges once its helpers change, or once it becomes unreachable, cannot be decided by parsing the diff. That is what mutation testing measures, and the spec assigns mutation testing to M3. Following the import graph would narrow the helper case, but it would leave reachability and runtime behaviour where they are, and it widens the unit. So this is recorded as a known limit: D-P7-11 and the pending `I3.unchanged-assertion-still-judges` (owner M3). The I3 baseline rises from 1 to 2. The `assertType`/type-alias variant was not run; it falls under the same entry.

### codex-5 / gemini-4 (scripts): a script the pinned command runs

**Checked:** how protected paths are derived: the policy's globs and `detectConfigChanges`. Neither reads the pinned command.

**Found:** the claim holds. `scripts/check.mjs` replaced with `process.exit(0)` gave `protectedPathsTouched: []`. The accept line names "the script a pinned check's command dispatches through — a `package.json` script or a runner config". A file named on the command line is literally that script, so this falls inside P7's own claim and is not a widening.

**Changed:** `TamperOptions.commands`. The line passes `ctx.checks`' argument vectors, and a changed file named by any token of them is a touch (D-P7-10). `I3.check-dispatch-not-writable-by-the-task` now asserts it, with a control that makes the same change with no command naming the file. Test: `a file the pinned command names is a touch…` in `packages/api/test/tamper.test.ts`, covering `./`-prefixed paths and a `sh -c` string.

### codex-6 / gemini-6: a missing test adapter

**Checked:** `analyzeTamper`'s `set.test === null` branch, `admissionRefusal` in `run.ts`, `SKELETON_LINE` in `safety.ts`, and D-P7-06.

**Found:** holds in part. The behaviour is as described, and it reproduced: a deleted test in a tree with no vitest or jest gives `testsDeleted: []`. But it is D-P7-06's recorded choice, made with its reason: refusing would make every L1 run over such a repository unrunnable, including the fixture every line assertion uses. The unavailable `test` control is recorded at admission. The consequence the reviewers state, an L2 run carrying a clean-looking report, cannot happen today, because `SKELETON_LINE` refuses every run above L1. What does hold, and is undocumented, is that the report itself does not distinguish "not analysed" from "clean".

**Outcome:** a known limit with an owner. D-P7-09 and the pending `I5.unanalysed-tests-are-not-reported-clean` go to I1, which lifts the L1 cap and must close this gap first. The I5 baseline rises from 2 to 3.

### codex-3: shrinking `.each` tables

**Checked:** `extractCases`, and the `Assertion` fields.

**Found:** the claim holds. `test.each([1, 2, 3])` becoming `test.each([1])` gave identical cases, identical assertions, and no marker. The doc comment claimed the assertion comparison would see a shrinking table, but an `Assertion` carries `file`, `line`, `operator`, `args`, and `tolerance`, and not the table.

**Changed:** each row is a case of its own, `handles %i [2]`, and a suite declared from a table repeats its cases per row. A table must be an array literal, either inline or in a top-level `const` used only as a table. An imported, computed, spread, mutated, or aliased table refuses, naming the file and line, following A-P7-01's rule for titles. Growing a table is not a deletion. Tests: `tables` in `assertions.test.ts`, and `a row dropped from a table is a deleted case` in `tamper.test.ts`. The existing expectation `math > with %i > scales` became `math > with %i [1] > scales`, which is a change of representation. No assertion was loosened.

### codex-4: `.only` moved between surviving files

**Checked:** skip-marker pairing in `testFindings`.

**Found:** the claim holds. Markers were one pool across files, keyed by a string that carries no file. Moving `describe.only('selected')` from `a.test.ts` to the same-named suite in `b.test.ts` gave `skipMarkersAdded: []`. The same change within one file was caught. D-P7-03 made cross-file pairing deliberate for moves and did not consider this case.

**Changed:** a marker pairs within its file first. Across files it pairs only from a file that left the tests to one that joined them, which is a rename or a move (D-P7-12). The existing test that a renamed file keeps its marker without a finding still passes. Cases and assertions still pair across files. Test: `a marker moved between two files that both survive…` in `tamper.test.ts`.

### codex-7: the fixtures' pinned check

**Checked:** `packages/conformance/src/registry/tamper.ts`, and how the analysis derives dispatch paths.

**Found:** holds in part. It is accurate that `PASSING` is `node -e process.exit(0)` in every line fixture and that no vitest runs. But no entry's outcome depends on that check. The analysis parses and never executes: the spec requires that "no file P7 adds executes repository code on the host". Dispatch protection was keyed on config-file identity, so a real runner and the trivial check give the same result. Each entry fails if its capability is deleted: remove `detectConfigChanges` from the analysis and the dispatch entry throws. The part that holds is that the dispatch entry proved "a config edit is reported" rather than anything about the command. With D-P7-10 the analysis now reads the command, and the entry now asserts that too.

**Not changed:** the proposed resolution, real-runner controls, would execute repository code on the host, which the unit forbids. It would also prove nothing about the analysis, which does not run the suite.

### gemini-1: shadowed declarers

**Checked:** `declarersIn` and `assertNoEscape`.

**Found:** the claim holds. `{ const test = (n, f) => {}; test('judging', () => { expect(x).toBe(5); }) }` gave the case `judging`, its assertion, and no refusal, while at runtime only the no-op ran. The opposite error also reproduced: a parameter named `test` was read as the real declarer, giving a false `test.skip` marker.

**Changed:** any binding of a declarer's name other than an import or a resolved top-level alias refuses: a local `const`, a parameter, a function, a class (D-P7-12). Tests: `declarers shadowed` in `assertions.test.ts`, under both frameworks.

### gemini-2: tagged-template `.each`

**Checked:** `chainOf` and `assertNoEscape`.

**Found:** holds in part. `chainOf` does not recognise a tagged template. But the claimed consequence, that the tests are silently skipped, is not what happens. `assertNoEscape` sees `test` used as a value in `` test.each`…` `` and refuses: `detectSkipMarkers` and `enumerateCases` both threw `unsupported-feature` for `test.each`, `test.skip.each`, and an alias. Every tamper run over such a file fails closed. The gap is missing support, not a bypass.

**Not changed:** supporting tagged-template tables would be new capability, not a review fix, and the refusal is the fail-closed behaviour the invariant asks for.

## Gates after the fixes

- `pnpm typecheck` and `pnpm lint` pass.
- `pnpm test` passes in every package except `conformance`, where 13 of 226 fail. Eleven are the driver package's external entries, and two are the registry meta-entries that report them. All thirteen fail on `tree-changed`: the local driver report is from before any change under `packages/`. That is expected under D-A-CI-07: the driver's paid suite runs once in CI under `run-driver`, and conformance is green against that report. The pending ratchet is within baseline: 9 entries against a baseline of 9.

## Coverage gaps in the reviews

Gemini left prompt items 2, 4, 6, and 7 empty, including item 7 (whether the framing is right). Codex answered all seven. Its item-7 answer was that the right question is whether any input that can change the execution or meaning of a judging check changed without being refused or escalated. That is the question D-P7-11 hands to M3.
