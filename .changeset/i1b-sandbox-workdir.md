---
"@olympus-ai/sandbox": patch
---

`LocalDockerProvider` runs every command with the workspace as its working
directory, as `SandboxProvider.exec` now requires, rather than wherever the
image left it. A check whose pinned command names a path relative to the
tree, such as `node node_modules/vitest/vitest.mjs run`, now finds it
(D-I1b-11).
