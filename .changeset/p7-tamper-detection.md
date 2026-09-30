---
"@olympus-ai/adapters": minor
"@olympus-ai/integrity": minor
"@olympus-ai/vault": minor
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

P7: tamper detection. `analyzeTamper` reads the tree a task was handed against
the tree its checks ran over and reports weakened, removed, or widened
assertions, added skip markers, deleted tests (moves and renames that keep
their cases are not deletions), regenerated snapshots, protected-path and
config touches, and changed-line coverage. The line records each kind as a
violation, carries the report in the evidence bundle, shows it to the review
seat, and escalates the `integrate` exit; nothing halts the run.

Contract amendments: `TestFrameworkAdapter.enumerateCases` (A-P7-01),
`TamperReport.coverageDelta: number | null` (A-P7-02), and a required
`EvidenceBundle.tamper` (A-P7-03). `TransitionInput` gains `tamperFindings`.
`SKELETON_LINE` now names only the composition gap.
