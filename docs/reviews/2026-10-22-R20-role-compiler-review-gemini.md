BASE: 60b83a0
HEAD: a61aac4
path: pnpm-lock.yaml
hash: 1dc1f30465a80cf93bb99499d0b20382

I held no prior context about this project and performed no external lookups.

I found no places where the properties you asked me to check are violated. The mechanisms introduced in this change are extremely robust, defensive, and successfully uphold the invariants against the specified adversarial model. 

Below is my assessment of why the mechanisms are sound, followed by notes on the framing.

### 6. Soundness of Mechanisms

**compileRoles is sound**
- **Type/Name Checks:** It strictly checks `isRoleId` (alphanumeric and hyphens only, starting with a letter) and `.md` extension. It refuses directories and symlinks using `lstat` and `isFile()`.
- **Race Condition (TOCTOU) Defense:** It compares the `dev` and `ino` from `lstat` against the `FileHandle.stat()` at open to prevent file swapping.
- **Byte Cap:** It reads up to `ROLE_FILE_MAX_BYTES + 1` bytes and strictly fails if the file exceeds 32 KiB. This protects the downstream JSON stringification and `exec` arguments from size-based limits.
- **UTF-8 and Hash Pinning:** It hashes the *raw bytes* read from the file (`update(bytes)`), not the decoded string. By decoding with `fatal: true` and `ignoreBOM: true`, it guarantees the string is valid UTF-8 and retains any Byte-Order Mark. This ensures the runtime's later check (`update(instructions, 'utf8')`) exactly recreates the original bytes and hash without corruption.
- **Fail Closed:** If any entry in the directory is invalid (including non-role files like `.DS_Store`), it refuses the entire directory, refusing admission. 

**Admission and Resume are sound**
- **Path Overlap Checks:** `rolesProblems` uses `realpath` to check if the roles directory overlaps with the workspace or workspace store. Because it runs on the host, a symlink trick inside the workspace cannot bypass it. The agent cannot touch the roles directory because it is not mounted in the sandbox.
- **Mandatory Roles:** `admitRoles` checks that every role specified in the task graph, plus `REVIEWER_ROLE`, is present and successfully compiled. 
- **Immutable Pinning:** Roles (with their raw instructions and hashes) are written into the `AdmissionRecord`. Since the Vault is trusted and inaccessible to the agent, the instructions are fixed at admission.
- **Resume Validation:** On resume, `readAdmission` strictly reads the roles from the record and re-hashes the instructions to verify they match the pinned `sha256`, preventing any silent corruption from taking effect.

**The Line and Usage Recording are sound**
- **Role Assignment:** `runTask` does not trust the task graph for the reviewer seat; it explicitly looks up `pinnedRole(ctx, REVIEWER_ROLE)`.
- **Decoupled Capabilities:** The `CompiledRole` object contains only `role`, `instructions`, and `sha256`. It is structurally incapable of carrying tool grants, network access, or tier budgets, meaning a role file cannot become a second source of grants.
- **Usage Records:** `recordUsage` and `recordPending` reliably record the `role.role` and `role.sha256` of the `CompiledRole` passed to `runTask`. A call that fails (producing a `lost` reading) still accurately records the role version it attempted to use.

**The Claude Code Driver is sound**
- **Argument Passing:** The driver passes the instructions entirely via the argv: `--agents {"role": {"prompt": "..."}} --agent role`. It uses `exec "$@"` inside `sh -c`, perfectly forwarding the array without any shell interpretation or injection risk. 
- **No Workspace File Delivery:** It does not deliver the instructions via a file in the workspace, meaning the agent cannot overwrite its own instructions mid-flight.
- **Session Verification:** The driver checks `init.agents.includes(role.role)` by reading the CLI's pre-turn stream output. If the CLI fails to load the specified role, the driver refuses the session entirely. There is no fallback to a default prompt.
- **Settings Isolation:** By passing `--setting-sources ''`, the driver disables Claude Code from reading `.claude.json` or `.claude/agents/*.md` from the workspace, blocking the agent from attempting to override the role via config files.

### 7. Assessment of Framing
The framing of the adversarial question is correct and directly targets the exact vulnerabilities that a system running untrusted code under constrained instructions would face. 

The threat model accurately identifies the agent's capabilities (controlling the workspace and its own outputs) and non-capabilities (code running in the host process, the Vault, the Sandbox). The code anticipates every vector identified in the framing:
- **Changing instructions:** Prevented by argv-only delivery and `--setting-sources ''`.
- **Changing records:** Prevented by the runtime computing the role version from the Vault's admission record rather than trusting model outputs.
- **Gaining capabilities:** Prevented by removing all capability fields from the `CompiledRole` interface.

*(Note on code duplication: I observed that `rolesProblem(roles: unknown)` is duplicated in `packages/api/src/run.ts` and `packages/vault/src/local/vault.ts`, with the `api` version adding a check for `REVIEWER_ROLE`. This is not a tautology or a bypass; it is simply defense-in-depth where the Vault validates structural integrity on write, and the API validates structural integrity + business logic on read).*