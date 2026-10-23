---
"@olympus-ai/compiler": minor
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/conformance": minor
---

R20: role compiler. Every seat runs under instructions a person wrote, compiled
from a roles directory at admission and pinned by hash (D-A-RC-01 to D-A-RC-06).

- New package `@olympus-ai/compiler`, depending on core alone:
  `compileRoles(directory)` reads one `<role-id>.md` per role and returns each
  as a `CompiledRole` with the SHA-256 of its bytes, or every entry it refused
  (`unreadable`, `not-regular`, `invalid-name`, `too-large` past 32 KiB,
  `not-utf8`, `empty`), each named. It ships `builder` and `reviewer` as
  `DEFAULT_ROLES_DIRECTORY`.
- core: `CompiledRole` gains `sha256`. `TaskRequest.role` is a `CompiledRole`,
  and `spawnSubagent` takes one. `DRIVER_CONTRACT_VERSION` is 2.0.0.
- vault: `AdmissionRecord.roles` pins every compiled role, and both Vaults
  refuse a record without it. `UsageRecord.role` names the role id and hash
  each call ran under (`RoleVersion`). `AdmissionRefusal` gains
  `roles-refused` and `role-undefined`.
- api: `RunRequest.roles` is the roles directory's absolute path, compiled at
  admission. A directory inside the workspace or the workspace store is
  refused (`overlaps`); a broken entry refuses as `roles-refused`, and a graph
  naming a role with no file, or a run with no `reviewer`, as `role-undefined`,
  before any driver call. The review seat runs under `reviewer` with its
  task's grants. A resume refuses a record with no roles. The server takes
  `rolesDirectory`, and the host reads `FACTORY_ROLES_DIR`.
- driver-claude-code: every task's role is rendered on the argv as the agent
  the session runs as (`--agents`, `--agent`), with its instructions and no
  other field; a session that did not load it is refused.
