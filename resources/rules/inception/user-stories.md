# User Stories - Detailed Steps

## Purpose
**Convert requirements into user-centered stories with acceptance criteria**

User Stories focus on:
- Translating business requirements into user-centered narratives
- Defining clear acceptance criteria for each story
- Creating user personas that represent different stakeholder types
- Establishing shared understanding across teams
- Providing testable specifications for implementation

## Prerequisites
- Workspace Detection must be complete
- Requirements Analysis recommended (can reference requirements if available)
- Workflow Planning must indicate User Stories stage should execute

## Agent Delegation Strategy

**MANDATORY**: Delegate story and persona generation (Part 2) to `oracle-medium`. Do NOT generate user stories and personas directly.

**Execution mode**: Foreground sequential — single coherent story generation task requiring Sonnet-level reasoning for story quality.

**Delegation scope**:
- **Orchestrator retains**: Part 1 (Planning) — Steps 1-15. The orchestrator performs the intelligent assessment, creates the story plan, manages Q&A, resolves ambiguities, and obtains user approval.
- **Delegated to `oracle-medium`**: Part 2 (Generation) — Steps 16-19. The agent executes the approved plan to produce stories.md and personas.md following INVEST criteria.

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After agent completes**: The orchestrator reviews the generated stories, presents the completion message (Step 21), and manages the approval gate (Steps 22-24).

## Intelligent Assessment Guidelines

**WHEN TO EXECUTE USER STORIES**: Use this enhanced assessment before proceeding:

### High Priority Execution (ALWAYS Execute)
- **New User Features**: Any new functionality users will directly interact with
- **User Experience Changes**: Modifications to existing user workflows or interfaces
- **Multi-Persona Systems**: Applications serving different types of users
- **Customer-Facing APIs**: Services that external users or systems will consume
- **Complex Business Logic**: Requirements with multiple scenarios or business rules
- **Cross-Team Projects**: Work requiring shared understanding across multiple teams

### Medium Priority Execution (Assess Complexity)
- **Backend User Impact**: Internal changes that indirectly affect user experience
- **Performance Improvements**: Enhancements with user-visible benefits
- **Integration Work**: Connecting systems that affect user workflows
- **Data Changes**: Modifications affecting user data, reports, or analytics
- **Security Enhancements**: Changes affecting user authentication or permissions

### Complexity Assessment Factors
For medium priority cases, execute user stories if ANY of these apply:
- **Scope**: Changes span multiple components or user touchpoints
- **Ambiguity**: Requirements have unclear aspects that stories could clarify
- **Risk**: High business impact or potential for misunderstanding
- **Stakeholders**: Multiple business stakeholders involved in requirements
- **Testing**: User acceptance testing will be required
- **Options**: Multiple valid implementation approaches exist

### Skip Only For Simple Cases
- **Pure Refactoring**: Internal code improvements with zero user impact
- **Isolated Bug Fixes**: Simple, well-defined fixes with clear scope
- **Infrastructure Only**: Changes with no user-facing effects
- **Developer Tooling**: Build processes, CI/CD, or development environment changes
- **Documentation**: Updates that don't affect functionality

### Default Decision Rule
**When in doubt, include user stories AND ask clarifying questions.** The overhead of creating comprehensive stories with proper clarification is typically outweighed by the benefits of:
- Clearer requirements understanding
- Better team alignment
- Improved testing criteria
- Enhanced stakeholder communication
- Reduced implementation risks
- Fewer costly changes during development
- Better user experience outcomes

---

# PART 1: PLANNING

## Step 1: Validate User Stories Need (MANDATORY)

**CRITICAL**: Before proceeding with user stories, perform this assessment:

### Assessment Process
1. **Analyze Request Context**:
   - Review the original user request and requirements
   - Identify user-facing vs internal-only changes
   - Assess complexity and scope of the work
   - Evaluate business stakeholder involvement

2. **Apply Assessment Criteria**:
   - Check against High Priority indicators (always execute)
   - Evaluate Medium Priority factors (complexity-based decision)
   - Confirm this isn't a simple case that should be skipped

3. **Document Assessment Decision**:
   - Create `aidlc-docs/inception/plans/user-stories-assessment.md`
   - Include reasoning for why user stories are valuable for this request
   - Reference specific assessment criteria that apply
   - Explain expected benefits (clarity, testing, stakeholder alignment)

4. **Proceed Only If Justified**:
   - User stories must add clear value to the project
   - Assessment must show concrete benefits outweigh overhead
   - Decision should be defensible to project stakeholders

### Assessment Documentation Template
```markdown
# User Stories Assessment

## Request Analysis
- **Original Request**: [Brief summary]
- **User Impact**: [Direct/Indirect/None]
- **Complexity Level**: [Simple/Medium/Complex]
- **Stakeholders**: [List involved parties]

## Assessment Criteria Met
- [ ] High Priority: [List applicable criteria]
- [ ] Medium Priority: [List applicable criteria with complexity justification]
- [ ] Benefits: [Expected value from user stories]

## Decision
**Execute User Stories**: [Yes/No]
**Reasoning**: [Detailed justification]

## Expected Outcomes
- [List specific benefits user stories will provide]
- [How stories will improve project success]
```

## Step 2: Create Story Plan
- Assume the role of a product owner
- Generate a comprehensive plan with step-by-step execution checklist for story development
- Each step and sub-step should have a checkbox []
- Focus on methodology and approach for converting requirements into user stories

## Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Thoroughly analyze the requirements and context to identify ALL areas where clarification would improve story quality and team understanding. Be proactive in asking questions to ensure comprehensive user story development.

**CRITICAL**: Default to asking questions when there is ANY ambiguity or missing detail that could affect story quality. It's better to ask too many questions than to create incomplete or unclear stories.

**See `common/question-format-guide.md` for question formatting rules**

- Create a SEPARATE question file: `aidlc-docs/{workflow-id}/inception/user-stories/story-planning-questions.md`
- Do NOT embed questions in the story generation plan — questions and plans are always separate files
- Focus on ANY ambiguities, missing information, or areas needing clarification
- Generate questions wherever user input would improve story creation decisions
- **When in doubt, ask the question** - overconfidence leads to poor stories

**Question categories to evaluate** (consider ALL categories):
- **User Personas** - Ask about user types, roles, characteristics, and motivations
- **Story Granularity** - Ask about appropriate level of detail, story size, and breakdown approach
- **Story Format** - Ask about format preferences, template usage, and documentation standards
- **Breakdown Approach** - Ask about organization method, prioritization, and grouping strategies
- **Acceptance Criteria** - Ask about detail level, format, testing approach, and validation methods
- **User Journeys** - Ask about user workflows, interaction patterns, and experience flows
- **Business Context** - Ask about business goals, success metrics, and stakeholder needs
- **Technical Constraints** - Ask about technical limitations, integration requirements, and system boundaries

## Step 4: Include Mandatory Story Artifacts in Plan
- **ALWAYS** include these mandatory artifacts in the story plan:
  - [ ] Generate stories.md with user stories following INVEST criteria
  - [ ] Generate personas.md with user archetypes and characteristics
  - [ ] Ensure stories are Independent, Negotiable, Valuable, Estimable, Small, Testable
  - [ ] Include acceptance criteria for each story
  - [ ] Map personas to relevant user stories

## Step 5: Present Story Options
- Include different approaches for story breakdown in the plan document:
  - **User Journey-Based**: Stories follow user workflows and interactions
  - **Feature-Based**: Stories organized around system features and capabilities
  - **Persona-Based**: Stories grouped by different user types and their needs
  - **Domain-Based**: Stories organized around business domains or contexts
  - **Epic-Based**: Stories structured as hierarchical epics with sub-stories
- Explain trade-offs and benefits of each approach
- Allow for hybrid approaches with clear decision criteria

## Step 6: Store Story Plan
- Save the story plan in `aidlc-docs/{workflow-id}/inception/plans/story-generation-plan.md`
- The plan contains: overview, personas, execution steps, mandatory artifacts, story approach options
- Do NOT include questions in this file — questions are in the separate `story-planning-questions.md`
- Ensure plan is comprehensive and covers all story development aspects

## Step 7: Request User Input
- Ask user to fill in all [Answer]: tags in the questions file (`story-planning-questions.md`)
- Emphasize importance of audit trail and decision documentation
- Provide clear instructions on how to fill in the [Answer]: tags
- Explain that all questions must be answered before proceeding

## Step 8: Collect Answers
- Wait for user to provide answers to all questions using [Answer]: tags in the document
- Do not proceed until ALL [Answer]: tags are completed
- Review the document to ensure no [Answer]: tags are left blank

## Step 9: ANALYZE ANSWERS (MANDATORY)
Before proceeding, you MUST carefully review all user answers for:
- **Vague or ambiguous responses**: "mix of", "somewhere between", "not sure", "depends", "maybe", "probably"
- **Undefined criteria or terms**: References to concepts without clear definitions
- **Contradictory answers**: Responses that conflict with each other
- **Missing generation details**: Answers that lack specific guidance for implementation
- **Answers that combine options**: Responses that merge different approaches without clear decision rules
- **Incomplete explanations**: Answers that reference external factors without defining them
- **Assumption-based responses**: Answers that assume knowledge not explicitly stated

## Step 10: MANDATORY Follow-up Questions
If the analysis in step 9 reveals ANY ambiguous answers, you MUST:
- Create a separate clarification questions file using [Answer]: tags
- DO NOT proceed to approval until ALL ambiguities are completely resolved
- **CRITICAL**: Be thorough - ask follow-up questions for every unclear response
- Examples of required follow-ups:
  - "You mentioned 'mix of A and B' - what specific criteria should determine when to use A vs B?"
  - "You said 'somewhere between A and B' - can you define the exact middle ground approach?"
  - "You indicated 'not sure' - what additional information would help you decide?"
  - "You mentioned 'depends on complexity' - how do you define complexity levels and thresholds?"
  - "You chose 'hybrid approach' - what are the specific rules for when to use each method?"
  - "You said 'probably X' - what factors would make it definitely X vs definitely not X?"
  - "You referenced 'standard practice' - can you define what that standard practice is?"

## Step 11: MANDATORY: Consolidate Answers Into Plan

**See `common/question-format-guide.md` Post-Answer Consolidation rules**

After all answers are collected and ambiguities resolved, you MUST update the story generation plan file:
1. Read all finalized answers from `story-planning-questions.md`
2. Add a "Finalized Approach" section to `story-generation-plan.md` that synthesizes the user's decisions:
   - Story organization approach (with rationale from user's choice)
   - Acceptance criteria format
   - Priority system
   - Persona decisions
   - Any other methodology decisions from the Q&A
3. Update the execution steps if needed to reflect the chosen approach
4. The plan file must be self-contained — readable without cross-referencing the questions file
5. **Do NOT present for approval until the plan file contains the finalized approach**

## Step 12: Avoid Implementation Details
- Focus on story creation methodology, not prioritization or development tasks
- Do not discuss technical generation at this stage
- Avoid creating development timelines or sprint planning
- Keep focus on story structure and format decisions

## Step 13: Log Approval Prompt
- Before asking for approval, log the prompt with timestamp in `aidlc-docs/audit.md`
- Include the complete approval prompt text
- Use ISO 8601 timestamp format

## Step 14: Wait for Explicit Approval of Plan
- Do not proceed until the user explicitly approves the story approach
- Approval must be clear and unambiguous
- If user requests changes, update the plan and repeat the approval process

## Step 15: Record Approval Response
- Log the user's approval response with timestamp in `aidlc-docs/audit.md`
- Include the exact user response text
- Mark the approval status clearly

---

# PART 2: GENERATION

## Step 16: Load Story Generation Plan
- [ ] Read the complete story plan from `aidlc-docs/{workflow-id}/inception/plans/story-generation-plan.md`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context and requirements for that step

## Step 17: Execute Current Step
- [ ] Perform exactly what the current step describes
- [ ] Generate story artifacts as specified in the plan
- [ ] Follow the approved methodology and format from Planning
- [ ] Use the story breakdown approach specified in the plan

## Step 18: MANDATORY: Update Progress
- [ ] Mark the completed step as [x] in the story generation plan
- [ ] **MANDATORY**: Update `aidlc-docs/{workflow-id}/aidlc-state.md` current status
- [ ] **MANDATORY**: Update `aidlc-docs/{workflow-id}/checkpoint.json` current status
- [ ] Save all generated artifacts
- **Do NOT proceed without completing state updates**

## Step 19: Continue or Complete Generation
- [ ] If more steps remain, return to Step 16
- [ ] If all steps complete, verify stories are ready for next stage
- [ ] Ensure all mandatory artifacts are generated

## Step 20: Log Approval Prompt
- Before asking for approval, log the prompt with timestamp in `aidlc-docs/audit.md`
- Include the complete approval prompt text
- Use ISO 8601 timestamp format

## Step 21: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

```markdown
# 📚 User Stories Complete
```

     2. **AI Summary** (optional): Provide structured bullet-point summary of generated stories
        - Format: "User stories generation has created [description]:"
        - List key personas generated (bullet points)
        - List user stories created with counts and organization
        - Mention story structure and compliance (INVEST criteria, acceptance criteria)
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

```markdown
---

⚠️ **REVIEW REQUIRED**

> Please examine the user stories and personas at:
> `aidlc-docs/{workflow-id}/inception/user-stories/stories.md` and `personas.md`

**You may:**
- 🔧 **Request Changes** — Ask for modifications to the stories or personas based on your review
- ➕ **Add Skipped Stage** — Include a previously excluded stage in the workflow
- ✅ **Approve & Continue** — Approve user stories and proceed to **Workflow Planning**

---
```

## Step 22: Wait for Explicit Approval of Generated Stories
- Do not proceed until the user explicitly approves the generated stories
- Approval must be clear and unambiguous
- If user requests changes, update stories and repeat the approval process

## Step 23: Record Approval Response
- Log the user's approval response with timestamp in `aidlc-docs/audit.md`
- Include the exact user response text
- Mark the approval status clearly

## Step 24: MANDATORY: Update State Tracking
- **MANDATORY**: Update BOTH state files in the SAME interaction:
  1. Mark User Stories stage complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set user-stories status to "completed" with completed_at timestamp, update current_inception_stage to next stage
- **Do NOT proceed to the next stage without completing this step**

---

# CRITICAL RULES

## Planning Phase Rules
- **CONTEXT-APPROPRIATE QUESTIONS**: Only ask questions relevant to this specific context
- **MANDATORY ANSWER ANALYSIS**: Always analyze answers for ambiguities before proceeding
- **NO PROCEEDING WITH AMBIGUITY**: Must resolve all vague answers before generation
- **EXPLICIT APPROVAL REQUIRED**: User must approve plan before generation starts

## Generation Phase Rules
- **NO HARDCODED LOGIC**: Only execute what's written in the story generation plan
- **FOLLOW PLAN EXACTLY**: Do not deviate from the step sequence
- **UPDATE CHECKBOXES**: Mark [x] immediately after completing each step
- **USE APPROVED METHODOLOGY**: Follow the story approach from Planning
- **VERIFY COMPLETION**: Ensure all story artifacts are complete before proceeding

## Completion Criteria
- All planning questions answered and ambiguities resolved
- Story plan explicitly approved by user
- All steps in story generation plan marked [x]
- All story artifacts generated according to plan (stories.md, personas.md)
- Generated stories explicitly approved by user
- Stories verified and ready for next stage
