---
"@olympus-ai/api": minor
"@olympus-ai/adapters": minor
"@olympus-ai/conformance": minor
---

P6: verification and evidence. A run's trees are runtime-owned: admission
snapshots the working tree as the base, each build attempt runs over a fresh
copy of base and the accepted diff, and verification runs the pinned checks
over a tree built from base and the cumulative diff, read-only with no
egress. `git` is never spawned. `ComponentGraph` gains `workspaces`, a
`WorkspaceStore` (`localWorkspaceStore`).

The task's own diff is held to the locks (a locked path in it is a
lock-tamper) and to its grant (a path outside the role's and the station's
globs is a `capability-escape` violation). Suite counts are taken by the
adapters from the verified tree on the host. The claim's file list is diffed
against the runtime's diff into `claimEvidenceDiff`, recorded as a
`claim-mismatch` violation that does not halt the run. A driver result with a
key outside the `TaskResult` contract is refused before it is recorded. The
review seat's workspace holds only the files its grants cover. An L3 run is
refused at admission while any adapter control is unavailable
(`admissionRefusal`). `SKELETON_LINE` no longer names the claim/evidence diff.

`@olympus-ai/adapters` exports `diffTrees`, `walkTree`, and
`hashRegularFile`.
