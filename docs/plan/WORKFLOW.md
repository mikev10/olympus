# Workflow

Three work types. Every task is one of them.

**Unit** — a numbered entry in DECOMPOSITION.md. Delivers a package or a
capability. Runs the loop below.

**Amendment** — a change to a contract file, CLAUDE.md, the spine, or the
gates. Usually discovered by a unit that tried to use them. Amendments are
expected, not exceptions: a unit is the first real use of an interface, and
friction there is information. They do not run the unit loop; they are small,
targeted, and land before the next unit starts.

**Review fix** — a change accepted from an external review's triage. Lands on
the unit's own branch, before merge.

## The unit loop

1. `/start-unit <id>` — fresh session. It states the boundary back; read it.
2. Work. Conformance suite first. Decisions logged as they are made.
3. `/ship-unit` — same session. Verifies acceptance criteria, opens the PR.
4. `/review-request <id>` — bundle plus prompt for an external reviewer.
5. External review — temporary chat, different model family than last unit.
   Rotate. Save the raw response to docs/reviews/, tracked, with a header
   naming the reviewer.
6. Triage — verify every finding against the cited line before acting. Fix,
   record as a known limit with an owning unit, or reject with a reason.
   Findings are not instructions. Write the triage to docs/reviews/.
7. Merge the PR, then `git tag reviewed/<id> && git push --tags`. The tag is
   the diff base for the next review bundle.

Between step 7 and the next unit: land any amendments the unit surfaced.

## Where state lives

- What is built: git history and merged PRs
- What is next: the DECOMPOSITION.md dependency graph, first unit whose
  dependencies have shipped
- What is owed: pending registry entries, each with an owning unit
- Why something was done: docs/decisions.md
- What a review found and what was done about it: docs/reviews/

There is no separate status document. If "what is next" cannot be answered from
the four above, that is a gap in them.

## Answering "what is next"

Check in order: unfinished step in the current unit's loop; unlanded amendment
from the last unit; the next unit whose dependencies have all shipped.
