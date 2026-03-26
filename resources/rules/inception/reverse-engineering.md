# Reverse Engineering

**Purpose**: Analyze existing codebase and generate comprehensive design artifacts

**Execute when**: Brownfield project detected (existing code found in workspace)

**Skip when**: Greenfield project (no existing code)

**Rerun behavior**: Always rerun when brownfield project detected, even if artifacts exist. This ensures artifacts reflect current code state

## Agent Delegation Strategy

**MANDATORY**: Delegate codebase analysis to specialized agents. Do NOT analyze the codebase directly.

**Execution mode**: Foreground parallel — launch multiple agents in the same response, but do NOT use `run_in_background: true`. This ensures:
- The user can see what each agent is doing
- Failed tasks are detected immediately (not silently lost)
- Results are available inline without polling via TaskOutput

**Recommended split**:
- **Agent 1** (`explore-medium`): Static code model — modules, data models, dependencies, file inventory, technology stack
- **Agent 2** (`oracle-medium`): Dynamic behavior model — user flows, auth patterns, state management, API interactions, error handling

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After both agents complete**: Compile their findings into the artifact files defined in the steps below.

**Optional visual analysis — `multimodal-looker`**:
If the repository contains image-format architecture diagrams, ERDs, wireframes, or design documents (`.png`, `.jpg`, `.pdf`, `.svg` in the repo root, `docs/`, or `diagrams/` directories), optionally invoke `multimodal-looker` to extract architectural context from them. This enriches `architecture.md` and `business-overview.md` with information that text-only analysis cannot capture. Only invoke if relevant image files are discovered during the workspace scan — do not search exhaustively for images.

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

## Step 1: Generate Workspace Scan

Create `aidlc-docs/{workflowId}/discovery/workspace-scan.json`:

```json
{
  "_meta": {
    "artifact": "Workspace Scan",
    "contains": "Raw inventory of packages, languages, frameworks, and structural patterns discovered in the codebase",
    "reviewFor": "Verify all packages and repos were discovered. Flag any missed projects or incorrectly categorized packages."
  },
  "scanDate": "[ISO timestamp]",
  "projectPath": "[Project root path]",
  "fileCount": "[Total number of source files]",
  "packageStructure": {
    "total": "[Number]",
    "byType": {
      "application": "[Number]",
      "infrastructure": "[Number]",
      "shared": "[Number]",
      "test": "[Number]"
    }
  },
  "languages": ["[Language 1]", "[Language 2]"],
  "frameworks": ["[Framework 1]", "[Framework 2]"],
  "keyPatterns": {
    "architecture": "[Primary architecture pattern]",
    "dataFlow": "[Primary data flow pattern]",
    "codeOrganization": "[How code is organized]"
  }
}
```

## Step 2: Generate Analysis Plan

Create `aidlc-docs/{workflowId}/discovery/analysis-plan.md`:

```markdown
> **Artifact**: Analysis Plan
> **Contains**: Scope, methodology, key questions, and success criteria that guided the AI agents during reverse engineering
> **Review for**: Confirm the analysis scope and key questions cover what matters to you. These questions are answered by the other discovery artifacts — you do not need to answer them yourself.

# Analysis Plan

## Scope
- **Analysis Focus**: [Primary areas of analysis]
- **Depth Level**: [Shallow/Medium/Deep]
- **Key Packages**: [List of critical packages to analyze]

## Methodology
- **Agent 1 Focus**: [Static code structure analysis]
- **Agent 2 Focus**: [Dynamic behavior and interactions]

## Key Questions
- [Question 1]
- [Question 2]
- [Question 3]

## Success Criteria
- [Criterion 1]
- [Criterion 2]
```

## Step 3: Generate Current State Analysis

Create `aidlc-docs/{workflowId}/discovery/current-state-analysis.md`:

```markdown
> **Artifact**: Current State Analysis
> **Contains**: Architecture summary, technology stack, component inventory, data models, and integration points
> **Review for**: Verify the architecture summary and tech stack match reality. Flag missing components, incorrect relationships, or outdated technology versions.

# Current State Analysis

## System Overview
[High-level description of the current system state]

## Architecture Summary
[Mermaid diagram showing key components and relationships]

## Technology Stack
- **Languages**: [List with versions]
- **Frameworks**: [List with versions]
- **Runtime/Infrastructure**: [Key services]

## Component Inventory
### [Package/Component Name]
- **Type**: [Application/Infrastructure/Shared/Test]
- **Purpose**: [What it does]
- **Technology**: [Key tech used]
- **Dependencies**: [What it depends on]

## Data Models and Flows
[Key data structures and flow patterns]

## Integration Points
- **External APIs**: [List with purposes]
- **Data Stores**: [List with purposes]
- **Third-party Services**: [List with purposes]
```

## Step 4: Generate Regression Baseline

Create `aidlc-docs/{workflowId}/discovery/regression-baseline.md`:

```markdown
> **Artifact**: Regression Baseline
> **Contains**: Test coverage status, quality metrics, known issues, technical debt, and behaviors that must be preserved
> **Review for**: Confirm the baseline behavior list is complete and accurate. Add any missing behaviors that should survive the migration. These items are verified during Build and Test via coverage mapping.

# Regression Baseline

## Test Coverage Status
- **Overall Coverage**: [Percentage or Quality Assessment]
- **Unit Tests**: [Count/Status]
- **Integration Tests**: [Count/Status]
- **E2E Tests**: [Count/Status]

## Quality Metrics
- **Code Quality**: [Assessment: Good/Fair/Poor]
- **Linting**: [Configured: Yes/No]
- **Type Safety**: [Assessment]
- **Documentation**: [Assessment: Good/Fair/Poor]

## Known Issues
- [Issue 1 and location]
- [Issue 2 and location]

## Technical Debt
- [Debt item and impact]

## Baseline Tests
[List of key tests that must pass in any regression]
```

## Step 5: Generate Change Impact Analysis

Create `aidlc-docs/{workflowId}/discovery/change-impact.md`:

```markdown
> **Artifact**: Change Impact Analysis
> **Contains**: Affected components, dependency impact, risk assessment, and regression test strategy for the planned changes
> **Review for**: Validate the risk levels assigned to each component. Verify all affected areas are identified — especially indirect dependencies the AI may have missed.

# Change Impact Analysis

## Scope of Proposed Changes
[Description of what is being changed and why]

## Components Affected
### [Component Name]
- **Direct Impact**: [What changes]
- **Risk Level**: [Low/Medium/High]
- **Testing Required**: [What tests to run]

## Dependency Impact
[Which packages/services depend on affected areas]

## Risk Assessment
- **High Risk Areas**: [List]
- **Low Risk Areas**: [List]
- **Mitigations**: [Risk mitigation strategies]

## Regression Test Strategy
[Specific tests to verify no regression]
```

## Step 6: Generate Static Model

Create `aidlc-docs/{workflowId}/discovery/static-model.md`:

```markdown
> **Artifact**: Static Code Model
> **Contains**: Module hierarchy, data models, design patterns, package dependencies, and file inventory
> **Review for**: Verify module structure and data model relationships match your understanding. Flag missing components, incorrect dependency directions, or design patterns that aren't actually used.

# Static Code Model

## Module Hierarchy
[Mermaid diagram showing module/package structure]

## Data Models
### [Model Name]
- **Fields**: [Field descriptions]
- **Relationships**: [Related models]
- **Location**: [File path]

## Design Patterns
### [Pattern Name]
- **Location**: [Where used in codebase]
- **Purpose**: [Why used]
- **Implementation**: [How implemented]

## Dependencies
[Mermaid diagram showing package dependencies]

### [Package A] depends on [Package B]
- **Type**: [Compile/Runtime/Test]
- **Reason**: [Why dependency exists]

## File Inventory
[List of key source files with their purposes]
- `[path/to/file]` - [Purpose/responsibility]
```

## Step 7: Generate Dynamic Model

Create `aidlc-docs/{workflowId}/discovery/dynamic-model.md`:

```markdown
> **Artifact**: Dynamic Behavior Model
> **Contains**: User flows, state management, authentication/authorization, API interactions, error handling, and integration patterns
> **Review for**: Verify user flows and auth patterns are correctly captured. Flag missing API interactions, incorrect sequence flows, or error handling gaps the AI may have overlooked.

# Dynamic Behavior Model

## User Flows
[Mermaid sequence diagrams of key user workflows]

### [Workflow Name]
[Sequence diagram and description]

## State Management
- **Global State**: [How state is managed]
- **Local State**: [Component-level state patterns]
- **Data Flow**: [Unidirectional/Bidirectional/Event-driven]

## Authentication and Authorization
- **Auth Mechanism**: [OAuth/Session/JWT/etc]
- **Permission Model**: [How permissions are enforced]
- **Flow**: [Auth sequence diagram]

## API Interactions
### [Endpoint/Service Name]
- **Purpose**: [What it does]
- **Request Format**: [Request structure]
- **Response Format**: [Response structure]
- **Callers**: [Who calls it]

## Error Handling
- **Strategy**: [How errors are handled]
- **Patterns**: [Common error patterns]
- **Recovery**: [How the system recovers from errors]

## Integration Patterns
- **Event-driven**: [Description if used]
- **Request/Response**: [Description if used]
- **Message Queue**: [Description if used]
```

## Step 10: MANDATORY: Update State Tracking

**MANDATORY**: Update BOTH state files in the SAME interaction:
1. Update `aidlc-docs/{workflow-id}/aidlc-state.md`:

```markdown
## Reverse Engineering Status
- [x] Reverse Engineering - Completed on [timestamp]
- **Artifacts Location**: aidlc-docs/{workflowId}/discovery/
```

2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set reverse-engineering status to "completed" with completed_at timestamp, update current_inception_stage to next stage
- **Do NOT proceed to the next stage without completing this step**

## Step 11: Present Completion Message to User

```markdown
# 🔍 Reverse Engineering Complete

[AI-generated summary of key findings from analysis in the form of bullet points]

---

⚠️ **REVIEW REQUIRED**

> Please examine the reverse engineering artifacts at:
> `aidlc-docs/{workflowId}/discovery/`

**You may:**
- 🔧 **Request Changes** — Ask for modifications to the reverse engineering analysis if required
- ➕ **Add Skipped Stage** — Include a previously excluded stage in the workflow
- ✅ **Approve & Continue** — Approve analysis and proceed to **Requirements Analysis**
```

## Step 12: Wait for User Approval

- **MANDATORY**: Do not proceed until user explicitly approves
- **MANDATORY**: This approval gate is **unconditional** — it must fire regardless of how the analysis was completed (by agents, retries, manual recovery, or any combination). Never skip this gate.
- **MANDATORY**: Log user's response in audit.md with complete raw input
