# External review of R18, gemini, 2026-10-21

An adversarial review of R18, the stack recorded per run: the detected stack
written into the admission record, both Vaults' refusal of a record that names
none, `readRunRecords` and `recordedStack` reading it back, the per-stack rates,
and the conformance assertion `I2.admission-records-the-detected-stack`; with
the park-cause amendment (A-R4-05), the README update, and the #56 sandbox test
fix in the same range. One of two reviews run from the same prompt and bundle;
the other is `2026-10-21-R18-stack-per-run-review-codex.md`. Both are triaged
in `2026-10-21-R18-stack-per-run-triage.md`. This review raised no findings; it
assesses four mechanisms under the prompt's item numbers, cited in the triage
as `gemini-1`, `gemini-2`, `gemini-3`, and `gemini-7`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`generativelanguage/v1beta`), offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration. 243.2 s. Ingestion
  `complete`: 45,235 prompt tokens against a floor of 30,831. Integrity
  `verified`. Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `51278b7aef29cae41c7a80ea057d5504d5286d4224d61e6f7d3659ce457fcdab`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `a5c4b7a`.
- **Cross-family agreement:** gemini-1 describes the same mechanism as
  codex-2, a stop between `recordAdmission` and `commitRunState`, and assesses
  it sound where codex calls it a defect. gemini-7 and codex-7 both address the
  framing and disagree. gemini-2 and gemini-3 agree with codex's assessment of
  the Vault checks and the park amendment.
- **Date:** 2026-10-21
- **Bundle:** `2026-10-21-R18-stack-per-run-review-bundle.txt`, SHA-256
  `bae66f76ef94fb1e048d9c572a0ff9ac258fda009660a9e6a10364e415b0e9c0`, base
  `7f3fe7a` (`reviewed/R4`), head `f41f5a5` (R18's implementation commit on
  `unit/r18`). It held the range's three commits: the R18 change, the
  park-cause amendment (#57), and the README update (#52), with every new file
  whole and every modified file as a diff showing each changed function whole.
  Prompt: `2026-10-21-R18-stack-per-run-review-prompt.txt`.
- **Prior context and lookups:** the reviewer disclosed nothing about prior
  context or lookups, although the prompt asked it to.
- **Coverage, and any gap:** items 1, 2, 3, and 7 answered, each as an
  assessment that the mechanism is sound (7 as a framing objection). Items 4,
  5, and 6 have no section of their own; item 2's section touches item 4's
  escape hatches for the Vault checks only. No defect was reported under any
  item; that is recorded here as silence on 4, 5, and 6, not as their
  clearance.
- **Citations:** the reply cites functions, not line numbers; the triage
  located each construct in the repository before relying on it.

---

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