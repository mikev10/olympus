---
name: ship-unit
description: Open a pull request for a completed unit, then request its external review. Verifies the unit's done-when criteria, checks that no gitignored path is staged, creates the unit branch, opens a PR whose body comes from the unit spec, and hands off to review-request. Use when a unit's work is finished and verified. Do not use mid-unit.
---

# Ship a unit

Deterministic. No judgment calls. If a step fails, stop and report — never work around it.

## 1. Identify the unit

Read `docs/plan/DECOMPOSITION.md`. Find the unit whose work is complete. If
more than one is plausible, ask which — do not guess.

Extract from its entry: scope, deliverables, out-of-scope, acceptance criteria.

## 2. Verify done-when

Run every command in the unit's acceptance criteria, plus the standing run,
once, on code `node scripts/local-check.ts preflight` already passed:

```
node scripts/local-check.ts full
```

It checks that `git ls-files -- .plan/` prints nothing, runs `pnpm typecheck`
and `pnpm lint`, then every package's tests, each on its own, and the
conformance package last, as CI orders them (D-TOOLING-13).

The last check is scoped to the maintainer-local directory on purpose. The
tracked planning documents live under `docs/plan/`, so a search for the word
"plan" across tracked paths reports them and proves nothing.

**Any failure stops the ship.** Report which criterion failed and stop. Do not
open a PR with a failing gate and a note explaining it.

**One exception, and only this one: the paid suites run in CI.** There are
three: the two model drivers' (`@olympus-ai/driver-claude-code` and
`@olympus-ai/driver-codex`), and the composed line's in `@olympus-ai/api`'s
`test/paid/` (D-I1a-07), which CI runs under the same `run-driver` label and
caches the same way. Everything below about a driver's report holds for each driver and for the
line's report too. The
model credentials exist only as CI's Actions secrets, so neither
`pnpm --filter @olympus-ai/driver-claude-code test` nor
`pnpm --filter @olympus-ai/driver-codex test` can run on a
maintainer's machine, and any change under `packages/` leaves each driver's
recorded report stale (D-A-CI-07). A unit's "the driver test runs once"
criterion is met by the pull request's `run-driver` job, not locally.
`local-check full` runs each driver's files that call no model, as CI does
without the label, and applies the rule below itself: it prints the entries
only CI can run as `NOT RUN HERE`, never as passed, and exits non-zero on any
other failure. Never run `pnpm -r test` in its place: it runs the conformance
package before the packages whose reports it reads, and in R55 it never
reached `api`, `cli`, or `benchmark`, with `--no-bail` or without.

The run passes when every failure in it is a paid suite's report and nothing
else. Locally that report is stale, absent on a fresh clone, or the record of
a run that refused for want of a key; none of those is evidence, and CI's is
the only one that counts:

- every failing test is a registry entry marked
  `(external: @olympus-ai/driver-claude-code …)`,
  `(external: @olympus-ai/driver-codex …)`, or
  `(external: @olympus-ai/api test/paid/…)`, or one of the two registry
  meta-tests that aggregate them (`registry > no entry is missing…` and
  `I8.registry-complete`)
- every problem line those meta-tests print is either about an external
  entry of `@olympus-ai/driver-claude-code`, of `@olympus-ai/driver-codex`,
  or of `@olympus-ai/api`'s paid suite — it names that package's report
  and cites `I8.external-assertion-execution-reconciled` — or is
  `<claim>: missing` for a `driver.*` claim

Any other failure, in any package, stops the ship as above. Say in the PR's
acceptance section that the paid criteria are pending CI, and never mark them
passed. The merge gate still holds: WORKFLOW step 7 merges only on green pull
request checks, and those include the paid run and a fully green conformance
registry against every fresh report.

## 2a. Leave the documents true

`CLAUDE.md`, working rule 7, and `docs/plan/WORKFLOW.md`, "Keeping the
documents current". Mark the unit done, then check:

```
node scripts/unit-status.ts write --done <ID>     # the id as DECOMPOSITION.md writes it: R13a, not r13a
node scripts/unit-status.ts check
git diff --stat -- docs/plan/STATUS.md            # one row changed, and no other line
```

A `write` that changes any other row means the branch is behind `v2` or the
decomposition changed on it: find out which before going on.

Then, for `README.md` and `CONTRIBUTING.md`, search each for what the unit
changed and read every hit against the code as it now stands:

```
git diff --name-only origin/v2...HEAD -- packages examples scripts
git grep -n -e '<each host variable, command, flag, file, package, or check the unit added, renamed, or removed>' -- README.md CONTRIBUTING.md docs/plan/WORKFLOW.md
```

Correct every sentence the unit made false, and add what a person running or
contributing to Olympus now needs: a new host variable in the README's table,
a new command or flag, a new package in the layout, a station now entered, a
stack now supported, a refusal that no longer happens. A unit that changed
none of what those documents state says so, with the search it ran.

**A document left false stops the ship**, as a failing criterion does. The
pull request's "Documents" section records the result.

## 3. Verify nothing ignored is staged

```
git status --porcelain
git ls-files --ignored --exclude-standard -c    # must be empty
```

Never `git add -A` or `git add .`. Stage explicit paths.

## 4. Branch and commit

```
git checkout -b unit/<id>        # lowercase: unit/f3, unit/p1
```

Commit message: `<id>: <unit title>`, then a body listing what was delivered.
Reference decisions by their `docs/decisions/` id rather than restating them.

## 5. Open the PR

Base is `v2`. Never `main`.

```
gh pr create --base v2 --title "<id>: <unit title>" --body-file <tmp>
```

The body is generated from the unit spec, in this order:

```markdown
## Scope
<the unit's scope, verbatim from DECOMPOSITION.md>

## Delivered
<what was built, one line each>

## Out of scope for this unit
<verbatim from the spec — this is what a reviewer should NOT flag as missing>

## Acceptance criteria
<each criterion, with the command run and its result>

## Decisions
<ids and one-line summaries from docs/decisions/<id>.md added by this unit>

## Documents
<each document changed and what in it, `docs/plan/STATUS.md` among them; or
 "none beyond STATUS.md", with the search that showed no sentence went false>

## Registry delta
<invariants moved between states; pending entries added or paid down.
 Omit this section if the unit touched no conformance assertions.>

## Review notes
<anything the unit found awkward, ambiguous, or worth a second opinion —
 including places where the spec was wrong>
```

The out-of-scope section exists so a reviewer does not report absent work as a
defect. It is the single most useful part of the body.

## 6. Report, then request the review

Print the PR URL. Then invoke `review-request` for the same unit, without
stopping to ask. The unit loop's next step is always the external review, so
halting here only to be told to continue costs a turn and gains nothing.

**Safe to chain**, because `review-request` produces two artifacts and stops: a
bundle file on disk and the prompt that will be sent with it. It opens nothing,
sends nothing, merges nothing, and contacts no reviewer. `review-request` then
chains into `run-review` under the standing authorization in D-TOOLING-09, which
holds only while the repository is public; that check is made there, at the
point of sending, not here.

**Only on success.** This step is reached only when step 2 passed and step 5
actually opened a pull request. A failed acceptance criterion stops at step 2
and never arrives here: a bundle built from a unit that does not pass its own
gates sends a reviewer at a tree that is about to change.

Do not merge. Do not push to `v2` directly. Do not invoke `run-review` yourself;
`review-request` does, after its own checks. Do not begin the next unit.

## Never

- Ship with a failing acceptance criterion, or reach step 6 with one
- Modify a done-when criterion to make it pass
- Edit `docs/plan/STATUS.md` by hand, or ship with a sentence the unit made
  false still standing in the README or CONTRIBUTING.md
- Touch `.github/workflows/`, `CLAUDE.md`, the conformance baseline, or a
  contract type file as part of shipping. Those are gate changes and belong to
  a unit that declares them in scope.
