# M1 proof

One human-specified feature carried by the line to a merged pull request on
the canary repository, with no human touching the code between admission and
the merge approval.

| | |
|---|---|
| Run | `904f6dab-5ae1-41ea-84b8-efd035024b2a`, L2, admitted 2026-10-03 |
| Repository | [`mikev10/olympus-canary`](https://github.com/mikev10/olympus-canary), base `ec47a23db5f395b70983d71013beb8e98640147e` |
| Feature | `slugify`: spec `.factory/spec.md`, locked acceptance test `test/slugify.test.ts` |
| Pull request | [#1](https://github.com/mikev10/olympus-canary/pull/1), opened by the runtime, merged by the runtime after a human approved `integrate:2` |
| Merge commit | `3d10f1aabec0eff8829656d6232ca7d6a83d1eeb` |
| Report | [`report-904f6dab.json`](report-904f6dab.json), `olympus-ai report` output, read from the Vault |

## What the report shows

- Every station from `intake` to `integrate` passed. `build` and `review`
  each took one iteration; no task was parked or retried.
- Two metered model calls: `build` on `sonnet` and `review` on `haiku`, each
  the tier its role's policy scope names. $0.148 in total, cache-hit rate
  0.90.
- No claim/evidence mismatches. One refusal, `approval-required`, at the
  `integrate` exit, and one approval granted for it: the human merge gate.

## What it does not claim

- **Reviewer independence is reduced.** Only the Claude driver exists in M1,
  so the reviewer shares the author's model family, and the run records
  `independence: reduced` at the review seat rather than claiming I6's
  guarantee.
- **The spec and test are not independently designed.** Claude drafted them
  and the maintainer approved them unchanged (D-I1b-08).
- **One run is not a rate.** Rates across runs are R2.

## The run before it

Run `12088e75-91a3-4633-a455-1ba47441edc3` ($0.29) parked at `verify` after
three iterations: the builder's change was correct, but every check ran with
the container's root as its working directory and could not find its runner.
That was a defect in the sandbox provider, fixed in D-I1b-11 before this run.
Paid total for the proof: $0.44 of the $10 cap (D-I1b-09).
