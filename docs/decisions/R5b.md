# Decisions: R5b

## Amendment: goal decomposition (R5b) gains its spec, and "goal" joins the spine

The maintainer asked on 2026-11-28 for R5b's spec and the spine change for "goal", stopping for confirmation. `docs/plan/R5b-goals.md` is added, the spine's artifact table gains `Goal` with one paragraph under it, and `DECOMPOSITION.md` and `VISION-GAP.md` point at the spec. Every row of the spec's table was checked against the code on `v2` at 147a4dd. D-A-GL-01 to D-A-GL-09 are the session's proposals and wait for the maintainer; merging the amendment is the confirmation. Docs only: the contract amendments the spec names (A-R5b-01 to A-R5b-06) land in R5b's own pull request.

### D-A-GL-01: "goal" is added to the frozen vocabulary now, with its spec

- **Why now:** D-A-GD-07 deferred the term because R5b had no spec, and a frozen term with nothing behind it fixes a meaning nobody checked. This amendment writes the spec in the same change, which is the condition D-A-GD-07 set, and is how readiness was added before R1.
- **Choice:** one row in the spine's artifact table (location Vault) and one paragraph: a goal is not a run, holds no station, has no status of its own, and its children share nothing writable. No station, autonomy level or package is added. The M1 out list already names goal decomposition (M3).
- **Rejected: a second term for the decomposition.** The decomposition is the goal's content, not a separate artifact a reader needs a name for.
- **Reverse:** delete the row and the paragraph, and restore the M1-scope sentence about readiness.

### D-A-GL-02: a goal is its own record, not a run

- **Verified:** every Vault operation is keyed by `RunId` (`packages/vault/src/types.ts:1449-1515`), drafting runs over a run's `LineContext` (`packages/api/src/drafting.ts:227`), and a run's ending is derived for every run in the Vault (`packages/api/src/outcomes.ts:377-388`), which R2's rates read.
- **Options:** (a) a `GoalId` with its own runtime-only Vault records, reusing R19's attempt, critic, floor and lock rules; (b) a goal as a run whose `spec` station drafts the decomposition and that ends there.
- **Chosen: (a).** (b) reuses the most code, but a run that never builds would be counted by every reader of runs: R2's rates, the nightly review, observation, and the benchmark would each see a run that ends at `spec`, and each would need to learn to skip it. A rate that silently counts the wrong population is the failure R2 exists to measure.
- **Reverse:** make the goal a run with a new `RunEnding`, and exclude it in every reader.

### D-A-GL-03: the decomposition holds the child specs themselves

- **Verified:** an intent must be `from: 'principal'` (`packages/api/src/run.ts:196`, refused otherwise at `:630-635`), only the principal's route supplies one (`packages/api/src/http/server.ts:489`), and a candidate supplies none (`run.ts:244`).
- **Options:** (a) the decomposer writes each child's spec, the goal's gate approves them all, and each child is admitted with its spec supplied from the goal's lock; (b) the decomposer writes a brief per child, and each child drafts its spec from it through R19.
- **Chosen: (a).** It matches the entry's rule that the decomposition is approved through the gate for `spec`, and what the gate approves is exactly what each child is held to. (b) admits model-written text as an intent, which today means "a person's text"; widening that would let a model's words take the place a person's hold in every reader of intents, and adds a second gate per child.
- **Cost of the choice, stated:** child specs are approved once, together, rather than each at its own `spec` gate. The spec lists it as a known limit.
- **Reverse:** add a `'goal'` intent source and admit children with `artifacts.spec: 'draft'`.

### D-A-GL-04: children run one at a time, in the locked order

- **Verified:** integration requires the base branch to still point at `baseCommit` when the pull request opens and when it merges (`packages/api/src/integrate.ts:15-17`, `#baseUnmoved` at `:263-268`). Two children built over one base cannot both merge: the second halts at `integrate`.
- **Choice:** the service admits the first child whose dependencies all merged, ties by child id, over the base branch's head at that moment, and the next only after that child's run ends.
- **Rejected: independent children in parallel.** Every pair would end with one halted. Rebasing a verified run onto the moved base would void the evidence the rule protects. Parallel children need that rule amended first, and the spec puts them out of scope.
- **Reverse:** amend integration to re-verify on a moved base, then admit every child whose dependencies merged.

### D-A-GL-05: policy grants decomposition, and admission approves the goal's worst case once

- **Verified:** `worstCaseCost(graph, policy, drafted)` (`packages/api/src/cost.ts:258`) reads no spec bytes, so one child's worst case is known before its spec exists. The approved figure must equal the worst case exactly (`run.ts:1419`).
- **Choice:** `decomposition: { maxSpecs }` in policy, plus `planning` (R5a) and a runtime integrator (`packages/api/src/graph.ts:72`, `:132-135`), or the goal is refused. The person approves decomposer plus critic plus `maxSpecs` children's worst case. Each child is admitted with the per-child term, recomputed and compared at its own admission.
- **Rejected: a person approves each child's cost.** At L2 the goal would stop for a person once per child for a figure fixed at the goal's admission, and an approval nobody needs to think about is one people learn to click through.
- **Rejected: `maxSpecs` on the request.** The same reason as D-A-GD-02: a bound anything building the request can set is not a grant.
- **Reverse:** move `maxSpecs` to the goal request, or require an approval per child.

### D-A-GL-06: a child that does not merge stops its dependents, and only them

- **Choice:** every child that depends on an unmerged child, directly or not, is never started; a child that does not depend on it is still admitted in its turn. This is R4's rule for tasks (a failed task stops its dependents) one level up.
- **Rejected: end the goal at the first unmerged child.** An independent child's spec was approved on its own terms and its run is judged on its own tests; stopping it adds no safety and discards approved work.
- **Reverse:** stop admitting children once any child ends unmerged.

### D-A-GL-07: the goal's status is derived, and no record carries one

- **Verified:** a run's ending is already derived, never stored (`outcomes.ts:28`, `:377-388`).
- **Choice:** `decomposing`, `running`, `merged`, `incomplete`, `rejected`, computed from the goal's records and its children's derived endings. No goal record has a status field.
- **Reverse:** none intended; storing a status would be a second place it could be read from.

### D-A-GL-08: the decomposer has the spec drafter's grants and builds nothing

- **Verified:** the spec drafter is granted `repo-instructions`, `intent` and `base-repo-readonly` and writes `.drafts/**` (`packages/core/src/station/contracts.ts:199`); its critic adds `draft` and `rubric` (`:250`).
- **Choice:** the same grants for the decomposer and its critic, as new seat contracts beside `STATION_CONTRACTS`, with no `DraftStation` value added, since a goal is not a run.
- **Rejected: adding `goal` to `DraftStation`.** Every table keyed by it is a run station's, and a value with no station behind it would be matched by code that assumes one.
- **Reverse:** add the value and key the goal's seats by it.

### D-A-GL-09: children share nothing, and the unit adds no channel between them

- **Verified:** `learn` (R11, M3) has no spec and no implementation.
- **Choice:** a child receives its locked spec from the goal and nothing else. What one child merged reaches the next only as the base it starts from.
- **Rejected: hand a child a summary of the children before it.** It is model-written text from one run steering another's work, which is the shared scratchpad the entry forbids.
- **Order and milestone:** not changed. R5b stays M3. Its dependencies, R4, R5a and R20, have shipped, and the maintainer kept it at M3 on 2026-11-28.
