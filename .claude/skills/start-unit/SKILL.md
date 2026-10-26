---
name: start-unit
description: Begin work on a decomposition unit. Loads the spine and the unit's spec, reads the code the unit touches, verifies every assumption and records the boundary in docs/decisions.md, works the unit to its done-when criteria, then chains through ship, review, and triage, stopping only on a rule-6 stop condition or at the merge gate. Use when starting a new unit of Olympus v2 work. Takes a unit id, e.g. start-unit P1.
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

## 4. Verify the boundary and every assumption, record it, then proceed

Write the following as the unit's first entry in `docs/decisions.md`, print it,
and continue to step 5 without waiting (`CLAUDE.md`, working rule 6). The
entry ships in the review bundle, so both reviewing families challenge it; that
replaces a confirmation typed by the maintainer, and it is only as good as the
verification behind each line.

- Unit id and title
- Deliverables, one line each
- **Out of scope**, verbatim
- Acceptance criteria, as the commands that will prove them
- Which invariants this unit touches, and which pending registry entries it owes
- **Every assumption the plan rests on**, each verified, naming the file:line
  or the command that verified it. Run what can be run rather than reason
  about it. An assumption that cannot be verified from here is a stop
  condition (step 6), not a guess
- Where the code differs from the unit entry, from step 3
- Every choice point the spec leaves open: the options, each checked against
  the code, the one chosen, what was rejected and why, and how to reverse it.
  Choose the strongest on correctness, security, and the invariants — never the
  easiest, and never the one that defers work to a later unit without an owner

If any of the first five is absent from the spec, propose what it should be.
Where the proposal follows from the spine, the dependency graph, and the
neighbouring units' entries, fix `docs/plan/DECOMPOSITION.md` in the unit's
first commit and record it here. Where it does not — the missing piece would
decide the unit's scope or what proves it done — stop and ask, with the
proposal as the recommended answer.

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
- The work needs a contract change (those are amendments, not unit work), or a
  gate-path change the unit does not declare in scope
- A destructive operation has no safe default
- A discovery would change the unit's scope, deliverables, or acceptance
  criteria
- The next step depends on something that has not been verified and cannot be
  verified from here

Everything else is decided without waiting: verify the options against the
code, take the strongest, record it in `docs/decisions.md` with what was
rejected and how to reverse it, and continue. A fact that turns out different
from step 4's record is corrected in that record, in a commit of its own, and
the work continues unless the correction meets a condition above.

When you stop, ask every open question together, each with its recommended
answer, and nothing else.

## 7. Finish

Run the acceptance criteria. When they pass, invoke `ship-unit`. From there the
chain runs `review-request`, `run-review`, and `triage-review` without stopping
to ask, and ends at the merge gate (`docs/plan/WORKFLOW.md`, step 7).

Do not begin the next unit. Every unit boundary is a human review gate.
