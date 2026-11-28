# Triage of the R59 reviews, 2026-11-27

Two reviews, both counted on their first run; no rerun was made.

- **codex** (gpt-6-astra): 3 findings. 3 hold (one of them in part as to its
  consequence). 0 do not hold. 3 fixed.
- **gemini** (gemini-3.1-pro-preview): 2 findings. 2 hold in part. 0 fixed,
  2 rejected with reasons.
- **Raised by both families:** none.
- Codex's answer on the framing is recorded as a known limit, below.

Each finding was checked against the code by a reader given the finding and
the file and nothing about who wrote either, and then by a test where one
could be written.

| Finding | What it says | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | An item the run metered no call for is `within`, and a task with no call and tokens passes validation | codex | holds | fixed, 5886ac2 |
| codex-2 | Results with no token items compare nothing and pass | codex | holds; not reachable from the paid tier as written | fixed, 5886ac2 |
| codex-3 | No free test reaches the token extraction in either arm | codex | holds | fixed, d07c912 |
| gemini-1 | The cast through `unknown` in `counted` is an escape hatch | gemini | holds in part | rejected |
| gemini-2 | `spentBudgets` relies on record order for records of one attempt | gemini | holds in part | rejected |

## codex-1: a comparison that was not made read as `within`

**Checked.** `verdict` in `packages/benchmark/src/tokens.ts` returned
`within` whenever the fresh item had no metered call, whatever the baseline
held. `counted` accepted a task with `calls: 0`, positive token counts, and
`bound: 'lower'`; `figure` then gave no per-call figure and the tokens were
never compared. The independent reader confirmed both.

**Consequence.** The tier's own writers cannot produce the zero-call task:
the driver-alone arm records one call, and the critic arm skips a task with
none. So the second half needed a hand-edited result. The first half is
reachable: a drafted item the runtime starts sending back before any critic
reads it would stop being compared, and pass.

**Fix.** Three states where there was one. Neither side metered a call:
`no-calls`, which passes, since nothing was spent then or now. Only the
baseline did: `no-sample`, which fails. Only the run did: `no-baseline`,
which fails as before. A task recorded with no call is refused. Rejected: a
single no-sample state that fails for all three, which would fail every item
the runtime rightly catches before a model reads it. Shown failing first:
the new test expected `no-sample` and `no-calls` and got `within` twice, and
the zero-call task was not refused.

## codex-2: empty token sets passed

**Checked.** With `tokens: { alone: [] }` on both sides, `counted` accepted
each, `holdTokens` returned no items, and the hold passed. Nothing read the
result's own `arms`. The independent reader confirmed it.

**Consequence.** As the reviewer said, the paid tier builds its fresh result
in memory from every item of the corpus, so the fresh side cannot be empty
there. The baseline side is a committed file, and a baseline with fewer
items than its own outcomes would have been compared as if it were whole
only when the fresh side matched it, which the tier's fresh side would not.
The exported mechanism still broke its own rule that a comparison that
cannot be made is refused.

**Fix.** `counted` now requires a result's tokens to name the arms the
result holds and every item of each arm's outcomes, and at least one item.
Rejected: checking against the corpus inside `holdTokens`, which would need
the corpus loaded where only two results are in hand; the suite already
holds every listed baseline to its corpus with `coverage`. Shown failing
first: three constructions were not refused.

## codex-3: the extraction was not tested

**Checked.** `model.test.ts` replaces both arms with functions that return
a constant. The only real calls to `aloneCall` and `throughTheCritic` are in
`test/tiers/`, which the package's suite excludes, and the critic-plumbing
tier does not run (#264). The independent reader confirmed it.

**Fix.** `test/extraction.test.ts` runs `aloneCall` against a provider that
reads a known meter at teardown and a driver that reports a million tokens
of each kind, and holds the outcome to the meter. The critic arm's
conversion is now `tokensByTask`, held to usage records written by hand,
with an unmetered drafter beside the critic. With the driver-alone count
changed by one token, the test fails. Not covered still: `throughTheCritic`
end to end, which needs the line and Docker; #264 owns the tier that runs
it.

## gemini-1: the cast through `unknown`

**Checked.** The cast is there, and removing a runtime check after it would
not fail to compile. It is the same construction as `checked` in
`comparison.ts`, which says why: a file's type is a claim the file makes
about itself, so every field is read as unknown and checked.

**Rejected.** A type guard would be the same checks behind a different
signature, and the package has no schema library to bring in for one
function. What keeps a check from being removed is the test that fails
without it, and each refusal in `counted` has one.

## gemini-2: record order in `spentBudgets`

**Checked.** `record.attempt >= seen.attempt` keeps the later of two records
with the same attempt. The independent reader traced `line.ts`: a call
writes one `pending` record and at most one terminal one, and a pending
record that a terminal one followed is skipped before the comparison. So no
two records of one attempt reach it, and the order the reviewer worries
about does not decide anything today.

**Rejected.** The suggested fix is a timestamp or sequence comparison for a
case that is not written. `readUsage` returns records in run state's order,
and `costTotals` rests on the same order.

## The framing (codex, item 7): a known limit

Codex said the figures describe consumption and do not show that tokens were
spent well: a task improves its ratio by writing more, and more calls at the
same tokens per call cost more and pass the benchmark's rule. Both are true
of the code. The first is what a ratio is. The second is the choice recorded
in D-R59-04, made because a critic's call count follows its verdict. Neither
is changed here. The result records calls per task, so a rise in calls is
visible in a committed result's diff. Recorded in D-R59-06.
