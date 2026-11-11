# External review of R34, gemini, 2026-11-11

The Gemini family's review of R34, dependencies installed by the runtime from the lockfile. The triage of this review and its Codex companion is `2026-11-11-R34-runtime-install-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools; `cleanRoom` is `null` because an API call loads no local configuration. Outcome `counted`: 73,659 input tokens against a floor of 51,815; all four bundle markers echoed.
- **Cross-family agreement:** gemini-2 (npm `link: true` entries install the runner into tree code) was raised by Codex too, as codex-1; gemini-3 (the runner presence check follows links) is a consequence of the same mechanism. gemini-1 (a symlinked `node_modules` survives the wipe) was raised by Gemini alone.
- **Date:** 2026-11-11
- **Bundle:** `2026-11-11-R34-runtime-install-review-bundle.txt`, SHA-256 `d27e7723aa62fef9f41dff7ae33645e96c973b8519513c13692ff418c022df01`, base `15fddaf` (`reviewed/R35`), head `40692f0` (the unit branch after its acceptance fixes, before review). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded. Prompt: `2026-11-11-R34-runtime-install-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context and performed no lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 (gemini-1, gemini-2), 6 (an assessment of mechanisms), and in passing 3 (failure handling judged fail-closed) were answered. Items 2, 4, 5, and 7 came back empty: the reviewer did not say whether any check is tautological, did not address language escape hatches or configuration, and did not say whether the framing was right.
- **Citations:** line numbers are positions in the bundle's new side, not the repository, and are hints.

---

BASE: 15fddaf
HEAD: 40692f0
packages/vault/test/stub.test.ts
1f655be32e866858cb9401286613061f

I have no prior context about this project from earlier conversations or memory, and I performed no external lookups during this review. 

### 1. `packages/api/src/install.ts:91` — concrete bypass — high
The `dependencyTrees` function relies on `!entry.isDirectory()` to skip files, but Node.js `Dirent.isDirectory()` returns `false` for symlinks. An agent can create a directory structure containing a symlink named `node_modules` (e.g., `sub/node_modules -> ../malicious_code`). Because it is a symlink, `dependencyTrees(tree, isTree)` skips it entirely, and it is never removed from the tree before installation. 

Since `npm ci` won't generate a `node_modules` in that subdirectory (unless explicitly configured as a workspace, which the agent can avoid), `fs.cp` never attempts to overwrite the symlink, thereby avoiding any `EEXIST` collision errors. The symlink seamlessly survives the wipe and install phase. When tests run inside `sub`, Node.js module resolution will follow the `node_modules` symlink to the agent's malicious, unverified code, executing it instead of the lockfile's verified dependencies. 
**Resolution:** Check `isTree(entry.name)` prior to the `!entry.isDirectory()` check, or explicitly handle `entry.isSymbolicLink()` to ensure all dependency trees, including symlinked ones, are removed.

### 2. `packages/adapters/src/install.ts:64` — concrete bypass — high
The `npmPackages` lockfile parser explicitly skips validation for packages with `link: true` (`if (entry.link === true || entry.inBundle === true) continue;`). This skips both the integrity hash check and the registry resolution check. An agent can modify `package-lock.json` to replace a critical dependency or the test runner (like `vitest`) with a local link (`"link": true, "resolved": "fake-runner"`). 

Because `inputFiles` copies nested `package.json`s into the install sandbox, `npm ci` will execute successfully and natively create a symlink to the agent's `fake-runner` directory. When `installInto` copies the installed `node_modules` back into the tree, the symlink will resolve to the agent's `fake-runner` directory in the active workspace. This allows the agent to execute their own code as the test runner, completely bypassing the requirement that tests run over verified, registry-fetched dependencies.
**Resolution:** Do not skip packages with `link: true`. Reject them if they replace a registry dependency, or strictly enforce that dependencies must resolve from allowed registries and carry valid integrity hashes.

### 3. `packages/api/src/verification.ts:107` — a tradeoff I would have made differently — low
The `runnerMissing` function checks for the test runner's presence using `await stat(...)` and `facts?.isFile() === true`. While `stat` follows symlinks (making it compatible with `npm` creating symlinks for `.bin` executables), if the agent successfully injects a symlink to their own executable (e.g., via the `link: true` bypass above), this check will blindly validate the malicious executable as present and allow the checks to run.
**Resolution:** Given the environment guarantees, you could use `lstat` or verify the resolved path falls within the freshly installed `node_modules` bounds to add defense-in-depth, ensuring the binary is an actual registry installation.

### Assessment of Mechanisms
Setting aside the critical symlink and `link: true` bypasses identified above, the overarching architecture of the installation mechanism is highly robust:
- **Sandbox network isolation** combined with `corepack` ensures that even if malicious configurations are attempted, dependencies cannot be sourced outside the policy-granted registries. 
- **Configuration ignoring** (passing `--ignore-scripts`, `--ignore-pnpmfile`, and willfully not copying `.npmrc` to the container) elegantly neutralizes dependency lifecycle scripts and environment manipulation.
- **Fail closed state handling** behaves properly at the macro level. If the installation procedure fails (or refuses due to an unhashed file), it fails closed. It logs the unstarted checks and escalates failure at the subsequent station gates (test-design/verify), rather than letting the run pass.