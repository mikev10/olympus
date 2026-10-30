I had no prior context about this project, and I performed no external lookups.

BASE: 178d62a
HEAD: 7188bcb
packages/drivers/openai-compatible/test/invariants.test.ts
35213329fbf84920be86003807a938f5

### Findings

**1. packages/conformance/src/registry/workspace-instructions.ts:44** — ways the configuration can be satisfied without doing what it appears to do — High
The `owed` check only validates that `p.id === id`, completely ignoring the package ownership of the pending entry. A party introducing a new driver package can map their driver in `WORKSPACE_INSTRUCTION_ASSERTIONS` to an existing pending assertion ID that belongs to another package or domain (e.g., `I3.coverage-report-is-not-writable-by-the-suite`). Because this ID exists in the pending list, `owed` evaluates to `true`, and the check silently passes without the new driver actually registering or owing a relevant test.
*Resolve by:* Validating that the pending entry specifically belongs to the driver package being evaluated.

**2. packages/drivers/openai-compatible/test/invariants.test.ts:208 (and claude-code:172)** — places where the mechanism can succeed while the property it protects is violated — High
Both driver tests rely on a hardcoded list of known instruction file names (`PLANTED`). If a CLI or driver upgrade introduces support for a new instruction file name (e.g., `system.md` or `.claude/prompts`), the driver will read it from the workspace in production. However, because this new file name is not in the `PLANTED` array, it will not exist during the test run. The requests will remain identical, and the assertion will pass with flying colors while the isolation property is actively violated.
*Resolve by:* Ideally intercepting file reads dynamically in the sandbox (e.g., via strace or eBPF). Failing that, there must be a rigid single source of truth for accepted configuration file paths that fails tests immediately if the driver accesses unplanted workspace files.

**3. packages/conformance/src/registry/workspace-instructions.ts:83** — ways the configuration can be satisfied without doing what it appears to do — Medium
The registry check discovers driver packages by hardcoding the directory check `p.relativeDir.startsWith(DRIVERS_DIR)`. A party controlling the source of a new driver package can avoid owing a workspace-instruction assertion simply by placing the new driver in a directory outside `packages/drivers/` (such as `packages/new-driver`). The package will be entirely ignored by `workspaceInstructionProblems`, bypassing the requirement.
*Resolve by:* Identifying driver packages logically via a `package.json` property (e.g., a specific tag, keyword, or internal capability dependency) rather than strictly by directory path.

**4. packages/drivers/openai-compatible/test/invariants.test.ts:227** — fails open — Medium
The byte-identical assertion maps the logged HTTP requests down to `r.text` (the body content) and compares them using `toStrictEqual`. It completely ignores the HTTP method, the URL path (including query parameters), and HTTP headers. If an adversarial driver or a protocol upgrade passes workspace instructions to the endpoint via a custom HTTP header or query string, the request bodies will remain identically empty or unchanged, and the test will pass while the instructions leak to the model.
*Resolve by:* Expanding the comparison mapped object to include `path`, `method`, and relevant HTTP headers alongside `text`.

### Sound Mechanisms & Framing

**Soundness** 
- **The Claude Code control run:** This is an exceptionally sound mechanism. By extracting the exact recorded CLI command, stripping the `--setting-sources ''` flag, and executing it with a new session ID, it verifies that the tokens appear in BOTH the CLI's `init` parsing and the model's generated narrative. This prevents a maliciously modified driver parser (`parseStream`) or a silenced model from bypassing the test globally, as the control path relies on the exact same parser and response pipelines successfully surfacing the tokens.
- **The OpenAI-compatible body comparison:** Checking for byte-for-byte identical requests across bare and planted workspaces is a robust negative property check, successfully guarding against modifications sent in the standard JSON body.

**Framing** 
The adversarial framing is exactly right for this code. Evaluating the checks assuming no deceptive intent—but assuming the easiest path to green is taken—accurately exposes that hardcoded mock lists (like `PLANTED`) fail open against software upgrades, and that loose array `some()` checks (like `owed`) provide unintended escape hatches.