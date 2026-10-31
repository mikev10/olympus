# External review of R26, gemini, 2026-10-31

The gemini review of R26, Driver: Codex: the Codex CLI driver and the relay's Responses meter. Its findings are verified and decided in `2026-10-31-R26-codex-driver-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. a direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1 was raised by Codex too (codex-1), and gemini-2 too (codex-3).
- **Date:** 2026-10-31
- **Bundle:** `2026-10-31-R26-codex-driver-review-bundle.txt`, SHA-256 `901475a10ff11eb1b6783be8551afba916d69e26aceeecce2c9d27bebb7f05ec`, base `reviewed/R23`, head `fcd1cca` (the unit branch as shipped). Every new file in full and every modified file as a function-context diff. `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-10-31-R26-codex-driver-review-prompt.txt`.
- **Prior context and lookups:** It said it had no prior context and made no lookups. This is a self-report and cannot be checked independently.
- **Coverage, and any gap:** It answered item 1 alone. Items 2 to 7 came back empty, item 7 (the framing) included, and that silence is not an endorsement.
- **Citations:** line numbers refer to positions in the bundle, not the repository, and are treated as hints.

---

BASE: reviewed/R23
HEAD: fcd1cca
packages/sandbox/test/upstream.ts
18ca2198f00dee1cb47f803a4a75aba3

I have no prior context about this project and performed no external lookups.

1. packages/drivers/codex/src/driver.ts:394 — a concrete bypass — high
The driver relies exclusively on the CLI to restrict the tools used by the model, validating them by inspecting the CLI's initial request. However, the sandbox provides full network access to the metering relay (at `MODEL_RELAY_URL`) to any process inside the container. Since the model has bash access (e.g., via `exec_command`), it can simply read `MODEL_RELAY_URL` and `OPENAI_API_KEY` (the placeholder) from its environment, and use `curl` to send HTTP requests directly to the relay. The relay enforces the budget and the path (`/v1/responses`), but it blindly trusts the request body and does not validate the `tools` array. This allows the model to use ungranted tools (such as `web_search` or `mcp`) by sending requests directly to the relay, entirely bypassing the driver's CLI tool validation while both the driver and the relay report that everything held.
*Resolution:* The relay must be aware of and enforce the task's granted tools by validating the `tools` array in the request body before forwarding it to the upstream API.

2. packages/drivers/codex/src/capture.ts:13 — a concrete bypass — medium
Because multiple tasks can run sequentially in the same reused sandbox container (as demonstrated in the parallelism test: "a second task on one sandbox waits for the first"), a background process left running by an earlier task will execute as the same user (`uid 1000`). During the `inspect` phase of a later task, the driver creates a temporary directory `$cap` inside the sticky, world-writable `/codex-homes`. The malicious background process can poll `/codex-homes`, enter the newly created `$cap` directory (since it is owned by the same user), and overwrite `requests.json` with a benign request (e.g., one containing no tools or instructions). This causes `capturedFrom` to read the spoofed JSON instead of the CLI's actual request, bypassing the inspection check entirely. While the actual run uses command-line arguments to disable tools anyway, this spoofing defeats the explicit inspection mechanism designed to catch ungranted tools.
*Resolution:* Create the `$cap` directory in a location inaccessible to the sandbox user (such as a directory bound from the host), or enforce that no background processes survive between tasks when reusing a sandbox.