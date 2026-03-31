# NFR Requirements

## Prerequisites
- Functional Design must be complete for the unit
- Unit functional design artifacts must be available
- Execution plan must indicate NFR Requirements stage should execute

## Agent Delegation Strategy

**MANDATORY**: Delegate NFR assessment artifact generation (Step 6) to `oracle-medium`. Do NOT generate NFR requirements and tech stack decisions directly.

**Execution mode**: Foreground sequential — single coherent assessment task per unit.

**Delegation scope**:
- **Orchestrator retains**: Steps 1-5 (analyze functional design, plan creation, Q&A, answer collection) and Steps 7-9 (completion message, approval gate, state update).
- **Delegated to `oracle-medium`**: Step 6 (Generate NFR Requirements Artifacts) — the agent analyzes functional design context and user answers to produce nfr-requirements.md and tech-stack-decisions.md.

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After agent completes**: The orchestrator compiles the agent's output into the artifact files, presents the completion message, and manages the approval gate.

**Optional technology validation — `librarian`**:
When user answers in Step 5 name specific technologies, frameworks, or cloud services (e.g., "use Kafka", "Redis for caching", "Next.js 15"), the orchestrator may optionally invoke `librarian` to validate those choices against current documentation. Librarian can verify version compatibility, licensing terms, known limitations, and service-specific constraints that `oracle-medium` may not have in its training data. This is not mandatory — only invoke when specific technology names appear in user answers and validation would improve the accuracy of tech-stack-decisions.md.

## Overview
Determine non-functional requirements for the unit and make tech stack choices.

## Steps to Execute

### Step 1: Analyze Functional Design
- Read functional design artifacts from `aidlc-docs/construction/{unit-name}/functional-design/`
- Understand business logic complexity and requirements

### Step 2: Create NFR Requirements Plan
- Generate plan with checkboxes [] for NFR assessment
- Focus on scalability, performance, availability, security
- Each step should have a checkbox []

### Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Thoroughly analyze the functional design to identify ALL areas where NFR clarification would improve system quality and architecture decisions. Be proactive in asking questions to ensure comprehensive NFR coverage.

**CRITICAL**: Default to asking questions when there is ANY ambiguity or missing detail that could affect system quality. It's better to ask too many questions than to make incorrect NFR assumptions.

- EMBED questions using [Answer]: tag format
- Focus on ANY ambiguities, missing information, or areas needing clarification
- Generate questions wherever user input would improve NFR and tech stack decisions
- **When in doubt, ask the question** - overconfidence leads to poor system quality

**Question categories to evaluate** (consider ALL categories):
- **Scalability Requirements** - Ask about expected load, growth patterns, scaling triggers, and capacity planning
- **Performance Requirements** - Ask about response times, throughput, latency, and performance benchmarks
- **Availability Requirements** - Ask about uptime expectations, disaster recovery, failover, and business continuity
- **Security Requirements** - Ask about data protection, compliance, authentication, authorization, and threat models
- **Tech Stack Selection** - Ask about technology preferences, constraints, existing systems, and integration requirements
- **Reliability Requirements** - Ask about error handling, fault tolerance, monitoring, and alerting needs
- **Maintainability Requirements** - Ask about code quality, documentation, testing, and operational requirements
- **Usability Requirements** - Ask about user experience, accessibility, and interface requirements

### Step 4: Store Plan
- Save as `aidlc-docs/construction/plans/{unit-name}-nfr-requirements-plan.md`
- Include all [Answer]: tags for user input

### Step 5: Collect and Analyze Answers
- Wait for user to complete all [Answer]: tags
- **MANDATORY**: Carefully review ALL responses for vague or ambiguous answers
- **CRITICAL**: Add follow-up questions for ANY unclear responses - do not proceed with ambiguity
- Look for responses like "depends", "maybe", "not sure", "mix of", "somewhere between", "standard", "typical"
- Create clarification questions file if ANY ambiguities are detected
- **Do not proceed until ALL ambiguities are resolved**

### Step 6: Generate NFR Requirements Artifacts
- Create `aidlc-docs/construction/{unit-name}/nfr-requirements/nfr-requirements.md`
- Create `aidlc-docs/construction/{unit-name}/nfr-requirements/tech-stack-decisions.md`

### Step 7: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

```markdown
# 📊 NFR Requirements Complete - [unit-name]
```

     2. **AI Summary** (optional): Provide structured bullet-point summary of NFR requirements
        - Format: "NFR requirements assessment has identified [description]:"
        - List key scalability, performance, availability requirements (bullet points)
        - List security and compliance requirements identified
        - Mention tech stack decisions and rationale
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

```markdown
---

⚠️ **REVIEW REQUIRED**

> Please examine the NFR requirements at:
> `aidlc-docs/{workflow-id}/construction/[unit-name]/nfr-requirements/`

**You may:**
- 🔧 **Request Changes** — Ask for modifications to the NFR requirements based on your review
- ✅ **Continue to Next Stage** — Approve NFR requirements and proceed to **[next-stage-name]**

---
```

### Step 8: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the NFR requirements
- Approval must be clear and unambiguous
- If user requests changes, update the requirements and repeat the approval process

### Step 9: Record Approval and MANDATORY State Update
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- **MANDATORY**: Update BOTH state files in the SAME interaction:
  1. Mark NFR Requirements stage complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set nfr-requirements status to "completed" with completed_at timestamp
- **Do NOT proceed to the next stage without completing state updates**
