# External review of R39, gemini, 2026-11-21

The R39 change (tests and checks that could pass by accident, and labels on the local Docker provider's objects) as one bundle, reviewed by the Gemini family. Triage: `2026-11-21-R39-tests-cannot-pass-by-accident-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1 (codex-1), gemini-2 (codex-2), and gemini-4 (codex-6) were raised by both families. gemini-3 and gemini-5 were raised by Gemini alone.
- **Date:** 2026-11-21
- **Bundle:** `2026-11-21-R39-tests-cannot-pass-by-accident-review-bundle.txt`, SHA-256 `82809a1161cc0c2188a1c8b7e49a861f6ad31eb634590bd12181e3596504533a`, base `10d2236` (`reviewed/R52`), head `f7a33c4` (the unit tip before the review files). It held 18 files: new files in full, modified files as function-context diffs. `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-21-R39-tests-cannot-pass-by-accident-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context and performed no external lookups. That is a self-report and cannot be checked from here.
- **Coverage, and any gap:** items 1, 3, 4 (the Proxy), 6, and 7 were answered. Item 2 (tautological checks) and item 5 (configuration satisfied without effect) came back empty.
- **Citations:** line numbers refer to positions in the bundle's new-side diffs, not the repository. They are hints, located by construct in the triage.

---

BASE: 10d2236
HEAD: f7a33c4
packages/sandbox/test/upstream.ts
903f0421e16246c1f86b5d565fa5a963

I had no prior context about this project, and I performed no external lookups.

### Findings

**1. `ownerIsGone` incorrectly evaluates run state across distributed/containerized environments**
packages/sandbox/test/relay.test.ts:241 — factually wrong — High
**The concrete bypass:** The teardown sweep uses `hostname()` and `process.kill(id, 0)` to decide if an owner run is dead. This fails in two common testing scenarios. 
- **Leaves dead objects in place:** If test suites run in isolated CI containers sharing the host's Docker socket, their `hostname()`s will differ. `host !== hostname()` will evaluate to `true`, causing `ownerIsGone` to return `false` and ignoring each other's leaked objects.
- **Removes objects a live run still owns:** If two developers (or remote CI runners) connect to the same remote Docker daemon and happen to share a generic hostname (like `ubuntu` or `runner`), they will pass the `host === hostname()` check. One test runner will query `process.kill(id, 0)` for the other runner's PID. Because the PID doesn't exist on their local machine, it throws `ESRCH`, making `ownerIsGone` return `true` and causing them to destroy the other's live containers and networks mid-run.
**What would resolve it:** Do not rely on `hostname()` and PIDs. Instead, inject a globally unique, randomly generated machine/session UUID per test suite execution and filter sweeps by that UUID.

**2. `vaultSurfaceProblems` completely skips checking static backdoors on the constructor**
packages/conformance/src/registry/vault-surface.ts:13 — factually wrong — High
**The concrete bypass:** The check explicitly iterates past the class constructor via `if (key === 'constructor') continue;` and never recursively inspects the constructor function object itself. An adversary controlling the product code can add a static write method (e.g., `LocalVault.genericWrite = () => { ... }`). At runtime, an agent with access to the Vault instance can simply call `vault.constructor.genericWrite(...)` to bypass the restrictions and mutate the store. The test completely ignores this write path and passes.
**What would resolve it:** Remove the `continue` and explicitly verify that `instance.constructor` exposes no unsafe properties or methods. Alternatively, mandate that `LocalVault` instances have a `null` prototype or freeze the constructor object.

**3. `vaultSurfaceProblems` is blind to Proxies with dynamic traps**
packages/conformance/src/registry/vault-surface.ts:9 — factually wrong — High
**The concrete bypass:** The function relies entirely on reflection over keys (`Reflect.ownKeys` and prototype walking) rather than probing behavior. A malicious `LocalVault` constructor can return a `Proxy`. The proxy's `ownKeys` trap can return an empty array, and its `getPrototypeOf` trap can return a perfectly clean prototype that holds exactly the 35 named operations. The check will pass. However, the Proxy's `get` trap can dynamically return mutating functions (e.g., `deleteEverything`) for arbitrary keys at runtime, giving agents full write access without the test ever noticing.
**What would resolve it:** Reject Proxy instances using `require('node:util/types').isProxy(instance)`, or enforce that the vault behaves safely even after applying `Object.seal()` and `Object.freeze()` to the instance and its prototype.

**4. `allText` skips symlinks, allowing the merge token to be hidden in the sandbox**
packages/conformance/src/registry/all-text.ts:14 — factually wrong — High
**The concrete bypass:** `allText` filters entries with `if (entry.isFile())`. Node.js's `withFileTypes` marks symlinks as `isSymbolicLink()`, making `isFile()` evaluate to `false`. An agent or adversarial product code can write the merge token into the target path of a symlink, or create a symlink in the workspace that points to a hidden file containing the token. `allText` will skip the symlink entirely. The negative check ("the store does not hold the token") will pass because the text reader didn't find it, even though the token successfully breached the sandbox boundaries.
**What would resolve it:** Change the filter to `if (entry.isFile() || entry.isSymbolicLink())`. For symlinks, resolve their contents or read their link targets using `readlink` to ensure the token isn't hidden within them.

**5. `treeSnapshot` resolves symlinks, blinding it to structural mutations**
packages/readiness/test/repo.ts:117 — factually wrong — Medium
**The concrete bypass:** `treeSnapshot` uses `readFile(path)` on files. `readFile` transparently resolves symlinks and reads the target file's content. If a readiness scan maliciously or accidentally replaces a tracked symlink with a regular file containing the exact same string (the symlink's target path), `treeSnapshot` hashes the exact same bytes for both. The "scan changed nothing" assertion will report a pass, completely missing that the repository's git tree was structurally altered.
**What would resolve it:** Use `lstat` instead of `stat`/`readFile`. If an entry is a symlink, hash the string returned by `readlink` and prefix it with a type marker (e.g., `symlink\0`), rather than following the link and reading the target file's contents.

### Assessment of Mechanisms and Framing

The framing of the adversarial threat model is correct and essential for these checks. You explicitly asked if I assess any mechanisms as sound:

- **The Line Test Early Return fix (`first`)**: Sound. It properly throws if the required element is absent, converting a fail-open edge case into a fail-closed throw.
- **The Git Helper pipe fix (`written !== undefined`)**: Sound. Because Node.js processes stream events (`error` / `EPIPE` on stdin) before firing the child process `close` event (which triggers `execFile`'s callback), any failure by git to consume the written buffer sets the error state before the check happens. This successfully fails closed on broken pipes.
- **The LocalDockerProvider Label Validator (`labelArgs`)**: Sound. It correctly blocks Docker reserved prefixes and control characters. Because arguments are supplied in an array structure (`['--label', 'key=value']`) to `execFile`, there is no shell string injection bypass possible.