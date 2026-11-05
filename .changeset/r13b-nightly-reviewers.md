---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/compiler": minor
"@olympus-ai/conformance": minor
---

R13b: nightly reviewers. Two job templates seat the service's reviewer driver, read-only, under `deny-all` with the model relay as the only route out. `nightly-findings-review` gives a new `findings-reviewer` role the previous UTC day's records: decisions, trigger decisions, refused-delivery counts, and R13a's findings. Each arrives as a runtime id with typed fields and never its text. `nightly-tree-review` seats R9's `security-reviewer` role over the default branch's head, with the tree as its only mount. Each seat's family is checked through `seatReviewer` against every author the day holds or every author merged since the job last completed. At L3 a seat that shares an author's family is refused. Below L3 the job records reduced independence. A reviewer answers in strict JSON. A finding becomes an `intake` candidate only where the runtime can locate it: a file and line the tree holds, under `nightly-tree-finding`, or a record of the day, under `nightly-record-finding`. Any other finding is recorded as refused, and an unreadable answer refuses the job. The reviewer's text is kept as its claim in the nightly record, which gains `review`, and no prompt is ever given it. Neither job writes under any run.
