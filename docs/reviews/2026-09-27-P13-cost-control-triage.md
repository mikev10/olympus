# Triage of P13's external reviews, 2026-09-27

Two reviews, both `counted`, from one prompt and one bundle:
`2026-09-27-P13-cost-control-review-codex.md` (gpt-6-astra, family codex)
and `2026-09-27-P13-cost-control-review-gemini.md`
(gemini-3.1-pro-preview, family gemini). Before each header was prepended,
each reply's SHA-256 matched its manifest's `replySha256`, and the reply beneath
each header still hashes to that value. Both runs sent one byte-identical
payload (`2f640c54…`), and both ingested it completely and echoed every bundle
marker. Findings are cited by family and number.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 5 | 4 | 1 | 0 |
| gemini | 0 | — | — | — |

- **Both families raised:** none. Gemini reported no findings, so there was
  nothing to pair.
- **Did not hold:** 0 of 5.
- **Held in part:** codex-1. The defect is exactly as described. It damages
  the record, not the budget: the budget still refuses every later call.
- **Gemini's calibration.** Gemini's item-6 answer called the `max_tokens`
  charge for an unreadable answer a "ceiling". That charge covers output only,
  and it leaves out the input the vendor may already have read (codex-1).
  Gemini also said the relay "fails closed" on unreadable responses. It does,
  except for a transport failure after the request was sent, which is charged
  zero (codex-2). This is a counted review that found nothing in a change
  where the other family found five defects that hold, as in P6 and P12.
- **Fresh-context verification:** codex-1, codex-2, and codex-3 each went to a
  subagent given only the finding's text and the repository, with no account
  of who wrote the code. Every verdict below agrees with its subagent.
  codex-4 and codex-5 were checked by reading the cited code directly and, for
  codex-5, by running the changed test.
- **Executed evidence:** at first, this session's permission classifier
  refused the codex-4 mutation and a read of the test upstream. The
  maintainer then asked for the codex-2 and codex-4 fixes, and both were
  shown failing before they were trusted. The codex-2 test ran against the
  unfixed relay and failed, because the call after the hang-up was admitted
  (`[502, 200]`, where `[502, 402]` was expected). The codex-4 test ran with
  `acquire` reduced to `turn()` and `release` to a no-op, and failed, because
  all four concurrent calls were admitted (`[200, 200, 200, 200]`). The queue
  was then restored.

## Findings

| ID | Finding | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | An unreadable call is charged `max_tokens` as output only, and the totals present that figure as exact | codex | Holds in part | Known limit, owned by I1 (D-P13-19) |
| codex-2 | A transport failure after the request is sent, but before headers arrive, is charged zero and leaves the budget usable | codex | Holds | Fixed |
| codex-3 | A lost reading, or a record stored without its ref, drops a spent call from the totals across resume | codex | Holds | Known limit, owned by I1 (D-P13-20) |
| codex-4 | No test fails if the one-call-at-a-time queue is removed | codex | Holds | Fixed (test added) |
| codex-5 | The model-price test passes with an empty table and claims a property it cannot check | codex | Holds | Fixed |

## codex-1: the unreadable charge is not a ceiling

**Checked:** `charge` in `RELAY_SOURCE`
(`packages/sandbox/src/local/relay.ts`, around line 297). `bodyParser().end`
reads usage only from a complete body, and `done` calls `reader.end()` only
when `complete`. An answer that arrives with 200 and is cut off by SIGTERM
reaches `charge` with `success` true and `u.any` false. It is charged
`maxTokens` as output and zero for input and cache. The finding's arithmetic
checks out against `TEST_METER`. `meterReadingFrom` sums that call into an
ordinary `metered` reading with `exhausted: 'unreadable'`. `costTotals`
(`packages/api/src/cost.ts`) adds it to `metered` and counts it only in
`exhausted`, alongside calls that simply crossed their bound.

**The defect holds.** A call cut off mid-answer is recorded below its cost,
and the totals give no sign that the figure is a lower bound.

**The consequence is narrower than stated.** The mark `unreadable` refuses
every later call, so the budget is still overshot by at most one call, as
D-P13-03 states. D-P13-12 already describes `max_tokens` as "the one part of
its ceiling the relay knows", so the missing input is not news. What no
decision records is that the totals then read as exact. The task cannot
choose when teardown happens. It can only keep a call in flight until the
wall clock ends it.

**Outcome:** known limit, D-P13-19, owned by I1. Until I1 wires the relay,
every line record is `unmetered` (D-P13-11), so no total can hold such a call
yet. The choice between flagging a lower bound and charging an upper bound is
a design choice, so it is recorded with a recommendation rather than decided
here.

## codex-2: a transport failure before headers is charged zero

**Checked:** in the relay's forwarding code, `outbound.on('error')` is guarded by
`if (answered) return` and calls `done(null, false)`. `call.cut` becomes true
only in the SIGTERM handler. So on an ordinary transport error, `charge`
receives `success = false` and records `charged: 'error'` with every count at
zero. `exhausted` stays `'none'`, and `release()` admits the next queued call.

**Holds.** D-P13-04's "an error response that is not a success is not billed
upstream" covers a response that arrived with a non-2xx status. It does not
cover a request whose body was fully sent and then got no answer. Whether the
vendor billed that request is unknown. That makes it a call the meter cannot
count, and the rule this unit sets is that such a call is charged or refused,
never forwarded free. The task probably cannot force a vendor-side connection
failure. The zero charge is still certain, and a retry is admitted after it.

**Fixed.** The relay now tracks whether a metered request was sent whole,
marked by the outbound request's `finish` event. A call that fails with no
answer after that point is charged as unreadable, the same as a call cut off
at close, so the budget is marked `unreadable` and every later call is
refused. A failure before that point is provably unsent and is still charged
nothing. That is D-P13-04's chosen option applied to a case it did not name.
It is recorded as an "Also" on D-P13-04 and in the changeset.

Two tests were added to `meter.test.ts`, with a `hangup` switch in the test
upstream that reads the whole request and closes without answering:

- **Sent, never answered:** statuses `[502, 402]`, one POST upstream, and a
  reading of `calls: 1`, `outputTokens: 64`, `exhausted: 'unreadable'`,
  `refused: 1`. This test failed on the unfixed relay.
- **Never sent** (no upstream exists, so its name does not resolve): statuses
  `[502, 502]`, `costUsd: 0`, `exhausted: 'none'`. This test pins the
  boundary, so the fix does not refuse calls that provably cost nothing.

The cost is availability. After a vendor connection drops mid-call, the
task's later calls are refused. A retry cannot be allowed after a call whose
cost is unknown.

## codex-3: unaccounted invocations can disappear across resume

**Checked:** in `runTask` (`packages/api/src/line.ts`, around line 483), a
`destroy` that throws raises a new error before `recordUsage` runs, and
nothing is committed. The task's status stays `running`, set by
`startAttempt`. `resumeRun` (`packages/api/src/run.ts`) re-enters `runLine`,
and `startAttempt` replays a `running` task, with no check for a missing
reading. `recordUsage` stores the record through `vault.recordUsage` and then
commits its ref in a separate step. `readUsage` and `costTotals` read only
`state.usage`. The meter-failure test in `line.test.ts` asserts that
`startRun` rejects and never resumes.

**Holds, both bullets.** This is not the out-of-scope item about pooling the
budget across retries. That item concerns the spending limit. This finding
concerns the record of a call that has already been spent.

**Outcome:** known limit, D-P13-20, owned by I1. The line runs `StubDriver`
with no relay today (D-P13-11), so nothing spent on the line can be lost yet.
A pending registry entry under the fail-closed invariant would be stronger
than prose, and is offered to the maintainer rather than added here.

## codex-4: removing the queue fails no test

**Checked:** `acquire`/`release` in `RELAY_SOURCE`, and every budget test in
`packages/sandbox/test/meter.test.ts` plus `MODEL_RELAY_ENFORCES_BUDGET` in
`packages/conformance/src/registry/local-relay.ts`. Neither file has a
concurrent request (no `Promise.all`, and nothing that holds an answer open).
The in-flight test's loop sends its next request only after the previous
answer ends. With at most one metered call outstanding, a no-op queue behaves
the same, so every current test would still pass.

**Holds.** D-P13-13 chose the queue specifically to make the stated one-call
overshoot true, and each capability claim needs an assertion that fails when
the capability is deleted. This one had none.

**Fixed.** A test was added to `meter.test.ts`: "calls sent at once reach
the upstream one at a time". The test client gained a `concurrent` mode, and
the test upstream a `hold` delay before answering. Four metered requests are
sent at once, each answer held for a second, under a dollar bound that the
first call crosses. The test requires statuses `[200, 402, 402, 402]`, one
POST upstream, and `calls: 1`, `exhausted: 'cost'`, `refused: 3`. With the
queue removed, it failed with all four admitted (see Executed evidence).

## codex-5: the price-coverage test is vacuous

**Checked:** the test in `packages/drivers/claude-code/test/driver.test.ts`
iterated only the entries and fields that were present, so `prices: {}`
passed it. Its name claimed that "every model a tier resolves to" is priced.
`TIER_MODELS` maps tiers to the aliases `haiku`, `sonnet`, and `opus`, which
the CLI resolves at run time, so no offline test can name that set.
Provisioning (`checkMeter`) already refuses an empty table or a missing
field, and the relay refuses an unpriced model before sending it. The
consequence is a false claim in a test name, not spend.

**Holds.** **Fixed:** the test now requires at least one model and checks all
five named price fields for each model. Its name states what it proves, and a
comment says why the tier-resolution property cannot be tested offline.
Under the old test body, an empty table and a missing field both passed. The
new body fails on each: `models.length` is 0, and `Number.isFinite(undefined)`
is false. That failure was reasoned, not executed. The driver unit suite
passes (49 tests), and so do typecheck and lint.

## Gates

- `pnpm typecheck`, `pnpm lint`, `typecheck:tooling`: clean. `test:tooling`:
  239/239.
- `packages/sandbox`: 148 passed, 2 skipped, including the 29 meter tests.
- `packages/drivers/claude-code`: `driver.test.ts` 49/49.
- `packages/conformance`: 202 passed and 13 failed. Every failure is an
  external entry backed by the funded driver suite, plus the two
  registry-completeness checks that count those entries. The stored driver
  report was produced against a driver-package tree that codex-5's test edit
  has since changed, so conformance correctly refuses it as evidence about
  other bytes (`tree-changed`). Nothing is wrong with the entries. The funded
  driver suite has to run again against this tree, which costs API credit,
  and that run is the maintainer's to authorise.
