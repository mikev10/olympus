# Decisions: R5a

## R5a: Drafting at `plan`

Started on `v2` at ada556a, in a worktree of its own on `unit/r5a`. The
maintainer typed `/start-unit R5`; R5 was split by D-A-GD-01, R5b has no spec
and depends on R5a, so the unit started is R5a. Spec:
`docs/plan/R5-planning.md`. Builds A-R5a-01 to A-R5a-06, which the spec
declares and the amendment's merge confirmed (#245).

### D-R5a-01: boundary, verified

- **Deliverables**, one line each, from the spec:
  - Admission takes `'draft'` for the task graph and records it as
    `{ source: 'drafted', bound }`.
  - Policy gains `planning: { maxBuildTasks, roles }`; a run that drafts its
    graph under a policy without it is refused at admission.
  - Admission's reads of the graph are made over the bound: roles compiled
    and scoped, trigger admitted and narrowed, worst-case cost.
  - `plan` seats `plan.drafter` under `planner` and `plan.critic` under
    `plan-critic`; `DraftingDrivers` names both drivers.
  - The planner writes `.drafts/<run id>/graph.json` over a copy of the base,
    granted the locked spec and the repository's instructions, never the
    intent; the runtime reads that one path and records the bytes it read.
  - A drafted graph holds build tasks only; the runtime derives one review
    task over all of them, and `parseGraph` its security seat.
  - `Task.objective`, required and capped on a drafted build task, given to
    the builder for its own task and the tasks it depends on.
  - Runtime problems send a draft back by path and code.
  - A plan critic, read-only, with the rubric `plan.md`.
  - The gate: the policy's `plan` cell under R19's drafted floor.
  - The lock: approved bytes into the artifact root and the base, the lock
    record, the Vault's lock, and only then the tasks.
  - `planner.md`, `plan-critic.md`, `plan.md`.
  - `POST /runs` takes `'draft'` for the graph; standing and the draft view
    show a `plan` draft; the report shows each task's objective; the CLI
    gains `--draft-plan`.
- **Out of scope**, verbatim from the spec:
  - A goal that becomes several specs, child runs, and a status derived across
    them (R5b).
  - Enforcing `dependencySet`. It stays required by the parser and read by
    nothing. A planner's guess at which files a task will touch is not a bound
    the builder should park against, and R4's conflict check already catches two
    tasks changing one path. Its reader is the distributed scheduler's (M4b).
  - A planner that names review tasks, review seats, or which reviewer covers
    what (R9, R31).
  - Phases, milestones, or a requirements document above the task graph. The
    graph is the plan the line runs; anything above it is R5b's or a front-door
    skill's.
  - A plan reviewed in a pull request by another family (`VISION-GAP.md`, R-B).
    The plan critic is a seat on the line, not a pull-request review.
  - Replanning after a task parks, and any change to a locked graph.
  - `auto` on a drafted graph at L3.
  - A parallelism or tier value the planner sets. Both stay policy's.
  - Keying R2's rates by planner, or scoring a plan's quality (R11).
- **Acceptance:** `pnpm typecheck`, `pnpm lint`, `pnpm test`,
  `pnpm conformance`, `git grep -n "draft-plan" -- packages/cli/src` prints
  the flag, `git ls-files -- .plan/` prints nothing, every package change has
  a changeset. `node scripts/local-check.ts preflight <ids>` after each
  change, the full run once.
- **Invariants touched**, each in words:
  - An agent may not be judged by an artifact it can write (I3). The graph a
    builder is held to is locked before any builder exists, from the bytes
    the runtime read, and the planner, who is on the author's side, does not
    arrange which work is reviewed.
  - What policy does not grant is unavailable (I4). The roles a drafted
    graph may seat and how many tasks it may hold are a person's edit to
    policy. A planner naming any other role is sent back, never seated.
  - A missing check or grant is a refusal (I5). No `planning` in policy, a
    missing planner role, or a graph past its bound refuses or goes back; a
    run never grows past the figure a person approved.
  - A reviewer never shares the author's model family and claims
    independence (I6). The plan critic's grade is derived from the models the
    runtime resolved; a same-family critic satisfies nothing.
  - Untrusted text is data, never instructions (I7). The planner is granted
    the locked spec and never the intent or a trigger's input.
  - The runtime derives status (I2). The graph is static; the planner
    writes no status and no task of it exists before the lock.
  - Every claim has an assertion that fails when the capability is deleted
    (I8): the sixteen entries the spec lists, in
    `packages/conformance/src/registry/planning.ts`.
  - No Greek names in code (I10).
- **Gate paths**, as the spec declares: `packages/core/src/station/types.ts`,
  `packages/core/src/run/types.ts`, `packages/core/src/policy/types.ts`,
  `packages/vault/src/types.ts`, `packages/conformance/`. The pull request
  carries `gate-change`, the squash body `Gate-Change: acknowledged`.
- **Pending registry entries owed:** none name R5a or R5
  (`grep -n "R5" packages/conformance/pending-baseline.json` finds nothing).

### D-R5a-02: assumptions, each verified

- **The dependencies have shipped.** `reviewed/R4`, `reviewed/R19`,
  `reviewed/R20` exist (`git tag -l`).
- **The drafting machinery is keyed by station.** `draftStation`,
  `sendBack`, `toGate`, `conditionsFailed`, `critique`, `lockApproved`
  (`packages/api/src/drafting.ts`) take a `DraftStation` and branch on
  `'spec'` and `'test-design'` only where the two differ: how the draft is
  read, the base run, the tree a seat is handed, the context offered.
  `conditionsFailed` already yields exactly `shape` and
  `independent-critic-clean` for a station that is neither, which is the
  floor the spec gives `plan`.
- **The gate, approval and rejection paths are keyed by
  `isDraftStation`.** The exit in `runLine` (`packages/api/src/line.ts`),
  `approveStation`, `rejectDraft`, `floorAt` and `draftStanding`
  (`packages/api/src/run.ts`) read the floor for any drafting station the
  run drafts at.
- **`nextStep` scans `DRAFT_STATIONS` for a parked seat and a rejected
  last draft** (`packages/core/src/station/machine.ts`), so a `plan` row in
  that table is all a parked planner needs.
- **`plan` is in `LOCKING_STATIONS` already**
  (`packages/core/src/station/contracts.ts`), so locks are re-verified
  leaving it.
- **`parseGraph` is the one reader of a graph's shape**
  (`packages/api/src/validate.ts`): admission, `loadLine`, and nothing else.
  It derives the security seat from each review task, copying its role.
- **A review task's grants are its task's role's scope, its instructions
  the `reviewer` role's** (`review`, `scopeFor`, `line.ts`). So a derived
  review task needs a role that holds a scope at `review`.
- **The review seat's tree never holds the graph.** `reviewView`
  (`line.ts`) copies only the spec, the tests, and the diff's files; the
  `plan` offered to it is dropped by `grantedContext`, since the review
  contract grants no `plan` or `task-graph`.
- **The Vault's draft, critic and lock validators check the station
  against a local set** (`DRAFT_STATIONS`, `packages/vault/src/local/vault.ts`),
  repeated from core. It needs `plan`.
- **The Vault refuses a draft record with no file** (`draftProblem`, same
  file). A drafter that writes nothing therefore halts the run today, at
  `spec` as well. That holds at `plan` too and is stated as a limit
  (D-R5a-05).
- **`Task` is constructed in three places in `packages/`**: `parseGraph`,
  `seatTask` (`machine.ts`), and tests. A new required field reaches all of
  them through the compiler.
- **`DraftingDrivers` is constructed by the host** (`seatedDrivers`,
  `ENDPOINT_SEATS`, `packages/api/src/host/compose.ts`), the benchmark
  (`packages/benchmark/src/critic.ts`), and tests. Two new required seats
  reach all of them through the compiler.
- **A rubric is read as `<station>.md`** (`readRubrics`,
  `packages/api/src/rubrics.ts`), for the stations the run drafts at only,
  so `plan.md` is required exactly when the graph is drafted.
- **No v2 package is published** (recorded under A-R28-02: `npm view
  @olympus-ai/vault` is 404), so no store outside a developer's machine
  holds an admission record in the old `taskGraph` shape. The reader still
  reads the old shape as supplied, as R19 did for its lists.
- **The base holds the locked spec and the acceptance tests when `plan`
  starts**: admission overlays supplied artifacts (`overlayArtifacts`,
  `run.ts`) and each draft lock writes its files (`lockApproved`). The
  planner's tree is a copy of it, which D-A-GD-06 already accepts.

### D-R5a-03: where the code differs from the spec

The spec was checked at 3566c06; `v2` is at ada556a (R58 and a tooling
change since). Its table's line numbers have moved; every row's claim still
holds. What the table does not hold:

- **Two more readers of the graph run before `plan`.** `builderModels`
  (`drafting.ts`) reads the build tasks' roles at `test-design`, for the
  drafter-independent-of-builder condition and the L3 refusal.
  `seatedRoles` (`line.ts`) reads every role the graph names when a declared
  input narrows the run. Neither is one of admission's four reads. Each is
  made over the bound for a run that drafts its graph (D-R5a-04).
- **`toolGrantRefusal` and `likelyCost` read the worst case's task list**
  (`run.ts`), so the bound's worst case must list every role the planner may
  choose, or a tool grant on a cheaper allowed role would go unchecked.
- **`LineContext.graph` is not nullable** and `loadLine` parses the graph on
  every approval and rejection, before `plan` as well.
- **The host names six seats** (`ENDPOINT_SEATS`); the spec's "names both
  drivers" needs two more there, or no real run could seat a planner.
- **`JUDGING_ROLES`** (`packages/api/src/nightly-review.ts`) lists each
  critic by role. A plan critic left out would be counted as an author.
- **`retrySuffix`** refuses notes anywhere but `spec` (`machine.ts`); the
  spec gives `plan` notes "as at `spec`".

None changes the unit's scope, deliverables, or acceptance criteria: each is
a place the declared deliverables land.

### D-R5a-04: choices

- **The draft is a graph in the supplied shape, held to build tasks.**
  `{ "tasks": [{ id, station: "build", role, dependsOn, dependencySet,
  objective }] }`. The runtime appends one review task and hands the result
  to `parseGraph`, so every rule a supplied graph is held to is held to it.
  *Rejected:* a second schema without `station`; the spec's "a draft that
  names a review task is sent back" needs the field, and two schemas for
  one artifact would drift. *Reverse:* accept a missing `station` as build.
- **The derived review task is `review`, under the `reviewer` role, with
  `dependencySet: ['**']`.** The id is reserved in a draft (`reserved`), as
  `review.security` already is by its suffix. `reviewer` is the role every
  review seat's instructions come from, and admission requires its scope at
  `review` for a drafting run. *Rejected:* a role from `planning.roles`;
  those are build roles, validated as not reviewing. *Reverse:* a
  `planning.reviewRole` key in policy.
- **The locked file is the planner's bytes; the review task is derived on
  every read.** The hash a person approved is the hash locked and the hash
  a resume checks. *Rejected:* locking the derived graph; the bytes locked
  would not be the bytes read, and the approval would name a hash of
  something the person did not see.
- **Before the lock the line holds no graph, as `null`.** A reader past
  `plan` that finds none throws. *Rejected:* an empty graph. `nextStep`
  finishes `build` and `verify` on an empty list, so an empty graph that
  reached `build` would walk to `integrate` with nothing built; absence
  must be a state the type makes explicit. `nextStep` is given an empty
  graph only while the run is at or before `plan`, where it reads tasks
  for parks alone. *Reverse:* none needed; this is internal to `api`.
- **The bound's worst case lists `maxBuildTasks` tasks under the costliest
  allowed role, and the tool-grant check reads every allowed role.**
  Costliest is by `budget.maxCostUsd`, since every build task makes the
  same number of calls. The line recomputes the figure from the pinned
  policy and the recorded bound and compares the locked graph's own worst
  case with it before the lock; above it, the drive throws and the run
  halts, since no draft the checks passed can get there.
- **The bound is read from the admission record, not the live policy.**
  The record pins both; the bound in `artifacts.taskGraph` is what the
  person approved the figure for.
- **`builderModels` and `seatedRoles` read the bound's roles for a run that
  drafts its graph, before and after the lock.** A superset of what the
  locked graph names, so the test drafter's independence and a narrowing
  cover every builder the planner could seat, and neither changes when the
  graph locks. *Rejected:* the locked graph's roles after the lock; the
  `test-design` condition was already judged against the bound.
- **A planner or plan critic granted egress is refused at admission**,
  as the test drafter is. The spec says "no egress beyond the model relay";
  a refusal of the policy is what makes that hold whatever the role file
  says. *Reverse:* drop the check.
- **Policy validation also refuses a role listed twice in
  `planning.roles`.** The spec names four refusals; a duplicate is a typo
  that changes nothing, and refusing it keeps the list a set.
- **An objective is at most 2048 bytes of UTF-8 and not blank**, on any
  graph that states one. A builder is given at most its own and its direct
  dependencies', so its context grows by a bounded amount per edge.
  *Reverse:* change `OBJECTIVE_MAX_BYTES`.
- **"The tasks it depends on" is the task's own `dependsOn`, not the
  closure.** The closure would hand the last task every objective, which is
  the plan. *Reverse:* walk the edges.
- **A rejection at `plan` carries notes, as at `spec`.** The planner has
  read the repository already, so the black-box reason for a fixed set at
  `test-design` does not apply.
- **`plan-critic` joins `JUDGING_ROLES`.** *Rejected:* leaving nightly
  review as it is; the set's own comment says a call under a judging role
  is never an author.
- **The host gains the seats `planner` and `planCritic`** in
  `ENDPOINT_SEATS`, filled as the other drafting seats are.

### D-R5a-05: known limits

- A planner that writes no `graph.json` halts the run rather than going
  back, because the Vault refuses a draft record with no file. This is
  R19's behaviour at every drafting station. Changing it is a change to
  what the Vault accepts and is not this unit's.
- A supplied graph's file is in a builder's tree, as it was before this
  unit, so a builder that opens it reads any objective the person wrote
  there. A drafted graph's locked file is left out of every builder's tree
  (D-R5a-10).
- The spec's own two: the runtime checks shape and bound, not whether the
  plan is good; an objective is model-written text in a builder's context,
  approved with the graph and bounded in size.

### D-R5a-06: choices made while building

- **`PolicyDocument.planning` accepts `null` as well as absent.** A-R5a-02
  writes it as optional. A resolved policy is what an admission record pins,
  and a resume validates that record's policy as a document before running
  under it (`checkedPolicy`, `packages/api/src/run.ts`). The resolved form
  spells "no grant" as `null`, so a validator that refused `null` would
  refuse every resume. `null` grants nothing, exactly as absent does.
  *Reverse:* resolve to an absent key, which the amendment's "never
  undefined" rules out.
- **`RequestProblemCode` gains `objective-empty` and `objective-too-long`.**
  `parseGraph` reports through a closed set of codes, and the two are named
  for the field so a planner's retry line says which rule it broke. A
  drafted graph's own codes (`objective-missing`, `role-not-granted`,
  `over-bound`, `not-a-build-task`) are `planning.ts`'s, and reach the
  planner the same way.
- **The planner's request states its bound.** The line a drafter's request
  opens with names where to write; at `plan` it also says how many build
  tasks and which roles. Both are policy's numbers, written by the runtime,
  and a planner told neither would learn them only by being sent back.
- **The report reads a task's objective from the Vault alone.** A drafted
  graph's bytes are in its draft record; a supplied graph's file is in the
  artifact root and nowhere in the Vault. The report's rule is that it is
  read from the Vault, so a supplied graph's tasks report `null`.
  *Rejected:* re-reading the file from the artifact root. The report would
  then show text the Vault cannot vouch for. *Reverse:* read and hash-check
  the supplied file, as `loadLine` does.
- **A planner or plan critic granted egress is refused as
  `not-applicable`**, at `policy.roles.<role>.network.egress`. The existing
  code for the test seats, `not-black-box`, names a rule that is not the
  planner's.
- **`examples/rubrics/plan.md` is added, and nothing else under
  `examples/`.** A test holds `examples/rubrics` to the shipped rubrics byte
  for byte, so the rubric is mirrored. The example policy grants no
  planning and the example roles hold no planner: what the example run
  grants is R36b's `init` and the README's first run, which name a graph
  file. The README says how to grant it. Shipping the grant in the example
  is filed as an issue rather than done here.

- **The plan critic's results join the rates R2 keeps by independence
  grade, as every critic's do** (`packages/api/src/outcomes.ts` reads every
  station in `state.drafts`). No rate is keyed by planner, which stays out
  of scope.

### D-R5a-07: what the code did that the record above did not expect

- **`rejectDraft` branched on `station === 'spec'`** and so refused notes at
  `plan` with `test-design`'s message. Found by
  `I5.drafted-graph-shape-goes-back` on its first run, fixed, and the branch
  is now `station !== 'test-design'`.
- **`ReviewSeat.authors` holds identities, not tasks.** Two build tasks
  built by one identity are one author, so the count does not show that a
  review covers both. `I3.runtime-derives-the-review-of-a-drafted-graph`
  reads the evidence each seat was handed, by task id, instead.

### D-R5a-08: what proves it, each shown failing

Sixteen entries in `packages/conformance/src/registry/planning.ts`, the
sixteen the spec lists, each over the real admission and line, the
filesystem Vault, and stub drivers. Each was run against a build with the
one thing it guards removed, and each failed; the tree was restored after
every run.

| Entry | Removed | It failed with |
|---|---|---|
| `I5.drafted-plan-needs-a-policy-grant` | the refusal of a drafted graph under no `planning` | the run refused as `invalid-request`, not `policy-refused` at `plan` |
| `I4.drafted-graph-seats-only-granted-roles` | the check of a role against the bound | attempt 1 not sent back |
| `I5.worst-case-covers-a-drafted-graph` | the costliest role, replaced by the cheapest | a cheaper graph's figure no longer below the bound's |
| `I3.drafted-graph-locks-nothing-until-approved` | tasks created when the draft reached the gate | tasks existing before approval |
| `I3.locked-graph-is-the-bytes-read` | the artifact root written from the planner's tree | a tamper at the lock |
| `I3.runtime-derives-the-review-of-a-drafted-graph` | the refusal of a drafted review task | the draft not sent back for it |
| `I3.objective-reaches-the-builder-never-the-reviewer` | the own-and-dependencies filter | a builder given another task's objective |
| `I4.plan-draft-outside-the-grant-is-discarded` | the record of what was discarded | a stray path in no record |
| `I7.planner-is-not-granted-the-intent` | nothing; the intent was added to the planner's context | the planner's context holding the intent |
| the same entry, its egress half | the refusal of a planner granted egress | a run whose planner holds egress admitted |
| `I5.drafted-graph-shape-goes-back` | the missing-objective check | attempt 1 not sent back |
| `I4.plan-exit-floor` | the critic condition at `plan` | a draft with a finding recording no failed condition |
| `I6.plan-critic-of-planner-family-is-advisory` | the binding test on a critic's finding | an advisory finding sending the graph back |
| `I5.plan-lock-survives-a-stop` | `plan` from the artifact-root settle | a tamper on resume |
| `I5.drafted-plan-needs-its-roles` | the planner seats from the roles admission needs | a run with no compiled planner admitted |
| `I3.supplied-graph-seats-no-planner` | the drafted test at `plan` | a supplied graph seating a planner, which throws for want of a bound |
| `I4.parallel-tasks-of-a-drafted-graph` | the drafted tasks' dependencies | the dependent task starting before the two it needs had passed |

Unit tests beside them: the planning grant's validation and resolution and
the `plan` rows (`packages/core/test`), the drafted-graph parser, the bound's
graph, the objective rules and the `task-graph` grant
(`packages/api/test/planning.test.ts`), and `--draft-plan`
(`packages/cli/test/help.test.ts`).

### D-R5a-09: two existing entries' fixtures, corrected

The full local check failed two entries the unit did not write. Neither
showed a change in behaviour; each fixture assumed the six seats and eight
roles that existed before.

- **`I5.broken-role-entry-refuses-admission`** wrote a misnamed role file
  as `Planner.md`. Beside the shipped `planner.md`, on a filesystem that
  ignores case, that write lands on the shipped file and no misnamed entry
  exists. The fixture's file is now `Scheduler.md`. The check is unchanged:
  a name that is not a role id refuses admission as `invalid-name`.
- **`I7.bug-fix-run-sends-no-report-text`** required every drafting driver
  to have been called before reading what each was sent. Its run is
  admitted with a graph file, so its planner and plan critic are never
  seated. It now requires that those two were not called, and that every
  other seat was. Nothing it reads of the seats that ran is loosened.

### D-R5a-10: external review, what was fixed and what was rejected

Triage: `docs/reviews/2026-11-26-R5a-drafting-at-plan-triage.md`. Three
findings, none raised by both families.

- **Fixed (codex-1): a drafted graph's locked file is left out of every
  builder's tree.** D-R5a-05 first recorded the file in a builder's tree as a
  limit, on the ground that a supplied graph file is there too. The review
  showed the ground does not carry: the objective filter in the
  `task-graph` grant was then a filter a file read defeats. `build` now
  omits the path from both copies, as a withheld path is omitted, and
  `I3.objective-reaches-the-builder-never-the-reviewer` reads each
  builder's tree; it failed against the code as reviewed. *Rejected:*
  keeping the graph out of the base, which the spec's lock writes it into;
  and dropping the filter. *Reverse:* remove the two lines in `build`.
- **Rejected (gemini-1): the costliest role is not the costliest.** The
  worst case is a call count, the same for every build task, times
  `budget.maxCostUsd`. Tier and escalation enter neither, and the case the
  finding describes was run and cost less than the bound's figure.
- **Rejected (gemini-2): the review seat is offered `plan` and
  `author-narrative` and gets neither.** Deliberate, on `v2` before this
  unit, and what `I6.reviewer-receives-no-author-material` depends on.


### D-R5a-11: the maintainer's answers at the merge gate

Given on 2026-11-26, after the triage report.

- **`PolicyDocument.planning` accepting `null` (D-R5a-06) is accepted** as
  the form A-R5a-02 takes. Without it a resume of any run admitted under a
  policy with no planning would refuse its own pinned policy.
- **#256 stays open.** Whether the example policy grants planning and
  `init` prints `--draft-plan` is decided after R5a has run once on the
  canary.
