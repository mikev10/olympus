BASE: reviewed/P13
HEAD: b23beab
pnpm-lock.yaml
4a0518bad955b2db97647dd418145aab

I had no prior project context and performed no external lookups. I reviewed the complete inline bundle. Local command execution was blocked, so I did not run tests or independently verify the supplied SHA-256. Citations refer to source files within the bundle.

1. **`packages/api/src/cost.ts:143` — factually wrong — medium — rounding can make the approved “worst case” smaller than the calculated ceiling.**

   Each task’s allowance is rounded to the nearest microdollar before summation. Nearest rounding is not an upper bound. For example, nine calls at a ceiling of `$1.00000004` give `$9.00000036`, but the task contributes `$9` to the approved figure. Multiple tasks accumulate the shortfall.

   The supplied cost tests use amounts whose products round exactly; their success does not establish conservative rounding. The exhaustion test checks invocation counts using stub components, not actual dollar expenditure.

   **Resolution:** use conservative fixed-point arithmetic, rounding allowances upward, and test fractional boundaries. Confirm the policy validator’s permitted precision: its implementation is absent, so HTTP reachability of this particular fractional example is conditional on that validator.

   Separately, the advertised strict spending guarantee remains **unclear**: the interface expressly allows one-response overshoot, but the relay implementation needed to quantify or verify it is absent. A strict approved maximum requires reserving each response’s maximum possible charge before dispatch, or including a defensible overshoot allowance in the approved figure. Counting starts alone does not prove that guarantee.

2. **`packages/api/src/http/server.ts:183` — factually wrong — medium — a driver-induced stop is reported as open, and can subsequently be relabelled cancelled.**

   Construction:

   - Return a build result with the correct task ID but an extra forbidden `status` field.
   - `build` records usage, then `taskResultProblems` causes an exception before the result/status commit.
   - The server records the exception only in `entry.lastOutcome`. Committed task state remains `running`.
   - `runStanding` sees a schedulable build task and reports `open`.
   - Once the drive settles, `/cancel` accepts this state and commits a cancellation, although the drive already stopped because of the invalid result.

   Restarting the server also loses `lastOutcome`, leaving no durable explanation for the stop. This does not prove an HTTP route to resume that build task; it does prove incorrect stopped-state reporting and the misleading cancellation result.

   **Resolution:** persist a drive failure/refusal state and derive standing and cancellation eligibility from it. Add a malformed-result test followed by status, restart, and cancellation. **High confidence.**

3. **`packages/api/src/http/server.ts:202` — factually wrong — medium — an already finished run’s standing depends on subsequently edited workspace files.**

   `view` delegates to `runStanding`, which calls `reloadExecuted` before recognizing the spent final approval.

   Complete a run, then change or remove its original `graph.json` or verification manifest. The committed completion and approvals remain unchanged, but status becomes `stopped / lock-tamper`. Restore the original bytes and it becomes `passed` again. Similarly, changing those files after cancellation masks the cancellation refusal with a tamper refusal.

   These are attacker-controlled workspace changes, requiring neither Vault modification nor model-written status. The lifecycle tests never mutate artifacts after completion.

   **Resolution:** persist and prioritize terminal lifecycle outcomes. Report later workspace-integrity observations separately from historical run completion or cancellation. **High confidence.**

4. **`packages/conformance/src/registry/policy-file.ts:59` — factually wrong — medium — the limit assertions permit weakened defaults and do not prove the file-loading path enforces them.**

   Concrete changes that evade the named assertion:

   - Raise `maxBytes` from `65536` to `65537`. The oversized fixture contains a 65536-space comment **plus the entire policy**, so it remains over the new limit and the assertion passes.
   - Raise `maxDepth` from `32` to `33`. The fixture adds 33 nested arrays inside an existing root map and array, so it still exceeds the weakened limit.
   - Change `loadPolicyFile` to supply relaxed byte/depth limits. This assertion calls `parsePolicyYaml` directly, never `loadPolicyFile`. The supplied HTTP policy test exercises aliases only.

   The relaxed-depth helper at line 35 also accepts every refusal except `too-deep`. Thus `invalid-policy`, `not-yaml`, or even an inappropriate `unreadable` result satisfies that half. This contradicts the assertion title’s claim that the document is “admitted” when the setting is relaxed. A thrown exception would fail; it is the returned alternate error that passes.

   **Resolution:** assert default ceilings directly, test exact boundary and boundary-plus-one inputs, exercise disk loading, and explicitly distinguish successful policy admission from successful depth checking followed by schema rejection. **High confidence.**

5. **`packages/conformance/src/kit/scan.ts:284` — factually wrong — medium — terminal detection follows selected type names, not value provenance.**

   This ordinary structural assignment defeats both the binding scan and the spelling scan:

   ```ts
   const p: Pick<NodeJS.Process, 'stdout'> = process;
   p.stdout.write('terminal output');
   ```

   The receiver is not named `Process`; the property chain starts with `p`, not `process`. No `any` or unsafe assertion is necessary.

   An equivalent escape uses type erasure:

   ```ts
   const p = process as unknown as {
     stdout: { write(text: string): unknown };
   };
   p.stdout.write('terminal output');
   ```

   Writing to discarded stdout would also survive the headless execution test. Its environment demonstrates operation without a TTY, but does not prohibit accessing process streams.

   These are conformance-regression escapes, **not remote HTTP exploits**: your adversary cannot edit runtime code. Declaration merging, module augmentation, and dishonest predicates likewise require code changes outside that adversary’s authority; I found no reason to invent remote exploits from them.

   **Resolution:** add structural-type and computed-access fixtures, track forbidden values through assignments, or narrow the assertion’s claim to the syntactic forms actually enforced. **High confidence.**

6. **`packages/conformance/src/registry/headless.ts:93` — factually wrong — medium — observed CLI output does not prove “nothing started” or “HTTP only.”**

   The first create check requires an exit code and a cost message. It never inspects admissions, driver calls, or side effects from that refused request. A regression that starts a run and then returns the expected cost refusal can satisfy this check.

   Likewise, separate processes do not prove that the CLI uses no in-process runtime entry points. A CLI that retains the expected HTTP operations while additionally invoking runtime code can pass the entire sequence. The current CLI’s type-only imports are good source evidence; this assertion does not enforce that architectural boundary.

   **Resolution:** observe admission/driver side effects for refused creates, and enforce the CLI’s runtime dependency boundary independently. Add mutation tests that deliberately introduce each forbidden behavior. **High confidence.**

The mechanisms I assess as sound within the stated trust boundary are:

- **Authentication and attribution:** `server.ts` authenticates before routing or body processing. Approval bodies admit only `key`; approval and cancellation principals come from host configuration. I found no request construction that substitutes another principal.
- **Exact admission comparison:** above L0, `admitRun` compares the supplied number directly with its computed figure before admission writes. This proves numerical agreement, subject to the figure’s correctness.
- **Committed cancellation:** `nextStep` refuses cancellation before scheduling work; subsequent line commits preserve it. I found no supported HTTP operation that clears a committed cancellation.
- **Several fail-closed checks:** missing policy files return refusal, policy parsing errors prevent admission, and the parser-pin assertion throws on missing manifests or version mismatch. The alias and byte tests include positive controls and are not tautologies.
- **Event handling:** the shown HTTP and CLI paths serialize or display event data; they do not feed it into model prompts.

I found no wholly tautological assertion in the supplied checks. The weaknesses above concern incomplete observations, alternate-error acceptance, and insufficient boundary cases.

The adversarial framing is appropriate for requests, files, timing, and driver results. Two distinctions matter: possession of the local token is the service’s definition of an authenticated principal, so automatically echoing the cost figure is indistinguishable from human approval; and source-scan escapes assess regression resistance, not remote authorization. The sharper questions are whether each authenticated action is durably bound to its run and whether every advertised guarantee has a test that fails when its enforcing mechanism is removed.