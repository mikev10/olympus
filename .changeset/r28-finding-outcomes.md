---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/integrity": minor
"@olympus-ai/adapters": minor
"@olympus-ai/api": minor
"@olympus-ai/compiler": minor
"olympus-ai": minor
---

Finding outcomes, derived by the runtime (R28). The reviewer and the security seat now end with located findings (`category`, `path`, `line`), read strictly and recorded beside the seat's result; an unlocated finding is refused with its cause, an unreadable result is recorded as unreadable, and neither ever changes the task's status. A critic's finding names one of the draft's files. Both coverage adapters report each changed file's executed and unexecuted changed lines, and the evidence records them beside `coverageDelta`. A finding's outcome is a write-once runtime record: `resolved` by a covered merged change or by a changed and locked draft, or `dismissed` by a person with a cause and no text (`GET /findings`, `POST /findings/:id/dismiss`, `olympus findings`, `olympus dismiss-finding`); a finding with no record is open. R2 reports resolved, dismissed, and open per seat kind and per reviewer family, and says a code finding's resolved rate is unmeasured until a run records line coverage, which needs M3's coverage channel.
