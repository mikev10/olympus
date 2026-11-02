---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/compiler": minor
"@olympus-ai/conformance": minor
"@olympus-ai/cli": patch
---

Separation of duties across every seat (R9, A-R9-01).

- `core`: `SeatRole`, `SeatIdentity`, and `ReviewSeatKind`; `ReviewSeat` carries a `kind` and records identities, role, driver, and model. `seatReviewer` takes the seat's kind and identities, refuses a reviewer that is an author's identity or whose role or driver was not recorded, and grades families as before. `REVIEWER_ROLE`, `SECURITY_REVIEWER_ROLE`, `securitySeatId`, `isSecuritySeat`, and `securitySeatContract`.
- `vault`: `UsageRecord.driver`, refused when absent; a seat and a usage record committed before R9 read as not recorded.
- `api`: `parseGraph` derives a security seat beside every review task and refuses a build task under a reviewing role; the line seats it under `security-reviewer` with the locked spec, the diff, and the evidence bundle alone; every usage record names its driver; the host seats the Codex driver where `FACTORY_CODEX_SEATS` names it, in its own image.
- `compiler`: the `security-reviewer` role ships with the defaults.
- `conformance`: five R9 assertions, one per new row of the matrix.
- `cli`: tests follow the figure the extra seat adds. Test only.
