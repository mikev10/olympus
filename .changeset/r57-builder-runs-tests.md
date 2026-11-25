---
"@olympus-ai/adapters": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A build runs the locked acceptance tests in its own sandbox (R57, #220). The tree the builder is handed now holds the runtime's install of its lockfile, so the builder can run the tests offline. `verify` still judges over an install of its own. A write under Vite's cache, `node_modules/.vite` (`TOOL_CACHES`, `isToolCache`), is no longer recorded as a dependency-tree write. Every other write there still is. init's builder is granted `Bash`, and its role tells it to run the tests before it finishes. Three conformance entries hold these changes.
