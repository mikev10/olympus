---
name: ship-unit
description: Open a pull request for a completed unit. Verifies the unit's done-when criteria, checks that no gitignored path is staged, creates the unit branch, and opens a PR whose body comes from the unit spec. Use when a unit's work is finished and verified. Do not use mid-unit.
---

# Ship a unit

Deterministic. No judgment calls. If a step fails, stop and report — never work around it.

## 1. Identify the unit

Read `docs/plan/DECOMPOSITION.md`. Find the unit whose work is complete. If
more than one is plausible, ask which — do not guess.

Extract from its entry: scope, deliverables, out-of-scope, acceptance criteria.

## 2. Verify done-when

Run every command in the unit's acceptance criteria, plus the standing four:

```
pnpm -r typecheck
pnpm -r lint
pnpm -r test
git ls-files -- .plan/          # must print nothing: the directory is maintainer-local
```

The last check is scoped to the maintainer-local directory on purpose. The
tracked planning documents live under `docs/plan/`, so a search for the word
"plan" across tracked paths reports them and proves nothing.

**Any failure stops the ship.** Report which criterion failed and stop. Do not
open a PR with a failing gate and a note explaining it.

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
Reference decisions by their `docs/decisions.md` id rather than restating them.

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
<ids and one-line summaries from docs/decisions.md added by this unit>

## Registry delta
<invariants moved between states; pending entries added or paid down.
 Omit this section if the unit touched no conformance assertions.>

## Review notes
<anything the unit found awkward, ambiguous, or worth a second opinion —
 including places where the spec was wrong>
```

The out-of-scope section exists so a reviewer does not report absent work as a
defect. It is the single most useful part of the body.

## 6. Report and stop

Print the PR URL. Do not merge. Do not push to `v2` directly. Do not begin the
next unit.

## Never

- Ship with a failing acceptance criterion
- Modify a done-when criterion to make it pass
- Touch `.github/workflows/`, `CLAUDE.md`, the conformance baseline, or a
  contract type file as part of shipping. Those are gate changes and belong to
  a unit that declares them in scope.
