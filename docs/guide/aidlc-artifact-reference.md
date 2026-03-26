# AIDLC Artifact Reference

A complete reference of every artifact the AI-DLC workflow produces, organized by phase and stage.

---

## Full Workflow Directory Structure

The following shows the complete file and folder structure produced by a full AIDLC workflow. Conditional artifacts are noted — not every workflow produces every file.

```
aidlc-docs/{workflowId}/
│
├── aidlc-state.md                          <- live progress tracker
├── checkpoint.json                         <- machine-readable state
├── audit.md                                <- timestamped interaction log
├── manifest.json                           <- artifact registry
│
├── discovery/                              <- brownfield only
│   ├── workspace-scan.json
│   ├── static-model.md
│   ├── dynamic-model.md
│   ├── current-state-analysis.md
│   ├── change-impact.md
│   ├── regression-baseline.md
│   └── analysis-plan.md
│
├── inception/
│   ├── intent.md                           <- ALWAYS: problem, context, personas, criteria
│   ├── intent-questions.md                 <- interview questions
│   ├── interview-log.md                    <- Q&A record
│   ├── decisions.md                        <- binding decisions from interview
│   ├── momus-review.md                     <- plan review (optional)
│   │
│   ├── requirements/
│   │   ├── requirements.md                 <- ALWAYS: FRs, NFRs, coverage verification
│   │   ├── requirements-analysis-questions.md
│   │   ├── metis-blind-spot-analysis.md    <- optional
│   │   └── nfr.md                          <- non-functional requirements
│   │
│   ├── user-stories/                       <- conditional
│   │   ├── stories.md                      <- index (always when stage runs)
│   │   ├── personas.md
│   │   ├── story-planning-questions.md
│   │   └── stories/                        <- individual files (>5 stories)
│   │       ├── S-001-feature-a.md
│   │       └── S-002-feature-b.md
│   │
│   ├── application-design/                 <- conditional (new components/services)
│   │   ├── components.md
│   │   ├── services.md
│   │   ├── dependencies.md
│   │   └── design-questions.md
│   │
│   ├── units/                              <- separate from application-design
│   │   ├── unit-of-work.md                 <- ALWAYS: unit definitions
│   │   ├── unit-of-work-dependency.md      <- conditional: dependency matrix
│   │   ├── unit-of-work-story-map.md       <- conditional: story-to-unit mapping
│   │   └── UNIT-001-api/                   <- conditional: briefs (>=3 units + moderate)
│   │       └── unit-brief.md
│   │
│   └── plans/
│       ├── workflow-routing.md             <- L1 routing decisions
│       ├── execution-plan.md               <- detailed execution plan
│       ├── user-stories-assessment.md      <- conditional
│       ├── story-generation-plan.md        <- conditional
│       └── unit-of-work-plan.md            <- conditional
│
├── construction/
│   ├── plans/                              <- per-unit construction plans
│   │   ├── UNIT-001-api-bolt-plan.md
│   │   ├── api-functional-design-plan.md
│   │   ├── api-code-generation-plan.md
│   │   └── ...
│   │
│   ├── UNIT-001-api/                       <- per-unit construction artifacts
│   │   ├── functional-design/              <- conditional
│   │   │   ├── domain-entities.md
│   │   │   ├── business-rules.md
│   │   │   └── business-logic-model.md
│   │   ├── nfr-requirements/               <- conditional
│   │   ├── nfr-design/                     <- conditional
│   │   ├── infrastructure-design/          <- conditional
│   │   └── code/
│   │       └── code-summary.md             <- what was generated
│   │
│   ├── UNIT-002-frontend/                  <- same structure per unit
│   │   └── ...
│   │
│   ├── bolts/                              <- bolt specs and reviews
│   │   ├── BOLT-001-api-endpoints/
│   │   │   ├── spec.md                     <- scope, AC, traceability, docs_impact
│   │   │   └── review.md                   <- score, decision, feedback
│   │   ├── BOLT-002-payment-flow/
│   │   │   ├── spec.md
│   │   │   └── review.md
│   │   └── ...
│   │
│   ├── design/                             <- shared design artifacts
│   │
│   ├── build-and-test/                     <- ALWAYS (after all units)
│   │   └── build-and-test-summary.md
│   │
│   └── documentation/                      <- ALWAYS (after build-and-test)
│       ├── doc-plan.md                     <- what docs needed + where
│       ├── readme-update.md                <- draft
│       ├── user-guide-feature.md           <- draft
│       └── config-reference-settings.md    <- draft
│
└── operations/                             <- placeholder for future
```

---

## Phase Summary

| Phase | Purpose | Key Artifacts |
|-------|---------|---------------|
| **Discovery** | Understand existing codebase (brownfield only) | workspace-scan.json, static-model.md, current-state-analysis.md |
| **Inception** | Determine WHAT to build and WHY | intent.md, requirements.md, stories.md, unit-of-work.md |
| **Construction** | Determine HOW to build it, then build it | Per-unit design + code, bolt specs + reviews, build-and-test, documentation |
| **Operations** | Deploy and monitor (placeholder) | Future: deployment plans, runbooks |

---

## Artifact Descriptions

### Root-Level Files

| File | Created | Purpose |
|------|---------|---------|
| `aidlc-state.md` | Workflow start | Human-readable progress tracker, updated as stages complete |
| `checkpoint.json` | Workflow start | Machine-readable state for resumption and engine use |
| `audit.md` | Workflow start | Timestamped log of every user input and AI response |
| `manifest.json` | Workflow start | Registry of all generated artifacts with metadata |

### Inception Artifacts

| Artifact | Condition | Content |
|----------|-----------|---------|
| `intent.md` | ALWAYS | Problem statement, business context, technical context, personas, success criteria, constraints, out of scope |
| `requirements.md` | ALWAYS | Functional requirements, non-functional requirements, coverage verification table |
| `stories.md` | Conditional (user-facing features) | User stories in S-NNN format with Gherkin acceptance criteria |
| `personas.md` | Conditional (with stories) | User persona definitions |
| `application-design/` | Conditional (new components) | Component architecture, services, dependencies |
| `unit-of-work.md` | ALWAYS (at least lightweight) | Unit decomposition with U-NNN IDs |
| `unit-brief.md` | Conditional (>=3 units + moderate complexity) | Per-unit detail: purpose, requirements mapping, domain entities |
| `execution-plan.md` | ALWAYS | Stage execution decisions, Mermaid visualization, risk matrix |

### Construction Artifacts

| Artifact | Condition | Content |
|----------|-----------|---------|
| `UNIT-NNN-{name}/` | Per unit | Contains functional-design/, nfr-*/, infrastructure-design/, code/ |
| `functional-design/` | Conditional (complex business logic) | Domain entities, business rules, logic models |
| `code/code-summary.md` | ALWAYS (per unit) | Files created/modified, tech stack, story IDs |
| `BOLT-NNN-{slug}/spec.md` | Per bolt | Scope, acceptance criteria, target files, traceability, docs_impact |
| `BOLT-NNN-{slug}/review.md` | Per bolt | Score, decision, feedback, traceability check |
| `build-and-test-summary.md` | ALWAYS | Build results, test results, pass/fail status |
| `documentation/doc-plan.md` | ALWAYS | Documentation impact assessment and placement plan |
| `documentation/*.md` | Based on docs_impact | Human-readable documentation drafts for user review |

### Bolt Spec Frontmatter

Every bolt spec.md includes structured frontmatter:

```yaml
---
id: BOLT-NNN-slug
title: "Short descriptive title"
parent_unit_id: UNIT-NNN-unit-name
sequence: 1
depth_target: 6
express_mode: false
estimated_effort_hours: 4
requirements: ["FR-1", "FR-3"]
stories: ["S-001", "S-004"]
docs_impact: ["user-guide", "readme"]
---
```

---

## Naming Conventions

| Entity | Format | Example |
|--------|--------|---------|
| Units | `U-NNN` (docs), `UNIT-NNN-slug` (folders) | U-001, UNIT-001-api |
| Stories | `S-NNN` | S-001, S-002 |
| Bolts | `BOLT-NNN-slug` | BOLT-001-api-endpoints |
| Requirements | `FR-N` (functional) | FR-1, FR-2 |
| Workflows | `{kebab-case-slug}` | online-registration |
