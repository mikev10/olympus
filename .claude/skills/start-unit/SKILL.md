---
name: start-unit
description: Begin work on a decomposition unit. Loads the spine and the unit's spec, reads the code the unit touches, states the boundary and every assumption back, waits for the maintainer to confirm, then works the unit to its done-when criteria. Use when starting a new unit of Olympus v2 work. Takes a unit id, e.g. start-unit P1.
---

# Start a unit

This replaces a hand-written kickoff prompt. Everything a session needs lives in
the unit spec; this skill loads it and holds the boundary.

## 1. Load context, in this order

1. `CLAUDE.md` — invariants, vocabulary, conventions
2. `docs/plan/F1-spine.md` — invariants, frozen vocabulary, dependency graph
3. `docs/plan/WORKFLOW.md` — the three work types, the unit loop, where state lives
4. `docs/plan/DECOMPOSITION.md` — the named unit's entry only
5. The unit's detailed spec if one exists, e.g. `docs/plan/F2-contracts.md`

Load nothing else. The maintainer's master plan is not in the repository and
is never session context; `CLAUDE.md` says where it lives and that it stays
out.

## 2. Check dependencies

The unit entry names what it depends on. Verify each dependency has shipped —
its branch merged into `v2`, its acceptance criteria met. If one has not, say so
and stop. A unit built on an unshipped dependency will be rewritten.

## 3. Read the code the unit touches

The unit entry is a claim about the code, not evidence of it. Read what the
unit will change or build on: the packages it names, the types it consumes,
and the pending registry entries it owes. Note every place where the code
differs from what the entry says. An entry that says an input already exists
has been wrong before.

## 4. State the boundary and every assumption, then wait

Print the following, then stop. Write no code, no test, and no file until the
maintainer confirms (`CLAUDE.md`, working rule 6).

- Unit id and title
- Deliverables, one line each
- **Out of scope**, verbatim
- Acceptance criteria, as the commands that will prove them
- Which invariants this unit touches, and which pending registry entries it owes
- **Every assumption the plan rests on.** Mark each one verified, naming the
  file:line or the command that verified it, or unverified. Each unverified
  assumption is a question, asked here with a recommended answer
- Where the code differs from the unit entry, from step 3

If any of the first five is absent from the spec, say which, propose what it
should be, and ask. An underspecified unit is a spec defect, fixed in
`docs/plan/DECOMPOSITION.md` before writing code, not after.

## 5. Work the unit

- Conformance suite first. It is the acceptance criteria in executable form.
- Stay inside scope. Adjacent work becomes a note in the PR body, not a commit.
- Record every judgment call in `docs/decisions.md`: what was ambiguous, what
  was chosen, why, how to reverse it.
- Invariants outrank convenience. A change that makes the unit easier and
  weakens I1–I10 is wrong, however clean.
- Pay down pending registry entries this unit owns. Adding a new one requires
  editing the committed baseline — a deliberate act, visible in the diff.

## 6. Stop conditions

Stop and ask when:

- The spec contradicts itself, or contradicts `F1-spine.md`
- Meeting an acceptance criterion would require weakening an invariant
- The work needs a contract change (those are amendments, not unit work)
- A destructive operation has no safe default
- A fact the work depends on turns out different from what was confirmed
- A decision the confirmed plan does not cover would change an interface, a
  deliverable, the scope, or an acceptance criterion
- The next step depends on something that has not been verified and cannot be
  verified from here

A choice inside the confirmed plan that changes none of those is made,
recorded in `docs/decisions.md`, and the work continues. Anything outside it
waits for the maintainer.

## 7. Finish

Run the acceptance criteria. When they pass, invoke `ship-unit`.

Do not begin the next unit. Every unit boundary is a human review gate.
