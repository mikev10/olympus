# Triage of the external reviews of R54, 2026-11-23

Two reviews, both `counted` on the first run. No family was rerun.

- **codex** (gpt-6-astra): 6 findings. 4 hold, 2 hold in part, 0 do not hold.
- **gemini** (gemini-3.1-pro-preview): 5 findings. 2 hold, 2 hold in part, 1
  does not hold as a defect.
- **Raised by both families:** 4 defects (codex-1/gemini-1, codex-4/gemini-2,
  codex-5/gemini-3, codex-2 and codex-3/gemini-4).

Every finding was checked against the code by an agent with fresh context that
was given the claim and the files and not told who wrote them. Its answers are
quoted as evidence below. Where a claim could be run, it was run.

| Finding | Claim | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1, gemini-1 | Committed results are not tied to the run that produced them | both | holds | Known limit, #228 |
| codex-2 | `compareRuns` trusts a file's summary, not its trials; no runtime validation | codex (gemini-4 overlaps) | holds in part | Fixed, b446cf1 |
| codex-3, gemini-4 | Items are not compared; an arm can be dropped from both files; tier and per-call limit are not recorded | both | holds in part | Fixed in part, b446cf1; the rest #228 |
| codex-4, gemini-2 | The paid workflow runs the pull request's code with the key, so the caps are the pull request's own | both | holds; one sub-claim of gemini-2 does not | Known limit, #228 |
| codex-5, gemini-3 | With no comparison file the committed-comparison test asserts nothing | both | holds | Fixed, b446cf1 |
| codex-6 | The comparison tier's assertion restates how `change` is computed | codex | holds | Fixed, ea3edb1 |
| gemini-5 | The test rigs' readiness scan always answers level 2 | gemini | holds as a description, not as a defect | Rejected |

## codex-1, gemini-1: committed results are not tied to a run

**Checked:** `packages/benchmark/test/comparison.test.ts`, the
committed-comparisons test. It recomputes each committed comparison from the
two result files it names. Nothing reads a workflow artifact. The agent:
"Nothing in the test or comparison.ts binds result files to a CI artifact."

**Verdict:** holds. A pull request that commits trial records no run produced,
with the comparison built from them, passes.

**Outcome:** known limit, owned by #228. Tying a file to a run needs either an
attestation or a check that downloads a named run's artifacts. Both are CI
work under `.github/workflows/`, a gate path, and neither is in this unit's
scope. The fix for codex-2 narrows what can be forged: a summary can no longer
be edited on its own, so a forgery has to rewrite the trial records. Today's
defence is the maintainer reading the pull request. The run id, 45316704752,
is in D-R54-06, and the artifacts are kept for 30 days.

## codex-2: summaries trusted, no validation

**Checked:** `side()` and `compareRuns` at head `4a3b15d`. `side()` read
`overall.everyTrial` and never `items`. False-dones were `sample - count`, and
false refusals compared the stored `rate`. Both readers cast
`JSON.parse(...)` to `BenchmarkResult`.

**Run:** four constructions, each a test that failed before the fix
(`expected [Function] to throw an error`): a summary claiming more catches than
its trials show; a false-refusal rate of 0 beside a count of 3; a cost of
`"100"` against 20; the same totals over a renamed item.

**Not in the code:** a summary of kind `rate` with sample 0 and count 0 did
not slip past the no-sample refusal as described. The agent: "side() throws
unless kind is 'rate'... NaN only follows if kind 'rate' is paired with sample
0 and a missing or NaN rate, which is the same unvalidated-JSON point."

**Verdict:** holds in part: everything but the sample-0 construction.

**Outcome:** fixed in b446cf1. `compareRuns` now reads each file as unknown
data. It refuses a cost that is not a non-negative number, repetitions that
are not a positive integer, a malformed or repeated item, an undefined
verdict, and an item that did not run once per repetition. It counts every
arm's rates again from the verdicts and refuses a file whose stored summary
differs. Refusals are compared by count.

**Choice:** recount and refuse a mismatch, over recount and ignore the stored
summary. A file whose summary disagrees with its trials is wrong somewhere,
and a reader of the file sees the summary first. Refusing is the fail-closed
one. The two committed results pass the recount unchanged, and the committed
comparison still reproduces byte for byte.

## codex-3, gemini-4: items not compared, arms can be dropped, settings not recorded

**Checked:** `compareRuns` compared corpus version and digest, repetitions,
arm names, and aggregate samples. The agent: "It never looks at item ids,
kinds, groups or per-item repetition counts. Dropping the `critic` arm from
both files still compares." `ModelRun` (`result.ts`) holds the model,
repetitions, cap and spend, and no tier or per-call limit.

**Verdict:** holds in part. gemini-4 called it a tradeoff; it is a defect.

**Outcome, fixed in b446cf1:**
- `compareRuns` refuses two results whose arms hold different items, by id,
  kind and group.
- `coverage` holds a result to the committed corpus it names: the digest, the
  arms `alone` and `critic` and no others, every item of the corpus in the
  first and every model-tier item in the second. The suite applies it to every
  result a committed comparison names, and the comparison tier applies it
  before it compares.

**Outcome, not fixed, #228:** the tier and the per-call limit are not in the
result. Recording them changes what a run writes, and the two committed
results were written without them. Adding the fields by hand would be writing
evidence no run produced, and running again to get them costs another paid
run for a field. The tier is in each file's name and both settings are fixed
in the workflow file both runs used.

## codex-4, gemini-2: the pull request's code runs with the key

**Checked:** `.github/workflows/benchmark-model.yml` and `ci.yml`. The agent:
"CONFIRMED on the main claim... The caps are env values in the same file and
are also enforced by PR-supplied test code. ci.yml does the same: its paid
driver steps run `pnpm --filter ... test` with the secret when the
`run-driver` label is present." Fork pull requests are excluded by the job's
condition.

**Sub-claim that does not hold (gemini-2):** that the bundle's change to
`.claude/skills/merge-unit/SKILL.md` lets an attacker have the maintainer's
agent add `run-benchmark`. The agent: "contains no mention of `run-benchmark`.
It only tells the agent to add `run-driver`." That diff came from another pull
request merged since the tag, and this branch does not change the file.

**Verdict:** holds. The consequence is narrower than stated: the party is
someone who can push a branch to this repository, and someone who can label
must start the run.

**Outcome:** known limit, owned by #228. This is how every paid job in the
repository runs, so changing it for one workflow would leave the others as
they are. Running paid suites from the base branch's code, or metering them
outside the job, is a change to the gates and belongs to its own unit. The
bound that does not depend on the code under test is the provider key's own
spend limit. D-R54-05's claim that the caps are "in the file" is corrected in
D-R54-07 to say who enforces them.

## codex-5, gemini-3: no comparison, no assertion

**Checked:** the committed-comparisons test filtered the directory and looped,
with no assertion that anything matched. The agent: "With none, the test
passes vacuously."

**Verdict:** holds.

**Outcome:** fixed in b446cf1. `REQUIRED_COMPARISONS` names the comparison
this unit decided on, and the suite fails when it is not committed. A second
test ties the map to its evidence: the `deep` tier may hold a model that a
committed comparison names as its candidate only where that comparison says
`change`.

**Choice:** a named list, over "at least one file". One file of any name
would satisfy a count, and the decision rests on a particular comparison.

## codex-6: the tier's assertion restates the rule

**Checked:** `comparison.tier.ts` asserted
`expect(comparison.change).toBe(comparison.noWorse && comparison.costsLess)`,
the expression that computes `change`.

**Verdict:** holds, low. The tier writes a file; it was never the test of the
rule, which the package's suite holds with independent cases.

**Outcome:** fixed in ea3edb1. The tier holds both results to their corpus
with `coverage` before comparing, and asserts that what is on disk is what was
computed.

## gemini-5: the rigs' readiness scan always answers level 2

**Checked:** `RIG_READINESS` and `RIG_SCANNER` in
`packages/api/test/harness.ts`, `BENCH_READINESS` in
`packages/benchmark/src/line.ts`, and admission in `packages/api/src/run.ts`.
The agent: the stubs are in a test directory, a test fixture, and the
benchmark's runner; "run.ts does not default to a scan... admissionRefusal
refuses 'readiness-unscanned' above L0 when the record has no scanned term."

**Verdict:** the description is right and it is not a defect. This is the
admission change A-R40-02, merged by its own pull request and in this bundle
only because it landed after the last reviewed tag. It is not R54's work. The
change makes admission refuse when no scan ran, and gives each in-process
caller a scan to pass. A test rig's scan is a stand-in by design: what the
rigs prove is that admission enforces the term. codex read the same code and
reported "no demonstrated request-data-only readiness bypass", noting that the
stubs "prove enforcement of a readiness term, not execution of a scanner".
No production host is wired with these.

**Outcome:** rejected. Nothing changed.

## Item 7, the framing

Both reviewers said the adversarial question fit. Both also said the same
thing about its limit, in different words: the rule is exact and the data it
runs on has no provenance (gemini), and the runs measure judging supplied work
rather than authoring it (codex). The first is #228. The second is D-R54-03
and #223.
