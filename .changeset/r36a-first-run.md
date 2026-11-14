---
"@olympus-ai/api": minor
"@olympus-ai/vault": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/compiler": patch
"@olympus-ai/benchmark": patch
---

R36a: the shipped example runs on the real driver.

- A run's base is the tree of `--base-commit`, read from git's object store,
  never a copy of the working folder: nothing untracked or ignored reaches a
  model, and a `core.autocrlf=true` checkout integrates (#148, #154). The
  run's own files join it with the bytes `create` read; one committed with
  other bytes is refused at admission.
- Admission refuses a tool grant the seat's driver does not declare, and
  every refusal that reads the base, before the worst-case cost (#145, #150).
- A failed driver or sandbox attempt is recorded as an `attempt-failed`
  decision with its source, layer, and first 400 characters; a retry park
  names it; the stopped standing carries `lastFailure`; the event stream
  sends `attempt-failed`; `createApiServer` takes a `log` sink (#149).
- The drafter's request names `.drafts/<run id>/` (#151).
- The Claude Code CLI is pinned at 2.1.310, which calls every tier's model;
  its tool inventory gains `Monitor`
  (#152).

- The benchmark's seats declare the tools its policy grants, by the names a driver declares.
