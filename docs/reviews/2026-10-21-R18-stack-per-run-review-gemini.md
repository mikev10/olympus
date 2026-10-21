BASE: 7f3fe7a
HEAD: f41f5a5
packages/vault/test/local.test.ts
8448ff2398d6e24e88c556aa5f6d84a6

I assess the mechanisms in this bundle as **sound**. The tight boundaries of the Vault, the strict primitive type validation at writes, the fallback to `null` for legacy records, and the defensive handling of process stops and the `parkedFor` cause all successfully uphold the invariants against the scoped adversarial capabilities. 

### 1. Process stops between admission's writes
**Finding**: A process stop between `vault.recordAdmission` and `vault.commitRunState` cleanly fails closed.
**Why it is sound**: If the process crashes after writing the admission record to the Vault but before committing the first run state, the run has an admission record on disk but no run state. 
- A subsequent attempt to admit the same `runId` will fail because the Vault's `createExclusive` throws an error when `admission.json` already exists (or `this.admitted.has` trips in the stub).
- A subsequent attempt to resume it will fail because `hasState` returns `false`.
- When `readRunRecords` scans the Vault, it catches `isNoRunState(error)` and returns a run with `ending: 'unfinished'` and `stack: null`. Because the run is `unfinished`, it is excluded from the `finished` array in `deriveOutcomes` and drops entirely out of the throughput rates. Because it has no state, it has no tasks, completely dropping out of the safety samples. The run is effectively burned and cannot dilute or pollute any stack's rates.

### 2. Vault refusal and readers
**Finding**: The Vault stores and the reader correctly validate the `stack` property, avoiding any incorrect guesses.
**Why it is sound**:
- `StubVault` and `LocalVault` enforce that `a.stack` is strictly a `string` and `!== ''`. There are no language escape hatches here: an array (`typeof [] === 'object'`), `undefined`, or a `String` wrapper object (`typeof new String("x") === 'object'`) will explicitly fail the `typeof === 'string'` check and throw.
- In `outcomes.ts`, `recordedStack` safely casts `admission as Partial<AdmissionRecord>` to access the stack property defensively, checking `typeof stack === 'string' && stack !== ''`. If it finds `undefined` (a legacy run admitted before R18), it returns `null`, mapping correctly to `unrecorded` without guessing.

### 3. The parked task amendment
**Finding**: The recording and reading of the `parkedFor` cause recovers perfectly from process stops.
**Why it is sound**: 
- If a process stops between `recordDecision` and `commit` during a park, the decision is logged to the Vault but the task remains in its prior state (`running` or `pending`). On resume, the task is re-evaluated, recreating the exact conditions that led to the park (e.g., `spent.starts` still evaluates to `maxStarts`, incrementing to `maxStarts + 1` and triggering the bound again). It simply records a duplicate decision and successfully commits the park.
- In `parkRefusal`, the fallback `cause = recorded === undefined || recorded === 'conflicts-exhausted' ? derived : recorded;` serves as a failsafe. If `recorded === 'conflicts-exhausted'`, the code evaluates `byConflicts` to `true` and returns early as long as `last !== undefined`. Because a task parked for conflicts was given a `StateChange` with the new conflict pushed into its array, `last` is structurally guaranteed to never be `undefined`.

### 7. Framing of the adversarial question
**Finding**: The adversarial framing is the wrong question for this specific boundary.
**Why**: The adversary's capabilities in this unit are restricted to controlling the repository's contents and when the process stops. Because tampering with the adapter set detection (P8) is explicitly out of scope, the adversary has no pathway to inject a spoofed stack string. The components that write, store, and read the stack (the runtime API, the Vault, the outcomes parser) are fully trusted and execute isolated from the workspace. Without the ability to manipulate the adapter set or inject writes to the Vault, the adversary has no leverage to force a run into a different stack's sample. A more effective adversarial question for this domain would focus on whether an agent's workspace writes could escape the sandbox to manipulate the Vault's persisted records directly, or whether the adapter set itself could be tricked by a polyglot repository structure (the latter of which is P8's responsibility).