# Decisions: I1b

## I1b: Integrate + M1 proof

The maintainer confirmed every choice below on 2026-10-03, before any code was written.

### D-I1b-01: the pull request opens at `integrate`'s work, and the merge follows the human's approval of its exit

- **Ambiguous:** the entry says the runtime "merges it at L2", but `integrate` states `human-required` as its own floor and no policy relaxes it (D-P4-03), so at M1 no run of any level crosses that exit without a human.
- **Chosen:** `integrate`'s work pushes the run's commit and opens the pull request; the human approves the exit with the pull request in front of them; the runtime then merges, before it commits the spent grant that ends the run. A crash between the merge and that commit leaves the grant unspent, and the resume finds the pull request already merged at the same commit and records nothing new.
- **Why:** the approver sees exactly what will merge, and the merge is still the runtime's act from evidence, never an agent's.
- **Reverse:** open and merge both after the approval.

### D-I1b-02: one branch per run, pushed through the GitHub Git Data API, never by `git`

- **Ambiguous:** the entry says "the task's branch"; `integrate` is one station after every task, and the accepted diff is cumulative.
- **Chosen:** one branch per run, `factory/<runId>`, holding one commit: `baseCommit`'s tree with the accepted cumulative diff applied, built from blobs, a tree, and a commit through the REST API. The commit's author and dates are the runtime's and the run's admission time, so a resume rebuilds the same sha. A branch that already exists at another commit is refused, never forced. No `git` executable runs, so no git config is executed at all (D-P8-04).
- **Reverse:** push from a clone the runtime makes; the token would then sit in a credential helper on disk.

### D-I1b-03: the merged tree is the verified tree, or the run halts at `integrate`

- **Ambiguous:** `baseCommit` is the caller's word and was never compared with the base the runtime snapshotted (A-P6-03), and the base branch can move after admission. Either would merge a tree no check ran over.
- **Chosen:** before pushing, every file `baseCommit`'s tree holds is hashed as a git blob from the base snapshot and compared; any difference, a tree entry that is not a blob, or a truncated listing halts the run. The base branch must still point at `baseCommit` when the pull request is opened and when it is merged ("evidence is void if the base moves"), and the merge passes the commit's sha so a head moved in between is refused by GitHub.
- **Known limit:** files the snapshot holds that `baseCommit` does not track (`node_modules`, say) were present when the checks ran and are absent from the merge. They are not compared, because which untracked files are ignored is a `.gitignore` question the runtime does not answer without `git`. An added file is pushed with mode `100644`, since `DiffEntry` carries no mode; a modified file keeps the mode `baseCommit` gave it. D-I1b-14 amends this: the kind, symlink or regular file, is the verified tree's.
- **Reverse:** compare at admission instead, by reading the working copy's `git` state.

### D-I1b-04: a failed push, base check, or merge halts the run

- **Ambiguous:** `StationRefusal` has no integration reason, and adding one is a contract change.
- **Chosen:** an integration failure throws; the service commits it as the run's halt, which the station machine refuses on for good and P14 records as a station refusal (A-P9-02). A transient GitHub error halts too. The run never reports done. An accepted empty change halts at `integrate`'s work, before a human is asked to approve a merge of nothing, so no approved exit stands with no integration record (review fix, codex-4 and gemini-3).
- **Reverse:** add an `integration-failed` reason to `StationRefusal`, so a resume could retry.

### D-I1b-05: the integrator is a slot of the graph, attested like the rest

- **Chosen:** `buildGraph` takes an optional `integrator`. Only a `GitHubIntegrator` is attested; a graph with none, or with any other, declares that it cannot merge, so no run on it goes above L1 — at L0 and L1 the line stops at the passed exit and a human merges (D-A-I1-07's reverse). The integrator names the hosts its remote is reached on, and admission refuses a policy whose egress allowlist names one of them (`reaches-git-remote`), so no sandbox the line provisions can reach the remote.
- **Reverse:** make the integrator required.

### D-I1b-06: the host holds the token, from three variables

`FACTORY_GIT_REPOSITORY` (`owner/name`), `FACTORY_GIT_BASE_BRANCH`, and `FACTORY_GIT_TOKEN`, a fine-grained token scoped to that repository with contents and pull requests read and write. Missing any one stops the host before it listens. The token is held in a private field of the integrator, sent only in the `Authorization` header to the GitHub API, and handed to no sandbox provider.

### D-I1b-07: the per-run report

`GET /runs/:id/report`, printed by `olympus report <runId>`. Every figure is read from the Vault: cost from the usage records (`costTotals`, its bound included); cache-hit rate as cache-read tokens over all input tokens (input, cache read, cache write) of the metered calls, null when there are none; claim/evidence mismatches from each evidence bundle; iterations, retries, and starts per task, grouped by the stations its graph names; gate outcomes per station from the decisions P14 recorded at it and the approvals granted for it; refusals and parks by cause from P14's record; the integration from its records.

### D-I1b-08: the canary's spec and acceptance tests are drafted by Claude and approved by a human

- **Ambiguous:** D-A-I1-03 says a human writes them.
- **Chosen:** Claude drafts them in the session; the maintainer reads and approves them unchanged before admission. The proof says so: the tests come from the build driver's model family, so the run carries no independent-test-design claim, which F1 already withholds at M1.
- **Reverse:** the maintainer writes them.

### D-I1b-09: paid runs are capped at $10 in total

The maintainer set the cap on 2026-10-03 (D-A-I1-08). The relay's per-call budget and the admission's approved worst case bound each run; the session stops before a run whose worst case would carry the total past $10.

## I1b amendments to the contracts

### A-I1b-01: the integration record

`IntegrationRecord`, write-once and content-addressed under the run like a decision, with `Vault.recordIntegration` and `Vault.readIntegration(runId)`, and `'integration'` added to `VaultRefKind`. Two kinds: `opened` (repository, base branch, base commit, branch, commit, pull request number and URL) and `merged` (the same, plus the merge commit). `collectedBy: 'runtime'`, refused otherwise. Reasoned in D-I1b-01: the report and a resume read the merge from the Vault, not from GitHub.

### D-I1b-10: the host names its container user where it has no uids

- **Ambiguous:** the M1 proof runs the host on the maintainer's Windows machine, where `localWorkspaceStore` has no uid to derive the container user from and refuses, as it should, to guess one.
- **Chosen:** `HostConfig.containerUser`, set from `FACTORY_CONTAINER_UID` and `FACTORY_CONTAINER_GID`, both or neither. On a host with uids the store still refuses any user other than the process's own. The maintainer confirmed this on 2026-10-03. The entry point is run with `npx -y tsx@4.23.15` (`pnpm dlx` refuses esbuild's install script), since the repository holds no TypeScript runner and adding one is not this unit's.
- **Reverse:** run the host only on a host with uids.

### D-I1b-11: a sandbox command runs in the workspace

- **Found:** the first M1 proof run (`12088e75-91a3-4633-a455-1ba47441edc3`, $0.29) parked at `verify`: the builder's change was correct, but every check failed with `Cannot find module '/node_modules/typescript/bin/tsc'`. `SandboxProvider.exec` never said where a command runs. The stub runs it in the workspace; `LocalDockerProvider` set no working directory, so a command ran wherever the image left it (`/`). The driver hid the gap by changing directory itself, and every check in the suite was `node -e`, which reads no path.
- **Chosen:** the contract says a command runs with the Workspace as its working directory, and `LocalDockerProvider` starts the container with `--workdir` at the workspace target. `packages/sandbox/test/local.test.ts` asserts it with a target no image uses as its default.
- **Also seen:** the hand check that the canary's acceptance test fails on the base passed for the same wrong reason, an instance of D-A-BF-01's known limit: a check that cannot find its runner fails like one whose assertion fails.
- **Reverse:** none sensible; the alternative is absolute paths in every manifest, which ties a repository to the container's layout.

### D-I1b-12: the proof host runs with Windows Developer Mode

- **Found:** the runtime copies the working copy with its symlinks (`packages/api/src/workspace.ts:189`), which Windows refuses to an unprivileged process unless Developer Mode is on, so admission failed with `EPERM` on `node_modules/.bin`.
- **Chosen:** the M1 proof runs with Developer Mode on. The long-term host on Windows is WSL2, with a start-up check that refuses where a symlink cannot be created: issue #28, outside this unit.

### D-I1b-13: a merge is recorded only over the commit the run was verified over (review fix)

- **Found:** the external review (`docs/reviews/2026-10-03-I1b-merge-m1-proof-triage.md`, codex-1, gemini-1, gemini-2). GitHub's merge endpoint pins the head and not the base, so a push between `#baseUnmoved` and the merge is merged in and was recorded; a pull request found already merged was accepted without any base check; and a pull request's target branch was never read, so one retargeted by a collaborator would merge elsewhere while the record named the configured base.
- **Chosen:** after either merge path, `GitHubIntegrator.merge` reads the merge commit and requires its parents to be exactly the run's `baseCommit` and pushed commit, or throws and the run halts (D-I1b-04). `open` and `merge` refuse a pull request whose base is not the configured branch.
- **Known limit:** a push in the one round-trip between the base check and the merge is still merged in. The run halts and is never recorded merged or reported passed, but the merge is not undone; the message names it for a human to revert.
- **Reverse:** move the base ref by a non-forced fast-forward to the run's commit, which GitHub refuses atomically if the base moved. Not taken: it bypasses the pull request merge, and branch protection that requires pull requests refuses it, which would leave the runtime unable to merge on most real repositories.

### D-I1b-14: the base comparison compares file kind; the executable bit is a known limit (review fix)

- **Found:** the external review (codex-3). A symlink's git blob is its target text, so a tracked symlink and a snapshot regular file of the same text compared equal, and a changed path was pushed with the base's mode, so a regular file over a base symlink became a link.
- **Chosen:** `baseMismatches` requires a `120000` entry to be a symlink in the snapshot and any other blob entry not to be. A changed path is pushed as the kind the verified tree holds; a regular file keeps `100755` where the base had it, else `100644`. This amends D-I1b-03's mode sentence.
- **Known limit:** the executable bit is not compared, and an added file is never `100755`. Comparing it rests on two things not verified in this unit: that the runtime's snapshot preserves mode bits, and that the host reports them (a Windows host, D-I1b-10, does not). Owned by issue #28's host work, where a WSL2 host makes the bits reportable.
- **Reverse:** compare the bit on hosts that report it, and refuse where they do not.

### D-I1b-15: an unfinished run's report includes a live workspace observation (known limit)

- **Found:** the external review (codex-5). `runReport` reads its standing from `runStanding`, which re-hashes the admitted artifacts from the working copy unless the run is cancelled, halted, or past its last exit. A run awaiting approval whose artifact is edited reports `stopped` with `lock-tamper`, a finding the read path returns and does not record.
- **Chosen:** no change in this unit. For a finished run the report is read from the Vault alone, since each of the three short-circuits precedes the re-hash (P9 review, codex-3). For an unfinished run the standing is live by design: lock re-verification is what keeps an admitted artifact from being swapped, and the line refuses on the same finding at its next transition.
- **Known limit:** the report presents that live observation in the same field as recorded facts. Separating them is a change to `RunReport`'s shape, owned by R2, which reads reports across finished runs.
- **Reverse:** persist the observation as a decision before reporting it, which turns a read into a write.

### D-I1b-16: `I9.sandbox-output-is-bounded` passes from P10 to R14

- **Found:** at I1b's close-out, the pending entry D-P8-15 gave to P10, "the next unit to change the provider", still names P10, which shipped without closing it. `dockerCli` still holds a command's whole output in the runtime's process (`packages/sandbox/src/local/docker.ts`).
- **Chosen:** owner R14, by D-P8-15's own rule: R14 owns `I2.relay-bound-to-tier-model`, which is closed by changing the relay in `packages/sandbox`, so it is the next unit to change the provider. The I9 baseline is unchanged. The fix keeps D-P8-15's shape: a byte cap enforced while reading, which kills the command and refuses rather than truncates.
- **Reverse:** a unit of its own for the sandbox's output bound.
