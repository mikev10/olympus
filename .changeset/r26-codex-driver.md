---
"@olympus-ai/driver-codex": minor
"@olympus-ai/conformance": minor
---

A second vendor harness: `@olympus-ai/driver-codex` runs the Codex CLI (0.166.0) inside the Olympus sandbox, through the relay's Responses meter, with the family `openai` stated rather than derived (R26). Before every task it reads the request the session would send from an endpoint on the sandbox's loopback, and refuses a session whose tools differ from the grant, whose model differs from the one resolved, or whose credential is not the placeholder. Every workspace instruction source is off. The registry names its invariant, claim, and workspace-instruction assertions, and CI runs its paid suite under `run-driver` with `OPENAI_API_KEY`.
