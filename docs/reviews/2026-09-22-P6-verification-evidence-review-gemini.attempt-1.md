I have reviewed the provided code based on the stated constraints and requirements. I hold no prior context about this project and performed no external lookups.

Here are the findings, ordered by severity.

### 1. Behavioral check expectations are completely ignored (Fail Open)
**File:** `packages/api/src/line.ts`  
**Line:** 673 (inside `verify`)  
**Type:** Ways the configuration can be satisfied without doing what it appears to do / fails open  
**Severity:** High  

**The concrete bypass:** 
The verification manifest allows defining checks, including behavioral scenarios that rely on specific assertions (e.g., expecting a certain `stdout` string or a specific non-zero `exitCode`). When the runtime parses the manifest in `parseManifest` (`validate.ts`), it copies all fields without pruning unknown ones, meaning a user's `expected` block survives into the `CheckSpec`. 

However, the `verify` function completely bypasses `CliBehavioralAdapter` (which contains the `compareCli` logic to validate expectations). Instead, it runs every check using a plain `sandbox.exec` and hardcodes `expectation: null` in the results:
```typescript
        results.push({
          // ...
          suiteCount: suiteCountFor(check, counted),
          expectation: null, // <-- Hardcoded to null
          // ...
        });
```
Because the `expectation` is `null`, `requiredShortfall` judges the check solely on its exit code. If a behavioral check expects a failure (`exitCode: 2`) or specific output, but the agent's code simply exits `0` while doing nothing, the gate evaluates the check as passed. The agent bypasses the behavioral requirements entirely.

**Resolution:** 
Integrate `CliBehavioralAdapter` into `verify` for checks of kind `behavioral` so that their expectations are actively evaluated, and strictly validate the `expected` block within `parseManifest` to ensure it is structurally sound before admission.

### 2. TaskResult validation is vulnerable to generic erasure / type mismatch
**File:** `packages/api/src/verification.ts`  
**Line:** 87 (inside `taskResultProblems`)  
**Type:** Escape hatches specific to the language / Missing Validation  
**Severity:** Medium  

**The concrete issue:** 
`taskResultProblems` enforces the exact key set of a `TaskResult` and its nested objects using `Reflect.ownKeys`. However, it only checks that the keys exist; it performs no runtime type checks on the corresponding values (other than checking if `events` is an array). 

Because `taskResultProblems` accepts them, a driver or agent could return an invalid inner structure—such as `{ claim: { narrative: "...", filesChanged: null } }`. This invalid payload is successfully recorded to the Vault. Later, when `verify` calls `readResult()`, it strictly checks `Array.isArray(claim.filesChanged)` and instantly throws an unhandled `Error`. Because this `verify` step runs within `runLine` with no `try/catch` wrapping it, the line worker process crashes or the run permanently rejects. Upon resume, it will pick up the task and crash again.

**Resolution:** 
Enhance `taskResultProblems` to validate the runtime types of the required fields (e.g., checking that `filesChanged` is explicitly an array of strings, `narrative` is a string) before admitting the result to the Vault, rather than shifting the structural crash to the downstream consumer.

### 3. ReadText hashes the active working copy instead of the snapshot
**File:** `packages/api/src/line.ts`  
**Line:** 370 (inside `readText`)  
**Type:** A tradeoff I would have made differently  
**Severity:** Low  

**The concrete issue:** 
When reading admitted artifacts to provide context to the agent (in `build` and `review`), `readText` reads the file directly from `ctx.run.repo` (the user's active workspace on the host) rather than reading from the isolated base tree snapshot stored inside the runtime's Vault (`basePath(workspaces, ctx.run.id)`). 

While it hashes the read bytes and intentionally fails closed (triggering a `lock-tamper` violation) if the user has modified their local copy since admission, this couples the execution phase back to the volatile host directory. If a user innocently edits their local spec file while a long-running autonomous task is building, the task instantly fails with a tamper violation.

**Resolution:** 
Read the context text from the runtime-owned `base` snapshot to fully isolate the build process from ongoing host workspace edits.

### Soundness Assessment

Beyond the behavioral check gap, the core verification mechanisms are exceptionally sound and well-reasoned:

1. **Tree Materialization:** The `ownDiff` and `composeDiff` tree implementations correctly prevent an agent from deleting `.git` (ignored by `walkTree`) or executing symlink traversal attacks. Because `verify` ensures that the diff applies identically via content hashes, malicious symlink manipulation fails closed.
2. **Lock Checks:** The `tamperedIn` verification applies defense in depth. Even if an agent bypasses case-sensitivity lock checks during the diff step, the subsequent `tamperedIn` check runs `hashAt` on the final materialized `tree`, securely catching any silent overwrites and resulting in a locked tamper failure.
3. **Sandbox Isolation:** A combination of dropping default network routes, correctly tunneling variables inside the Daemon boundary, and ignoring agent-created symlinks out of the workspace ensure total compliance to invariant I4 (Default Deny).
4. **Framing:** The adversarial framing is absolutely correct for this context. The code successfully defends against deceptive agent actions inside the `work` environment. Everything evaluates cleanly as zero-trust except where directly granted by policy.