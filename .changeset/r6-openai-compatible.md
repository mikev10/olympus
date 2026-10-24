---
"@olympus-ai/sandbox": minor
"@olympus-ai/driver-claude-code": patch
"@olympus-ai/driver-openai-compatible": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

R6: a driver for any OpenAI-compatible endpoint (D-R6-01 to D-R6-07,
A-R6-01 to A-R6-04).

- driver-openai-compatible (new): `OpenAICompatibleDriver` runs the agent loop
  on the host and every model call and tool call inside the sandbox through
  `provider.exec`. The operator's configuration — origin, path, header,
  scheme, provider, family, version, a model per tier, prices, the output
  ceiling, parallelism, and the turn bound — is required in full and checked
  by `checkConfig`. Tools are `Bash`, `Edit`, `Read`, `Write`. A response
  naming another model, or none, or reporting no usage, refuses the task.
  Every feature capability is false; `parallelism` is configured.
- sandbox: `RelaySpec.scheme` (`'raw' | 'bearer'`) is required, and the relay
  reads a second meter dialect, `'openai-chat'`.
- driver-claude-code: its relay declares `scheme: 'raw'`.
- api: `buildGraph` attests an `OpenAICompatibleDriver` in every driver seat.
  `factory-host` reads `FACTORY_ENDPOINT_CONFIG` and `FACTORY_ENDPOINT_KEY`
  to seat it; `parseEndpointFile` and `seatedDrivers` are new.
- conformance: a second assertion under each `driver.*` claim, four external
  invariant assertions in the new package, and the relay's budget and
  fail-closed assertions under `openai-chat`. A claim assertion id may carry
  an implementation suffix, `driver.<key>.<name>`.
