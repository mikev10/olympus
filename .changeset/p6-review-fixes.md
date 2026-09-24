---
"@olympus-ai/api": patch
"@olympus-ai/sandbox": patch
"@olympus-ai/conformance": patch
---

P6 review fixes, from the external review triaged in
`docs/reviews/2026-09-22-P6-verification-evidence-triage.md`.

A path beneath a link is no longer in a tree. Composition looked diff paths up
through a base link, so two tasks could make the runtime's host process delete
a file outside every workspace. Every tree operation now treats such a path as
absent, or refuses it (D-P6-12).

Each check runs in a fresh sandbox of its own, whose wall clock is the check's
`timeoutMs`. Admission refuses a timeout that is not a positive integer
(D-P6-13). A `unit` or `acceptance` check whose suites cannot be counted fails
the gate, whether or not a count is pinned (D-P6-14). The review seat is given
the runtime's diff listing, so a deletion is visible to it (D-P6-15), and its
result is held to the `TaskResult` key set, as build's is (D-P6-07).

The local provider's writability refusal requires search permission as well as
write permission (A-P6-04).

A check's dispatch through a file the task may be granted is registered as
`I3.check-dispatch-not-writable-by-the-task`, owned by P7; the I3 baseline rises
from 1 to 2 (D-P6-16).
