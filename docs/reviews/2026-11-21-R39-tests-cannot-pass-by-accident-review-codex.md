BASE: 10d2236
HEAD: f7a33c4
packages/sandbox/test/upstream.ts
903f0421e16246c1f86b5d565fa5a963

I had no prior project context and performed no external lookups. This is a source review of the supplied text; I did not execute tests or independently verify the SHA-256.

1. **packages/sandbox/test/relay.test.ts:246 — unclear — high — Hostname does not establish a shared PID namespace.**  
   Two runners can share a hostname and Docker daemon while occupying different PID namespaces. Run A’s owner PID can be absent in B’s namespace while A remains alive. B receives `ESRCH` and deletes A’s containers and networks. The UUID does not prevent this: `ownerIsGone` ignores it.

   Resolve with ownership and liveness coordination shared by all clients of the daemon, or explicitly enforce a single PID namespace. **Confidence:** high in the construction; deployment applicability is unknown from this bundle.

2. **packages/conformance/src/registry/vault-surface.ts:18 — factually wrong — medium — Skipping `constructor` leaves a reachable generic mutation path unchecked.**  
   Add a static `put(vault, path, bytes)` method to `LocalVault`, implemented using the instance’s private store state. The instance still has exactly the permitted prototype methods, so this check passes. Nevertheless, `(vault.constructor as typeof LocalVault).put(vault, path, bytes)` exposes the additional mutator. TypeScript `private static` would not hide it at runtime either.

   Resolve by checking the constructor’s additional exposed surface, or narrow the claimed guarantee explicitly. This is a surface-check counterexample; it does not establish that a sandboxed agent can obtain the host object.

3. **packages/sandbox/src/local/provider.ts:417 — factually wrong — medium — The provider’s labels do not reach probe containers.**  
   The new `#labels` field reaches sandbox, proxy, and relay creation. However, `probe()` still invokes `probeRunArgs(name, containerId, image)` without labels. Kill the owning process while a probe remains running: an owner-label sweep cannot discover that container. The new label test provisions sandboxes but never creates a probe, so it passes.

   Pass the validated label arguments through probe creation and inspect a running probe’s labels in the test. `--rm`, if present, only helps once the container exits.

4. **packages/sandbox/test/relay.test.ts:278 — factually wrong — medium — Cleanup erases evidence of successful-but-incomplete teardown.**  
   `afterAll` sweeps first and checks for leftovers afterward. A provider regression that reports successful destruction while leaving a stopped, disconnected sandbox container can therefore pass: the explicit lifecycle assertions check sidecars and networks, and the final sweep removes the remaining sandbox before asserting emptiness.

   Record unexpected leftovers before recovery, attempt all cleanup, and fail with the recorded objects. Recovery should still run, but successful recovery should not turn a teardown regression into a passing suite.

5. **packages/sandbox/test/relay.test.ts:247 — factually wrong — medium — PID reuse leaves a dead run’s objects indefinitely.**  
   Kill a run, then start another process that receives its PID before the next sweep. `process.kill(id, 0)` succeeds, so the old objects are retained—even though their UUID belongs to the dead run. This can also happen after a host restart with the same hostname.

   Bind ownership to a process incarnation, including start identity and boot identity where available, or use a shared ownership mechanism that distinguishes successive processes with the same PID.

6. **packages/conformance/src/registry/all-text.ts:17 — factually wrong — medium — Symlink entries are silently excluded.**  
   Put a symlink under the scanned directory pointing to a token-bearing file outside that directory. `Dirent.isFile()` is false for the link, so the reader returns text without the token. A dangling or unreadable symlink is likewise skipped without error. The ordinary-file error fix does not cover these entries.

   Reject symlinks and unsupported entry types, or resolve and read them with explicit traversal rules. For a fail-closed negative check, silently omitting them is insufficient.

The following mechanisms are sound within their stated scope:

- **line.test.ts:57:** `first` throws on an empty array or an undefined first item. Generic erasure and casts do not remove that runtime check. The remaining `if (!outcome.ok) return` shown follows a hard assertion of `true`, so it does not produce a pass.
- **all-text.ts:16–17:** Directory-listing failures and ordinary-file read failures propagate. An actually empty directory is not itself evidence of token leakage.
- **vault-surface.ts:13–32:** Own fields, symbol keys, inherited helpers, missing operations, and accessors under allowed names are detected. TypeScript visibility modifiers cannot conceal these reflected properties.
- **repo.ts:50 and repo.ts:115:** Disabling automatic Git maintenance addresses the identified background-process race. The snapshot comparison remains substantive and additionally records directories; it does not establish metadata preservation.
- **tree.test.ts:38–46:** The stdin error listener prevents an unhandled stream error, and a recorded write failure rejects the helper’s result.
- **labels.ts:23–29:** Validated values become individual argv elements, avoiding shell interpretation. The resulting argument array is frozen.
- **relay.test.ts:259–266, 291–307:** Selected removals and per-test teardown generally continue after individual failures and aggregate errors. Object-specific relay checks also avoid comparing unrelated runs’ container listings.

I found no wholly tautological changed assertion. The final post-sweep emptiness check is meaningful as a test of recovery, but insufficient as evidence that normal teardown worked.

The adversarial framing is appropriate as a mutation-review question: which realistic product regressions remain green? It should not be treated as proof against arbitrary malicious replacement of trusted components or hostile execution inside the runtime. The useful standard here is observable failures, independently checked ownership, and tests that fail before recovery hides the defect.