<!-- AIDLC-RULES-START -->
# AI-DLC Core Workflow (Olympus Reference)

This document adapts the AWS AI-DLC workflow for Olympus conventions.
Actual workflow execution is driven by the `/plan` command and Olympus agent delegation.

## Adaptive Workflow Principle

**The workflow adapts to the work, not the other way around.**

The AI model intelligently assesses what stages are needed based on:
1. User's stated intent and clarity
2. Existing codebase state (if any)
3. Complexity and scope of change
4. Risk and impact assessment

## MANDATORY: Rule Details Loading

**CRITICAL**: When performing any phase, you MUST read and use relevant content from rule detail files installed at `~/.claude/olympus/rules/`.

**Common Rules**: ALWAYS load common rules at workflow start:
- Load `~/.claude/olympus/rules/common/process-overview.md` for workflow overview
- Load `~/.claude/olympus/rules/common/session-continuity.md` for session resumption guidance
- Load `~/.claude/olympus/rules/common/content-validation.md` for content validation requirements
- Load `~/.claude/olympus/rules/common/question-format-guide.md` for question formatting rules
- Load `~/.claude/olympus/rules/common/terminology.md` for phase/stage naming conventions
- Load `~/.claude/olympus/rules/common/error-handling.md` for error recovery procedures
- Reference these throughout the workflow execution

## MANDATORY: Content Validation

**CRITICAL**: Before creating ANY file, you MUST validate content according to `~/.claude/olympus/rules/common/content-validation.md` rules:
- Validate Mermaid diagram syntax
- Validate ASCII art diagrams (see `~/.claude/olympus/rules/common/ascii-diagram-standards.md`)
- Escape special characters properly
- Provide text alternatives for complex visual content
- Test content parsing compatibility

## MANDATORY: Question File Format

**CRITICAL**: When asking questions at any phase, you MUST follow question format guidelines.

**See `~/.claude/olympus/rules/common/question-format-guide.md` for complete question formatting rules including**:
- Multiple choice format (A, B, C, D, E options)
- [Answer]: tag usage
- Answer validation and ambiguity resolution

## MANDATORY: Custom Welcome Message

**CRITICAL**: When starting ANY software development request, you MUST display the welcome message.

**How to Display Welcome Message**:
1. Load the welcome message from `~/.claude/olympus/rules/common/welcome-message.md`
2. Display the complete message to the user
3. This should only be done ONCE at the start of a new workflow
4. Do NOT load this file in subsequent interactions to save context space

# Adaptive Software Development Workflow

---

# INCEPTION PHASE

**Purpose**: Planning, requirements gathering, and architectural decisions

**Focus**: Determine WHAT to build and WHY

**Stages in INCEPTION PHASE**:
- Workspace Detection (ALWAYS)
- Reverse Engineering (CONDITIONAL - Brownfield only)
- Requirements Analysis (ALWAYS - Adaptive depth)
- User Stories (CONDITIONAL)
- Workflow Planning (ALWAYS)
- Application Design (CONDITIONAL)
- Units Generation (CONDITIONAL)

---

## Workspace Detection (ALWAYS EXECUTE)

1. **MANDATORY**: Log initial user request in audit.md with complete raw input
2. Load all steps from `~/.claude/olympus/rules/inception/workspace-detection.md`
3. Execute workspace detection:
   - Check for existing aidlc-state.md (resume if found)
   - Scan workspace for existing code
   - Determine if brownfield or greenfield
   - Check for existing reverse engineering artifacts
4. Determine next phase: Reverse Engineering (if brownfield and no artifacts) OR Requirements Analysis
5. **MANDATORY**: Log findings in audit.md
6. Present completion message to user (see workspace-detection.md for message formats)
7. Automatically proceed to next phase

## Reverse Engineering (CONDITIONAL - Brownfield Only)

**Execute IF**:
- Existing codebase detected
- No previous reverse engineering artifacts found

**Skip IF**:
- Greenfield project
- Previous reverse engineering artifacts exist

**Execution**:
1. **MANDATORY**: Log start of reverse engineering in audit.md
2. Load all steps from `~/.claude/olympus/rules/inception/reverse-engineering.md`
3. Execute reverse engineering — delegate to `explore-medium` for codebase analysis:
   - Analyze all packages and components
   - Generate a business overview of the whole system covering the business transactions
   - Generate architecture documentation
   - Generate code structure documentation
   - Generate API documentation
   - Generate component inventory
   - Generate Interaction Diagrams depicting how business transactions are implemented across components
   - Generate technology stack documentation
   - Generate dependencies documentation

4. **Wait for Explicit Approval**: Present detailed completion message (see reverse-engineering.md for message format) - DO NOT PROCEED until user confirms
5. **MANDATORY**: Log user's response in audit.md with complete raw input

## Requirements Analysis (ALWAYS EXECUTE - Adaptive Depth)

**Always executes** but depth varies based on request clarity and complexity:
- **Minimal**: Simple, clear request - just document intent analysis
- **Standard**: Normal complexity - gather functional and non-functional requirements
- **Comprehensive**: Complex, high-risk - detailed requirements with traceability

**Execution**:
1. **MANDATORY**: Log any user input during this phase in audit.md
2. Load all steps from `~/.claude/olympus/rules/inception/requirements-analysis.md`
3. Execute requirements analysis:
   - Load reverse engineering artifacts (if brownfield)
   - Analyze user request (intent analysis)
   - Determine requirements depth needed
   - Assess current requirements
   - Ask clarifying questions (if needed)
   - Generate requirements document
4. Execute at appropriate depth (minimal/standard/comprehensive)
5. **Wait for Explicit Approval**: Follow approval format from requirements-analysis.md detailed steps - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

## User Stories (CONDITIONAL)

**INTELLIGENT ASSESSMENT**: Use multi-factor analysis to determine if user stories add value:

**ALWAYS Execute IF** (High Priority Indicators):
- New user-facing features or functionality
- Changes affecting user workflows or interactions
- Multiple user types or personas involved
- Complex business requirements with acceptance criteria needs
- Cross-functional team collaboration required
- Customer-facing API or service changes
- New product capabilities or enhancements

**LIKELY Execute IF** (Medium Priority - Assess Complexity):
- Modifications to existing user-facing features
- Backend changes that indirectly affect user experience
- Integration work that impacts user workflows
- Performance improvements with user-visible benefits
- Security enhancements affecting user interactions
- Data model changes affecting user data or reports

**COMPLEXITY-BASED ASSESSMENT**: For medium priority cases, execute user stories if:
- Request involves multiple components or services
- Changes span multiple user touchpoints
- Business logic is complex or has multiple scenarios
- Requirements have ambiguity that stories could clarify
- Implementation affects multiple user journeys
- Change has significant business impact or risk

**SKIP ONLY IF** (Low Priority - Simple Cases):
- Pure internal refactoring with zero user impact
- Simple bug fixes with clear, isolated scope
- Infrastructure changes with no user-facing effects
- Technical debt cleanup with no functional changes
- Developer tooling or build process improvements
- Documentation-only updates

**ASSESSMENT CRITERIA**: When in doubt, favor inclusion of user stories for:
- Requests with business stakeholder involvement
- Changes requiring user acceptance testing
- Features with multiple implementation approaches
- Work that benefits from shared team understanding
- Projects where requirements clarity is valuable

**ASSESSMENT PROCESS**:
1. Analyze request complexity and scope
2. Identify user impact (direct or indirect)
3. Evaluate business context and stakeholder needs
4. Consider team collaboration benefits
5. Default to inclusion for borderline cases

**Note**: If Requirements Analysis executed, Stories can reference and build upon those requirements.

**User Stories has two parts within one stage**:
1. **Part 1 - Planning**: Create story plan with questions, collect answers, analyze for ambiguities, get approval
2. **Part 2 - Generation**: Execute approved plan to generate stories and personas

**Execution**:
1. **MANDATORY**: Log any user input during this phase in audit.md
2. Load all steps from `~/.claude/olympus/rules/inception/user-stories.md`
3. **MANDATORY**: Perform intelligent assessment (Step 1 in user-stories.md) to validate user stories are needed
4. Load reverse engineering artifacts (if brownfield)
5. If Requirements exist, reference them when creating stories
6. Execute at appropriate depth (minimal/standard/comprehensive)
7. **PART 1 - Planning**: Create story plan with questions, wait for user answers, analyze for ambiguities, get approval
8. **PART 2 - Generation**: Execute approved plan to generate stories and personas
9. **Wait for Explicit Approval**: Follow approval format from user-stories.md detailed steps - DO NOT PROCEED until user confirms
10. **MANDATORY**: Log user's response in audit.md with complete raw input

## Workflow Planning (ALWAYS EXECUTE)

1. **MANDATORY**: Log any user input during this phase in audit.md
2. Load all steps from `~/.claude/olympus/rules/inception/workflow-planning.md`
3. **MANDATORY**: Load content validation rules from `~/.claude/olympus/rules/common/content-validation.md`
4. Load all prior context:
   - Reverse engineering artifacts (if brownfield)
   - Intent analysis
   - Requirements (if executed)
   - User stories (if executed)
5. Execute workflow planning:
   - Determine which phases to execute
   - Determine depth level for each phase
   - Create multi-package change sequence (if brownfield)
   - Generate workflow visualization (VALIDATE Mermaid syntax before writing)
6. **MANDATORY**: Validate all content before file creation per content-validation.md rules
7. **Wait for Explicit Approval**: Present recommendations using language from workflow-planning.md Step 9, emphasizing user control to override recommendations - DO NOT PROCEED until user confirms
8. **MANDATORY**: Log user's response in audit.md with complete raw input

## Application Design (CONDITIONAL)

**Execute IF**:
- New components or services needed
- Component methods and business rules need definition
- Service layer design required
- Component dependencies need clarification

**Skip IF**:
- Changes within existing component boundaries
- No new components or methods
- Pure implementation changes

**Execution**:
1. **MANDATORY**: Log any user input during this phase in audit.md
2. Load all steps from `~/.claude/olympus/rules/inception/application-design.md`
3. Load reverse engineering artifacts (if brownfield)
4. Execute at appropriate depth (minimal/standard/comprehensive) — delegate to `oracle` for architecture decisions
5. **Wait for Explicit Approval**: Present detailed completion message (see application-design.md for message format) - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

## Units Generation (CONDITIONAL)

**Execute IF**:
- System needs decomposition into multiple units of work
- Multiple services or modules required
- Complex system requiring structured breakdown

**Skip IF**:
- Single simple unit
- No decomposition needed
- Straightforward single-component implementation

**Execution**:
1. **MANDATORY**: Log any user input during this phase in audit.md
2. Load all steps from `~/.claude/olympus/rules/inception/units-generation.md`
3. Load reverse engineering artifacts (if brownfield)
4. Execute at appropriate depth (minimal/standard/comprehensive)
5. **Wait for Explicit Approval**: Present detailed completion message (see units-generation.md for message format) - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

---

# CONSTRUCTION PHASE

**Purpose**: Detailed design, NFR implementation, and code generation

**Focus**: Determine HOW to build it

**Stages in CONSTRUCTION PHASE**:
- Per-Unit Loop (executes for each unit):
  - Functional Design (CONDITIONAL, per-unit)
  - NFR Requirements (CONDITIONAL, per-unit)
  - NFR Design (CONDITIONAL, per-unit)
  - Infrastructure Design (CONDITIONAL, per-unit)
  - Code Generation (ALWAYS, per-unit)
- Build and Test (ALWAYS - after all units complete)

**Note**: Each unit is completed fully (design + code) before moving to the next unit.

---

## Per-Unit Loop (Executes for Each Unit)

**For each unit of work, execute the following stages in sequence:**

Units are identified by name (e.g., `{unit-name}`) — not by numbered codes.
Each unit produces its own directory under `aidlc-docs/{workflow-id}/construction/{unit-name}/`.

### Functional Design (CONDITIONAL, per-unit)

**Execute IF**:
- New data models or schemas
- Complex business logic
- Business rules need detailed design

**Skip IF**:
- Simple logic changes
- No new business logic

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `~/.claude/olympus/rules/construction/functional-design.md`
3. Execute functional design for this unit — delegate to `oracle-medium` for design decisions
4. **MANDATORY**: Present standardized 2-option completion message as defined in functional-design.md - DO NOT use emergent 3-option behavior
5. **Wait for Explicit Approval**: User must choose between "Request Changes" or "Continue to Next Stage" - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

### NFR Requirements (CONDITIONAL, per-unit)

**Execute IF**:
- Performance requirements exist
- Security considerations needed
- Scalability concerns present
- Tech stack selection required

**Skip IF**:
- No NFR requirements
- Tech stack already determined

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `~/.claude/olympus/rules/construction/nfr-requirements.md`
3. Execute NFR assessment for this unit
4. **MANDATORY**: Present standardized 2-option completion message as defined in nfr-requirements.md - DO NOT use emergent behavior
5. **Wait for Explicit Approval**: User must choose between "Request Changes" or "Continue to Next Stage" - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

### NFR Design (CONDITIONAL, per-unit)

**Execute IF**:
- NFR Requirements was executed
- NFR patterns need to be incorporated

**Skip IF**:
- No NFR requirements
- NFR Requirements Assessment was skipped

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `~/.claude/olympus/rules/construction/nfr-design.md`
3. Execute NFR design for this unit
4. **MANDATORY**: Present standardized 2-option completion message as defined in nfr-design.md - DO NOT use emergent behavior
5. **Wait for Explicit Approval**: User must choose between "Request Changes" or "Continue to Next Stage" - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

### Infrastructure Design (CONDITIONAL, per-unit)

**Execute IF**:
- Infrastructure services need mapping
- Deployment architecture required
- Cloud resources need specification

**Skip IF**:
- No infrastructure changes
- Infrastructure already defined

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `~/.claude/olympus/rules/construction/infrastructure-design.md`
3. Execute infrastructure design for this unit
4. **MANDATORY**: Present standardized 2-option completion message as defined in infrastructure-design.md - DO NOT use emergent behavior
5. **Wait for Explicit Approval**: User must choose between "Request Changes" or "Continue to Next Stage" - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

### Code Generation (ALWAYS EXECUTE, per-unit)

**Always executes for each unit**

**Code Generation is two-part within one stage**:
1. **Part 1 - Planning**: Create a detailed code generation plan with explicit steps and checkboxes; present to user for approval
2. **Part 2 - Generation**: Execute the approved plan to generate code, tests, and artifacts — delegate to `olympian` or `olympian-high` (for complex units)

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `~/.claude/olympus/rules/construction/code-generation.md`
3. **PART 1 - Planning**: Create code generation plan with checkboxes, get user approval
4. **PART 2 - Generation**: Execute approved plan; delegate implementation to `olympian`
5. **MANDATORY**: Present standardized 2-option completion message as defined in code-generation.md - DO NOT use emergent behavior
6. **Wait for Explicit Approval**: User must choose between "Request Changes" or "Continue to Next Stage" - DO NOT PROCEED until user confirms
7. **MANDATORY**: Log user's response in audit.md with complete raw input

---

## Build and Test (ALWAYS EXECUTE)

1. **MANDATORY**: Log any user input during this phase in audit.md
2. Load all steps from `~/.claude/olympus/rules/construction/build-and-test.md`
3. Generate comprehensive build and test instructions — delegate to `qa-tester` for test execution:
   - Build instructions for all units
   - Unit test execution instructions
   - Integration test instructions (test interactions between units)
   - Performance test instructions (if applicable)
   - Additional test instructions as needed (contract tests, security tests, e2e tests)
4. Create instruction files in build-and-test/ subdirectory: build-instructions.md, unit-test-instructions.md, integration-test-instructions.md, performance-test-instructions.md, build-and-test-summary.md
5. **Wait for Explicit Approval**: Ask: "**Build and test instructions complete. Ready to proceed to Operations stage?**" - DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

---

# OPERATIONS PHASE

**Purpose**: Placeholder for future deployment and monitoring workflows

**Focus**: How to DEPLOY and RUN it (future expansion)

**Stages in OPERATIONS PHASE**:
- Operations (PLACEHOLDER)

---

## Operations (PLACEHOLDER)

**Status**: This stage is currently a placeholder for future expansion.

The Operations stage will eventually include:
- Deployment planning and execution
- Monitoring and observability setup
- Incident response procedures
- Maintenance and support workflows
- Production readiness checklists

**Current State**: All build and test activities are handled in the CONSTRUCTION phase.

## Key Principles

- **Adaptive Execution**: Only execute stages that add value
- **Transparent Planning**: Always show execution plan before starting
- **User Control**: User can request stage inclusion/exclusion
- **Progress Tracking**: Update aidlc-state.md with executed and skipped stages
- **Complete Audit Trail**: Log ALL user inputs and AI responses in audit.md with timestamps
  - **CRITICAL**: Capture user's COMPLETE RAW INPUT exactly as provided
  - **CRITICAL**: Never summarize or paraphrase user input in audit log
  - **CRITICAL**: Log every interaction, not just approvals
- **Quality Focus**: Complex changes get full treatment, simple changes stay efficient
- **Content Validation**: Always validate content before file creation per content-validation.md rules
- **NO EMERGENT BEHAVIOR**: Construction phases MUST use standardized 2-option completion messages as defined in their respective rule files. DO NOT create 3-option menus or other emergent navigation patterns.

## MANDATORY: Plan-Level Checkbox Enforcement

### MANDATORY RULES FOR PLAN EXECUTION
1. **NEVER complete any work without updating plan checkboxes**
2. **IMMEDIATELY after completing ANY step described in a plan file, mark that step [x]**
3. **This must happen in the SAME interaction where the work is completed**
4. **NO EXCEPTIONS**: Every plan step completion MUST be tracked with checkbox updates

### Two-Level Checkbox Tracking System
- **Plan-Level**: Track detailed execution progress within each stage
- **Stage-Level**: Track overall workflow progress in aidlc-state.md
- **Update immediately**: All progress updates in SAME interaction where work is completed

## Prompts Logging Requirements
- **MANDATORY**: Log EVERY user input (prompts, questions, responses) with timestamp in audit.md
- **MANDATORY**: Capture user's COMPLETE RAW INPUT exactly as provided (never summarize)
- **MANDATORY**: Log every approval prompt with timestamp before asking the user
- **MANDATORY**: Record every user response with timestamp after receiving it
- **CRITICAL**: ALWAYS append changes to EDIT audit.md file, NEVER use tools and commands that completely overwrite its contents
- Use ISO 8601 format for timestamps (YYYY-MM-DDTHH:MM:SSZ)
- Include stage context for each entry

### Audit Log Format:
```markdown
## [Stage Name or Interaction Type]
**Timestamp**: [ISO timestamp]
**User Input**: "[Complete raw user input - never summarized]"
**AI Response**: "[AI's response or action taken]"
**Context**: [Stage, action, or decision made]

---
```

### Correct Tool Usage for audit.md

CORRECT:
1. Read the audit.md file
2. Append/Edit the file to make changes

WRONG:
1. Read the audit.md file
2. Completely overwrite the audit.md with the contents of what you read, plus the new changes you want to add to it

## Directory Structure

```text
<WORKSPACE-ROOT>/                   # APPLICATION CODE HERE
├── [project-specific structure]    # Varies by project (see code-generation.md)
│
├── aidlc-docs/                     # DOCUMENTATION ONLY
│   ├── inception/                  # INCEPTION PHASE
│   │   ├── plans/
│   │   ├── reverse-engineering/    # Brownfield only
│   │   ├── requirements/
│   │   ├── user-stories/
│   │   └── application-design/
│   ├── construction/               # CONSTRUCTION PHASE
│   │   ├── plans/
│   │   ├── {unit-name}/
│   │   │   ├── functional-design/
│   │   │   ├── nfr-requirements/
│   │   │   ├── nfr-design/
│   │   │   ├── infrastructure-design/
│   │   │   └── code/               # Markdown summaries only
│   │   └── build-and-test/
│   ├── operations/                 # OPERATIONS PHASE (placeholder)
│   ├── aidlc-state.md
│   └── audit.md
```

**CRITICAL RULE**:
- Application code: Workspace root (NEVER in aidlc-docs/)
- Documentation: aidlc-docs/ only
- Project structure: See code-generation.md for patterns by project type

## Olympus Agent Delegation

When executing AI-DLC workflow stages, Olympus delegates to specialized agents:

| Stage | Agent | Recommended Skills | Purpose |
|-------|-------|--------------------|---------|
| Discovery/Reverse Engineering | `explore-medium` | — | Codebase analysis |
| Reverse Engineering (visual) | `multimodal-looker` (optional) | — | Architecture diagram extraction |
| Intent/Requirements | `prometheus` | — | Strategic planning with interview |
| Requirements Analysis | `metis` (optional) | — | Blind spot analysis |
| User Stories | `oracle-medium` | — | Story and persona generation |
| Application Design | `oracle` | — | Architecture decisions |
| Application Design (review) | `momus` (optional) | — | Design quality gate |
| Units Generation | `olympian` | — | Decomposition execution |
| Units Generation (review) | `momus` (optional) | — | Decomposition quality gate |
| Functional Design | `oracle-medium` | — | Design decisions |
| NFR Requirements | `oracle-medium` | — | NFR assessment |
| NFR Requirements (validation) | `librarian` (optional) | — | Technology doc verification |
| NFR Design | `oracle-medium` | — | Design pattern incorporation |
| Infrastructure Design | `oracle-medium` | — | Infrastructure mapping |
| Code Generation (backend) | `olympian` or `olympian-high` | `ascent`, `ultrawork` | Backend/general implementation |
| Code Generation (frontend) | `frontend-engineer` or `frontend-engineer-high` | `ascent`, `ultrawork` | UI/component implementation |
| Build & Test | `qa-tester` | `ascent` | Testing and verification |
| Review | `momus` | — | Critical evaluation |

Use the Task tool to delegate. Run independent stages in parallel when profitable.

## Recommended Skill Stacking for AI-DLC

The `/plan` command starts the AI-DLC workflow. For maximum effectiveness during the construction phase, users should stack additional Olympus skills:

| Combination | Effect | Best For |
|-------------|--------|----------|
| `/plan` alone | Structured workflow with agent delegation | Standard features, single-unit work |
| `/plan` + `/ascent` | Adds persistence — orchestrator cannot stop until all units complete | Multi-unit construction loops |
| `/plan` + `/ultrawork` | Adds parallel execution and verification guarantees | Large implementations, independent units |
| `/plan` + `/ascent` + `/ultrawork` | Full Olympus power: parallel, persistent, verified | Complex multi-unit features |

**How skills enhance the orchestrator during AI-DLC**:
- **`/ascent`** — Ensures the orchestrator persists through all construction units without stopping early. Enforces todo tracking and continuation.
- **`/ultrawork`** — Enables parallel Task calls for independent units, adds mandatory independent verification after every agent delegation, and enforces zero-tolerance for incomplete work.
- Skills modify the **orchestrator's behavior** (how it manages the workflow), not the sub-agents. Sub-agents are always delegated to via the Task tool with their own specific prompts.

## Extensions

Custom project-specific rule extensions can be placed in `.aidlc-rule-details/extensions/` at the workspace root. Files in that directory are loaded in addition to the standard rules above and take precedence for any rules they redefine.


---

# AI-DLC Workflow Rules (Olympus-Native)

## Active Workflow
- **Workflow ID**: `installer-content-extraction`
- **Pathway**: Brownfield (brownfield-refactor)
- **State file**: `aidlc-docs/installer-content-extraction/checkpoint.json`
- **Human-readable state**: `aidlc-docs/installer-content-extraction/aidlc-state.md`
- **Audit log**: `aidlc-docs/installer-content-extraction/audit.md`

## Olympus Agent Delegation

Use Olympus agents for every workflow activity — do NOT implement directly unless the
task is trivial (single file, <10 lines). The delegation table below maps AI-DLC
workflow activities to the correct Olympus agent:

| Activity | Olympus Agent | When |
|----------|--------------|------|
| Strategic planning, intent interview | `prometheus` | Inception kickoff |
| Plan review / critical evaluation | `momus` | After each inception stage |
| Code implementation (multi-file) | `olympian` | Construction phase |
| Complex debugging / root-cause | `oracle` | Failures, unexpected behaviour |
| Codebase exploration / search | `explore` | Before coding, brownfield analysis |
| Documentation, requirements writing | `document-writer` | Artifact generation |
| Research, dependency lookup | `librarian` | Tech stack decisions |
| UI / frontend components | `frontend-engineer` | User-facing features |

**How to delegate:**
```
Task(subagent_type="olympian", description="Implement {unit-name}", prompt="...")
Task(subagent_type="oracle", description="Debug failing test", prompt="...")
Task(subagent_type="explore", description="Map codebase structure", prompt="...")
```

## Rule Detail Files (On-Demand Loading)

**CRITICAL**: When executing any stage, you MUST read the corresponding rule detail file BEFORE starting that stage's work. Rule files are located at:
`~/.claude/olympus/rules/` (installed by olympus-ai)

**Common rules** — MUST load at workflow start (MANDATORY):
- `~/.claude/olympus/rules/common/process-overview.md`
- `~/.claude/olympus/rules/common/session-continuity.md`
- `~/.claude/olympus/rules/common/content-validation.md`
- `~/.claude/olympus/rules/common/question-format-guide.md`

**Per-stage rules** — MUST load before executing each stage (MANDATORY):
- `~/.claude/olympus/rules/inception/workspace-detection.md`
- `~/.claude/olympus/rules/inception/reverse-engineering.md` — brownfield only
- `~/.claude/olympus/rules/inception/requirements-analysis.md`
- `~/.claude/olympus/rules/inception/user-stories.md`
- `~/.claude/olympus/rules/inception/workflow-planning.md`
- `~/.claude/olympus/rules/inception/application-design.md`
- `~/.claude/olympus/rules/inception/units-generation.md`
- `~/.claude/olympus/rules/construction/functional-design.md`
- `~/.claude/olympus/rules/construction/nfr-requirements.md`
- `~/.claude/olympus/rules/construction/nfr-design.md`
- `~/.claude/olympus/rules/construction/infrastructure-design.md`
- `~/.claude/olympus/rules/construction/code-generation.md`

## Directory Layout

```
aidlc-docs/{workflow-id}/          # ALL documentation here
  checkpoint.json                  # Machine-readable state (V3)
  aidlc-state.md                   # Human-readable state
  audit.md                         # Append-only interaction log
  manifest.json                    # Artifact registry
  inception/
    intent.md
    nfr.md
    requirements-questions.md      # Q&A with [Answer]: tags
    requirements.md
    personas.md
    stories.md
    unit-of-work.md
    application-design/
    plans/
      workflow-routing.md
      execution-plan.md
  construction/
    {unit-name}/
      spec.md
      functional-design.md
      code-generation.md
  operations/
    deploy-guide.md
    runbook.md

[project source files]              # Application code — NEVER inside aidlc-docs/
```

## State Tracking Rules

1. **Dual tracking**: Every stage transition updates BOTH `checkpoint.json` (machine)
   AND `aidlc-state.md` (human). Never update one without the other.
2. **Audit log**: Append every user input and AI response to `audit.md` with ISO-8601
   timestamps. NEVER overwrite — always append/edit.
3. **Checkpoint persistence**: Save checkpoint after each stage completion (CCR-1).
4. **Plan-level checkboxes**: Mark plan steps `[x]` in the SAME interaction where work
   completes. No deferred updates.

## Inception Stages (in order)

1. Workspace Detection (always)
2. Reverse Engineering (brownfield — delegate to `explore` + `oracle`)
3. Requirements Analysis (always)
4. User Stories (conditional)
5. Workflow Planning (always)
6. Application Design (conditional)
7. Units Generation (conditional)

Each stage:
- Requires explicit human approval before proceeding (**do not auto-advance**)
- Produces a "REVIEW REQUIRED / WHAT'S NEXT" message after completion
- Logs all interactions in `audit.md`

## Construction Rules

- Complete each unit fully (design → code) before moving to the next unit
- Delegate code generation to `olympian` (or `olympian-high` for complex units)
- Use `oracle` for debugging failures, not re-running the same olympian prompt
- Mark code generation units fulfilled in `manifest.json` after human approval
- Run `npm run build:all && npm test` after each unit completes

## Must NOT Do

- Claim to override or supersede other built-in workflows
- Overwrite existing CLAUDE.md content outside these sentinel markers
- Implement multi-file changes without delegating to an Olympus agent
- Auto-advance past review gates without explicit human confirmation
- Write application code inside `aidlc-docs/`
<!-- AIDLC-RULES-END -->

# Olympus Project

## PROJECT CONTEXT

**What is Olympus?**
Olympus is a multi-agent orchestration system for Claude Code that enables intelligent task delegation, parallel execution, and specialized agent coordination. Tagline: "Summon the gods of code."

**Distribution:**
- **npm package**: `olympus-ai` (current version: 4.0.1)
- **GitHub**: https://github.com/mikev10/olympus
- **Claude Code plugin**: Distributed via `.claude-plugin` directory
- **CLI command**: `olympus-ai`

**Installation:**
Users install via: `npm install -g olympus-ai`
Postinstall script automatically configures `~/.claude/` with agents, commands, and skills.

**Target Audience:**
Claude Code users seeking enhanced orchestration capabilities, multi-agent delegation, and intelligent task automation.

**Quality Standards:**
- This is **production code** shipped to external users
- All changes must be **tested** (`npm test`) and production-ready
- Breaking changes require **semver** version bumps and migration guides
- Documentation must be **user-facing quality**
- Node.js ≥20.0.0 required

**Development Workflow:**
1. **Dogfooding**: Test changes by updating global `~/.claude/` installation
2. **Testing**: `npm run test` before commits, `npm run test:coverage` before releases
3. **Building**: `npm run build:all` (TypeScript + hooks)
4. **Releasing**: Update version, CHANGELOG.md, build, test, publish to npm, create GitHub release
5. **Distribution**: Build artifacts in `dist/`, plugin in `.claude-plugin/`

**Remember:** You're building a tool used by other developers. Code quality, documentation, and user experience matter.

## General Conventions

Primary language is TypeScript. Always use TypeScript for new files unless explicitly told otherwise. Follow existing project conventions for types, imports, and module structure.

## Workflow & Commits

After completing any feature implementation or bug fix, always: 1) run the build to verify compilation, 2) run the full test suite. Do NOT automatically commit — wait for the user to review changes and explicitly request a commit. When commits are requested, create atomic commits with descriptive messages and do not bundle unrelated changes into a single commit.

## Version Bump & Release Process

When bumping versions, always update the version number in ALL of these files:
- `package.json` (and run `npm install --package-lock-only` to sync lock file)
- `src/installer/index.ts` (VERSION constant)
- `src/__tests__/installer.test.ts` (expected version assertion)
- `.claude-plugin/plugin.json` (plugin version)
- `.claude/CLAUDE.md` (current version in PROJECT CONTEXT)

Then run the full build, run all tests, and create a single atomic commit with the format 'chore: bump version to X.Y.Z'.
