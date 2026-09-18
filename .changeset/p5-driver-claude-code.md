---
'@olympus-ai/driver-claude-code': patch
'@olympus-ai/sandbox': patch
'@olympus-ai/conformance': patch
---

The first driver: the Claude Code CLI, run inside a sandbox the driver did not
provision and cannot replace. `ClaudeCodeDriver` holds the `SandboxProvider`
that provisioned the handle in `TaskRequest.sandbox`, and every command it
issues goes through `provider.exec`, so the mount table is the only filesystem
the model can reach. A driver constructed without a provider cannot be
constructed.

`TaskRequest.stablePrefix` is appended to the session's system prompt and
`variableSuffix` is the turn, with the per-machine sections moved out of the
prefix, so two tasks in one run present the same cacheable span and the second
reads it rather than writing it again. The granted tools reach `--tools`, which
decides which tools exist in the session at all; a tool outside the grant is
unavailable to the model rather than merely unused, and an empty grant is an
empty session.

`SandboxProvider.exec` gains an optional `ExecOptions` whose `env` carries a
credential without it appearing in any argument vector: `LocalDockerProvider`
passes `--env NAME` and sets the value on the `docker` process it spawns, so
the secret travels through the daemon API rather than through an argv on either
side of the container. A name that is not an environment-variable name, and a
name with no value, are refused under a new `environment` layer.

An MCP server contributes its whole tool list to a session, so `--tools` alone
would leave a granted server's other tools available to the model. The driver
asks the CLI what the configured servers offer before running the task and
names everything beyond the grant in `--disallowedTools`, which removes it from
the session rather than denying it at use time. Servers that cannot be
inspected refuse the task.

Pays ten registry entries. `I1.driver-executes-inside-the-sandbox` and
`I4.driver-tool-inventory-validated` become live external assertions, and all
seven `driver.*` capability claims are asserted against the real CLI in a real
container — `subagents`, `hooks`, `mcp`, `parallelism` and
`stablePrefixCaching` by running tasks, `computerUse` and `steering` by proving
the absence they declare. `pending-baseline.json` drops I1 from 1 to 0, I4 from
2 to 1, and every `driver.*` claim from 1 to 0. Nothing was added in exchange.

`@olympus-ai/conformance` gains two subpath entries, `./vitest` and
`./reporter`, so a package can contribute an external assertion without pulling
the registry into its own typecheck, and `validateAssertionId` now accepts a
capability claim id spelled the way the capability interface spells it.
