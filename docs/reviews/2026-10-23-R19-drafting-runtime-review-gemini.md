BASE: cd1b536
HEAD: e772ef9
packages/vault/test/stub.test.ts
57cf27767a57bba46a56d0dce7972dc3

I had no prior context and performed no lookups.

### 1. High - Black-box test drafter can leak repository contents via behavioral check exit codes
**file:packages/api/src/drafting.ts:340**  
**file:packages/core/src/station/machine.ts:406**  
**type:** bypass  
**severity:** high  

**The concrete bypass:**  
Invariant I3 requires the test drafter to be strictly black-box, seeing only the locked spec and nothing of the base repository. However, the runtime permits the test drafter to supply `behavioral` checks inside its drafted `acceptance.json` (via `readTestDraft`). A `behavioral` check specifies an arbitrary `command` (e.g., `["node", "test/leak.js"]`) that `baseRunDraft` executes inside a sandbox over a full copy of the base repository. 

The test drafter can exploit this by writing a Node script that reads repository files (e.g., `fs.readFileSync('../../src/secret.js')`) and exits with a code corresponding to the data it read (0-255). By declaring `onBase: "passes"` on this check, any non-zero exit code produced by the script is treated as a mismatch. `judgeBase` will explicitly preserve this code:
```typescript
  const parts = mismatched.filter((m) => !admitted.has(m.checkId)).map((m): BaseRefusalPart =>
    m.cause === 'contrary' && m.exitCode !== null
      ? { checkId: m.checkId, declared: m.declared, exitCode: m.exitCode }
      ...
```
`retrySuffix` in `machine.ts` then formats this exact exit code into the variable suffix for the drafter's next attempt (`exit ${String(c.exitCode)}`). This creates a direct data exfiltration channel, allowing the test drafter to map out and read arbitrary repository contents using its three iteration attempts.

**What would resolve it:**  
Either prohibit the test drafter from defining `behavioral` checks (restricting it to `acceptance` checks that invoke the pre-defined `testCommand` framework, preventing arbitrary command execution), or censor the exact `exitCode` from the `BaseRefusalPart` sent back to the drafter, revealing only whether the check matched its declaration or not.

---

### 6. Sound Mechanisms
- **Drafting Sandboxes and Separation (I3, I6):** The implementation of workspace preparation effectively limits test drafter and critic visibility. `copyOnly` is rigorously used so that the `start` directory exclusively contains spec artifacts, preventing the test drafter from interacting with or reading the codebase directly, while `spec` gets a full copy. 
- **The Draft Lock Flow:** Writing files to `ctx.run.repo` and `base` before locking is sound and fail-closed. If a crash or manual stop occurs before `vault.lock` executes, the runtime encounters `recordTamper` on resume because `fileAt` detects a mismatch against the unrecorded lock state, halting the tampered state appropriately.
- **Auto Approval Limitations:** The drafted floor implementation (`effectiveApproval`) correctly restricts `auto` approval. At L3, the boolean logic guarantees the exit floor always escalates to `human-required`.
- **Drafter and Builder Independence:** The runtime's extraction of `builderModels(ctx)` appropriately maps across every tier an escalation could reach, and `seatTestDrafter` correctly computes the weakest grade against all builder models, securing the builder/tester separation property at L3.