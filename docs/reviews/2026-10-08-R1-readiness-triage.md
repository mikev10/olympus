# Triage of R1's external reviews, 2026-10-08

Two reviews, both `counted`, from one prompt and one bundle:
`2026-10-08-R1-readiness-review-codex.md` (gpt-6-astra, family codex) and
`2026-10-08-R1-readiness-review-gemini.md` (gemini-3.1-pro-preview, family
gemini). Before each header was prepended, each reply's SHA-256 matched its
manifest's `replySha256`, and the reply beneath each header still hashes to
that value. Both runs sent one byte-identical payload (`20e474d0…`), both
ingested it completely (54,082 and 44,843 input tokens against a floor of
32,028), and both echoed every bundle marker. The bundle's SHA-256
(`356f9f3c…`) matches the one named in the prompt. Findings are cited by
family and number, as each reply numbers them.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 8 | 4 | 4 | 0 |
| gemini | 3 | 0 | 3 | 0 |

- **Both families raised:** one mechanism. codex-2 and gemini-1 are one
  defect: every executed probe mounts the same writable scan directory, so a
  repository command that runs earlier can change what a later probe runs and
  reads.
- **Did not hold:** none of 11. Seven hold in part, each because its stated
  consequence is wrong or overstated. gemini-1's account of tamper analysis is
  wrong (below).
- **Fresh-context verification:** the findings went to three subagents, grouped
  by file. Each got the finding text and the repository, with no account of who
  wrote the code. Each verdict below agrees with its subagent. The load-bearing
  code was then read directly: `materialize`, `checkPath` and `writeEntry` in
  `packages/readiness/src/tree.ts`; `execute`, `suite`, `readManifest` and
  `fileSizes` in `packages/readiness/src/scan.ts`; D-R1-11 and D-R1-12 in
  `docs/decisions.md`.
- **Executed:** codex-1 was reproduced: a commit built with `git mktree`, run
  through a copy of the real `materialize`, wrote a file outside the
  destination. codex-5 was tested by mutation. The rest were settled by
  reading. Docker-backed constructions for codex-2 to codex-4 were not run.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | Filenames decoded as UTF-8 collide; a symlink then redirects a later write outside the copy | codex | holds | fixed (D-R1-16) |
| gemini-2 | Host-side static probes follow committed symlinks out of the copy | gemini | holds in part | fixed at the copy (D-R1-16) |
| codex-3 | An all-skipped suite passes green-at-base | codex | holds | fixed (D-R1-17) |
| codex-4 | Any non-empty file at the report path passes coverage | codex | holds | fixed (D-R1-17) |
| codex-8 | The I2 fixture proves a label, not an origin | codex | holds in part | fixed (claim text) |
| codex-2 / gemini-1 | Earlier repository commands rewrite what later probes run | both | holds in part | known limit (D-R1-18) |
| codex-5 | The per-probe I8 assertion tests the derivation, not the probe | codex | holds | known limit (D-R1-19), issue #33 |
| codex-6 | Tamper analysis checks adapter presence, not analysis | codex | holds in part | decision (D-R1-20) |
| codex-7 | Omitted submodules do not constrain the ceiling | codex | holds in part | decision (D-R1-21) |
| gemini-3 | Quadratic buffering of large blobs in `materialize` | gemini | holds in part | known limit (D-R1-22) |

## codex-1 — holds — fix now

`materialize` (`tree.ts:56`) reads `ls-tree -r -z` through `execFile` with the
default UTF-8 decoding. With `-z`, git emits raw name bytes, so the names
`0x80` and `0x81` both decode to U+FFFD. `checkPath` (`tree.ts:111`) rejects
only empty, `.`, `..`, `.git` and backslash segments and a leading `/`.
`writeEntry` (`tree.ts:118`) does `mkdir(recursive)` and then `symlink` or
`writeFile`. It does no `lstat`, checks for no duplicate destination, and
checks for no symlink ancestor. Git tree order puts the symlink first.

Reproduced: a commit with a 120000 entry named `0x80` and a tree `0x81`
holding `readiness-escape-proof` made a copy of the real `materialize` return
`['�', '�/readiness-escape-proof']` and write that file into a directory
outside the destination. The write happens on the host before any sandbox,
and `rm(base)` at `scan.ts:158` does not undo it. A case-insensitive
collision (symlink `A`, directory `a/`) should do the same on Windows and
macOS. That variant was reasoned from the code, not run. No test covers
symlinks, invalid UTF-8, or collisions.

The prompt names "write outside the scan's copy" as a property to hold, and
this breaks it from the host process. Fix:

- Read the listing as bytes, and refuse any name that is not valid UTF-8.
- Refuse an entry whose destination repeats an earlier one, compared
  case-insensitively.
- Before each write, `lstat` every ancestor under `dest`, and refuse if any is
  a symlink.

Each refusal throws, as `checkPath` does.

## gemini-2 — holds in part — fix now

Holds: `writeEntry` creates real symlinks with the blob as target, absolute
targets allowed (`tree.ts:123`). `readManifest` (`scan.ts:177`) and
`fileSizes` (`scan.ts:270`) call `readFile` on the host with no `lstat`, so
they follow them.

The leak is narrower than claimed. `fileSizes` puts only a line count into
the report. `readManifest` puts the `JSON.parse` message into the detail, and
on Node 24 that message quotes about the first ten characters of the target.

The finding misses the worse consequence. A `package.json` that links to an
out-of-tree JSON file makes the manifest `read`, with scripts that are not in
the commit. Those scripts drive `pinned-manifest` and the build choice
(`scan.ts:140`). A probe outcome then derives from content the commit does
not hold.

Fix, as applied: at the copy, not at each reader. `materialize` refuses a
symlink whose target could resolve outside the copy (D-R1-16). That covers
`readManifest`, `fileSizes`, and the adapters package's own host reads
(`adapterSet`, `enumerate`), which an `lstat` at each reader in this package
would have missed. This replaces the per-reader `lstat` proposed when the
fix list was confirmed. It is a choice inside the confirmed fix, with no
change to an interface or to the scope.

## codex-3 — holds — fix now

`suite(..., 'green')` (`scan.ts:403`) runs `vitest run` or `jest --ci`.
`judged` (`scan.ts:349`) reads the exit code only. Enumeration (`scan.ts:225`)
counts test files on the pristine tree, and that count feeds only its own
probe. Vitest exits 0 when every test is skipped, and so does Jest with
`--ci`. green-at-base is an L0 probe, so a scaffold whose tests are all
`.skip` crosses the L0 boundary with nothing executed. That state is the easy
path, inside the prompt's no-deception threat model.

Fix: write the runner's JSON report (`--reporter=json --outputFile`, or
`--json --outputFile`) to a fresh output path. Require at least one passed
test and none failed.

## codex-4 — holds — fix now

The only artifact check is `test -s` on `/scan/out/coverage/coverage-final.json`
(`scan.ts:419`), a path inside the same `rw` mount (`scan.ts:77`, `:317`).
`{}` passes, and so does a stale file from an earlier probe. A coverage
`include` that matches nothing yields `{}` with exit 0, which is an easy-path
state. D-R1-12 says the report goes "outside the tree". That holds for
`tree/` but not for the mount.

Fix:

- The runtime creates an empty output directory for each run.
- The report must not exist before the run.
- A host-side parse requires an Istanbul object with at least one file entry.

## codex-8 — holds in part — fix now (claim text)

The fixture (`fixtures/types/i2/readiness-outcome-is-runtime-derived.ts`) and
`types.ts:76` use the literal `collectedBy: 'runtime'`, the project's
established convention. CLAUDE.md names it, and
`i2/evidence-collected-by-runtime.ts` uses it too. There is no brand, so any
caller can build the literal, as the fixture's spread shows.

The pattern is not the defect. The defect is the registry title
(`registry/readiness.ts:75`): "a model- or driver-supplied outcome does not
typecheck" claims provenance that the fixture does not test.

Fix: reword the title to say what is checked, which is that the label admits
no other value and the fields are readonly. The assertion is unchanged.

## codex-2 / gemini-1 — hold in part — known limit

Holds: `execute` mounts the one `scanDir` with `mode: spec.mode ?? 'rw'`, and
only the secret scan passes `ro` (`scan.ts:317`, `:359`). Install, build,
suite, coverage and the style probes share the tree, `node_modules` and
`/scan/out`. The static probes run first, on the pristine tree.

Overstated: the rewrite step adds little. Every executed probe runs repository
code, and two other routes reach the same result:

- Install lifecycle scripts run before the build, and they can replace
  `node_modules/.bin/*` just as well.
- The test script or config can exit 0 on its own.

Splitting the build from the suite would therefore not close the vector.
gemini-1 is also wrong that overwriting tests defeats tamper analysis, because
that probe reads only the adapter slots (`scan.ts:238`).

The construction requires deliberate deception, which the prompt scoped out.
The underlying limit is the point codex makes on item 7: an executed probe
establishes that the repository's own command reported success, not that the
property holds.

Record three things in `docs/decisions.md`:

- Executed-probe outcomes trust code the repository runs.
- A deceptive repository can fake any of them.
- A fresh tree per probe was rejected, because install precedes everything.

The codex-4 fix removes the stale-artifact part of the vector.

## codex-5 — holds — known limit, with an amendment question

Two mutations were run.

- **`tamperAnalysis` returning `supported` unconditionally:** every readiness
  registry entry still passed, `I8.ceiling-bearing-probe-has-an-assertion`
  included, and so did all 11 readiness package tests. The registry entry
  (`registry/readiness.ts:299`) builds outcomes and calls `deriveCeiling`. It
  never runs a probe.
- **`secretScan` and the green judgment mutated together:** 2 of 11 package
  tests failed, so secret scanning has a negative fixture.

Tamper analysis has no negative fixture. green-at-base has none either; that
was established by reading, not run.

The entry meets R1's own criterion as written. `docs/plan/R1-readiness.md:244`
reads "deleting the probe fails it", that is, removing the probe from the
declared set. It does not meet the general rule that an assertion fails when
the capability is deleted, where the capability is the probe's check.

A negative fixture for each ceiling-bearing probe is a new deliverable, and
some of those fixtures need Docker. That makes it an amendment to §6, not a
review fix. The fix-now items above add negatives for codex-1, gemini-2,
codex-3 and codex-4. Recommended: record the gap in `docs/decisions.md` with
each probe's current coverage, and open the amendment as an issue.

## codex-6 — holds in part — decision entry

`tamperAnalysis` (`scan.ts:238`) returns `supported` when the test and
manifest adapter slots are non-null, and its evidence says exactly that. This
matches the spec ("unavailable for the stack", `R1-readiness.md:150`) and
D-R1-12. The analysis itself runs at verify (D-P7-06).

The code is not wrong. The probe's name promises more than it checks. Record
that the probe means "the stack's tamper analysis is available", and that
refusing unanalyzable constructs is P7's job at verify. No code change.

## codex-7 — holds in part — decision entry

Gitlinks go to `skipped` (`tree.ts:66`), and `deriveCeiling` never sees
`skipped` (`scan.ts:151`). D-R1-11 records this.

A submodule is another repository at a pinned commit. A run on this
repository changes the pointer, not the submodule's content. Root code that
imports the submodule fails the build probe, because the copy omits it. So
the omission does not clear work that the ceiling governs.

What is missing is a statement of scope. Record that the ceiling covers the
scanned tree, and that a submodule is scanned as its own repository. No code
change.

## gemini-3 — holds in part — known limit

`pending = Buffer.concat([pending, chunk])` (`tree.ts:83`) copies quadratically
within one blob and holds the whole blob in memory. There is no per-blob limit,
and `maxBuffer` applies only to the `ls-tree` listing. `pending` is re-sliced
after each blob, so memory stays near the size of one blob, not the whole
tree.

A huge blob makes the scan fail. It fails closed and never produces a wrong
result. Record it as a known limit, together with the size cap that would
close it.

## What changed

- `packages/readiness/src/tree.ts`: the listing is read as bytes, and names
  that are not UTF-8 are refused. Symlink targets are checked (`checkLink`).
  Parent directories are created one at a time and refused if they already
  exist as a link or a file (`parentsOf`). Files are written with `wx`.
  `git cat-file` is killed when a refusal throws; without that, Windows held
  the repository open (`EBUSY`), which the new tests surfaced.
- `packages/readiness/src/scan.ts`: `suite()` gives each run a new, empty
  output directory, reads the runner's JSON results or Istanbul report from
  it, and requires at least one passed test and none failed, or at least one
  measured file. The `test -s` chain, `COVERAGE_DIR`, and `inTree`'s `then`
  parameter are removed.
- `packages/conformance/src/registry/readiness.ts`: the
  `I2.readiness-outcome-is-runtime-derived` title. The assertion is unchanged.
- `docs/decisions.md`: D-R1-11 and D-R1-12 are amended in place, and D-R1-16
  to D-R1-22 are added.
- Issue #33 tracks the amendment that codex-5 calls for.
- Changeset `a-r1-review-fixes.md`.

## Failing before, passing after

- `test/tree.test.ts`: all four refusal cases failed against the old
  `materialize`, each resolving where it should have refused. The fifth case,
  an in-tree symlink, passed before and after.
- `scan.test.ts`, "a suite whose every test is skipped" and "a coverage run
  that measures no file": both failed against the old `suite()`, which
  reported `supported` where `absent` was expected. This executes codex-3 and
  codex-4, which had been settled only by reading.

## Gates

- Readiness package (Docker): 3 files, 18 of 18 tests pass. That is the 11
  existing tests, 5 tree tests and 2 scan tests. Typecheck and lint are
  clean.
- Conformance: typecheck is clean. The registry ran 142 entries: 127 pass and
  15 fail. Every readiness entry passes. The 15 failures are 14 external
  entries whose reports come from the paid driver and api suites, not run
  locally, and `I8.registry-complete`, which fails because those reports are
  missing. The same 15 failed on the unfixed tree during verification. CI
  runs the paid suites.
