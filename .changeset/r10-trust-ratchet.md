---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/benchmark": patch
"@olympus-ai/readiness": patch
"@olympus-ai/conformance": minor
---

R10, the trust ratchet. Within a run, capability only narrows. Policy classifies sensitive paths by class (`sensitivePaths`), grants a role the classes it may read (`sensitiveGrants`, none by default), and declares per role a `narrowed` scope of tools, egress, and level ceiling, each refused at validation when wider than the role's own. The trigger policy names, per kind, a trust below which an admitted run is narrowed (`narrowBelow`). A run is narrowed at admission when its author is below that trust or a seated role holds a sensitive grant; one seating a role with no narrowed scope, or asking a level above a narrowed ceiling, is refused. Later input sources call `narrowRun`, which records `capability-narrowed`, commits `RunState.narrowed`, and only then releases the input into a request whose sandbox was built from the narrowed scope. The narrowing is never cleared, and every later exit reads its approval at the narrowed level. A sensitive path is left out of every tree a model is handed unless its role is granted the class in a run narrowed at admission; verification still sees the full tree, and a write to a sensitive path is refused. A policy with none of the new keys admits exactly as before.
