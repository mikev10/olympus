# External review of R26, codex, 2026-10-31

The codex review of R26, Driver: Codex: the Codex CLI driver and the relay's Responses meter. Its findings are verified and decided in `2026-10-31-R26-codex-driver-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. a headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** codex-1 was raised by Gemini too (gemini-1), and codex-3 too (gemini-2). codex-2, codex-4, and codex-5 were raised by Codex alone.
- **Date:** 2026-10-31
- **Bundle:** `2026-10-31-R26-codex-driver-review-bundle.txt`, SHA-256 `901475a10ff11eb1b6783be8551afba916d69e26aceeecce2c9d27bebb7f05ec`, base `reviewed/R23`, head `fcd1cca` (the unit branch as shipped). Every new file in full and every modified file as a function-context diff. `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-10-31-R26-codex-driver-review-prompt.txt`.
- **Prior context and lookups:** It said it had no prior context and made no lookups, and that local command execution was blocked. This is a self-report and cannot be checked independently.
- **Coverage, and any gap:** It answered items 1 to 7. Item 7 says the framing is right and that the boundary is wider than the advertised tools.
- **Citations:** line numbers refer to positions in the bundle, not the repository, and are treated as hints.

---

BASE: reviewed/R23
HEAD: fcd1cca
packages/sandbox/test/upstream.ts
18ca2198f00dee1cb47f803a4a75aba3

Prior context: none. External lookups: none. I reviewed the inline bundle. Local command execution was blocked, so I did not execute tests or independently verify the attachment’s SHA-256.

1. **`packages/sandbox/src/local/relay.ts:541` — factually wrong — high — A shell command can request billed hosted tools directly through the relay.**

   The Responses branch checks the request’s model and output ceiling, then forwards its original body. It does not restrict `tools` to the task’s grant or exclude hosted tools.

   **Construction:** In a task granted `exec_command`, send an HTTP POST directly to `$MODEL_RELAY_URL/v1/responses`, naming a priced model and supplying a hosted web-search tool and a prompt requiring its use. No real credential is needed: the relay supplies it. This bypasses the driver’s CLI inspection entirely.

   The supplied source explicitly identifies web search as billed outside the usage this meter reads (`packages/drivers/codex/src/tools.ts:37`). Consequently, the relay can record valid input/output usage and report an unexhausted budget while omitting tool charges. Disabling web search in the CLI does not constrain another HTTP client inside that container.

   **Resolution:** Validate the complete spending-relevant request shape at the relay. Reject hosted tools and unsupported billing options before forwarding, or meter their charges explicitly. Add a test issuing this request from a sandbox command, independently of the CLI.

   **Confidence:** High for the missing enforcement and bypass route. Successful invocation of a particular hosted tool depends on the priced model supporting it.

2. **`packages/drivers/codex/src/driver.ts:248` — factually wrong — high — Earlier commands can retain capabilities during a later task with an empty grant.**

   `cancel()` only deletes an inspection. Task execution is serialized, but serialization waits for the provider’s exec promise; it does not establish that all task-created processes have exited. The driver explicitly supports repeated tasks on the same container.

   **Construction:** During a shell-enabled task, launch a detached process with its standard streams redirected. Let the original invocation finish. The process waits for the next CLI invocation, then writes a workspace file or sends relay requests while that next task has `tools: []`.

   The later inspection can honestly report zero offered tools. The later CLI can honestly report no command events. Nevertheless, an earlier task’s commands remain active and act during it. The inspection and event reader do not observe or revoke that retained authority.

   **Resolution:** Establish a process boundary between tasks: preferably destroy the sandbox and provision a fresh one, transferring only permitted workspace data. Alternatively, use runtime-controlled process containment and terminate every descendant before admitting another task. Test with a deliberately detached survivor.

   **Confidence:** High for the driver-level gap. An independently enforced provider lifecycle that kills all descendants between execs would resolve it, but that enforcement is not shown in this bundle.

3. **`packages/drivers/codex/src/capture.ts:45` — factually wrong — medium — The inspection evidence is writable by the adversary it is meant to check.**

   The capture server writes `requests.json` into a temporary directory owned by the sandbox uid. A surviving process under that same uid can enumerate `/codex-homes/c.*` and replace the file before the wrapper prints it. Directory mode `0700` and the parent’s sticky bit do not separate processes sharing an owner.

   **Construction:** A survivor watches for a capture directory, reads its request, and replaces the recorded tool list with the expected grant while retaining the model and placeholder authorization. The wrapper subsequently places those attacker-written bytes between its genuine markers. The attacker does not need to forge or guess the nonce.

   This construction falsifies the inspection evidence; by itself it does not prove that the unchanged CLI configuration offers an extra tool. It does prove that the inspection cannot independently detect a widened session under the stated process-survival threat model.

   **Resolution:** Collect and validate the actual task’s requests outside the task’s writable security domain, ideally at the relay. A preliminary invocation plus a same-uid capture file is not an attestation of the later invocation.

   **Confidence:** High.

4. **`packages/drivers/codex/src/events.ts:58` and `:100` — factually wrong — medium — Missing or malformed usage becomes a completed zero-usage turn.**

   `count()` converts invalid or absent numbers to zero. A `turn.completed` event initializes `usage` even when the event has no usage object. Similarly, a missing thread identifier becomes `''`, which passes the later check for `undefined`.

   For example:

   ```json
   {"type":"thread.started"}
   {"type":"turn.completed"}
   ```

   With exit code zero, these events satisfy the completion checks in `refuseUnusable`: there is a defined thread ID, defined usage, and no recorded failure, unknown event, or unreadable line.

   This is a concrete fail-open parser path. It does **not** independently bypass relay accounting, which is separate from the CLI’s usage report.

   **Resolution:** Validate required fields and numeric counts before recording completion. Record malformed known events as unreadable, and require a nonempty thread identifier. Add negative tests for absent usage, invalid counts, and malformed thread-start events.

   **Confidence:** High.

5. **`packages/drivers/codex/test/plants.ts:34` and `packages/drivers/codex/test/driver.test.ts:249` — factually wrong — medium — The instruction-source assertion claims coverage that its positive control does not establish.**

   Seven plants are installed, but the control requires evidence for only three: the overriding root document and two root skills.

   The root `AGENTS.md` is planted alongside `AGENTS.override.md`, so its absence can result from ordinary precedence rather than the protective setting. Nested plants are tested from `/workspace` without a task that enters or accesses their subtree. The config plant changes `developer_instructions`, which the invocation also explicitly supplies.

   Thus, several negative checks can remain green when the corresponding protection is removed: those plants may never have been eligible to affect that invocation. This is a vacuous-check problem, not evidence that the whole suite is tautological.

   **Resolution:** Test each source independently with an invocation that demonstrably loads it when its particular protection is removed. Include nested-directory access and a config control whose effect is not already overridden by another argument.

   **Confidence:** High for the coverage gap; whether each source is actually exploitable requires testing the pinned CLI.

The following mechanisms look sound within the evidence shown:

- **Grant grouping:** `groupsFor()` rejects unknown tools and incomplete groups before execution. Exact offered/granted set comparison also detects extra, missing, and duplicate names when its capture is authentic.
- **Family declaration:** `FAMILY` is assigned explicitly and returned independently of the model name. Its branding cast does not create an adversarial bypass under the stated boundary.
- **Credential architecture:** Keeping the real credential in a separate trusted relay is materially stronger than masking it inside the CLI. I found no concrete credential-extraction route in the shown changes.
- **Relay configuration validation:** The new dialect is explicitly enumerated, model lookups require own properties, and missing output ceilings are rejected at provisioning. TypeScript casts cannot bypass those runtime checks.
- **Refusal tests:** Many tests require a specific refusal class or layer, rather than accepting arbitrary exceptions. I found no new assertion that literally passes regardless of the implementation. The broader report-reconciliation implementation is not included, so I cannot independently certify its skipped-test behavior.

The adversarial framing is appropriate. The crucial boundary is broader than the CLI’s advertised tool list: shell access also grants an HTTP client and the ability to leave processes behind. A successful preliminary inspection therefore cannot establish that every subsequent action or billable request obeyed the task’s grant.

One qualification to the budget framing: the relay deliberately admits a call while below budget and refuses subsequent calls after crossing it. That is a **tradeoff I would have made differently** for a strict spending ceiling, rather than unnoticed spend by itself. A hard ceiling requires reserving a conservative maximum cost before forwarding.