# V5 Implementation Plan: Rules & Templates

> Companion to `aidlc-v5-architecture.md`. This plan covers ONLY the AIDLC framework rules and templates — not Olympus wiring (TypeScript engine, hooks, skills, agents, installer).

## Approach

1. Rename `resources/` → `_v4-reference/` (read-only reference — ALL files preserved)
2. Create fresh `resources/rules/` and `resources/templates/`
3. Write every file from scratch, pulling content from `_v4-reference/` where it fits the v5 architecture
4. Cross-validate against the architecture doc when done
5. Review ALL remaining `_v4-reference/` files during cross-validation to confirm nothing valuable was missed

**Nothing is permanently dropped.** The `_v4-reference/` directory preserves every v4 file. Files not carried into the new `resources/` are explicitly reviewed in Phase 6 to confirm the decision.

**Checkpoint rule (in AIDLC rules):** Every rule that produces an artifact MUST include a stage checkpoint — the AI presents output, pauses, and waits for human approval before proceeding to the next stage. This is distinct from the 3 formal gates (which are phase-boundary sign-offs). See the "Checkpoint and Gate Model" section in the architecture doc.

**Checkpoint rule (in THIS plan):** After each task is completed (e.g., one rule file written), present the output for user review and approval. Do NOT proceed to the next task until the user approves. This prevents compounding errors — if `process-overview.md` has a problem, every downstream rule that references it will inherit that problem.

**MANDATORY: In-Session Task List.** At the start of each phase, create an in-session task list (using TaskCreate) with all tasks in that phase. Mark each task `in_progress` when starting and `completed` when the user approves it. This provides real-time visual progress tracking and prevents context loss across long phases.

**Source of truth:** `aidlc-v5-architecture.md`
**V4 reference:** `_v4-reference/rules/` and `_v4-reference/templates/`
**Branch:** `aidlc-v5-architecture` (existing)

---

## V4 → V5 Mapping

### Common Rules

| V5 File | V4 Source | Action |
|---------|-----------|--------|
| `core-workflow.md` | `core-workflow.md` | **Rewrite** — this is the compact version installed into CLAUDE.md. Must reflect new two-phase, three-gate architecture. |
| `common/process-overview.md` | `common/process-overview.md` | **Rewrite** — two phases, three gates, new stage list, bolt lifecycle (Plan→Code→Review) |
| `common/terminology.md` | `common/terminology.md` | **Rewrite** — add "mob", "squad", "gate", clarify intent/unit/bolt/story hierarchy, update deprecated terms |
| `common/gate-enforcement.md` | *(new)* | **New** — Gate 1/2/3 definitions, who approves, what's checked, enforcement rules |
| `common/session-continuity.md` | `common/session-continuity.md` | **Adapt** — per-unit resumption, unit-checkpoint awareness |
| `common/content-validation.md` | `common/content-validation.md` | **Adapt** — update artifact name references to v5 names |
| `common/markdown-formatting.md` | `common/markdown-formatting.md` | **Keep** — general purpose, no v5-specific changes |
| `common/error-handling.md` | `common/error-handling.md` | **Adapt** — update stage name references |
| `common/overconfidence-prevention.md` | `common/overconfidence-prevention.md` | **Adapt** — AI behavioral guardrail, applies across all stages |
| `common/ascii-diagram-standards.md` | `common/ascii-diagram-standards.md` | **Adapt** — artifact quality standard, applies across all stages |
| `common/question-format-guide.md` | `common/question-format-guide.md` | **Adapt** — question formatting for mob/squad interactions |
| `common/welcome-message.md` | `common/welcome-message.md` | **Adapt** — update for v5 terminology and phase model |
| `common/terminal-formatting.md` | `common/terminal-formatting.md` | **Assess** — determine if this is framework or Olympus-only |
| `common/depth-levels.md` | `common/depth-levels.md` | **Assess** — v5 uses adaptive complexity; determine what carries forward |
| `common/workflow-changes.md` | `common/workflow-changes.md` | **Assess** — determine if v5 needs workflow change tracking rules |
| `common/pathway-behaviors.md` | `common/pathway-behaviors.md` | **Assess** — v5 simplifies pathways; determine what carries forward |

### Inception Rules

| V5 File | V4 Source | Action |
|---------|-----------|--------|
| `inception/workspace-detection.md` | `inception/workspace-detection.md` | **Adapt** — two-layer context model, reference `.aidlc/` project context |
| `inception/scoped-discovery.md` | `inception/reverse-engineering.md` | **Rewrite** — adaptive depth, 3 outputs not 9. V4 content is the starting point but structure changes significantly. |
| `inception/requirements-analysis.md` | `inception/requirements-analysis.md` | **Adapt** — produces intent.md + requirements.md + nfr.md, references pre-mob briefs |
| `inception/units-generation.md` | `inception/units-generation.md` | **Adapt** — produces units-overview.md (mob record) + per-unit unit-brief.md (squad input) |
| `inception/user-stories.md` | `inception/user-stories.md` | **Adapt** — per-unit stories.md, story-map.md, personas.md |
| `inception/bolt-planning.md` | `inception/bolt-planning.md` | **Adapt** — global numbering, status: outlined, mob outlines only |
| `inception/workflow-planning.md` | `inception/workflow-planning.md` | **Adapt** — produces execution-plan.md (risk matrix, sequencing rationale) |

V4 files to assess during Phase 6:

| V4 File | Notes |
|---------|-------|
| `inception/application-design.md` | Largely subsumed by units-generation. Review for any content not captured. |
| `inception/reverse-engineering.md` | Content feeds into scoped-discovery.md. Review for anything lost in the rewrite. |

### Construction Rules

| V5 File | V4 Source | Action |
|---------|-----------|--------|
| `construction/unit-design.md` | *(new — orchestrator)* | **New** — orchestrates the design sub-phase. Defines sequence: functional design → business rules → domain entities → NFR design (conditional) → infrastructure design (conditional) → bolt spec refinement. Gate 2 at exit. References individual rules below. |
| `construction/functional-design.md` | `construction/functional-design.md` | **Adapt** — how to create the functional design artifact. Depth scales with complexity (lightweight vs comprehensive). |
| `construction/business-rules.md` | *(new — rule file; v4 had template only)* | **New** — how to identify and document business rules, edge cases, validation logic, state transitions. |
| `construction/domain-entities.md` | *(new — rule file; v4 had template only)* | **New** — how to model entities, relationships, constraints, lifecycle states. |
| `construction/nfr-design.md` | `construction/nfr-design.md` | **Adapt** — HOW to meet NFR requirements in this unit's context (caching strategy, encryption approach, etc.). NFR requirements (WHAT) are captured in inception; NFR design (HOW) happens here. |
| `construction/infrastructure-design.md` | `construction/infrastructure-design.md` | **Adapt** — conditional rule for units requiring infrastructure changes. |
| `construction/bolt-execution.md` | `construction/code-generation.md` + `construction/build-and-test.md` | **New** — Plan→Code→Review lifecycle. Three steps, human gates at Plan and Review. References test-generation for the Code step. |
| `construction/test-generation.md` | `construction/test-generation.md` | **Adapt** — test standards and strategy. Referenced by bolt-execution during Code step. |
| `construction/unit-validation.md` | `construction/bolt-review.md` (partial) | **New** — Gate 3 enforcement. Full QA validation after all bolts. Produces validation-report.md + build-summary.md. |
| `construction/documentation.md` | `construction/documentation.md` | **Adapt** — post-build documentation, operations artifacts (deploy guide, runbook, release notes). |

V4 files to assess during Phase 6:

| V4 File | Notes |
|---------|-------|
| `construction/nfr-requirements.md` | NFR requirements moved to inception (requirements/nfr.md). Review for any construction-specific NFR requirements content. |
| `construction/bolt-planning.md` | Bolt planning moved to inception. Review for any construction-specific bolt planning content. |
| `construction/bolt-review.md` | Content feeds into bolt-execution review step + unit-validation. Review for anything not captured. |
| `construction/code-generation.md` | Content feeds into bolt-execution. Review for anything not captured. |
| `construction/build-and-test.md` | Content feeds into bolt-execution. Review for anything not captured. |

### Other Rules

| V5 File | V4 Source | Action |
|---------|-----------|--------|
| `operations/operations.md` | `operations/operations.md` | **Assess** — operations phase is placeholder in v5 architecture. Determine minimal content needed. |

### Inception Templates

| V5 File | V4 Source | Artifact It Produces |
|---------|-----------|---------------------|
| `inception/intent-template.md` | `inception/intent-template.md` | `{intent-id}/intent.md` |
| `inception/scope-analysis-template.md` | `inception/scope-analysis-template.md` | `inception/discovery/scope-analysis.md` |
| `inception/requirements-template.md` | `inception/requirements-template.md` | `inception/requirements/requirements.md` |
| `inception/nfr-template.md` | `inception/nfr-template.md` | `inception/requirements/nfr.md` |
| `inception/personas-template.md` | `inception/personas-template.md` | `inception/personas.md` |
| `inception/story-map-template.md` | `inception/story-map-template.md` | `inception/story-map.md` |
| `inception/stories-template.md` | `inception/stories-template.md` | `construction/UNIT-NNN/stories.md` |
| `inception/units-overview-template.md` | `inception/units-template.md` *(renamed + expanded)* | `inception/units-overview.md` |
| `inception/unit-brief-template.md` | `inception/unit-brief-template.md` | `construction/UNIT-NNN/unit-brief.md` |
| `inception/execution-plan-template.md` | *(new)* | `inception/execution-plan.md` |

### Construction Templates

| V5 File | V4 Source | Artifact It Produces |
|---------|-----------|---------------------|
| `construction/functional-design-template.md` | `construction/functional-design-template.md` | `UNIT-NNN/design/functional-design.md` |
| `construction/business-rules-template.md` | `construction/business-rules-template.md` | `UNIT-NNN/design/business-rules.md` |
| `construction/domain-entities-template.md` | `construction/domain-entities-template.md` | `UNIT-NNN/design/domain-entities.md` |
| `construction/bolt-spec-template.md` | `construction/bolt-spec-template.md` | `UNIT-NNN/bolts/BOLT-NNN/spec.md` |
| `construction/bolt-plan-template.md` | *(new)* | `UNIT-NNN/bolts/BOLT-NNN/plan.md` |
| `construction/review-template.md` | `construction/review-template.md` | `UNIT-NNN/bolts/BOLT-NNN/review.md` |

---

## Why NFR Design Stays in Construction

AWS AIDLC puts NFR in construction for a sound reason: you can't fully specify HOW to meet non-functional requirements until you know the unit's architecture and design approach.

V5 splits it into two layers:
- **NFR Requirements** (WHAT) → inception at `requirements/nfr.md`. The mob captures high-level NFRs: "page must load in 2 seconds", "all PII encrypted at rest."
- **NFR Design** (HOW) → construction's design sub-phase at `construction/nfr-design.md`. The squad determines: "use Redis with 5-minute TTL to meet 2-second target", "use AES-256 field-level encryption."

This matches AWS's separation of `nfr-requirements` from `nfr-design`, but moves the requirements half to inception where the mob can validate it alongside functional requirements.

---

## Phases

### Phase 0: Setup

**Depends on:** Nothing
**Deliverable:** Clean workspace with v4 reference preserved

- [ ] Rename `resources/` → `_v4-reference/`
- [ ] Create `resources/rules/common/`
- [ ] Create `resources/rules/inception/`
- [ ] Create `resources/rules/construction/`
- [ ] Create `resources/rules/operations/`
- [ ] Create `resources/templates/inception/`
- [ ] Create `resources/templates/construction/`
- [ ] Verify: `_v4-reference/` contains all original files (34 rules + 14 templates + skills + agents)

---

### Phase 1: Common Rules

**Depends on:** Phase 0
**Deliverable:** 12+ common rule files that establish the foundation vocabulary, process, gates, and AI behavioral guardrails

These must be done first — every inception and construction rule references common terminology, process overview, and gate definitions.

**On phase start:** (1) Read `aidlc-v5-architecture.md` in full — it is the source of truth and MUST be loaded into context before writing any file. (2) Create in-session task list with all tasks below. Mark each `in_progress` when starting, `completed` when user approves.

**Per-task workflow:** Write file → present to user → wait for approval → proceed to next task. Do NOT batch multiple files.

**Core framework rules:**

- [ ] `core-workflow.md` — **Rewrite.** The compact orchestration document installed into CLAUDE.md. Must reflect: two phases, three gates, new stage list, bolt lifecycle, folder structure, artifact list. This is the "master reference" the AI reads at session start.
- [ ] `common/process-overview.md` — **Rewrite.** Must be consistent with `core-workflow.md` (compact version above) — same phases, stages, gates, terminology. This is the detailed version with Mermaid diagrams, loaded on demand. Detailed process overview. Two phases (Inception → Construction). Three gates (always enforced). Inception stages: workspace detection → scoped discovery → requirements → units → stories → bolt planning → workflow planning. Construction sub-phases: Design (Gate 2) → Build with Plan→Code→Review per bolt (Gate 3).
- [ ] `common/terminology.md` — **Rewrite.** Canonical terms: Intent (=Epic), Unit (=Feature), Bolt (=User Story), Story (=Task), Gate, Mob, Squad, Design sub-phase, Build sub-phase. Drop deprecated terms: "elaboration", "forge", "summit", "vision". Global bolt numbering. Per-unit checkpoints.
- [ ] `common/gate-enforcement.md` — **New.** Two-level approval model: stage checkpoints (every stage, lightweight, AI pauses and waits) + formal gates (phase boundaries, defined reviewers). Gate 1: Inception Complete (PO + Tech Lead). Gate 2: Design Approved (Tech Lead, per unit). Gate 3: Unit Complete (QA + reviewer, per unit). What's checked at each gate. Start strict, per-bolt gates can relax. Gate 2/3 never relax. Checkpoints never relax.
- [ ] `common/session-continuity.md` — **Adapt.** Per-unit resumption: which unit are you working on? Read unit-checkpoint.json. Read inception artifacts. Checkpoint recovery.
- [ ] `common/error-handling.md` — **Adapt.** Update stage name references to v5.

**AI behavioral rules:**

- [ ] `common/overconfidence-prevention.md` — **Adapt.** AI behavioral guardrail. Applies across all stages. Update any stage-specific references.
- [ ] `common/content-validation.md` — **Adapt.** Mermaid syntax, ASCII diagrams, special characters. Update artifact name references.
- [ ] `common/ascii-diagram-standards.md` — **Adapt.** Diagram quality standards for artifacts. Update any stage-specific examples.
- [ ] `common/markdown-formatting.md` — **Keep.** General purpose, no v5-specific changes needed.
- [ ] `common/question-format-guide.md` — **Adapt.** Question formatting for mob/squad interactions. Update any stage-specific references.
- [ ] `common/welcome-message.md` — **Adapt.** Update for v5 terminology and phase model.

**Assess (read v4 file, decide keep/adapt/defer):**

- [ ] `common/terminal-formatting.md` — Read and decide: is this framework or Olympus-only?
- [ ] `common/depth-levels.md` — Read and decide: v5 uses adaptive complexity. What carries forward?
- [ ] `common/workflow-changes.md` — Read and decide: does v5 need workflow change tracking?
- [ ] `common/pathway-behaviors.md` — Read and decide: v5 simplifies pathways. What carries forward?

**Validation:** Each rule references only v5 terminology. No mentions of deprecated terms.

---

### Phase 2: Inception Rules

**Depends on:** Phase 1 (common rules establish terminology and process)
**Deliverable:** 7 inception rule files covering the full inception workflow

**On phase start:** (1) Read `aidlc-v5-architecture.md` in full — it is the source of truth and MUST be loaded into context before writing any file. (2) Create in-session task list with all tasks below. Mark each `in_progress` when starting, `completed` when user approves.

**Per-task workflow:** Write file → present to user → wait for approval → proceed to next task. Do NOT batch multiple files.

- [ ] `inception/workspace-detection.md` — **Adapt.** Two-layer context: check for `.aidlc/` project context (Layer 1), then determine scoped discovery depth (Layer 2). Greenfield vs brownfield detection. Adaptive discovery depth based on team familiarity. **Checkpoint:** mob confirms greenfield/brownfield assessment and discovery depth before proceeding.
- [ ] `inception/scoped-discovery.md` — **Rewrite** (from reverse-engineering.md). Reads `.aidlc/project-context.md` + technical brief (if available). Produces: workspace-scan.json (machine), scope-analysis.md (human review), intent-questions.md (Q&A log). Adaptive depth: deep familiarity = minimal scan, low familiarity = full discovery. NOT full reverse engineering. **Checkpoint:** mob reviews scope-analysis.md, flags gaps or corrections.
- [ ] `inception/requirements-analysis.md` — **Adapt.** Inputs: intent brief (from PO) + technical brief (from senior dev, optional) + scoped discovery output. Produces: intent.md (at folder root), requirements/requirements.md (FR-NNN), requirements/nfr.md (high-level NFR). **Checkpoint:** PO validates requirements and NFRs before unit decomposition begins.
- [ ] `inception/units-generation.md` — **Adapt.** Produces TWO artifacts: `inception/units-overview.md` (mob's combined record — WHY these boundaries, cross-unit deps, sequencing) + per-unit `construction/UNIT-NNN/unit-brief.md` (squad input). Units are independent bounded contexts. **Checkpoint:** mob validates unit boundaries, dependencies, and sequencing rationale.
- [ ] `inception/user-stories.md` — **Adapt.** Per-unit `stories.md` with acceptance criteria (checkboxes). Story IDs per-unit (S-001, S-002). `inception/story-map.md` generated as PO review artifact with requirements coverage. `inception/personas.md` project-wide. **Checkpoint:** PO reviews story-map for coverage, QA reviews acceptance criteria for testability.
- [ ] `inception/bolt-planning.md` — **Adapt.** Global sequential numbering (BOLT-001 through BOLT-NNN across all units). Mob creates outlines with `status: outlined` in frontmatter. Specs live in `construction/UNIT-NNN/bolts/BOLT-NNN/spec.md`. Coverage verification against stories. **Checkpoint:** Tech Lead reviews bolt outlines and story-to-bolt coverage.
- [ ] `inception/workflow-planning.md` — **Adapt.** Produces `inception/execution-plan.md`: risk matrix, sequencing rationale (WHY this unit order), scope decisions, accepted tradeoffs, pre/post checklists. This is the mob's strategy document. **Checkpoint:** mob reviews execution plan. Then → **Gate 1** formal sign-off on entire inception package.

**Validation:** Walk through the architecture doc's inception flow. Every inception artifact in the folder structure has a rule that produces it and a template that defines its format. Every rule includes a checkpoint with specific reviewer and criteria.

---

### Phase 3: Inception Templates

**Depends on:** Phase 2 (rules define what each template must contain)
**Deliverable:** 10 inception templates with consistent frontmatter

**On phase start:** (1) Read `aidlc-v5-architecture.md` in full — it is the source of truth and MUST be loaded into context before writing any file. (2) Create in-session task list with all tasks below. Mark each `in_progress` when starting, `completed` when user approves.

**Per-task workflow:** Write file → present to user → wait for approval → proceed to next task. Do NOT batch multiple files.

All templates use YAML frontmatter per the architecture doc's common frontmatter pattern.

- [ ] `inception/intent-template.md` — **Adapt.** Frontmatter: type: intent. Sections: Problem/Goal, Success Criteria, Scope (in/out), Business Constraints, User Personas Affected.
- [ ] `inception/scope-analysis-template.md` — **Adapt.** Frontmatter: type: scope-analysis. Sections: Affected Code Paths, Integration Points, Risks Specific to This Intent, Dependencies.
- [ ] `inception/requirements-template.md` — **Adapt.** Frontmatter: type: requirements. FR-NNN format with priority, acceptance criteria.
- [ ] `inception/nfr-template.md` — **Adapt.** Frontmatter: type: nfr. Performance, security, scalability, accessibility concerns.
- [ ] `inception/personas-template.md` — **Adapt.** Frontmatter: type: personas. Project-wide personas shared across all units.
- [ ] `inception/units-overview-template.md` — **Rewrite** (from units-template.md). Frontmatter: type: units-overview. Sections: Unit Decomposition Rationale, Unit List (with boundaries, responsibilities, dependencies), Cross-Unit Dependencies, Construction Sequencing, Decision Log.
- [ ] `inception/unit-brief-template.md` — **Adapt.** Frontmatter: type: unit-brief, unit: UNIT-NNN-slug. Squad-focused: scope, dependencies, assigned stories, key constraints. Extracted from units-overview.
- [ ] `inception/stories-template.md` — **Adapt.** Frontmatter: type: stories, unit: UNIT-NNN-slug. Per-story format: As/I want/So that + acceptance criteria checkboxes.
- [ ] `inception/story-map-template.md` — **Adapt.** Frontmatter: type: story-map. All stories across all units + requirements coverage matrix.
- [ ] `inception/execution-plan-template.md` — **New.** Frontmatter: type: execution-plan. Sections: Risk Matrix, Sequencing Rationale, Scope Decisions, Accepted Tradeoffs, Pre-Construction Checklist, Success Criteria.

**Validation:** Every template has complete frontmatter. Every mandatory section is present. Placeholder syntax uses `{variable-name}`. Section descriptions use HTML comments.

---

### Phase 4: Construction Rules

**Depends on:** Phase 1 (common rules)
**Deliverable:** 11 construction rule files — 1 orchestrator + 10 individual rules

The orchestrator (`unit-design.md`) defines the sequence and references individual rules. Each individual rule stays focused on one concern. Note: business-rules.md and domain-entities.md are guidance files referenced during the Functional Design stage — not separate stages with their own checkpoints.

**On phase start:** (1) Read `aidlc-v5-architecture.md` in full — it is the source of truth and MUST be loaded into context before writing any file. (2) Create in-session task list with all tasks below. Mark each `in_progress` when starting, `completed` when user approves.

**Per-task workflow:** Write file → present to user → wait for approval → proceed to next task. Do NOT batch multiple files.

**Design sub-phase:**

- [ ] `construction/unit-design.md` — **New (orchestrator).** Defines the design stage sequence for one unit. Squad reads inception artifacts (unit-brief, stories, units-overview, execution-plan). References individual rules below. QA participates from the start. Gate 2 at exit: Tech Lead formal review.
- [ ] `construction/functional-design.md` — **Adapt.** How to create the functional design artifact. Depth scales with unit complexity (lightweight vs comprehensive — see architecture doc examples). Referenced by unit-design.md during Functional Design stage.
- [ ] `construction/business-rules.md` — **New.** How to identify and document business rules, edge cases, validation logic, state transitions. Referenced by unit-design.md during Functional Design stage (not a separate stage).
- [ ] `construction/domain-entities.md` — **New.** How to model entities, relationships, constraints, lifecycle states. Referenced by unit-design.md during Functional Design stage (not a separate stage).
- [ ] `construction/nfr-design.md` — **Adapt.** HOW to meet NFR requirements in this unit's context. NFR requirements (WHAT) are in inception; this is the design response. Conditional — not every unit needs it. Referenced by unit-design.md. **Checkpoint:** squad reviews NFR design decisions.

**Functional Design stage checkpoint:** Squad + QA review the complete design package (all three artifacts: functional-design.md, business-rules.md, domain-entities.md) in a single checkpoint before proceeding.
- [ ] `construction/infrastructure-design.md` — **Adapt.** Conditional rule for units requiring infrastructure changes (new services, deployment changes, infra provisioning). Referenced by unit-design.md. **Checkpoint:** squad reviews infrastructure design.

**Build sub-phase:**

- [ ] `construction/bolt-execution.md` — **New.** Three-step lifecycle per bolt, sequential within unit:
  - **Plan:** AI reads refined spec.md + unit design → creates implementation approach. Dev approves (human gate).
  - **Code:** AI generates code + tests (references test-generation.md for standards). Tests run automatically.
  - **Review:** Dev reviews code quality. QA validates acceptance criteria. review.md created (human gate).
  Advancement requires: tests pass + QA validates + human says "continue".
- [ ] `construction/test-generation.md` — **Adapt.** Test standards and strategy: what coverage is expected, what kinds of tests (unit, integration, E2E), how tests relate to acceptance criteria. Referenced by bolt-execution during Code step.

**Completion:**

- [ ] `construction/unit-validation.md` — **New.** Gate 3 enforcement after all bolts complete. QA does full validation (regression, integration, edge cases). Produces: validation-report.md + build-summary.md. PR merged after approval.
- [ ] `construction/integration-testing.md` — **New.** Cross-unit integration testing after all units pass Gate 3. Conditional — only when multiple units exist. Tests cross-unit API contracts, shared data flows, end-to-end user journeys across unit boundaries. Produces: integration-test-results.md at construction root. **Checkpoint:** QA + Tech Lead review integration test results.
- [ ] `construction/documentation.md` — **Adapt.** Post-build documentation and operations artifacts (deploy guide, runbook, release notes).

**Validation:** Design → Build → Gate flow matches architecture doc and core-workflow.md. Functional Design is a single stage producing three artifacts (functional-design.md, business-rules.md, domain-entities.md) with one checkpoint. Bolt lifecycle is exactly Plan→Code→Review. Gate 2 and Gate 3 enforcement rules are explicit and match gate-enforcement.md. Individual rules are referenced (not duplicated) by the orchestrator.

---

### Phase 5: Construction Templates

**Depends on:** Phase 4 (rules define what each template must contain)
**Deliverable:** 6 construction templates with consistent frontmatter

**On phase start:** (1) Read `aidlc-v5-architecture.md` in full — it is the source of truth and MUST be loaded into context before writing any file. (2) Create in-session task list with all tasks below. Mark each `in_progress` when starting, `completed` when user approves.

**Per-task workflow:** Write file → present to user → wait for approval → proceed to next task. Do NOT batch multiple files.

- [ ] `construction/functional-design-template.md` — **Adapt.** Frontmatter: type: functional-design, unit: UNIT-NNN-slug. Sections: Overview, Key Interactions, Data Models, Dependencies. Depth varies (see architecture doc lightweight vs comprehensive examples).
- [ ] `construction/business-rules-template.md` — **Adapt.** Frontmatter: type: business-rules, unit: UNIT-NNN-slug. Sections: Validation Rules, Edge Cases, State Transitions, Error Handling.
- [ ] `construction/domain-entities-template.md` — **Adapt.** Frontmatter: type: domain-entities, unit: UNIT-NNN-slug. Sections: Entity List, Attributes, Relationships, Constraints, Lifecycle States.
- [ ] `construction/bolt-spec-template.md` — **Adapt.** Two-state template:
  - `status: outlined` (mob creates): Goal, High-Level Acceptance Criteria, Stories Covered, Estimated Complexity.
  - `status: refined` (squad enriches): + Detailed Acceptance Criteria (Given/When/Then), Target Files, Implementation Notes, Test Strategy, Dependencies.
  Frontmatter: type: bolt-spec, unit: UNIT-NNN-slug, bolt: BOLT-NNN-slug, status: outlined|refined, complexity: low|medium|high, stories: [S-NNN].
- [ ] `construction/bolt-plan-template.md` — **New.** Frontmatter: type: bolt-plan, unit: UNIT-NNN-slug, bolt: BOLT-NNN-slug, status: draft|approved. Sections: Implementation Approach, Numbered Steps with Checkboxes (target files, patterns to follow, code to generate/modify), Story Traceability, Dependencies on Prior Bolts, Risks/Spec Gaps Identified. Modeled after AWS code-generation-plan pattern but per-bolt scope.
- [ ] `construction/review-template.md` — **Adapt.** Frontmatter: type: review, bolt: BOLT-NNN-slug. Sections: Status (passed/failed), Acceptance Criteria Checklist, Tests (count + status), QA Validation (who + notes), Deviations from Spec.

**Validation:** Every template matches the artifact format shown in the architecture doc. Bolt spec template handles both outlined and refined states. Bolt plan template matches the Plan step in bolt-execution.md.

---

### Phase 6: Cross-Validation

**Depends on:** All prior phases
**Deliverable:** Confirmed consistency between architecture doc, rules, and templates. All v4 files reviewed.

**On phase start:** (1) Read `aidlc-v5-architecture.md` in full — it is the source of truth and MUST be loaded into context before writing any file. (2) Create in-session task list with all tasks below. Mark each `in_progress` when starting, `completed` when user approves.

**Per-task workflow:** Run check → present findings to user → wait for approval → proceed to next check. Report issues found; do NOT auto-fix without approval.

**Architecture alignment:**

- [ ] **Folder structure walk:** For every file in the architecture doc's folder structure, confirm there is a rule that produces it and a template that defines its format.
- [ ] **Rule-template linkage:** Every rule that produces an artifact references the correct template by name.
- [ ] **Terminology audit:** Grep all rule and template files for deprecated terms ("elaboration", "forge", "summit", "vision"). Zero hits.
- [ ] **Frontmatter consistency:** Every template uses the common frontmatter pattern from the architecture doc. All required fields present.
- [ ] **Gate coverage:** Gate 1 checks are covered by inception rules. Gate 2 checks are covered by unit-design.md. Gate 3 checks are covered by unit-validation.md. All three gates match gate-enforcement.md.
- [ ] **Bolt lifecycle:** bolt-execution.md describes exactly Plan→Code→Review. bolt-spec-template handles outlined→refined. review-template matches the format in the architecture doc.
- [ ] **Global bolt numbering:** bolt-planning.md and bolt-spec-template both reference global sequential numbering.
- [ ] **Units overview + per-unit briefs:** units-generation.md produces both. units-overview-template and unit-brief-template are distinct and serve different audiences (mob vs squad).
- [ ] **NFR split:** NFR requirements in inception (requirements/nfr.md via requirements-analysis.md). NFR design in construction (via nfr-design.md, referenced by unit-design.md).
- [ ] **Checkpoint coverage:** Every rule that produces an artifact includes a stage checkpoint (present → pause → approve). Checkpoints specify WHO reviews and WHAT they check. The checkpoint flow matches the architecture doc's "Checkpoint and Gate Model" section.

**V4 residual review:**

Walk through every file in `_v4-reference/` and confirm each is either:
(a) carried into new `resources/` (adapted or rewritten), or
(b) its content is captured in another v5 file, or
(c) explicitly deferred with documented reasoning

- [ ] `_v4-reference/rules/inception/application-design.md` — Review: content subsumed by units-generation?
- [ ] `_v4-reference/rules/inception/reverse-engineering.md` — Review: content captured in scoped-discovery?
- [ ] `_v4-reference/rules/construction/nfr-requirements.md` — Review: NFR requirements moved to inception. Any construction-specific content?
- [ ] `_v4-reference/rules/construction/bolt-planning.md` — Review: bolt planning moved to inception. Any construction-specific content?
- [ ] `_v4-reference/rules/construction/bolt-review.md` — Review: content captured in bolt-execution review step + unit-validation?
- [ ] `_v4-reference/rules/construction/code-generation.md` — Review: content captured in bolt-execution?
- [ ] `_v4-reference/rules/construction/build-and-test.md` — Review: content captured in bolt-execution?
- [ ] `_v4-reference/rules/common/terminal-formatting.md` — Decision from Phase 1 assess
- [ ] `_v4-reference/rules/common/depth-levels.md` — Decision from Phase 1 assess
- [ ] `_v4-reference/rules/common/workflow-changes.md` — Decision from Phase 1 assess
- [ ] `_v4-reference/rules/common/pathway-behaviors.md` — Decision from Phase 1 assess
- [ ] `_v4-reference/rules/operations/operations.md` — Decision on minimal content for v5
- [ ] `_v4-reference/templates/inception/units-template.md` — Confirm content captured in units-overview-template
- [ ] **Any other files** in `_v4-reference/` not listed above (skills, agents — note for future Olympus wiring plan)

---

## File Count Summary

| Category | Files | New | Rewrite | Adapt | Keep | Assess |
|----------|-------|-----|---------|-------|------|--------|
| Root rules | 1 | 0 | 1 | 0 | 0 | 0 |
| Common rules | 15 | 1 | 2 | 6 | 1 | 4+1 (welcome) |
| Inception rules | 7 | 1 | 1 | 5 | 0 | 0 |
| Construction rules | 11 | 5 | 0 | 5 | 0 | 0+1 (operations) |
| Inception templates | 10 | 1 | 1 | 8 | 0 | 0 |
| Construction templates | 6 | 1 | 0 | 5 | 0 | 0 |
| **Total** | **50** | **9** | **5** | **29** | **1** | **~6** |

V4: 34 rules + 14 templates = 48 files
V5 (confirmed): 34 rules + 16 templates = 50 files (before assess decisions)
V5 (after assess): Final count depends on Phase 1 and Phase 6 decisions

---

## What This Plan Does NOT Cover

These are deferred to a separate Olympus wiring plan:

- `resources/claude-md.md` — Olympus orchestration layer (base template for `~/.claude/CLAUDE.md`). Governs agent delegation, skills, commands — NOT the AI-DLC workflow. Content changes only needed if Olympus behaviors change.
- TypeScript workflow engine (`src/features/workflow-engine/`)
- Hooks (`src/hooks/`)
- Skills (`resources/skills/`)
- Agents (`resources/agents/`)
- Installer (`src/installer/`) — includes the `mergeAidlcRules()` pipeline that injects `core-workflow.md` into CLAUDE.md
- Tests
- Build/release pipeline

**Note on CLAUDE.md assembly:** The installer combines `claude-md.md` (Olympus base) + `core-workflow.md` (AI-DLC compact reference) into `~/.claude/CLAUDE.md`. This plan rewrites `core-workflow.md` content; the installer wiring that merges it is deferred.
