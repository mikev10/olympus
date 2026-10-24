---
"@olympus-ai/core": patch
"@olympus-ai/vault": patch
"@olympus-ai/api": patch
"@olympus-ai/compiler": patch
"@olympus-ai/conformance": patch
---

Fixes from the external review of R19's runtime half (A-R19-11, D-R19-25). A test drafter's retry no longer carries a base run's check ids or exit codes, nor the paths an `exists` or `unbound` problem names: each becomes one `base-refusal` with nothing in it, since a drafted check chooses its exit code from what it read of the repository. The run's records keep the detail for a person. `recordDraftLock` returns the existing ref for a byte-identical record and still refuses another, and a resume writes a committed draft lock's unwritten, unlocked files into the artifact root before checking it, so a stop inside `lockApproved` no longer leaves a run stuck or records a false tamper. A drafted path outside the drafting role's `writableGlobs` is a runtime problem, `outside-grant`. The test-drafter role says what a retry carries. New assertions: `I5.draft-lock-survives-a-stop` and `I4.draft-outside-the-grant-goes-back`; `I3.base-refusal-carries-only-id-declaration-and-exit` becomes `I3.base-refusal-tells-the-drafter-nothing-of-the-repository`.
