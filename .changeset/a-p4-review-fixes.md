---
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-P4-04: `ApprovalGrant` gains `usedAt: string | null`, and a human approval
now crosses one station exit rather than every later visit to the same station.
`transition` requires an unspent grant and returns the `ApprovalKey` it spends;
the line marks that grant used in the same commit as the station move, so a
stop between the two leaves it unspent. `approveStation` records a new grant
when no unspent one exists, so a task rebuilt after a failed verify is approved
in its own right. Spent grants stay in run state: they are the record that a
human approved.

A-P4-05: three fixes to what the line hands a station. `readText` hashes the
bytes it read and compares them to the admission hash, so a locked artifact
swapped between the lock check and the read is caught rather than handed to the
model. `runTask` takes its workspace mount mode from the station contract's
`writeBoundary`, so a review seat — which is granted no glob — is mounted
read-only over the work it judges. `recordTamper` takes the suspect separately
from the task it fails, so a mismatch found before a task ran is attributed to
the last role that actually acted or to `unattributed`, and records the
provenance of the driver at the station where it was found.

Both surfaced by P4's external adversarial review; see
`docs/reviews/2026-09-17-P4-station-machine-adversarial-triage.md`.
