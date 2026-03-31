# Inception Pipeline — Stage Ordering Explained

## Pipeline Flow

```
Intent (bootstrap: interview + intent.md)
  → Workspace Detection (always, auto)
  → Reverse Engineering (brownfield only)
  → Requirements Analysis (always)
  → Workflow Planning (always)
  → Units Generation (conditional)
  → User Stories (conditional)
  → Bolt Planning (conditional)
  → Mode Selection (always)
```

## Stage-by-Stage Breakdown

### Workspace Detection (stage 1 — always, auto-proceeds)

**What it does:** Scans the workspace for existing source code files, build systems, and project structure. Determines whether this is a **greenfield** (empty workspace) or **brownfield** (existing code) project, records the programming languages, build system, and project structure, then creates the initial `aidlc-state.md` tracking file. It also checks for existing AI-DLC workflows — if a prior workflow exists, it resumes that instead of starting fresh.

**Why it's here:** This is the very first stage because every subsequent decision depends on the answer to one question: *is there existing code?* If yes, the pipeline routes through Reverse Engineering to map the codebase before asking requirements questions. If no, it skips straight to Requirements Analysis. Workspace Detection also sets the `brownfield` flag and `pathway_type` that Workflow Planning later uses to determine which stages to skip. It's the only stage with **no user approval gate** — it auto-proceeds because it's purely informational and makes no decisions the user needs to review.

**Think of it as:** The surveyor arriving at the construction site — before anyone draws blueprints, you need to know if you're building on an empty lot or renovating an existing structure.

---

### Reverse Engineering (stage 2 — brownfield only)

**What it does:** Sends two parallel agents (`explore-medium` + `oracle-medium`) to deeply analyze the existing codebase. Produces 6 artifacts: workspace scan, analysis plan, current-state analysis, regression baseline, change impact analysis, static model, and dynamic model.

**Why it's here:** Everything downstream depends on understanding *what already exists*. Requirements Analysis needs to know the current architecture to ask the right clarifying questions — "you want to add auth, but you already have JWT middleware here, do you mean replace it or extend it?" Without this context, the requirements stage would operate blind, asking generic questions instead of codebase-informed ones. The rule file makes this explicit: Requirements Analysis Step 1 says "Load Reverse Engineering Context (if available)" and uses those artifacts to shape the entire analysis.

**Think of it as:** Building the map of the territory before planning the route.

---

### Requirements Analysis (stage 3)

**What it does:** Acts as a product owner. Classifies the user's intent (type, scope, complexity), determines requirements depth (minimal/standard/comprehensive), generates clarifying questions, waits for answers, optionally runs a Metis blind-spot analysis, and produces a formal `requirements.md` with coverage verification across 6 areas (functional, non-functional, scenarios, business context, technical context, quality attributes).

**Why it's here:** This is the **information-gathering gate** — it ensures the AI fully understands *what* to build before deciding *how* to build it. It must come after Reverse Engineering because brownfield requirements are shaped by existing constraints. It must come before Workflow Planning because the execution plan depends on knowing the scope, complexity, and requirement types. The rule file explicitly gates: "Do NOT proceed to Step 7 until all questions are answered and validated."

**Think of it as:** The interview that turns a vague ask into a specification with traceable requirement IDs (`FR-001`, etc.) that bolt specs reference later.

---

### Workflow Planning (stage 4)

**What it does:** The orchestrator (no agent delegation — it's meta-planning) loads all prior context, performs detailed scope/impact/risk analysis, then decides which of the remaining stages to **execute vs. skip** — Units Generation, User Stories, Bolt Planning, Functional Design, NFR, Infrastructure Design, etc. Produces `execution-plan.md` with a Mermaid visualization and rationale for every include/skip decision. Also handles mandatory unit registration when Units Generation is skipped.

**Why it's here:** It's the **routing decision point**. The pipeline from here forward is conditional — Units Generation only runs if `depth_score > 12`, User Stories only runs if there are user-facing changes, NFR only if there are performance/security concerns, etc. Workflow Planning needs finalized requirements to make those calls. It also initializes `checkpoint.json` with all construction unit structures, which every downstream stage reads.

**Think of it as:** The project manager who looks at the requirements and says "given this scope, here's the plan — we need X, Y, Z but can skip A and B."

---

### Units Generation (stage 5 — conditional)

**What it does:** Decomposes the system into independently deployable units of work based on domain boundaries. This is a two-part process: Part 1 (Planning) performs domain analysis, identifies bounded contexts, maps every requirement (`FR-N`) to exactly one unit, and runs a Q&A cycle to resolve ambiguities. Part 2 (Generation) delegates to `olympian` to produce `unit-of-work.md`, a dependency matrix, and per-unit briefs. Every unit must pass a 5-criterion independence validation (single responsibility, clear interfaces, no circular dependencies, independent buildability, explicit cross-unit deps) before proceeding.

**Why it's here:** Units define the *architecture* of the work — they carve the system into bounded contexts that can be designed, coded, and tested independently. This must happen after Workflow Planning decides the feature is complex enough to warrant decomposition (`depth_score > 12`). It must happen before User Stories because stories are scoped *per unit* — each unit gets its own `stories/` directory, and stories reference their parent unit ID. Without units defined first, stories would have no structure to attach to.

**Think of it as:** The architect drawing the floor plan — dividing the building into wings before anyone designs the rooms inside each wing.

---

### User Stories (stage 6 — conditional)

**What it does:** Converts requirements into user-centered narratives with acceptance criteria. Acts as a product owner to create personas (`personas.md`) and per-unit story files (`S-NNN-slug.md`) following INVEST criteria (Independent, Negotiable, Valuable, Estimable, Small, Testable). Each story includes a Given/When/Then acceptance criterion, edge cases for must-priority stories, and dependency tracking between stories. Like Units Generation, it's a two-part process: Planning (orchestrator runs Q&A on story approach) then Generation (delegated to `oracle-medium`).

**Why it's here:** Stories bridge the gap between *what the system does* (requirements) and *what a human experiences* (user journeys). They must come after Units Generation because stories are scoped to their parent unit — each story file lives in `inception/units/{UNIT-NNN-slug}/stories/` and its frontmatter links back to the unit. They must come before Bolt Planning because bolts group stories into executable sessions — the bolt planner reads story IDs, priorities, and complexity scores to decide which stories belong in the same implementation pass.

**Think of it as:** Writing the screenplay after the set design is done — you need to know which rooms exist before you can script the scenes that happen in each one.

---

### Bolt Planning (stage 7 — conditional)

**What it does:** The final inception stage. Decomposes each unit's stories into **bolts** — scoped execution packages that a code-generation agent can implement in a focused session. For each story, it runs a 4-factor complexity assessment (complexity, uncertainty, dependencies, testing scope). Stories are then grouped into bolts by cohesion and architectural layer (data model → repository → service → API → UI), with dependency analysis at three levels (story, bolt, unit). Each bolt gets a `spec.md` with full frontmatter, acceptance criteria, target files, and a traceability section linking back to requirements and stories. Hard constraints: max 8 bolts per unit, max 50 total, 95% minimum story coverage, 100% must-requirement coverage, no circular dependencies.

**Why it's here:** Bolts are the bridge between inception and construction — they're the last planning artifact and the first thing the construction executor reads. They must come after User Stories because bolts group stories (you can't group what doesn't exist yet). They must be the final inception stage because bolt specs reference *everything* produced earlier: requirement IDs from Requirements Analysis, unit boundaries from Units Generation, and story IDs from User Stories. The bolt spec is essentially the construction agent's work order.

**Think of it as:** The foreman breaking down the architect's floor plan into daily work assignments — "Day 1: pour the foundation for Wing A. Day 2: frame the walls. Day 3: run the plumbing."

---

### Mode Selection (post-pipeline — always)

**What it does:** Compiles a final audit document summarizing all inception stages (timestamps, artifact counts, statuses), then presents the user with 5 execution mode options for construction: `/ascent` (persistent — cannot stop until done), `/olympus` (standard orchestration with gates), `/ultrawork` (maximum intensity, parallel execution), `/ascent` + `/ultrawork` (full power), or manual. The recommendation is computed from `depth_score`, `risk_tier`, number of units, and pathway — multi-unit or high-complexity workflows get `/ascent`, simpler ones get `/olympus`. The checkpoint is saved with `status: "awaiting_mode_selection"`, and the `/plan` skill ends here.

**Why it's here:** This is the **handoff point** between planning and execution. All inception artifacts are locked — requirements, units, stories, and bolt specs are finalized. The only remaining decision is *how aggressively* to execute the plan. Placing it after all stages ensures the recommendation logic has full context (it can't recommend `/ascent` for a multi-unit workflow if units haven't been defined yet). The `/plan` skill terminates at this step; construction begins when the user invokes their chosen mode.

**Think of it as:** The general reviewing the battle plan one final time, then choosing the formation — full charge, disciplined advance, or blitz attack — before giving the order to move.

---

## The Full Dependency Chain

```
Workspace Detection  →  "Is there existing code? What kind of project is this?"
                          ↓ (feeds into)
Reverse Engineering  →  "Here's what exists"
                          ↓ (feeds into)
Requirements Analysis →  "Here's what we need to change/build"
                          ↓ (feeds into)
Workflow Planning     →  "Here's which stages we need to get there"
                          ↓ (feeds into)
Units Generation     →  "Here's how to carve the system into independent pieces"
                          ↓ (feeds into)
User Stories         →  "Here's what each piece looks like from the user's perspective"
                          ↓ (feeds into)
Bolt Planning        →  "Here's the day-by-day work orders for building each piece"
                          ↓ (feeds into)
Mode Selection       →  "Here's how aggressively we execute those work orders"
```

Each stage is consuming the output of the one before it. Moving any of them later would mean the downstream stages operate with incomplete information.
