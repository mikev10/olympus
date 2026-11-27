---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/cli": minor
"@olympus-ai/compiler": minor
"@olympus-ai/benchmark": patch
"@olympus-ai/conformance": minor
---

Drafting at `plan` (R5a, A-R5a-01 to A-R5a-06). A run admitted with `'draft'` for its task graph seats a planner at `plan`, under the role `planner`, with a critic under `plan-critic` and the rubric `plan.md`. The planner reads the locked spec and the repository, never the intent, and writes `.drafts/<run id>/graph.json`: build tasks only, each stating its `objective`. The runtime adds one review task over all of them, and the draft goes through `plan`'s gate under the drafted floor. The approved bytes are locked before any task exists.

- core: `DraftStation` and `AgentStation` gain `plan`, with rows in `STATION_CONTRACTS`, `CRITIC_CONTRACTS`, `DRAFT_ROLES`, `DRAFT_STATIONS` and `SEAT_TASK_IDS`. `Task` gains `objective: string | null`. `PolicyDocument` gains `planning?: { maxBuildTasks, roles }` and the resolved `Policy.planning` is that or `null`; validation refuses zero tasks, an empty or repeated role list, a role with no scope at `build`, and a reviewing role. A rejection at `plan` carries notes, as at `spec`.
- vault: `AdmissionRecord.artifacts.taskGraph` is `{ source: 'supplied', file }` or `{ source: 'drafted', bound }`. A record written before this holds the bare file and is read as supplied. Draft, critic, lock and rubric records accept `plan`.
- api: `RequestedArtifacts.taskGraph` takes `'draft'`, refused under a policy with no `planning`. Admission reads the bound instead of a graph: every allowed role must be compiled, scoped at `build`, and admitted for the trigger, and the worst-case cost is the bound's, which is the figure approval is compared with. `DraftingDrivers` gains `planner` and `planCritic`, and the host's endpoint seats gain both. A builder is given its own task's objective and those of the tasks it depends on. The report shows each drafted task's objective. `parseDraftedGraph`, `boundGraph`, `graphDraftPath`, `taskGraphGrant` and `OBJECTIVE_MAX_BYTES` are exported.
- cli: `create --draft-plan`, in place of `--graph`. `draft <run id> plan` prints the drafted graph.
- compiler: the roles `planner` and `plan-critic` ship beside the others.
- conformance: sixteen entries in `registry/planning.ts`, each shown failing with what it guards removed.
