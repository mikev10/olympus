# Requirements Analysis (Adaptive)

**Assume the role** of a product owner

**Adaptive Phase**: Always executes. Detail level adapts to problem complexity.

**See [depth-levels.md](../common/depth-levels.md) for adaptive depth explanation**

## Prerequisites
- Workspace Detection must be complete
- Reverse Engineering must be complete (if brownfield)

## Agent Delegation Strategy

**Orchestrator-driven stage** with optional agent support. Requirements Analysis is primarily Q&A-driven work that the orchestrator manages directly (intent analysis, question generation, answer collection, requirements document creation).

**Optional delegation**:
- **`metis`** (Opus, read-only): May be invoked for blind spot analysis during the question-answering phase. If used, findings are presented to the user for review in Step 6b. This is optional and at the orchestrator's discretion based on project complexity.

**Execution mode**: The orchestrator runs all steps directly. If `metis` is invoked, it runs in the foreground as a supplementary analysis — not a replacement for the orchestrator's own work.

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

## Execution Steps

### Step 1: Load Reverse Engineering Context (if available)

**IF brownfield project**:
- Load `aidlc-docs/{workflowId}/discovery/static-model.md`
- Load `aidlc-docs/{workflowId}/discovery/current-state-analysis.md`
- Load `aidlc-docs/{workflowId}/discovery/workspace-scan.json`
- Use these to understand existing system when analyzing request

### Step 2: Analyze User Request (Intent Analysis)

#### 2.1 Request Clarity
- **Clear**: Specific, well-defined, actionable
- **Vague**: General, ambiguous, needs clarification
- **Incomplete**: Missing key information

#### 2.2 Request Type
- **New Feature**: Adding new functionality
- **Bug Fix**: Fixing existing issue
- **Refactoring**: Improving code structure
- **Upgrade**: Updating dependencies or frameworks
- **Migration**: Moving to different technology
- **Enhancement**: Improving existing feature
- **New Project**: Starting from scratch

#### 2.3 Initial Scope Estimate
- **Single File**: Changes to one file
- **Single Component**: Changes to one component/package
- **Multiple Components**: Changes across multiple components
- **System-wide**: Changes affecting entire system
- **Cross-system**: Changes affecting multiple systems

#### 2.4 Initial Complexity Estimate
- **Trivial**: Simple, straightforward change
- **Simple**: Clear implementation path
- **Moderate**: Some complexity, multiple considerations
- **Complex**: Significant complexity, many considerations

### Step 3: Determine Requirements Depth

**Based on request analysis, determine depth:**

**Minimal Depth** - Use when:
- Request is clear and simple
- No detailed requirements needed
- Just document the basic understanding

**Standard Depth** - Use when:
- Request needs clarification
- Functional and non-functional requirements needed
- Normal complexity

**Comprehensive Depth** - Use when:
- Complex project with multiple stakeholders
- High risk or critical system
- Detailed requirements with traceability needed

### Step 4: Assess Current Requirements

Analyze whatever the user has provided:
   - Intent statements or descriptions (already logged in audit.md)
   - Existing requirements documents (search workspace if mentioned)
   - Pasted content or file references
   - Convert any non-markdown documents to markdown format 

### Step 5: Thorough Completeness Analysis

**CRITICAL**: Use comprehensive analysis to evaluate requirements completeness. Default to asking questions when there is ANY ambiguity or missing detail.

**MANDATORY**: Evaluate ALL of these areas and ask questions for ANY that are unclear:
- **Functional Requirements**: Core features, user interactions, system behaviors
- **Non-Functional Requirements**: Performance, security, scalability, usability
- **Scenario Coverage**: Use cases, user journeys, edge cases, error scenarios
- **Business Context**: Goals, constraints, success criteria, stakeholder needs
- **Technical Context**: Integration points, data requirements, system boundaries
- **Quality Attributes**: Reliability, maintainability, testability, accessibility

**When in doubt, ask questions** - incomplete requirements lead to poor implementations.

### Step 6: Generate Clarifying Questions (PROACTIVE APPROACH)
   - **ALWAYS** create `aidlc-docs/{workflow-id}/inception/requirements/requirements-analysis-questions.md` unless requirements are exceptionally clear and complete
   - Ask questions about ANY missing, unclear, or ambiguous areas
   - Focus on functional requirements, non-functional requirements, user scenarios, and business context
   - Request user to fill in all [Answer]: tags directly in the questions document
   - If presenting multiple-choice options for answers:
     - Label the options as A, B, C, D etc.
     - Ensure options are mutually exclusive and don't overlap
     - ALWAYS include option for custom response: "X) Other (please describe after [Answer]: tag below)"
   - Wait for user answers in the document
   - **MANDATORY**: Analyze ALL answers for ambiguities and create follow-up questions if needed
   - **MANDATORY**: Keep asking questions until ALL ambiguities are resolved OR user explicitly asks to proceed

### ⛔ GATE: Await User Answers
DO NOT proceed to Step 7 until all questions in requirements-analysis-questions.md are answered and validated.
Present the question file to the user and STOP.

### Step 6b: Review Supplementary Analysis (if applicable)

**IF a Metis blind spot analysis (or any supplementary agent analysis) was run during the question-answering phase:**

1. **Write findings to a file** — Create `aidlc-docs/{workflow-id}/inception/requirements/metis-blind-spot-analysis.md` with this structure:

```markdown
# Metis Blind Spot Analysis

Date: {ISO-8601}
Feature: {feature name}

## How to Review

For each finding below, Metis has provided a **Recommendation** with a suggested course of action.
Review each finding and:
- **Check the box** `[x]` next to findings you want incorporated into requirements
- **Add comments** in the "Your Comments" field if you want to modify or clarify a finding
- Leave unchecked findings as `[ ]` to skip them

When done, let me know and I will incorporate your approved findings into the requirements.

---

## Findings

### 1. [Finding title]
[Description of the gap/risk and why it was flagged]

**Recommendation**: [Metis's suggested course of action — e.g., incorporate as requirement, defer to later phase, investigate further, add as constraint, etc.]

- [ ] Include this finding
- **Your Comments**:

---

### 2. [Finding title]
...

{repeat for all findings}
```

2. **Present the file to the user** for review:

```markdown
> **🔎 Metis Blind Spot Analysis**
>
> Metis identified potential gaps and risks during requirements analysis.
> Findings with recommendations have been written to:
> `aidlc-docs/{workflow-id}/inception/requirements/metis-blind-spot-analysis.md`
>
> Please review the file — each finding includes Metis's recommended course of action to help you decide.
> Check the boxes for findings you want included and add any comments, then let me know to continue.
```

3. **MANDATORY**: Do NOT proceed to Step 7 until the user has reviewed the file and responded
4. **MANDATORY**: Only incorporate findings the user explicitly checked/approved in the file
5. Log the user's response in `audit.md` with complete raw input

**IF no supplementary analysis was run**: Skip directly to Step 7.

### Step 7: Generate Requirements Document
   - **PREREQUISITE**: Step 6 gate must be passed — all answers received and analyzed. If Step 6b applied, supplementary findings must also be reviewed.
   - Create `aidlc-docs/{workflow-id}/inception/requirements/requirements.md`
   - Begin with YAML frontmatter mirroring intent.md classification:

```yaml
---
workflow: "{workflow-id}"
pathway: "{greenfield|brownfield-enhancement|brownfield-refactor|bugfix|migration}"
scope: "{single-file|single-component|multi-component|system-wide|cross-system}"
complexity: "{trivial|simple|moderate|complex}"
depth: "{minimal|standard|comprehensive}"
status: draft
created: "{ISO-8601}"
---
```

   - Include intent analysis summary after frontmatter:
     - User request (verbatim or paraphrased)
     - Request type classification
     - Scope estimate
     - Complexity estimate
   - **Do NOT include a User Stories section** — user stories with personas and acceptance criteria are generated in the dedicated User Stories stage
   - Incorporate user's answers to clarifying questions
   - If the requirements introduce 3+ domain-specific terms that aren't self-explanatory, append a `## Glossary` section defining them

#### Depth-Specific Content Guidance

The depth determined in Step 3 controls which sections to include and how much detail each receives:

**Minimal** (clear, simple requests):
- Intent analysis summary
- Functional requirements (concise list)
- Brief key requirements summary
- Coverage verification (expect most areas N/A with justification)

**Standard** (normal complexity):
- All Minimal sections, plus:
- Non-functional requirements
- Scenario coverage (key use cases and error scenarios)
- Coverage verification (expect most areas Covered)

**Comprehensive** (complex, high-risk):
- All Standard sections, plus:
- Detailed scenario coverage with edge cases and error scenarios
- Dedicated Business Context section
- Dedicated Technical Context section
- Coverage verification (ALL areas must be Covered or have justified Partial status)

#### 7b. Coverage Verification (MANDATORY)

Include a **Coverage Verification** section at the end of `requirements.md`. This maps directly to the six coverage areas evaluated in Step 5. Every area must be accounted for:

```markdown
## Coverage Verification

| Area | Status | Section | Notes |
|------|--------|---------|-------|
| Functional Requirements | {Covered/Partial/N-A} | {§ section ref} | {justification if Partial or N-A} |
| Non-Functional Requirements | {Covered/Partial/N-A} | {§ section ref} | {justification if Partial or N-A} |
| Scenario Coverage | {Covered/Partial/N-A} | {§ section ref} | {justification if Partial or N-A} |
| Business Context | {Covered/Partial/N-A} | {§ section ref} | {justification if Partial or N-A} |
| Technical Context | {Covered/Partial/N-A} | {§ section ref} | {justification if Partial or N-A} |
| Quality Attributes | {Covered/Partial/N-A} | {§ section ref} | {justification if Partial or N-A} |
```

**Rules**:
- **Covered**: The area has a dedicated section with substantive content
- **Partial**: The area is addressed but incomplete — the Notes column MUST explain what is missing and why
- **N-A**: The area does not apply to this workflow — the Notes column MUST justify the exclusion
- If any area is Partial, consider whether follow-up questions are needed before finalizing

### Step 8: MANDATORY: Update State Tracking

**MANDATORY**: Update BOTH state files in the SAME interaction:
1. Update `aidlc-docs/{workflow-id}/aidlc-state.md`:

```markdown
## Stage Progress
### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [x] Reverse Engineering (if applicable)
- [x] Requirements Analysis
```

### Step 9: Log and Proceed
   - Log approval prompt with timestamp in `aidlc-docs/audit.md`
   - Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

```markdown
# 🔍 Requirements Analysis Complete
```

     2. **AI Summary** (optional): Provide structured bullet-point summary of requirements
        - Format: "Requirements analysis has identified [project type/complexity]:"
        - List key functional requirements (bullet points)
        - List key non-functional requirements (bullet points)
        - Mention architectural considerations or technical decisions if relevant
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

```markdown
---

⚠️ **REVIEW REQUIRED**

> Please examine the requirements document at:
> `aidlc-docs/{workflow-id}/inception/requirements/requirements.md`

**You may:**
- 🔧 **Request Changes** — Ask for modifications to the requirements if required based on your review
- ➕ **Add Skipped Stage** — Include a previously excluded stage (e.g., User Stories if currently skipped)
- ✅ **Approve & Continue** — Approve requirements and proceed to **[User Stories/Workflow Planning]**

---
```

**Note**: Include the "Add User Stories" option only when User Stories stage will be skipped. Replace [User Stories/Workflow Planning] with the actual next stage name.

   - Wait for explicit user approval before proceeding
   - Record approval response with timestamp
   - Update Requirements Analysis stage complete in aidlc-state.md
