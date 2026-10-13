---
"@olympus-ai/api": patch
---

R15 fixes-review: a path under `node_modules` in any case is a dependency tree and is not carried into the tree checks run over; a suite check whose runner would also load a suite it does not name records no suite count and fails. A pending I3 entry counts the runner's own process loading code the change can reach (#42).
