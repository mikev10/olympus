BASE: reviewed/R37
HEAD: f6837cc
packages/drivers/claude-code/test/invariants.test.ts
75ee49a26c58257660d9aae9741fe55e

Prior context: None.
Lookups performed: None.

packages/drivers/claude-code/test/driver.test.ts:493 — factually wrong — high — `expect(call.cmd[call.cmd.indexOf('--tools') + 1]?.split(',')).not.toContain('REPL');` is a tautological check that passes silently if the driver omits the `--tools` argument (e.g., during the MCP inspection invocation, or due to a bug) or formats it with an equals sign (`--tools=Read`). In these cases, `indexOf('--tools')` returns `-1`, making the index `0`. The test then checks `call.cmd[0]`, which is the executable name (e.g., `'claude'`). Since `'claude'` does not contain `'REPL'`, the assertion passes, failing to detect if the tool restriction is absent. — Resolve by parsing the arguments properly or asserting that `--tools` is present before checking its value. 

packages/drivers/claude-code/src/driver.ts:213 — factually wrong — high — The mechanism correctly restricts the CLI instance launched by the driver, but can be bypassed if the task policy grants a command-execution tool (e.g., `Bash`). Because the driver passes the API key via environment variables (`apiKeySource: KEY_VARIABLE`), the CLI process inherits this secret and passes it to the tools it spawns. The model can then run `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude` inside the container to spawn a new, fully authenticated instance of the CLI. This child process bypasses both the driver's Code Mode override and the `--tools` restriction. The tests using `RecordingProvider` fail to notice this because they only intercept `docker exec` calls made from the driver, remaining blind to processes the model spawns within the container. — Resolve by passing the API key via a mechanism that isn't inherited by child processes, or by ensuring the sandbox runtime refuses execution of the `claude` binary from within the container's shell.

packages/drivers/claude-code/test/driver.test.ts:492 — factually wrong — low — `expect(call.cmd.some((arg) => arg.includes(SWITCH))).toBe(false);` is tautological because it checks if the exact environment variable name (`CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`) appears in the argv. If the CLI had a command-line flag to enable the feature, it would use a flag format (e.g., `--experimental-code-mode`), which this test would fail to catch. — Resolve by checking for the actual command-line flags that could enable Code Mode, if any exist, or remove the test.

**Sound mechanisms:**
Setting `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '0'` in `CLI_ENVIRONMENT` is sound for the specific CLI instance the driver controls. Because the vendor explicitly guarantees that a `0` in the environment overrides a `1` in any settings file, this successfully prevents the model from turning Code Mode on by modifying `.claude.json` or the `--settings` file in the workspace.

**Framing assessment:**
The adversarial framing is correct and effective. It focuses the review on what the model can achieve with the capabilities it holds (granted tools, filesystem access, container access) rather than merely looking at the driver's inputs. This specifically highlights the risk of secrets (API keys) and binaries being available to the model, allowing it to bypass restrictions by starting its own unrestrained sessions.