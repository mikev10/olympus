# Triage of R7's external reviews, 2026-10-26

Reviews: `2026-10-26-R7-false-done-benchmark-review-codex.md` (gpt-6-astra, counted, 99,227 input tokens against a floor of 61,155) and `2026-10-26-R7-false-done-benchmark-review-gemini.md` (gemini-3.1-pro-preview, counted, 93,892 tokens against the same floor). No reruns. Each reply's SHA-256 matched its manifest's `replySha256` before its header was prepended. The untouched replies are in 25ab77a.

**Counts.** Codex: 4 findings. 2 hold, 2 hold in part, none fail to hold. Gemini: 3 findings. 2 hold, 1 does not hold. Both families raised 2 of the findings. Each finding was checked by an agent with fresh context, given only the finding and the code, and gemini-3 was also run.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-3 / gemini-1 | An unreadable verdict leaves the rate's sample, so a model choosing what fails to parse chooses what is measured | both | holds | **waiting on the maintainer**: the fix changes an acceptance criterion |
| codex-2 / gemini-2 | An unreadable critic answer is counted as a catch, and as its detector firing | both | holds | fixed, 8f3a76c |
| codex-1 | Any refusal of a started run is a catch, with no evidence a detector found the seeded defect | codex | holds in part | known limit, D-R7-16 |
| codex-4 | The corpus digest omits `corpus.json`'s grants and groups, and a released version can be repinned in place | codex | holds | fixed (see codex-4) |
| gemini-3 | `node -e` puts `[eval]` at `argv[1]`, so no change lands | gemini | does not hold | rejected |

## codex-3 / gemini-1: unreadable verdicts leave the sample

**Checked.** `rates` in `packages/benchmark/src/result.ts` sets the sample to caught plus passed. Unreadable verdicts are counted beside the rate in `unreadable`, never in it. The committed alone arm excludes 9 of 33 seeded trials and 5 of 24 control trials. The mechanism is as both reviewers describe. The exclusion is visible in the result, not hidden, but the headline rate is conditional on what the model chose to answer readably, and the model controls that.

**Why it waits.** The spec's acceptance criterion reads: "Anything else is `unreadable`, reported with its count, and never counted". The code meets that criterion as written. Each fix that resolves the finding changes it:

- **Recommended:** keep the readable-only rate, and also publish a rate over every trial. In that rate an unreadable seeded answer is a miss, and an unreadable control answer is a refusal. A party that makes its answers unreadable can then only make the second rate worse.
- **Alternative:** replace the readable-only rate with the all-trials rate.

Either fix changes the published format, and both need the model tier run again to publish the new rate from its per-repetition verdicts. They already hold enough to recompute it, so a rerun is not strictly needed for this finding. Working rule 6 makes this an acceptance-criterion change, so it is put to the maintainer.

## codex-2 / gemini-2: an unreadable critic answer was a catch

**Checked.** `throughTheCritic` pushed `critic:unreadable` and returned `caught` for any cause, and the corpus's `critic` prefix matched `critic:unreadable` in `detectorFired`. The runtime records an unreadable critic as one synthetic finding with `readable: false` and sends the draft back, so `sent-back:critic` came with it. The committed `v1-model.json` carries `critic:unreadable` among the causes of the controls `sound-spec` and `tests-follow-spec`. The critic arm's `unreadable` count was 0 by construction, because `CriticOutcome` had no unreadable verdict.

**Fixed in 8f3a76c.**
- `criticVerdict` is a pure function. The runtime's own problems with a draft, or a readable finding, are a catch. An unreadable answer with neither is `unreadable`, even though the runtime sent the draft back on it.
- `modelTier` records `detectorFired: null` for an unreadable repetition.
- `test/critic.test.ts` covers the verdict. A new `model.test.ts` case failed against the old `model.ts` and passes now.

**Not fixed by it.** The committed `v1-model.json` was produced under the old rule. Its causes are aggregated across repetitions, so the repetitions that were unreadable cannot be recovered from it, and its critic arm cannot be recomputed. It stands as the record of what that run said, under the code it ran with. A corrected critic arm needs a paid rerun, which is the maintainer's to make. This is recorded in D-R7-14.

## codex-1: any refusal is a catch

**Checked.** `classify` in `line.ts` returns `caught` for every refusal of a started run, except approval-required at the integrate exit with no escalation. The causes a check can fail with are `no-result`, `expectation`, `exit-code`, `suite-count`, `new-finding` and `suppression-added`, and none of them is an infrastructure failure or a timeout. A check whose run errored would most likely record `exit-code`, the same cause a failing test records.

**Holds in part.**
- "A refusal is a catch" is deliberate (D-R7-05). The deterministic tier measures whether the line refused, which is the product's claim. Which detector refused is recorded per item, beside the verdict.
- The stated consequence is bounded. Every cause each item recorded is in the committed `v1-deterministic.json`, and CI compares that file byte for byte. A seeded item caught by an infrastructure failure would change its causes and fail CI.
- What remains:
  - a cause that cannot tell a failing test from an errored run is the check gate's to separate, not R7's;
  - a refusal before the change lands is not checked on each run. `hidden.test.ts` checks that every item's change lands.

**Outcome.** Known limit D-R7-16. No change here.

## codex-4: the manifest was outside the digest

**Checked.** `digests` skipped `corpus.json`, and `corpusDigest` hashed only file paths and digests. A change to `builderGlobs` or `groups` changed what a run measures, under the same version and digest. CI would catch such a change only where it flipped an outcome or a `detectorFired` in the deterministic result, never in the model result. `pinCorpus` repinned a released version in place, and the test asserted that this worked. "A changed corpus is a new version" was only a comment.

**Fixed.**
- `corpusDigest` now also hashes the manifest's `repos` and `groups` as canonical JSON.
- `loadCorpus` refuses a released version whose digest differs from the one pinned in source (`RELEASED.v1`).
- The repin test now asserts the refusal. New tests cover a changed group, a changed glob, and a new version made from a released one.
- `docs/benchmark/v1-deterministic.json` was regenerated by a real run, and its only change is the digest.
- `v1-model.json` names the digest under the old formula, over the same bytes. D-R7-15 records this, and the rerun D-R7-14 calls for would correct it.

## gemini-3: `process.argv` under `node -e`

**Does not hold.** `node -e '<script>' '{"a":1}'` gives `process.argv` = `[node, '{"a":1}']`: under `-e`, the first argument after the script is `argv[1]`. Running it confirmed this. The scripted seat throws when its apply command exits non-zero. Every deterministic item records a cause that needs its change to have landed, and `hidden.test.ts` checks that the changes land. Rejected, with no change.

## Bundle

The bundle is committed at `docs/reviews/2026-10-26-R7-false-done-benchmark-review-bundle.txt`. Its SHA-256 is `17bef4bb2a5505d58aa986130a299949cf25caa1fa1d9631af65c1a0dde97407`, the value the prompt names. No copy was left outside the repository.
