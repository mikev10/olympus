# External review of R20, gemini, 2026-10-22

An adversarial review of R20, the role compiler: `compileRoles` and how it
reads a roles directory, admission's pinning of every compiled role in the
write-once admission record and resume's reading of roles only from it, the
line's seat-to-role assignment and the role id and hash on every usage record,
and the Claude Code driver's rendering of the role on the CLI's argv. One of
two reviews run from the same prompt and bundle; the other is
`2026-10-22-R20-role-compiler-review-codex.md`. Both are triaged in
`2026-10-22-R20-role-compiler-triage.md`, which cites this review's
assessment as `gemini-obs`; it numbered no findings.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`api:generativelanguage/v1beta`), offering no tools; `cleanRoom` is `null`
  because an API call loads no local configuration. Exit 0, not timed out,
  254.5 s. Ingestion `complete`: 115,969 prompt tokens against a floor of
  81,523 (36,021 thinking tokens, 1,262 candidate tokens). Integrity
  `verified`. Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `e6473c9a175f33336bf06cc01ac4f778d7375ab01e96f04c1bba7e3e90a93efe`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `13c7302`.
- **Cross-family agreement:** none. gemini reported no findings; codex raised
  four (codex-1 to codex-4), none of which gemini raised. gemini's assessment
  of the driver's `--setting-sources ''` is the opposite of codex-1's doubt;
  on CLI 2.1.309 the triage found gemini's reading correct, an outcome its
  reply asserted without evidence the bundle could have given it.
- **Date:** 2026-10-22 (run started 2026-10-23T01:28Z).
- **Bundle:** `2026-10-22-R20-role-compiler-review-bundle.txt`, SHA-256
  `8470141b619068de2278340de754e03f0ed70ca02474a9a9af7e2aef69598587`, base
  `60b83a0` (`reviewed/R18`), head `a61aac4` ("R20: Role compiler"), two
  commits (the R20 spec amendment, #60, and the unit itself). It held 49 of the
  52 changed paths, new files in full and modified files as whole-function
  diffs; `docs/decisions.md`, `docs/plan/DECOMPOSITION.md` and
  `docs/plan/F1-spine.md` were excluded, and so was every unchanged file.
  Prompt: `2026-10-22-R20-role-compiler-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it held no prior context
  about the project and performed no external lookups. This is a self-report
  and is not independently verifiable.
- **Coverage, and any gap:** item 1 answered only in aggregate ("no places
  where the properties ... are violated"); item 6 answered at length; item 7
  answered (framing correct), with a note on `rolesProblem`'s duplication
  between `api` and `vault`. Items 2 (tautological checks), 3 (fail-open), 4
  (language escape hatches) and 5 (configuration satisfied without effect)
  came back empty. Item 2 is where codex-2, codex-3 and codex-4 sit, and all
  three held at least in part.
- **Citations:** the reply cites no line numbers; its references to
  constructs were located by name during triage.

---

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