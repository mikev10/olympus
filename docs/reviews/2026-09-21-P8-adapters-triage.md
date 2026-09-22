# Triage of P8's external reviews, 2026-09-21

Two reviews, both `counted`, from one prompt and one bundle:
`2026-09-21-P8-adapters-review-codex.md` (gpt-6-astra, family codex) and
`2026-09-21-P8-adapters-review-gemini.md` (gemini-3.1-pro-preview, family
gemini). Each reply's SHA-256 matched its manifest's `replySha256` before its
header was prepended. Findings are cited by family and number.

## Counts

| | Findings | Holds | Holds in part | Holds, another unit's | Does not hold |
|---|---|---|---|---|---|
| codex | 15 | 11 | 2 | 1 | 1 |
| gemini | 6 | 3 | 2 | 0 | 1 |

- **Both families raised:** 2 mechanisms, codex-2 = gemini-2 and codex-8 = gemini-3.
- **Did not hold:** 2 of 21, codex-10 and gemini-5.
- **Executed evidence:** 26 probe tests against the adapters, all of which
  reproduced the behaviour the reviewer predicted; the conformance scan run
  against a planted indirect `eval`; `tsc` against the outcome type; and two
  runtime checks, vitest's `configDefaults` mutability and jest-haste-map's
  handling of a missing root. The probes are kept outside the tree and become
  the regression tests for the fixes, each shown failing first.
- **Fresh-context verification:** each finding went to a subagent that had
  only the finding's text and the cited files. They agreed with every verdict
  here except one sub-claim of codex-4, the negated tolerance. There the
  subagent read the path as falling through to `atLeastAsStrong`, but
  `assertions.ts:225-227` `continue`s unconditionally, and the executed probe
  reproduced the silent drop. The test wins.

**Applied.** The maintainer confirmed the five decisions below as recommended,
and the fixes landed on `unit/p8` in the commit this triage belongs to. Each
regression test was shown failing against the code before its fix and passing
after. The unit's full acceptance criteria were re-run afterwards, not only the
tests near each change: `pnpm typecheck`, `pnpm lint`, the driver assertions
that write the conformance run report, `pnpm test` (1,263 tests across nine
packages), and `pnpm conformance` (89 assertions, with the two new pending
entries listed under their owners).

## Findings

| ID | Finding | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | An ancestor link in a configured root is walked and read | codex | holds | fix now |
| gemini-1 | A `../` vitest include enumerates files outside the repository | gemini | holds | fix now |
| codex-2 | The report's statement map decides the denominator, and its hit counts are trusted | codex, gemini (gemini-2) | holds | denominator: fix now; hit counts: P6 |
| gemini-2 | `istanbul ignore` drops lines from the denominator | gemini, codex (codex-2) | holds | fix now, with codex-2 |
| codex-3 | The fallback misses an arrow's expression body on its own line | codex | holds | fix now |
| codex-4 | Removing a negation, existence→any equality, and a negated tolerance narrowed are all accepted | codex | holds | fix now; amends D-P8-08 |
| codex-5 | An assertion moved into uncalled code, or under a local `expect`, is unchanged | codex | holds | known limit (M3) |
| codex-6 | Subject type arguments and standalone `assertType` are not recorded | codex | holds | fix now |
| codex-7 | `module.exports.x =` mutation and a `configDefaults` alias escape the static read | codex | holds | fix now |
| gemini-4 | A side-effect import can change what the config yields at runtime | gemini | holds in part | fix now, narrow; rest is P7's under D-P8-11 |
| codex-8 | Aliases, `test['skip']`, and a renamed destructured `skip` hide markers | codex, gemini (gemini-3) | holds | fix now |
| gemini-3 | `(test).skip` and `test['skip']` hide markers | gemini, codex (codex-8) | holds | fix now, with codex-8 |
| codex-9 | `dockerCli` buffers unbounded output on the host | codex | holds, P2's code | pending entry, owner P10 |
| codex-10 | A missing jest root is skipped without refusal | codex | does not hold | reject |
| codex-11 | Whitespace is collapsed inside string literals | codex | holds | fix now |
| codex-12 | `assertLinearPattern` passes polynomial-backtracking patterns | codex | holds | fix now (approach to decide) |
| codex-13 | An empty directory, or a special file, at a config path is not reported | codex | holds in part | special files: fix now; directories: reject |
| codex-14 | The no-host-execution scan misses `globalThis['eval']` | codex | holds in part | fix now |
| codex-15 | `ExpectationOutcome` does not make verdict and evidence exclusive | codex | holds | fix now |
| gemini-5 | An upstream `any` weakens nothing the comparator can see | gemini | does not hold | reject |
| gemini-6 | `readRegularFile` buffers growth before the cap check | gemini | holds in part | fix now |

## Decisions for the maintainer

Each has a recommendation. **All five were confirmed as recommended and are
what was applied.**

1. **codex-12, how to make the jest pattern check sound.**
   Recommended: match `testRegex` and the two ignore lists with a linear-time
   matcher for a declared subset of regex syntax, and refuse anything outside
   it (backreferences, lookaround). That is a real guarantee, and it is what
   the function's name already claims. The alternative is to narrow D-P8-12's
   claim to nested quantifiers and record polynomial blowup as a known limit.
   That is honest, but it leaves a crafted pattern able to hang the host. The
   subset matcher is new code of real size, in a review fix, so it is your
   call.
2. **gemini-4, how far a config's imports are refused.** Recommended: refuse a
   runtime import in a config module whose specifier is relative or absolute,
   including a side-effect import. That code is repository code, so no config
   change is reported when it changes. A bare package specifier stays allowed:
   what it runs is pinned by manifests and lockfiles, which the manifest
   adapter reports, by the reasoning D-P8-11 already gives for `node_modules`.
   The alternative is gemini's allowlist of framework modules only. That
   refuses most real vite configs, because they import plugins.
3. **codex-2's hit counts and codex-9 are recorded as pending registry
   entries, not prose.** Recommended: `I3.coverage-report-is-not-writable-by-the-suite`,
   owner P6, and `I9.sandbox-output-is-bounded`, owner P10, each raising its
   baseline by one. A decisions entry alone is the alternative, and it is
   weaker, because prose is not counted.
4. **codex-4, what existence → equality still counts as at least as strong.**
   Recommended: only a positive existence check (`toBeDefined`, `toBeTruthy`,
   `ok`, and their kind) turned into an equality against a literal that
   satisfies it. `toBeDefined()` → `toBe(3)` is dropped, while
   `toBeDefined()` → `toBe(undefined)` and `toBeTruthy()` → `toBe(0)` are
   weakened. The alternative is to drop the rule and report every such change,
   which D-P8-08's cost model allows but which is noisy.
5. **codex-8, vitest fixtures.** Recommended: a `const` bound to
   `<declarer>.extend(...)` becomes a declarer name, so a fixture test's
   `.skip` is seen. Any other escape of a declarer is refused: `const t = test`,
   `fn(test)`, or `test[expr]` with a non-literal key. The alternative is to
   refuse `extend` bindings too, which refuses every fixture-based vitest
   file.

## Evidence per finding

### codex-1 — ancestor link — holds

`inside()` (`discovery.ts:46`) is lexical: `resolve` and `relative`, and no
component is inspected. `walkTree` (`files.ts:115`) `lstat`s only the root it
is handed, and `openRegular` (`files.ts:43`) only the last component. So
`head/linked → outside` with jest `roots: ['<rootDir>/linked/tests']`, or
vitest `test.dir: 'linked/tests'`, passes containment, and the kernel follows
the link on the way down. **Probe:** both configurations enumerate the outside
suite, and `parseAssertions` reads it. This falsifies the premise of D-P8-13's
first bullet, "enumeration never descends through a link".

**Fix:** `inside()` walks from the repository root to the candidate and
refuses any existing component that is a link or not a directory. The root
itself is the runtime's and is not checked, which answers D-P8-13's objection
that system paths such as macOS's `/var` are links. D-P8-13 is rewritten to
say what remains: a tree mutated between the check and the read, because Node
has no root-relative open. Regression: the two probes, inverted.

### gemini-1 — `../` include — holds

`vitestSuites` (`discovery.ts:187`) passes `include` to tinyglobby unchecked.
`inside()` covers `root` and `test.dir` only, and no result is filtered.
**Probe:** `include: ['../secret/**/*.test.ts']` returns the sibling
directory's file. The consequence gemini gives, reading host files through
`parseAssertions`, follows.

**Fix:** refuse an `include` pattern that is absolute or has a `..` segment,
recorded as a third safe-side departure in D-P8-06, and assert every glob
result is inside the repository as a second line. `exclude` only removes
files, so it is left alone.

### codex-2 / gemini-2 — the report decides the denominator — holds

`coverage.ts:144`: when the report has an entry for a file, the executable
lines are exactly the report's statement starts. **Probes:** an entry with an
empty `statementMap` makes a changed line fully covered (codex's construction,
result `1`), and an entry that omits a changed line drops it (gemini's
`istanbul ignore` construction, result `1`). This contradicts D-P8-09, which
says the repository's own coverage exclusions are not honoured, and an ignore
comment is one.

**Fix:** a report may add obligations and never remove one. The denominator
is the union of the report's statement lines and the host's executable lines,
and a line is covered only where the report records a hit. The side effect is
that a host-counted line that istanbul instruments elsewhere reads as
uncovered. That is the safe direction, and D-P8-09 already leaves its weight
to policy.

**Hit counts, which cannot be fixed here:** codex is right that the report can
claim hits that never happened. No parse of the report establishes
provenance, because the report is written by a process in which the
repository's own code runs. That is an artifact the agent can write, judging
the agent. It is owned by the run that produces the report, which is P6's
(decision 3).

### codex-3 — arrow expression bodies in the fallback — holds

`executableLines` (`coverage.ts:77`) counts TypeScript statements. An arrow's
expression body is not one, but istanbul-lib-instrument counts it: it
converts the body to a block and counts its return. Variable declarators are
counted at their initializer's line, and class property initializers are
counted as well. **Probe:** base `() =>\n 1`, head `() =>\n 2`, empty report,
result `1`, so the only changed line in an unloaded file reads as covered.

**Fix:** count arrow expression bodies, declarator initializers at their own
start line, and class property initializers, which is istanbul's rule. The
general case of a continuation line in a multi-line statement not counting is
D-P8-09's chosen rule, not a defect.

### codex-4 — "at least as strong" — holds

`atLeastAsStrong` (`assertions.ts:157`) returns `true` whenever only `before`
is negated. `EXISTENCE` → any ranked equality is accepted whatever the
expected value (`:164`). The tolerance branch (`:225-227`) never looks at
negation. **Probes:** `not.toBe(5)` → `toBe(5)`, `toBeTruthy()` → `toBe(0)`,
`toBeDefined()` → `toBe(undefined)`, and `not.toBeCloseTo(1, 2)` →
`not.toBeCloseTo(1, 3)` all give an empty delta. D-P8-08 lists "a negation
removed" as provably implying the old check, and `assertions.test.ts:73`
asserts it. Both are wrong: the new assertion contradicts the old.

**Fix:** a change of negation, either way, is weakened. Existence → equality
is dropped only as decision 4 allows. Narrowing a negated tolerance is
weakened. D-P8-08 is corrected, and the test row at `:73` moves to the
weakened table. That strengthens the check. It does not relax one.

### codex-5 — execution context — holds; known limit

Identity (`assertions.ts:174`) is operator, arguments, and tolerance, by
design (D-P8-08, "wherever they moved"). **Probes:** an assertion moved into
an uncalled arrow, and one under a local no-op `expect`, both give an empty
delta. Reachability cannot be established from syntax. The control that
catches an assertion that never runs is mutation testing: a mutant survives
it. `mutation` is `null` in every set P8 builds, so no such set clears L3.

**Outcome:** a D-P8-13 known limit, naming M3 as the control that closes it.

### codex-6 — type-level assertions — holds

`extractAssertions` records a subject call's value arguments but not its type
arguments (`assertions.ts:82`), and drops a subject with no matcher (`:103`).
That comment is right for `expect(x)` and wrong for `assertType`, which is
itself the assertion. **Probes:** `expectTypeOf<Actual>()` and
`expectTypeOf<any>()` compare equal, and `assertType<Expected>(value)` parses
to nothing.

**Fix:** record subject type arguments, and record `assertType` as an
assertion.

### codex-7 — exported config mutation — holds

`exportedConfig` (`static.ts:284`) collects only `module.exports =`, so
`module.exports.testMatch = [...]` after it is ignored. `isPlainRead`
(`static.ts:261`) accepts `configDefaults.exclude` as a property value
anywhere in the file, so `const holder = { list: configDefaults.exclude }`
hands out the live array. **Probes:** jest enumerates the original
`testMatch`, and vitest the default `exclude`. **Runtime check:** in vitest
4.1.11, `configDefaults` is frozen but its `exclude` array is not, and a
`push` succeeds. So the real run would exclude everything the static read
included.

**Fix:** refuse a config that references `module` or `exports` anywhere but
the single `module.exports =` target. Require every reference to a known
import to lie inside the exported config expression.

### gemini-4 — side-effect import — holds in part

`scopeOf` (`static.ts:72`) skips an import with no clause, and no import's
effects are considered at all. **Probe:** `import './mutator.js'` beside
`[...configDefaults.exclude]` enumerates the default list. The runtime check
above shows the mutator can change what vitest runs. What holds is that the
static read cannot account for code a config imports. What is already owned
is the wider class of code that runs in the test process and can neuter a
check (setup files, transformers, environments). D-P8-11 gives that class to
policy's protected-path list, which P7 enforces.

**Fix:** refuse relative and absolute runtime imports in a config module, as
decision 2 describes.

### codex-8 / gemini-3 — hidden markers — holds

`isDeclarer` (`markers.ts:80`) and `chainOf` (`:26`) accept only an
identifier root reached through property accesses and calls, and match it by
text. `contextSkips` (`:60-71`) detects a destructured `skip` and then
searches for calls named `skip`. **Probes:** `import { test as check }` with
`check.only`, `test['skip']`, `({ skip: omit }) => omit()`, and `(test).skip`
each yield no marker.

**Fix:** unwrap parentheses and type wrappers. Accept literal element access.
Treat an import specifier whose imported name is a declarer as a declarer.
Follow the destructured local name. Handle `extend` bindings and refuse any
other declarer escape, as decision 5 describes.

### codex-9 — unbounded output on the host — holds; P2's code

`dockerCli` (`packages/sandbox/src/local/docker.ts:97-117`) keeps every chunk
until `close`. The optional timeout bounds time, not bytes, and `QUOTE_LIMIT`
(`behavioral.ts:41`) only shortens a mismatch message after collection. The
buffering predates P8 (P2, `ddc317c`). P8 added only stdin. Every verification
command that P6 will run takes the same path.

**Outcome:** a pending entry, owner P10, the next unit to change the sandbox
provider (decision 3). The fix is a byte cap enforced during collection that
kills and refuses, never truncates.

### codex-10 — missing jest root — does not hold

`jestSuites` (`discovery.ts:423`) skips a root that does not exist. That is
what jest does: jest-haste-map 30.2.0's node crawler returns without error
when `readdir` fails on a root, and its native `find` path ignores the exit
status. So the enumeration is what jest will run. **Probe:** the behaviour
reproduces, but nothing is under-reported. The files are gone, the list is
shorter, and refusing a suite that shrank between base and head is the
comparison P6 and P7 own (`CheckSpec.expectedSuiteCount`, `TamperReport`).
codex itself names that deferral. **Outcome:** reject.

### codex-11 — whitespace inside literals — holds

`text()` (`assertions.ts:21`) collapses `\s+` across the node's whole source
text. **Probe:** `toBe('a  b')` and `toBe('a b')` are the same assertion.
**Fix:** collapse whitespace only outside string, template, and regex literal
tokens.

### codex-12 — polynomial backtracking — holds

`assertLinearPattern` (`discovery.ts:241`) refuses nested quantified groups
and backreferences, and nothing else. **Probe:** `a*a*a*a*a*a*a*a*b$` is
accepted. Against `/r/` plus n `a`s plus `.ts`, it takes 0.2 ms at n=8,
11.7 ms at n=20, and 42.2 ms at n=24. That is growth of roughly n⁷, which
puts a single 100-character file name at about a quarter of an hour on the
host thread. D-P8-12 threatens exactly this: a crafted pattern against a
crafted path, both chosen by the agent. **Fix:** decision 1.

Recorded and not acted on: picomatch compiles `testMatch` globs to JS regexes
as well. Whether a crafted glob can backtrack the same way was not checked,
and no reviewer raised it.

### codex-13 — directories and special files at config paths — holds in part

`walkTree` (`files.ts:132-140`) records no directory. `sameEntry`
(`files.ts:161`) calls two `other` entries equal. **Probes:** an empty
directory named `jest.config.ts` is not a config change, and jest discovery
refuses that tree ("not a regular file"). The directory part therefore has no
consequence: no framework loads a directory as its config, discovery refuses
it, and a config file replaced by a directory is already reported as
removed. The special-file part does have one. A FIFO or device where a config
is expected is an input that cannot be read, and it is called unchanged,
where fail-closed requires a refusal.

**Fix:** a selected path that is `other` on either side is refused. The
directory part is rejected.

### codex-14 — the host-execution scan — holds in part

The scan (`packages/conformance/src/registry/adapters.ts:109-119`) matches a
direct call on the identifiers `eval` and `Function`, a fixed module list, and
computed `import`/`require`. **Probe:** a file added to `packages/adapters/src`
that calls `(globalThis as …)['eval'](text)` leaves
`I1.adapters-execute-nothing-on-the-host` passing. Its title claims the scan
catches calls to eval. What does not hold is any agent-reachable consequence:
the adapters' own source is runtime code, inside the trust boundary. The
defect is the strength of the regression guard, and the assertion's claim.

**Fix:** flag every reference to `eval` and `Function`, not only direct
calls, and literal element access to them. Narrow the title to what is
matched. Add the assertion codex asks for: enumeration over a config that
would write a marker file if it were ever evaluated, requiring the marker to
be absent. That fails whenever parsing is replaced by loading, however the
loading is spelled.

### codex-15 — `ExpectationOutcome` — holds

`packages/integrity/src/types.ts:41-43`. **Checked with `tsc`:** assigning a
non-fresh `{ held: true, mismatches: [...] }` and calling `.pop()` on a failed
arm both typecheck. A-P8-01 says the arms make both states unrepresentable.
The only constructor, `compareCli`, builds consistent values, so the
consequence is the overstated contract claim, not a live path.

**Fix:** `{ readonly held: true; readonly mismatches?: never } | { readonly
held: false; readonly mismatches: readonly [M, ...M[]] }`, with the A-P8-01
changeset updated.

### gemini-5 — upstream `any` — does not hold

A runtime assertion whose text is unchanged checks the same value whatever
its subject's static type. An `as any` upstream does not weaken `toBe(5)`.
The type-level case, where a type argument does change what is asserted, is
codex-6. **Outcome:** reject.

### gemini-6 — growth during read — holds in part

`readRegularFile` (`files.ts:66-76`) checks the size, calls
`FileHandle.readFile()`, and then checks the length. Its own comment
anticipates growth. `readFile` reads up to the size its own `fstat` reports,
not up to a size that keeps growing. So the window is growth between the two
`fstat`s, bounded by Node's 2 GiB read limit, and a file that `fstat` reports
as empty is read to EOF. It needs a tree mutated while it is read. Not
demonstrated. **Fix:** read at most cap + 1 bytes in bounded chunks and
refuse beyond the cap, so the check the comment describes is the one that
runs.

## What changed

Source: `files.ts` (link-free descent, bounded read, special files),
`discovery.ts` (contained patterns, config imports, the matcher behind
`assertLinearPattern`), the new `pattern.ts`, `coverage.ts` (denominator and
executable lines), `assertions.ts` (negation, existence, tolerance,
whitespace, type arguments), `markers.ts` (declarer resolution and refusals),
`static.ts` (export mentions, copies of known defaults), and
`packages/integrity/src/types.ts` (exclusive arms).

Assertions: `packages/conformance/src/registry/adapters.ts` now reports every
mention of `eval` or `Function`, not only a direct call, and the adapters'
suite asserts from the outside that a config which would write a file when it
is evaluated writes none. `fixtures/types/i2/check-result-declares-expectation.ts`
gained the two violations codex-15 described. Two pending entries were added
with their baselines raised in the same change:
`I3.coverage-report-is-not-writable-by-the-suite` (P6) and
`I9.sandbox-output-is-bounded` (P10).

Records: D-P8-04, D-P8-06, D-P8-08, D-P8-09, D-P8-12, D-P8-13 and A-P8-01
were corrected or extended where a review showed them wrong, and D-P8-14 and
D-P8-15 were added for the two limits handed to other units.

Regression tests, each shown failing against the code before its fix: four for
path and pattern containment, three for coverage, nine for assertions and
markers across both adapters, five for the config reader, two for a config
never being evaluated, one for a special file at a config path, and 300
generated cases asserting the new matcher answers as `RegExp` does.

Two notes, recorded rather than acted on. picomatch compiles `testMatch` globs
to regular expressions as well, and whether a crafted glob can backtrack the
way codex-12's pattern did was not checked; no reviewer raised it, and it is
not this unit's to widen into. And gemini-6's bound is structural: the old code
refused the same inputs after buffering them, so the fix changes what the
process allocates and not what it answers, and no test can tell the two apart.

## Acceptance, re-run in full

`pnpm typecheck`, `pnpm lint`, the driver assertions that write the conformance
run report (56 tests, against a real model, which had to be re-run because a
change to `@olympus-ai/integrity` is part of that package's tree hash),
`pnpm test` (1,263 tests across nine packages, 3 skipped: two sandbox, one the
special-file test that needs a POSIX host), and `pnpm conformance` (89
assertions). All green.
