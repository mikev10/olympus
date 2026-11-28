# Decisions: R8b

## Amendment: R8b's observation plan (D-A-OB-07 resolved)

Drafted on 2026-11-06 against `v2` at bd03b6f, after R8a merged (#100). It
waits for the maintainer's confirmation before R8b builds anything.

### D-A-OB-09: "works" is read from the provider at window close, not delivered by a trigger

- **Found:** the extractor drops every completed check that did not fail
  (`triggers/src/github.ts:145-147`). The window already waits out the
  delivery age before it closes (`api/src/observe.ts:124`, `:218`). The check
  runs on a default-branch commit can be listed. `GET
  /repos/mikev10/olympus/commits/bd03b6f/check-runs` answered 200 with
  `name`, `app.id`, `app.slug`, `conclusion`, `completed_at`, and `head_sha`
  for each run.
- **Chosen:** a provider adapter, a port beside `Integrator` with a GitHub
  client, lists the check runs of each first-parent commit in the window when
  `observe-history` closes it. The plan's signals are judged against that
  list.
- **Rejected:** *A `check-completed` `TriggerKind`.* A delivery that never
  arrives cannot be told from a check that never ran, so a lost success would
  read as `missing` and a lost failure as `working`. The second of those is a
  silent degrade. The kind would also send every check on every commit
  through intake, and it would still need a way to name the check, which no
  payload may carry (D-R22-11).
- **Reverse by:** adding the kind, then reading its records in place of the
  adapter. The plan and its signals stay as they are.

### D-A-OB-10: a plan names a check by app slug and exact name

- **Found:** any GitHub App with checks write access can post a check run
  under any name on a commit, and a check's name is text the CI configuration
  chose.
- **Chosen:** a `CheckRef` is `{ app, name }`. `app` is the producing app's
  slug, in the `identifier` class. `name` is compared with the check run's
  `name` byte for byte. The provider's name is used only for that comparison:
  a record carries the plan's locked name, the check run's id, and its
  conclusion, and never the provider's text. The plan is an artifact the run
  supplies or drafts, never an event payload (I7).
- **Rejected:** *The name alone.* Another app could post a passing check
  under it. *The numeric app id.* No one writing a plan knows it, and slugs
  are unique. *Matching case-insensitively or after trimming.* Two checks
  could then match one name.
- **Reverse by:** widening the match in one function. The stored names stay
  as they are.

### D-A-OB-11: the plan's shape, and how each signal is judged

- **Chosen:** for a `works` check, the latest completed run on the merge
  commit is `working` if it succeeded and `regressed` if it ended in a
  `failure-conclusion`. A `regressed` check is `regressed` if any first-parent
  commit from the merge commit to the closing head has a failing latest run,
  and `working` if none does and at least one succeeded. In every other case,
  including `neutral`, `skipped`, `cancelled`, or no run at all, the check is
  `missing`. The rollback condition is met when every check it names is
  failing on `consecutive` consecutive first-parent commits.
- **Rejected:** *A rollback condition written as free text.* The runtime
  could not evaluate it, and a model would end up deciding the outcome (I2).
- **Reverse by:** changing one judging function. Its inputs are recorded.

### D-A-OB-12: a plan is required exactly when observe is on

- **Chosen:** a policy with `triggers.observe.windowMs` requires
  `artifacts.observationPlan` on every run, and a run whose policy has no
  window is refused if it names a plan. A plan is `'draft'` exactly when the
  tests are, because R19 drafts both at `test-design` under one approval.
- **Rejected:** *An optional plan.* A run without one would close `clean`
  without being observed, which is the silent degrade D-A-BR-02 names.
  *Folding the plan into the acceptance manifest.* That manifest is checks
  the verify step runs (`api/src/run.ts:133-137`), and a plan is never run.
- **Reverse by:** making the field optional. The lock and the reading stay as
  they are.

### D-A-OB-13: a plan-signal sits beside R8a's records, not in its rates

- **Chosen:** `ObservationSignal` gains `plan-signal` (`check`, `role`
  `works` or `regressed`, `status`, `commit`, `checkRun`, `conclusion`, `at`)
  and `rollback-condition-met` (the checks and commits that met it). Both are
  recorded before `window-closed`. R8a's rates do not count them. R2 reports
  per run how many signals were working, regressed, or missing.
- **Rejected:** *Counting a regressed plan signal as a change failure.* That
  would change R8a's definition and its baseline, which has no plan to judge.
- **Reverse by:** an R2 change that counts them. The records carry what it
  needs.

### D-A-OB-14: an unreadable provider keeps the window open

- **Chosen:** a failed read of any commit in the range records a
  `provider-unreadable` refusal in the walk's record and leaves that run's
  window open, so the run stays `observing` and the next walk retries. The
  adapter takes its own read-only token, never the integrator's merge token.
- **Rejected:** *Closing the window with the checks marked `missing`.* An
  outage would then read as an uninstrumented change. *Reusing the merge
  token.* A read would then carry write access it does not need (I4).
- **Open, and not verifiable from here:** whether a fine-grained personal
  access token can read check runs on a private repository. GitHub's
  fine-grained permission table lists no Checks permission. The probe above
  used a classic token with `repo` scope. The adapter treats a 403 as
  `provider-unreadable` either way, so a token that cannot read fails closed.
  It is never read as `missing`.
- **Reverse by:** none intended.

## R8b: The observation plan

### D-R8b-01: the boundary R8b was started on

- **Unit:** R8b, the observation plan (`docs/plan/R8-observe.md`, as amended
  by #101, D-A-OB-09 to D-A-OB-14). Depends on R8a (#100, `reviewed/R8a`) and
  R19 (#64, `reviewed/R19`), both merged into `v2`.
- **Deliverables:**
  - `artifacts.observationPlan` on the run request, a path or `'draft'`,
    validated at admission, required exactly while the policy names
    `triggers.observe.windowMs`, and refused otherwise (D-A-OB-12);
  - a supplied plan is locked at `test-design` in the same `lockAdmitted`
    call as the tests and re-verified with every locked artifact; a drafted
    plan is written by the test drafter at `.drafts/<run>/observation.json`
    and locked with the approved draft;
  - a `CheckReader` port and a `GitHubCheckReader` beside `Integrator`, with
    its own read-only token (`FACTORY_CHECKS_TOKEN`);
  - at window close, `observe-history` judges each planned check `working`,
    `regressed`, or `missing`, records a `plan-signal` per check and
    `rollback-condition-met` when the condition holds, and only then closes
    the window. An unreadable plan or provider is a refusal, and the window
    stays open (D-A-OB-13, D-A-OB-14);
  - R2's run view counts each run's plan signals by status.
- **Out of scope (verbatim from the amended spec):** signals other than
  checks (metrics, logs, traces, and commit statuses); Olympus instrumenting
  the target or running a check; acting on a rollback condition; a
  `TriggerKind` for completed checks or any change to `ci-failure`; any
  change to R8a's rates; a plan on a baseline change; check names in any
  event payload or field schema.
- **Acceptance:** `pnpm typecheck`, `pnpm lint`, `pnpm conformance`, and
  `pnpm test` pass, and the report names one assertion for each of the eight
  bullets under R8b's "Conformance and acceptance", each of which fails when
  its check is deleted.
- **Invariants touched:** I3, because an agent may not be judged by an
  artifact it can write: the plan is locked before `build` and read only from
  the store. I5, fail closed: a missing plan, an unreadable plan, and an
  unreadable provider are all refusals. I2, the runtime derives status: the
  runtime, never a model, judges each signal. I7, payloads are data: a
  provider's check name is compared and dropped, never stored or prompted.
  D-A-LC-03: no signal starts, reverts, or reopens anything. **Pending
  registry entries owed:** none (`grep -rn "'R8b'" packages/conformance/src`
  finds no match).
- **Assumptions, each verified:**
  - Check runs on a default-branch commit can be listed with `name`,
    `app.slug`, `conclusion`, `completed_at`, and `head_sha`: `gh api
    repos/mikev10/olympus/commits/bd03b6f/check-runs` answered 200.
  - The admission record is in the store, write-once, and reachable from run
    state (`run.ts:1131-1133`, `local/vault.ts:871-888`), so observe can read
    a supplied plan without the workspace.
  - A drafted plan's bytes are in the store: `DraftRecord.files[].base64`
    (`vault/src/types.ts:454-472`), reached through
    `RunState.drafts['test-design'].locked` (`core/src/run/types.ts:230-233`)
    and `DraftLockRecord.draft` (`vault/src/types.ts:514-522`).
  - The test-design lock takes a list of paths and refuses a path locked
    twice (`line.ts:432`, `local/vault.ts:805-815`), so the plan joins that
    one call.
  - A test draft's paths are chosen by one predicate, and every other path is
    discarded unread (`drafting.ts:505`, `:544`).
  - `ctx.policy` is on the line context (`line.ts:166`), so the drafter's
    draft rules can see whether observe is on.
  - The walk closes windows in one loop after every reversal is recorded
    (`observe.ts:215-232`), so the plan's reading goes in that loop, before
    the close.
- **Where the code differs from the amended spec:**
  - The spec puts the plan's type beside the run request in `packages/api`.
    The admission record, in `packages/vault`, has to hold it, and vault
    imports nothing from api, so the type lives in `vault/src/types.ts`,
    which is a declared gate path. Its validator stays in api.
  - R8a's conformance seeds a merge with no run state (`registry/observe.ts:110`).
    A real merged run always has one. R8b reads the plan through the run's
    state, so `seedMerge` now seeds an admission and a state too.
- **Choice points:**
  - *A merged run whose state or admission cannot be read.* Chosen: a
    `plan-unreadable` refusal, with the window left open. Rejected: closing it
    as if it had no plan, which would close a planned run unobserved. Reverse
    by changing `planOf` in `observe.ts`.
  - *An admission record with no `observationPlan` field.* Such a record was
    admitted before R8b, when no plan existed, so it is read as `none` and
    closes as R8a closed it. The store is not writable by any agent (I1), so
    an absent field cannot be forged. Reverse: none intended.
  - *A drafted plan when observe is off.* Its path is not part of the draft,
    so it is discarded unread like any other stray path. Rejected: a draft
    problem, which would send a draft back over a file nothing reads.
  - *Which commits a `regressed` check is read on.* Chosen: each first-parent
    commit from the merge commit to the head the walk read. A commit after
    the window's end can be included, by at most one walk's interval, as R8a's
    reversals are. Rejected: cutting the range by commit time, which is
    `committer-claimed` (D-A-OB-06).
  - *Which run of a check counts.* Chosen: the latest completed run per
    commit, ordered by `completed_at`, then by id. The reader lists
    `filter=all` and picks the run itself. Rejected: GitHub's
    `filter=latest`, whose grouping the runtime cannot check.
  - *Reading a plan twice.* A run that already has `plan-signal` records is
    not judged again, so a close that failed after its signals were written
    is finished without duplicating them.
- **Found, not in scope:** the test drafter sees only the locked spec
  (`roles/test-drafter.md`), so a drafted plan can name only checks the spec
  states. A plan that names checks the target does not run reads `missing`,
  which is visible, never silent. Telling the drafter which checks the
  target's CI runs is a contract question for a later amendment. It goes in
  the PR body as an issue.

### D-R8b-02: what the build decided that D-R8b-01 did not

- **The admission record holds the plan, parsed.** `AdmissionRecord.artifacts`
  gains `observationPlan`, `AdmittedPlan`, in `vault/src/types.ts`, the gate
  path the amendment declared. A supplied plan's content is recorded there, so
  the walk never reads the workspace. Its bytes are still hashed, locked at
  `test-design`, and re-verified like every other artifact.
- **A plan problem is a request problem.** The parser reports
  `RequestProblem`s, with one new code, `invalid-plan`. Admission returns
  them, and a test draft records their paths and codes, as it does a
  manifest's. Rejected: a separate problem type, which would need a second
  path through admission and drafting.
- **Two refusal causes.** `NightlyRefusal` gains the parts `plan` and
  `provider` and the causes `plan-unreadable` and `provider-unreadable`
  (D-A-OB-14). A refusal makes the walk's record `refused`, as R8a's history
  refusals do, while every window that could be closed still closes.
- **R2's reading.** `ObservedSafety.plans` holds each read run's counts of
  working, regressed, and missing checks, and whether the rollback condition
  was met. It enters no rate (D-A-OB-13).
- **The reader picks the deciding run itself.** It lists `filter=all`, and a
  page count that does not reach the total, a run on another commit, or an id
  listed twice is thrown, never trimmed. An error carries the status and
  never the body, so the token cannot leak through one.
- **The check is verified, not trusted.** Each R8b assertion was run with its
  check removed: the window rule, the plan's place in the lock call, the
  app-and-name comparison, the refusal that keeps a window open, the missing
  plan in a draft, and the consecutive count. Each failed and was restored.

### D-R8b-03: what the external review changed, and what it left

- **Fixed (codex-1, gemini-1):** a plan's reading is complete only when every
  planned check has its signal. A met rollback condition is recorded before
  any signal, and a part-done reading is finished, never taken as done.
- **Fixed (codex-3):** only a success or a failing conclusion decides a check
  on a commit. A later neutral, skipped, cancelled, or stale run never erases
  a failure.
- **Fixed (codex-4):** every plan signal carries `coverage`: the commits the
  check was read on and the ones a decisive run was reported on.
- **Known limit (codex-2, gemini-2):** a plan names a check, not what it runs.
  A trivial check, or a CI job emptied under a planned name, reads `working`.
  Binding a check to its executed definition means reading the target's
  workflows, which the out-of-scope list leaves out. The test critic and the
  draft's approval stand against a trivial check. Reverse by an amendment
  that pins workflow definitions.
- **Known limit:** two runs of one app and one name on one commit cannot be
  told from a rerun, so the latest decisive one decides.
