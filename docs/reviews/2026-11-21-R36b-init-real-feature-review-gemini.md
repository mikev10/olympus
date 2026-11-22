BASE: 7931508
HEAD: 7b70ccd
packages/conformance/src/registry/init.ts
0d6af3cef33ee5b6268735e88d15ea79

I have no prior context about this project from earlier conversations and performed no lookups.

Here are the findings from the review, ordered by severity.

### 1. The scanner ignores dependency directories at any depth, allowing hidden payloads to bypass security scans
- **File:** `packages/api/src/scan.ts:84`
- **Type:** concrete bypass
- **Severity:** high
- **The concrete bypass:** The `copyScanned` function copies the workspace tree for the security scanner, filtering out dependency trees to save time. It does this by checking `isDependencyTree(basename(path))`. Because this checks the `basename` at *any* depth in the tree, any directory named `node_modules`, `__pycache__`, etc., is entirely skipped. 
An adversary or model can write a malicious payload to a nested directory—such as `src/node_modules/payload.js` or `src/__pycache__/evil.py`—and `require()` or `import` it from legitimate source files. Because the copy skips it, the security scanners never see the payload. However, standard package installers like `npm ci` or `pip` only clear the project root's dependency folder, so this nested directory survives the install, executes successfully during the acceptance checks, and is included in the builder's diff to be merged into the repository.
- **What would resolve it:** Restrict the dependency directory filter to the root of the workspace (e.g., `basename` matching only when `dirname(path) === source`), or ideally, exclusively filter the specific folders the runtime just created during its own lockfile installation.

### 2. Token limit binds before the dollar budget, contradicting policy intent
- **File:** `examples/policy.yaml:27` (and `packages/api/setup/policy.yaml:41`)
- **Type:** factually wrong / ways the configuration can be satisfied without doing what it appears to do
- **Severity:** low
- **The issue:** The comments (and the R36b changeset) assert that by giving seats `maxTokens: 1000000` and `maxCostUsd: 1`, the "dollar budget, unchanged, binds first", reasoning that "a model reading the repository spends most of its tokens there" (on cache reads). This is factually incorrect for the economics of the models used. For Claude 3.5 Sonnet, 1,000,000 cache-read tokens cost exactly $0.30. Because $0.30 is well below the $1 `maxCostUsd` ceiling, the `maxTokens` limit of 1,000,000 will exhaust and halt the run *before* the dollar budget binds, which is the exact opposite of the stated intent.
- **What would resolve it:** To make the dollar budget bind first, raise `maxTokens` to roughly `3500000` to allow the model to hit the $1 mark on cache reads, or update the comments/documentation to accurately state that the token cap is the binding limit for cache-heavy tasks.

### Assessment of Sound Mechanisms
- **Configuration loading and `mergeEnvFile`:** Assessed as sound. The strict parsing properly inherits variables from the system environment when left empty (`''`) in the file, and deliberately fails closed when colliding values are present without throwing on matching duplicates.
- **Init file writes:** Assessed as sound. Writing `.factory` files with the `wx` flag ensures that an attacker cannot plant symlinks pointing to sensitive host paths (like `~/.factory/policy.yaml`) to trick `init` into overwriting or mangling them. 
- **Start-up Missing Container User:** Assessed as sound. Although the explicit conditional statement in `config.ts` fails to trigger if only *one* of the UID/GID pair is provided, the underlying call to `containerUser` properly throws an error in that exact scenario, meaning the start-up sequence correctly fails closed and refuses to listen.