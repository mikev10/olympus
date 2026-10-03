# Triage of I1a's external reviews, 2026-10-02

Two reviews, both `counted`, from one prompt and one bundle:
`2026-10-02-I1a-real-line-review-codex.md` (gpt-6-astra, family codex) and
`2026-10-02-I1a-real-line-review-gemini.md` (gemini-3.1-pro-preview, family
gemini). Before each header was prepended, each reply's SHA-256 matched its
manifest's `replySha256`, and the reply beneath each header still hashes to
that value. Both runs sent one byte-identical payload (`173de419…`), and both
ingested it completely and echoed every bundle marker. Gemini's counted run is
its second; the first was `FAILED` on integrity (its reply stopped short of the
bundle's tail markers) and is kept as `…-gemini.attempt-1.run.json`. Findings
are cited by family and number; gemini's are unnumbered in its reply and are
numbered here in the order they appear.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 2 | 1 | 1 | 0 |
| gemini | 2 | 1 | 0 | 1 |

- **Both families raised:** one mechanism. codex-1 and gemini-1 are the same
  defect: a process stop while a driver call is in flight leaves no usage
  record of any kind, so resume replays the task and the totals stay `exact`.
  It holds.
- **Did not hold:** 1 of 4, gemini-2. The wrapper it describes is classified
  unattested before `relayless` ever runs, and the check it calls tautological
  has a test that fails without it.
- **Held in part:** codex-2. The recorded model is the alias (already the
  recorded choice D-I1a-03), and the relay does not bind a sandbox to the
  tier's model; but the cost is not misstated, because the relay prices each
  request by the model that request names.
- **Fresh-context verification:** all four findings went to three subagents
  (codex-1 and gemini-1 together), each given the finding text and the
  repository, with no account of who wrote the code. Each verdict below agrees
  with its subagent, and the load-bearing code for each was then read directly:
  `startAttempt` and `runTask` in `packages/api/src/line.ts`, `lostReadings`
  and `resumeRun` in `packages/api/src/run.ts`, the totals fold in
  `packages/api/src/cost.ts`, `buildGraph` and its tests, and the relay's
  pricing in `packages/sandbox/src/local/relay.ts`.
- **Executed evidence:** codex-1 / gemini-1 was first a reading; the fix
  began with a test in `packages/api/test/line.test.ts` (a process stop
  during the call) that failed on the reviewed code, its total `exact` with
  no calls. `I2.call-recorded-before-it-is-made` fails when the pending write
  is deleted.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-1 | A stop while a driver call is in flight leaves no record; resume replays, totals stay `exact` | codex, gemini | Holds (gemini's "up to maxStarts" holds in part) | Fixed: `pending` reading (D-I1a-12, A-I1a-08), confirmed by the maintainer |
| codex-2 | The usage record names the requested alias, and the relay does not bind a sandbox to the tier's model | codex | Holds in part | Known limit, owned by R14 (D-I1a-13), confirmed by the maintainer |
| gemini-2 | `relayless` is tautological; a wrapper dropping `relayRequest` slips past | gemini | Does not hold | Reject, confirmed by the maintainer |

## codex-1 / gemini-1: a call in flight at a process stop leaves no record

**Checked.** `startAttempt` (`line.ts`) commits the task as `running` and
`starts + 1` before any call, and records nothing else. `runTask` provisions
the sandbox, calls `driver.runTask`, destroys the sandbox, and only then writes
a usage record: a `lost` reading if the destroy throws, the meter's reading
otherwise (`recordUsage`). Nothing is written before the call. On resume,
`lostReadings` (`run.ts`) filters the records the Vault already holds for
`reading.kind === 'lost'`; with no record at all it returns nothing, and
`resumeRun` continues. `startAttempt` then sees `running`, treats it as a
replay, and calls the driver again. The totals fold (`cost.ts`) takes usage
records only, sets `bound: 'lower'` only for `unmetered`, `lost`, or
unreadable readings, and has no view of `starts`, so the killed call is absent
and the total reads `exact`.

**Found.** The defect holds as both reviewers state it. The window is the
whole driver call plus teardown, which is most of the time a task is
`running`. The record-then-commit crash after `recordUsage`'s Vault write is
covered (A-I1a-05: orphan records are listed by run), so the hole is
call-before-write, as codex-1 puts it, not write-before-commit.

**Consequence.** One unmetered paid call per killed attempt, and a run total
reported `exact` that is not. gemini-1's "up to the `maxStarts` limit" holds in
part: each replay needs another external resume after another stop (D-P4-06),
and a replay that completes is metered normally, so only killed attempts go
unrecorded. `maxStarts` still parks the task, so the worst-case cost figure a
person approves at admission is still a bound; what is lost is the record of
what was spent inside it, and the honesty of `exact`.

**Already recorded?** No. D-I1a-08 rejected inferring loss from `starts`
because "a replay after a crash looks the same as a lost reading", and closed
D-P13-20 for a destroy failure and the record/commit crash; neither names a
stop during the call. D-P4-06 accepts the replay without saying anything about
metering.

**In scope.** The prompt's adversary controls "when the runtime's process
stops", and lost readings are this unit's deliverable (A-I1a-04..06).

**Fix, two options; this changes a contract, so it waited for confirmation. The maintainer chose A (2026-10-02):**

- **(A, recommended) record the call before it is made.** `runTask` writes a
  `pending` usage reading through `vault.recordUsage` after provisioning and
  before `driver.runTask`, keyed by task and attempt; the terminal reading
  follows as now. A `pending` with no terminal record for the same task and
  attempt is a lost reading: `lostReadings` refuses resume with `meter-lost`,
  and the totals count it as lost and report `lower`. Contract change:
  `UsageReading` gains `pending`. Its only over-caution is a stop between the
  pending write and the call, which refuses a resume that was safe: fail
  closed, and a human cancels.
- **(B) infer it at resume.** A `running` task with no usage record whose
  `attempt` equals its `starts` is treated as lost. No contract change, but
  `costTotals` must take run state to report `lower`, and every stop between
  `startAttempt`'s commit and the call (container start included) refuses
  resume. It is the inference D-I1a-08 declined, for the reason it gives.

A is recommended: the evidence of a call is a record written before it, not a
counter read afterwards, and it answers codex's item-7 question, "what durable
evidence proves that every potentially billable invocation has been accounted
for?", with a record rather than a deduction.

## codex-2: the recorded model, and a relay not bound to it

**Checked.** `runTask` sets the record's model from `driver.resolveModel(tier)`
before the call; the Claude Code driver maps tiers to the aliases `haiku`,
`sonnet`, `opus`. `MeterReading` carries no model. `relayRequest()` returns the
same `MODEL_RELAY` for every tier, whose price table lists every priced model.
The relay (`packages/sandbox/src/local/relay.ts`, not in the bundle) reads
`model` from each request body, refuses a model with no price before
forwarding, and charges each request at its own model's price.

**Found, in three parts.**

- *The record names the alias, not the model that ran:* holds, and is the
  recorded choice D-I1a-03 ("The record names the alias and CLI version, not
  the dated model id"; reverse: add observed models to `MeterReading`). The
  unit spec asks for the runtime's resolution of the tier, not a measurement
  (DECOMPOSITION.md, I1a). Not a defect of this unit as specified. The review
  prompt's wording, "the model a call used [is] the runtime's measurement",
  overstated it; that is the framing's error, not the code's.
- *A sandboxed request naming another model is priced or recorded as cheaper:*
  does not hold for cost. A task with a command tool can send the relay a
  request naming any priced model, and it is charged at that model's price and
  counted against the task's dollar budget.
- *Nothing binds the sandbox to the tier's model:* holds. Such a request runs
  under the tier's alias on the usage record, and the tier policy names is not
  enforced at the relay. No decisions entry records this.

The paid test comparing `record.model` with `components.driver.resolveModel(TIER)`
is circular for "the model that served the call" and honest for what its title
claims, that the line records the runtime's resolution and not the driver's
account.

**Outcome: known limit, owned by R14** (a tier per station, where model
selection and its enforcement are decided). Pinning the relay to a tier needs
the tier's alias resolved to concrete model ids the CLI will send, which the
driver does not know today (its table lists two Haiku names for one alias),
and recording observed models is D-I1a-03's reverse, a `MeterReading` change.
Recorded as a decisions entry and, because the invariant that the runtime, not
the model, reports what a call used has a registry, as a pending entry owned by
R14 with the baseline raised (the D-S1-18 precedent).

## gemini-2: `relayless` and a wrapper that drops `relayRequest`

**Checked.** `buildGraph` (`packages/api/src/graph.ts`) calls `attest` for each
slot first; a component that is not an instance of the real class for its slot
gets an `unattested` declaration and the loop `continue`s, so `relayless` runs
only on a real `ClaudeCodeDriver`. `graph.test.ts` asserts a delegating wrapper
around a real driver is `unattested driver`, and that a Proxy whose
`relayRequest` returns `null` is declared `driver claude-code` (unmetered).
`Driver.relayRequest` is a required method in the core contract.

**Found.** Does not hold. The delegating wrapper the finding describes never
reaches `relayless`. The check is not tautological: deleting the null branch
fails the Proxy test. The one construction that does reach it, a Proxy around a
real driver whose handler hides `relayRequest`, throws a `TypeError` inside
`buildGraph`, so no graph is built: fail closed, as the reviewer concedes.

**Outcome: reject.** A `typeof` guard would turn a `TypeError` into a typed
declaration with the same safety result; not a defect.
