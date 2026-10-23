---
"@olympus-ai/conformance": patch
---

Conformance fixes from the external review of R19's conformance half (D-R19-21). Stub drafting seats read their workspace when each call begins. The black-box assertion requires exactly the locked spec in the mounted workspace and refuses egress for the test critic too. The critic must be given the recorded draft's bytes even when the drafter's workspace changes after the record. A new assertion, `I3.drafted-tests-lock-and-run-at-verify`, takes an approved test draft through its lock and verify. Refused approvals must add exactly one decision and leave the grants unchanged. The park must be recorded before its commit. Drafting seats are graded by the model resolved, not the one reported. Rejection notes and base-run output are checked in the role and the workspace too.
