---
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

P9: the runtime as an HTTP service. `createApiServer` serves create, status, approve, cancel, and an event stream behind a local token. `admitRun` splits admission from driving. `worstCaseCost` is the exact bound a run above L0 must have approved, and `loadPolicyFile` reads `policy.yaml` with an exact parser pin, no aliases, a byte cap, and a depth limit. The conformance registry pays `I9.api-runs-headless` and `I5.policy-document-load-is-hardened`, and the I9 terminal scan resolves bindings through the checker.
