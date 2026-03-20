# AI-DLC Intent Brief

**Author:** [Your name]
**Last Updated:** [Date]
**Status:** Draft | Ready for Mob Elaboration
**Project Type:** Greenfield | Brownfield

---

## Intent

_A clear, concise statement of what you want to build and why. This is the seed the AI decomposes during Inception. Write it the way you'd pitch the problem to a new team member in 60 seconds._

We need to [what the system should do] so that [who benefits] can [outcome achieved], because today [current pain point or gap].

**Example:** We need to build a consolidated reporting engine so that account managers can generate cross-account summaries in minutes instead of hours, because today they manually pull data from three separate systems and lose ~3 hours/week per person.

---

## Business Context

### Who is this for?

| Segment | Role / Persona | Why they care |
|---------|---------------|---------------|
| Primary | [e.g., Account managers with 5+ accounts] | [e.g., Directly impacted by manual reporting burden] |
| Secondary | [e.g., Team leads consuming rolled-up data] | [e.g., Need accurate data for planning decisions] |

### What does success look like?

_Don't over-specify metrics yet — the AI will help refine these during Mob Elaboration. Capture the directional outcomes you care about._

- [e.g., Dramatically reduce time spent on manual data pulls]
- [e.g., Improve accuracy of cross-account reporting]
- [e.g., High adoption within the first quarter post-launch]

---

## Scope Boundaries

### Explicitly Out of Scope

_This is the most important section for preventing AI over-scoping during Inception. Be specific about what you are NOT building._

- [e.g., Custom report builder — planned for a future phase]
- [e.g., Real-time streaming / live dashboards]
- [e.g., Third-party data source integrations]
- [e.g., Changes to the underlying data models in source systems]

### Scope Signals (In Scope, Directional)

_High-level capabilities you expect. The AI will decompose these into stories and units — don't write detailed requirements here._

- [e.g., Automated aggregation across account types A, B, and C]
- [e.g., Export functionality (CSV, PDF at minimum)]
- [e.g., Role-based access control]

---

## Constraints

_Realities the AI cannot infer. These shape the solution space before any design work begins._

### Technical Constraints
- [e.g., Must integrate with existing REST APIs for account types A and B]
- [e.g., Must work within the current frontend framework — no new UI dependencies]
- [e.g., Database is PostgreSQL 14; no migration budget in this phase]

### Business / Organizational Constraints
- [e.g., Engineering capacity: 2 backend + 1 frontend for this initiative]
- [e.g., Must ship before Q3 planning cycle begins]
- [e.g., Cannot change the existing billing data schema without Finance approval]

### Compliance / Security Constraints
- [e.g., Data exports must comply with SOC 2 requirements]
- [e.g., PII must be masked in any shared or exported reports]
- [e.g., All API endpoints require authentication via existing SSO]

---

## Existing System Context

_Critical for brownfield projects. Give the AI enough to understand what it's working with._

### System Landscape
- [e.g., Monolithic Rails app with a React frontend, deployed on AWS ECS]
- [e.g., Account data lives in three microservices: accounts-svc, billing-svc, usage-svc]
- [e.g., Current reporting is a set of ad-hoc SQL queries run manually against a read replica]

### Key Integration Points
- [e.g., accounts-svc API (stable, documented)]
- [e.g., billing-svc API (stable, documented)]
- [e.g., usage-svc API (undocumented, needs a spike)]

### Known Technical Debt or Risks
- [e.g., usage-svc has no published API contract — will need reverse engineering]
- [e.g., Read replica has a 15-minute replication lag]

_For greenfield projects, replace this section with a brief note on target platform/stack if known, or mark as "To be determined during Inception."_

---

## Dependencies & Risks

| Item | Type | Owner | Impact if Unresolved |
|------|------|-------|---------------------|
| [e.g., usage-svc API contract] | Technical | Backend team | Blocks integration work for account type C |
| [e.g., Design resource availability] | Organizational | Design lead | Delays UI work; may need async review process |
| [e.g., Data accuracy in source systems] | Data quality | Data team | Garbage-in/garbage-out for consolidated reports |

---

## Non-Functional Requirements (Known)

_Capture NFRs you already know. The AI-DLC workflow will evaluate these and may surface additional ones during Inception._

- **Performance:** [e.g., Report generation must complete within 30 seconds for up to 50 accounts]
- **Availability:** [e.g., Must meet existing platform SLA of 99.9%]
- **Scalability:** [e.g., Must support up to 200 concurrent users]
- **Accessibility:** [e.g., Must meet WCAG 2.1 AA]
- **Observability:** [e.g., Must integrate with existing Datadog monitoring]

---

## Stakeholders for Mob Elaboration

_Who needs to be in the room when Inception kicks off?_

| Name | Role | Why they're needed |
|------|------|--------------------|
| [Name] | Product Owner | Owns the intent and prioritization decisions |
| [Name] | Engineering Lead | Technical feasibility and architecture input |
| [Name] | QA / Test Lead | Acceptance criteria and edge case identification |
| [Name] | Security / Compliance | Validates NFRs and compliance constraints |
| [Name] | Ops / DevOps | Deployment and infrastructure considerations |

---

## Open Pre-Inception Questions

_Things you need answered BEFORE Mob Elaboration — not questions for the AI to resolve during Inception._

- [ ] [e.g., Has Finance signed off on the billing schema freeze?]
- [ ] [e.g., Do we have API credentials for the usage-svc staging environment?]
- [ ] [e.g., Is the design team available for async review during the build phase?]

---

_Once this brief is complete and pre-inception questions are resolved, trigger Mob Elaboration. The AI-DLC Inception phase will decompose the Intent into requirements, stories, and units — with the team validating every step._
