# AI-DLC Framework Analysis: White Paper Synthesis and Practical Application

---

## Table of Contents

### PART I: AWS AI-DLC Framework

1. [Executive Summary](#1-executive-summary)
2. [AI-DLC White Paper Breakdown](#2-ai-dlc-white-paper-breakdown)
3. [What Is a "Level 1 Plan"?](#3-what-is-a-level-1-plan)
4. [Mob Elaboration and Mob Construction for Remote/Virtual Teams](#4-mob-elaboration-and-mob-construction-for-remotevirtual-teams)
5. [Applying AI-DLC in a Small SaaS Company Using Scrum](#5-applying-ai-dlc-in-a-small-saas-company-using-scrum)
6. [Practical Example: End-to-End AI-DLC Flow](#6-practical-example-end-to-end-ai-dlc-flow)
7. [Brownfield Development Specifics](#7-brownfield-development-specifics)

### PART II: Olympus as an AI-DLC Implementation

8. [Mapping AI-DLC to Olympus](#8-mapping-ai-dlc-to-olympus)
9. [Gap Analysis](#9-gap-analysis)
10. [Olympus End-to-End Example](#10-olympus-end-to-end-example)

[References](#references)

---

# PART I: AWS AI-DLC Framework

> The sections below describe the AI-Driven Development Lifecycle (AI-DLC) purely as defined by the AWS white paper and related documentation. No specific tooling or implementation is referenced. The methodology is tool-agnostic.

---

## 1. Executive Summary

The **AI-Driven Development Lifecycle (AI-DLC)** is a methodology defined by Bala SP at Amazon Web Services that reimagines software development from first principles, placing AI at the center of the process rather than retrofitting it into existing human-centric workflows like Scrum or Kanban.

AI-DLC is not an incremental improvement to Agile. It is a fundamentally different operating model where AI initiates conversations, generates plans, decomposes work, creates designs, writes code, and runs tests, while humans serve as validators, approvers, and strategic decision-makers at critical junctures. The methodology compresses iteration cycles from weeks (Sprints) to hours or days (Bolts), integrates design techniques like Domain-Driven Design directly into the core workflow, and produces a continuous chain of semantically rich artifacts that feed forward from one stage to the next.

**Why this matters for small SaaS teams using Scrum:** The methodology reduces the overhead of ceremonies, collapses specialized roles, and enables a 5-10 person team to ship features at a pace previously requiring much larger organizations. The key insight is that AI handles the undifferentiated heavy lifting (decomposition, design, code generation, test writing) while humans focus exclusively on what they are uniquely good at: business judgment, risk assessment, and validation.

AI-DLC replaces the Sprint timebox with a much faster iteration unit called the Bolt (hours to days), replaces manual estimation with AI-driven depth assessment, and replaces periodic retrospectives with a continuous, artifact-driven audit trail that enables data-driven reflection. For teams currently running Scrum, AI-DLC preserves familiar concepts (user stories, product owners, iterative delivery) while fundamentally changing the execution model, cadence, and division of labor between humans and AI.

---

## 2. AI-DLC White Paper Breakdown

### 2.1 The Ten Principles

The white paper establishes ten foundational principles that govern every aspect of AI-DLC. Understanding these principles is essential because they explain not just what the methodology does, but why it makes the choices it does.

#### Principle 1: Reimagine Rather Than Retrofit

> Traditional SDLC methods were built for longer iteration durations (months and weeks), which led to rituals like daily standups and retrospectives. Proper applications of AI leads to rapid cycles, measured in hours or days.

The paper explicitly rejects the approach of "adding AI to Scrum." Story points become less relevant when AI diminishes the boundaries between simple, medium, and hard tasks. Velocity as a metric gives way to business value delivered. The analogy used is automobiles versus faster horse chariots: you cannot get the benefits of the new paradigm by optimizing the old one.

**Practical implication:** Do not try to run AI-DLC inside Azure DevOps with story points and velocity tracking. The tracking mechanisms must change to match the new cadence.

#### Principle 2: Reverse the Conversation Direction

In traditional development, humans initiate conversations with AI ("write me a function that..."). In AI-DLC, AI initiates and directs conversations with humans. AI breaks down intents into actionable tasks, generates recommendations, proposes trade-offs. Humans serve as approvers.

The paper uses the Google Maps analogy: humans set the destination (intent), and the system provides step-by-step directions (AI's task decomposition and recommendations). Along the way, humans maintain oversight and moderate the journey as needed.

**Practical implication:** When using AI-DLC tooling, the AI should be asking the questions, not the human. The human's primary action is to validate, approve, reject, or refine what AI proposes.

#### Principle 3: Integration of Design Techniques into the Core

Agile frameworks leave design techniques out of scope. AI-DLC makes them integral. The first version uses Domain-Driven Design (DDD) principles to break down systems into bounded contexts. Future flavors will support Behavior-Driven Development (BDD) and Test-Driven Development (TDD).

The paper cites a statistic: software quality issues in the US alone cost $2.41 trillion in 2022. The decoupling of design techniques from methodology is identified as a root cause.

**Practical implication:** The AI must apply DDD principles during decomposition (identifying aggregates, entities, value objects, domain events, repositories, factories). This is not optional; it is part of the methodology's core.

#### Principle 4: Align with AI Capability

AI-DLC is optimistic about AI's future but realistic about its current state. It adopts the "AI-Driven" paradigm (between AI-Assisted and fully AI-Autonomous), where developers retain ultimate responsibility for validation, decision-making, and oversight.

**Practical implication:** Every AI-generated artifact requires human review before it becomes a contract for downstream work. No fully autonomous execution.

#### Principle 5: Cater to Building Complex Systems

AI-DLC is designed for systems that demand continuous functional adaptability, high architectural complexity, numerous trade-off management, scalability, integration, and customization requirements. Simple systems are explicitly out of scope and better served by low-code/no-code approaches.

**Practical implication:** If you are building a landing page or a simple CRUD app, AI-DLC is overkill. If you are building a SaaS platform with multiple microservices, complex business logic, and regulatory requirements, AI-DLC is appropriate.

#### Principle 6: Retain What Enhances Human Symbiosis

User stories are retained because they align human and AI understanding. Risk registers are retained because they ensure compliance. These retained elements are optimized for real-time use.

**Practical implication:** You still write user stories. You still maintain risk registers. But both are generated by AI and refined by humans, rather than written from scratch by humans.

#### Principle 7: Facilitate Transition Through Familiarity

The methodology preserves underlying relationships between familiar terms while introducing modernized terminology. Sprints become Bolts. Epics become Intents. The renaming signals a fundamental change in cadence and operating model while allowing practitioners to orient quickly.

**Practical implication:** A team practicing Scrum should be able to start practicing AI-DLC in a single day. The concepts map, even though the execution is different.

#### Principle 8: Streamline Responsibilities for Efficiency

AI enables developers to transcend traditional specialized roles (frontend, backend, DevOps, security). Product Owners and developers remain integral, but specialized roles are collapsed.

**Practical implication:** In a small SaaS company, a single developer can work across the full stack because AI handles the specialized knowledge in each domain. The developer validates rather than produces.

#### Principle 9: Minimize Stages, Maximize Flow

AI-DLC minimizes handoffs and transitions while incorporating minimal but sufficient phases for human oversight. These validation points act as a "loss function," pruning wasteful downstream efforts before they grow.

**Practical implication:** There are only three phases (Inception, Construction, Operations). Within each phase, flow is continuous. There are no Sprint boundaries, no Sprint Reviews, no Sprint Planning ceremonies. Validation happens inline, in real-time.

#### Principle 10: No Hard-Wired, Opinionated SDLC Workflows

AI-DLC does not prescribe fixed workflows for different development pathways. Instead, AI recommends the Level 1 Plan based on the given pathway intention. Humans verify and moderate these plans.

**Practical implication:** The same methodology handles greenfield development, brownfield enhancement, bug fixes, and refactoring, but the actual workflow stages differ based on what AI recommends and humans approve. This is the basis for the Level 1 Plan concept (see Section 3).

### 2.2 The Artifact Hierarchy

AI-DLC defines a precise hierarchy of artifacts, each feeding semantically into the next:

```
INTENT
  |
  +-- UNIT (1..n)
       |
       +-- BOLT (1..n per Unit)
            |
            +-- Domain Design
            +-- Logical Design
            +-- Code + Unit Tests
            +-- Deployment Unit
```

#### Intent

A high-level statement of what needs to be achieved: a business goal, a feature, or a technical outcome (e.g., performance scaling). The intent is the starting point for AI-driven decomposition and collaboration. It serves the same role as an Epic in Scrum but with richer semantic content.

**Example:**
```
Develop a recommendation engine for cross-selling products to increase
average order value by 15% within 6 months.
```

#### Unit

A cohesive, self-contained work element derived from an Intent, designed to deliver measurable value. Units are analogous to Subdomains in DDD or Epics in Scrum. Each Unit encompasses user stories that articulate its functional scope. Units are loosely coupled, enabling autonomous development and independent deployment.

**Example Units for the recommendation engine Intent:**
- User Data Collection
- Recommendation Algorithm Selection
- API Integration
- A/B Testing Framework

#### Bolt

The smallest iteration in AI-DLC. Bolts are analogous to Sprints in Scrum but operate on a cadence of hours or days rather than weeks. Each Bolt encapsulates a well-defined scope of work (e.g., a collection of user stories within a Unit). A Unit can be executed through one or more Bolts running in parallel or sequentially.

Bolt execution is explicitly two-part:
1. **AI creates a plan** (human approves)
2. **AI generates code** (human validates)

**Bolt Artifacts:**
- Domain Design (business logic modeled independently of infrastructure)
- Logical Design (domain design extended with NFRs and architectural patterns, includes ADRs)
- Code and Unit Tests
- audit.md (decision trail)

#### Deployment Unit

The operational artifact: packaged executable code (container images, serverless functions), configurations (Helm Charts), infrastructure (Terraform/CloudFormation), and all associated tests (functional, security, load).

### 2.3 The Three Phases

The white paper defines **three** phases: Inception, Construction, and Operations. There is no separate "Discovery" phase in the white paper. Workspace detection, reverse engineering of existing codebases, and brownfield analysis happen as **stages within** Inception or Construction, not as a standalone phase.

#### Phase 1: Inception

**Purpose:** Capture Intents and translate them into Units for development.

**Key Ceremony:** Mob Elaboration (single room, shared screen, led by facilitator).

**Process:**
1. AI asks clarifying questions about the Intent
2. AI elaborates the clarified Intent into user stories, NFRs, and risk descriptions
3. Team validates and provides corrections
4. AI composes stories into cohesive Units
5. Product Owner validates Unit boundaries
6. AI generates PRFAQ (Press Release / FAQ) and suggested Bolts per Unit

For **brownfield** projects, Inception may include workspace analysis stages where AI reverse-engineers the existing codebase into semantic models (static and dynamic) before proceeding with elaboration. This is a stage within Inception, not a separate phase.

**Outputs:**
- Well-defined Units with:
  - PRFAQ
  - User Stories
  - NFR definitions
  - Risk descriptions (mapped to organization's Risk Register)
  - Measurement Criteria (traced to business intent)
  - Suggested Bolts

> The paper states: "Mob Elaboration condenses weeks or even months of sequential work into a few hours, while achieving deep alignment both within the mob and between the mob and the AI."

#### Phase 2: Construction

**Purpose:** Transform Units into tested, operation-ready Deployment Units.

**Key Ceremony:** Mob Construction (all teams in one room, collaborative building).

**Process:**
1. Developer establishes session with AI
2. AI models core business logic using DDD principles (Domain Design)
3. Developers review and validate domain models
4. AI translates domain models to Logical Design with NFRs and architectural patterns
5. Developers evaluate recommendations, approve trade-offs
6. AI generates executable code, mapping to specific services
7. AI auto-generates functional, security, and performance tests
8. Developers review code and test scenarios
9. AI executes all tests, analyzes results, highlights issues
10. AI proposes fixes for failed tests
11. Developers validate, approve fixes, rerun

**Brownfield Extension:** For existing codebases, Construction adds two steps before the standard flow:
1. AI elevates code into semantic models (static: components, responsibilities, relationships; dynamic: interaction patterns for key use cases)
2. Developers review and validate the reverse-engineered models

#### Phase 3: Operations

**Purpose:** Deployment, observability, and maintenance.

**Process:**
1. AI packages into Deployment Units (containers, serverless functions)
2. Developers approve deployment configuration
3. AI analyzes telemetry (metrics, logs, traces) to detect anomalies and predict SLA violations
4. AI integrates with incident runbooks, proposes resolution actions
5. Developers validate and approve mitigations

### 2.4 The Workflow

The overall workflow follows this sequence:

1. **Business Intent received** (greenfield, brownfield, maintenance, etc.)
2. **AI generates Level 1 Plan** (workflow stages to execute)
3. **Team validates/adjusts the Level 1 Plan**
4. **AI recommends Mob Elaboration** (Inception Phase)
5. **AI executes Domain Design, Logical Design, Code Generation** (Construction Phase)
6. **AI executes Testing and Validation**
7. **AI executes Deployment and Operations** (Operations Phase)

At each step, AI performs the generation and humans provide oversight and validation. Every artifact is persisted and serves as "context memory" that AI references across the lifecycle. All artifacts are linked, enabling backward and forward traceability.

> Each step serves as a strategic decision point where human oversight functions like a loss function, catching and correcting errors early before they cascade downstream.

### 2.5 Key Terminology Mapping

| AI-DLC Term | Traditional Equivalent | Key Difference |
|---|---|---|
| Intent | Epic | AI-decomposed, richer semantic content |
| Unit | Subdomain / Epic | DDD-aligned bounded contexts |
| Bolt | Sprint | Hours/days, not weeks. Two-part: plan then execute |
| Mob Elaboration | Sprint Planning + Requirements Workshop | Single session, AI-led, entire team |
| Mob Construction | Sprint Execution + Code Review | Collaborative, real-time AI-assisted building |
| Level 1 Plan | Project Plan / Release Plan | AI-generated workflow of phases, not work items |
| Domain Design | Architecture Design | DDD-specific, AI-generated |
| Logical Design | Detailed Design + ADRs | NFR-aware, pattern-selected |
| Deployment Unit | Release Package | Full stack: code + config + infra + tests |
| PRFAQ | Product Brief | Press-release format, AI-generated |

---

## 3. What Is a "Level 1 Plan"?

### 3.1 The Critical Distinction

The Level 1 Plan is one of the most important and most easily misunderstood concepts in AI-DLC. It is NOT a detailed breakdown of work items. It is NOT a list of tasks. It is NOT a project plan with timelines and assignments.

**The Level 1 Plan is a meta-plan: a plan of which phases and stages to execute for a given intent.**

From Principle 10: "AI recommends the Level 1 Plan based on the given pathway intention." The pathway intention is the type of work being done (greenfield development, brownfield enhancement, bug fix, refactoring, performance optimization, etc.). The Level 1 Plan specifies the sequence of stages the workflow should follow.

Think of it this way:
- **Level 1 Plan:** "For this intent, we should do Inception (full), then Construction (with Domain Design), then Operations (with monitoring)."
- **Level 2 Plan:** Within Inception, the detailed decomposition into Units and user stories.
- **Level 3 Plan:** Within each Unit, the specific Bolts and their implementation steps.

The team reviews, validates, and adjusts the Level 1 Plan before AI proceeds. This is where humans exercise strategic judgment about what level of rigor is appropriate for the intent at hand.

### 3.2 Concrete Examples

#### Example A: Greenfield Application

**Intent:** "Build a self-service customer portal for our SaaS billing platform."

**AI-Generated Level 1 Plan:**

```markdown
# Level 1 Plan: Customer Portal (Greenfield)
Pathway: New Application Development

## Recommended Workflow Stages

### Stage 1: Inception - Full Mob Elaboration
- Clarifying questions session
- User story generation and validation
- NFR definition (security, performance, accessibility)
- Risk assessment against company risk register
- Unit decomposition using DDD principles
- PRFAQ generation
- Bolt planning per Unit
- **Human Validation Point: Product Owner signs off on Units and Bolt plan**

### Stage 2: Construction - Full Design-Build Cycle
- Domain Design per Unit (entities, aggregates, value objects, events)
- Logical Design per Unit (architectural patterns, ADRs)
- Code generation per Bolt
- Test generation and execution per Bolt
- Integration testing across Units
- **Human Validation Point: All tests pass, code reviewed and approved**

### Stage 3: Operations - Full Deployment Package
- Deployment guide generation
- Runbook generation
- Monitoring configuration (alerts, dashboards)
- Release notes
- Cost analysis
- Staging deployment and smoke testing
- Production deployment with rollback plan
- **Human Validation Point: Deployment checklist complete, monitoring active**

## Estimated Duration
- Inception: 1 Mob Elaboration session (2-4 hours)
- Construction: 3-5 Bolts across 4 Units (1-3 days per Bolt)
- Operations: 1 session (2-4 hours)

## Risk Assessment
- Pathway risk: MEDIUM (new application, established technology stack)
- Recommended depth: STANDARD
```

#### Example B: Bug Fix

**Intent:** "Fix: Invoice PDF generation fails for invoices with more than 50 line items."

**AI-Generated Level 1 Plan:**

```markdown
# Level 1 Plan: Invoice PDF Bug Fix
Pathway: Defect Resolution

## Recommended Workflow Stages

### Stage 1: Construction - Targeted Fix
- Skip Inception (defect is well-defined, no requirements elaboration needed)
- Skip Domain Design (existing domain model is correct)
- Skip Logical Design (architecture is unchanged)
- Single Bolt: Diagnose root cause, implement fix, add regression test
- **Human Validation Point: Fix verified, regression test passes, existing tests pass**

### Stage 2: Operations - Minimal
- Release notes only (patch note)
- Skip deployment guide (standard deployment process)
- Skip runbook (no operational changes)
- **Human Validation Point: Deployed to staging, verified with 50+ line item invoice**

## Estimated Duration
- Construction: 1 Bolt (2-4 hours)
- Operations: Deployment (30 minutes)

## Risk Assessment
- Pathway risk: LOW (isolated fix, high reversibility)
- Recommended depth: MINIMAL
```

#### Example C: New Feature on Existing Application (Brownfield)

**Intent:** "Add real-time notification preferences to the existing customer portal. Users should be able to choose email, SMS, or push notification per event type."

**AI-Generated Level 1 Plan:**

```markdown
# Level 1 Plan: Notification Preferences (Brownfield Enhancement)
Pathway: Feature Enhancement on Existing Application

## Recommended Workflow Stages

### Stage 1: Inception - Workspace Analysis & Reverse Engineering
- Reverse-engineer existing codebase into semantic models
  - Static model: components, responsibilities, relationships
  - Dynamic model: interaction patterns for notification-related use cases
- Identify integration points with existing notification infrastructure
- **Human Validation Point: Developer validates reverse-engineered models**

### Stage 2: Inception - Focused Mob Elaboration
- Clarifying questions (scope boundaries, existing notification system)
- User story generation targeting the enhancement only
- NFR definition (real-time delivery SLAs, storage requirements)
- Risk assessment (integration risk with existing system)
- Unit decomposition (likely 2-3 Units)
- Bolt planning
- **Human Validation Point: Product Owner signs off, tech lead confirms integration approach**

### Stage 3: Construction - Design-Build with Integration Focus
- Domain Design incorporating existing domain model
- Logical Design with integration architecture
- Code generation per Bolt
- Integration tests with existing notification system
- **Human Validation Point: All tests pass, integration verified in staging**

### Stage 4: Operations - Enhancement Deployment
- Migration plan (database schema changes, if any)
- Deployment guide (incremental, feature-flagged)
- Monitoring additions (notification delivery metrics)
- Release notes
- **Human Validation Point: Feature flag enabled in staging, metrics flowing**

## Estimated Duration
- Inception (workspace analysis): 1-2 hours (automated analysis + developer review)
- Inception (Mob Elaboration): 1 session (2-3 hours)
- Construction: 2-4 Bolts across 2-3 Units (1-2 days per Bolt)
- Operations: 1 session (1-2 hours)

## Risk Assessment
- Pathway risk: MEDIUM (integration with existing system)
- Recommended depth: STANDARD
- Key risk: Backward compatibility with existing notification consumers
```

Note that in Example C, workspace analysis and reverse engineering appear as a **stage within Inception**, not as a separate phase. The white paper places reverse engineering as a preliminary step that feeds into the elaboration process, keeping the methodology at three phases.

---

## 4. Mob Elaboration and Mob Construction for Remote/Virtual Teams

### 4.1 Adapting the "Single Room" to Remote Work

The white paper describes Mob Elaboration and Mob Construction as in-person ceremonies: "This happens in a single room with a shared screen led by a facilitator." For remote and distributed teams, the principles remain identical but the logistics shift to video conferencing tools.

The key insight is that the "shared screen" is the AI tool. Everyone watches the same AI interaction. The facilitator types prompts, the team discusses on the call, and corrections are fed back through the facilitator.

### 4.2 Inception Phase: Mob Elaboration (Remote)

**Who is the Facilitator?**

The facilitator is the person sharing their screen on the video call, driving the AI tool, and moderating the mob discussion. In a small SaaS company, this is typically:

- The **CTO** or **VP of Engineering** (if they are still hands-on)
- The **Lead Engineer** or **Tech Lead**
- The **most senior full-stack developer**

The facilitator must understand both the business context and the technical architecture well enough to interpret team feedback and translate it into effective AI prompts. They do not need to be the most experienced developer, but they must be comfortable driving the AI tool and managing group discussion flow.

**How the Intent Reaches the Team (Before the Session)**

Before the Mob Elaboration session is scheduled, the **Product Owner** is responsible for:

1. **Identifying the business need**: The PO recognizes a gap, opportunity, or customer request. In a SaaS company, this often comes from customer feedback, sales team requests, competitive analysis, or strategic planning.

2. **Articulating the Intent**: The PO writes a 1-3 sentence Intent statement in business language. This is NOT a requirements document — it is a concise statement of what the business wants to achieve and why. Example:
   ```
   Build a self-service customer portal where SaaS customers can view invoices,
   manage subscriptions, update payment methods, and download usage reports.
   Business driver: Reduce support ticket volume by 40% (currently 60% of tickets
   are billing-related inquiries that customers could self-serve).
   ```

3. **Communicating the Intent to the team**: The PO shares the Intent with the Tech Lead/facilitator, typically via:
   - A Slack/Teams message: "I'd like to schedule a Mob Elaboration session for this Intent: [paste Intent]"
   - A brief 15-minute 1:1 with the Tech Lead to discuss scope and identify who should attend
   - An Azure DevOps work item at the Epic level (for tracking and stakeholder visibility)

4. **Scheduling the session**: The PO and facilitator agree on timing. The PO sends a calendar invite to the full team (developers, QA, DevOps) with the Intent statement attached so everyone can come prepared with initial thoughts.

> **Key point:** The PO owns the "what" and "why." The facilitator (Tech Lead) owns the "how" of the session. The PO does NOT need to write detailed requirements — that is what the Mob Elaboration session with AI will produce. The PO only needs to articulate the business objective clearly enough for AI to begin asking clarifying questions.

**Detailed Remote Walkthrough: Building a Customer Portal for a SaaS Billing Platform**

**Pre-session Setup (15 minutes before):**

1. Facilitator creates the project workspace and AI session
2. Facilitator types the setup prompt (from the white paper's Appendix A):
   ```
   We will work on building an application today. All documents will be stored
   in the aidlc-docs folder. Throughout our session I'll ask you to plan your
   work ahead and create an md file for the plan. You may work only after I
   approve said plan. Plans go in aidlc-docs/plans, requirements in
   aidlc-docs/requirements, user stories in aidlc-docs/stories, design
   artifacts in aidlc-docs/design/artefacts, and prompts in
   aidlc-docs/prompts.md. Create the necessary folders.
   ```
3. Facilitator opens Zoom/Teams/Google Meet and shares their screen showing the AI tool

**Phase 1: Intent Clarification (30-45 minutes)**

1. Facilitator types the Intent:
   ```
   Build a self-service customer portal where SaaS customers can view invoices,
   manage subscriptions, update payment methods, and download usage reports.
   ```

2. AI generates clarifying questions (displayed on shared screen for everyone to see):
   - "Who are the primary users? Account admins only, or all team members?"
   - "Should subscription changes (upgrades/downgrades) take effect immediately or at the next billing cycle?"
   - "Do you need multi-currency support?"
   - "What is the authentication model? SSO, email/password, or both?"
   - "Are there regulatory requirements for invoice storage (e.g., tax compliance, data retention)?"
   - "What existing billing system are you integrating with (Stripe, Chargebee, custom)?"
   - "Should usage reports be real-time or have a reporting delay?"

3. Product Owner answers live on the call. The facilitator types the responses:
   ```
   - Primary users: Account admins AND billing contacts (separate permission model)
   - Subscription changes: Take effect at next billing cycle, with immediate
     preview of prorated charges
   - Multi-currency: Yes, USD and EUR initially, with ability to add more
   - Auth: SSO via SAML for enterprise customers, email/password for others
   - Regulatory: SOC 2 compliance required, 7-year invoice retention
   - Billing system: Stripe, already integrated for payments
   - Usage reports: 1-hour delay acceptable, refreshed every hour
   ```

4. AI saves clarifications to `aidlc-docs/clarifications.md`

**Phase 2: User Story Generation (45-60 minutes)**

> **Participants actively involved:** The Product Owner is the primary reviewer during this phase. Developers provide technical feasibility input. QA identifies testability gaps. The facilitator drives the AI and incorporates all feedback.

5. AI generates user stories based on clarified intent and saves them to `aidlc-docs/stories/user-stories.md`. Each story is a section within this file. The stories appear on the shared screen:

   ```markdown
   ## US-001: View Invoice History
   **As a** billing contact
   **I want** to view a chronological list of all invoices for my account
   **So that** I can track spending and verify charges

   **Acceptance Criteria:**
   - [ ] Displays all invoices from Stripe with date, amount, status, currency
   - [ ] Supports pagination (25 per page)
   - [ ] Allows filtering by date range and status (paid, pending, failed)
   - [ ] Shows invoice total in account's primary currency
   - [ ] Invoices older than 7 years are archived but retrievable

   ## US-002: Download Invoice PDF
   **As a** billing contact
   **I want** to download any invoice as a PDF
   **So that** I can share it with my finance team or file for tax purposes

   **Acceptance Criteria:**
   - [ ] PDF includes company logo, tax ID, line items, totals
   - [ ] PDF complies with local tax invoice requirements
   - [ ] Bulk download option for date ranges (ZIP archive)
   - [ ] PDFs stored for 7 years per SOC 2 retention policy
   ```

6. Team reviews ON SCREEN together. Backend developer speaks up: "US-002 needs to handle multi-currency. The PDF should show the original charge currency and a converted total in the account's primary currency." Facilitator tells the AI assistant:
   ```
   Update US-002: Add acceptance criterion - PDF shows original charge
   currency and converted total in account's primary currency with
   exchange rate used.
   ```

7. AI updates the story. Frontend developer adds: "We need a story for the subscription change preview. The prorated charges calculation should show before the user confirms." QA engineer adds: "We need a story for error states when Stripe is unavailable."

8. This process continues until all user stories are reviewed. The **Product Owner explicitly approves** the final set of stories: "These stories capture what we need. I'm satisfied with the acceptance criteria." AI saves the approved stories to `aidlc-docs/stories/user-stories.md`. Each story gets a status marker (`[APPROVED]`) in the file.

> **File structure note:** User stories live in `aidlc-docs/stories/user-stories.md` as a single file containing all stories for the Intent. Stories are organized by functional area. When Units are created in the next phase, the Unit definition references story IDs (e.g., "Stories: US-001, US-002, US-003") but does NOT duplicate the story content. The story file is the single source of truth for story details. The Unit file (`aidlc-docs/requirements/units.md`) contains the Unit boundaries, rationale, dependencies, and story ID references.

**Phase 3: NFR and Risk Definition (30 minutes)**

> **Participants actively involved:** Tech Lead and developers define performance and architecture constraints. Security engineer (or security-aware developer) reviews security and compliance. PO validates that NFRs align with customer expectations (e.g., acceptable load times). QA validates that NFRs are testable.

9. AI generates Non-Functional Requirements and saves them to `aidlc-docs/requirements/nfr.md`:
   ```markdown
   # Non-Functional Requirements: Customer Portal

   ## Performance
   - Invoice list loads in < 2 seconds for accounts with up to 10,000 invoices
   - PDF generation completes in < 5 seconds
   - Usage report refresh < 30 seconds
   - API response times < 500ms at p95 under normal load

   ## Security
   - All API endpoints require authentication
   - Billing contacts can only see their own account's data
   - SSO sessions expire after 8 hours of inactivity
   - All PII encrypted at rest (AES-256) and in transit (TLS 1.3)
   - Rate limiting on PDF generation: max 10 per minute per account

   ## Compliance
   - SOC 2 Type II audit trail for all invoice access
   - 7-year data retention with automated archival
   - GDPR: invoices have legal retention obligation overriding right-to-erasure;
     user profile data can be anonymized on request

   ## Availability
   - 99.9% uptime SLA for portal API
   - Graceful degradation when Stripe is unavailable (cached data shown with
     "last updated" timestamp)
   ```

10. AI generates Risk descriptions and saves them to `aidlc-docs/requirements/risks.md`. If the organization has an existing Risk Register, AI maps each risk to the register's categories:
    ```markdown
    # Risk Assessment: Customer Portal

    ## RISK-001: Stripe API Rate Limits
    **Category:** Technical / External Dependency
    **Likelihood:** Medium | **Impact:** High
    **Description:** Bulk PDF generation for large accounts could hit Stripe
    invoice API rate limits (100 requests/second).
    **Mitigation:** Implement request queuing with backoff. Cache invoice data
    locally after first fetch. Batch PDF generation with progress indicator.

    ## RISK-002: SSO Integration Complexity
    **Category:** Technical / Integration
    **Likelihood:** Medium | **Impact:** Medium
    **Description:** Enterprise customers use different IdPs (Okta, Azure AD,
    OneLogin). SAML configuration varies significantly between providers.
    **Mitigation:** Start with Okta and Azure AD (covers 80% of customers).
    Use a SAML library that abstracts IdP differences. Build an SSO test
    harness for validating new IdP integrations.

    ## RISK-003: Metrics Pipeline Dependency
    **Category:** Organizational / Cross-team
    **Likelihood:** High | **Impact:** Medium
    **Description:** UNIT-004 (Usage Reporting) depends on the internal metrics
    pipeline, which is owned by a different team. Their availability and
    API stability are not guaranteed.
    **Mitigation:** Delay UNIT-004 until pipeline team confirms API contract.
    Build against a mock API initially. Include pipeline team in Mob
    Construction for UNIT-004.

    ## RISK-004: Data Migration for Existing Customers
    **Category:** Operational / Data
    **Likelihood:** Low | **Impact:** High
    **Description:** Existing customers have no notification preferences stored.
    First login experience must handle missing data gracefully.
    **Mitigation:** Default preferences applied on first access. Migration
    script to backfill defaults for all existing accounts before launch.
    ```

11. Security engineer reviews: "RISK-001 mitigation is good. We also need to add rate limiting on PDF generation from the client side to prevent abuse — I see you already added it to the NFRs. For compliance, the GDPR point needed correction and I see it's been updated. Add RISK-005 for PCI compliance: we're handling payment method data through Stripe Elements which keeps us out of PCI scope, but we need to document that explicitly." Facilitator feeds correction to AI, which updates `risks.md`.

12. **Tech Lead approves** NFRs and risk assessment: "NFRs are realistic and testable. Risks are well-identified." AI marks both files as `[APPROVED]`.

**Phase 4: Unit Decomposition (30 minutes)**

11. AI decomposes into Units and saves to `aidlc-docs/requirements/units.md`. Each Unit includes enough context for both PO and technical team to evaluate:

    ```markdown
    ## UNIT-001: Invoice Management
    **Business value:** Customers can self-serve all invoice-related inquiries,
    eliminating ~25% of current support tickets.
    **Stories included:**
    - US-001: View Invoice History (billing contact views chronological invoice list)
    - US-002: Download Invoice PDF (billing contact downloads PDFs with multi-currency)
    - US-003: Invoice Search and Filtering (billing contact searches by date, amount, status)
    - US-004: Invoice Archival Access (billing contact retrieves archived invoices)
    **Bounded context:** Invoice viewing, PDF generation, archival
    **External dependencies:** Stripe Invoice API
    **Estimated Bolts:** 2 (invoice listing + PDF generation)

    ## UNIT-002: Subscription Management
    **Business value:** Customers can change plans without contacting support,
    eliminating ~20% of current support tickets. Proration previews reduce
    billing disputes.
    **Stories included:**
    - US-005: View Current Subscription (billing contact sees plan details, renewal date)
    - US-006: Preview Plan Change (billing contact sees prorated charges before confirming)
    - US-007: Change Subscription Plan (billing contact upgrades/downgrades)
    - US-008: Cancel Subscription (billing contact cancels with grace period)
    **Bounded context:** Plan changes, proration preview, cancellation
    **External dependencies:** Stripe Subscription API, Stripe Price API
    **Estimated Bolts:** 2-3 (subscription display, proration preview, plan change + cancellation)

    ## UNIT-003: Payment Methods
    **Business value:** Customers can update expired cards without support
    intervention, reducing failed payment churn.
    **Stories included:**
    - US-009: View Payment Methods (billing contact sees saved cards)
    - US-010: Add/Update Payment Method (billing contact adds new card via Stripe Elements)
    - US-011: Set Default Payment Method (billing contact designates primary card)
    **Bounded context:** Card management, payment method CRUD
    **External dependencies:** Stripe PaymentMethod API, Stripe SetupIntent API
    **Estimated Bolts:** 1-2 (payment method CRUD, Stripe Elements integration)

    ## UNIT-004: Usage Reporting
    **Business value:** Customers can track their own usage without requesting
    reports from the Customer Success team. CSV export enables finance teams
    to integrate with their own tools.
    **Stories included:**
    - US-012: View Usage Dashboard (user sees usage metrics with charts)
    - US-013: Download Usage Report (user exports usage data as CSV)
    - US-014: Set Usage Alerts (user configures threshold-based alerts)
    **Bounded context:** Usage metrics aggregation, report generation, CSV export
    **External dependencies:** Internal metrics pipeline, data warehouse
    **Estimated Bolts:** 2 (dashboard + charting, CSV export + alerts)
    ```

12. **Product Owner validates the business value and story coverage** of each Unit: "The business values look right. Usage Reporting should also include a dashboard view, not just downloadable reports — the user story US-012 covers this but the acceptance criteria should include charts." **Tech Lead validates the technical decomposition**: "UNIT-001 and UNIT-002 can run in parallel since they use different Stripe APIs. UNIT-003 is relatively small and could run in parallel too. UNIT-004 has a dependency on the metrics pipeline team, so it should start last."

> **Why this level of detail matters for PO approval:** The PO is not a technical person. Showing only story IDs (US-001, US-002) is insufficient for meaningful validation. Each Unit must include: (a) business value in plain language, (b) story titles (not just IDs) so the PO can see what's included, (c) estimated scope (number of Bolts) so the PO understands the investment. The PO approves the Unit boundaries and business priorities. The Tech Lead approves the technical decomposition and parallelization strategy.

**Phase 5: PRFAQ Generation (15 minutes)**

13. AI generates a PRFAQ (Press Release / Frequently Asked Questions) and saves it to `aidlc-docs/requirements/prfaq.md`. The PRFAQ is written as if the feature has already launched:

    ```markdown
    # PRFAQ: Self-Service Customer Portal

    ## Press Release

    **[Company Name] Launches Self-Service Customer Portal, Empowering Customers
    to Manage Billing Without Support Tickets**

    [City, Date] — [Company Name] today announced the launch of a self-service
    customer portal that enables customers to view invoices, manage subscriptions,
    update payment methods, and track usage — all without contacting support.

    The portal addresses the #1 source of support tickets: billing inquiries.
    Currently, 60% of support tickets involve billing questions that customers
    could resolve themselves with proper tooling. The portal is expected to reduce
    support ticket volume by 40% within the first quarter after launch.

    Key capabilities include:
    - **Invoice Management:** View, search, filter, and download invoices as PDFs
      with full multi-currency support
    - **Subscription Management:** Preview prorated charges before changing plans,
      with grace periods for failed payments
    - **Payment Methods:** Securely update cards using Stripe Elements, with
      automatic retry for failed charges
    - **Usage Reporting:** Interactive dashboards with CSV export for finance teams

    ## Customer FAQ

    **Q: How do I access the portal?**
    A: Enterprise customers sign in via SSO. Other customers use email/password.

    **Q: Can I see invoices from before the portal launched?**
    A: Yes. All historical invoices from Stripe are available, with 7-year retention.

    **Q: What happens if I downgrade my plan?**
    A: You'll see a preview of prorated charges before confirming. The change takes
    effect at your next billing cycle.

    ## Internal FAQ

    **Q: What's the estimated development effort?**
    A: 4 Units, approximately 7-9 Bolts total, estimated 2-3 weeks.

    **Q: What are the main technical risks?**
    A: Stripe API rate limits during bulk PDF generation. Metrics pipeline latency
    for real-time usage dashboards. SSO integration complexity varies by customer IdP.
    ```

14. **Product Owner reviews**: "The press release captures the value proposition well. Add a line about the mobile-responsive design — our customers access billing on mobile frequently." AI updates.

**Phase 6: Bolt Planning (15 minutes)**

15. AI generates a Bolt plan for each Unit and saves to `aidlc-docs/plans/bolt-plan.md`:

    ```markdown
    # Bolt Plan

    ## UNIT-001: Invoice Management (2 Bolts)

    ### BOLT-001: Invoice Listing and Search
    - Scope: US-001 (View Invoice History) + US-003 (Search and Filtering)
    - Estimated duration: 4-6 hours
    - Steps: Database query layer, API endpoints, pagination, filtering
    - Dependencies: None (can start immediately)

    ### BOLT-002: Invoice PDF Generation and Archival
    - Scope: US-002 (Download PDF) + US-004 (Archival Access)
    - Estimated duration: 4-8 hours
    - Steps: PDF template, Stripe invoice data mapping, multi-currency formatting,
      archival retrieval, bulk download ZIP
    - Dependencies: BOLT-001 (needs invoice listing to work)

    ## UNIT-002: Subscription Management (3 Bolts)

    ### BOLT-003: Subscription Display
    - Scope: US-005 (View Current Subscription)
    - Estimated duration: 2-4 hours
    - Steps: Stripe subscription data fetching, plan details display, renewal info
    - Dependencies: None

    ### BOLT-004: Proration Preview
    - Scope: US-006 (Preview Plan Change)
    - Estimated duration: 4-6 hours
    - Steps: Stripe proration API integration, preview UI, circuit breaker for
      Stripe unavailability
    - Dependencies: BOLT-003

    ### BOLT-005: Plan Change and Cancellation
    - Scope: US-007 (Change Plan) + US-008 (Cancel Subscription)
    - Estimated duration: 4-6 hours
    - Steps: Stripe subscription update, webhook handling, grace period logic,
      cancellation flow
    - Dependencies: BOLT-004

    ## UNIT-003: Payment Methods (1 Bolt)

    ### BOLT-006: Payment Method CRUD
    - Scope: US-009, US-010, US-011
    - Estimated duration: 4-6 hours
    - Steps: Stripe Elements integration, payment method API, default method selection
    - Dependencies: None (can run in parallel with other Units)

    ## UNIT-004: Usage Reporting (2 Bolts)

    ### BOLT-007: Usage Dashboard
    - Scope: US-012 (View Usage Dashboard)
    - Estimated duration: 6-8 hours
    - Steps: Metrics pipeline integration, data aggregation, chart components
    - Dependencies: Metrics pipeline team availability

    ### BOLT-008: CSV Export and Alerts
    - Scope: US-013 (Download Report) + US-014 (Set Alerts)
    - Estimated duration: 4-6 hours
    - Steps: CSV generation, download endpoint, alert threshold storage, alert
      evaluation job
    - Dependencies: BOLT-007

    ## Execution Order (Recommended)
    - Day 1: BOLT-001, BOLT-003, BOLT-006 (parallel — independent Units)
    - Day 2: BOLT-002, BOLT-004 (parallel — depend on Day 1 results)
    - Day 3: BOLT-005, BOLT-007 (parallel, BOLT-007 needs metrics team)
    - Day 4: BOLT-008 (depends on BOLT-007)

    ## Total Estimated Duration: 3-5 days (with parallelization)
    ```

16. **Tech Lead reviews**: "The execution order looks right. BOLT-006 can definitely run Day 1 in parallel. I want to assign BOLT-007 and BOLT-008 to [Developer Name] since they built the metrics pipeline." **Product Owner reviews**: "The scope-to-Bolt mapping looks reasonable. I want UNIT-002 (Subscription Management) prioritized because subscription changes are 35% of our support tickets."

17. All artifacts committed to the repo. Session recording saved. Mob Elaboration is complete.

**Total session time: 2.5-3.5 hours**

### 4.2.1 Session Boundaries: When Does Mob Elaboration End and Mob Construction Begin?

Mob Elaboration and Mob Construction are **separate sessions**, typically on different days. Here's why and how the handoff works:

**Why separate sessions?**
- Mob Elaboration is mentally intensive. After 3+ hours of requirements discussion, the team needs time to digest.
- Between sessions, team members can review the generated artifacts individually and come back with concerns they didn't think of in the moment.
- The PO may need time to validate priorities with stakeholders before Construction begins.
- Different team members may lead each session (see facilitator differences below).

**The handoff between sessions:**
1. **End of Mob Elaboration:** All artifacts are committed to the repo (`aidlc-docs/stories/`, `aidlc-docs/requirements/`, `aidlc-docs/plans/`). The facilitator sends a summary to the team channel: "Mob Elaboration complete. 4 Units defined, 8 Bolts planned. Artifacts in repo. Construction session scheduled for [date/time]."
2. **Between sessions (hours or 1-2 days):** Team members review artifacts at their own pace. They may add comments or concerns asynchronously (via Slack, PR comments, or by editing the files directly).
3. **Start of Mob Construction:** The facilitator opens a new AI session, points the AI at the existing `aidlc-docs/` folder, and says: "We completed Mob Elaboration. The artifacts are in aidlc-docs/. Please review the intent, user stories, units, and bolt plan, then begin Construction for UNIT-002." The AI reads all artifacts and has full context.

**Can they be the same session?** For small, well-scoped Intents (e.g., 1-2 Units, 2-3 Bolts), a team may choose to continue directly into Construction after Mob Elaboration in the same session. This is a team decision, not a methodology constraint. However, for larger Intents (4+ Units), splitting into separate sessions is strongly recommended.

**How does a different facilitator pick up?**
The `aidlc-docs/` folder IS the handoff mechanism. All artifacts are committed to the repo. A new facilitator:
1. Opens the project
2. Starts a new AI session
3. Points the AI at the existing artifacts: "Review the artifacts in aidlc-docs/ and summarize where we are."
4. The AI reads all files and understands the current state: Intent, Units, Bolts, approved stories, NFRs, risks
5. The new facilitator can continue from exactly where the previous session left off

This is why committing artifacts to the repo is essential — it is the "memory" that enables continuity across sessions, facilitators, and even AI tools. The artifacts are human-readable markdown, so anyone (human or AI) can pick up the context by reading the files.

### 4.3 Construction Phase: Mob Construction (Remote)

**Who is the Facilitator?**

During Construction, the facilitator role requires **deep technical knowledge** of the codebase. The white paper says "all teams collected in a single room, similar to Mob Elaboration" for Construction, but the facilitator emphasis shifts:

- **Inception facilitator emphasis:** Balance of business understanding and technical knowledge. Must translate PO requirements into effective AI prompts. Must understand domain well enough to validate AI-generated stories and units.
- **Construction facilitator emphasis:** Deep technical knowledge. Must evaluate AI-generated domain models, architectural decisions, and code quality. Must catch incorrect patterns, missing edge cases, and integration issues.

**In a small SaaS company (5-10 people), this is often the same person** — the Tech Lead or CTO who has both business context and technical depth. This is fine. The distinction is not about a different person, but about a different mindset: during Inception you're thinking "does this capture what the business needs?"; during Construction you're thinking "is this technically correct and well-architected?"

If your team has enough depth, you might have the **CTO facilitate Inception** (broader business perspective) and a **senior backend developer facilitate Construction** (deeper code-level expertise). But this is not required.

**Who else is on the call?**
- All developers assigned to the Units being constructed
- QA engineer (to validate test coverage in real-time)
- Product Owner is **optional** during Construction (they are welcome to attend but their role is minimal — Construction is primarily a technical exercise)

**Detailed Remote Walkthrough: Constructing UNIT-002 (Subscription Management)**

**Session Setup:**

1. Developers join the video call. Facilitator shares screen with the AI tool open
2. Facilitator establishes context:
   ```
   Starting Construction for UNIT-002: Subscription Management.
   Context: Customer portal for SaaS billing platform.
   [Attaches intent.md, stories for UNIT-002, nfr.md]
   Begin with Domain Design.
   ```

**Step 1: Domain Design (30-45 minutes)**

3. AI generates domain model:
   ```markdown
   ## Domain Model: Subscription Management

   ### Entities
   - **Subscription**: id, accountId, planId, status, currentPeriodStart,
     currentPeriodEnd, cancelAtPeriodEnd
   - **Plan**: id, name, priceId, currency, interval, amount, features[]

   ### Value Objects
   - **ProrationPreview**: currentPlanAmount, newPlanAmount, prorationAmount,
     effectiveDate, creditAmount, chargeAmount
   - **BillingCycle**: start, end, interval

   ### Domain Events
   - SubscriptionChangeRequested(subscriptionId, fromPlanId, toPlanId, requestedBy)
   - SubscriptionChangeConfirmed(subscriptionId, newPlanId, effectiveDate)
   - SubscriptionCancellationRequested(subscriptionId, cancelAtPeriodEnd, reason)

   ### Repositories
   - SubscriptionRepository: findByAccountId(), findById(), save()
   - PlanRepository: findAll(), findById(), findByPriceId()

   ### Aggregates
   - SubscriptionAggregate (root: Subscription, contains: current Plan reference)
   ```

4. Backend developer: "We need a grace period for failed payments before cancellation. The domain model should have a `failedPaymentCount` on Subscription and a `GracePeriodExpired` event."

5. Frontend developer: "The subscription change confirmation needs a preview of prorated charges. The `ProrationPreview` value object looks right, but we need to show it BEFORE the user confirms, not after."

6. Facilitator feeds both corrections to AI. AI updates the domain model.

**Step 2: Logical Design (30 minutes)**

7. AI generates Logical Design with ADRs:
   ```markdown
   ## ADR-001: Proration Calculation Strategy
   **Context:** When a customer changes plans mid-cycle, we need to calculate
   prorated charges.
   **Decision:** Delegate proration calculation to Stripe's proration API rather
   than implementing our own.
   **Rationale:** Stripe handles edge cases (tax, multi-currency conversion,
   partial periods) that would be complex to replicate. Our domain model stores
   the preview result but does not compute it.
   **Consequences:** Dependency on Stripe API for preview; need fallback if
   Stripe is unavailable.

   ## ADR-002: Event-Driven Subscription Updates
   **Context:** Subscription changes need to be reflected across the portal.
   **Decision:** Use Stripe webhooks to drive subscription state changes rather
   than polling.
   **Rationale:** Real-time updates, reduced API calls, Stripe-recommended pattern.
   **Consequences:** Need webhook endpoint, signature verification, idempotent
   event processing.
   ```

8. DevOps engineer: "I agree with the webhook approach, but we need a dead letter queue for failed webhook processing. Also, add an ADR for the webhook retry strategy." Facilitator types the request.

**Step 3: Code Generation (per Bolt)**

9. AI generates code for BOLT-001 (Subscription Entity + Repository + Stripe Integration):
   ```typescript
   // AI generates:
   // - src/subscriptions/entities/subscription.entity.ts
   // - src/subscriptions/repositories/subscription.repository.ts
   // - src/subscriptions/services/stripe-subscription.service.ts
   // - src/subscriptions/events/subscription-changed.event.ts
   // - tests/subscriptions/subscription.service.spec.ts
   ```

10. Team reviews code on screen. Backend developer: "The Stripe service should use a circuit breaker for the proration preview endpoint. If Stripe is down, show the user a message rather than blocking." Frontend developer: "The API response should include the plan features comparison so the UI can show what changes."

**Step 4: Testing and Validation (per Bolt)**

11. AI runs tests, displays results. Any failures are discussed and fixed in real-time. AI proposes fixes; developers approve or redirect.

12. Bolt complete. AI documents the Bolt results including test evidence and any corrections made. Move to next Bolt.

### 4.4 Operations Phase (Remote)

**Who is the Facilitator?**

The facilitator for Operations is typically the **DevOps/Infrastructure person** on the team. In a small SaaS company without a dedicated DevOps role, this defaults to the **Tech Lead** or the developer most experienced with deployment and infrastructure.

**Remote Walkthrough:**

1. Same video call format. Facilitator shares screen
2. AI generates deployment configuration:
   ```markdown
   ## Deployment Configuration
   - Docker image: customer-portal:1.0.0
   - Required environment variables: STRIPE_API_KEY, DATABASE_URL,
     WEBHOOK_SECRET, SSO_SAML_CERT
   - Database migrations: 3 new tables (subscriptions, plans, usage_reports)
   - Feature flag: CUSTOMER_PORTAL_ENABLED (default: false)
   ```

3. DevOps/infra person validates: "The Docker image should use multi-stage builds. Also, we need health check endpoints for the load balancer. And the migration should be backward-compatible so we can roll back the code without rolling back the database."

4. AI generates monitoring dashboards, alerting rules:
   ```json
   {
     "alerts": [
       {
         "name": "portal-error-rate",
         "threshold": "1% over 5 minutes",
         "severity": "critical",
         "channels": ["pagerduty", "slack-ops"]
       },
       {
         "name": "stripe-api-latency",
         "threshold": "p99 > 2000ms over 5 minutes",
         "severity": "warning",
         "channels": ["slack-ops"]
       }
     ]
   }
   ```

5. Team reviews alerting rules, runbooks. DevOps person: "The Stripe latency alert threshold should be 3000ms, not 2000ms. Stripe has occasional slow responses that are normal."

6. AI generates rollback plan, team validates. AI deploys to staging (or generates the deployment commands for human execution). Team validates in staging.

---

## 5. Applying AI-DLC in a Small SaaS Company Using Scrum

### 5.1 The Starting Point: Typical Small SaaS Scrum Setup

**Team composition:**
- 1 Product Owner / Product Manager
- 1 Scrum Master (often part-time, doubling as developer)
- 5-8 Developers (mix of frontend, backend, full-stack)
- 1 QA Engineer (often part-time)
- 1 DevOps / Infrastructure person (often part-time)

**Current process:**
- 2-week sprints
- Azure DevOps for ticket tracking with Epics, Stories, Tasks, Bugs
- Story point estimation (Fibonacci: 1, 2, 3, 5, 8, 13)
- Daily standups (15 min)
- Sprint Planning (2-4 hours)
- Sprint Review / Demo (1 hour)
- Sprint Retrospective (1 hour)
- Velocity tracked per sprint
- CI/CD pipeline with automated tests

### 5.2 The Migration Map

| Scrum Concept | AI-DLC Equivalent | What Changes |
|---|---|---|
| Epic | Intent | AI decomposes instead of PM manually breaking down. Richer semantic content with PRFAQ. |
| User Story | User Story (retained) | AI generates first draft from Intent. Humans validate and refine. Format unchanged. |
| Task / Sub-task | Steps within a Bolt | Bolts contain step-by-step plans with checkboxes. AI executes, humans validate. |
| Sprint (2 weeks) | Bolt (hours/days) | Iteration cadence drops dramatically. No fixed timebox. Bolt is done when its acceptance criteria pass. |
| Sprint Planning | Mob Elaboration | Replaces both Sprint Planning and Backlog Refinement. Single session, AI-led, entire team. |
| Sprint Review / Demo | Continuous validation during Mob Construction | Validation happens in real-time during construction, not at the end of a timebox. |
| Sprint Retrospective | Continuous reflection via audit trail | The persistent artifact trail (audit.md) enables data-driven reflection. Teams review what worked after each Intent completes. |
| Daily Standup | Mostly eliminated | Bolts are short enough that async status updates replace synchronous standups. |
| Story Points | Eliminated | AI handles sizing implicitly through Level 1 Plan depth assessment. Business Value replaces velocity as north-star metric. |
| Velocity (points/sprint) | Throughput (Bolts/day) + Business Value | Measured by completed Bolts and business outcomes, not abstract point values. |
| Scrum Master | Facilitator | Drives Mob sessions, manages AI interaction, removes blockers. No longer tracks velocity or enforces Scrum rituals. |
| Product Owner | Product Owner (retained) | Role enhanced: validates AI-generated artifacts, makes business decisions at human validation points. Less time writing, more time approving. |
| Azure DevOps Board | Repository-based artifact tracking | AI-DLC artifacts live in the project repo (`aidlc-docs/`). AI tracks status through persisted artifacts. |
| Backlog | Intent-driven workflow | Instead of a groomed backlog of stories, maintain business Intents. AI decomposes on demand during Mob Elaboration. |
| Definition of Done | Human validation points at each stage | Explicit validation at each stage boundary replaces a checklist. Human must approve before AI proceeds. |

### 5.3 Week-by-Week Adoption Plan

#### Week 1: Learn and Prepare

**Goals:** Team understands AI-DLC concepts. Tooling is set up. First pilot Intent selected.

| Day | Activity | Who | Duration |
|-----|----------|-----|----------|
| Monday | Team reads this document (Sections 1-3) | Everyone | 1 hour |
| Monday | Install AI coding tool, run through a tutorial workflow | Developers | 1 hour |
| Tuesday | Workshop: AI-DLC concepts, Q&A, compare to current Scrum process | Facilitator + Team | 2 hours |
| Wednesday | Select pilot Intent: choose a small, well-understood feature from the current backlog | PO + Tech Lead | 30 min |
| Wednesday | Set up AI tool access for all team members | DevOps | 1 hour |
| Thursday | Dry run: Facilitator practices driving AI tool through Intent clarification solo | Facilitator | 1 hour |
| Friday | Normal sprint work continues (AI-DLC is additive this week, not replacing anything) | Team | Full day |

**Pilot Intent criteria:**
- Small enough to complete in 2-3 days
- Well-understood domain (reduces risk of AI confusion)
- Not on the critical path (if the pilot goes slowly, no deadlines missed)
- Has clear acceptance criteria the team can validate

#### Week 2: First Mob Elaboration

**Goals:** Run the first Mob Elaboration session. Produce AI-DLC artifacts for the pilot Intent. Continue normal sprint work in parallel.

| Day | Activity | Who | Duration |
|-----|----------|-----|----------|
| Monday | First Mob Elaboration session (see Section 4.2 for detailed walkthrough) | Full team via Zoom | 2-3 hours |
| Monday | Debrief: What worked? What was awkward? What do we adjust? | Full team | 30 min |
| Tuesday | Review AI-generated artifacts (stories, NFRs, Units, Bolts) | PO + Tech Lead | 1 hour |
| Tuesday | Approve Level 1 Plan for pilot Intent | PO + Tech Lead | 15 min |
| Wed-Thu | Normal sprint work continues | Team | Full days |
| Friday | Compare: AI-generated artifacts vs. what Scrum would have produced for same feature | Team discussion | 30 min |

**Expected friction points:**
- Facilitator may struggle with prompting AI effectively (this improves rapidly with practice)
- Team may feel AI-generated stories are too generic (they refine during mob session)
- Some team members may be skeptical (let the artifacts speak for themselves)

#### Week 3: First Mob Construction

**Goals:** Execute the pilot Intent through Mob Construction. Complete at least one Bolt. Validate the full flow.

| Day | Activity | Who | Duration |
|-----|----------|-----|----------|
| Monday | Mob Construction session for pilot Intent (see Section 4.3) | Full team via Zoom | 3-4 hours |
| Monday | First Bolt completed: Domain Design, Logical Design, Code, Tests | Team | (part of above) |
| Tuesday | Second Bolt if needed. Or: developers work independently on remaining Bolts | Developers | Full day |
| Wednesday | Validation and integration. Run full test suite. | Developers + QA | Half day |
| Wednesday | Operations artifacts generated. Deployment to staging. | Facilitator + DevOps | 1-2 hours |
| Thursday | Pilot Intent deployed to production (or staging for review) | DevOps | 1-2 hours |
| Thursday | Team discusses: What did the AI-DLC artifacts capture that Scrum wouldn't have? What was missing? | Full team | 30 min |
| Friday | Team retrospective: AI-DLC vs. Scrum experience. Decide on next steps. | Full team | 1 hour |

#### Week 4: Expand or Iterate

Based on the Week 3 retrospective, the team decides one of:

**Option A: Expand gradually.** Continue the current sprint but run one Intent per week through AI-DLC in parallel. Over 2-3 weeks, shift more work to AI-DLC until it becomes the primary mode.

**Option B: Full switch.** Cancel the remaining sprint. Move all work to AI-DLC. The team stops using Azure DevOps for new work (existing tickets are migrated to Intents or closed).

**Option C: Iterate on process.** The pilot revealed issues (AI quality, team dynamics, tooling gaps). Spend another week refining the process before expanding.

**Recommended for most teams: Option A.** Gradual expansion gives the team time to build muscle memory and confidence. Within 4-6 weeks, most teams naturally shift to AI-DLC as the primary mode because the speed improvement is compelling.

### 5.4 What Happens to Azure DevOps?

Azure DevOps does not disappear overnight. During the transition:

1. **Week 1-4:** Azure DevOps remains primary. AI-DLC artifacts are generated in the repo alongside Azure DevOps tickets.
2. **Week 4-8:** New feature work starts as Intents with artifacts in the repo (`aidlc-docs/`). Azure DevOps tickets are created only for tracking at the Epic level (for stakeholder visibility).
3. **Week 8+:** Azure DevOps is used primarily for cross-team coordination and stakeholder reporting. Day-to-day tracking moves to the repository where AI-generated artifacts provide status.

Over time, Azure DevOps may be replaced entirely by a dashboard that reads from the repository artifacts. The `aidlc-docs/` folder structure contains all the information needed to derive status: which Intents are active, which Units are complete, which Bolts are in progress, and what validation results look like. But replacing Azure DevOps is an organizational decision, not a technical one. Many teams keep Azure DevOps for stakeholder communication even after AI-DLC becomes their primary execution model.

### 5.5 What Happens to Standups?

In the first few weeks, keep standups. As the team gets comfortable with Bolts (hours/days cadence), standups become less useful because:

- A Bolt takes 2-8 hours. By the next standup, it is either done or nearly done.
- Status is visible through the artifacts in the repository. The Level 1 Plan shows phase progress. Bolt plan checkboxes show execution progress. Validation results show quality status.
- Blockers surface immediately during Mob Construction, not the next morning.

Replace the daily standup with:
- An async Slack post: "Completed BOLT-003 for UNIT-002. Starting BOLT-004. No blockers."
- Anyone who wants to check progress can review the `aidlc-docs/` artifacts directly.

Keep a weekly sync (30 minutes) for cross-team coordination and non-AI-DLC topics.

---

## 6. Practical Example: End-to-End AI-DLC Flow

This section walks through a complete, concrete example of a small SaaS team using AI-DLC to build a "notification preferences" feature. The team has 7 people: a Product Owner, a Tech Lead (facilitator), 3 developers, a QA engineer, and a part-time DevOps person. The example uses a generic AI coding tool and follows the white paper methodology without any specific implementation tooling.

### 6.1 Step 1: Initiating the Intent

The facilitator opens the AI coding tool and types:

```
Using AI-DLC, build a notification preferences system where users can choose
email, SMS, or push notification channels per event type (billing alerts,
usage warnings, team invites, security alerts). Users should be able to set
quiet hours and snooze notifications temporarily.
```

The AI recognizes this as a brownfield enhancement (the existing SaaS codebase with 847 source files is detected) and begins generating a Level 1 Plan.

### 6.2 Step 2: AI Generates Level 1 Plan

AI analyzes the workspace (existing SaaS codebase, Node.js/TypeScript, PostgreSQL) and the intent (new feature on existing product = brownfield enhancement):

```markdown
# Level 1 Plan: Notification Preferences
Pathway: Feature Enhancement (Brownfield)

## Recommended Workflow Stages

### Stage 1: Inception - Workspace Analysis
- Reverse-engineer existing notification infrastructure
- Generate static and dynamic models of current codebase
- **Human Validation Point: Developer validates models**

### Stage 2: Inception - Mob Elaboration
- Intent clarification (AI asks questions, team answers)
- User story generation and team validation
- NFR definition
- Risk assessment
- Unit decomposition
- Bolt planning
- **Human Validation Point: Product Owner approves Units and Bolt plan**

### Stage 3: Construction - Design-Build Cycle
- Domain Design per Unit
- Logical Design per Unit (ADRs)
- Code generation per Bolt
- Test generation and execution per Bolt
- Integration testing
- **Human Validation Point: All tests pass, code reviewed**

### Stage 4: Operations - Deployment Package
- Deployment guide with database migrations
- Runbook for notification monitoring
- Monitoring configuration
- Release notes
- **Human Validation Point: Deployed to staging, verified**
```

Tech Lead and PO review on the Zoom call:
- PO: "Looks good. I want to make sure we include quiet hours in the user stories."
- Tech Lead: "I agree with the workspace analysis stage. Our existing notification code is scattered across 3 services. The static model will help."

They approve the plan: "Looks good. Proceed."

### 6.3 Step 3: Inception - Workspace Analysis

AI scans the codebase and generates:

**Static Model** (`aidlc-docs/discovery/static-model.md`):

```markdown
## Existing Notification Infrastructure

### Components
1. **EmailSender** (src/services/email-sender.ts)
   - Responsibility: Send transactional emails via SendGrid
   - Dependencies: SendGrid SDK, NotificationLog model
   - Public API: sendEmail(to, template, data)

2. **NotificationQueue** (src/services/notification-queue.ts)
   - Responsibility: Queue and retry failed notification deliveries
   - Dependencies: Bull queue (Redis), EmailSender
   - Public API: enqueue(notification), processQueue()

3. **BillingEvents** (src/events/billing-events.ts)
   - Responsibility: Emit events for invoice created, payment failed, etc.
   - Dependencies: EventEmitter, EmailSender (direct call)
   - Note: Currently sends emails directly, bypasses queue

4. **NotificationLog** (src/models/notification-log.ts)
   - Responsibility: Record all sent notifications
   - Fields: id, userId, type, channel, status, sentAt

### Relationships
- BillingEvents -> EmailSender (direct, should go through queue)
- UsageEvents -> EmailSender (direct, should go through queue)
- NotificationQueue -> EmailSender
- EmailSender -> NotificationLog

### Gaps Identified
- No SMS or push notification support
- No user preference storage
- Some events bypass the queue (inconsistent)
- No quiet hours or snooze functionality
- No per-event-type channel configuration
```

**Dynamic Model** (`aidlc-docs/discovery/dynamic-model.md`):

```markdown
## Current Notification Flow

### Use Case: Billing Alert (Invoice Created)

1. StripeWebhookHandler receives `invoice.created` event
2. BillingEvents.emit('invoiceCreated', { userId, invoiceId, amount })
3. BillingEvents handler calls EmailSender.sendEmail() DIRECTLY
   (bypasses NotificationQueue - known inconsistency)
4. EmailSender calls SendGrid API
5. EmailSender logs to NotificationLog

### Use Case: Usage Warning (Threshold Exceeded)

1. UsageMonitor cron job checks thresholds every hour
2. UsageEvents.emit('thresholdExceeded', { userId, metric, value, threshold })
3. UsageEvents handler calls EmailSender.sendEmail() DIRECTLY
   (same bypass issue as billing)
4. EmailSender calls SendGrid API
5. EmailSender logs to NotificationLog

### Key Observation
All notification paths currently end at EmailSender. There is no
channel abstraction layer. Adding SMS and push requires introducing
a channel router between event handlers and delivery services.
```

Tech Lead reviews on the Zoom call: "The static model correctly identified that billing events bypass the queue. That is a known issue. We should fix that as part of this feature. The dynamic model is also accurate. Let's proceed."

**Human Validation Point passed:** Developer validates models.

### 6.4 Step 4: Inception - Mob Elaboration (Remote Zoom Session)

The full team joins a Zoom call. The Tech Lead shares their screen.

**AI asks clarifying questions:**

```
1. Which notification channels should be supported at launch?
   (Email is existing. SMS and push are new.)
2. For SMS: Which provider? (Twilio, AWS SNS, other?)
3. For push notifications: Web push only, or also mobile (iOS/Android)?
4. Should there be organization-level defaults that admins set,
   with users able to override?
5. What happens during quiet hours? Are notifications queued and
   delivered after, or silently dropped?
6. How long can a user snooze notifications? Is there a maximum?
7. Are there any notifications that cannot be disabled? (e.g.,
   security alerts, account lockout)
```

PO answers, facilitator types. Team discusses each point. Security engineer adds: "Security alerts must always be delivered via at least one channel. Users can change the channel but cannot disable security notifications entirely."

**AI generates user stories** and saves to `aidlc-docs/stories/user-stories.md`:

```markdown
## US-001: Configure Notification Channels
As a user, I want to choose which channels (email, SMS, push) I receive
notifications on for each event type, so that I only get notifications
where I want them.

Acceptance Criteria:
- [ ] UI shows grid: event types as rows, channels as columns
- [ ] User can toggle each cell on/off
- [ ] Changes saved immediately (optimistic UI with rollback on error)
- [ ] Default: email ON for all events, SMS and push OFF
- [ ] Security alerts: email always ON (cannot be disabled), others configurable

## US-002: Set Quiet Hours
As a user, I want to set quiet hours during which non-critical
notifications are held, so that I am not disturbed outside work hours.

Acceptance Criteria:
- [ ] User sets start time and end time (in their timezone)
- [ ] During quiet hours: non-critical notifications queued
- [ ] After quiet hours: queued notifications delivered in batch digest
- [ ] Critical notifications (security alerts) bypass quiet hours
- [ ] Quiet hours support different schedules for weekdays vs. weekends

## US-003: Snooze Notifications
As a user, I want to temporarily snooze all non-critical notifications
for a specified duration, so that I can focus without interruption.

Acceptance Criteria:
- [ ] Snooze durations: 1 hour, 4 hours, 8 hours, custom
- [ ] Maximum snooze: 7 days
- [ ] Critical notifications bypass snooze
- [ ] Visual indicator showing active snooze and remaining time
- [ ] Snooze can be cancelled early

## US-004: SMS Channel Setup
As a user, I want to add and verify my phone number for SMS
notifications, so that I can receive important alerts via text.

Acceptance Criteria:
- [ ] Phone number input with country code selection
- [ ] Verification via 6-digit SMS code
- [ ] Rate limiting on verification attempts (max 3 per hour)
- [ ] User can remove phone number (disables all SMS notifications)

## US-005: Organization-Level Defaults
As an admin, I want to set organization-wide notification defaults,
so that new users start with sensible notification settings.

Acceptance Criteria:
- [ ] Admin UI for setting default channel preferences per event type
- [ ] New users inherit organization defaults
- [ ] Users can override organization defaults for their own account
- [ ] Admin can set "enforced" preferences that users cannot override
```

Backend developer: "US-004 needs to handle the case where a user has no phone number but tries to enable SMS. We need the phone number verification flow before SMS can be enabled." This gets added as a dependency note.

**AI generates NFRs** and saves to `aidlc-docs/requirements/nfr.md`:

```markdown
## Performance
- Preference changes saved in < 500ms
- Notification delivery latency: < 30 seconds for email, < 10 seconds for SMS
- Push notification delivery: < 5 seconds
- Quiet hours digest generation: < 60 seconds for up to 100 queued notifications

## Security
- Phone numbers encrypted at rest (AES-256)
- SMS verification codes expire after 10 minutes
- Rate limiting: max 100 notifications per user per hour per channel
- All preference changes logged in audit trail

## Reliability
- SMS delivery: 99.5% SLA (dependent on Twilio)
- Push notification delivery: best effort (browser may block)
- Email delivery: 99.9% SLA (existing SendGrid SLA)
- Graceful degradation: if one channel fails, others continue
```

**AI generates Risk descriptions** and saves to `aidlc-docs/requirements/risks.md`:

```markdown
## RISK-001: Twilio Delivery Reliability
**Likelihood:** Medium | **Impact:** High
SMS delivery depends on Twilio. Carrier filtering can silently drop messages.
**Mitigation:** Delivery confirmation webhooks, fallback to email for
undelivered SMS after 60 seconds.

## RISK-002: Push Notification Browser Support
**Likelihood:** High | **Impact:** Low
Web Push API is not supported in all browsers. Safari has limited support.
**Mitigation:** Feature detection. Push preferences hidden for unsupported
browsers. Fallback channel displayed.

## RISK-003: Quiet Hours Timezone Complexity
**Likelihood:** Medium | **Impact:** Medium
Users travel across timezones. Quiet hours need to respect current timezone.
**Mitigation:** Store quiet hours in user's configured timezone. Allow
manual timezone override. Default to account timezone.
```

**AI decomposes into Units** and saves to `aidlc-docs/requirements/units.md`:

```markdown
## UNIT-001: Notification Preferences Storage & API
Stories: US-001, US-005
- Database schema for preferences (user_id, event_type, channel, enabled)
- CRUD API for preferences
- Organization-level defaults with user overrides
- Bolts: 2 (schema + API, then org defaults)

## UNIT-002: Multi-Channel Delivery Engine
Stories: US-004, US-006, US-007
- SMS delivery via Twilio
- Push notification via Web Push API
- Channel router (reads preferences, routes to correct channel)
- Modify existing queue to support multi-channel
- Fix: route billing/usage events through queue (existing inconsistency)
- Bolts: 3 (SMS integration, push integration, channel router)

## UNIT-003: Quiet Hours & Snooze
Stories: US-002, US-003, US-008
- Quiet hours schedule storage and evaluation
- Snooze state management
- Digest generation for batched quiet-hours notifications
- Bolts: 2 (quiet hours, snooze + digest)
```

**Human Validation Point passed:** Product Owner approves Units and Bolt plan. Tech Lead confirms integration approach.

### 6.5 Step 5: Construction - Mob Construction

The team starts Construction. Tech Lead shares screen.

**BOLT-001: Notification Preferences Schema and API**

AI generates the execution plan and saves to `aidlc-docs/construction/UNIT-001/BOLT-001-plan.md`:

```markdown
# BOLT-001 Execution Plan: Notification Preferences Schema and API

## Steps
- [ ] Create migration: add notification_preferences table
      (user_id, event_type, channel, enabled, created_at, updated_at)
- [ ] Create migration: add organization_notification_defaults table
      (org_id, event_type, channel, enabled, enforced)
- [ ] Create NotificationPreference entity with repository
- [ ] Create PreferencesService with CRUD operations
- [ ] Create /api/notifications/preferences endpoints (GET, PUT)
- [ ] Add composite unique index on (user_id, event_type, channel)
- [ ] Write unit tests for PreferencesService
- [ ] Write integration tests for API endpoints
      (including case where no preferences exist yet - verify defaults)
- [ ] Update API documentation

## Approval
[ ] Plan approved by: _______________
```

Tech Lead approves the plan. AI executes step by step.

Team reviews on screen:
- QA engineer: "The integration test should cover the case where preferences don't exist yet, to verify defaults are applied correctly."
- Backend developer: "The migration should use a composite unique index on (user_id, event_type, channel) to prevent duplicate preferences."

Facilitator feeds corrections. AI updates code and tests. Tests run and pass.

**BOLT-001 complete.** 12 tests passed, 0 failed. 8 files created, 2 modified. Team reviews and approves.

**BOLT-002: Organization Defaults**

AI generates execution plan. Team reviews and approves. AI executes. 8 tests passed. Team approves.

**BOLT-003: SMS Integration (UNIT-002)**

This Bolt runs in parallel with BOLT-004 (Push Integration) since the Units are independent.

AI generates the execution plan:

```markdown
# BOLT-003 Execution Plan: SMS Integration via Twilio

## Steps
- [ ] Create TwilioSmsService with send(), verifyPhoneNumber(), checkVerification()
- [ ] Add circuit breaker pattern for Twilio API calls
- [ ] Create phone number verification flow (US-004)
- [ ] Create SMS delivery adapter implementing NotificationChannel interface
- [ ] Write unit tests with Twilio API mocks
- [ ] Write integration test for verification flow
- [ ] Add Twilio credentials to environment configuration

## Approval
[ ] Plan approved by: _______________
```

Backend developer during review: "The circuit breaker should have a 30-second timeout and open after 3 consecutive failures. When open, SMS notifications should be queued for retry, not dropped."

AI executes with corrections. Tests pass. Team approves.

This continues for each remaining Bolt. Some highlights:
- **BOLT-005 (Channel Router):** The most complex Bolt. AI designs a routing layer that sits between event handlers and delivery services. Replaces direct EmailSender calls in BillingEvents and UsageEvents. Team discusses whether to use a strategy pattern or a simple switch statement. AI recommends strategy pattern for extensibility. Team agrees.
- **BOLT-006 (Quiet Hours):** AI proposes a cron-based approach for digest delivery. DevOps person suggests using the existing Bull queue scheduler instead. AI adapts.
- **BOLT-007 (Snooze + Digest):** Final Bolt. Integration tests verify the full flow: event occurs during snooze, notification is queued, snooze expires, digest is generated and delivered.

### 6.6 Step 6: Operations

AI generates Operations artifacts:

**Deployment Guide** (`aidlc-docs/operations/deploy-guide.md`):
```markdown
## Deployment Steps

### Prerequisites
- Twilio account with SMS capability
- VAPID keys for Web Push (generate with web-push library)

### Environment Variables (new)
- TWILIO_ACCOUNT_SID
- TWILIO_AUTH_TOKEN
- TWILIO_PHONE_NUMBER
- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY

### Database Migrations
1. 20260217_001_notification_preferences.sql - Preferences table
2. 20260217_002_org_notification_defaults.sql - Org defaults table
3. 20260217_003_phone_verification.sql - Phone verification tracking

### Feature Flag
NOTIFICATION_PREFERENCES_ENABLED=false (default)
Enable after staging verification.

### Rollback Plan
1. Set NOTIFICATION_PREFERENCES_ENABLED=false
2. Existing notification flow is unaffected (channel router falls back to email-only)
3. Database migrations are additive (no rollback needed for schema)
```

**Runbook** (`aidlc-docs/operations/runbook.md`):
```markdown
## Monitoring

### Key Metrics
- notification.delivery.success_rate (per channel)
- notification.delivery.latency_p99 (per channel)
- notification.quiet_hours.digest_size (avg notifications per digest)
- twilio.api.error_rate
- twilio.api.circuit_breaker.state (closed/open/half-open)

### Alerts
- SMS delivery rate < 95% over 5 minutes -> page on-call
- Twilio circuit breaker OPEN -> notify Slack
- Digest generation > 120 seconds -> warning

### Common Issues
1. **Twilio rate limiting**: Increase throughput in Twilio console or add queue backpressure
2. **Push notifications not delivering**: Check VAPID key configuration, verify service worker registration
3. **Quiet hours not working**: Verify user timezone is set correctly, check cron scheduler health
```

**Monitoring Configuration** (`aidlc-docs/operations/monitoring.json`):
```json
{
  "dashboards": [
    {
      "name": "Notification Preferences",
      "panels": [
        { "title": "Delivery Success Rate by Channel", "type": "timeseries" },
        { "title": "Delivery Latency P99", "type": "timeseries" },
        { "title": "Active Quiet Hours Users", "type": "stat" },
        { "title": "Active Snooze Users", "type": "stat" },
        { "title": "Twilio Circuit Breaker State", "type": "state-timeline" }
      ]
    }
  ],
  "alerts": [
    {
      "name": "sms-delivery-rate",
      "condition": "notification.delivery.success_rate{channel=sms} < 0.95",
      "duration": "5m",
      "severity": "critical"
    },
    {
      "name": "twilio-circuit-breaker",
      "condition": "twilio.circuit_breaker.state == 'open'",
      "duration": "0s",
      "severity": "warning"
    }
  ]
}
```

**Release Notes** (`aidlc-docs/operations/release-notes.md`):
```markdown
## Release: Notification Preferences v1.0

### New Features
- Per-event-type notification channel preferences (email, SMS, push)
- Quiet hours with configurable weekday/weekend schedules
- Notification snooze with batch digest delivery
- Organization-level default preferences with admin enforcement
- Phone number verification for SMS setup

### Improvements
- Billing and usage events now route through notification queue (previously bypassed)
- New channel router abstraction for extensible notification delivery

### Configuration Required
- Twilio credentials for SMS
- VAPID keys for Web Push
- Feature flag: NOTIFICATION_PREFERENCES_ENABLED
```

DevOps person reviews on the Zoom call:
- "The deploy guide should mention the Twilio API key as a required environment variable." (Already included.)
- "The monitoring config should include Twilio delivery success rate as a metric." (Already included.)
- "Add a circuit breaker alert for when Twilio is down." (Already included.)
- "Looks comprehensive. Deploy to staging."

Deployment to staging succeeds. Team verifies notification delivery across all three channels.

**Human Validation Point passed:** Deployed to staging, notification delivery verified.

### 6.7 Step 7: The Artifact Trail

After the workflow completes, the project contains:

```
aidlc-docs/
  plans/
    level1-plan.md
  requirements/
    units.md
    nfr.md
    risks.md
  stories/
    user-stories.md
  discovery/
    static-model.md
    dynamic-model.md
  design/
    artefacts/
      UNIT-001/
        domain-design.md
        logical-design.md
        adr-001.md
      UNIT-002/
        domain-design.md
        logical-design.md
        adr-001.md
        adr-002.md
      UNIT-003/
        domain-design.md
        logical-design.md
  construction/
    UNIT-001/
      BOLT-001-plan.md
      BOLT-002-plan.md
    UNIT-002/
      BOLT-001-plan.md
      BOLT-002-plan.md
      BOLT-003-plan.md
    UNIT-003/
      BOLT-001-plan.md
      BOLT-002-plan.md
  operations/
    deploy-guide.md
    runbook.md
    monitoring.json
    release-notes.md
  audit.md
  prompts.md
```

Every artifact in this tree was generated by AI and validated by the team. The artifacts are semantically linked: the Level 1 Plan references the phases, the requirements trace to user stories, the user stories map to Units, the Units contain Bolts, and each Bolt's plan references the domain design and logical design it implements. This chain of artifacts provides full traceability from the business Intent ("notification preferences") down to the individual code changes in each Bolt, and back up again.

The `audit.md` file contains a chronological record of all decisions, corrections, and validations made during the workflow:

```markdown
# Audit Trail: Notification Preferences

## Timeline

### 2026-02-17 10:00 - Intent Initiated
- Pathway: brownfield-enhancement
- Risk: MEDIUM

### 2026-02-17 10:15 - Level 1 Plan Approved
- Approved by: Tech Lead, Product Owner
- Modifications: None

### 2026-02-17 10:30 - Workspace Analysis Complete
- Static model validated by Tech Lead
- Key finding: billing events bypass notification queue
- Decision: Fix queue bypass as part of UNIT-002

### 2026-02-17 11:00 - Mob Elaboration Started
- Attendees: Full team (7)
- Duration: 2.5 hours

### 2026-02-17 11:15 - Clarification: Security Alerts
- Decision: Security alerts cannot be fully disabled
- Rationale: Compliance requirement
- Added by: Security Engineer

### 2026-02-17 12:00 - User Stories Approved
- 8 stories generated, 3 modified during review
- Modifications: US-004 (phone verification dependency), US-001 (security alert constraint)

### 2026-02-17 13:30 - Units Approved
- 3 Units, 7 Bolts total
- Product Owner approved scope
- Tech Lead approved technical decomposition

### 2026-02-17 14:00 - BOLT-001 Plan Approved
- Approved by: Tech Lead
- Modifications: Added composite unique index requirement

### 2026-02-17 15:30 - BOLT-001 Complete
- 12 tests passed, 0 failed
- 8 files created, 2 modified

[... continues for each Bolt ...]

### 2026-02-19 14:00 - Operations Artifacts Approved
- Approved by: DevOps
- Modifications: None (all requirements already covered)

### 2026-02-19 15:00 - Staging Deployment Verified
- All 3 channels tested: email, SMS, push
- Quiet hours verified with time simulation
- Snooze verified with manual trigger
```

### 6.8 Step 8: Reflection

After the workflow completes, the team reviews the audit trail together. This replaces the Scrum retrospective with a data-driven discussion:

**What the artifacts reveal:**
- 7 Bolts completed in 2 days (compared to an estimated 2-week sprint for the same scope under Scrum)
- 3 user stories were modified during Mob Elaboration based on team feedback (the AI's first draft was 80% correct)
- 1 Bolt (BOLT-003, SMS Integration) needed a correction during review (circuit breaker timeout)
- The workspace analysis caught a pre-existing bug (queue bypass) that would not have been discovered in a Scrum workflow focused only on the new feature

**Team discussion:**
- "The Mob Elaboration session was more productive than our typical Sprint Planning because the AI generated the stories first and we just refined them."
- "The domain models were surprisingly good. We only had to add the grace period for failed payments."
- "The two-part Bolt execution (plan then execute) caught the missing composite index before it became a production issue."
- "Next time, we should have the DevOps person join the Construction session earlier. They caught the circuit breaker issue that the backend developers missed."

This reflection is data-driven (based on the actual artifacts and audit trail) rather than opinion-based (like a typical Scrum retrospective). The team can point to specific decisions, corrections, and outcomes rather than relying on memory.

---

## 7. Brownfield Development Specifics

Brownfield development (building new features on an existing codebase) is the most common scenario for established SaaS teams and receives special attention in the AI-DLC white paper.

### 7.1 Reverse Engineering Existing Code

The white paper describes a process where AI "elevates the codes into a higher-level modelling representation" before any new construction begins. This produces two types of models:

**Static Model:**
- Lists all components (modules, services, classes) in the relevant area of the codebase
- Describes each component's responsibility, public API, and dependencies
- Maps relationships between components (calls, imports, inherits, implements)
- Identifies architectural patterns already in use (MVC, repository pattern, event-driven, etc.)

**Dynamic Model:**
- Traces how data flows through the system for key use cases
- Shows interaction sequences between components
- Identifies integration points with external systems
- Highlights performance-critical paths

### 7.2 Developer Validation of Models

The reverse-engineered models are NOT automatically trusted. The white paper specifies that developers must validate them before Construction proceeds. This validation serves two purposes:

1. **Accuracy check:** AI may misinterpret code. Developers confirm the models match reality.
2. **Knowledge transfer:** The models become shared understanding that the entire team can reference during Construction, not just the developers who originally wrote the code.

Common corrections during model validation:
- "This component is deprecated. We use X instead."
- "These two services communicate through an event bus, not direct calls."
- "This database table is shared with another team's service. Changes require coordination."
- "The AI missed the caching layer between the API and the database."

### 7.3 Integration Considerations

Brownfield AI-DLC differs from greenfield in several important ways:

| Aspect | Greenfield | Brownfield |
|---|---|---|
| Starting point | Clean slate | Existing code, patterns, constraints |
| Inception | Full elaboration | Focused elaboration on new capability only |
| Domain Design | From scratch | Incorporate existing domain model |
| Logical Design | Free architectural choice | Must align with existing architecture |
| Testing | New test suite | New tests + regression tests on existing code |
| Deployment | Standard deploy | Migration plan + backward compatibility |
| Risk | Technical risk (wrong architecture) | Integration risk (breaking existing functionality) |

The key difference is that brownfield AI-DLC must respect the existing system's constraints while adding new capability. The reverse-engineered models ensure AI understands these constraints before generating new code.

### 7.4 The Workspace Analysis Stage

In brownfield scenarios, workspace analysis happens as a **stage within Inception** (not a separate phase). The sequence is:

1. AI receives the Intent
2. AI generates Level 1 Plan (which includes workspace analysis as a stage)
3. **Workspace analysis stage:** AI scans existing code, generates static and dynamic models
4. **Human Validation Point:** Developers validate models
5. Mob Elaboration proceeds with validated models as context
6. Construction proceeds with awareness of existing architecture

This ensures that AI-generated designs, code, and tests account for the existing codebase rather than treating the new feature in isolation.

---

---

# PART II: Olympus as an AI-DLC Implementation

> The sections below describe how Olympus, a multi-agent orchestration tool for Claude Code, implements AI-DLC concepts. Olympus adds its own opinions and features on top of AI-DLC. This section is separate from Part I to clearly distinguish between what AI-DLC prescribes and what Olympus adds.

---

## 8. Mapping AI-DLC to Olympus

### 8.1 Concept Mapping

| AI-DLC Concept | Olympus Implementation | Status | Files |
|---|---|---|---|
| Intent | INTENT artifact + `intent.md` generation | Built | `engine.ts` (executeIntentStage), `artifacts.ts` |
| Unit | UNIT artifact + hierarchical decomposition | Built | `construction/decomposition.ts`, `phase-types.ts` (HierarchicalNode) |
| Bolt | BOLT artifact + dispatcher | Built | `bolt-dispatcher.ts`, `construction/executor.ts` |
| Level 1 Plan | `DepthAssessment` + phase progression | Partial | `phase-types.ts`, `engine.ts` (executePhase) |
| Mob Elaboration | Prometheus planning agent | Partial | Prometheus agent config, skill templates |
| Mob Construction | ConstructionExecutor + agent routing | Partial | `construction/executor.ts`, `bolt-dispatcher.ts` |
| Domain Design | Interface contracts, data flows, components | Built | `construction/design.ts` |
| Logical Design | ADRs within design artifacts | Built | `construction/design.ts`, `construction/validation.ts` |
| Deployment Units | Operations templates | Built | `operations/templates.ts` |
| PRFAQ | Not implemented | Missing | N/A |
| User Stories | Generated in INTENT artifact | Built | `engine.ts` (executeIntentStage) |
| NFRs | Generated as separate artifact | Built | `engine.ts` (executeIntentStage) |
| Risk Register | RiskEntry in manifest | Built | `phase-types.ts`, `manifest.ts` |
| Audit Trail | Validation reports + gate audit | Partial | `validation-report.ts`, `manifest.ts` (gate_audit) |
| Brownfield Reverse Engineering | Not implemented | Missing | N/A |
| Adaptive Workflow (L1 Plan) | DepthAssessment drives depth, not stage selection | Partial | `phase-types.ts` (DepthAssessment) |
| Trust System | Trust levels 0-3 with per-BOLT tracking | Built | `phase-types.ts` (TrustState), `trust.ts` |
| Cascade Invalidation | Artifact dependency graph with stale detection | Built | `manifest.ts` (cascadeInvalidation, detectStaleArtifacts) |
| Checkpoint/Resume | V3 checkpoint with cache | Built | `checkpoint.ts` |
| Retrospective | Pattern detection + learning persistence | Built | `retro.ts` |
| Workflow Status | `/workflow-status` hook | Built | `hooks/registrations/workflow-status.ts` |
| Gate Validation | Dual validation (parent + root alignment) | Built | `alignment.ts`, `manifest.ts` |
| Contract State Machine | draft, active, fulfilled, violated, stale | Built | `manifest.ts` (state transitions) |

### 8.2 What Olympus Adds Beyond AI-DLC

Olympus is not a pure AI-DLC implementation. It adds several concepts that are not part of the white paper:

#### Trust Levels (0-3)

AI-DLC specifies that "human oversight functions like a loss function" but does not formalize how the level of oversight changes over time. Olympus introduces a 4-level trust system:

- **Level 0 (None):** AI generates, human must approve everything
- **Level 1 (Low):** AI can proceed with minor changes without approval
- **Level 2 (Medium):** AI can execute Bolts autonomously with post-hoc review
- **Level 3 (High):** AI can execute and deploy with minimal oversight

Trust is tracked per-BOLT and adjusts based on past performance (gate approval rates, test pass rates, code review outcomes). This is an Olympus addition for progressive autonomy.

#### Cascade Invalidation

AI-DLC specifies that artifacts are linked and traceable. Olympus goes further by actively tracking artifact dependencies and detecting when upstream changes invalidate downstream artifacts. If a user story changes after Domain Design is complete, Olympus marks the Domain Design as "stale" and flags it for regeneration.

#### Formal Gate System with Dual Validation

AI-DLC describes "strategic decision points where human oversight functions like a loss function." Olympus formalizes these into explicit gates with:
- **Parent conformance:** Does the artifact conform to its immediate parent? (e.g., does the code implement the Bolt plan?)
- **Root conformance:** Does the artifact still align with the original Intent? (e.g., does this code change serve the business goal?)

Both scores must pass configurable thresholds before the gate approves. This dual validation prevents drift from the original Intent even as the implementation evolves through multiple Bolts.

#### Checkpoint/Resume System

AI-DLC specifies that artifacts are persisted. Olympus adds a full checkpoint system (`checkpoint.ts`) that captures not just artifacts but the complete workflow state (current phase, current stage, trust levels, pending gates, cache entries). This enables session resumption: if the AI session ends mid-workflow, the next session can resume from exactly where it left off.

#### Discovery Phase (4th Phase)

AI-DLC defines three phases: Inception, Construction, Operations. Olympus adds a fourth phase, **Discovery**, that runs before Inception. Discovery scans the workspace, detects existing files, identifies the technology stack, and establishes context for the workflow. In AI-DLC, this functionality would be a stage within Inception. Olympus elevates it to a standalone phase for architectural clarity and to enable dedicated workspace analysis tooling.

#### Learning System

AI-DLC specifies an audit trail (`audit.md`) for decision tracking. Olympus extends this into a full learning system that:
- Tracks patterns across sessions (not just within a single workflow)
- Persists discoveries as JSONL for long-term pattern recognition
- Generates retrospective analysis with confidence-scored suggestions
- Feeds learned patterns back into future workflows

#### Agent Routing

AI-DLC is a methodology; it does not specify implementation. Olympus adds multi-agent routing where different types of work are dispatched to specialized agents (oracle for debugging, olympian for execution, prometheus for planning, etc.) based on content analysis of the Bolt.

---

## 9. Gap Analysis

### 9.1 Detailed Gaps

#### Gap 1: Explicit Level 1 Plan Generator (Priority: HIGH)

**Current state:** `DepthAssessment` in `phase-types.ts` scores clarity, complexity, scope, risk, context, and preferences. The `recommended_depth` field determines whether the workflow runs `minimal`, `standard`, or `comprehensive`. The `engine.ts` `executePhase()` method dispatches to phase handlers, but the sequence of phases is hardcoded (discovery, inception, construction, operations).

**What AI-DLC requires:** AI should analyze the intent and workspace context (greenfield vs. brownfield, simple fix vs. complex feature) and generate an explicit Level 1 Plan document that the user reviews and approves before the workflow begins. The plan specifies which phases run, which stages within each phase are included or skipped, and the estimated depth for each.

**Specific changes needed:**
- New module: `level1-plan.ts` in `src/features/workflow-engine/`
- Input: Intent text + workspace analysis (file count, language, existing `aidlc-docs/` presence)
- Output: `aidlc-docs/{workflowId}/level1-plan.md` with recommended phases, stages, and depth
- Integration point: `engine.ts` `start()` method should generate L1 Plan, then pause for user approval before proceeding to first phase
- The user approves via a new `/plan approve` command or by editing the L1 Plan and resuming

**Example L1 Plan output:**
```markdown
# Level 1 Plan: notification-preferences
Generated: 2026-02-17T10:00:00Z
Pathway: brownfield-enhancement
Risk Assessment: MEDIUM (Tier 2)

## Phases
1. [x] Discovery - Codebase analysis (RECOMMENDED: existing project detected)
2. [x] Inception - Focused elaboration (2-3 hour session)
3. [x] Construction - Standard depth (estimated 3-4 Bolts)
4. [x] Operations - Standard deployment package

## Stage Details
| Phase | Stage | Included | Rationale |
|-------|-------|----------|-----------|
| Discovery | Codebase scan | Yes | Existing codebase detected (247 files) |
| Discovery | Semantic modeling | Yes | Brownfield pathway |
| Inception | Intent clarification | Yes | Standard |
| Inception | Story generation | Yes | Standard |
| Inception | NFR definition | Yes | Standard |
| Inception | Unit decomposition | Yes | Standard |
| Inception | PRFAQ | No | Enhancement, not new product |
| Construction | Domain Design | Yes | Standard |
| Construction | Logical Design | Yes | Standard |
| Construction | Code generation | Yes | Standard |
| Construction | Testing | Yes | Standard |
| Operations | Deploy guide | Yes | Standard |
| Operations | Runbook | Yes | Standard |
| Operations | Monitoring | Yes | Standard |
| Operations | Release notes | Yes | Standard |
| Operations | Cost analysis | No | Enhancement, not full product |

## Approval
[ ] Approved by: _______________
[ ] Date: _______________
```

#### Gap 2: Mob Elaboration Integration (Priority: MEDIUM)

**Current state:** The Prometheus agent does interview-style planning (asking clarifying questions, building a plan). This is conceptually similar to Mob Elaboration but is designed for a single-user interaction, not a team ceremony.

**What AI-DLC requires:** Mob Elaboration is a team ceremony where AI proposes and the entire team validates simultaneously. The facilitator drives the AI, but the output is reviewed by Product Owner, developers, QA, and other stakeholders together.

**Specific changes needed:**
- The existing Prometheus workflow can be adapted for Mob Elaboration by:
  1. Adding a "ceremony mode" flag that changes the output format to be screen-share-friendly (larger text, clearer sections, explicit "TEAM: Please review and provide feedback" prompts)
  2. Producing AI-DLC artifacts (PRFAQ, NFRs, Risk Register entries, Unit suggestions with Bolt plans) rather than generic plan documents
  3. Adding a "pause for team input" mechanism between each generation step
- New artifact templates: PRFAQ template, NFR template, Risk Register entry template
- Integration with the Inception phase in `engine.ts`

#### Gap 3: PRFAQ Generator (Priority: LOW)

**Current state:** Not implemented. The Inception phase generates an IDEA artifact and an INTENT artifact with user stories, but no PRFAQ.

**What AI-DLC requires:** PRFAQ (Press Release / Frequently Asked Questions) is an optional artifact generated during Mob Elaboration. It summarizes the business intent, functionality, and expected benefits in a customer-facing format.

**Specific changes needed:**
- New function: `generatePRFAQ()` in the Inception phase pipeline
- Input: Clarified intent, user stories, NFRs
- Output: `aidlc-docs/{workflowId}/inception/prfaq.md`
- Template follows the Amazon PRFAQ format: press release (1 page), FAQs (customer and internal)

#### Gap 4: Brownfield Reverse Engineering (Priority: HIGH)

**Current state:** Not implemented. The Discovery phase (`discovery.ts`) scans the workspace for source files but does not generate semantic models of the existing codebase.

**What AI-DLC requires:** For brownfield development, AI must first "elevate the codes into a higher-level modelling representation" consisting of:
- **Static models:** Components, descriptions, responsibilities, and relationships
- **Dynamic models:** How components interact to realize the most significant use cases

Developers then validate these reverse-engineered models before Construction proceeds.

**Specific changes needed:**
- New module: `brownfield-analysis.ts` in `src/features/workflow-engine/`
- Input: Source file list from Discovery phase, language detection
- Output: `aidlc-docs/{workflowId}/discovery/static-model.md` and `dynamic-model.md`
- The static model should identify modules, their public interfaces, dependency graph, and responsibility descriptions
- The dynamic model should identify key use cases and trace data flow through the system
- Integration: Discovery phase should invoke brownfield analysis when existing source files are detected
- Gate: Developer must validate models before Inception proceeds

#### Gap 5: Plan-Verify-Generate Enforcement (Priority: HIGH)

**Current state:** `bolt-dispatcher.ts` generates execution prompts for Bolts and routes to appropriate agents based on content analysis. However, there is no enforcement of the two-part Bolt execution cycle (plan then generate). The agent receives a prompt and executes freely.

**What AI-DLC requires:** Bolt execution is explicitly two-part:
1. AI creates a plan (checkboxes, step-by-step)
2. Human reviews and approves the plan
3. AI executes step by step, checking off items

The white paper's appendix provides example prompts that enforce this: "Plan for the work ahead and write your steps in an md file with checkboxes for each step in the plan. Upon completing the plan, ask for my review and approval. After my approval, you can go ahead to execute the same plan one step at a time."

**Specific changes needed:**
- Modify `buildBoltPrompt()` in `bolt-dispatcher.ts` to include plan-first instructions
- Add a plan artifact: `aidlc-docs/{workflowId}/construction/{UNIT-ID}/{BOLT-ID}-plan.md`
- Add a checkpoint state: `awaiting_bolt_plan_approval` between plan generation and execution
- Modify `ConstructionExecutor` to enforce the plan-approve-execute sequence
- The plan file should contain checkboxes that are marked as execution progresses

**Example enforced Bolt plan:**
```markdown
# BOLT-002 Execution Plan: Subscription Change Preview API

## Steps
- [ ] Create ProrationPreview value object in domain layer
- [ ] Implement StripeProrationService with circuit breaker
- [ ] Create PreviewSubscriptionChange use case
- [ ] Add /api/subscriptions/{id}/preview endpoint
- [ ] Write unit tests for proration calculation edge cases
- [ ] Write integration test with Stripe mock
- [ ] Update API documentation

## Approval
[ ] Plan approved by: _______________
[ ] Date: _______________
```

#### Gap 6: Comprehensive audit.md (Priority: MEDIUM)

**Current state:** `validation-report.ts` generates per-BOLT validation reports within each UNIT directory. The manifest tracks gate audit entries. But there is no unified `audit.md` document that traces all decisions, approvals, and changes across the entire workflow.

**What AI-DLC requires:** The white paper specifies that "all artefacts generated are persisted and serve as a context memory" with "backward and forward traceability." A comprehensive audit trail connecting domain model elements to specific user stories is explicitly mentioned.

**Specific changes needed:**
- New function: `generateAuditDocument()` that reads the manifest, gate audit entries, validation reports, and trust state to produce a single `aidlc-docs/{workflowId}/audit.md`
- The audit document should include:
  - Timeline of all gate decisions (approve/reject/bypass) with actor and reason
  - Artifact creation and state transition history
  - Trust level changes with rationale
  - Traceability matrix: Intent -> Units -> Bolts -> Code files
  - Cascade invalidation events
  - Retrospective insights
- Can be generated incrementally (appended after each gate) or on demand

#### Gap 7: Adaptive Stage Selection (Priority: MEDIUM)

**Current state:** `DepthAssessment` in `phase-types.ts` has a `skip_units` boolean and `recommended_depth` field. The Operations phase already adapts based on depth (SHALLOW generates only release notes, MEDIUM/DEEP generates all artifacts). However, there is no mechanism for the depth assessment to actually skip entire phases or stages in the workflow engine.

**What AI-DLC requires:** Principle 10 says AI recommends the workflow based on the pathway intention. A bug fix should skip Inception entirely. A simple enhancement might skip Domain Design. The depth assessment should directly control which phases and stages execute.

**Specific changes needed:**
- Connect `DepthAssessment.recommended_depth` and `DepthAssessment.skip_units` to actual phase skipping in `engine.ts`
- Add a `skipped_phases` or `stage_overrides` field to the Level 1 Plan (Gap 1)
- `executePhase()` should check whether a phase is marked as skipped in the L1 Plan
- Add new depth assessment signals: `is_greenfield` (boolean), `pathway_type` (enum: greenfield, brownfield, bugfix, refactor, optimization)

### 9.2 Implementation Roadmap

| Priority | Gap | Effort Estimate | Dependencies |
|---|---|---|---|
| HIGH | Level 1 Plan Generator | 2-3 days | None |
| HIGH | Brownfield Reverse Engineering | 3-5 days | Discovery phase |
| HIGH | Plan-Verify-Generate Enforcement | 1-2 days | bolt-dispatcher.ts |
| MEDIUM | Mob Elaboration Integration | 2-3 days | L1 Plan Generator |
| MEDIUM | Comprehensive audit.md | 1-2 days | None |
| MEDIUM | Adaptive Stage Selection | 1-2 days | L1 Plan Generator |
| LOW | PRFAQ Generator | 0.5-1 day | Inception phase |

---

## 10. Olympus End-to-End Example

This section shows how the same "notification preferences" scenario from Section 6 would look when executed through Olympus. Rather than repeating the full walkthrough, this highlights the Olympus-specific additions. Refer to Section 6 for the complete AI-DLC flow.

### 10.1 Initiating the Workflow

Instead of typing a natural language prompt, the user invokes Olympus:

```
/plan Build a notification preferences system where users can choose email,
SMS, or push notification channels per event type (billing alerts, usage
warnings, team invites, security alerts). Users should be able to set quiet
hours and snooze notifications temporarily.
```

Olympus creates a tracked workflow with a unique ID:

```
[WorkflowEngine] Created workflow: notification-preferences
[WorkflowEngine] Workflow ID: notification-preferences
[WorkflowEngine] Checkpoint saved: aidlc-docs/notification-preferences/checkpoint.json
```

### 10.2 Four-Phase System (vs. Three)

Where AI-DLC uses three phases, Olympus uses four. The Discovery phase runs automatically before Inception:

```
[WorkflowEngine] Discovery phase: scanning workspace...
[WorkflowEngine] Found 847 source files (TypeScript)
[WorkflowEngine] Notification-related files identified:
  - src/services/email-sender.ts
  - src/services/notification-queue.ts
  - src/events/billing-events.ts
  - src/events/usage-events.ts
  - src/models/notification-log.ts
[WorkflowEngine] Generating static model...
[WorkflowEngine] Generating dynamic model...
[WorkflowEngine] Discovery artifacts written to aidlc-docs/notification-preferences/discovery/
```

### 10.3 Checkpoint and Resume

After each phase, Olympus writes a checkpoint file (`checkpoint.json`) that captures the complete workflow state. If the session ends mid-workflow, the next session automatically resumes:

```
[WorkflowEngine] Resuming workflow: notification-preferences
[WorkflowEngine] Last checkpoint: Construction phase, UNIT-002, BOLT-002
[WorkflowEngine] Trust level: 2 (Medium)
[WorkflowEngine] Continuing from BOLT-002...
```

### 10.4 Trust Levels During Execution

As Bolts complete successfully, Olympus adjusts trust:

```
[WorkflowEngine] BOLT-001 complete
[WorkflowEngine] Validation: 12 tests passed, 0 failed
[WorkflowEngine] Trust: 1 -> 2 (gate approved, all tests pass)

[WorkflowEngine] BOLT-003 complete (SMS Integration)
[WorkflowEngine] Validation: 15 tests passed, 0 failed
[WorkflowEngine] Trust: 2 -> 2 (stable, maintaining level)
```

### 10.5 Gate Validation with Conformance Scoring

At each gate, Olympus computes conformance scores:

```
[WorkflowEngine] Gate: BOLT-001 validation
[WorkflowEngine] Parent conformance: 95% (Bolt plan -> code alignment)
[WorkflowEngine] Root conformance: 92% (Intent -> code traceability)
[WorkflowEngine] Gate: APPROVED (both scores above threshold)
```

### 10.6 Cascade Invalidation

If a user story changes mid-construction, Olympus detects the impact:

```
[WorkflowEngine] Artifact modified: US-001 (added security constraint)
[WorkflowEngine] Cascade invalidation triggered:
  - STALE: UNIT-001/domain-design.md (depends on US-001)
  - STALE: UNIT-001/BOLT-001-plan.md (depends on domain-design)
  - OK: UNIT-002/* (no dependency on US-001)
  - OK: UNIT-003/* (no dependency on US-001)
[WorkflowEngine] Action required: regenerate stale artifacts before proceeding
```

### 10.7 Retrospective

After the workflow completes, instead of a manual discussion, Olympus generates a data-driven retrospective:

```
/retro
```

```markdown
# Guardrail Retro: Notification Preferences
Generated: 2026-02-19T16:00:00Z

## Summary
- Total gates: 11 | Rejections: 1 | Rejection rate: 9.1%
- Trust changes: 2 -> 2 (stable)
- CI failures: 0
- Cascade invalidations: 1 (US-001 security constraint change)

## Patterns Identified

### Pattern 1: Gate rejection in Construction (UNIT-002, BOLT-002)
**Evidence**: Push notification BOLT rejected once for missing
service worker registration in test.
**Suggestion**: Include browser API mocking in test templates for
Web Push integration work.
**Confidence**: Low (1 occurrence)

## Advisory Recommendations
- [ ] Update test templates to include Web Push API mocks for future
      notification-related BOLTs
```

The insight is persisted in the learning system (`~/.claude/olympus/learning/discoveries.jsonl`) so future workflows benefit from the pattern.

### 10.8 Olympus-Specific Artifact Trail

In addition to the standard AI-DLC artifacts shown in Section 6.7, Olympus generates:

```
aidlc-docs/notification-preferences/
  checkpoint.json                    # Workflow state (complete)
  manifest.json                      # Artifact registry with checksums and contract states

.olympus/
  trust-state.json                   # Trust level tracking (per-BOLT history)
  retro/
    suggestions.md                   # Retrospective insights (persisted for learning)
  learning/
    discoveries.jsonl                # Cross-session pattern database
```

The `manifest.json` tracks every artifact with SHA-256 checksums, contract status (draft -> active -> fulfilled), phase/stage association, timestamps, and parent/child links for full traceability. The trust state persists across sessions, so a team that has established trust level 2 on a previous workflow starts the next workflow at level 2 rather than 0.

---

## References

- Bala SP, "AI-Driven Development Lifecycle (AI-DLC) Method Definition," Amazon Web Services, 2024-2025
- AWS AI-DLC GitHub: https://github.com/awslabs/aidlc-workflows
- AWS Blog: https://aws.amazon.com/blogs/devops/ai-driven-development-life-cycle/
- Interactive Documentation: https://prod.d13rzhkk8cj2z0.amplifyapp.com/
- Olympus GitHub: https://github.com/mikev10/olympus

---

*This document synthesizes the AWS AI-DLC white paper (Part I) with practical application guidance for remote teams and small SaaS companies, then maps the framework to Olympus's implementation (Part II). Part I is tool-agnostic and describes AI-DLC as defined by the white paper. Part II describes how Olympus implements and extends AI-DLC. The two parts are intentionally separated to allow readers to understand AI-DLC independently before considering any specific implementation.*
