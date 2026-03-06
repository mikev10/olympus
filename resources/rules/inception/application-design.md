# Application Design - Detailed Steps

## Purpose
**High-level component identification and service layer design**

Application Design focuses on:
- Identifying main functional components and their responsibilities
- Defining component interfaces (not detailed business logic)
- Designing service layer for orchestration
- Establishing component dependencies and communication patterns

**Note**: Detailed business logic design happens later in Functional Design (per-unit, CONSTRUCTION phase)

## Prerequisites
- Context Assessment must be complete
- Requirements Assessment recommended (provides functional context)
- Story Development recommended (user stories guide design decisions)
- Execution plan must indicate Application Design stage should execute

## Step-by-Step Execution

### 1. Analyze Context
- Read `aidlc-docs/inception/requirements/requirements.md` and `aidlc-docs/inception/user-stories/stories.md`
- Identify key business capabilities and functional areas
- Determine design scope and complexity

### 2. Generate Context-Appropriate Questions
**DIRECTIVE**: Analyze the requirements and stories to generate ONLY questions relevant to THIS specific application design. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- Use [Answer]: tag format for each question
- Include [Recommendation]: tag with AI recommendation before each [Answer]: tag
- Focus on ambiguities and missing information specific to this context
- Generate questions only where user input is needed for design decisions
- If presenting multiple-choice options:
  - Label the options as A, B, C, D etc.
  - Ensure options are mutually exclusive and don't overlap
  - ALWAYS include option for custom response: "X) Other (please describe after [Answer]: tag below)"

**Example question categories** (adapt as needed):
- **Component Identification** - Only if component boundaries or organization is unclear
- **Component Methods** - Only if method signatures need clarification (detailed business rules come later)
- **Service Layer Design** - Only if service orchestration or boundaries are ambiguous
- **Component Dependencies** - Only if communication patterns or dependency management is unclear
- **Design Patterns** - Only if architectural style or pattern choice needs user input

### 3. Store Questions File
- Save as `aidlc-docs/inception/application-design/application-design-questions.md`
- Include all [Recommendation]: and [Answer]: tags
- Do NOT include plan checkboxes or artifact lists in this file — this is Q&A only

### 4. Request User Input
- Ask user to fill [Answer]: tags in the questions document
- Emphasize importance of design decisions
- Provide clear instructions on completing the [Answer]: tags

### GATE: Await User Answers
DO NOT proceed to Step 5 until all questions in application-design-questions.md are answered and validated.
Present the question file to the user and STOP.

### 5. ANALYZE ANSWERS (MANDATORY)
Before proceeding, you MUST carefully review all user answers for:
- **Vague or ambiguous responses**: "mix of", "somewhere between", "not sure", "depends"
- **Undefined criteria or terms**: References to concepts without clear definitions
- **Contradictory answers**: Responses that conflict with each other
- **Missing design details**: Answers that lack specific guidance
- **Answers that combine options**: Responses that merge different approaches without clear decision rules

### 6. MANDATORY Follow-up Questions
If the analysis in Step 5 reveals ANY ambiguous answers, you MUST:
- Add specific follow-up questions to the questions document using [Answer]: tags
- DO NOT proceed to the plan until all ambiguities are resolved
- Examples of required follow-ups:
  - "You mentioned 'mix of A and B' - what specific criteria should determine when to use A vs B?"
  - "You said 'somewhere between A and B' - can you define the exact middle ground approach?"
  - "You indicated 'not sure' - what additional information would help you decide?"
  - "You mentioned 'depends on complexity' - how do you define complexity levels?"

### 7. Create Application Design Plan
- **PREREQUISITE**: All questions must be answered and validated (Steps 2-6 complete)
- Generate plan with checkboxes [] for application design
- Incorporate user's answers from the questions file into plan decisions
- Focus on components, responsibilities, methods, business rules, and services
- Each step and sub-step should have a checkbox []

### 8. Include Mandatory Design Artifacts in Plan
- **ALWAYS** include these mandatory artifacts in the design plan:
  - [ ] Generate components.md with component definitions and high-level responsibilities
  - [ ] Generate component-methods.md with method signatures (business rules detailed later in Functional Design)
  - [ ] Generate services.md with service definitions and orchestration patterns
  - [ ] Generate component-dependency.md with dependency relationships and communication patterns
  - [ ] Validate design completeness and consistency

### 9. Store Application Design Plan
- Save as `aidlc-docs/inception/plans/application-design-plan.md`
- Do NOT include [Answer]: tags — all design decisions should already be resolved
- Ensure plan covers all design aspects informed by the answered questions

### 10. Present Plan for Approval
- Present the plan to the user for review
- Wait for explicit approval before executing
- If user requests changes, update the plan and repeat

### 11. Generate Application Design Artifacts
- Execute the approved plan to generate design artifacts
- Create `aidlc-docs/inception/application-design/components.md` with:
  - Component name and purpose
  - Component responsibilities
  - Component interfaces
- Create `aidlc-docs/inception/application-design/component-methods.md` with:
  - Method signatures for each component
  - High-level purpose of each method
  - Input/output types
  - Note: Detailed business rules will be defined in Functional Design (per-unit, CONSTRUCTION phase)
- Create `aidlc-docs/inception/application-design/services.md` with:
  - Service definitions
  - Service responsibilities
  - Service interactions and orchestration
- Create `aidlc-docs/inception/application-design/component-dependency.md` with:
  - Dependency matrix showing relationships
  - Communication patterns between components
  - Data flow diagrams

### 12. Log Approval
- Log approval prompt with timestamp in `aidlc-docs/audit.md`
- Include complete approval prompt text
- Use ISO 8601 timestamp format

### 13. Present Completion Message

```markdown
# Application Design Complete

[AI-generated summary of application design artifacts created in bullet points]

> **REVIEW REQUIRED:**
> Please examine the application design artifacts at: `aidlc-docs/inception/application-design/`

> **WHAT'S NEXT?**
>
> **You may:**
>
> **Request Changes** - Ask for modifications to the application design if required
> [IF Units Generation is skipped:]
> **Add Units Generation** - Choose to include **Units Generation** stage (currently skipped)
> **Approve & Continue** - Approve design and proceed to **[Units Generation/CONSTRUCTION PHASE]**
```

### 14. Wait for Explicit Approval
- Do not proceed until the user explicitly approves the application design
- Approval must be clear and unambiguous
- If user requests changes, update the design and repeat the approval process

### 15. Record Approval Response
- Log the user's approval response with timestamp in `aidlc-docs/audit.md`
- Include the exact user response text
- Mark the approval status clearly

### 16. MANDATORY: Update State Tracking
- **MANDATORY**: Update BOTH state files in the SAME interaction:
  1. Mark Application Design stage complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set application-design status to "completed" with completed_at timestamp, update current_inception_stage to next stage
- **Do NOT proceed to the next stage without completing this step**
