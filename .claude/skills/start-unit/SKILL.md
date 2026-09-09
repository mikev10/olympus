---
name: start-unit
description: Begin work on a decomposition unit. Loads the spine and the unit's spec, states the boundary back before starting, and works the unit to its done-when criteria. Use when starting a new unit of Olympus v2 work. Takes a unit id, e.g. start-unit P1.
---

# Start a unit

This replaces a hand-written kickoff prompt. Everything a session needs lives in
the unit spec; this skill loads it and holds the boundary.

## 1. Load context, in this order

1. `CLAUDE.md` — invariants, vocabulary, conventions
2. `docs/plan/F1-spine.md` — invariants, frozen vocabulary, dependency graph
3. `docs/plan/DECOMPOSITION.md` — the named unit's entry only
4. The unit's detailed spec if one exists, e.g. `docs/plan/F2-contracts.md`

Load nothing else. The maintainer's master plan is not in the repository and
is never session context; `CLAUDE.md` says where it lives and that it stays
out.

## 2. Check dependencies

The unit entry names what it depends on. Verify each dependency has shipped —
its branch merged into `v2`, its acceptance criteria met. If one has not, say so
and stop. A unit built on an unshipped dependency will be rewritten.

## 3. State the boundary before working

Print, and wait for nothing — this is a record, not a question:

- Unit id and title
- Deliverables, one line each
- **Out of scope**, verbatim
- Acceptance criteria, as the commands that will prove them
- Which invariants this unit touches, and which pending registry entries it owes

If any of those five is absent from the spec, say which, propose what it should
be, and ask. An underspecified unit is a spec defect — fix it in
`docs/plan/DECOMPOSITION.md` before writing code, not after.

## 4. Work the unit

- Conformance suite first. It is the acceptance criteria in executable form.
- Stay inside scope. Adjacent work becomes a note in the PR body, not a commit.
- Record every judgment call in `docs/decisions.md`: what was ambiguous, what
  was chosen, why, how to reverse it.
- Invariants outrank convenience. A change that makes the unit easier and
  weakens I1–I10 is wrong, however clean.
- Pay down pending registry entries this unit owns. Adding a new one requires
  editing the committed baseline — a deliberate act, visible in the diff.

## 5. Stop conditions

Stop and ask when:

- The spec contradicts itself, or contradicts `F1-spine.md`
- Meeting an acceptance criterion would require weakening an invariant
- The work needs a contract change (those are amendments, not unit work)
- A destructive operation has no safe default

Otherwise decide, record it, and keep moving.

## 6. Finish

Run the acceptance criteria. When they pass, invoke `ship-unit`.

Do not begin the next unit. Every unit boundary is a human review gate.
