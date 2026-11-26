# Triage of R58's external reviews, 2026-11-25

Both families counted on their first run, so nothing was rerun. Codex (gpt-6-astra) raised 4 findings, the first with two constructions, counted here as 5. All 5 describe the code accurately; none is a defect R58 fixes. Gemini (gemini-3.1-pro-preview) raised 1, which describes the code accurately and is the same as Codex's first construction. Both families raised that one finding. No finding failed to hold as a description of the code. Two are rejected as the confirmed design, one is a known limit with an issue, and two belong to tooling and are filed. No code changed.

Gemini answered one of the prompt's seven items and disclosed nothing about prior context. Its silence on the other six is not an endorsement.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1a / gemini-1 | a call that returns a valid result after its relay refused it for a spent budget is not parked, and a failed gate then starts another iteration under the same bounds | codex, gemini | holds in part: the code does this; the spend is bounded and the budget is per call by design | known limit (D-R58-06), #248 |
| codex-1b | a failed call whose meter reads spent with no request refused is retried | codex | holds as a description; it is the rule D-R58-04 chose | rejected |
| codex-2 | `local-check` does not check the runner's exit status in `preflight`, and in `full` only when no paid entry is listed | codex | holds, belongs to tooling | #249 |
| codex-3 | `local-check full` does not require that any test ran | codex | holds, belongs to tooling | #249 |
| codex-4 | a refusal recorded with no state version reads `open` | codex | holds as a description; it is A-R58-01 as confirmed | rejected |

## codex-1a / gemini-1: a successful call after a spent budget is not parked

**Claim.** `runTask` returns `budgetSpent` only when the call failed. A model that exhausts its budget, has a request refused, and still ends with a valid result is not parked. If its change then fails `verify`, the next `build` iteration gets a fresh relay with the full budget. Gemini asks for the park to supersede the driver's outcome; Codex asks for the exhaustion to be persisted whatever the outcome, and leaves open whether the result may still be verified.

**Checked.** A fresh-context check of `runTask`, `spendRetry`, `build`, and `startAttempt` confirmed the code path: the condition is `!outcome.ok && meter.refused > 0 && exhausted is tokens or cost`, each `runTask` call provisions a new relay from `scope.budget`, and a result whose gate fails re-enters `build`. It also found the bound: `maxStarts` is `(maxIterations + conflicts) * (retry.max + 1)`, nine at `build`, and `startAttempt` parks past it.

**Found.** The description holds. The consequence is narrower than "continues spending after the relay reported the budget spent". The budget has always been per driver call, and the total a task can spend is the invocation bound times that budget, before and after R58. What R58 removed is the retry that repeats the same call with nothing new. An iteration after a failed gate is not that: the builder is told which checks failed, and the call that preceded it did return a result within the budget.

**Outcome.** Not changed. Gemini's fix would park a task whose result might pass its gate, discarding work the runtime could prove. The stronger option is to let the result be judged and park as `budget-spent` only if its gate then fails. That records a spent budget on an attempt that is not parked, which changes what `TaskAttempts.budgetSpent` means in the contract confirmed as A-R58-01, and it decides whether a budget is a call's or a task's, which the unit's out-of-scope line excludes ("raising or reshaping the budgets themselves"). Recorded as a known limit in D-R58-06 and filed as #248 for a maintainer decision. Both families raising it is why it is the first item in the report at the merge gate.

## codex-1b: spent with no request refused is retried

**Claim.** A call that reaches its bound and then fails before sending another request reads `exhausted: 'cost'`, `refused: 0`, and takes the ordinary retry path. The new conformance control expects this.

**Checked.** Confirmed by the same check, and by the control in `I5.spent-budget-parks-at-once`, which runs exactly this reading.

**Outcome.** Rejected. The unit parks on "a relay refusal for a spent budget". With no request refused, the relay refused nothing and the call failed for another reason, which is what a retry is for. If the retry spends the budget and is refused, it parks then. D-R58-04 records the rule and its edge.

## codex-2 and codex-3: `local-check` can pass a run that errored or ran nothing

**Claim.** `preflight` reads `ran.status` and never checks it. `full` checks a non-zero exit only when no paid entry is classed `notRunHere`, so a stale paid report excuses an unrelated runner error. `outcomesOf` keeps no report-level error. And `full` has no check that any test executed: `classify` reads only `failed`, and an empty report is accepted.

**Checked.** The fresh-context check confirmed each sentence against `preflight`, `full`, `conformance`, `outcomesOf`, and `classify` in `scripts/local-check.ts`. One part is narrower than stated: a file that failed outside any test, such as a suite that could not load, is kept as a failed outcome. An unhandled error reported outside a file is not. For codex-3, Vitest exits non-zero when it finds no tests, so an empty run would need a configuration that passes with none; that configuration was not checked.

**Outcome.** Both hold and neither is R58's. The script arrived in the bundle because it merged after R57's review (#243, D-TOOLING-13). It is maintainer tooling, changed through a tooling pull request and never on a unit branch. Filed as #249 under the #197 tracker. CI is unaffected: it runs the suites directly. R58's own acceptance run does not rest on the gap: the conformance step ran 642 seconds and listed its 27 paid entries by id.

## codex-4: an unversioned refusal reads `open`

**Claim.** A run refused before `stateVersion` existed keeps a `station-refused` decision with no version. `refusedAt` discards it and the run reads `open`. Codex reads the supplied fail-closed rule as asking for the conservative reading, and says the uncertainty should be represented or the guarantee narrowed.

**Checked.** Confirmed by `I2.refused-run-reads-refused`, which asserts this behaviour, and by reading `refusedAt`.

**Outcome.** Rejected. This is A-R58-01 as the maintainer confirmed it: a refusal with no version is never read as current, which is what `status` said for every such run before the unit. A record with no version cannot be told from one the run moved past, including every failed gate that did not end its drive, so reading it as refused would report working runs as refused. The guarantee is narrow in the way Codex asks: it covers refusals recorded from this unit on.

## What the reviews said was sound

Codex assessed as sound: the bound and limit coming from the meter and policy, `parkRefusal` throwing on a park with no bound recorded, the version comparison, state-derived standings taking precedence, and the conformance entries not being tautologies. It found no language escape hatch a model could reach. Gemini assessed nothing.

On the framing, Codex accepted it and added a recovery question: after exhaustion is observed, what durable fact prevents another attempt across an interruption. For a failed call, the park is recorded and then committed with `parkedFor` and `budgetSpent`, and the entry resumes the run and finds the same park with no driver call. A stop between the meter reading and the park's commit leaves the task `running`, and the resume replays the call, which `starts` counts. That is the replay every attempt has (A-P4-06), not something this unit adds.
