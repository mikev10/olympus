# Decisions: ci (amendment)

## Amendment: CI gets a credential, and the order the gate needs

P5 shipped nine assertions that call a real model and refuse rather than skip
without a credential. CI had none, so `v2` went red the moment P5 merged. This
is the amendment WORKFLOW.md expects between a unit and the next one.

### D-A-CI-01: an Actions secret, not identity federation

- **Ambiguous:** the console offers workload identity federation, which lists GitHub Actions among its providers, and a short-lived token beats a long-lived secret on every axis that matters. It was the recommendation until it was checked.
- **Why it does not work here:** federation is detected by the Anthropic SDKs and the `ant` CLI, which read `ANTHROPIC_FEDERATION_RULE_ID` and friends and exchange a JWT. The thing that authenticates in this unit is neither — it is the Claude Code CLI running inside a container, whose own documentation says authentication is `ANTHROPIC_API_KEY` or an `apiKeyHelper` command. The driver then *refuses* a session whose reported `apiKeySource` is anything else, deliberately (D-P5-07): a credential the driver did not arrange is one it cannot account for.
- **Chosen:** `secrets.ANTHROPIC_API_KEY`, passed as an environment value to the two steps that need it.
- **What it would take to change later:** the CLI accepting a federated identity, the driver forwarding the federation variables through `ExecOptions.env`, and the `apiKeySource` check learning a second acceptable answer. Each is small; none can be assumed, and the first is not ours.
- **Use a separate key for CI, with a spend limit.** P5's own review established that the credential is readable by anything a task runs (D-P5-20). In CI that task is running model-generated commands on a machine nobody is watching, which is a worse place to hold a key than a laptop is. A key scoped to CI can be revoked without touching a developer's.
- **Reverse:** delete the two `env:` blocks. CI goes red again, honestly.

### D-A-CI-02: the driver's suite runs before the recursive test command

- **Problem:** a credential alone would not have fixed CI. From a cold checkout there is no run report, so conformance refuses all nine external assertions, and `pnpm test` aborts on that failure before it reaches the package whose suite writes the report. The command cannot repair itself — D-P5-23, met in the one place it actually bites.
- **Chosen:** an explicit step that runs the driver package's suite first, with a comment saying why it cannot be reordered away.
- **The cost, stated:** `pnpm test` then runs that suite a second time, so a CI run makes roughly eighteen model calls rather than nine. They are small calls on the cheapest model and the duplication buys the workflow staying the same four commands a contributor runs locally. A root script that owned the order would remove the waste and hide the constraint; that trade is worth making when a second package contributes external assertions, not before.
- **Reverse:** delete the step. CI fails from cold on every run.

### D-A-CI-03: the image's user is fixed, and a workspace owned by anyone else is read-only

- **Found by CI, not by the machine it was written on.** `I1.driver-executes-inside-the-sandbox` passed locally and failed on a GitHub runner with an empty workspace: the marker the task was asked to write never appeared. Nothing about the assertion was wrong — the task genuinely could not write.
- **Cause:** the image runs as its base's `node` user, uid 1000. A bind mount carries the host's ownership through unchanged, and a GitHub-hosted runner is uid 1001, so the workspace was owned by a user the container is not. The reasoning when `USER node` was chosen (D-P5-08's commit) was that 1000 "is the uid a checkout on an ordinary Linux host and on CI already belongs to". That is true of many hosts and false of the one that matters here.
- **Chosen now:** the test harness makes its temporary workspace world-writable before provisioning. That makes the fixture usable and changes nothing about what the assertion requires — the marker must still appear on the host carrying the *container's* hostname, which is the whole of the claim.
- **What is not fixed, and is the real limit:** a runtime that creates a workspace as a uid the image does not run as hands the agent a read-only workspace. The agent then fails to write for a reason nothing in the evidence explains, which is precisely the silent degrade I5 exists to prevent — it would look like a model that chose not to write. Closing it properly means the sandbox spec carrying the user a container runs as, so the provider can match the container to the workspace it was given. That is a contract change in `packages/sandbox`, not a driver change.
- **Why not run the container as root instead:** it removes the problem and removes the property the non-root user buys — a model that rewrites the CLI it is running under is currently refused by the filesystem rather than by trust.
- **Why not chmod in the driver:** the driver does not own the workspace. Something handed it a mount table; widening permissions on a caller's directory is not a driver's decision to make silently.
- **Reverse:** drop the `chmod` and the assertion fails on any host whose uid is not 1000.
- **Promoted to the ledger before P6 starts.** This entry began as prose, which is findable and not counted. `I5.workspace-is-writable-by-the-task` is now a pending registry entry owned by P6, and the I5 baseline rises from 5 to 6 to say so in the diff. The reason is D-P5-01's: a ledger only constrains the work if it is fixed before the work that would edit it, so an obligation written after P6 starts is a description of what P6 did rather than a claim on it.

### D-A-CI-04: the driver's model calls run once, and only for a tree they have not already proven

- **Problem:** CI spent API credit faster than the evidence it bought was worth. D-A-CI-02 accepted a second run of the driver suite inside `pnpm test`, eighteen model calls per CI run rather than nine, and every push to every pull request paid them again for bytes an earlier run had already proven. The credit ran out on 2026-09-24 and every run went red at the driver step.
- **Chosen, part one (087ebfb):** the `Test` step runs every package but the driver, and no longer receives the credential. The step before it already wrote the report; a second pass proved nothing the first did not.
- **Chosen, part two:** the report is cached under the hash the registry recomputes when it reconciles (`packageTreeHash`, over the driver and every workspace package it depends on). A run whose tree hashes the same restores the report and makes no model call; any other run calls the model and caches the report only if the step passed. `scripts/driver-report-key.ts` prints the hash by calling the kit's own function, so the key cannot drift from what the registry checks.
- **Why this is not a skip:** the registry's reconciliation is unchanged. A restored report is refused as `tree-changed` unless it describes the exact bytes being evaluated, and each assertion must still be recorded as passed in it. A wrong cache key costs a model run or a red build, never a green one. The log states when a report was reused and when it was generated.
- **What it gives up, stated:** a green run can now rest on model evidence produced by an earlier run of the same tree rather than by itself. The claim is unchanged — these bytes passed against a real model — but it is no longer "passed in this run". A model-side regression with no change to the tree is not caught until the tree next changes; nothing in CI caught it deliberately before either, since the tests pin behaviour, not the model.
- **Why not run on pushes to `v2` only:** the registry needs the report on every run, so a pull request that skipped the driver would fail from cold. And "only the last push of a pull request" is not an event GitHub can detect.
- **Reverse:** delete the three cache steps and the condition on the driver step.

### D-A-CI-05: a pull request calls the model only once it is labelled ready

- **Problem:** D-A-CI-04 runs the driver suite once per tree, but every push to a pull request is a new tree. A unit pushed ten times paid for ten runs, and only the last one's evidence is merged. D-P12-15's cost log measured a full run at about $0.17 and 139k tokens (2026-09-27), and 2026-09-25's 2.8M tokens on the key was about twenty of them.
- **Chosen:** on a pull request, the driver step runs only when the pull request carries the `run-driver` label, which the maintainer adds when it is ready to merge. Adding the label starts a run (`labeled` is a trigger). A report already cached for the tree is still reused, with or without the label. Pushes to `v2` are unchanged.
- **Why this is not a skip:** without the label and without a cached report, the registry step does not run, and a final step fails the job, naming the tree and the label. Every free step still runs, so an unready pull request gets its typecheck, lint, and test results, and never a green check. The registry's reconciliation is untouched.
- **What it gives up, stated:** a pull request's real-model evidence arrives only at the end, so a change that breaks the driver against the real model is found when the label is added rather than on the push that made it. Until then, the driver's tests that call no model (`driver.test.ts`) still run on every push, with no credential, and the full suite still gates the merge.
- **Reverse:** remove the label condition from the three steps and delete the final step.

### D-A-CI-06: a merge to v2 reuses its pull request's driver report

- **Problem:** GitHub scopes a cache to the ref that saved it, and a push to `v2` cannot see a pull request's cache. So the push that merges a pull request re-ran the whole driver suite for a tree its pull request had just proved, which is one paid run per unit that bought nothing. It was recorded as a candidate in P13's out-of-scope list.
- **Chosen:** a pull request run that executes the driver suite also uploads its report as an artifact named `driver-report-<tree hash>`, kept for 30 days. On a push with no cache hit, CI looks up an unexpired artifact of that name. The run that made it must belong to this repository, not a fork, because a fork's run executes the fork's own workflow file. If one is found, CI restores the report and skips the paid step. The existing cache step then saves the report under `v2`, where later pushes and pull requests can see it. The workflow gains `actions: read`.
- **Why the gate is not weakened:** the registry reconciles the report against the tree it evaluates, exactly as for a cached one, so a report for other bytes is refused as `tree-changed`. A missing or unmatched artifact runs the paid suite as before. A wrong lookup costs a model run or a red build, never a green one. The artifact's trust is the same as the cache's: it is written only by a run of this repository, after the suite passed.
- **Unverified until the first merge:** the lookup filters on the artifact API's `workflow_run.repository_id` and `head_repository_id`. No artifact existed to check them against. If either field is absent, the filter matches nothing and the merge pays, as before this change.
- **Reverse:** delete the `pr-report` and `Keep the driver report for the merge` steps, remove `steps.pr-report.outputs.found` from the paid step's condition, and drop `actions: read`.

### D-A-CI-07: the driver's paid suite is proven in CI, not before shipping

- **Problem:** `ship-unit` stopped on any failing check, and every unit's accept list ran `pnpm --filter @olympus-ai/driver-claude-code test` once, locally. The model credential now exists only as CI's Actions secret (the local key was revoked for spend), so that run refuses on a maintainer's machine before any model call. Any change under `packages/` leaves the driver's recorded report stale, so the registry reports every driver entry `tree-changed`, and no unit that touches `packages/` could ship. Found shipping P7.
- **Chosen:** the driver criterion is met by the pull request's `run-driver` job. Locally, `ship-unit` runs the recursive tests with the driver package excluded, and accepts a failure only when it is the stale report: failing tests are the driver's external registry entries or the two meta-tests that aggregate them, and every problem line they print names the driver's changed tree or a `driver.*` claim left `missing` by it. Any other failure stops the ship. The PR states the criterion as pending CI.
- **Corrected the same day:** the first wording accepted only a stale report (`has changed since its tests ran`). A fresh clone has no report, and a keyless run writes one recording its own refusal (`id-not-run`, `test-failed`), so the exception failed on any machine but the one that last held a key. It now accepts any reconciliation failure of the driver's external entries — every one names the package and cites `I8.external-assertion-execution-reconciled` — since no local driver report is evidence either way.
- **Why the gate is not weakened:** nothing merges on it. WORKFLOW step 7 merges only on green pull request checks, which run the paid suite under `run-driver` and the conformance registry against the fresh report. What moved is where the one paid run happens, not whether a merge needs it. The exception is scoped to failures a stale report produces, so a real regression anywhere else still stops the ship.
- **Reverse:** put a model credential back on the maintainer's machine and delete the exception from `ship-unit` step 2.

### D-A-CI-08: a review bundle may quote CLAUDE.md's reference to the planning directory

- **Problem:** CI refuses any tracked file that names a path under the maintainer-local planning directory, and exempts `CLAUDE.md`, which holds the rule itself. A unit that changes `CLAUDE.md` ships it in its review bundle, byte for byte, and bundles are tracked (`triage-review` step 8). P14's bundle did, and its pull request went red. The bundle cannot be edited: its SHA-256 in the review prompt is the record of what the reviewers were sent.
- **Chosen:** the check also exempts `docs/reviews/*-review-bundle.txt`.
- **Why the gate is not weakened:** a bundle holds only the contents of tracked files at a recorded commit, and each of those files is checked in its own right where it lives, so a reference anywhere but `CLAUDE.md` still fails at its source. The exemption covers a copy of what the check already allows, and nothing else.
- **Reverse:** drop the second pathspec, and have `review-request` leave `CLAUDE.md` out of bundles.
