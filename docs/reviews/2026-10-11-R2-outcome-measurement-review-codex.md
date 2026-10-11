BASE: 9021655  
HEAD: 0a7141d  
packages/vault/src/types.ts  
b0d7a206a149780a0c867e965fe0d68d

I have no prior project context. I performed no external lookups. This review uses the complete inline bundle; filesystem access was blocked, so I did not verify the file hash or execute tests.

1. **packages/api/src/outcomes.ts:147 — factually wrong — high — Any state-read failure silently removes a run’s evidence and spend.**  
   The catch treats every exception as missing state and returns empty tasks, empty usage, and `cost: null`. Stop during a state write so the newest state cannot be decoded: existing failed attempts and usage records disappear from the measurements. The run becomes unfinished, or refused if an earlier admission-refusal decision exists. Alongside another merged run, its omitted spend does not even make cost a lower bound (`outcomes.ts:342–343`).

   **Resolve:** distinguish an explicitly absent state from unreadable or invalid state. Propagate unexpected failures or publish an explicit incomplete measurement. Do not discard independently stored usage when state cannot be read. High confidence in the fail-open branch; the exact interrupted-write behavior depends on the unshown `createExclusive` implementation.

2. **packages/api/src/outcomes.ts:277 — factually wrong — high — A merge and its approval count can come from different state snapshots.**  
   `readRunRecords` reads state before reading integration records. Pause that reader after it captures an unspent integrate grant; let the drive merge and record the integration; then continue the reader. It sees `ending: 'merged'` but zero spent approvals. The autonomy predicate counts this human-approved merge as autonomous. A stop between integration persistence and the final state commit can leave the same inconsistency persistent.

   **Resolve:** read a consistent snapshot, retry when the state version changes, and reconcile a merge with its recorded approval grant before declaring autonomy. Add a test that interleaves these reads and writes. High confidence in the inconsistent-read construction; the persistent crash window should be checked against the unshown line writer.

3. **packages/api/src/outcomes.ts:300 — factually wrong — medium — Rolled yield publishes a value when an entire station has no sample.**  
   Stop runs after successful build attempts, before any review attempt. `fpStation` contains only build, so rolled yield becomes 1. The missing review station never appears as `no-sample`: `Tally` only creates populated cells. Consequently, the check for a `no-sample` member cannot detect absent stations.

   **Resolve:** establish the required station population independently of observed attempts and return null when any required station lacks observations. Test a build-only population.

4. **packages/api/src/outcomes.ts:311 — factually wrong — medium — Unfinished reviews dilute a run-level failure rate.**  
   `reviewExitRefused` iterates over all runs, despite the stated exclusion of unfinished runs from run-level rates. Start reviewers and stop before their exit decisions. Their usage records increase `seated` without increasing `returned`. One refused review plus 99 unfinished reviews becomes 1/100 instead of 1/1, with a substantially lower upper bound.

   **Resolve:** exclude unfinished runs from this rate and report their outstanding reviews separately. Test interrupted reviews explicitly. High confidence.

5. **packages/api/src/outcomes.ts:405 — factually wrong — medium — The likely-cost sample includes partially completed tasks.**  
   Eligibility requires only that currently recorded calls are metered. It never checks task completion. Stop five tasks after one cheap, metered failed attempt, before their further iterations. They satisfy the five-task threshold, and their partial spend becomes the median “past task” cost—even though no complete task cost was observed.

   **Resolve:** define eligible completed task histories and exclude ongoing tasks from the estimate. Report censored histories separately if useful. Add a test with five unfinished, fully metered task prefixes. High confidence.

6. **packages/conformance/src/registry/readiness.ts:479 — unclear — medium — The negative fixtures accept an inconclusive probe as proof that its check was exercised.**  
   The final condition rejects `supported` and missing results, but accepts any `indeterminate` result. For example, a secret-scanner startup failure reported as indeterminate satisfies the secret fixture, whose `rests` list is empty. The readiness result itself remains conservative, but conformance can pass without demonstrating secret detection.

   **Resolve:** assert the expected negative result and evidence identifying the intended failure, distinguishing it from infrastructure failure or a prerequisite short-circuit. Run mutations that remove each underlying check. Confidence is high about the assertion’s acceptance condition; the scanner’s unshown exception mapping determines which concrete failures reach it.

The following mechanisms look sound within the stated trust boundary:

- **Bounds:** `packages/api/src/bounds.ts:44` validates integer counts, returns `no-sample` for an empty denominator, and uses the appropriate upper bound or complementary lower bound. This does not protect against incorrectly constructed samples.
- **Merge time:** `packages/api/src/integrate.ts:228` obtains the timestamp from GitHub in both merge and already-merged paths. The integration assertions exercise both paths against a fixed remote timestamp.
- **Population discovery:** the new local and stub `listRuns()` implementations include admission-refused runs. Callers do not supply run IDs to `outcomes()`.
- **Record-based measurement:** outcomes does not inspect workspace contents. The standing-source addition also distinguishes live workspace checks from recorded standing.

I found no wholly tautological new test. The CLI’s comparison against `outcomes(vault)` proves transport consistency, not arithmetic correctness; separate tests supply independent expected values. The rolled-yield absence check is ineffective for missing cells, as described above.

Type assertions and generic JSON casts provide no runtime validation, but under this threat model they are not independently exploitable merely because an attacker can write TypeScript in the target repository. Declaration merging, augmentation, or `as unknown as` there does not grant execution inside the trusted runtime. The consequential boundary failure shown here is swallowing a record-read error.

The adversarial framing is appropriate, especially for stop/resume behavior. It should also ask whether the confidence bounds have a defensible statistical population: correlated attempts and caller-selected admission windows do not automatically support a general 95% safety claim. The implementation can compute a Clopper–Pearson number correctly while the sampling assumptions needed to interpret it remain unestablished.