---
"@olympus-ai/vault": minor
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/conformance": minor
"olympus-ai": patch
---

I1a: the real line. `packages/api` gains `buildGraph`, the one place a
component graph is built, and `startRun` and `resumeRun` take only a graph it
built. Provenance is read once, at build time, and is positive: a component is
safe only when it is a `LocalVault`, `LocalDockerProvider`, or
`ClaudeCodeDriver`, so a wrapper that drops a stub's declaration is refused
above L1 rather than passing as safe. `SKELETON_LINE` is deleted. `composeHost`
builds the production graph, and the `factory-host` executable serves the API
over it, configured from its environment.

The line provisions each sandbox from the host's profile (image and limits) and
each driver task with the driver's relay under the budget policy grants its
role. Contract changes: `UsageRecord.model`, set from the runtime's resolution
of the scope's tier (A-I1a-01); `Driver.relayRequest()`, contract 1.1.0
(A-I1a-02); a `lost` usage reading, written when a sandbox that ran a call
cannot be read (A-I1a-04); `Vault.readUsage` (A-I1a-05); a `meter-lost` resume
refusal, recorded as a decision (A-I1a-06); and `escalations` on the
`approval-required` refusal and the `awaiting-approval` standing (A-I1a-07).
Cost totals say whether they are exact or a lower bound (A-I1a-03). A run over a
repository with no test framework reaches the `integrate` approval with that
named among its escalations. The Claude Code driver gives the CLI a home under
`/tmp`, so it runs as whatever uid the line gives its sandbox.
