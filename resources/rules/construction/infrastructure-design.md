# Infrastructure Design

## Prerequisites
- Functional Design must be complete for the unit
- NFR Design recommended (provides logical components to map)
- Execution plan must indicate Infrastructure Design stage should execute

## Agent Delegation Strategy

**MANDATORY**: Delegate infrastructure design artifact generation (Step 6) to `oracle-medium`. Do NOT generate infrastructure mappings and deployment architecture directly.

**Execution mode**: Foreground sequential — single coherent infrastructure design task per unit.

**Delegation scope**:
- **Orchestrator retains**: Steps 1-5 (analyze design artifacts, plan creation, Q&A, answer collection) and Steps 7-9 (completion message, approval gate, state update).
- **Delegated to `oracle-medium`**: Step 6 (Generate Infrastructure Design Artifacts) — the agent maps logical components to actual infrastructure services, producing infrastructure-design.md, deployment-architecture.md, and shared-infrastructure.md (if applicable).

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After agent completes**: The orchestrator compiles the agent's output into the artifact files, presents the completion message, and manages the approval gate.

## Overview
Map logical software components to actual infrastructure choices for deployment environments.

## Steps to Execute

### Step 1: Analyze Design Artifacts
- Read functional design from `aidlc-docs/construction/{unit-name}/functional-design/`
- Read NFR design from `aidlc-docs/construction/{unit-name}/nfr-design/` (if exists)
- Identify logical components needing infrastructure

### Step 2: Create Infrastructure Design Plan
- Generate plan with checkboxes [] for infrastructure design
- Focus on mapping to actual services (AWS, Azure, GCP, on-premise)
- Each step should have a checkbox []

### Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Analyze the functional and NFR design to generate ONLY questions relevant to THIS specific unit's infrastructure needs. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- EMBED questions using [Answer]: tag format
- Focus on ambiguities and missing information specific to this unit
- Generate questions only where user input is needed for infrastructure decisions

**Example question categories** (adapt as needed):
- **Deployment Environment** - Only if cloud provider or environment setup is unclear
- **Compute Infrastructure** - Only if compute service choice needs clarification
- **Storage Infrastructure** - Only if database or storage selection is ambiguous
- **Messaging Infrastructure** - Only if messaging/queuing services need specification
- **Networking Infrastructure** - Only if load balancing or API gateway approach is unclear
- **Monitoring Infrastructure** - Only if observability tooling needs clarification
- **Shared Infrastructure** - Only if infrastructure sharing strategy is ambiguous

### Step 4: Store Plan
- Save as `aidlc-docs/construction/plans/{unit-name}-infrastructure-design-plan.md`
- Include all [Answer]: tags for user input

### Step 5: Collect and Analyze Answers
- Wait for user to complete all [Answer]: tags
- Review for vague or ambiguous responses
- Add follow-up questions if needed

### Step 6: Generate Infrastructure Design Artifacts
- Create `aidlc-docs/construction/{unit-name}/infrastructure-design/infrastructure-design.md`
- Create `aidlc-docs/construction/{unit-name}/infrastructure-design/deployment-architecture.md`
- If shared infrastructure: Create `aidlc-docs/construction/shared-infrastructure.md`

### Step 7: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

```markdown
# 🏢 Infrastructure Design Complete - [unit-name]
```

     2. **AI Summary** (optional): Provide structured bullet-point summary of infrastructure design
        - Format: "Infrastructure design has mapped [description]:"
        - List key infrastructure services and components (bullet points)
        - List deployment architecture decisions and rationale
        - Mention cloud provider choices and service mappings
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

```markdown
┌─ ⚠ REVIEW REQUIRED ──────────────────────────────────────────────────────────┐
│                                                                              │
│ Please examine the infrastructure design at:                                 │
│ `aidlc-docs/{workflow-id}/construction/[unit-name]/                          │
│ infrastructure-design/`                                                      │
│                                                                              │
│ ---                                                                          │
│                                                                              │
│ **📋 WHAT'S NEXT?**                                                         │
│                                                                              │
│ **You may:**                                                                 │
│ 🔧 **Request Changes** - Ask for modifications to the                       │
│    infrastructure design based on your review                                │
│ ✅ **Continue to Next Stage** - Approve infrastructure                      │
│    design and proceed to **Code Generation**                                 │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘

---
```

### Step 8: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the infrastructure design
- Approval must be clear and unambiguous
- If user requests changes, update the design and repeat the approval process

### Step 9: Record Approval and MANDATORY State Update
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- **MANDATORY**: Update BOTH state files in the SAME interaction:
  1. Mark Infrastructure Design stage complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set infrastructure-design status to "completed" with completed_at timestamp
- **Do NOT proceed to the next stage without completing state updates**
