---
"@olympus-ai/core": minor
"@olympus-ai/vault": patch
"@olympus-ai/conformance": minor
---

A-S1-03: `RunState`, `TaskResult`, and `AgentClaim` are read-only records,
arrays included. A consumer holding one cannot rewrite a task's status, move
the run to another station, append a reference, or edit the model's claim; a
new state is a new record committed through the Vault. The stub vault and
stub driver keep handing out copies, since `readonly` is erased at run time.
Conformance gains `I2.records-are-readonly`, a compile-error fixture over
every mutation the modifiers refuse.
