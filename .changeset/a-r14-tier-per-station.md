---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/sandbox": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/conformance": minor
---

R14: a model tier per station and escalation (A-R14-01, A-R14-02). `CapabilityScope` gains `tierByStation` and `escalation`, both required; `core` resolves a call's tier with `tierFor`. Under a granted escalation the line raises a task's tier one step per `afterFailedGates` failed gates, up to the ceiling, and records each step as a `tier-escalated` decision. The reviewer is seated against every model that built the reviewed tasks. The line prices each call's relay for the model it resolved and no other, and the Claude Code driver maps tiers to exact model ids and pins every model setting the CLI reads to the call's model. `dockerCli` bounds the output it holds, 64 MiB by default, and `LocalDockerProvider` ends a sandbox whose command prints past it, refusing at the new `output` layer. Pays `I2.relay-bound-to-tier-model` and `I9.sandbox-output-is-bounded`.
