# Second external review of P5, 2026-09-20

The second of two external reviews taken in the same round, against the same
bundle and the same prompt as
`2026-09-20-P5-driver-claude-code-adversarial-review.md`. The companion triage,
covering both, is `2026-09-20-P5-driver-claude-code-triage.md`.

## Source

- **Reviewer:** Gemini, as the maintainer named it. Family: **Google Gemini.**
  Temporary chat, no repository access, no ability to execute anything. It
  worked from the attached bundle alone.
- **Family rotation:** ChatGPT reviewed F3, S1 and P4; Gemini reviewed P1, P2
  and P10. P10 was Gemini, so a Gemini review of P5 is a repeat of the
  immediately preceding unit's family and a rotation break. It is recorded as
  one deliberately: the OpenAI review beside this one is the rotation-correct
  review of P5, and this one was taken in addition rather than instead. A
  second family costs nothing but tokens and its findings do not overlap with
  the first's, which is the argument for having taken it.
- **Date:** 2026-09-20
- **Bundle:** `2026-09-19-P5-driver-claude-code-review-bundle.txt`, SHA-256
  `5dbb1ef8d4ab05e2195912f5ce9d9519a52d9ab368ce84095e87d409952607d8`, base
  `c49adf3` (`reviewed/P10`), head `aa515ec` (the tip of `unit/p5` at
  hand-over). Full contents of every changed file; `docs/decisions.md`,
  `docs/reviews/` and `docs/plan/` excluded by construction. Prompt:
  `2026-09-19-P5-driver-claude-code-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context,
  relied solely on the provided files and the stated invariants, and performed
  no external lookups. It did not confirm the bundle hash. Both statements are
  self-reports and are not independently verifiable.
- **Coverage, and any gap:** items 1, 3, 4 and 6 were answered directly. Item 2,
  tautological checks, was **not answered** — no finding addresses whether any
  check would pass regardless of the code under test, which is the gap the
  OpenAI review's finding 7 fills. Item 5, configuration satisfiable without
  doing what it appears to do, was **not answered separately**, though finding 3
  touches it. Item 7, whether the framing was right, was answered in one
  sentence endorsing it — the shortest possible answer, and notably the opposite
  of the OpenAI review's, which rejected the framing as too narrow in two
  places. Silence on items 2 and 5 is not endorsement of them.
- **Citations:** line numbers refer to positions in the bundle as the reviewer
  read it, not to positions in the repository. Every finding was located by
  opening the construct it describes rather than the line it cites.

---

I have reviewed the provided code bundle with no prior context, relying solely on the provided files and the stated invariants (I1-I10). I performed no external lookups.

Here are the findings, ordered by severity.

### 1. `emitArtifacts` Heredoc Shell Injection Bypasses Sandbox Logging

**file:line** — `packages/drivers/claude-code/src/driver.ts:497`
**type** — factually wrong
**severity** — high
**the concrete bypass** — `writeFileScript` constructs a shell script using a heredoc (`<<'FACTORY_ARTIFACT_EOF'`) to write `file.content` to a file. The content being written includes `CompiledRole.instructions` which comes from the compiler and must be treated as untrusted (an agent might have written the spec/tests that generated it). If these instructions contain the exact string `\nFACTORY_ARTIFACT_EOF\n` followed by malicious shell commands, the shell will exit the heredoc early and execute the injected commands directly in the sandbox. Because this occurs during `emitArtifacts` via a direct `sh -c` call, it bypasses the Claude CLI entirely. The driver's `eventsFrom` mechanism will record absolutely nothing about these commands, allowing an agent to exfiltrate data, alter the workspace, or hit the network silently, violating the observability constraints.
**what would resolve it** — Do not use heredocs for untrusted multi-line content. Securely pass the content out-of-band as an environment variable using `ExecOptions.env` (which you correctly leverage elsewhere), and write it via `sh -c 'echo "$CONTENT" > "$1"' -- "$FILE_PATH"`.

### 2. Cross-Task Artifact Pollution via Shared `#artifactSandbox` State

**file:line** — `packages/drivers/claude-code/src/driver.ts:166`
**type** — factually wrong
**severity** — high
**the concrete bypass** — `this.#artifactSandbox` is defined as a single class-level field on the `ClaudeCodeDriver`. While `#serialized` protects concurrent tasks *on the same sandbox*, a single `ClaudeCodeDriver` instance is shared across the `ComponentGraph` and handles concurrent tasks executing on *different sandboxes*. If Task A (Sandbox 1) and Task B (Sandbox 2) start concurrently, `#runTask` updates `this.#artifactSandbox = req.sandbox`, leaving `#artifactSandbox` pointing to Sandbox 2. When Task A completes and calls `emitArtifacts`, it will write Task A's artifacts into Sandbox 2's mount table. This completely breaks task isolation.
**what would resolve it** — Remove the stateful `#artifactSandbox` property. The cleanest solution is updating the `Driver` contract so `emitArtifacts` accepts the `SandboxHandle` directly. Barring that, `useSandbox(handle)` must be called synchronously inside a lock immediately before `emitArtifacts`, or the driver must map `targetDir` to specific `SandboxHandle`s.

### 3. `packageTreeHash` Hashes Untracked and Temporary Files

**file:line** — `packages/conformance/src/kit/run-report.ts:63`
**type** — unclear
**severity** — medium
**the concrete bypass** — `walkFiles(dir, { extensions: [''] })` hashes literally every file in the package directory that isn't explicitly excluded by `NOT_INPUT`. This means any ephemeral artifacts a test run happens to generate (e.g., in a `fixtures/out/` directory, a `.log` file, or IDE files) are hashed into the `run.json` report if they exist at the time `onTestRunEnd` fires. If these files are later ignored by `.gitignore` but cleaned up asynchronously, or if the developer runs `pnpm conformance` from a slightly different IDE state, the tree hashes will spuriously mismatch and fail the execution reconciliation.
**what would resolve it** — Constrain the hashing to tracked source code. Change the empty string extension to an explicit list of source extensions (e.g., `['.ts', '.json', '.js', '.md']`), or actively parse the local `.gitignore` rules during traversal.

### 4. Unhandled Rejection on Skipped Test Collections

**file:line** — `packages/conformance/src/kit/reporter.ts:50`
**type** — factually wrong
**severity** — low
**the concrete bypass** — In `onTestRunEnd`, the reporter calls `test.result().state`. If a test is collected by vitest but fails to run (e.g., due to a suite-level setup exception), `test.result()` returns `undefined`, which throws a `TypeError`. This crashes the reporter entirely, preventing `run.json` from being written. While this correctly fails closed (the registry will refuse with `report-missing`), it masks the underlying test error behind a kit crash.
**what would resolve it** — Safely extract the state: `state: test.result()?.state ?? 'skipped'`.

### 5. Memory Leak on Sandbox Teardown

**file:line** — `packages/sandbox/src/local/provider.ts:316`
**type** — a tradeoff I would have made differently
**severity** — low
**the concrete bypass** — `this.#sandboxes` maintains a reference to every provisioned sandbox. When `destroy` is called, `#end` successfully tears down the container and networks, but intentionally leaves the record in the Map to answer historical queries for `appliedControls`. This causes an unbounded memory leak tied to the lifecycle of the runtime process.
**what would resolve it** — Move ended sandboxes to a bounded LRU cache or archival record so the active handle map doesn't grow indefinitely, limiting memory footprint on long-running factory workflows.

### 6. Assessment of Framing and Sound Mechanisms

The adversarial framing is entirely appropriate given the requirements (default deny, robust runtime evidence).
The following mechanisms are **exceptionally sound**:

* **Credential Passthrough via Daemon Environment (`packages/sandbox/src/local/provider.ts:109`)**: Passing `-e NAME` without a value to force the `docker` CLI process to inherit the secret from its own `spawn` environment is brilliant. It ensures the API key never appears in `/proc/[pid]/cmdline` on the host or inside the sandbox, fully satisfying I1.
* **`spawnSubagent` Argv Safety (`packages/drivers/claude-code/src/driver.ts:285`)**: Passing `cli` arrays to `sh -c '... exec "$@"' "driver" ...cli` correctly bypasses shell word-splitting and avoids injection vectors for JSON stringified arguments.
* **Execution Reconciliation Tree Hashing (`packages/conformance/src/kit/reconcile.ts`)**: Ensuring a sibling package's external assertion is only trusted if the cryptographic hash of the package tree matched the state *when the test actually passed* represents a rock-solid resolution to trusting cross-workspace evidence.
