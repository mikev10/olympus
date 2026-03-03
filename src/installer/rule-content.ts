/**
 * AI-DLC Rule Content
 *
 * Auto-generated from source rule markdown files.
 * Contains 25 rule files grouped into 4 phase-based constants.
 * These are installed to ~/.claude/olympus/rules/ by the installer.
 *
 * To regenerate: node scripts/gen-rule-content.js
 */

export const COMMON_RULES: string = `# ================================================================
# Rule: process-overview
# Source:common/process-overview.md
# ================================================================

# AI-DLC Adaptive Workflow Overview

**Purpose**: Technical reference for AI model and developers to understand complete workflow structure.

**Note**: Similar content exists in core-workflow.md (user welcome message) and README.md (documentation). This duplication is INTENTIONAL - each file serves a different purpose:
- **This file**: Detailed technical reference with Mermaid diagram for AI model context loading
- **core-workflow.md**: User-facing welcome message with ASCII diagram
- **README.md**: Human-readable documentation for repository

## The Three-Phase Lifecycle:
• **INCEPTION PHASE**: Planning and architecture (Workspace Detection + conditional phases + Workflow Planning)
• **CONSTRUCTION PHASE**: Design, implementation, build and test (per-unit design + Code Planning/Generation + Build & Test)
• **OPERATIONS PHASE**: Placeholder for future deployment and monitoring workflows

## The Adaptive Workflow:
• **Workspace Detection** (always) → **Reverse Engineering** (brownfield only) → **Requirements Analysis** (always, adaptive depth) → **Conditional Phases** (as needed) → **Workflow Planning** (always) → **Code Generation** (always, per-unit) → **Build and Test** (always)

## How It Works:
• **AI analyzes** your request, workspace, and complexity to determine which stages are needed
• **These stages always execute**: Workspace Detection, Requirements Analysis (adaptive depth), Workflow Planning, Code Generation (per-unit), Build and Test
• **All other stages are conditional**: Reverse Engineering, User Stories, Application Design, Units Generation, per-unit design stages (Functional Design, NFR Requirements, NFR Design, Infrastructure Design)
• **No fixed sequences**: Stages execute in the order that makes sense for your specific task

## Your Team's Role:
• **Answer questions** in dedicated question files using [Answer]: tags with letter choices (A, B, C, D, E)
• **Option E available**: Choose "Other" and describe your custom response if provided options don't match
• **Work as a team** to review and approve each phase before proceeding
• **Collectively decide** on architectural approach when needed
• **Important**: This is a team effort - involve relevant stakeholders for each phase

## AI-DLC Three-Phase Workflow:

\`\`\`mermaid
flowchart TD
    Start(["User Request"])
    
    subgraph INCEPTION["🔵 INCEPTION PHASE"]
        WD["Workspace Detection<br/><b>ALWAYS</b>"]
        RE["Reverse Engineering<br/><b>CONDITIONAL</b>"]
        RA["Requirements Analysis<br/><b>ALWAYS</b>"]
        Stories["User Stories<br/><b>CONDITIONAL</b>"]
        WP["Workflow Planning<br/><b>ALWAYS</b>"]
        AppDesign["Application Design<br/><b>CONDITIONAL</b>"]
        UnitsG["Units Generation<br/><b>CONDITIONAL</b>"]
    end
    
    subgraph CONSTRUCTION["🟢 CONSTRUCTION PHASE"]
        FD["Functional Design<br/><b>CONDITIONAL</b>"]
        NFRA["NFR Requirements<br/><b>CONDITIONAL</b>"]
        NFRD["NFR Design<br/><b>CONDITIONAL</b>"]
        ID["Infrastructure Design<br/><b>CONDITIONAL</b>"]
        CG["Code Generation<br/><b>ALWAYS</b>"]
        BT["Build and Test<br/><b>ALWAYS</b>"]
    end
    
    subgraph OPERATIONS["🟡 OPERATIONS PHASE"]
        OPS["Operations<br/><b>PLACEHOLDER</b>"]
    end
    
    Start --> WD
    WD -.-> RE
    WD --> RA
    RE --> RA
    
    RA -.-> Stories
    RA --> WP
    Stories --> WP
    
    WP -.-> AppDesign
    WP -.-> UnitsG
    AppDesign -.-> UnitsG
    UnitsG --> FD
    FD -.-> NFRA
    NFRA -.-> NFRD
    NFRD -.-> ID
    
    WP --> CG
    FD --> CG
    NFRA --> CG
    NFRD --> CG
    ID --> CG
    CG -.->|Next Unit| FD
    CG --> BT
    BT -.-> OPS
    BT --> End(["Complete"])
    
    style WD fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
    style RA fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
    style WP fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff

    style CG fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
    style BT fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
    style OPS fill:#BDBDBD,stroke:#424242,stroke-width:2px,stroke-dasharray: 5 5,color:#000
    style RE fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style Stories fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style AppDesign fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000

    style UnitsG fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style FD fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style NFRA fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style NFRD fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style ID fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000
    style INCEPTION fill:#BBDEFB,stroke:#1565C0,stroke-width:3px, color:#000
    style CONSTRUCTION fill:#C8E6C9,stroke:#2E7D32,stroke-width:3px, color:#000
    style OPERATIONS fill:#FFF59D,stroke:#F57F17,stroke-width:3px, color:#000
    style Start fill:#CE93D8,stroke:#6A1B9A,stroke-width:3px,color:#000
    style End fill:#CE93D8,stroke:#6A1B9A,stroke-width:3px,color:#000
    
    linkStyle default stroke:#333,stroke-width:2px
\`\`\`

**Stage Descriptions:**

**🔵 INCEPTION PHASE** - Planning and Architecture
- Workspace Detection: Analyze workspace state and project type (ALWAYS)
- Reverse Engineering: Analyze existing codebase (CONDITIONAL - Brownfield only)
- Requirements Analysis: Gather and validate requirements (ALWAYS - Adaptive depth)
- User Stories: Create user stories and personas (CONDITIONAL)
- Workflow Planning: Create execution plan (ALWAYS)
- Application Design: High-level component identification and service layer design (CONDITIONAL)
- Units Generation: Decompose into units of work (CONDITIONAL)

**🟢 CONSTRUCTION PHASE** - Design, Implementation, Build and Test
- Functional Design: Detailed business logic design per unit (CONDITIONAL, per-unit)
- NFR Requirements: Determine NFRs and select tech stack (CONDITIONAL, per-unit)
- NFR Design: Incorporate NFR patterns and logical components (CONDITIONAL, per-unit)
- Infrastructure Design: Map to actual infrastructure services (CONDITIONAL, per-unit)
- Code Generation: Generate code with Part 1 - Planning, Part 2 - Generation (ALWAYS, per-unit)
- Build and Test: Build all units and execute comprehensive testing (ALWAYS)

**🟡 OPERATIONS PHASE** - Placeholder
- Operations: Placeholder for future deployment and monitoring workflows (PLACEHOLDER)

**Key Principles:**
- Phases execute only when they add value
- Each phase independently evaluated
- INCEPTION focuses on "what" and "why"
- CONSTRUCTION focuses on "how" plus "build and test"
- OPERATIONS is placeholder for future expansion
- Simple changes may skip conditional INCEPTION stages
- Complex changes get full INCEPTION and CONSTRUCTION treatment

# ================================================================
# Rule: session-continuity
# Source:common/session-continuity.md
# ================================================================

# Session Continuity Templates

## Welcome Back Prompt Template
When a user returns to continue work on an existing AI-DLC project, present this prompt:

\`\`\`markdown
**Welcome back! I can see you have an existing AI-DLC project in progress.**

Based on your aidlc-state.md, here's your current status:
- **Project**: [project-name]
- **Current Phase**: [INCEPTION/CONSTRUCTION/OPERATIONS]
- **Current Stage**: [Stage Name]
- **Last Completed**: [Last completed step]
- **Next Step**: [Next step to work on]

**What would you like to work on today?**

A) Continue where you left off ([Next step description])
B) Review a previous stage ([Show available stages])

[Answer]: 
\`\`\`

## MANDATORY: Session Continuity Instructions
1. **Always read aidlc-state.md first** when detecting existing project
2. **Parse current status** from the workflow file to populate the prompt
3. **MANDATORY: Load Previous Stage Artifacts** - Before resuming any stage, automatically read all relevant artifacts from previous stages:
   - **Reverse Engineering**: Read architecture.md, code-structure.md, api-documentation.md
   - **Requirements Analysis**: Read requirements.md, requirement-verification-questions.md
   - **User Stories**: Read stories.md, personas.md, story-generation-plan.md
   - **Application Design**: Read application-design artifacts (components.md, component-methods.md, services.md)
   - **Design (Units)**: Read unit-of-work.md, unit-of-work-dependency.md, unit-of-work-story-map.md
   - **Per-Unit Design**: Read functional-design.md, nfr-requirements.md, nfr-design.md, infrastructure-design.md
   - **Code Stages**: Read all code files, plans, AND all previous artifacts
4. **Smart Context Loading by Stage**:
   - **Early Stages (Workspace Detection, Reverse Engineering)**: Load workspace analysis
   - **Requirements/Stories**: Load reverse engineering + requirements artifacts
   - **Design Stages**: Load requirements + stories + architecture + design artifacts
   - **Code Stages**: Load ALL artifacts + existing code files
5. **Adapt options** based on architectural choice and current phase
6. **Show specific next steps** rather than generic descriptions
7. **Log the continuity prompt** in audit.md with timestamp
8. **Context Summary**: After loading artifacts, provide brief summary of what was loaded for user awareness
9. **Asking questions**: ALWAYS ask clarification or user feedback questions by placing them in .md files. DO NOT place the multiple-choice questions in-line in the chat session.

## Error Handling
If artifacts are missing or corrupted during session resumption, see [error-handling.md](error-handling.md) for guidance on recovery procedures. 

# ================================================================
# Rule: content-validation
# Source:common/content-validation.md
# ================================================================

# Content Validation Rules

## MANDATORY: Content Validation Before File Creation

**CRITICAL**: All generated content MUST be validated before writing to files to prevent parsing errors.

## ASCII Diagram Standards

**CRITICAL**: Before creating ANY file with ASCII diagrams:

1. **LOAD** \`common/ascii-diagram-standards.md\`
2. **VALIDATE** each diagram:
   - Count characters per line (all lines MUST be same width)
   - Use ONLY: \`+\` \`-\` \`|\` \`^\` \`v\` \`<\` \`>\` and spaces
   - NO Unicode box-drawing characters
   - Spaces only (NO tabs)
3. **TEST** alignment by verifying box corners align vertically

**See \`common/ascii-diagram-standards.md\` for patterns and validation checklist.**

## Mermaid Diagram Validation

### Required Validation Steps
1. **Syntax Check**: Validate Mermaid syntax before file creation
2. **Character Escaping**: Ensure special characters are properly escaped
3. **Fallback Content**: Provide text alternative if Mermaid fails validation

### Mermaid Validation Rules
\`\`\`markdown
## BEFORE creating any file with Mermaid diagrams:

1. Check for invalid characters in node IDs (use alphanumeric + underscore only)
2. Escape special characters in labels: " → \\" and ' → \\'
3. Validate flowchart syntax: node connections must be valid
4. Test diagram parsing with simple validation

## FALLBACK: If Mermaid validation fails, use text-based workflow representation
\`\`\`

### Implementation Pattern
\`\`\`markdown
## Workflow Visualization

### Mermaid Diagram (if syntax valid)
\`\`\`mermaid
[validated diagram content]
\`\`\`

### Text Alternative (always include)
\`\`\`
Phase 1: INCEPTION
- Stage 1: Workspace Detection (COMPLETED)
- Stage 2: Requirements Analysis (COMPLETED)
[continue with text representation]
\`\`\`

## General Content Validation

### Pre-Creation Validation Checklist
- [ ] Validate embedded code blocks (Mermaid, JSON, YAML)
- [ ] Check special character escaping
- [ ] Verify markdown syntax correctness
- [ ] Test content parsing compatibility
- [ ] Include fallback content for complex elements

### Error Prevention Rules
1. **Always validate before using tools/commands to write files**: Never write unvalidated content
2. **Escape special characters**: Particularly in diagrams and code blocks
3. **Provide alternatives**: Include text versions of visual content
4. **Test syntax**: Validate complex content structures

## Validation Failure Handling

### When Validation Fails
1. **Log the error**: Record what failed validation
2. **Use fallback content**: Switch to text-based alternative
3. **Continue workflow**: Don't block on content validation failures
4. **Inform user**: Mention simplified content was used due to parsing constraints


# ================================================================
# Rule: question-format-guide
# Source:common/question-format-guide.md
# ================================================================

# Question Format Guide

## MANDATORY: All Questions Must Use This Format

### Rule: Never Ask Questions in Chat
**CRITICAL**: You must NEVER ask questions directly in the chat. ALL questions must be placed in dedicated question files.

### Question File Format

#### File Naming Convention
- Use descriptive names: \`{phase-name}-questions.md\`
- Examples:
  - \`classification-questions.md\`
  - \`requirements-questions.md\`
  - \`story-planning-questions.md\`
  - \`design-questions.md\`

#### Question Structure
Every question must include meaningful options plus "Other" as the last option:

\`\`\`markdown
## Question [Number]
[Clear, specific question text]

A) [First meaningful option]
B) [Second meaningful option]
[...additional options as needed...]
X) Other (please describe after [Answer]: tag below)

[Answer]: 
\`\`\`

**CRITICAL**: 
- "Other" is MANDATORY as the LAST option for every question
- Only include meaningful options - don't make up options to fill slots
- Use as many or as few options as make sense (minimum 2 + Other)

### Complete Example

\`\`\`markdown
# Requirements Clarification Questions

Please answer the following questions to help clarify the requirements.

## Question 1
What is the primary user authentication method?

A) Username and password
B) Social media login (Google, Facebook)
C) Single Sign-On (SSO)
D) Multi-factor authentication
E) Other (please describe after [Answer]: tag below)

[Answer]: 

## Question 2
Will this be a web or mobile application?

A) Web application
B) Mobile application
C) Both web and mobile
D) Other (please describe after [Answer]: tag below)

[Answer]: 

## Question 3
Is this a new project or existing codebase?

A) New project (greenfield)
B) Existing codebase (brownfield)
C) Other (please describe after [Answer]: tag below)

[Answer]: 
\`\`\`

### User Response Format
Users will answer by filling in the letter choice after [Answer]: tag:

\`\`\`markdown
## Question 1
What is the primary user authentication method?

A) Username and password
B) Social media login (Google, Facebook)
C) Single Sign-On (SSO)
D) Multi-factor authentication

[Answer]: C
\`\`\`

### Reading User Responses
After user confirms completion:
1. Read the question file
2. Extract answers after [Answer]: tags
3. Validate all questions are answered
4. Proceed with analysis based on responses

### Multiple Choice Guidelines

#### Option Count
- Minimum: 2 meaningful options + "Other" (A, B, C)
- Typical: 3-4 meaningful options + "Other" (A, B, C, D, E)
- Maximum: 5 meaningful options + "Other" (A, B, C, D, E, F)
- **CRITICAL**: Don't make up options just to fill slots - only include meaningful choices

#### Option Quality
- Make options mutually exclusive
- Cover the most common scenarios
- Only include meaningful, realistic options
- **ALWAYS include "Other" as the LAST option** (MANDATORY)
- Be specific and clear
- **Don't make up options to fill A, B, C, D slots**

#### Good Example:
\`\`\`markdown
## Question 5
What database technology will be used?

A) Relational (PostgreSQL, MySQL)
B) NoSQL Document (MongoDB, DynamoDB)
C) NoSQL Key-Value (Redis, Memcached)
D) Graph Database (Neo4j, Neptune)
E) Other (please describe after [Answer]: tag below)

[Answer]: 
\`\`\`

#### Bad Example (Avoid):
\`\`\`markdown
## Question 5
What database will you use?

A) Yes
B) No
C) Maybe

[Answer]: 
\`\`\`

### Workflow Integration

#### Step 1: Create Question File
\`\`\`markdown
Create aidlc-docs/{phase-name}-questions.md with all questions
\`\`\`

#### Step 2: Inform User
\`\`\`
"I've created {phase-name}-questions.md with [X] questions. 
Please answer each question by filling in the letter choice after the [Answer]: tag. 
If none of the options match your needs, choose the last option (Other) and describe your preference. Let me know when you're done."
\`\`\`

#### Step 3: Wait for Confirmation
Wait for user to say "done", "completed", "finished", or similar.

#### Step 4: Read and Analyze
\`\`\`
Read aidlc-docs/{phase-name}-questions.md
Extract all answers
Validate completeness
Proceed with analysis
\`\`\`

### Error Handling

#### Missing Answers
If any [Answer]: tag is empty:
\`\`\`
"I noticed Question [X] is not answered. Please provide an answer using one of the letter choices 
for all questions before proceeding."
\`\`\`

#### Invalid Answers
If answer is not a valid letter choice:
\`\`\`
"Question [X] has an invalid answer '[answer]'. 
Please use only the letter choices provided in the question."
\`\`\`

#### Ambiguous Answers
If user provides explanation instead of letter:
\`\`\`
"For Question [X], please provide the letter choice that best matches your answer. 
If none match, choose 'Other' and add your description after the [Answer]: tag."
\`\`\`

### Contradiction and Ambiguity Detection

**MANDATORY**: After reading user responses, you MUST check for contradictions and ambiguities.

#### Detecting Contradictions
Look for logically inconsistent answers:
- Scope mismatch: "Bug fix" but "Entire codebase affected"
- Risk mismatch: "Low risk" but "Breaking changes"
- Timeline mismatch: "Quick fix" but "Multiple subsystems"
- Impact mismatch: "Single component" but "Significant architecture changes"

#### Detecting Ambiguities
Look for unclear or borderline responses:
- Answers that could fit multiple classifications
- Responses that lack specificity
- Conflicting indicators across multiple questions

#### Creating Clarification Questions
If contradictions or ambiguities detected:

1. **Create clarification file**: \`{phase-name}-clarification-questions.md\`
2. **Explain the issue**: Clearly state what contradiction/ambiguity was detected
3. **Ask targeted questions**: Use multiple choice format to resolve the issue
4. **Reference original questions**: Show which questions had conflicting answers

**Example**:
\`\`\`markdown
# [Phase Name] Clarification Questions

I detected contradictions in your responses that need clarification:

## Contradiction 1: [Brief Description]
You indicated "[Answer A]" (Q[X]:[Letter]) but also "[Answer B]" (Q[Y]:[Letter]).
These responses are contradictory because [explanation].

### Clarification Question 1
[Specific question to resolve contradiction]

A) [Option that resolves toward first answer]
B) [Option that resolves toward second answer]
C) [Option that provides middle ground]
D) [Option that reframes the question]

[Answer]: 

## Ambiguity 1: [Brief Description]
Your response to Q[X] ("[Answer]") is ambiguous because [explanation].

### Clarification Question 2
[Specific question to clarify ambiguity]

A) [Clear option 1]
B) [Clear option 2]
C) [Clear option 3]
D) [Clear option 4]

[Answer]: 
\`\`\`

#### Workflow for Clarifications

1. **Detect**: Analyze all responses for contradictions/ambiguities
2. **Create**: Generate clarification question file if issues found
3. **Inform**: Tell user about the issues and clarification file
4. **Wait**: Do not proceed until user provides clarifications
5. **Re-validate**: After clarifications, check again for consistency
6. **Proceed**: Only move forward when all contradictions are resolved

#### Example User Message
\`\`\`
"I detected 2 contradictions in your responses:

1. Bug fix scope vs. codebase impact (Q1 vs Q2)
2. Low risk vs. breaking changes (Q7 vs Q4)

I've created classification-clarification-questions.md with 2 questions to resolve these.
Please answer these clarifying questions before I can proceed with classification."
\`\`\`

### Best Practices

1. **Be Specific**: Questions should be clear and unambiguous
2. **Be Comprehensive**: Cover all necessary information
3. **Be Concise**: Keep questions focused on one topic
4. **Be Practical**: Options should be realistic and actionable
5. **Be Consistent**: Use same format throughout all question files

### Phase-Specific Examples

#### Example with 2 meaningful options:
\`\`\`markdown
## Question 1
Is this a new project or existing codebase?

A) New project (greenfield)
B) Existing codebase (brownfield)
C) Other (please describe after [Answer]: tag below)

[Answer]: 
\`\`\`

#### Example with 3 meaningful options:
\`\`\`markdown
## Question 2
What is the deployment target?

A) Cloud (AWS, Azure, GCP)
B) On-premises servers
C) Hybrid (both cloud and on-premises)
D) Other (please describe after [Answer]: tag below)

[Answer]: 
\`\`\`

#### Example with 4 meaningful options:
\`\`\`markdown
## Question 3
What architectural pattern should be used?

A) Monolithic architecture
B) Microservices architecture
C) Serverless architecture
D) Event-driven architecture
E) Other (please describe after [Answer]: tag below)

[Answer]: 
\`\`\`

## Summary

**Remember**: 
- ✅ Always create question files
- ✅ Always use multiple choice format
- ✅ **Always include "Other" as the LAST option (MANDATORY)**
- ✅ Only include meaningful options - don't make up options to fill slots
- ✅ Always use [Answer]: tags
- ✅ Always wait for user completion
- ✅ Always validate responses for contradictions
- ✅ Always create clarification files if needed
- ✅ Always resolve contradictions before proceeding
- ❌ Never ask questions in chat
- ❌ Never make up options just to have A, B, C, D
- ❌ Never proceed without answers
- ❌ Never proceed with unresolved contradictions
- ❌ Never make assumptions about ambiguous responses


# ================================================================
# Rule: error-handling
# Source:common/error-handling.md
# ================================================================

# Error Handling and Recovery Procedures

## General Error Handling Principles

### When Errors Occur
1. **Identify the error**: Clearly state what went wrong
2. **Assess impact**: Determine if the error is blocking or can be worked around
3. **Communicate**: Inform the user about the error and options
4. **Offer solutions**: Provide clear steps to resolve or work around the error
5. **Document**: Log the error and resolution in \`audit.md\`

### Error Severity Levels

**Critical**: Workflow cannot continue
- Missing required files or artifacts
- Invalid user input that cannot be processed
- System errors preventing file operations

**High**: Phase cannot complete as planned
- Incomplete answers to required questions
- Contradictory user responses
- Missing dependencies from prior phases

**Medium**: Phase can continue with workarounds
- Optional artifacts missing
- Non-critical validation failures
- Partial completion possible

**Low**: Minor issues that don't block progress
- Formatting inconsistencies
- Optional information missing
- Non-blocking warnings

## Phase-Specific Error Handling

### Context Assessment Errors

**Error**: Cannot read workspace files
- **Cause**: Permission issues, missing directories
- **Solution**: Ask user to verify workspace path and permissions
- **Workaround**: Proceed with user-provided information only

**Error**: Existing \`aidlc-state.md\` is corrupted
- **Cause**: Manual editing, incomplete previous run
- **Solution**: Ask user if they want to start fresh or attempt recovery
- **Recovery**: Create backup, start new state file

**Error**: Cannot determine required phases
- **Cause**: Insufficient information from user
- **Solution**: Ask clarifying questions about intent and scope
- **Workaround**: Default to comprehensive execution plan

### Requirements Assessment Errors

**Error**: User provides contradictory requirements
- **Cause**: Unclear understanding, changing needs
- **Solution**: Create follow-up questions to resolve contradictions
- **Do Not Proceed**: Until contradictions are resolved

**Error**: Requirements document cannot be converted
- **Cause**: Unsupported format, corrupted file
- **Solution**: Ask user to provide requirements in supported format
- **Workaround**: Work with user's verbal description

**Error**: Incomplete answers to verification questions
- **Cause**: User skipped questions, unclear what to answer
- **Solution**: Highlight unanswered questions, provide examples
- **Do Not Proceed**: Until all required questions are answered

### Story Development Errors

**Error**: Cannot map requirements to stories
- **Cause**: Requirements too vague, missing functional details
- **Solution**: Return to Requirements Assessment for clarification
- **Workaround**: Create stories based on available information, mark as incomplete

**Error**: User provides ambiguous story planning answers
- **Cause**: Unclear options, complex decision
- **Solution**: Add follow-up questions with specific examples
- **Do Not Proceed**: Until ambiguities are resolved

**Error**: Story generation plan has uncompleted steps
- **Cause**: Execution interrupted, steps skipped
- **Solution**: Resume from first uncompleted step
- **Recovery**: Review completed steps, continue from checkpoint

### Application Design Errors

**Error**: Architectural decision is unclear or contradictory
- **Cause**: Ambiguous answers, conflicting requirements
- **Solution**: Add follow-up questions to clarify decision
- **Do Not Proceed**: Until decision is clear and documented

**Error**: Cannot determine number of services/units
- **Cause**: Insufficient information about boundaries
- **Solution**: Ask specific questions about deployment, team structure, scaling
- **Workaround**: Default to monolith, allow change later

### Design Errors

**Error**: Unit dependencies are circular
- **Cause**: Poor boundary definition, tight coupling
- **Solution**: Identify circular dependencies, suggest refactoring
- **Recovery**: Revise unit boundaries to break cycles

**Error**: Unit design plan has missing steps
- **Cause**: Plan generation incomplete, template error
- **Solution**: Regenerate plan with all required steps
- **Recovery**: Add missing steps to existing plan

**Error**: Cannot generate design artifacts
- **Cause**: Missing unit information, unclear requirements
- **Solution**: Return to Units Planning to clarify unit definition
- **Workaround**: Generate partial design, mark gaps

### NFR Implementation Errors

**Error**: Technology stack choices are incompatible
- **Cause**: Conflicting requirements, platform limitations
- **Solution**: Highlight incompatibilities, ask user to choose
- **Do Not Proceed**: Until compatible choices are made

**Error**: Organizational constraints cannot be met
- **Cause**: Network restrictions, security policies
- **Solution**: Document constraints, ask user for workarounds
- **Escalation**: May require human intervention for setup

**Error**: NFR implementation step requires human action
- **Cause**: AI cannot perform certain tasks (network config, credentials)
- **Solution**: Clearly mark as **HUMAN TASK**, provide instructions
- **Wait**: For user confirmation before proceeding

### Code Planning Errors

**Error**: Code generation plan is incomplete
- **Cause**: Missing design artifacts, unclear requirements
- **Solution**: Return to Design phase to complete artifacts
- **Recovery**: Generate plan with available information, mark gaps

**Error**: Unit dependencies not satisfied
- **Cause**: Dependent units not yet generated
- **Solution**: Reorder generation sequence to respect dependencies
- **Workaround**: Generate with stub dependencies, integrate later

### Code Generation Errors

**Error**: Cannot generate code for a step
- **Cause**: Insufficient design information, unclear requirements
- **Solution**: Skip step, document as incomplete, continue
- **Recovery**: Return to step after gathering more information

**Error**: Generated code has syntax errors
- **Cause**: Template issues, language-specific problems
- **Solution**: Fix syntax errors, regenerate if needed
- **Validation**: Verify code compiles before proceeding

**Error**: Test generation fails
- **Cause**: Complex logic, missing test framework setup
- **Solution**: Generate basic test structure, mark for manual completion
- **Workaround**: Proceed without tests, add in Operations phase

### Operations Errors

**Error**: Cannot determine build tool
- **Cause**: Unusual project structure, multiple build systems
- **Solution**: Ask user to specify build tool and commands
- **Workaround**: Provide generic instructions, user adapts

**Error**: Deployment target is unclear
- **Cause**: Multiple environments, complex infrastructure
- **Solution**: Ask user to specify deployment targets and methods
- **Workaround**: Provide instructions for common platforms

## Recovery Procedures

### Partial Phase Completion

**Scenario**: Phase was interrupted mid-execution

**Recovery Steps**:
1. Load the phase plan file
2. Identify last completed step (last [x] checkbox)
3. Resume from next uncompleted step
4. Verify all prior steps are actually complete
5. Continue execution normally

### Corrupted State File

**Scenario**: \`aidlc-state.md\` is corrupted or inconsistent

**Recovery Steps**:
1. Create backup: \`aidlc-state.md.backup\`
2. Ask user which phase they're actually on
3. Regenerate state file from scratch
4. Mark completed phases based on existing artifacts
5. Resume from current phase

### Missing Artifacts

**Scenario**: Required artifacts from prior phase are missing

**Recovery Steps**:
1. Identify which artifacts are missing
2. Determine if they can be regenerated
3. If yes: Return to that phase, regenerate artifacts
4. If no: Ask user to provide information manually
5. Document the gap in \`audit.md\`

### User Wants to Restart Phase

**Scenario**: User is unhappy with phase results and wants to redo

**Recovery Steps**:
1. Confirm user wants to restart (data will be lost)
2. Archive existing artifacts: \`{artifact}.backup\`
3. Reset phase status in \`aidlc-state.md\`
4. Clear phase checkboxes in plan files
5. Re-execute phase from beginning

### User Wants to Skip Phase

**Scenario**: User wants to skip a phase that was planned

**Recovery Steps**:
1. Confirm user understands implications
2. Document skip reason in \`audit.md\`
3. Mark phase as "SKIPPED" in \`aidlc-state.md\`
4. Proceed to next phase
5. Note: May cause issues in later phases if dependencies missing

## Escalation Guidelines

### When to Ask for User Help

**Immediately**:
- Contradictory or ambiguous user input
- Missing required information
- Technical constraints AI cannot resolve
- Decisions requiring business judgment

**After Attempting Resolution**:
- Repeated errors in same step
- Complex technical issues
- Unusual project structures
- Integration with external systems

### When to Suggest Starting Over

**Consider Fresh Start If**:
- Multiple phases have errors
- State file is severely corrupted
- User cannot provide missing information
- Artifacts are inconsistent across phases

## Session Resumption Errors

### Missing Artifacts During Resumption

**Error**: Required artifacts from previous stages are missing
- **Cause**: Files deleted, moved, or never created
- **Solution**: 
  1. Identify which stage created the missing artifacts
  2. Check if stage was marked complete in aidlc-state.md
  3. If marked complete but artifacts missing: Regenerate that stage
  4. If not marked complete: Resume from that stage
- **Recovery**: Return to the stage that creates missing artifacts and re-execute

**Error**: Artifact file exists but is empty or corrupted
- **Cause**: Interrupted write, manual editing, file system issues
- **Solution**:
  1. Create backup of corrupted file
  2. Attempt to regenerate from stage that creates it
  3. If cannot regenerate: Ask user for information to recreate
- **Recovery**: Re-execute the stage that creates the artifact

### Inconsistent State During Resumption

**Error**: aidlc-state.md shows stage complete but artifacts don't exist
- **Cause**: State file updated but artifact generation failed
- **Solution**:
  1. Mark stage as incomplete in aidlc-state.md
  2. Re-execute the stage to generate artifacts
  3. Verify artifacts exist before marking complete
- **Recovery**: Reset stage status and re-execute

**Error**: Artifacts exist but aidlc-state.md shows stage incomplete
- **Cause**: Artifact generation succeeded but state update failed
- **Solution**:
  1. Verify artifacts are complete and valid
  2. Update aidlc-state.md to mark stage complete
  3. Proceed to next stage
- **Recovery**: Update state file to reflect actual completion

**Error**: Multiple stages marked as "current" in aidlc-state.md
- **Cause**: State file corruption, manual editing
- **Solution**:
  1. Review artifacts to determine actual progress
  2. Ask user which stage they're actually on
  3. Correct aidlc-state.md to show single current stage
- **Recovery**: Rebuild state file based on existing artifacts

### Context Loading Errors

**Error**: Cannot load required context from previous stages
- **Cause**: Missing files, corrupted content, wrong file paths
- **Solution**:
  1. List which artifacts are needed for current stage
  2. Check which ones are missing or corrupted
  3. Regenerate missing artifacts or ask user for information
- **Recovery**: Complete prerequisite stages before resuming current stage

**Error**: Loaded artifacts contain contradictory information
- **Cause**: Manual editing, multiple people working, incomplete updates
- **Solution**:
  1. Identify contradictions and present to user
  2. Ask user which information is correct
  3. Update artifacts to resolve contradictions
- **Recovery**: Reconcile contradictions before proceeding

### Resumption Best Practices

1. **Always validate state**: Check aidlc-state.md matches actual artifacts
2. **Load incrementally**: Load artifacts stage-by-stage, validate each
3. **Fail fast**: Stop immediately if critical artifacts are missing
4. **Communicate clearly**: Tell user exactly what's missing and why it's needed
5. **Offer options**: Regenerate, provide manually, or start fresh
6. **Document recovery**: Log all recovery actions in audit.md State file is severely corrupted
- User requirements have changed significantly
- Architectural decision needs to be reversed

**Before Starting Over**:
1. Archive all existing work
2. Document lessons learned
3. Identify what to preserve
4. Get user confirmation
5. Create new execution plan

## Logging Requirements

### Error Logging Format

\`\`\`markdown
## Error - [Phase Name]
**Timestamp**: [ISO timestamp]
**Error Type**: [Critical/High/Medium/Low]
**Description**: [What went wrong]
**Cause**: [Why it happened]
**Resolution**: [How it was resolved]
**Impact**: [Effect on workflow]

---
\`\`\`

### Recovery Logging Format

\`\`\`markdown
## Recovery - [Phase Name]
**Timestamp**: [ISO timestamp]
**Issue**: [What needed recovery]
**Recovery Steps**: [What was done]
**Outcome**: [Result of recovery]
**Artifacts Affected**: [List of files]

---
\`\`\`

## Prevention Best Practices

1. **Validate Early**: Check inputs and dependencies before starting work
2. **Checkpoint Often**: Update checkboxes immediately after completing steps
3. **Communicate Clearly**: Explain what you're doing and why
4. **Ask Questions**: Don't assume - clarify ambiguities immediately
5. **Document Everything**: Log all decisions and changes in \`audit.md\`


# ================================================================
# Rule: depth-levels
# Source:common/depth-levels.md
# ================================================================

# Adaptive Depth

**Purpose**: Explain how AI-DLC adapts detail level to problem complexity

## Core Principle

**When a stage executes, ALL its defined artifacts are created. The "depth" refers to the level of detail and rigor within those artifacts, which adapts to the problem's complexity.**

## Stage Selection vs Detail Level

### Stage Selection (Binary)
- **Workflow Planning** decides: EXECUTE or SKIP for each stage
- **If EXECUTE**: Stage runs and creates ALL its defined artifacts
- **If SKIP**: Stage doesn't run at all

### Detail Level (Adaptive)
- **Simple problems**: Concise artifacts with essential detail
- **Complex problems**: Comprehensive artifacts with extensive detail
- **Model decides**: Based on problem characteristics, not prescriptive rules

## Factors Influencing Detail Level

The model considers these factors when determining appropriate detail:

1. **Request Clarity**: How clear and complete is the user's request?
2. **Problem Complexity**: How intricate is the solution space?
3. **Scope**: Single file, component, multiple components, or system-wide?
4. **Risk Level**: What's the impact of errors or omissions?
5. **Available Context**: Greenfield vs brownfield, existing documentation
6. **User Preferences**: Has user expressed preference for brevity or detail?

## Example: Requirements Analysis Artifacts

**All scenarios create the same artifacts**:
- \`requirement-verification-questions.md\` (if needed)
- \`requirements.md\`

**Note**: User's initial request is captured in \`audit.md\` (no separate user-intent.md needed)

**Detail level varies by complexity**:

### Simple Scenario (Bug Fix)
- **requirement-verification-questions.md**: necessary clarifying questions
- **requirements.md**: Concise functional requirement, minimal sections

### Complex Scenario (System Migration)
- **requirement-verification-questions.md**: Multiple rounds, 10+ questions
- **requirements.md**: Comprehensive functional + non-functional requirements, traceability, acceptance criteria

## Example: Application Design Artifacts

**All scenarios create the same artifacts**:
- \`application-design.md\`
- \`component-diagram.md\`

**Detail level varies by complexity**:

### Simple Scenario (Single Component)
- **application-design.md**: Basic component description, key methods
- **component-diagram.md**: Simple diagram with essential relationships

### Complex Scenario (Multi-Component System)
- **application-design.md**: Detailed component responsibilities, all methods with signatures, design patterns, alternatives considered
- **component-diagram.md**: Comprehensive diagram with all relationships, data flows, integration points

## Guiding Principle for Model

**"Create exactly the detail needed for the problem at hand - no more, no less."**

- Don't artificially inflate simple problems with unnecessary detail
- Don't shortchange complex problems by omitting critical detail
- Let problem characteristics drive detail level naturally
- All required artifacts are always created when stage executes


# ================================================================
# Rule: overconfidence-prevention
# Source:common/overconfidence-prevention.md
# ================================================================

# Overconfidence Prevention Guide

## Problem Statement

AI-DLC was exhibiting overconfidence by not asking enough clarifying questions, even for complex project intent statements. This led to assumptions being made instead of gathering proper requirements.

## Root Cause Analysis

The overconfidence issue was caused by directives in multiple stages that encouraged skipping questions:

1. **Functional Design**: "Skip entire categories if not applicable"
2. **User Stories**: "Use categories as inspiration, NOT as mandatory checklist"
3. **Requirements Analysis**: Similar patterns encouraging minimal questioning
4. **NFR Requirements**: "Only if" conditions that discouraged thorough analysis

These directives were telling the AI to avoid asking questions rather than encouraging comprehensive requirements gathering.

## Solution Implemented

### Updated Question Generation Philosophy

**OLD APPROACH**: "Only ask questions if absolutely necessary"
**NEW APPROACH**: "When in doubt, ask the question - overconfidence leads to poor outcomes"

### Key Changes Made

#### 1. Requirements Analysis Stage
- Changed from "only if needed" to "ALWAYS create questions unless exceptionally clear"
- Added comprehensive evaluation areas (functional, non-functional, business context, technical context)
- Emphasized proactive questioning approach

#### 2. User Stories Stage
- Removed "skip entire categories" directive
- Added comprehensive question categories to evaluate
- Enhanced answer analysis requirements
- Strengthened follow-up question mandates

#### 3. Functional Design Stage
- Replaced "only if" conditions with comprehensive evaluation
- Added more question categories (data flow, integration points, error handling)
- Strengthened ambiguity detection and resolution requirements

#### 4. NFR Requirements Stage
- Expanded question categories beyond basic NFRs
- Added reliability, maintainability, and usability considerations
- Enhanced answer analysis for technical ambiguities

### New Guiding Principles

1. **Default to Asking**: When there's any ambiguity, ask clarifying questions
2. **Comprehensive Coverage**: Evaluate ALL relevant categories, don't skip areas
3. **Thorough Analysis**: Carefully analyze ALL user responses for ambiguities
4. **Mandatory Follow-up**: Create follow-up questions for ANY unclear responses
5. **No Proceeding with Ambiguity**: Don't move forward until ALL ambiguities are resolved

## Implementation Guidelines

### For Question Generation
- Evaluate ALL question categories, don't skip any
- Ask questions wherever clarification would improve quality
- Include comprehensive question categories in each stage
- Default to inclusion rather than exclusion of questions

### For Answer Analysis
- Look for vague responses: "depends", "maybe", "not sure", "mix of", "somewhere between"
- Detect undefined terms and references to external concepts
- Identify contradictory or incomplete answers
- Create follow-up questions for ANY ambiguities

### For Follow-up Questions
- Create separate clarification files when ambiguities are detected
- Ask specific questions to resolve each ambiguity
- Don't proceed until ALL unclear responses are clarified
- Be thorough - better to over-clarify than under-clarify

## Quality Assurance

### Red Flags to Watch For
- Stages completing without asking any questions on complex projects
- Proceeding with vague or ambiguous user responses
- Skipping entire question categories without justification
- Making assumptions instead of asking for clarification

### Success Indicators
- Appropriate number of clarifying questions for project complexity
- Thorough analysis of user responses with follow-up when needed
- Clear, unambiguous requirements before proceeding to implementation
- Reduced need for changes during later stages due to better upfront clarification

## Maintenance

This guide should be referenced when:
- Adding new stages to AI-DLC
- Updating existing stage instructions
- Reviewing AI-DLC performance for overconfidence issues
- Training team members on AI-DLC question generation principles

## Key Takeaway

**It's better to ask too many questions than to make incorrect assumptions.** The cost of asking clarifying questions upfront is far less than the cost of implementing the wrong solution based on assumptions.

# ================================================================
# Rule: welcome-message
# Source:common/welcome-message.md
# ================================================================

# AI-DLC Welcome Message

**Purpose**: This file contains the user-facing welcome message that should be displayed ONCE at the start of any AI-DLC workflow.

---

# 👋 Welcome to AI-DLC (AI-Driven Development Life Cycle)! 👋

I'll guide you through an adaptive software development workflow that intelligently tailors itself to your specific needs.

## What is AI-DLC?

AI-DLC is a structured yet flexible software development process that adapts to your project's needs. Think of it as having an experienced software architect who:

- **Analyzes your requirements** and asks clarifying questions when needed
- **Plans the optimal approach** based on complexity and risk
- **Skips unnecessary steps** for simple changes while providing comprehensive coverage for complex projects
- **Documents everything** so you have a complete record of decisions and rationale
- **Guides you through each phase** with clear checkpoints and approval gates

## The Three-Phase Lifecycle

\`\`\`
                         User Request
                              |
                              v
        ╔═══════════════════════════════════════╗
        ║     INCEPTION PHASE                   ║
        ║     Planning & Application Design     ║
        ╠═══════════════════════════════════════╣
        ║ • Workspace Detection (ALWAYS)        ║
        ║ • Reverse Engineering (COND)          ║
        ║ • Requirements Analysis (ALWAYS)      ║
        ║ • User Stories (CONDITIONAL)          ║
        ║ • Workflow Planning (ALWAYS)          ║
        ║ • Application Design (CONDITIONAL)    ║
        ║ • Units Generation (CONDITIONAL)      ║
        ╚═══════════════════════════════════════╝
                              |
                              v
        ╔═══════════════════════════════════════╗
        ║     CONSTRUCTION PHASE                ║
        ║     Design, Implementation & Test     ║
        ╠═══════════════════════════════════════╣
        ║ • Per-Unit Loop (for each unit):      ║
        ║   - Functional Design (COND)          ║
        ║   - NFR Requirements Assess (COND)    ║
        ║   - NFR Design (COND)                 ║
        ║   - Infrastructure Design (COND)      ║
        ║   - Code Generation (ALWAYS)          ║
        ║ • Build and Test (ALWAYS)             ║
        ╚═══════════════════════════════════════╝
                              |
                              v
        ╔═══════════════════════════════════════╗
        ║     OPERATIONS PHASE                  ║
        ║     Placeholder for Future            ║
        ╠═══════════════════════════════════════╣
        ║ • Operations (PLACEHOLDER)            ║
        ╚═══════════════════════════════════════╝
                              |
                              v
                          Complete
\`\`\`

### Phase Breakdown:

**INCEPTION PHASE** - *Planning & Application Design*
- **Purpose**: Determines WHAT to build and WHY
- **Activities**: Understanding requirements, analyzing existing code (if any), planning the approach
- **Output**: Clear requirements, execution plan, decisions on the number of units of work for parallel development
- **Your Role**: Answer questions, review plans, approve direction

**CONSTRUCTION PHASE** - *Detailed Design, Implementation & Test*
- **Purpose**: Determines HOW to build it
- **Activities**: Detailed design (when needed), code generation, comprehensive testing
- **Output**: Working code, tests, build instructions
- **Your Role**: Review designs, approve implementation plans, validate results

**OPERATIONS PHASE** - *Deployment & Monitoring (Future)*
- **Purpose**: How to DEPLOY and RUN it
- **Status**: Placeholder for future deployment and monitoring workflows
- **Current State**: Build and test activities handled in CONSTRUCTION phase

## Key Principles:

- ⚡ **Fully Adaptive**: Each stage independently evaluated based on your needs
- 🎯 **Efficient**: Simple changes execute only essential stages
- 📋 **Comprehensive**: Complex changes get full treatment with all safeguards
- 🔍 **Transparent**: You see and approve the execution plan before work begins
- 📝 **Documented**: Complete audit trail of all decisions and changes
- 🎛️ **User Control**: You can request stages be included or excluded

## What Happens Next:

1. **I'll analyze your workspace** to understand if this is a new or existing project
2. **I'll gather requirements** and ask clarifying questions if needed
3. **I'll create an execution plan** showing which stages I propose to run and why
4. **You'll review and approve** the plan (or request changes)
5. **We'll execute the plan** with checkpoints at each major stage
6. **You'll get working code** with complete documentation and tests

The AI-DLC process adapts to:
- 📋 Your intent clarity and complexity
- 🔍 Existing codebase state
- 🎯 Scope and impact of changes
- ⚡ Risk and quality requirements

Let's begin!


# ================================================================
# Rule: terminology
# Source:common/terminology.md
# ================================================================

# AI-DLC Terminology Glossary

## Core Terminology

### Phase vs Stage

**Phase**: One of the three high-level lifecycle phases in AI-DLC
- 🔵 **INCEPTION PHASE** - Planning & Architecture (WHAT and WHY)
- 🟢 **CONSTRUCTION PHASE** - Design, Implementation & Test (HOW)
- 🟡 **OPERATIONS PHASE** - Deployment & Monitoring (future expansion)

**Stage**: An individual workflow activity within a phase
- Examples: Context Assessment stage, Requirements Assessment stage, Code Planning stage
- Each stage has specific prerequisites, steps, and outputs
- Stages can be ALWAYS-EXECUTE or CONDITIONAL

**Usage Examples**:
- ✅ "The CONSTRUCTION phase contains 7 stages"
- ✅ "The Code Planning stage is always executed"
- ✅ "We're in the INCEPTION phase, executing the Requirements Assessment stage"
- ❌ "The Requirements Assessment phase" (should be "stage")
- ❌ "The CONSTRUCTION stage" (should be "phase")

## Three-Phase Lifecycle

### INCEPTION PHASE
**Purpose**: Planning and architectural decisions  
**Focus**: Determine WHAT to build and WHY  
**Location**: \`inception/\` directory

**Stages**:
- Workspace Detection (ALWAYS)
- Reverse Engineering (CONDITIONAL - Brownfield only)
- Requirements Analysis (ALWAYS - Adaptive depth)
- User Stories (CONDITIONAL)
- Workflow Planning (ALWAYS)
- Application Design (CONDITIONAL)
- Design - Units Planning/Generation (CONDITIONAL)

**Outputs**: Requirements, user stories, architectural decisions, unit definitions

### CONSTRUCTION PHASE
**Purpose**: Detailed design and implementation  
**Focus**: Determine HOW to build it  
**Location**: \`construction/\` directory

**Stages**:
- Functional Design (CONDITIONAL, per-unit)
- NFR Requirements (CONDITIONAL, per-unit)
- NFR Design (CONDITIONAL, per-unit)
- Infrastructure Design (CONDITIONAL, per-unit)
- Code Planning (ALWAYS)
- Code Generation (ALWAYS)
- Build and Test (ALWAYS)

**Outputs**: Design artifacts, NFR implementations, code, tests

### OPERATIONS PHASE
**Purpose**: Deployment and operational readiness  
**Focus**: How to DEPLOY and RUN it  
**Location**: \`operations/\` directory

**Stages**:
- Operations (PLACEHOLDER)

**Outputs**: Build instructions, deployment guides, monitoring setup, verification procedures

---

## Workflow Stages

### Always-Execute Stages
- **Workspace Detection**: Initial analysis of workspace state and project type
- **Requirements Analysis**: Gathering requirements (depth varies based on complexity)
- **Workflow Planning**: Creating execution plan for which phases to run
- **Code Planning**: Creating detailed implementation plans for code generation
- **Code Generation**: Generating actual code based on plans and prior artifacts
- **Build and Test**: Building all units and executing comprehensive testing

### Conditional Stages
- **Reverse Engineering**: Analyzing existing codebase (brownfield projects only)
- **User Stories**: Creating user stories and personas (includes Story Planning and Story Generation)
- **Application Design**: Designing application components, methods, business rules, and services
- **Design**: Designing system components (includes Units Planning, Units Generation, per-unit design)
- **Functional Design**: Technology-agnostic business logic design (per-unit)
- **NFR Requirements**: Determining NFRs and selecting tech stack (per-unit)
- **NFR Design**: Incorporating NFR patterns and logical components (per-unit)
- **Infrastructure Design**: Mapping to actual infrastructure services (per-unit)

## Application Design Terms

- **Component**: A functional unit with specific responsibilities
- **Method**: A function or operation within a component with defined business rules
- **Business Rule**: Logic that governs method behavior and validation
- **Service**: Orchestration layer that coordinates business logic across components
- **Component Dependency**: Relationship and communication pattern between components

## Architecture Terms (Infrastructure)

### Unit of Work
A logical grouping of user stories for development purposes. The term used during planning and decomposition.

**Usage**: "We need to decompose the system into units of work"

### Service
An independently deployable component in a microservices architecture. Each service is a separate unit of work.

**Usage**: "The Payment Service handles all payment processing"

### Module
A logical grouping of functionality within a single service or monolith. Modules are not independently deployable.

**Usage**: "The authentication module within the User Service"

### Component
A reusable building block within a service or module. Components are classes, functions, or packages that provide specific functionality.

**Usage**: "The EmailValidator component validates email addresses"

## Terminology Guidelines

### When to Use Each Term

**Unit of Work**:
- During Units Planning and Units Generation phases
- When discussing system decomposition
- In planning documents and discussions
- Example: "How should we decompose this into units of work?"

**Service**:
- When referring to independently deployable components
- In microservices architecture contexts
- In deployment and infrastructure discussions
- Example: "The Order Service will be deployed to ECS"

**Module**:
- When referring to logical groupings within a service
- In monolith architecture contexts
- When discussing internal organization
- Example: "The reporting module generates all reports"

**Component**:
- When referring to specific classes, functions, or packages
- In design and implementation discussions
- When discussing reusable building blocks
- Example: "The DatabaseConnection component manages connections"

## Stage Terminology

### Planning vs Generation
- **Planning**: Creating a plan with questions and checkboxes for execution
- **Generation**: Executing the plan to create artifacts

Examples:
- Story Planning → Story Generation
- Units Planning → Units Generation
- Unit Design Planning → Unit Design Generation
- NFR Planning → NFR Generation
- Code Planning → Code Generation

### Depth Levels
- **Minimal**: Quick, focused execution for simple changes
- **Standard**: Normal depth with standard artifacts for typical projects
- **Comprehensive**: Full depth with all artifacts for complex/high-risk projects

## Artifact Types

### Plans
Documents with checkboxes and questions that guide execution.
- Located in \`aidlc-docs/plans/\`
- Examples: \`story-generation-plan.md\`, \`unit-of-work-plan.md\`

### Artifacts
Generated outputs from executing plans.
- Located in various \`aidlc-docs/\` subdirectories
- Examples: \`requirements.md\`, \`stories.md\`, \`design.md\`

### State Files
Files tracking workflow progress and status.
- \`aidlc-state.md\`: Overall workflow state
- \`audit.md\`: Complete audit trail of all interactions

## Common Abbreviations

- **AI-DLC**: AI-Driven Development Life Cycle
- **NFR**: Non-Functional Requirements
- **UOW**: Unit of Work
- **API**: Application Programming Interface
- **CDK**: Cloud Development Kit (AWS)


# ================================================================
# Rule: workflow-changes
# Source:common/workflow-changes.md
# ================================================================

# Mid-Workflow Changes and Phase Management

## Overview

Users may request changes to the execution plan or phase execution during the workflow. This document provides guidance on handling these requests safely and effectively.

---

## Types of Mid-Workflow Changes

### 1. Adding a Skipped Phase

**Scenario**: User wants to add a phase that was originally skipped

**Example**: "Actually, I want to add user stories even though we skipped that stage"

**Handling**:
1. **Confirm Request**: "You want to add User Stories stage. This will create user stories and personas. Confirm?"
2. **Check Dependencies**: Verify all prerequisite phases are complete
3. **Update Execution Plan**: Add phase to \`execution-plan.md\` with rationale
4. **Update State**: Mark phase as "PENDING" in \`aidlc-state.md\`
5. **Execute Phase**: Follow normal phase execution process
6. **Log Change**: Document in \`audit.md\` with timestamp and reason

**Considerations**:
- May need to update later phases that could benefit from new artifacts
- Existing artifacts may need revision to incorporate new information
- Timeline will be extended

---

### 2. Skipping a Planned Phase

**Scenario**: User wants to skip a phase that was planned to execute

**Example**: "Let's skip the NFR Design stage for now"

**Handling**:
1. **Confirm Request**: "You want to skip NFR Design. This means no NFR patterns or logical components will be incorporated. Confirm?"
2. **Warn About Impact**: Explain what will be missing and potential consequences
3. **Get Explicit Confirmation**: User must explicitly confirm understanding of impact
4. **Update Execution Plan**: Mark phase as "SKIPPED" with reason
5. **Update State**: Mark phase as "SKIPPED" in \`aidlc-state.md\`
6. **Adjust Later Phases**: Note that later phases may need manual setup
7. **Log Change**: Document in \`audit.md\` with timestamp and reason

**Considerations**:
- Later phases may fail or require manual intervention
- User accepts responsibility for missing artifacts
- Can be added back later if needed

---

### 3. Restarting Current Stage

**Scenario**: User is unhappy with current stage results and wants to redo it

**Example**: "I don't like these user stories. Can we start over?"

**Handling**:
1. **Understand Concern**: "What specifically would you like to change about the stories?"
2. **Offer Options**:
   - **Option A**: Modify existing artifacts (faster, preserves some work)
   - **Option B**: Complete restart (clean slate, more time)
3. **If Restart Chosen**:
   - Archive existing artifacts: \`{artifact}.backup.{timestamp}\`
   - Reset stage checkboxes in plan file
   - Mark stage as "IN PROGRESS" in \`aidlc-state.md\`
   - Clear stage completion status
   - Re-execute from beginning
4. **Log Change**: Document reason for restart and what will change

**Considerations**:
- Existing work will be lost (but backed up)
- May need to redo dependent stages
- Timeline will be extended

---

### 4. Restarting Previous Stage

**Scenario**: User wants to go back and redo a completed stage

**Example**: "I want to change the architectural decision we made earlier"

**Handling**:
1. **Assess Impact**: Identify all stages that depend on the stage to be restarted
2. **Warn User**: "Restarting Application Design will require redoing: Units Planning, Units Generation, per-unit design (all units), Code Planning, Code Generation. Confirm?"
3. **Get Explicit Confirmation**: User must understand full impact
4. **If Confirmed**:
   - Archive all affected artifacts
   - Reset all affected stages in \`aidlc-state.md\`
   - Clear checkboxes in all affected plan files
   - Return to the stage to restart
   - Re-execute from that point forward
5. **Log Change**: Document full impact and reason for restart

**Considerations**:
- Significant rework required
- All dependent stages must be redone
- Timeline will be significantly extended
- Consider if modification is better than restart

---

### 5. Changing Stage Depth

**Scenario**: User wants to change the depth level of current or upcoming stage

**Example**: "Let's do a comprehensive requirements analysis instead of standard"

**Handling**:
1. **Confirm Request**: "You want to change Requirements Analysis from Standard to Comprehensive depth. This will be more thorough but take longer. Confirm?"
2. **Update Execution Plan**: Change depth level in \`workflow-planning.md\`
3. **Adjust Approach**: Follow comprehensive depth guidelines for the stage
4. **Update Estimates**: Inform user of new timeline estimate
5. **Log Change**: Document depth change and reason

**Considerations**:
- More depth = more time but better quality
- Less depth = faster but may miss details
- Can only change before or during stage, not after completion

---

### 6. Pausing Workflow

**Scenario**: User needs to pause and resume later

**Example**: "I need to stop for now and continue tomorrow"

**Handling**:
1. **Complete Current Step**: Finish the current step in progress if possible
2. **Update Checkboxes**: Mark all completed steps with [x]
3. **Update State**: Ensure \`aidlc-state.md\` reflects current status
4. **Log Pause**: Document pause point in \`audit.md\`
5. **Provide Resume Instructions**: "When you return, I'll detect your existing project and offer to continue from: [current phase, current step]"

**On Resume**:
1. **Detect Existing Project**: Check for \`aidlc-state.md\`
2. **Load Context**: Read all artifacts from completed stages
3. **Show Status**: Display current stage and next step
4. **Offer Options**: Continue where left off or review previous work
5. **Log Resume**: Document resume point in \`audit.md\`

---

### 7. Changing Architectural Decision

**Scenario**: User wants to change from monolith to microservices (or vice versa)

**Example**: "Actually, let's do microservices instead of a monolith"

**Handling**:
1. **Assess Current Progress**: Determine how far into workflow
2. **Explain Impact**: 
   - If before Units Planning: Minimal impact, just update decision
   - If after Units Planning: Must redo Units Planning, Units Generation, all per-unit design
   - If after Code Generation: Significant rework required
3. **Recommend Approach**:
   - Early in workflow: Restart from Application Design stage
   - Late in workflow: Consider if modification is feasible vs. restart
4. **Get Confirmation**: User must understand full scope of change
5. **Execute Change**: Follow restart procedures for affected stages

**Considerations**:
- Architectural changes have cascading effects
- Earlier in workflow = easier to change
- Later in workflow = consider cost vs. benefit

---

### 8. Adding/Removing Units

**Scenario**: User wants to add or remove units after Units Generation

**Example**: "We need to split the Payment unit into Payment and Billing"

**Handling**:
1. **Assess Impact**: Determine which units have completed design/code
2. **Explain Consequences**:
   - Adding unit: Need to do full design and code for new unit
   - Removing unit: Need to redistribute functionality to other units
   - Splitting unit: Need to redo design and code for both resulting units
3. **Update Unit Artifacts**:
   - Modify \`unit-of-work.md\`
   - Update \`unit-of-work-dependency.md\`
   - Revise \`unit-of-work-story-map.md\`
4. **Reset Affected Units**: Mark affected units as needing redesign
5. **Execute Changes**: Follow normal unit design and code process for affected units

**Considerations**:
- Affects all downstream stages for those units
- May affect other units if dependencies change
- Timeline impact depends on how many units affected

---

## General Guidelines for Handling Changes

### Before Making Changes

1. **Understand the Request**: Ask clarifying questions about what user wants to change and why
2. **Assess Impact**: Identify all affected stages, artifacts, and dependencies
3. **Explain Consequences**: Clearly communicate what will need to be redone and timeline impact
4. **Offer Alternatives**: Sometimes modification is better than restart
5. **Get Explicit Confirmation**: User must understand and accept the impact

### During Changes

1. **Archive Existing Work**: Always backup before making destructive changes
2. **Update All Tracking**: Keep \`aidlc-state.md\`, plan files, and \`audit.md\` in sync
3. **Communicate Progress**: Keep user informed about what's happening
4. **Validate Changes**: Ensure changes are consistent across all artifacts
5. **Test Continuity**: Verify workflow can continue smoothly after changes

### After Changes

1. **Verify Consistency**: Check that all artifacts are aligned with changes
2. **Update Documentation**: Ensure all references are updated
3. **Log Completely**: Document full change history in \`audit.md\`
4. **Confirm with User**: Verify changes meet user's expectations
5. **Resume Workflow**: Continue with normal execution from new state

---

## Change Request Decision Tree

\`\`\`
User requests change
    |
    ├─ Is it current phase?
    |   ├─ Yes: Can modify or restart current phase
    |   └─ No: Go to next question
    |
    ├─ Is it a completed phase?
    |   ├─ Yes: Assess impact on dependent phases
    |   |   ├─ Low impact: Modify and update dependents
    |   |   └─ High impact: Recommend restart from that phase
    |   └─ No: Go to next question
    |
    ├─ Is it adding a skipped phase?
    |   ├─ Yes: Check prerequisites, add to plan, execute
    |   └─ No: Go to next question
    |
    ├─ Is it skipping a planned phase?
    |   ├─ Yes: Warn about impact, get confirmation, skip
    |   └─ No: Go to next question
    |
    └─ Is it changing depth level?
        ├─ Yes: Update plan, adjust approach
        └─ No: Clarify request with user
\`\`\`

---

## Logging Requirements

### Change Request Log Format

\`\`\`markdown
## Change Request - [Phase Name]
**Timestamp**: [ISO timestamp]
**Request**: [What user wants to change]
**Current State**: [Where we are in workflow]
**Impact Assessment**: [What will be affected]
**User Confirmation**: [User's explicit confirmation]
**Action Taken**: [What was done]
**Artifacts Affected**: [List of files changed/reset]

---
\`\`\`

---

## Best Practices

1. **Always Confirm**: Never make destructive changes without explicit user confirmation
2. **Explain Impact**: Users need to understand consequences before deciding
3. **Offer Options**: Sometimes there are multiple ways to handle a change
4. **Archive First**: Always backup before making destructive changes
5. **Update Everything**: Keep all tracking files in sync
6. **Log Thoroughly**: Document all changes for audit trail
7. **Validate After**: Ensure workflow can continue smoothly
8. **Be Flexible**: Workflow should adapt to user needs, not force rigid process


# ================================================================
# Rule: ascii-diagram-standards
# Source:common/ascii-diagram-standards.md
# ================================================================

# ASCII Diagram Standards

## MANDATORY: Use Basic ASCII Only

**CRITICAL**: ALWAYS use basic ASCII characters for diagrams (maximum compatibility).

### ✅ ALLOWED: \`+\` \`-\` \`|\` \`^\` \`v\` \`<\` \`>\` and alphanumeric text

### ❌ FORBIDDEN: Unicode box-drawing characters
- NO: \`┌\` \`─\` \`│\` \`└\` \`┐\` \`┘\` \`├\` \`┤\` \`┬\` \`┴\` \`┼\` \`▼\` \`▲\` \`►\` \`◄\`
- Reason: Inconsistent rendering across fonts/platforms

## Standard ASCII Diagram Patterns

### CRITICAL: Character Width Rule
**Every line in a box MUST have EXACTLY the same character count (including spaces)**

✅ CORRECT (all lines = 67 chars):
\`\`\`
+---------------------------------------------------------------+
|                      Component Name                           |
|  Description text here                                        |
+---------------------------------------------------------------+
\`\`\`

❌ WRONG (inconsistent widths):
\`\`\`
+---------------------------------------------------------------+
|                      Component Name                           |
|  Description text here                                   |
+---------------------------------------------------------------+
\`\`\`

### Box Pattern
\`\`\`
+-----------------------------------------------------+
|                                                     |
|              Calculator Application                 |
|                                                     |
|  Provides basic arithmetic operations for users     |
|  through a web-based interface                      |
|                                                     |
+-----------------------------------------------------+
\`\`\`

### Nested Boxes
\`\`\`
+-------------------------------------------------------+
|              Web Server (PHP Runtime)                 |
|  +-------------------------------------------------+  |
|  |  index.php (Monolithic Application)             |  |
|  |  +-------------------------------------------+  |  |
|  |  |  HTML Template (View Layer)               |  |  |
|  |  |  - Form rendering                         |  |  |
|  |  |  - Result display                         |  |  |
|  |  +-------------------------------------------+  |  |
|  +-------------------------------------------------+  |
+-------------------------------------------------------+
\`\`\`

### Arrows and Connections
\`\`\`
+----------+
|  Source  |
+----------+
     |
     | HTTP POST
     v
+----------+
|  Target  |
+----------+
\`\`\`

### Horizontal Flow
\`\`\`
+-------+     +-------+     +-------+
| Step1 | --> | Step2 | --> | Step3 |
+-------+     +-------+     +-------+
\`\`\`

### Vertical Flow with Labels
\`\`\`
User Action Flow:
    |
    v
+----------+
|  Input   |
+----------+
    |
    | validates
    v
+----------+
| Process  |
+----------+
    |
    | returns
    v
+----------+
|  Output  |
+----------+
\`\`\`

## Validation

Before creating diagrams:
- [ ] Basic ASCII only: \`+\` \`-\` \`|\` \`^\` \`v\` \`<\` \`>\`
- [ ] No Unicode box-drawing
- [ ] Spaces (not tabs) for alignment
- [ ] Corners use \`+\`
- [ ] **ALL box lines same character width** (count characters including spaces)
- [ ] Test: Verify corners align vertically in monospace font

## Alternative

For complex diagrams, use Mermaid (see \`content-validation.md\`)`;

export const INCEPTION_RULES: string = `# ================================================================
# Rule: workspace-detection
# Source:inception/workspace-detection.md
# ================================================================

# Workspace Detection

**Purpose**: Determine workspace state and check for existing AI-DLC projects

## Step 1: Check for Existing AI-DLC Project

Check if \`aidlc-docs/aidlc-state.md\` exists:
- **If exists**: Resume from last phase (load context from previous phases)
- **If not exists**: Continue with new project assessment

## Step 2: Scan Workspace for Existing Code

**Determine if workspace has existing code:**
- Scan workspace for source code files (.java, .py, .js, .ts, .jsx, .tsx, .kt, .kts, .scala, .groovy, .go, .rs, .rb, .php, .c, .h, .cpp, .hpp, .cc, .cs, .fs, etc.)
- Check for build files (pom.xml, package.json, build.gradle, etc.)
- Look for project structure indicators
- Identify workspace root directory (NOT aidlc-docs/)

**Record findings:**
\`\`\`markdown
## Workspace State
- **Existing Code**: [Yes/No]
- **Programming Languages**: [List if found]
- **Build System**: [Maven/Gradle/npm/etc. if found]
- **Project Structure**: [Monolith/Microservices/Library/Empty]
- **Workspace Root**: [Absolute path]
\`\`\`

## Step 3: Determine Next Phase

**IF workspace is empty (no existing code)**:
- Set flag: \`brownfield = false\`
- Next phase: Requirements Analysis

**IF workspace has existing code**:
- Set flag: \`brownfield = true\`
- Check for existing reverse engineering artifacts in \`aidlc-docs/inception/reverse-engineering/\`
- **IF reverse engineering artifacts exist**: Load them, skip to Requirements Analysis
- **IF no reverse engineering artifacts**: Next phase is Reverse Engineering

## Step 4: Create Initial State File

Create \`aidlc-docs/aidlc-state.md\`:

\`\`\`markdown
# AI-DLC State Tracking

## Project Information
- **Project Type**: [Greenfield/Brownfield]
- **Start Date**: [ISO timestamp]
- **Current Stage**: INCEPTION - Workspace Detection

## Workspace State
- **Existing Code**: [Yes/No]
- **Reverse Engineering Needed**: [Yes/No]
- **Workspace Root**: [Absolute path]

## Code Location Rules
- **Application Code**: Workspace root (NEVER in aidlc-docs/)
- **Documentation**: aidlc-docs/ only
- **Structure patterns**: See code-generation.md Critical Rules

## Stage Progress
[Will be populated as workflow progresses]
\`\`\`

## Step 5: Present Completion Message

**For Brownfield Projects:**
\`\`\`markdown
# 🔍 Workspace Detection Complete

Workspace analysis findings:
• **Project Type**: Brownfield project
• [AI-generated summary of workspace findings in bullet points]
• **Next Step**: Proceeding to **Reverse Engineering** to analyze existing codebase...
\`\`\`

**For Greenfield Projects:**
\`\`\`markdown
# 🔍 Workspace Detection Complete

Workspace analysis findings:
• **Project Type**: Greenfield project
• **Next Step**: Proceeding to **Requirements Analysis**...
\`\`\`

## Step 6: Automatically Proceed

- **No user approval required** - this is informational only
- Automatically proceed to next phase:
  - **Brownfield**: Reverse Engineering (if no existing artifacts) or Requirements Analysis (if artifacts exist)
  - **Greenfield**: Requirements Analysis


# ================================================================
# Rule: reverse-engineering
# Source:inception/reverse-engineering.md
# ================================================================

# Reverse Engineering

**Purpose**: Analyze existing codebase and generate comprehensive design artifacts

**Execute when**: Brownfield project detected (existing code found in workspace)

**Skip when**: Greenfield project (no existing code)

**Rerun behavior**: Always rerun when brownfield project detected, even if artifacts exist. This ensures artifacts reflect current code state

## Step 1: Multi-Package Discovery

### 1.1 Scan Workspace
- All packages (not just mentioned ones)
- Package relationships via config files
- Package types: Application, CDK/Infrastructure, Models, Clients, Tests

### 1.2 Understand the Business Context
- The core business that the system is implementing overall
- The business overview of every package
- List of Business Transactions that are implemented in the system

### 1.3 Infrastructure Discovery
- CDK packages (package.json with CDK dependencies)
- Terraform (.tf files)
- CloudFormation (.yaml/.json templates)
- Deployment scripts

### 1.4 Build System Discovery
- Build systems: Brazil, Maven, Gradle, npm
- Config files for build-system declarations
- Build dependencies between packages

### 1.5 Service Architecture Discovery
- Lambda functions (handlers, triggers)
- Container services (Docker/ECS configs)
- API definitions (Smithy models, OpenAPI specs)
- Data stores (DynamoDB, S3, etc.)

### 1.6 Code Quality Analysis
- Programming languages and frameworks
- Test coverage indicators
- Linting configurations
- CI/CD pipelines

## Step 1: Generate Business Overview Documentation

Create \`aidlc-docs/inception/reverse-engineering/business-overview.md\`:

\`\`\`markdown
# Business Overview

## Business Context Diagram
[Mermaid diagram showing the Business Context]

## Business Description
- **Business Description**: [Overall Business description of what the system does]
- **Business Transactions**: [List of Business Transactions that the system implements and their descriptions]
- **Business Dictionary**: [Business dictionary terms that the system follows and their meaning]

## Component Level Business Descriptions
### [Package/Component Name]
- **Purpose**: [What it does from the business perspective]
- **Responsibilities**: [Key responsibilities]
\`\`\`

## Step 2: Generate Architecture Documentation

Create \`aidlc-docs/inception/reverse-engineering/architecture.md\`:

\`\`\`markdown
# System Architecture

## System Overview
[High-level description of the system]

## Architecture Diagram
[Mermaid diagram showing all packages, services, data stores, relationships]

## Component Descriptions
### [Package/Component Name]
- **Purpose**: [What it does]
- **Responsibilities**: [Key responsibilities]
- **Dependencies**: [What it depends on]
- **Type**: [Application/Infrastructure/Model/Client/Test]

## Data Flow
[Mermaid sequence diagram of key workflows]

## Integration Points
- **External APIs**: [List with purposes]
- **Databases**: [List with purposes]
- **Third-party Services**: [List with purposes]

## Infrastructure Components
- **CDK Stacks**: [List with purposes]
- **Deployment Model**: [Description]
- **Networking**: [VPC, subnets, security groups]
\`\`\`

## Step 3: Generate Code Structure Documentation

Create \`aidlc-docs/inception/reverse-engineering/code-structure.md\`:

\`\`\`markdown
# Code Structure

## Build System
- **Type**: [Maven/Gradle/npm/Brazil]
- **Configuration**: [Key build files and settings]

## Key Classes/Modules
[Mermaid class diagram or module hierarchy]

### Existing Files Inventory
[List all source files with their purposes - these are candidates for modification in brownfield projects]

**Example format**:
- \`[path/to/file]\` - [Purpose/responsibility]

## Design Patterns
### [Pattern Name]
- **Location**: [Where used]
- **Purpose**: [Why used]
- **Implementation**: [How implemented]

## Critical Dependencies
### [Dependency Name]
- **Version**: [Version number]
- **Usage**: [How and where used]
- **Purpose**: [Why needed]
\`\`\`

## Step 4: Generate API Documentation

Create \`aidlc-docs/inception/reverse-engineering/api-documentation.md\`:

\`\`\`markdown
# API Documentation

## REST APIs
### [Endpoint Name]
- **Method**: [GET/POST/PUT/DELETE]
- **Path**: [/api/path]
- **Purpose**: [What it does]
- **Request**: [Request format]
- **Response**: [Response format]

## Internal APIs
### [Interface/Class Name]
- **Methods**: [List with signatures]
- **Parameters**: [Parameter descriptions]
- **Return Types**: [Return type descriptions]

## Data Models
### [Model Name]
- **Fields**: [Field descriptions]
- **Relationships**: [Related models]
- **Validation**: [Validation rules]
\`\`\`

## Step 5: Generate Component Inventory

Create \`aidlc-docs/inception/reverse-engineering/component-inventory.md\`:

\`\`\`markdown
# Component Inventory

## Application Packages
- [Package name] - [Purpose]

## Infrastructure Packages
- [Package name] - [CDK/Terraform] - [Purpose]

## Shared Packages
- [Package name] - [Models/Utilities/Clients] - [Purpose]

## Test Packages
- [Package name] - [Integration/Load/Unit] - [Purpose]

## Total Count
- **Total Packages**: [Number]
- **Application**: [Number]
- **Infrastructure**: [Number]
- **Shared**: [Number]
- **Test**: [Number]
\`\`\`

## Step 6: Generate Technology Stack Documentation

Create \`aidlc-docs/inception/reverse-engineering/technology-stack.md\`:

\`\`\`markdown
# Technology Stack

## Programming Languages
- [Language] - [Version] - [Usage]

## Frameworks
- [Framework] - [Version] - [Purpose]

## Infrastructure
- [Service] - [Purpose]

## Build Tools
- [Tool] - [Version] - [Purpose]

## Testing Tools
- [Tool] - [Version] - [Purpose]
\`\`\`

## Step 7: Generate Dependencies Documentation

Create \`aidlc-docs/inception/reverse-engineering/dependencies.md\`:

\`\`\`markdown
# Dependencies

## Internal Dependencies
[Mermaid diagram showing package dependencies]

### [Package A] depends on [Package B]
- **Type**: [Compile/Runtime/Test]
- **Reason**: [Why dependency exists]

## External Dependencies
### [Dependency Name]
- **Version**: [Version]
- **Purpose**: [Why used]
- **License**: [License type]
\`\`\`

## Step 8: Generate Code Quality Assessment

Create \`aidlc-docs/inception/reverse-engineering/code-quality-assessment.md\`:

\`\`\`markdown
# Code Quality Assessment

## Test Coverage
- **Overall**: [Percentage or Good/Fair/Poor/None]
- **Unit Tests**: [Status]
- **Integration Tests**: [Status]

## Code Quality Indicators
- **Linting**: [Configured/Not configured]
- **Code Style**: [Consistent/Inconsistent]
- **Documentation**: [Good/Fair/Poor]

## Technical Debt
- [Issue description and location]

## Patterns and Anti-patterns
- **Good Patterns**: [List]
- **Anti-patterns**: [List with locations]
\`\`\`

## Step 9: Create Timestamp File

Create \`aidlc-docs/inception/reverse-engineering/reverse-engineering-timestamp.md\`:

\`\`\`markdown
# Reverse Engineering Metadata

**Analysis Date**: [ISO timestamp]
**Analyzer**: AI-DLC
**Workspace**: [Workspace path]
**Total Files Analyzed**: [Number]

## Artifacts Generated
- [x] architecture.md
- [x] code-structure.md
- [x] api-documentation.md
- [x] component-inventory.md
- [x] technology-stack.md
- [x] dependencies.md
- [x] code-quality-assessment.md
\`\`\`

## Step 10: Update State Tracking

Update \`aidlc-docs/aidlc-state.md\`:

\`\`\`markdown
## Reverse Engineering Status
- [x] Reverse Engineering - Completed on [timestamp]
- **Artifacts Location**: aidlc-docs/inception/reverse-engineering/
\`\`\`

## Step 11: Present Completion Message to User

\`\`\`markdown
# 🔍 Reverse Engineering Complete

[AI-generated summary of key findings from analysis in the form of bullet points]

> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the reverse engineering artifacts at: \`aidlc-docs/inception/reverse-engineering/\`

> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the reverse engineering analysis if required
> ✅ **Approve & Continue** - Approve analysis and proceed to **Requirements Analysis**
\`\`\`

## Step 12: Wait for User Approval

- **MANDATORY**: Do not proceed until user explicitly approves
- **MANDATORY**: Log user's response in audit.md with complete raw input


# ================================================================
# Rule: requirements-analysis
# Source:inception/requirements-analysis.md
# ================================================================

# Requirements Analysis (Adaptive)

**Assume the role** of a product owner

**Adaptive Phase**: Always executes. Detail level adapts to problem complexity.

**See [depth-levels.md](../common/depth-levels.md) for adaptive depth explanation**

## Prerequisites
- Workspace Detection must be complete
- Reverse Engineering must be complete (if brownfield)

## Execution Steps

### Step 1: Load Reverse Engineering Context (if available)

**IF brownfield project**:
- Load \`aidlc-docs/inception/reverse-engineering/architecture.md\`
- Load \`aidlc-docs/inception/reverse-engineering/component-inventory.md\`
- Load \`aidlc-docs/inception/reverse-engineering/technology-stack.md\`
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
- **User Scenarios**: Use cases, user journeys, edge cases, error scenarios
- **Business Context**: Goals, constraints, success criteria, stakeholder needs
- **Technical Context**: Integration points, data requirements, system boundaries
- **Quality Attributes**: Reliability, maintainability, testability, accessibility

**When in doubt, ask questions** - incomplete requirements lead to poor implementations.

### Step 6: Generate Clarifying Questions (PROACTIVE APPROACH)
   - **ALWAYS** create \`aidlc-docs/inception/requirements/requirement-verification-questions.md\` unless requirements are exceptionally clear and complete
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
DO NOT proceed to Step 7 until all questions in requirement-verification-questions.md are answered and validated.
Present the question file to the user and STOP.

### Step 7: Generate Requirements Document
   - **PREREQUISITE**: Step 6 gate must be passed — all answers received and analyzed
   - Create \`aidlc-docs/inception/requirements/requirements.md\`
   - Include intent analysis summary at the top:
     - User request
     - Request type
     - Scope estimate
     - Complexity estimate
   - Include both functional and non-functional requirements
   - Incorporate user's answers to clarifying questions
   - Provide brief summary of key requirements

### Step 8: Update State Tracking

Update \`aidlc-docs/aidlc-state.md\`:

\`\`\`markdown
## Stage Progress
### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [x] Reverse Engineering (if applicable)
- [x] Requirements Analysis
\`\`\`

### Step 9: Log and Proceed
   - Log approval prompt with timestamp in \`aidlc-docs/audit.md\`
   - Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 🔍 Requirements Analysis Complete
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary of requirements
        - Format: "Requirements analysis has identified [project type/complexity]:"
        - List key functional requirements (bullet points)
        - List key non-functional requirements (bullet points)
        - Mention architectural considerations or technical decisions if relevant
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the requirements document at: \`aidlc-docs/inception/requirements/requirements.md\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** -  Ask for modifications to the requirements if required based on your review 
> [IF User Stories will be skipped, add this option:]
> 📝 **Add User Stories** - Choose to Include **User Stories** stage (currently skipped based on project simplicity)  
> ✅ **Approve & Continue** - Approve requirements and proceed to **[User Stories/Workflow Planning]**

---
\`\`\`

**Note**: Include the "Add User Stories" option only when User Stories stage will be skipped. Replace [User Stories/Workflow Planning] with the actual next stage name.

   - Wait for explicit user approval before proceeding
   - Record approval response with timestamp
   - Update Requirements Analysis stage complete in aidlc-state.md

# ================================================================
# Rule: user-stories
# Source:inception/user-stories.md
# ================================================================

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
   - Create \`aidlc-docs/inception/plans/user-stories-assessment.md\`
   - Include reasoning for why user stories are valuable for this request
   - Reference specific assessment criteria that apply
   - Explain expected benefits (clarity, testing, stakeholder alignment)

4. **Proceed Only If Justified**:
   - User stories must add clear value to the project
   - Assessment must show concrete benefits outweigh overhead
   - Decision should be defensible to project stakeholders

### Assessment Documentation Template
\`\`\`markdown
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
\`\`\`

## Step 2: Create Story Plan
- Assume the role of a product owner
- Generate a comprehensive plan with step-by-step execution checklist for story development
- Each step and sub-step should have a checkbox []
- Focus on methodology and approach for converting requirements into user stories

## Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Thoroughly analyze the requirements and context to identify ALL areas where clarification would improve story quality and team understanding. Be proactive in asking questions to ensure comprehensive user story development.

**CRITICAL**: Default to asking questions when there is ANY ambiguity or missing detail that could affect story quality. It's better to ask too many questions than to create incomplete or unclear stories.

**See \`common/question-format-guide.md\` for question formatting rules**

- EMBED questions using [Answer]: tag format
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
- Save the complete story plan with embedded questions in \`aidlc-docs/inception/plans/\` directory
- Filename: \`story-generation-plan.md\`
- Include all [Answer]: tags for user input
- Ensure plan is comprehensive and covers all story development aspects

## Step 7: Request User Input
- Ask user to fill in all [Answer]: tags directly in the story plan document
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

## Step 11: Avoid Implementation Details
- Focus on story creation methodology, not prioritization or development tasks
- Do not discuss technical generation at this stage
- Avoid creating development timelines or sprint planning
- Keep focus on story structure and format decisions

## Step 12: Log Approval Prompt
- Before asking for approval, log the prompt with timestamp in \`aidlc-docs/audit.md\`
- Include the complete approval prompt text
- Use ISO 8601 timestamp format

## Step 13: Wait for Explicit Approval of Plan
- Do not proceed until the user explicitly approves the story approach
- Approval must be clear and unambiguous
- If user requests changes, update the plan and repeat the approval process

## Step 14: Record Approval Response
- Log the user's approval response with timestamp in \`aidlc-docs/audit.md\`
- Include the exact user response text
- Mark the approval status clearly

---

# PART 2: GENERATION

## Step 15: Load Story Generation Plan
- [ ] Read the complete story plan from \`aidlc-docs/inception/plans/story-generation-plan.md\`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context and requirements for that step

## Step 16: Execute Current Step
- [ ] Perform exactly what the current step describes
- [ ] Generate story artifacts as specified in the plan
- [ ] Follow the approved methodology and format from Planning
- [ ] Use the story breakdown approach specified in the plan

## Step 17: Update Progress
- [ ] Mark the completed step as [x] in the story generation plan
- [ ] Update \`aidlc-docs/aidlc-state.md\` current status
- [ ] Save all generated artifacts

## Step 18: Continue or Complete Generation
- [ ] If more steps remain, return to Step 14
- [ ] If all steps complete, verify stories are ready for next stage
- [ ] Ensure all mandatory artifacts are generated

## Step 19: Log Approval Prompt
- Before asking for approval, log the prompt with timestamp in \`aidlc-docs/audit.md\`
- Include the complete approval prompt text
- Use ISO 8601 timestamp format

## Step 20: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 📚 User Stories Complete
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary of generated stories
        - Format: "User stories generation has created [description]:"
        - List key personas generated (bullet points)
        - List user stories created with counts and organization
        - Mention story structure and compliance (INVEST criteria, acceptance criteria)
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the user stories and personas at: \`aidlc-docs/inception/user-stories/stories.md\` and \`aidlc-docs/inception/user-stories/personas.md\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** -  Ask for modifications to the stories or personas based on your review  
> ✅ **Approve & Continue** - Approve user stories and proceed to **Workflow Planning**

---
\`\`\`

## Step 21: Wait for Explicit Approval of Generated Stories
- Do not proceed until the user explicitly approves the generated stories
- Approval must be clear and unambiguous
- If user requests changes, update stories and repeat the approval process

## Step 22: Record Approval Response
- Log the user's approval response with timestamp in \`aidlc-docs/audit.md\`
- Include the exact user response text
- Mark the approval status clearly

## Step 23: Update Progress
- Mark User Stories stage complete in \`aidlc-state.md\`
- Update the "Current Status" section
- Prepare for transition to next stage

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


# ================================================================
# Rule: workflow-planning
# Source:inception/workflow-planning.md
# ================================================================

# Workflow Planning

**Purpose**: Determine which phases to execute and create comprehensive execution plan

**Always Execute**: This phase always runs after understanding requirements and scope

## Step 1: Load All Prior Context

### 1.1 Load Reverse Engineering Artifacts (if brownfield)
- architecture.md
- component-inventory.md
- technology-stack.md
- dependencies.md

### 1.2 Load Requirements Analysis
- requirements.md (includes intent analysis)
- requirement-verification-questions.md (with answers)

### 1.3 Load User Stories (if executed)
- stories.md
- personas.md

## Step 2: Detailed Scope and Impact Analysis

**Now that we have complete context (requirements + stories), perform detailed analysis:**

### 2.1 Transformation Scope Detection (Brownfield Only)

**IF brownfield project**, analyze transformation scope:

#### Architectural Transformation
- **Single component change** vs **architectural transformation**
- **Infrastructure changes** vs **application changes**
- **Deployment model changes** (Lambda→Container, EC2→Serverless, etc.)

#### Related Component Identification
For transformations, identify:
- **Infrastructure code** that needs updates
- **CDK stacks** requiring changes
- **API Gateway** configurations
- **Load balancer** requirements
- **Networking** changes needed
- **Monitoring/logging** adaptations

#### Cross-Package Impact
- **CDK infrastructure** packages requiring updates
- **Shared models** needing version updates
- **Client libraries** requiring endpoint changes
- **Test packages** needing new test scenarios

### 2.2 Change Impact Assessment

#### Impact Areas
1. **User-facing changes**: Does this affect user experience?
2. **Structural changes**: Does this change system architecture?
3. **Data model changes**: Does this affect database schemas or data structures?
4. **API changes**: Does this affect interfaces or contracts?
5. **NFR impact**: Does this affect performance, security, or scalability?

#### Application Layer Impact (if applicable)
- **Code changes**: New entry points, adapters, configurations
- **Dependencies**: New libraries, framework changes
- **Configuration**: Environment variables, config files
- **Testing**: Unit tests, integration tests

#### Infrastructure Layer Impact (if applicable)
- **Deployment model**: Lambda→ECS, EC2→Fargate, etc.
- **Networking**: VPC, security groups, load balancers
- **Storage**: Persistent volumes, shared storage
- **Scaling**: Auto-scaling policies, capacity planning

#### Operations Layer Impact (if applicable)
- **Monitoring**: CloudWatch, custom metrics, dashboards
- **Logging**: Log aggregation, structured logging
- **Alerting**: Alarm configurations, notification channels
- **Deployment**: CI/CD pipeline changes, rollback strategies

### 2.3 Component Relationship Mapping (Brownfield Only)

**IF brownfield project**, create component dependency graph:

\`\`\`markdown
## Component Relationships
- **Primary Component**: [Package being changed]
- **Infrastructure Components**: [CDK/Terraform packages]
- **Shared Components**: [Models, utilities, clients]
- **Dependent Components**: [Services that call this component]
- **Supporting Components**: [Monitoring, logging, deployment]
\`\`\`

For each related component:
- **Change Type**: Major, Minor, Configuration-only
- **Change Reason**: Direct dependency, deployment model, networking
- **Change Priority**: Critical, Important, Optional

### 2.4 Risk Assessment

Evaluate risk level:
1. **Low**: Isolated change, easy rollback, well-understood
2. **Medium**: Multiple components, moderate rollback, some unknowns
3. **High**: System-wide impact, complex rollback, significant unknowns
4. **Critical**: Production-critical, difficult rollback, high uncertainty

## Step 3: Phase Determination

### 3.1 User Stories - Already Executed or Skip?
**Already executed**: Move to next determination
**Not executed - Execute IF**:
- Multiple user personas
- User experience impact
- Acceptance criteria needed
- Team collaboration required

**Skip IF**:
- Internal refactoring
- Bug fix with clear reproduction
- Technical debt reduction
- Infrastructure changes

### 3.2 Application Design - Execute IF:
- New components or services needed
- Component methods and business rules need definition
- Service layer design required
- Component dependencies need clarification

**Skip IF**:
- Changes within existing component boundaries
- No new components or methods
- Pure implementation changes

### 3.3 Design (Units Planning/Generation) - Execute IF:
- New data models or schemas
- API changes or new endpoints
- Complex algorithms or business logic
- State management changes
- Multiple packages require changes
- Infrastructure-as-code updates needed

**Skip IF**:
- Simple logic changes
- UI-only changes
- Configuration updates
- Straightforward implementations

### 3.4 NFR Implementation - Execute IF:
- Performance requirements
- Security considerations
- Scalability concerns
- Monitoring/observability needed

**Skip IF**:
- Existing NFR setup sufficient
- No new NFR requirements
- Simple changes with no NFR impact

## Step 4: Note Adaptive Detail

**See [depth-levels.md](../common/depth-levels.md) for adaptive depth explanation**

For each stage that will execute:
- All defined artifacts will be created
- Detail level within artifacts adapts to problem complexity
- Model determines appropriate detail based on problem characteristics

## Step 5: Multi-Module Coordination Analysis (Brownfield Only)

**IF brownfield with multiple modules/packages**, analyze dependencies and determine optimal update strategy:

### 5.1 Analyze Module Dependencies
- Examine build system dependencies and dependency manifests
- Identify build-time vs runtime dependencies
- Map API contracts and shared interfaces between modules

### 5.2 Determine Update Strategy
Based on dependency analysis, decide:
- **Update sequence**: Which modules must be updated first due to dependencies
- **Parallelization opportunities**: Which modules can be updated simultaneously
- **Coordination requirements**: Version compatibility, API contracts, deployment order
- **Testing strategy**: Per-module vs integrated testing approach
- **Rollback strategy**: Recovery plan if mid-sequence failures occur

### 5.3 Document Coordination Plan
\`\`\`markdown
## Module Update Strategy
- **Update Approach**: [Sequential/Parallel/Hybrid]
- **Critical Path**: [Modules that block other updates]
- **Coordination Points**: [Shared APIs, infrastructure, data contracts]
- **Testing Checkpoints**: [When to validate integration]
\`\`\`

Identify for each affected module:
- **Update priority**: Must-update-first vs can-update-later
- **Dependency constraints**: What it depends on, what depends on it
- **Change scope**: Major (breaking), Minor (compatible), Patch (fixes)

## Step 6: Generate Workflow Visualization

Create Mermaid flowchart showing:
- All phases in sequence
- EXECUTE or SKIP decision for each conditional phase
- Proper styling for each phase state

**Styling rules** (add after flowchart):
\`\`\`
style WD fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
style CP fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
style CG fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
style BT fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff
style US fill:#BDBDBD,stroke:#424242,stroke-width:2px,stroke-dasharray: 5 5,color:#000
style Start fill:#CE93D8,stroke:#6A1B9A,stroke-width:3px,color:#000
style End fill:#CE93D8,stroke:#6A1B9A,stroke-width:3px,color:#000

linkStyle default stroke:#333,stroke-width:2px
\`\`\`

**Style Guidelines**:
- Completed/Always execute: \`fill:#4CAF50,stroke:#1B5E20,stroke-width:3px,color:#fff\` (Material Green with white text)
- Conditional EXECUTE: \`fill:#FFA726,stroke:#E65100,stroke-width:3px,stroke-dasharray: 5 5,color:#000\` (Material Orange with black text)
- Conditional SKIP: \`fill:#BDBDBD,stroke:#424242,stroke-width:2px,stroke-dasharray: 5 5,color:#000\` (Material Gray with black text)
- Start/End: \`fill:#CE93D8,stroke:#6A1B9A,stroke-width:3px,color:#000\` (Material Purple with black text)
- Phase containers: Use lighter Material colors (INCEPTION: #BBDEFB, CONSTRUCTION: #C8E6C9, OPERATIONS: #FFF59D)

## Step 7: Create Execution Plan Document

Create \`aidlc-docs/inception/plans/execution-plan.md\`:

\`\`\`markdown
# Execution Plan

## Detailed Analysis Summary

### Transformation Scope (Brownfield Only)
- **Transformation Type**: [Single component/Architectural/Infrastructure]
- **Primary Changes**: [Description]
- **Related Components**: [List]

### Change Impact Assessment
- **User-facing changes**: [Yes/No - Description]
- **Structural changes**: [Yes/No - Description]
- **Data model changes**: [Yes/No - Description]
- **API changes**: [Yes/No - Description]
- **NFR impact**: [Yes/No - Description]

### Component Relationships (Brownfield Only)
[Component dependency graph]

### Risk Assessment
- **Risk Level**: [Low/Medium/High/Critical]
- **Rollback Complexity**: [Easy/Moderate/Difficult]
- **Testing Complexity**: [Simple/Moderate/Complex]

## Workflow Visualization

\`\`\`mermaid
flowchart TD
    Start(["User Request"])
    
    subgraph INCEPTION["🔵 INCEPTION PHASE"]
        WD["Workspace Detection<br/><b>STATUS</b>"]
        RE["Reverse Engineering<br/><b>STATUS</b>"]
        RA["Requirements Analysis<br/><b>STATUS</b>"]
        US["User Stories<br/><b>STATUS</b>"]
        WP["Workflow Planning<br/><b>STATUS</b>"]
        AD["Application Design<br/><b>STATUS</b>"]
        UP["Units Planning<br/><b>STATUS</b>"]
        UG["Units Generation<br/><b>STATUS</b>"]
    end
    
    subgraph CONSTRUCTION["🟢 CONSTRUCTION PHASE"]
        FD["Functional Design<br/><b>STATUS</b>"]
        NFRA["NFR Requirements<br/><b>STATUS</b>"]
        NFRD["NFR Design<br/><b>STATUS</b>"]
        ID["Infrastructure Design<br/><b>STATUS</b>"]
        CP["Code Planning<br/><b>EXECUTE</b>"]
        CG["Code Generation<br/><b>EXECUTE</b>"]
        BT["Build and Test<br/><b>EXECUTE</b>"]
    end
    
    subgraph OPERATIONS["🟡 OPERATIONS PHASE"]
        OPS["Operations<br/><b>PLACEHOLDER</b>"]
    end
    
    Start --> WD
    WD --> RA
    RA --> WP
    WP --> CP
    CP --> CG
    CG --> BT
    BT --> End(["Complete"])
    
    %% Replace STATUS with COMPLETED, SKIP, EXECUTE as appropriate
    %% Apply styling based on status
\`\`\`

**Note**: Replace STATUS placeholders with actual phase status (COMPLETED/SKIP/EXECUTE) and apply appropriate styling

## Phases to Execute

### 🔵 INCEPTION PHASE
- [x] Workspace Detection (COMPLETED)
- [x] Reverse Engineering (COMPLETED/SKIPPED)
- [x] Requirements Elaboration (COMPLETED)
- [x] User Stories (COMPLETED/SKIPPED)
- [x] Execution Plan (IN PROGRESS)
- [ ] Application Design - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]
- [ ] Units Planning - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]
- [ ] Units Generation - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]

### 🟢 CONSTRUCTION PHASE
- [ ] Functional Design - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]
- [ ] NFR Requirements - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]
- [ ] NFR Design - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]
- [ ] Infrastructure Design - [EXECUTE/SKIP]
  - **Rationale**: [Why executing or skipping]
- [ ] Code Planning - EXECUTE (ALWAYS)
  - **Rationale**: Implementation approach needed
- [ ] Code Generation - EXECUTE (ALWAYS)
  - **Rationale**: Code implementation needed
- [ ] Build and Test - EXECUTE (ALWAYS)
  - **Rationale**: Build, test, and verification needed

### 🟡 OPERATIONS PHASE
- [ ] Operations - PLACEHOLDER
  - **Rationale**: Future deployment and monitoring workflows

## Package Change Sequence (Brownfield Only)
[If applicable, list package update sequence with dependencies]

## Estimated Timeline
- **Total Phases**: [Number]
- **Estimated Duration**: [Time estimate]

## Success Criteria
- **Primary Goal**: [Main objective]
- **Key Deliverables**: [List]
- **Quality Gates**: [List]

[IF brownfield]
- **Integration Testing**: All components working together
- **Operational Readiness**: Monitoring, logging, alerting working
\`\`\`

## Step 8: Initialize State Tracking

Update \`aidlc-docs/aidlc-state.md\`:

\`\`\`markdown
# AI-DLC State Tracking

## Project Information
- **Project Type**: [Greenfield/Brownfield]
- **Start Date**: [ISO timestamp]
- **Current Stage**: INCEPTION - Workflow Planning

## Execution Plan Summary
- **Total Stages**: [Number]
- **Stages to Execute**: [List]
- **Stages to Skip**: [List with reasons]

## Stage Progress

### 🔵 INCEPTION PHASE
- [x] Workspace Detection
- [x] Reverse Engineering (if applicable)
- [x] Requirements Analysis
- [x] User Stories (if applicable)
- [x] Workflow Planning
- [ ] Application Design - [EXECUTE/SKIP]
- [ ] Units Planning - [EXECUTE/SKIP]
- [ ] Units Generation - [EXECUTE/SKIP]

### 🟢 CONSTRUCTION PHASE
- [ ] Functional Design - [EXECUTE/SKIP]
- [ ] NFR Requirements - [EXECUTE/SKIP]
- [ ] NFR Design - [EXECUTE/SKIP]
- [ ] Infrastructure Design - [EXECUTE/SKIP]
- [ ] Code Planning - EXECUTE
- [ ] Code Generation - EXECUTE
- [ ] Build and Test - EXECUTE

### 🟡 OPERATIONS PHASE
- [ ] Operations - PLACEHOLDER

## Current Status
- **Lifecycle Phase**: INCEPTION
- **Current Stage**: Workflow Planning Complete
- **Next Stage**: [Next stage to execute]
- **Status**: Ready to proceed
\`\`\`

## Step 9: Present Plan to User

\`\`\`markdown
# 📋 Workflow Planning Complete

I've created a comprehensive execution plan based on:
- Your request: [Summary]
- Existing system: [Summary if brownfield]
- Requirements: [Summary if executed]
- User stories: [Summary if executed]

**Detailed Analysis**:
- Risk level: [Level]
- Impact: [Summary of key impacts]
- Components affected: [List]

**Recommended Execution Plan**:

I recommend executing [X] stages:

🔵 **INCEPTION PHASE:**
1. [Stage name] - *Rationale:* [Why executing]
2. [Stage name] - *Rationale:* [Why executing]
...

🟢 **CONSTRUCTION PHASE:**
3. [Stage name] - *Rationale:* [Why executing]
4. [Stage name] - *Rationale:* [Why executing]
...

I recommend skipping [Y] stages:

🔵 **INCEPTION PHASE:**
1. [Stage name] - *Rationale:* [Why skipping]
2. [Stage name] - *Rationale:* [Why skipping]
...

🟢 **CONSTRUCTION PHASE:**
3. [Stage name] - *Rationale:* [Why skipping]
4. [Stage name] - *Rationale:* [Why skipping]
...

[IF brownfield with multiple packages]
**Recommended Package Update Sequence**:
1. [Package] - [Reason]
2. [Package] - [Reason]
...

**Estimated Timeline**: [Duration]

> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the execution plan at: \`aidlc-docs/inception/plans/execution-plan.md\`

> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the execution plan if required
> [IF any stages are skipped:]
> 📝 **Add Skipped Stages** - Choose to include stages currently marked as SKIP
> ✅ **Approve & Continue** - Approve plan and proceed to **[Next Stage Name]**
\`\`\`

## Step 10: Handle User Response

- **If approved**: Proceed to next stage in execution plan
- **If changes requested**: Update execution plan and re-confirm
- **If user wants to force include/exclude stages**: Update plan accordingly

## Step 11: Log Interaction

Log in \`aidlc-docs/audit.md\`:

\`\`\`markdown
## Workflow Planning - Approval
**Timestamp**: [ISO timestamp]
**AI Prompt**: "Ready to proceed with this plan?"
**User Response**: "[User's COMPLETE RAW response]"
**Status**: [Approved/Changes Requested]
**Context**: Workflow plan created with [X] stages to execute

---
\`\`\`


# ================================================================
# Rule: application-design
# Source:inception/application-design.md
# ================================================================

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
- Read \`aidlc-docs/inception/requirements/requirements.md\` and \`aidlc-docs/inception/user-stories/stories.md\`
- Identify key business capabilities and functional areas
- Determine design scope and complexity

### 2. Create Application Design Plan
- Generate plan with checkboxes [] for application design
- Focus on components, responsibilities, methods, business rules, and services
- Each step and sub-step should have a checkbox []

### 3. Include Mandatory Design Artifacts in Plan
- **ALWAYS** include these mandatory artifacts in the design plan:
  - [ ] Generate components.md with component definitions and high-level responsibilities
  - [ ] Generate component-methods.md with method signatures (business rules detailed later in Functional Design)
  - [ ] Generate services.md with service definitions and orchestration patterns
  - [ ] Generate component-dependency.md with dependency relationships and communication patterns
  - [ ] Validate design completeness and consistency

### 4. Generate Context-Appropriate Questions
**DIRECTIVE**: Analyze the requirements and stories to generate ONLY questions relevant to THIS specific application design. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- EMBED questions using [Answer]: tag format
- Focus on ambiguities and missing information specific to this context
- Generate questions only where user input is needed for design decisions

**Example question categories** (adapt as needed):
- **Component Identification** - Only if component boundaries or organization is unclear
- **Component Methods** - Only if method signatures need clarification (detailed business rules come later)
- **Service Layer Design** - Only if service orchestration or boundaries are ambiguous
- **Component Dependencies** - Only if communication patterns or dependency management is unclear
- **Design Patterns** - Only if architectural style or pattern choice needs user input

### 5. Store Application Design Plan
- Save as \`aidlc-docs/inception/plans/application-design-plan.md\`
- Include all [Answer]: tags for user input
- Ensure plan covers all design aspects

### 6. Request User Input
- Ask user to fill [Answer]: tags directly in the plan document
- Emphasize importance of design decisions
- Provide clear instructions on completing the [Answer]: tags

### 7. Collect Answers
- Wait for user to provide answers to all questions using [Answer]: tags in the document
- Do not proceed until ALL [Answer]: tags are completed
- Review the document to ensure no [Answer]: tags are left blank

### 8. ANALYZE ANSWERS (MANDATORY)
Before proceeding, you MUST carefully review all user answers for:
- **Vague or ambiguous responses**: "mix of", "somewhere between", "not sure", "depends"
- **Undefined criteria or terms**: References to concepts without clear definitions
- **Contradictory answers**: Responses that conflict with each other
- **Missing design details**: Answers that lack specific guidance
- **Answers that combine options**: Responses that merge different approaches without clear decision rules

### 9. MANDATORY Follow-up Questions
If the analysis in step 8 reveals ANY ambiguous answers, you MUST:
- Add specific follow-up questions to the plan document using [Answer]: tags
- DO NOT proceed to approval until all ambiguities are resolved
- Examples of required follow-ups:
  - "You mentioned 'mix of A and B' - what specific criteria should determine when to use A vs B?"
  - "You said 'somewhere between A and B' - can you define the exact middle ground approach?"
  - "You indicated 'not sure' - what additional information would help you decide?"
  - "You mentioned 'depends on complexity' - how do you define complexity levels?"

### 10. Generate Application Design Artifacts
- Execute the approved plan to generate design artifacts
- Create \`aidlc-docs/inception/application-design/components.md\` with:
  - Component name and purpose
  - Component responsibilities
  - Component interfaces
- Create \`aidlc-docs/inception/application-design/component-methods.md\` with:
  - Method signatures for each component
  - High-level purpose of each method
  - Input/output types
  - Note: Detailed business rules will be defined in Functional Design (per-unit, CONSTRUCTION phase)
- Create \`aidlc-docs/inception/application-design/services.md\` with:
  - Service definitions
  - Service responsibilities
  - Service interactions and orchestration
- Create \`aidlc-docs/inception/application-design/component-dependency.md\` with:
  - Dependency matrix showing relationships
  - Communication patterns between components
  - Data flow diagrams

### 11. Log Approval
- Log approval prompt with timestamp in \`aidlc-docs/audit.md\`
- Include complete approval prompt text
- Use ISO 8601 timestamp format

### 12. Present Completion Message

\`\`\`markdown
# 🏗️ Application Design Complete

[AI-generated summary of application design artifacts created in bullet points]

> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the application design artifacts at: \`aidlc-docs/inception/application-design/\`

> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the application design if required
> [IF Units Generation is skipped:]
> 📝 **Add Units Generation** - Choose to include **Units Generation** stage (currently skipped)
> ✅ **Approve & Continue** - Approve design and proceed to **[Units Generation/CONSTRUCTION PHASE]**
\`\`\`

### 13. Wait for Explicit Approval
- Do not proceed until the user explicitly approves the application design
- Approval must be clear and unambiguous
- If user requests changes, update the design and repeat the approval process

### 14. Record Approval Response
- Log the user's approval response with timestamp in \`aidlc-docs/audit.md\`
- Include the exact user response text
- Mark the approval status clearly

### 15. Update Progress
- Mark Application Design stage complete in \`aidlc-docs/aidlc-state.md\`
- Update the "Current Status" section
- Prepare for transition to next stage


# ================================================================
# Rule: units-generation
# Source:inception/units-generation.md
# ================================================================

# Units Generation - Detailed Steps

## Overview
This stage decomposes the system into manageable units of work through two integrated parts:
- **Part 1 - Planning**: Create decomposition plan with questions, collect answers, analyze for ambiguities, get approval
- **Part 2 - Generation**: Execute approved plan to generate unit artifacts

**DEFINITION**: A unit of work is a logical grouping of stories for development purposes. For microservices, each unit becomes an independently deployable service. For monoliths, the single unit represents the entire application with logical modules.

**Terminology**: Use "Service" for independently deployable components, "Module" for logical groupings within a service, "Unit of Work" for planning context.

## Prerequisites
- Context Assessment must be complete
- Requirements Assessment recommended (provides functional scope)
- Story Development recommended (stories map to units)
- Application Design phase REQUIRED (determines components, methods, and services)
- Execution plan must indicate Design phase should execute

---

# PART 1: PLANNING

## Step 1: Create Unit of Work Plan
- Generate plan with checkboxes [] for decomposing system into units of work
- Focus on breaking down the system into manageable development units
- Each step and sub-step should have a checkbox []

## Step 2: Include Mandatory Unit Artifacts in Plan
**ALWAYS** include these mandatory artifacts in the unit plan:
- [ ] Generate \`aidlc-docs/inception/application-design/unit-of-work.md\` with unit definitions and responsibilities
- [ ] Generate \`aidlc-docs/inception/application-design/unit-of-work-dependency.md\` with dependency matrix
- [ ] Generate \`aidlc-docs/inception/application-design/unit-of-work-story-map.md\` mapping stories to units
- [ ] **Greenfield only**: Document code organization strategy in \`unit-of-work.md\` (see code-generation.md for structure patterns)
- [ ] Validate unit boundaries and dependencies
- [ ] Ensure all stories are assigned to units

## Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Analyze the requirements, stories, and application design to generate ONLY questions relevant to THIS specific decomposition problem. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- EMBED questions using [Answer]: tag format
- Focus on ambiguities and missing information specific to this context
- Generate questions only where user input is needed for decision-making

**Example question categories** (adapt as needed):
- **Story Grouping** - Only if multiple stories exist and grouping strategy is unclear
- **Dependencies** - Only if multiple units likely and integration approach is ambiguous
- **Team Alignment** - Only if team structure or ownership is unclear
- **Technical Considerations** - Only if scalability/deployment requirements differ across units
- **Business Domain** - Only if domain boundaries or bounded contexts are unclear
- **Code Organization (Greenfield multi-unit only)** - Ask deployment model and directory structure preferences

## Step 4: Store UOW Plan
- Save as \`aidlc-docs/inception/plans/unit-of-work-plan.md\`
- Include all [Answer]: tags for user input
- Ensure plan covers all aspects of system decomposition

## Step 5: Request User Input
- Ask user to fill [Answer]: tags directly in the plan document
- Emphasize importance of decomposition decisions
- Provide clear instructions on completing the [Answer]: tags

## Step 6: Collect Answers
- Wait for user to provide answers to all questions using [Answer]: tags in the document
- Do not proceed until ALL [Answer]: tags are completed
- Review the document to ensure no [Answer]: tags are left blank

## Step 7: ANALYZE ANSWERS (MANDATORY)
Before proceeding, you MUST carefully review all user answers for:
- **Vague or ambiguous responses**: "mix of", "somewhere between", "not sure", "depends"
- **Undefined criteria or terms**: References to concepts without clear definitions
- **Contradictory answers**: Responses that conflict with each other
- **Missing generation details**: Answers that lack specific guidance
- **Answers that combine options**: Responses that merge different approaches without clear decision rules

## Step 8: MANDATORY Follow-up Questions
If the analysis in step 7 reveals ANY ambiguous answers, you MUST:
- Add specific follow-up questions to the plan document using [Answer]: tags
- DO NOT proceed to approval until all ambiguities are resolved
- Examples of required follow-ups:
  - "You mentioned 'mix of A and B' - what specific criteria should determine when to use A vs B?"
  - "You said 'somewhere between A and B' - can you define the exact middle ground approach?"
  - "You indicated 'not sure' - what additional information would help you decide?"
  - "You mentioned 'depends on complexity' - how do you define complexity levels?"

## Step 9: Request Approval
- Ask: "**Unit of work plan complete. Review the plan in aidlc-docs/inception/plans/unit-of-work-plan.md. Ready to proceed to generation?**"
- DO NOT PROCEED until user confirms

## Step 10: Log Approval
- Log prompt and response in audit.md with timestamp
- Use ISO 8601 timestamp format
- Include complete approval prompt text

## Step 11: Update Progress
- Mark Units Planning complete in aidlc-state.md
- Update the "Current Status" section
- Prepare for transition to Units Generation

---

# PART 2: GENERATION

## Step 12: Load Unit of Work Plan
- [ ] Read the complete plan from \`aidlc-docs/inception/plans/unit-of-work-plan.md\`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context and requirements for that step

## Step 13: Execute Current Step
- [ ] Perform exactly what the current step describes
- [ ] Generate unit artifacts as specified in the plan
- [ ] Follow the approved decomposition approach from Planning
- [ ] Use the criteria and boundaries specified in the plan

## Step 14: Update Progress
- [ ] Mark the completed step as [x] in the unit of work plan
- [ ] Update \`aidlc-docs/aidlc-state.md\` current status
- [ ] Save all generated artifacts

## Step 15: Continue or Complete
- [ ] If more steps remain, return to Step 12
- [ ] If all steps complete, verify units are ready for design stages
- [ ] Mark Units Generation stage as complete

## Step 16: Present Completion Message

\`\`\`markdown
# 🔧 Units Generation Complete

[AI-generated summary of units and decomposition created in bullet points]

> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the units generation artifacts at: \`aidlc-docs/inception/application-design/\`

> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the units generation if required
> ✅ **Approve & Continue** - Approve units and proceed to **CONSTRUCTION PHASE**
\`\`\`

## Step 17: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the units generation
- Approval must be clear and unambiguous
- If user requests changes, update the units and repeat the approval process

## Step 18: Record Approval Response
- Log the user's approval response with timestamp in \`aidlc-docs/audit.md\`
- Include the exact user response text
- Mark the approval status clearly

## Step 19: Update Progress
- Mark Units Generation stage complete in \`aidlc-docs/aidlc-state.md\`
- Update the "Current Status" section
- Prepare for transition to CONSTRUCTION PHASE

---

## Critical Rules

### Planning Phase Rules
- Generate ONLY context-relevant questions
- Use [Answer]: tag format for all questions
- Analyze all answers for ambiguities before proceeding
- Resolve ALL ambiguities with follow-up questions
- Get explicit user approval before generation

### Generation Phase Rules
- **NO HARDCODED LOGIC**: Only execute what's written in the unit of work plan
- **FOLLOW PLAN EXACTLY**: Do not deviate from the step sequence
- **UPDATE CHECKBOXES**: Mark [x] immediately after completing each step
- **USE APPROVED APPROACH**: Follow the decomposition methodology from Planning
- **VERIFY COMPLETION**: Ensure all unit artifacts are complete before proceeding

## Completion Criteria
- All planning questions answered and ambiguities resolved
- User approval obtained for the plan
- All steps in unit of work plan marked [x]
- All unit artifacts generated according to plan:
  - \`unit-of-work.md\` with unit definitions
  - \`unit-of-work-dependency.md\` with dependency matrix
  - \`unit-of-work-story-map.md\` with story mappings
- Units verified and ready for per-unit design stages`;

export const CONSTRUCTION_RULES: string = `# ================================================================
# Rule: functional-design
# Source:construction/functional-design.md
# ================================================================

# Functional Design

## Purpose
**Detailed business logic design per unit**

Functional Design focuses on:
- Detailed business logic and algorithms for the unit
- Domain models with entities and relationships
- Detailed business rules, validation logic, and constraints
- Technology-agnostic design (no infrastructure concerns)

**Note**: This builds upon high-level component design from Application Design (INCEPTION phase)

## Prerequisites
- Units Generation must be complete
- Unit of work artifacts must be available
- Application Design recommended (provides high-level component structure)
- Execution plan must indicate Functional Design stage should execute

## Overview
Design detailed business logic for the unit, technology-agnostic and focused purely on business functions.

## Steps to Execute

### Step 1: Analyze Unit Context
- Read unit definition from \`aidlc-docs/inception/application-design/unit-of-work.md\`
- Read assigned stories from \`aidlc-docs/inception/application-design/unit-of-work-story-map.md\`
- Understand unit responsibilities and boundaries

### Step 2: Create Functional Design Plan
- Generate plan with checkboxes [] for functional design
- Focus on business logic, domain models, business rules
- Each step should have a checkbox []

### Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Thoroughly analyze the unit definition and functional design artifacts to identify ALL areas where clarification would improve the functional design. Be proactive in asking questions to ensure comprehensive understanding.

**CRITICAL**: Default to asking questions when there is ANY ambiguity or missing detail that could affect functional design quality. It's better to ask too many questions than to make incorrect assumptions.

- EMBED questions using [Answer]: tag format
- Focus on ANY ambiguities, missing information, or areas needing clarification
- Generate questions wherever user input would improve functional design decisions
- **When in doubt, ask the question** - overconfidence leads to poor designs

**Question categories to consider** (evaluate ALL categories):
- **Business Logic Modeling** - Ask about core entities, workflows, data transformations, and business processes
- **Domain Model** - Ask about domain concepts, entity relationships, data structures, and business objects
- **Business Rules** - Ask about decision rules, validation logic, constraints, and business policies
- **Data Flow** - Ask about data inputs, outputs, transformations, and persistence requirements
- **Integration Points** - Ask about external system interactions, APIs, and data exchange
- **Error Handling** - Ask about error scenarios, validation failures, and exception handling
- **Business Scenarios** - Ask about edge cases, alternative flows, and complex business situations
- **Frontend Components** (if applicable) - Ask about UI component structure, user interactions, state management, and form handling

### Step 4: Store Plan
- Save as \`aidlc-docs/construction/plans/{unit-name}-functional-design-plan.md\`
- Include all [Answer]: tags for user input

### Step 5: Collect and Analyze Answers
- Wait for user to complete all [Answer]: tags
- **MANDATORY**: Carefully review ALL responses for vague or ambiguous answers
- **CRITICAL**: Add follow-up questions for ANY unclear responses - do not proceed with ambiguity
- Look for responses like "depends", "maybe", "not sure", "mix of", "somewhere between"
- Create clarification questions file if ANY ambiguities are detected
- **Do not proceed until ALL ambiguities are resolved**

### Step 6: Generate Functional Design Artifacts
- Create \`aidlc-docs/construction/{unit-name}/functional-design/business-logic-model.md\`
- Create \`aidlc-docs/construction/{unit-name}/functional-design/business-rules.md\`
- Create \`aidlc-docs/construction/{unit-name}/functional-design/domain-entities.md\`
- If unit includes frontend/UI: Create \`aidlc-docs/construction/{unit-name}/functional-design/frontend-components.md\`
  - Component hierarchy and structure
  - Props and state definitions for each component
  - User interaction flows
  - Form validation rules
  - API integration points (which backend endpoints each component uses)

### Step 7: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 🔧 Functional Design Complete - [unit-name]
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary of functional design
        - Format: "Functional design has created [description]:"
        - List key business logic models and entities (bullet points)
        - List business rules and validation logic defined
        - Mention domain model structure and relationships
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the functional design artifacts at: \`aidlc-docs/construction/[unit-name]/functional-design/\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the functional design based on your review  
> ✅ **Continue to Next Stage** - Approve functional design and proceed to **[next-stage-name]**

---
\`\`\`

### Step 8: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the functional design
- Approval must be clear and unambiguous
- If user requests changes, update the design and repeat the approval process

### Step 9: Record Approval and Update Progress
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- Mark Functional Design stage complete in aidlc-state.md


# ================================================================
# Rule: nfr-requirements
# Source:construction/nfr-requirements.md
# ================================================================

# NFR Requirements

## Prerequisites
- Functional Design must be complete for the unit
- Unit functional design artifacts must be available
- Execution plan must indicate NFR Requirements stage should execute

## Overview
Determine non-functional requirements for the unit and make tech stack choices.

## Steps to Execute

### Step 1: Analyze Functional Design
- Read functional design artifacts from \`aidlc-docs/construction/{unit-name}/functional-design/\`
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
- Save as \`aidlc-docs/construction/plans/{unit-name}-nfr-requirements-plan.md\`
- Include all [Answer]: tags for user input

### Step 5: Collect and Analyze Answers
- Wait for user to complete all [Answer]: tags
- **MANDATORY**: Carefully review ALL responses for vague or ambiguous answers
- **CRITICAL**: Add follow-up questions for ANY unclear responses - do not proceed with ambiguity
- Look for responses like "depends", "maybe", "not sure", "mix of", "somewhere between", "standard", "typical"
- Create clarification questions file if ANY ambiguities are detected
- **Do not proceed until ALL ambiguities are resolved**

### Step 6: Generate NFR Requirements Artifacts
- Create \`aidlc-docs/construction/{unit-name}/nfr-requirements/nfr-requirements.md\`
- Create \`aidlc-docs/construction/{unit-name}/nfr-requirements/tech-stack-decisions.md\`

### Step 7: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 📊 NFR Requirements Complete - [unit-name]
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary of NFR requirements
        - Format: "NFR requirements assessment has identified [description]:"
        - List key scalability, performance, availability requirements (bullet points)
        - List security and compliance requirements identified
        - Mention tech stack decisions and rationale
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the NFR requirements at: \`aidlc-docs/construction/[unit-name]/nfr-requirements/\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the NFR requirements based on your review  
> ✅ **Continue to Next Stage** - Approve NFR requirements and proceed to **[next-stage-name]**

---
\`\`\`

### Step 8: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the NFR requirements
- Approval must be clear and unambiguous
- If user requests changes, update the requirements and repeat the approval process

### Step 9: Record Approval and Update Progress
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- Mark NFR Requirements stage complete in aidlc-state.md


# ================================================================
# Rule: nfr-design
# Source:construction/nfr-design.md
# ================================================================

# NFR Design

## Prerequisites
- NFR Requirements must be complete for the unit
- NFR requirements artifacts must be available
- Execution plan must indicate NFR Design stage should execute

## Overview
Incorporate NFR requirements into unit design using patterns and logical components.

## Steps to Execute

### Step 1: Analyze NFR Requirements
- Read NFR requirements from \`aidlc-docs/construction/{unit-name}/nfr-requirements/\`
- Understand scalability, performance, availability, security needs

### Step 2: Create NFR Design Plan
- Generate plan with checkboxes [] for NFR design
- Focus on design patterns and logical components
- Each step should have a checkbox []

### Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Analyze the NFR requirements to generate ONLY questions relevant to THIS specific unit's NFR design. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- EMBED questions using [Answer]: tag format
- Focus on ambiguities and missing information specific to this unit
- Generate questions only where user input is needed for pattern and component decisions

**Example question categories** (adapt as needed):
- **Resilience Patterns** - Only if fault tolerance approach needs clarification
- **Scalability Patterns** - Only if scaling mechanisms are unclear
- **Performance Patterns** - Only if performance optimization strategy is ambiguous
- **Security Patterns** - Only if security implementation approach needs input
- **Logical Components** - Only if infrastructure components (queues, caches, etc.) need clarification

### Step 4: Store Plan
- Save as \`aidlc-docs/construction/plans/{unit-name}-nfr-design-plan.md\`
- Include all [Answer]: tags for user input

### Step 5: Collect and Analyze Answers
- Wait for user to complete all [Answer]: tags
- Review for vague or ambiguous responses
- Add follow-up questions if needed

### Step 6: Generate NFR Design Artifacts
- Create \`aidlc-docs/construction/{unit-name}/nfr-design/nfr-design-patterns.md\`
- Create \`aidlc-docs/construction/{unit-name}/nfr-design/logical-components.md\`

### Step 7: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 🎨 NFR Design Complete - [unit-name]
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary of NFR design
        - Format: "NFR design has incorporated [description]:"
        - List key design patterns implemented (bullet points)
        - List logical components and infrastructure elements
        - Mention resilience, scalability, and performance patterns applied
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the NFR design at: \`aidlc-docs/construction/[unit-name]/nfr-design/\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the NFR design based on your review  
> ✅ **Continue to Next Stage** - Approve NFR design and proceed to **[next-stage-name]**

---
\`\`\`

### Step 8: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the NFR design
- Approval must be clear and unambiguous
- If user requests changes, update the design and repeat the approval process

### Step 9: Record Approval and Update Progress
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- Mark NFR Design stage complete in aidlc-state.md


# ================================================================
# Rule: infrastructure-design
# Source:construction/infrastructure-design.md
# ================================================================

# Infrastructure Design

## Prerequisites
- Functional Design must be complete for the unit
- NFR Design recommended (provides logical components to map)
- Execution plan must indicate Infrastructure Design stage should execute

## Overview
Map logical software components to actual infrastructure choices for deployment environments.

## Steps to Execute

### Step 1: Analyze Design Artifacts
- Read functional design from \`aidlc-docs/construction/{unit-name}/functional-design/\`
- Read NFR design from \`aidlc-docs/construction/{unit-name}/nfr-design/\` (if exists)
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
- Save as \`aidlc-docs/construction/plans/{unit-name}-infrastructure-design-plan.md\`
- Include all [Answer]: tags for user input

### Step 5: Collect and Analyze Answers
- Wait for user to complete all [Answer]: tags
- Review for vague or ambiguous responses
- Add follow-up questions if needed

### Step 6: Generate Infrastructure Design Artifacts
- Create \`aidlc-docs/construction/{unit-name}/infrastructure-design/infrastructure-design.md\`
- Create \`aidlc-docs/construction/{unit-name}/infrastructure-design/deployment-architecture.md\`
- If shared infrastructure: Create \`aidlc-docs/construction/shared-infrastructure.md\`

### Step 7: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 🏢 Infrastructure Design Complete - [unit-name]
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary of infrastructure design
        - Format: "Infrastructure design has mapped [description]:"
        - List key infrastructure services and components (bullet points)
        - List deployment architecture decisions and rationale
        - Mention cloud provider choices and service mappings
        - DO NOT include workflow instructions ("please review", "let me know", "proceed to next phase", "before we proceed")
        - Keep factual and content-focused
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the infrastructure design at: \`aidlc-docs/construction/[unit-name]/infrastructure-design/\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the infrastructure design based on your review  
> ✅ **Continue to Next Stage** - Approve infrastructure design and proceed to **Code Generation**

---
\`\`\`

### Step 8: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the infrastructure design
- Approval must be clear and unambiguous
- If user requests changes, update the design and repeat the approval process

### Step 9: Record Approval and Update Progress
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- Mark Infrastructure Design stage complete in aidlc-state.md


# ================================================================
# Rule: code-generation
# Source:construction/code-generation.md
# ================================================================

# Code Generation - Detailed Steps

## Overview
This stage generates code for each unit of work through two integrated parts:
- **Part 1 - Planning**: Create detailed code generation plan with explicit steps
- **Part 2 - Generation**: Execute approved plan to generate code, tests, and artifacts

**Note**: For brownfield projects, "generate" means modify existing files when appropriate, not create duplicates.

## Prerequisites
- Unit Design Generation must be complete for the unit
- NFR Implementation (if executed) must be complete for the unit
- All unit design artifacts must be available
- Unit is ready for code generation

---

# PART 1: PLANNING

## Step 1: Analyze Unit Context
- [ ] Read unit design artifacts from Unit Design Generation
- [ ] Read unit story map to understand assigned stories
- [ ] Identify unit dependencies and interfaces
- [ ] Validate unit is ready for code generation

## Step 2: Create Detailed Unit Code Generation Plan
- [ ] Read workspace root and project type from \`aidlc-docs/aidlc-state.md\`
- [ ] Determine code location (see Critical Rules for structure patterns)
- [ ] **Brownfield only**: Review reverse engineering code-structure.md for existing files to modify
- [ ] Document exact paths (never aidlc-docs/)
- [ ] Create explicit steps for unit generation:
  - Project Structure Setup (greenfield only)
  - Business Logic Generation
  - Business Logic Unit Testing
  - Business Logic Summary
  - API Layer Generation
  - API Layer Unit Testing
  - API Layer Summary
  - Repository Layer Generation
  - Repository Layer Unit Testing
  - Repository Layer Summary
  - Frontend Components Generation (if applicable)
  - Frontend Components Unit Testing (if applicable)
  - Frontend Components Summary (if applicable)
  - Database Migration Scripts (if data models exist)
  - Documentation Generation (API docs, README updates)
  - Deployment Artifacts Generation
- [ ] Number each step sequentially
- [ ] Include story mapping references
- [ ] Add checkboxes [ ] for each step

## Step 3: Include Unit Generation Context
- [ ] For this unit, include:
  - Stories implemented by this unit
  - Dependencies on other units/services
  - Expected interfaces and contracts
  - Database entities owned by this unit
  - Service boundaries and responsibilities

## Step 4: Create Unit Plan Document
- [ ] Save complete plan as \`aidlc-docs/construction/plans/{unit-name}-code-generation-plan.md\`
- [ ] Include step numbering (Step 1, Step 2, etc.)
- [ ] Include unit context and dependencies
- [ ] Include story traceability
- [ ] Ensure plan is executable step-by-step
- [ ] Emphasize that this plan is the single source of truth for Code Generation

## Step 5: Summarize Unit Plan
- [ ] Provide summary of the unit code generation plan to the user
- [ ] Highlight unit generation approach
- [ ] Explain step sequence and story coverage
- [ ] Note total number of steps and estimated scope

## Step 6: Log Approval Prompt
- [ ] Before asking for approval, log the prompt with timestamp in \`aidlc-docs/audit.md\`
- [ ] Include reference to the complete unit code generation plan
- [ ] Use ISO 8601 timestamp format

## Step 7: Wait for Explicit Approval
- [ ] Do not proceed until the user explicitly approves the unit code generation plan
- [ ] Approval must cover the entire plan and generation sequence
- [ ] If user requests changes, update the plan and repeat approval process

## Step 8: Record Approval Response
- [ ] Log the user's approval response with timestamp in \`aidlc-docs/audit.md\`
- [ ] Include the exact user response text
- [ ] Mark the approval status clearly

## Step 9: Update Progress
- [ ] Mark Code Planning complete in \`aidlc-state.md\`
- [ ] Update the "Current Status" section
- [ ] Prepare for transition to Code Generation

---

# PART 2: GENERATION

## Step 10: Load Unit Code Generation Plan
- [ ] Read the complete plan from \`aidlc-docs/construction/plans/{unit-name}-code-generation-plan.md\`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context for that step (unit, dependencies, stories)

## Step 11: Execute Current Step
- [ ] Verify target directory from plan (never aidlc-docs/)
- [ ] **Brownfield only**: Check if target file exists
- [ ] Generate exactly what the current step describes:
  - **If file exists**: Modify it in-place (never create \`ClassName_modified.java\`, \`ClassName_new.java\`, etc.)
  - **If file doesn't exist**: Create new file
- [ ] Write to correct locations:
  - **Application Code**: Workspace root per project structure
  - **Documentation**: \`aidlc-docs/construction/{unit-name}/code/\` (markdown only)
  - **Build/Config Files**: Workspace root
- [ ] Follow unit story requirements
- [ ] Respect dependencies and interfaces

## Step 12: Update Progress
- [ ] Mark the completed step as [x] in the unit code generation plan
- [ ] Mark associated unit stories as [x] when their generation is finished
- [ ] Update \`aidlc-docs/aidlc-state.md\` current status
- [ ] **Brownfield only**: Verify no duplicate files created (e.g., no \`ClassName_modified.java\` alongside \`ClassName.java\`)
- [ ] Save all generated artifacts

## Step 13: Continue or Complete Generation
- [ ] If more steps remain, return to Step 10
- [ ] If all steps complete, proceed to present completion message

## Step 14: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

\`\`\`markdown
# 💻 Code Generation Complete - [unit-name]
\`\`\`

     2. **AI Summary** (optional): Provide structured bullet-point summary
        - **Brownfield**: Distinguish modified vs created files (e.g., "• Modified: \`src/services/user-service.ts\`", "• Created: \`src/services/auth-service.ts\`")
        - **Greenfield**: List created files with paths (e.g., "• Created: \`src/services/user-service.ts\`")
        - List tests, documentation, deployment artifacts with paths
        - Keep factual, no workflow instructions
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

\`\`\`markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the generated code at:
> - **Application Code**: \`[actual-workspace-path]\`
> - **Documentation**: \`aidlc-docs/construction/[unit-name]/code/\`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the generated code based on your review  
> ✅ **Continue to Next Stage** - Approve code generation and proceed to **[next-unit/Build & Test]**

---
\`\`\`

## Step 15: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the generated code
- Approval must be clear and unambiguous
- If user requests changes, update the code and repeat the approval process

## Step 16: Record Approval and Update Progress
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- Mark Code Generation stage as complete for this unit in aidlc-state.md

---

## Critical Rules

### Code Location Rules
- **Application code**: Workspace root only (NEVER aidlc-docs/)
- **Documentation**: aidlc-docs/ only (markdown summaries)
- **Read workspace root** from aidlc-state.md before generating code

**Structure patterns by project type**:
- **Brownfield**: Use existing structure (e.g., \`src/main/java/\`, \`lib/\`, \`pkg/\`)
- **Greenfield single unit**: \`src/\`, \`tests/\`, \`config/\` in workspace root
- **Greenfield multi-unit (microservices)**: \`{unit-name}/src/\`, \`{unit-name}/tests/\`
- **Greenfield multi-unit (monolith)**: \`src/{unit-name}/\`, \`tests/{unit-name}/\`

### Brownfield File Modification Rules
- Check if file exists before generating
- If exists: Modify in-place (never create copies like \`ClassName_modified.java\`)
- If doesn't exist: Create new file
- Verify no duplicate files after generation (Step 12)

### Planning Phase Rules
- Create explicit, numbered steps for all generation activities
- Include story traceability in the plan
- Document unit context and dependencies
- Get explicit user approval before generation

### Generation Phase Rules
- **NO HARDCODED LOGIC**: Only execute what's written in the unit plan
- **FOLLOW PLAN EXACTLY**: Do not deviate from the step sequence
- **UPDATE CHECKBOXES**: Mark [x] immediately after completing each step
- **STORY TRACEABILITY**: Mark unit stories [x] when functionality is implemented
- **RESPECT DEPENDENCIES**: Only implement when unit dependencies are satisfied

### Automation Friendly Code Rules
When generating UI code (web, mobile, desktop), ensure elements are automation-friendly:
- Add \`data-testid\` attributes to interactive elements (buttons, inputs, links, forms)
- Use consistent naming: \`{component}-{element-role}\` (e.g., \`login-form-submit-button\`, \`user-list-search-input\`)
- Avoid dynamic or auto-generated IDs that change between renders
- Keep \`data-testid\` values stable across code changes (only change when element purpose changes)

## Completion Criteria
- Complete unit code generation plan created and approved
- All steps in unit code generation plan marked [x]
- All unit stories implemented according to plan
- All code and tests generated (tests will be executed in Build & Test phase)
- Deployment artifacts generated
- Complete unit ready for build and verification


# ================================================================
# Rule: build-and-test
# Source:construction/build-and-test.md
# ================================================================

# Build and Test

**Purpose**: Build all units and execute comprehensive testing strategy

## Prerequisites
- Code Generation must be complete for all units
- All code artifacts must be generated
- Project is ready for build and testing

---

## Step 1: Analyze Testing Requirements

Analyze the project to determine appropriate testing strategy:
- **Unit tests**: Already generated per unit during code generation
- **Integration tests**: Test interactions between units/services
- **Performance tests**: Load, stress, and scalability testing
- **End-to-end tests**: Complete user workflows
- **Contract tests**: API contract validation between services
- **Security tests**: Vulnerability scanning, penetration testing

---

## Step 2: Generate Build Instructions

Create \`aidlc-docs/construction/build-and-test/build-instructions.md\`:

\`\`\`markdown
# Build Instructions

## Prerequisites
- **Build Tool**: [Tool name and version]
- **Dependencies**: [List all required dependencies]
- **Environment Variables**: [List required env vars]
- **System Requirements**: [OS, memory, disk space]

## Build Steps

### 1. Install Dependencies
\\\`\\\`\\\`bash
[Command to install dependencies]
# Example: npm install, mvn dependency:resolve, pip install -r requirements.txt
\\\`\\\`\\\`

### 2. Configure Environment
\\\`\\\`\\\`bash
[Commands to set up environment]
# Example: export variables, configure credentials
\\\`\\\`\\\`

### 3. Build All Units
\\\`\\\`\\\`bash
[Command to build all units]
# Example: mvn clean install, npm run build, brazil-build
\\\`\\\`\\\`

### 4. Verify Build Success
- **Expected Output**: [Describe successful build output]
- **Build Artifacts**: [List generated artifacts and locations]
- **Common Warnings**: [Note any acceptable warnings]

## Troubleshooting

### Build Fails with Dependency Errors
- **Cause**: [Common causes]
- **Solution**: [Step-by-step fix]

### Build Fails with Compilation Errors
- **Cause**: [Common causes]
- **Solution**: [Step-by-step fix]
\`\`\`

---

## Step 3: Generate Unit Test Execution Instructions

Create \`aidlc-docs/construction/build-and-test/unit-test-instructions.md\`:

\`\`\`markdown
# Unit Test Execution

## Run Unit Tests

### 1. Execute All Unit Tests
\\\`\\\`\\\`bash
[Command to run all unit tests]
# Example: mvn test, npm test, pytest tests/unit
\\\`\\\`\\\`

### 2. Review Test Results
- **Expected**: [X] tests pass, 0 failures
- **Test Coverage**: [Expected coverage percentage]
- **Test Report Location**: [Path to test reports]

### 3. Fix Failing Tests
If tests fail:
1. Review test output in [location]
2. Identify failing test cases
3. Fix code issues
4. Rerun tests until all pass
\`\`\`

---

## Step 4: Generate Integration Test Instructions

Create \`aidlc-docs/construction/build-and-test/integration-test-instructions.md\`:

\`\`\`markdown
# Integration Test Instructions

## Purpose
Test interactions between units/services to ensure they work together correctly.

## Test Scenarios

### Scenario 1: [Unit A] → [Unit B] Integration
- **Description**: [What is being tested]
- **Setup**: [Required test environment setup]
- **Test Steps**: [Step-by-step test execution]
- **Expected Results**: [What should happen]
- **Cleanup**: [How to clean up after test]

### Scenario 2: [Unit B] → [Unit C] Integration
[Similar structure]

## Setup Integration Test Environment

### 1. Start Required Services
\\\`\\\`\\\`bash
[Commands to start services]
# Example: docker-compose up, start test database
\\\`\\\`\\\`

### 2. Configure Service Endpoints
\\\`\\\`\\\`bash
[Commands to configure endpoints]
# Example: export API_URL=http://localhost:8080
\\\`\\\`\\\`

## Run Integration Tests

### 1. Execute Integration Test Suite
\\\`\\\`\\\`bash
[Command to run integration tests]
# Example: mvn integration-test, npm run test:integration
\\\`\\\`\\\`

### 2. Verify Service Interactions
- **Test Scenarios**: [List key integration test scenarios]
- **Expected Results**: [Describe expected outcomes]
- **Logs Location**: [Where to check logs]

### 3. Cleanup
\\\`\\\`\\\`bash
[Commands to clean up test environment]
# Example: docker-compose down, stop test services
\\\`\\\`\\\`
\`\`\`

---

## Step 5: Generate Performance Test Instructions (If Applicable)

Create \`aidlc-docs/construction/build-and-test/performance-test-instructions.md\`:

\`\`\`markdown
# Performance Test Instructions

## Purpose
Validate system performance under load to ensure it meets requirements.

## Performance Requirements
- **Response Time**: < [X]ms for [Y]% of requests
- **Throughput**: [X] requests/second
- **Concurrent Users**: Support [X] concurrent users
- **Error Rate**: < [X]%

## Setup Performance Test Environment

### 1. Prepare Test Environment
\\\`\\\`\\\`bash
[Commands to set up performance testing]
# Example: scale services, configure load balancers
\\\`\\\`\\\`

### 2. Configure Test Parameters
- **Test Duration**: [X] minutes
- **Ramp-up Time**: [X] seconds
- **Virtual Users**: [X] users

## Run Performance Tests

### 1. Execute Load Tests
\\\`\\\`\\\`bash
[Command to run load tests]
# Example: jmeter -n -t test.jmx, k6 run script.js
\\\`\\\`\\\`

### 2. Execute Stress Tests
\\\`\\\`\\\`bash
[Command to run stress tests]
# Example: gradually increase load until failure
\\\`\\\`\\\`

### 3. Analyze Performance Results
- **Response Time**: [Actual vs Expected]
- **Throughput**: [Actual vs Expected]
- **Error Rate**: [Actual vs Expected]
- **Bottlenecks**: [Identified bottlenecks]
- **Results Location**: [Path to performance reports]

## Performance Optimization

If performance doesn't meet requirements:
1. Identify bottlenecks from test results
2. Optimize code/queries/configurations
3. Rerun tests to validate improvements
\`\`\`

---

## Step 6: Generate Additional Test Instructions (As Needed)

Based on project requirements, generate additional test instruction files:

### Contract Tests (For Microservices)
Create \`aidlc-docs/construction/build-and-test/contract-test-instructions.md\`:
- API contract validation between services
- Consumer-driven contract testing
- Schema validation

### Security Tests
Create \`aidlc-docs/construction/build-and-test/security-test-instructions.md\`:
- Vulnerability scanning
- Dependency security checks
- Authentication/authorization testing
- Input validation testing

### End-to-End Tests
Create \`aidlc-docs/construction/build-and-test/e2e-test-instructions.md\`:
- Complete user workflow testing
- Cross-service scenarios
- UI testing (if applicable)

---

## Step 7: Generate Test Summary

Create \`aidlc-docs/construction/build-and-test/build-and-test-summary.md\`:

\`\`\`markdown
# Build and Test Summary

## Build Status
- **Build Tool**: [Tool name]
- **Build Status**: [Success/Failed]
- **Build Artifacts**: [List artifacts]
- **Build Time**: [Duration]

## Test Execution Summary

### Unit Tests
- **Total Tests**: [X]
- **Passed**: [X]
- **Failed**: [X]
- **Coverage**: [X]%
- **Status**: [Pass/Fail]

### Integration Tests
- **Test Scenarios**: [X]
- **Passed**: [X]
- **Failed**: [X]
- **Status**: [Pass/Fail]

### Performance Tests
- **Response Time**: [Actual] (Target: [Expected])
- **Throughput**: [Actual] (Target: [Expected])
- **Error Rate**: [Actual] (Target: [Expected])
- **Status**: [Pass/Fail]

### Additional Tests
- **Contract Tests**: [Pass/Fail/N/A]
- **Security Tests**: [Pass/Fail/N/A]
- **E2E Tests**: [Pass/Fail/N/A]

## Overall Status
- **Build**: [Success/Failed]
- **All Tests**: [Pass/Fail]
- **Ready for Operations**: [Yes/No]

## Next Steps
[If all pass]: Ready to proceed to Operations phase for deployment planning
[If failures]: Address failing tests and rebuild
\`\`\`

---

## Step 8: Update State Tracking

Update \`aidlc-docs/aidlc-state.md\`:
- Mark Build and Test stage as complete
- Update current status

---

## Step 9: Present Results to User

Present comprehensive message:

\`\`\`
"🔨 Build and Test Complete!

**Build Status**: [Success/Failed]

**Test Results**:
✅ Unit Tests: [X] passed
✅ Integration Tests: [X] scenarios passed
✅ Performance Tests: [Status]
✅ Additional Tests: [Status]

**Generated Files**:
1. ✅ build-instructions.md
2. ✅ unit-test-instructions.md
3. ✅ integration-test-instructions.md
4. ✅ performance-test-instructions.md (if applicable)
5. ✅ [additional test files as needed]
6. ✅ build-and-test-summary.md

Review the summary in aidlc-docs/construction/build-and-test/build-and-test-summary.md

**Ready to proceed to Operations stage for deployment planning?""
\`\`\`

---

## Step 10: Log Interaction

**MANDATORY**: Log the phase completion in \`aidlc-docs/audit.md\`:

\`\`\`markdown
## Build and Test Stage
**Timestamp**: [ISO timestamp]
**Build Status**: [Success/Failed]
**Test Status**: [Pass/Fail]
**Files Generated**:
- build-instructions.md
- unit-test-instructions.md
- integration-test-instructions.md
- performance-test-instructions.md
- build-and-test-summary.md

---
\`\`\``;

export const OPERATIONS_RULES: string = `# ================================================================
# Rule: operations
# Source:operations/operations.md
# ================================================================

# Operations

**Purpose**: Placeholder for future operational phases (deployment, monitoring, maintenance)

**Status**: This phase is currently a placeholder and will be expanded in future versions.

## Future Scope

The Operations phase will eventually include:
- Deployment planning and execution
- Monitoring and observability setup
- Incident response procedures
- Maintenance and support workflows
- Production readiness checklists

## Current State

All build and test activities have been moved to the CONSTRUCTION phase.
The AI-DLC workflow currently ends after the Build and Test phase in CONSTRUCTION.`;
