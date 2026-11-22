# R36b proof: a real feature on `my-recipes`

The line built one feature for the maintainer's own app, from a one-line intent to a pull request merged into `my-recipes`' `olympus-trial` branch. It drafted the spec and the tests, and the maintainer approved each gate. Nobody wrote or edited a file in the change. The run is evidence beside R36b's assertions, never in place of them.

| | |
|---|---|
| Run | `0a2de797-8dbf-44ba-8148-0d93a7112e5b`, L1, `--draft-spec --draft-tests`, created 2026-11-22 |
| Intent | *Scale a recipe's ingredient amounts by a chosen number of servings.* |
| Olympus | fresh clone of `unit/r36b` at `4e63718`, released locally with `scripts/local-release.ts` |
| Repository | [`mikev10/my-recipes`](https://github.com/mikev10/my-recipes), base `olympus-trial` at `4f663a3bf14a3ee5f507ce0b6537df1af4d2bb55`, Windows, `core.autocrlf=true` |
| Pull request | [#20](https://github.com/mikev10/my-recipes/pull/20), opened by the runtime, merged into `olympus-trial` by the runtime after the maintainer approved `integrate:1` |
| Merged head | `4d44773d93774e2ed4c5dce99072a9509bfdb440`, merge commit `4fddd5cf7f36b1ae90bc7b013388cb684c69034f` |
| Cost | approved ceiling $42 (51 driver calls); spent $1.23 over 6 metered calls, all `claude-sonnet-5` |
| Report | [`report-0a2de797.json`](report-0a2de797.json), `olympus-ai report` output, read from the Vault |

## Vault records (sha256 of the file in `vault/runs/0a2de797-…/`)

| Record | sha256 |
|---|---|
| `admission.json` | `296b26de0f62709f45e5bffda13472b55e1919bcc2e43dbc74e22dde051dad01` |
| `state/53.json` (final state, standing `passed`) | `5387229ededc917b51ed29c08be68627a7c814baaa20f8a2cb834aaa958e6514` |
| `draft-lock.spec.json` | `b70fe3ea7015b76c71f2a014a673604c533a41c16ccf57794d9580d5f4e1f6e9` |
| `draft-lock.test-design.json` | `10d4000a5e53a5acd2229a56d8be9cbe67697c2ec6ccf0a63c63dc03ce9755bb` |
| base run of the test draft (`objects/base-run/`) | `1eb70235ee87c4c0734addbab68f95fc603249f23315584b99ed75dea6d2918b` |

The approved spec draft is `3ce3fdadf2d7042523e182c4f6d36e5b85553fd661fb17f7f40044e45899a611` (attempt 2). The approved test draft is `bdeff659baea4e26b3de8d8adcf6ac78c298f69f603ea925e40b4b8d9e8bf7a2` (attempt 1).

## What the report shows

- Every station from `intake` to `integrate` passed, with no task parked or retried.
- `spec` took two drafts. The first assumed the input replaces the ¼×–3× buttons and asked what to do for a recipe with no servings count. The maintainer had answered both in earlier attempts, so the draft was sent back with those answers, and the second draft had no open question.
- `test-design` took one draft: four checks under `src/lib/`. Its base run showed the four failing on the base, as drafted, and the secret scan and static analysis passing (0.5 s and 4.9 s).
- `build` took one iteration: 302,512 cache-read tokens and 12,415 output tokens, $0.28. That is above the 200,000-token budget that ended attempt 4, and below the 1,000,000 set by D-R36b-12.
- `review` and the security review both passed.
- Four refusals, all `approval-required`: the three human gates and the send-back. No claim or evidence mismatches.

Cost by task: spec drafter $0.59, test drafter $0.15, build $0.28, review $0.13, security review $0.08.

## Commands typed (attempt 5)

PowerShell, from the README and `init`'s printed next steps. `%USERPROFILE%` stands for the home directory.

```
git clone --branch unit/r36b https://github.com/mikev10/olympus.git olympus-r36b-run   # 4e63718
pnpm install
node scripts/local-release.ts $HOME\olympus
$env:Path = "$HOME\olympus\node_modules\.bin;$env:Path"
cd %USERPROFILE%\Projects\my-recipes            # olympus-trial @ 4f663a3
factory-host init --base-branch olympus-trial
# the two secret lines (ANTHROPIC_API_KEY, FACTORY_GIT_TOKEN) added to $HOME\.factory\host.env
factory-host --env-file $HOME\.factory\host.env
olympus-ai --env-file $HOME\.factory\host.env create --workspace %USERPROFILE%\Projects\my-recipes --base-commit 4f663a3bf14a3ee5f507ce0b6537df1af4d2bb55 --level 1 --draft-spec --draft-tests --intent "Scale a recipe's ingredient amounts by a chosen number of servings." --manifest .factory/verify.json --graph .factory/graph.json
#  -> worst-case cost $42, at most 51 driver calls; nothing started
#  (same command) --approve-cost 42
#  -> run 0a2de797-8dbf-44ba-8148-0d93a7112e5b
olympus-ai --env-file $HOME\.factory\host.env reject 0a2de797-8dbf-44ba-8148-0d93a7112e5b spec:1 --draft 6b55e0579923be895ff8c5d09cdcafa57c0ec757f2a406018f75bb665e6cbc5f --notes "<the maintainer's earlier answers, below>"
olympus-ai --env-file $HOME\.factory\host.env approve 0a2de797-8dbf-44ba-8148-0d93a7112e5b spec:1 --draft 3ce3fdadf2d7042523e182c4f6d36e5b85553fd661fb17f7f40044e45899a611
olympus-ai --env-file $HOME\.factory\host.env approve 0a2de797-8dbf-44ba-8148-0d93a7112e5b test-design:1 --draft bdeff659baea4e26b3de8d8adcf6ac78c298f69f603ea925e40b4b8d9e8bf7a2
olympus-ai --env-file $HOME\.factory\host.env approve 0a2de797-8dbf-44ba-8148-0d93a7112e5b integrate:1
olympus-ai --env-file $HOME\.factory\host.env report 0a2de797-8dbf-44ba-8148-0d93a7112e5b
```

`status` was read throughout between gates. The send-back notes were the answers the maintainer gave at the spec gates of attempts 1–3, combined:

> The maintainer answered this in earlier runs; use these answers. (1) Keep both: a target-servings number input sits beside the existing quick-scale buttons (1/4x, 1/2x, 1x, 2x, 3x); it does not replace them. They are mutually exclusive: typing a valid target number of servings deselects the active quick-scale button, and clicking a quick-scale button clears the target-servings input. Show which control is active with an accessible state (aria-pressed on the buttons). Use a plain number input field with an accessible name, no stepper. Disable the input when the recipe has no servings count. Invalid input (not a whole number 1 to 1000) has no effect. (2) Any ratio between two valid serving counts is acceptable; do not clamp the factor to the 1/4x-3x range. (3) Build the user-facing control on the recipe detail page too, not only the math. Keep the rules testable: put the scaling and selection rules (which control is active, what input is valid, the active scale factor) in a pure, dependency-free module under src/lib, name its exports in run-requirements.json, keep testDirectory src/lib, and require IngredientsPanel to delegate to that module rather than reimplement the rules. The acceptance tests must run in the existing vitest setup (environment node) with no new dependencies and no change to package.json, which is a protected path. Keep the rest of this draft (display-only, grocery list unchanged, no persistence, no new request, the out-of-scope list).

## The attempts before it

Each failure was filed as an issue and fixed in R36b when it was in scope. The run was then repeated from a fresh clone, with the previous attempt's `%USERPROFILE%\olympus`, `%USERPROFILE%\.factory` and `my-recipes\.factory` set aside. The approved cost ceiling was $42 every time.

| # | Run | Olympus | Ended at | Cause | Fix | Spent |
|---|---|---|---|---|---|---|
| 1 | `c72be87d-d8f9-4e64-b248-3b99271cd6e4` | `53a25a3` | spec, parked | the host was started with an API key the provider rejected (401); no model reached | #176, out of scope; the maintainer restarted the host with a valid key | $0 |
| 1 | `ed031f3a-9c38-4350-8fa0-d60c33947d7a` | `53a25a3` | test-design, cancelled | all three test drafts failed on the manifest's shape: the role did not name every field of a check | D-R36b-08 | $2.03 |
| 2 | `f8a4c6a4-eb91-45c0-8712-78169a9753db` | `4996835` | test-design, cancelled | the static-analysis scan timed out on `node_modules` in its copy of the tree, a base mismatch no redraft could cure; the run stood open with no sign (#180, #181) | D-R36b-10 | $1.47 |
| 3 | `d26fb760-fe45-4e71-98bf-2e4ba5ba7e85` | `1c2f836` | test-design, cancelled | all three test drafts wrote their tests under `.drafts/`, where they are discarded | D-R36b-11 | $1.05 |
| 4 | `7c2fe8a8-d106-4d85-b15b-f05a046f188d` | `966f756` | build, parked | the builder spent its 200,000 tokens reading the repository before it wrote anything (#192), and the spent-budget refusal was retried twice (#193) | D-R36b-12 | $1.04 |
| 5 | `0a2de797-8dbf-44ba-8148-0d93a7112e5b` | `4e63718` | **merged** | none | none | $1.23 |

D-R36b-09 came from attempt 2: a second host was started while one already listened, and the port error surfaced as a stack trace, not a refusal. Total model spend across all six runs: $6.82. Every command of every attempt, as typed, is in [`commands.txt`](commands.txt). The admissions were:
- `ed031f3a`: `e04de3f7…`
- `f8a4c6a4`: `e6f46bf4…`
- `d26fb760`: `a31a6041…`
- `7c2fe8a8`: `75f9be2d…`

## What was done by hand, and what was not

Allowed, and done:
- adding the two secret lines to `host.env`, copied file to file and never read or printed;
- approving the cost;
- each gate decision, including one send-back per run carrying the maintainer's earlier answers.

Done between attempts, never during a run:
- setting the previous attempt's directories aside;
- moving the previous run's drafted test files out of `my-recipes/src/lib/`, where the drafter had written them (#201).

After `integrate:1` was reached and before it was approved, the merged-to-be branch was run locally to take screenshots for the maintainer. The dev server got throwaway values for `APP_PASSWORD` and `AUTH_TOKEN`, set in its environment only. No file was written, and the checkout was switched back to `olympus-trial`.

Not done: writing or editing any file in the change, setting any other variable, or changing Olympus during a run.

## What it does not claim

- **Reviewer and critic independence is reduced.** Only Anthropic was configured, so the drafting critics were not seated: `independent-critic-clean` failed at both drafting gates, and `drafter-independent-of-builder` failed at `test-design`. The reviewer shares the builder's model family. The Codex driver (R26) can fill these seats, but `init` does not set it up.
- **The approved tests are not in the merged pull request.** `integrate` pushes the builder's diff alone (#198).
- **The maintainer did not try the feature on a device.** It was reviewed from screenshots. The Vercel preview for the PR was refused, because the factory's git identity is not on the Vercel team (#200).
- **Follow-ups on the feature itself:** ignored input stays visible in the box (my-recipes#21), and gram amounts in brackets were never scaled (my-recipes#22).
- **One run is not a rate.**

Token efficiency, prompted by attempt 4, is tracked in #197.
