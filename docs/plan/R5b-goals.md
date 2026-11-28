# R5b — Goal decomposition

**Unit:** R5b (M3, maintainer)
**Depends on:** R5a Drafting at `plan`, R4 Parallel task execution, R20 Role compiler
**Blocks:** nothing named yet.

Today a run starts from one spec. This unit adds the level above it: a goal,
a person's statement of an outcome too large for one spec. A seat proposes
the specs it decomposes into and the order between them. The proposal goes
through the policy's gate for `spec` and is locked before any child run
starts. Each child run is then admitted with its spec supplied from that
lock, drafts its own tests (R19) and its own task graph (R5a), and goes
through the full line as a run of its own. The goal's status is derived from
its children's endings, never written.

The amendment that wrote this spec added "goal" to the spine's frozen
vocabulary (D-A-GL-01), as D-A-GD-07 left it to do. Its choices are
D-A-GL-02 to D-A-GL-09 in `docs/decisions/R5b.md`.

Checked against the code on `v2` at 147a4dd.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| A run has no parent | `core/src/run/types.ts:55`, `Run`; `TriggerLineage` (`:44`) is a trigger chain, not a goal | nothing can say a run belongs to a goal |
| Every Vault operation is keyed by a run | `vault/src/types.ts:1449-1515`, `Vault`: `lock(runId, …)`, `recordDraft`, `recordDraftLock`, `readLocks(runId)` | a goal's draft, lock and children need operations of their own; I1's closed set gains them by name |
| Drafting is run machinery | `api/src/drafting.ts:227`, `draftStation(ctx: LineContext, station)`; `:963`, `lockApproved`; state in `RunState.drafts` (`core/src/run/types.ts:347`) | the attempt, critic, floor and lock rules exist once, over a run's context |
| An intent is the principal's text and nothing else's | `api/src/run.ts:196`, `from: 'principal'`; refused otherwise at `:630-635`; a candidate supplies none (`:244`); only the principal's route supplies one (`http/server.ts:489`) | model-written text cannot be admitted as a child's intent without changing what an intent is |
| The intent is capped | `run.ts:672`, `INTENT_MAX_BYTES = 32 * 1024` | a goal's statement fits the same cap |
| The spec drafter's grants | `core/src/station/contracts.ts:199`, `repo-instructions`, `intent`, `base-repo-readonly`, writes `.drafts/**`; its critic's at `:250` adds `draft`, `rubric` | the grants a decomposer needs already exist |
| A supplied spec is files in the workspace | `run.ts:144`, `RequestedArtifacts.spec: readonly string[] \| 'draft'`; admitted as `{ source: 'supplied', files }` (`:1616`) | a child's spec must come from the goal's lock, not from a path an agent could have written |
| The worst case depends on policy, graph and drafted stations only | `api/src/cost.ts:258`, `worstCaseCost(graph, policy, drafted)` | a child's worst case is known before its spec exists, so a goal's is known at admission |
| The approved figure must equal the worst case exactly | `run.ts:1419` (D-P9-03) | a child admitted by the runtime needs a figure the person already approved |
| Integration refuses a moved base | `api/src/integrate.ts:15-17`, `:263-268`, `#baseUnmoved`: the base branch must still point at `baseCommit` when the pull request opens and merges | two child runs built over one base cannot both merge; the second is void by the existing rule |
| Without an integrator nothing merges at runtime | `api/src/graph.ts:72`, `integrator: Integrator \| null`; `:132-135`, no run above L1 without one | a child that depends on another needs its merge, which only the runtime's integrator records |
| A run's ending is derived | `api/src/outcomes.ts:28`, `RunEnding`; derived at `:377-388` from integration records, cancellation, halt, the spent `integrate` grant, and parks | a goal's status can be a function of its children's endings |
| The service drives runs | `api/src/http/server.ts:345-400`, the tracked runs and `drive`; `POST` admits and drives at `:500` | the coordinator that starts the next child is the service's, never a CLI loop |
| `learn` has no implementation | `DECOMPOSITION.md`, R11 Learning loop (M3), no spec | nothing a child learns can reach another child yet, and this unit adds no way |

---

## Deliverables

- **A goal is admitted.** `POST /goals` takes the principal's statement of the
  goal, as an intent is taken (`{ text, from: 'principal' }`, the intent's
  cap), the base commit, the requested level, and the approved cost. Only the
  principal's route takes one; no trigger and no candidate admits a goal. The
  runtime records a goal admission: a `GoalId`, the policy and roles as
  resolved, the intent, the base commit, and the bound. It holds no status.
- **Policy grants decomposition, or the goal is refused.** Policy gains
  `decomposition: { maxSpecs }`. A goal also needs `planning` (R5a), since
  every child drafts its graph, and a graph whose integrator is the runtime's,
  since a child that depends on another starts from its merge. A policy or a
  graph without any of the three refuses the goal at admission, before any
  driver call.
- **Admission approves the goal's worst case.** The figure is the
  decomposer's and its critic's calls, plus `maxSpecs` times the worst case of
  one child: drafted tests, a drafted graph at the planning bound, one review
  task and its security seat. The person approves that figure once. Each child
  is then admitted with the per-child figure, which admission recomputes and
  must find equal; a child whose figure differs is refused, and the goal
  records it.
- **Seats.** A goal seats `goal.decomposer` under the role `decomposer` and
  `goal.critic` under `decomposition-critic`, counted against the goal's
  worst case as R19's seats are against a run's. The decomposer is granted
  the repository's instructions, the goal's intent, and a fresh read-only copy
  of the base, the spec drafter's three grants, with no egress beyond the
  model relay. It writes `.drafts/<goal id>/goal.json` and one spec per child
  under `.drafts/<goal id>/specs/`. The runtime reads those paths, hashes the
  bytes it read, and records the draft. Nothing else it wrote leaves its
  workspace.
- **The decomposition holds the specs themselves.** `goal.json` lists each
  child: an id, a title, its spec file, and the children it depends on. A
  draft that is not JSON, holds a cycle, holds more children than `maxSpecs`
  or none, names a spec file it did not write, or exceeds a spec's or the
  draft's byte cap is sent back with each problem's path and code, as the
  runtime's own findings.
- **The critic and the gate are R19's.** The critic is seated read-only over
  the recorded draft with the decomposer's grants, the draft, and a new
  default rubric `goal.md`, graded against the decomposer as R19's critics
  are; `same-model` seats none. The goal's gate is the policy's cell for
  `spec` at the goal's effective level, under R19's drafted floor: `auto` at
  L2 needs the draft's shape to hold and a clean critic of another family. A
  grant names the draft's hash and attempt. A third attempt sent back goes to
  a person; a person's rejection of the third ends the goal with
  `drafts-rejected`.
- **The lock.** On a passed gate the runtime locks the decomposition and every
  child spec in the Vault against the approved hashes. No seat, the
  decomposer's or any child's, can edit them after it.
- **Children run one at a time, in the locked order.** The service admits the
  first child whose dependencies have all merged, ties broken by child id,
  over the base branch's head at that moment, and admits the next only after
  that child's run ends. A child's spec reaches its run from the goal's lock:
  the runtime writes the locked bytes into the child's artifact root and
  admits them as `{ source: 'goal', goal, child, sha256 }`, and the line locks
  them at `spec` as a supplied spec. Its tests and its graph are drafted. Its
  effective level is computed at its own admission, readiness scan included.
- **A child that does not merge stops its dependents.** A child whose run
  ends anything but `merged` (refused at admission included) leaves every
  child that depends on it, directly or not, unstarted, and the goal records
  why. A child that does not depend on it is still admitted in its turn.
- **The goal's status is derived.** A pure function over the goal's records
  and its children's derived endings: `decomposing` before the lock; `running`
  while a child is open or can still start; `merged` when every child merged;
  `incomplete` when nothing more can start and a child did not merge, naming
  each child's ending; `rejected` when the decomposition was. No record
  carries it.
- **Children share nothing writable.** Each child run is a run as today: its
  own workspace, its own seats, its own Vault records. The goal hands a child
  its locked spec and nothing else.
- **Resume.** A service restarted mid-goal rederives the next child from the
  goal's lock and its children's Vault records and admits nothing twice: a
  child whose run exists is driven or read, never admitted again.
- **Roles and rubric.** `decomposer.md` and `decomposition-critic.md` beside
  the shipped roles; `goal.md` beside the shipped rubrics.
- **The principal's channel.** `POST /goals`, `GET /goals/<id>` (the derived
  status, the draft and its problems, the critic's findings, each child and
  its run), approval and rejection of the draft as at `spec`, and
  cancellation, which cancels the open child and starts no other. The CLI
  gains `olympus goal start`, `goal status`, `goal approve`, `goal reject`,
  and `goal cancel`.

## Contract amendments, landed in this unit's pull request

- **A-R5b-01** `GoalId` and `ChildId`, branded strings. A child's run id is
  derived from both and must name a git branch, as `branchFor` requires.
- **A-R5b-02** `PolicyDocument.decomposition?: { maxSpecs: number }`; the
  resolved `Policy.decomposition` is that or `null`, never undefined.
  Validation refuses zero and a value above a fixed ceiling the unit states.
- **A-R5b-03** Goal records in the Vault: `GoalAdmissionRecord`,
  `GoalDraftRecord`, `GoalCriticRecord`, `GoalLockRecord`, `GoalChildRecord`
  (a child admitted, with its run id, or refused, with the refusal). Each has
  a named operation on `Vault`, refused unless `collectedBy` is `'runtime'`,
  and a reader keyed by `GoalId`. None has a status field.
- **A-R5b-04** `AdmissionRecord.artifacts.spec` gains
  `{ source: 'goal'; goal: GoalId; child: ChildId; sha256: string }`.
- **A-R5b-05** The decomposer's and its critic's seat contracts beside
  `STATION_CONTRACTS` and `CRITIC_CONTRACTS`, with the spec drafter's grants
  and its critic's. `DraftStation` gains no value: a goal is not a run.
- **A-R5b-06** `DraftingDrivers` gains `decomposer` and `decompositionCritic`.

No `RunEnding`, `ParkCause` or `DecisionCause` is added for runs: a child run
ends as any run does.

## Out of scope

- Children running at the same time. Two children over one base cannot both
  merge (`integrate.ts:15-17`), and rebasing a verified run onto a moved base
  voids its evidence. Parallel children need that rule changed first, by
  amendment.
- Anything one child learns reaching another: a summary of a sibling's work,
  its diff, its review findings, or a shared scratchpad. Learning reaches a
  run only as runtime-written Vault data through `learn` (R11).
- A goal from a trigger or an intake candidate. A goal's statement is the
  principal's, as an intent is.
- Replanning: changing a locked decomposition, adding a child after the lock,
  or retrying a child that did not merge. A person starts a new goal.
- Nested goals: a child that is itself a goal.
- A child admitted with a spec, tests or graph a person supplies.
- Phases, milestones, or a requirements document above the goal (`VISION-GAP.md`,
  R-B's review in a pull request included).
- `auto` on a decomposition at L3.
- Rates keyed by goal, or scoring a decomposition's quality (R2, R11).

## Conformance

Each is a registry assertion in `packages/conformance/src/registry/goals.ts`
that fails when the capability it covers is deleted (I8), run over the real
line, the real filesystem Vault, a fake integrator that records merges, and
stub drivers.

- `I5.goal-needs-its-grants`: a goal under a policy with no `decomposition`,
  or no `planning`, or over a graph with no runtime integrator, is refused at
  admission before any driver call.
- `I5.goal-worst-case-covers-its-children`: the admission figure is the
  bound's, it is the figure approval is compared with, and each child's
  admitted figure equals the per-child term.
- `I3.goal-starts-nothing-until-approved`: no child run exists before the
  gate passes, and an approval naming another draft's hash is refused.
- `I3.child-spec-is-the-locked-bytes`: a child's locked spec is the bytes the
  goal locked; a change to a child spec in the goal's draft tree after the
  lock reaches no child.
- `I1.goal-records-are-runtime-only`: each goal operation refuses a record
  whose `collectedBy` is not `'runtime'`, and no goal operation is reachable
  from a workspace.
- `I2.goal-status-is-derived`: no goal record carries a status, and the
  status read back changes only when a child's derived ending does.
- `I5.children-run-one-at-a-time`: with three independent children, no two
  child runs are open at once, and each is admitted over the head the
  previous merge left.
- `I5.unmerged-child-stops-its-dependents`: a child refused, parked,
  cancelled or halted leaves its dependents, direct and transitive, unstarted;
  an independent child is still admitted; the goal reads `incomplete` naming
  each ending.
- `I4.decomposer-is-not-a-builder`: the decomposer's and its critic's
  contexts hold no acceptance test and no task graph, and a file the
  decomposer wrote outside its draft paths is in no record and no tree a
  later seat is handed.
- `I7.goal-intent-is-the-principals`: a goal with an intent not from the
  principal, or one arriving through a trigger or a candidate, is refused;
  no child run is admitted with an intent.
- `I5.goal-draft-shape-goes-back`: a cycle, zero children, more than
  `maxSpecs`, a missing spec file, and a spec over the cap are each sent back
  with their code; the third goes to a person, and a rejected third ends the
  goal `rejected`.
- `I4.goal-exit-floor`: at L2 with `spec:L2` set to `auto`, a draft with a
  critic finding, or with a critic of the decomposer's family, waits for a
  person and records `draft-floor-applied`.
- `I6.decomposition-critic-of-decomposer-family-is-advisory`: a same-family
  critic's clean result never satisfies the floor, and the grade is recorded.
- `I5.goal-resumes-without-admitting-twice`: a service stopped after a child
  was admitted resumes that child's run and admits it no second time; one
  stopped before the lock resumes at the attempt in flight.
- `I3.children-share-no-workspace`: no path one child's seat wrote appears in
  another child's workspace or context, except through the base its merge
  moved.

## Acceptance criteria

```
pnpm typecheck
pnpm lint
pnpm test
pnpm conformance
git grep -n "goal start" -- packages/cli/src
git ls-files -- .plan/
```

Every conformance entry above is present and passes; the `git grep` prints
the command; the last command prints nothing; every package change has a
changeset.

**Gate paths:** `packages/core/src/run/types.ts`,
`packages/core/src/policy/types.ts`, `packages/core/src/station/`,
`packages/vault/src/types.ts`, and `packages/conformance/` are protected, so
the pull request carries the `gate-change` label and the squash body carries
`Gate-Change: acknowledged`.

**Invariants.** No agent writes a goal record; each is a named runtime
operation (I1). The goal's status is a function of its children's derived
endings, and no field anywhere holds one a model wrote (I2). Every child
spec is locked before its run starts, by a seat that builds nothing, and a
child is judged by tests drafted after that lock (I3). The number of
children and the roles they run under are policy's (I4). A missing grant, a
missing integrator, an unmerged dependency, or a figure that differs is a
refusal or an unstarted child, never a degraded run (I5). The critic's grade
is derived from resolved models (I6). The goal's statement is the
principal's, and no model-written text is admitted as an intent (I7).

**Known limits, stated now.** The runtime checks a decomposition's shape and
bound, not whether its specs are the right split: specs that overlap, leave
part of the goal out, or are ordered badly pass the parser, and the critic and
the person at the gate are the only judges of that. A child spec is
model-written text a child is held to, approved once for all children rather
than at each child's own `spec` gate. Children running one at a time make a
goal of `maxSpecs` children take that many full runs end to end.
