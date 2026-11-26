# R5a — Drafting at `plan`

**Unit:** R5a (M2, maintainer)
**Depends on:** R4 Parallel task execution, R19 Drafting at `spec` and `test-design`, R20 Role compiler
**Blocks:** R5b decomposes a goal into specs, and each child run drafts its own task graph through this unit.

Today the task graph is a file a person writes before the run starts, and
`plan` locks it. A run that drafts its spec and its tests still needs that
file, so it is admitted with a graph that cannot depend on the spec it has
not written yet: one build task. This unit seats a planner at `plan`. It
reads the locked spec and the repository, proposes the build tasks and the
order between them, and the proposal goes through the station's gate and is
locked before any builder is seated. R4 then runs what the graph allows in
parallel.

R5 was one entry that two readings pulled apart: the entry itself described a
goal that becomes several specs, and R19, R20, R4 and `VISION-GAP.md` each
assigned R5 the step from one spec to its task graph. The amendment that
wrote this spec split them (D-A-GD-01 to D-A-GD-07). This is the second reading. The first
is R5b and stays M3.

Checked against the code on `v2` at 3566c06.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| The graph is admitted as one path, always | `api/src/run.ts:161`, `RequestedArtifacts.taskGraph: string`; read and parsed at `:526-548` | nothing can say "drafted", as nothing could for the spec before R19 |
| `plan` is a runtime station | `core/src/station/contracts.ts:188`, `runtimeStation('plan', ['repo-instructions', 'locked-spec', 'base-repo-readonly'])` | it seats nothing; the three grants a planner needs are already the station's, and the acceptance tests are not among them |
| `plan` locks what was admitted and creates the tasks | `api/src/line.ts:487-497` | task status and attempt counts start here, from a graph the line has held since admission |
| A drafter is seated at two stations only | `core/src/station/types.ts:116`, `DraftStation = 'spec' \| 'test-design'`; `contracts.ts`, `DRAFT_STATIONS`, `DRAFT_ROLES`, `CRITIC_CONTRACTS`, `SEAT_TASK_IDS` | each table needs a `plan` row; the machinery under them (`api/src/drafting.ts`: attempts, send-back, critic, gate, `lockApproved`) is keyed by station |
| Drafting drivers are four named seats | `api/src/drafting.ts:96`, `DraftingDrivers` | no planner or plan critic can be seated |
| Admission reads the graph four times before anything runs | `run.ts:817` roles the graph names (`admitRoles`); `:1242` a policy scope for each (`policyRefusal`); `:1256`, `:1263` the scopes a trigger admits and narrows; `:1278` the worst-case cost | a drafted graph does not exist at admission, so each of these needs a bound that holds for any graph the planner may propose |
| The approved cost must equal the worst case exactly | `run.ts:1419`, `req.approvedCostUsd !== worstCase.usd`; `api/src/cost.ts:183` | a person approves one figure at admission. A drafted graph that could exceed it would spend past an approval |
| A task carries no statement of its work | `core/src/run/types.ts:72`, `Task`; the builder is given `id`, `station`, `role`, `dependsOn` of every task (`line.ts:1553`) | with one build task the locked spec is the task. With several, no builder can tell which part is its own |
| `dependencySet` is parsed and read by nothing | required at `api/src/validate.ts:621`, copied at `:659`; no other reader in any package | it bounds no write today. R4's conflict check is the control when two tasks touch one path |
| A graph may name `build` and `review` tasks; every build task must be covered | `validate.ts:589`, `parseGraph`; `:611`; the security seat is derived beside each review task at `:665` | a drafted graph goes through the same parser, so nothing it produces is a shape the line has not run |
| One review task may cover several build tasks | `line.ts:1967`, `reviewed` is every task the review depends on | the runtime can derive a drafted graph's review without a new review shape |
| The review seat is never given the plan | `contracts.ts:22-24`, `REVIEW_FORBIDDEN_GRANTS`; the review contract's grants at `:203` hold no `task-graph` | what the planner wrote cannot reach the seat that reviews the work |
| `Run.graph` is already `TaskGraph \| null`, null before `plan` | `core/src/run/types.ts:62` | the contract expected a graph that arrives at `plan` |
| Shipped roles and rubrics | `packages/compiler/roles/` holds eight, none for planning; `packages/api/rubrics/` holds `spec.md` and `test-design.md` | R20's entry left "R5's planner role" to this unit |
| The CLI's draft flags | `packages/cli/src/cli.ts:67-68`, `--draft-spec`, `--draft-tests` | a third beside them |

---

## Deliverables

- **Admission says the graph is drafted.** `RequestedArtifacts.taskGraph` is a
  path or the literal `'draft'`. The admission record holds it as
  `{ source: 'supplied', … }` or `{ source: 'drafted', bound }`. A drafted graph
  needs a spec, supplied or drafted. Nothing else about a supplied graph
  changes.
- **Policy grants planning, or the run is refused.** Policy gains `planning`:
  the most build tasks a drafted graph may hold and the roles it may seat them
  under. A policy without it refuses a run that drafts its graph, at admission.
  A model choosing which role builds a task is choosing that task's tools,
  egress and budget, so the set it chooses from is a person's edit to policy
  and never the request's or the planner's.
- **Admission checks the bound, not a graph.** The four reads of the graph at
  admission are made over the bound: every role in `planning.roles` must be
  compiled and hold a scope at `build`; a trigger is admitted and narrowed
  against all of them; and the worst-case cost is the planner's and the plan
  critic's calls, plus `maxBuildTasks` build tasks under the costliest allowed
  role, plus one review task and its security seat. That figure is what the
  person approves.
- **Seats.** A drafted `plan` seats `plan.drafter` under the role `planner`
  and `plan.critic` under `plan-critic`, each a task of run state counted as
  R19's seats are. `ComponentGraph.drafting` names both drivers.
- **The planner.** It runs over a fresh copy of the base with the locked spec
  and the repository's instructions, with no egress beyond the model relay,
  and writes `.drafts/<run id>/graph.json`. The runtime reads that one path,
  hashes the bytes it read, and records the draft. Nothing else it wrote
  leaves its workspace. It is not granted the intent or any trigger input.
- **A drafted graph holds build tasks only.** The runtime adds one review
  task covering every build task, and `parseGraph` adds its security seat as
  it does today. The planner is on the author's side of the line, so which
  work is reviewed is not its to arrange. A draft that names a review task is
  sent back.
- **Every drafted build task states its objective.** `Task` gains
  `objective`: what the task delivers, in bounded text. A drafted build task
  without one is sent back. A supplied graph may leave it null. A builder is
  given its own task's objective and those of the tasks it depends on, inside
  the `task-graph` grant and never in its role.
- **Runtime problems.** A draft that is not JSON, that `parseGraph` refuses,
  that holds more build tasks than the bound, names a role outside
  `planning.roles`, omits an objective, or exceeds the objective's byte cap
  is sent back with the problems' paths and codes, as the runtime's own
  findings. The worst case of a graph that passes is never above the approved
  figure, by construction, and the line asserts it before the lock.
- **The critic.** Seated read-only over the recorded draft with the planner's
  grants, the draft, and a new default rubric `plan.md`. Graded against the
  planner as R19's critics are; `same-model` seats none.
- **The gate.** `plan`'s exit uses the policy's cell for `plan` with R19's
  drafted floor: `auto` at L2 needs the draft's shape to hold and a clean
  critic of another family. A grant names the draft's hash and attempt.
  A person rejects with notes, as at `spec`. A third attempt sent back goes to
  a person, and a person's rejection of the third parks the run with
  `drafts-rejected` naming `plan`.
- **The lock.** On a passed gate the runtime writes the approved bytes into
  the artifact root and the base snapshot, records the draft lock, locks the
  path against the approved hash, and only then creates the tasks. A resume
  reads the graph from the lock. Before the lock the run holds no graph and no
  builder can be seated.
- **Roles and rubric.** `planner.md` and `plan-critic.md` beside the shipped
  roles; `plan.md` beside the shipped rubrics.
- **The principal's channel.** `POST /runs` takes `'draft'` for the graph; a
  run's standing shows the drafted graph, its problems, and the critic's
  findings; the report shows each task's objective. The CLI gains
  `--draft-plan`.

## Contract amendments, landed in this unit's pull request

- **A-R5a-01** `RequestedArtifacts.taskGraph` takes `'draft'`.
  `AdmissionRecord.artifacts.taskGraph` becomes
  `{ source: 'supplied'; file } | { source: 'drafted'; bound: { maxBuildTasks; roles } }`.
- **A-R5a-02** `PolicyDocument.planning?: { maxBuildTasks: number; roles: RoleId[] }`;
  the resolved `Policy.planning` is that or `null`, never undefined.
  Validation refuses zero tasks, an empty role list, a role with no scope at
  `build`, and a reviewing role.
- **A-R5a-03** `DraftStation` and `AgentStation` gain `plan`.
  `STATION_CONTRACTS.plan` keeps its three grants, requires `parallelism`,
  writes `.drafts/**`, and allows three iterations. `CRITIC_CONTRACTS`,
  `DRAFT_ROLES`, `DRAFT_STATIONS` and `SEAT_TASK_IDS` gain their `plan` rows.
- **A-R5a-04** `Task.objective: string | null`.
- **A-R5a-05** `DraftingDrivers` gains `planner` and `planCritic`.
- **A-R5a-06** `RunState.drafts`, `recordDraft`, `recordCriticResult` and
  `recordDraftLock` accept `plan`. I1's closed operation set gains no
  operation.

No `DraftCondition`, `ParkCause` or `DecisionCause` is added: the station
uses `shape`, `independent-critic-clean`, `drafts-rejected`, and R19's causes.

## Out of scope

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

## Conformance

Each is a registry assertion in `packages/conformance/src/registry/planning.ts`
that fails when the capability it covers is deleted (I8), run over the real
line, the real filesystem Vault, and stub drivers.

- `I5.drafted-plan-needs-a-policy-grant`: a run that drafts its graph under a
  policy with no `planning` is refused at admission, before any driver call.
- `I4.drafted-graph-seats-only-granted-roles`: a draft naming a role outside
  `planning.roles`, or more build tasks than `maxBuildTasks`, is sent back as
  a runtime problem and no task of it is created.
- `I5.worst-case-covers-a-drafted-graph`: the admission figure is the bound's,
  it is the figure approval is compared with, and a locked graph's own worst
  case is never above it.
- `I3.drafted-graph-locks-nothing-until-approved`: no graph is locked, no task
  exists, and no builder is seated before the gate passes; an approval naming
  another draft's hash is refused.
- `I3.locked-graph-is-the-bytes-read`: the graph the builders run is the bytes
  the runtime hashed, and a change to the file in the artifact root after the
  lock is a tamper record at the next transition.
- `I3.runtime-derives-the-review-of-a-drafted-graph`: a draft naming a review
  task is sent back; the locked graph holds one review task and its security
  seat, covering every build task.
- `I3.objective-reaches-the-builder-never-the-reviewer`: a builder's context
  holds its own objective and its dependencies'; neither review seat's context
  holds any objective or the graph.
- `I4.plan-draft-outside-the-grant-is-discarded`: a file the planner wrote
  anywhere but its graph path is in no record and no tree a later seat is
  handed.
- `I7.planner-is-not-granted-the-intent`: on a run drafted from an intent, the
  planner's context holds the locked spec and not the intent's text.
- `I5.drafted-graph-shape-goes-back`: a cycle, a reserved id, a missing
  objective, and an objective over the cap are each sent back with their code;
  the third goes to a person, and a rejected third parks with `drafts-rejected`
  naming `plan`.
- `I4.plan-exit-floor`: at L2 with `plan:L2` set to `auto`, a draft with a
  critic finding, or with a critic of the planner's family, waits for a person
  and records `draft-floor-applied`.
- `I6.plan-critic-of-planner-family-is-advisory`: a same-family critic's clean
  result never satisfies the floor, and the grade is recorded.
- `I5.plan-lock-survives-a-stop`: a run stopped after the lock resumes with
  the locked graph and drafts nothing; one stopped before it resumes at the
  attempt in flight.
- `I5.drafted-plan-needs-its-roles`: admission refuses a drafting run when
  `planner` or `plan-critic` has no compiled role or no policy scope at `plan`.
- `I3.supplied-graph-seats-no-planner`: a run admitted with a graph file seats
  no planner and locks the file as today.
- `I4.parallel-tasks-of-a-drafted-graph`: two drafted build tasks with no
  dependency between them are built at once under R4's bound, and a third that
  depends on both starts only after both pass.

## Acceptance criteria

```
pnpm typecheck
pnpm lint
pnpm test
pnpm conformance
git grep -n "draft-plan" -- packages/cli/src
git ls-files -- .plan/
```

Every conformance entry above is present and passes; the `git grep` prints
the flag; the last command prints nothing; every package change has a
changeset.

**Gate paths:** `packages/core/src/station/types.ts`,
`packages/core/src/run/types.ts`, `packages/core/src/policy/types.ts`,
`packages/vault/src/types.ts`, and `packages/conformance/` are protected, so
the pull request carries the `gate-change` label and the squash body carries
`Gate-Change: acknowledged`.

**Invariants.** The graph is locked before build and the builder cannot write
it, so the plan a task is held to is not one its agent can change (I3). The
roles a drafted graph may seat are policy's, so a model never grants a scope
(I4). A graph past its bound, or a policy that grants no planning, is a
refusal or a send-back, never a larger run than was approved (I5). The plan
critic's grade is derived from resolved models (I6). The planner reads the
locked spec, never an intent or a payload (I7). No task or goal status is
written by the planner: the graph is static, and status lives in run state as
today (I2).

**Known limits, stated now.** The runtime checks a drafted graph's shape and
bound, not whether it is a good plan: tasks that are too coarse, too fine, or
ordered badly pass the parser, and the critic and the person at the gate are
the only judges of that. An objective is model-written text placed in a
builder's context. It is approved with the graph and bounded in size, and it
cannot change what the builder is judged by, which is the locked tests.
