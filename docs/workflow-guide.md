# Olympus Structured Workflow Guide

A comprehensive guide to using the structured workflow system for feature planning and implementation in Olympus.

---

## Table of Contents

1. [What is the Structured Workflow?](#what-is-the-structured-workflow)
2. [Quick Start](#quick-start)
3. [Workflow Stages Explained](#workflow-stages-explained)
4. [Command Reference](#command-reference)
5. [Artifact Format Reference](#artifact-format-reference)
6. [Complete Workflow Example](#complete-workflow-example)
7. [Manual Commands](#manual-commands)
8. [Troubleshooting](#troubleshooting)

---

## What is the Structured Workflow?

The **Structured Workflow** is a multi-stage system that guides features from initial concept through executable implementation. It ensures that every feature is:

1. **Well-planned** - Business goals and constraints documented (IDEA)
2. **User-focused** - Requirements and acceptance criteria captured (PRD)
3. **Architecturally sound** - Technical design reviewed (SPEC)
4. **Actionable** - Decomposed into executable tasks (INTENTS)

### When to Use Structured Workflow

Use the structured workflow when:

- Building significant new features
- Planning multi-day/multi-week work
- Working with unclear or evolving requirements
- Need comprehensive documentation of design decisions
- Want to pause/resume work across sessions
- Building in a team or want artifacts for code review

### The Four Stages

```
┌─────────────────────────────────────────────┐
│         IDEA STAGE (Business Context)       │
│  What problem are we solving? Why? How      │
│  will we measure success?                   │
└────────────┬────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────┐
│    PRD STAGE (User Requirements)            │
│  What should the feature do? Who uses it?   │
│  What are the acceptance criteria?          │
└────────────┬────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────┐
│   SPEC STAGE (Technical Design)             │
│  How do we build it? Architecture, APIs,    │
│  component structure, data flow             │
└────────────┬────────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────────┐
│  INTENTS STAGE (Executable Tasks)           │
│  Specific, atomic tasks with dependencies   │
│  Ready for /ascent or /olympus execution    │
└─────────────────────────────────────────────┘
```

---

## Quick Start

### Starting a Structured Workflow

```bash
/idea oauth-authentication
```

This command will:
1. Create a workflow for the "oauth-authentication" feature
2. Start the IDEA stage with an interactive interview
3. Capture business context, constraints, and success metrics
4. Save to `.olympus/workflow/oauth-authentication/idea.md`

### Continuing to Next Stage

```bash
/prd oauth-authentication
```

This:
1. Loads the existing IDEA artifact
2. Starts the PRD stage
3. Generates user stories and acceptance criteria
4. Saves to `.olympus/workflow/oauth-authentication/prd.md`

### Following the Complete Flow

```bash
# Stage 1: Define the business problem
/idea oauth-authentication
[Answer interview questions]

# Stage 2: Capture user requirements
/prd oauth-authentication
[Review IDEA context, generate user stories]

# Stage 3: Design the technical solution
/spec oauth-authentication
[Analyze codebase, create architecture]

# Stage 4: Generate executable tasks
/intents oauth-authentication
[Decompose spec into atomic tasks]

# Stage 5: Execute the tasks
/ascent oauth-authentication
[Run all tasks in dependency order]
```

---

## Workflow Stages Explained

### Stage 1: IDEA - Business Context

**Purpose:** Capture the business problem, context, and success metrics.

**What Gets Defined:**
- Problem statement (clear description of what's being solved)
- Business context (who benefits, why it matters)
- Success metrics (how we'll measure success)
- Constraints (technical, timeline, budget)
- Risk assessment (high/medium/low impact)

**Interview Questions:**
```
1. What problem are we solving?
2. Who benefits from this feature?
3. What's the business impact?
4. How will we measure success?
5. Any technical or timeline constraints?
6. What's the risk level (1-3)?
```

**Output File:** `.olympus/workflow/{feature}/idea.md`

**Validation Criteria:**
- Problem statement is specific and clear
- Business context identifies stakeholders
- At least 2 measurable success metrics defined
- Constraints are documented
- Risk tier is justified

### Stage 2: PRD - Product Requirements

**Purpose:** Define user-facing requirements and acceptance criteria.

**What Gets Defined:**
- User stories ("As a [user], I want [feature], so that [benefit]")
- Acceptance criteria (specific, testable conditions)
- Edge cases and error states
- Dependencies on other features
- User experience flows

**Input:** Reads IDEA artifact to understand business context

**Output File:** `.olympus/workflow/{feature}/prd.md`

**Validation Criteria (Momus Review):**
- All IDEA problem statements addressed
- User stories are specific and testable
- Acceptance criteria are measurable
- Edge cases documented
- Coverage of identified constraints from IDEA

### Stage 3: SPEC - Technical Specification

**Purpose:** Design the technical implementation.

**What Gets Defined:**
- Architecture and high-level design
- Component structure
- API contracts and data models
- External dependencies
- Implementation patterns and conventions
- Performance considerations

**Input:** Reads IDEA and PRD artifacts

**Analysis:**
- Explores existing codebase patterns
- Identifies related implementations
- Catalogs available libraries and utilities

**Output File:** `.olympus/workflow/{feature}/spec.md`

**Validation Criteria (Metis Review):**
- All PRD user stories addressable with this design
- Architecture is sound for stated constraints
- Components are well-separated and testable
- API contracts are clear
- External dependencies are reasonable

### Stage 4: INTENTS - Executable Tasks

**Purpose:** Decompose the specification into atomic, executable tasks.

**What Gets Generated:**
- INTENT-{NNN}.md files (one per task)
- Each intent contains:
  - Clear implementation prompt
  - Acceptance criteria
  - Related components
  - Estimated effort
- dependency-graph.json
  - Task IDs and titles
  - Dependencies between tasks
  - Execution order

**Input:** Reads SPEC artifact

**Output Files:**
```
.olympus/workflow/{feature}/intents/
├── INTENT-001.md
├── INTENT-002.md
├── INTENT-003.md
├── dependency-graph.json
```

**Validation Criteria:**
- 100% of spec components have corresponding tasks
- Dependencies form a valid DAG (no circular dependencies)
- Each task is atomic and completable in one session
- Acceptance criteria are testable
- Estimated efforts are reasonable

---

## Command Reference

### `/idea {feature}`

Generate the IDEA artifact for a new feature or workflow.

**Parameters:**
- `{feature}` - Feature name (e.g., "oauth-authentication", "user-dashboard")

**Behavior:**
1. Checks if workflow exists (loads context if it does)
2. Starts IDEA interview
3. Saves artifact to `.olympus/workflow/{feature}/idea.md`
4. Creates checkpoint at `.olympus/workflow/{feature}/checkpoint.json`

**Example:**
```bash
/idea oauth-authentication
```

**Expected Output:**
```
Feature: oauth-authentication

Gathering business context...
[Interactive interview]

Artifact saved to: .olympus/workflow/oauth-authentication/idea.md
Status: IDEA stage complete ✓
Next: /prd oauth-authentication
```

---

### `/prd {feature}`

Generate the PRD artifact based on the IDEA.

**Parameters:**
- `{feature}` - Feature name (must have existing IDEA)

**Behavior:**
1. Loads workflow checkpoint
2. Reads IDEA artifact for context
3. Generates user stories and acceptance criteria
4. Invokes Momus for validation review
5. Saves to `.olympus/workflow/{feature}/prd.md`
6. Updates checkpoint

**Example:**
```bash
/prd oauth-authentication
```

**Expected Output:**
```
Loading IDEA context for oauth-authentication...
Generating PRD with user stories...

PRD Artifact:
## User Stories
- As a user, I want to sign in with Google...
- As an admin, I want to see OAuth user stats...

[Momus Review]
✓ Validation PASSED (95% coverage)
  - All 6 IDEA constraints addressed
  - 4 user stories with acceptance criteria

Artifact saved to: .olympus/workflow/oauth-authentication/prd.md
Status: PRD stage complete ✓
Next: /spec oauth-authentication
```

---

### `/spec {feature}`

Generate the SPEC artifact based on PRD requirements.

**Parameters:**
- `{feature}` - Feature name (must have existing PRD)

**Behavior:**
1. Loads workflow checkpoint
2. Reads IDEA and PRD artifacts
3. Analyzes existing codebase patterns
4. Designs technical architecture
5. Invokes Metis for validation review
6. Saves to `.olympus/workflow/{feature}/spec.md`
7. Updates checkpoint

**Example:**
```bash
/spec oauth-authentication
```

**Expected Output:**
```
Loading PRD context for oauth-authentication...
Analyzing existing authentication patterns...

SPEC Design:
## Architecture
- New OAuthProvider abstraction (src/auth/providers/)
- OAuth routes in src/api/auth/oauth.ts
- Session middleware integration

[Metis Review]
✓ Validation PASSED (98% coverage)
  - All 4 PRD user stories addressed
  - Architecture supports 200% growth
  - External dependencies are stable

Artifact saved to: .olympus/workflow/oauth-authentication/spec.md
Status: SPEC stage complete ✓
Next: /intents oauth-authentication
```

---

### `/intents {feature}`

Generate executable intent tasks from the SPEC.

**Parameters:**
- `{feature}` - Feature name (must have existing SPEC)

**Behavior:**
1. Loads workflow checkpoint
2. Reads SPEC artifact
3. Decomposes into atomic tasks
4. Generates INTENT-{NNN}.md files
5. Creates dependency-graph.json
6. Validates coverage (100% of spec addressed)
7. Saves to `.olympus/workflow/{feature}/intents/`
8. Updates checkpoint

**Example:**
```bash
/intents oauth-authentication
```

**Expected Output:**
```
Loading SPEC for oauth-authentication...
Decomposing into executable tasks...

Generated Intents:
✓ INTENT-001: Create OAuthProvider abstraction (3 points)
✓ INTENT-002: Implement Google OAuth handler (5 points)
✓ INTENT-003: Add OAuth routes (2 points)
✓ INTENT-004: Update UI with login button (3 points)
✓ INTENT-005: Add tests (2 points)

Dependency Graph:
  INTENT-001 → INTENT-002
  INTENT-002 → INTENT-003
  INTENT-003 → INTENT-004
  INTENT-004 → INTENT-005

Coverage: 100% (all spec components addressed)
Total Effort: 15 story points

Artifacts saved to: .olympus/workflow/oauth-authentication/intents/
Status: INTENTS stage complete ✓
Next: /ascent oauth-authentication
```

---

### `/workflow status`

Display all active workflows and their status.

**Behavior:**
1. Scans `.olympus/workflow/` directory
2. Loads all checkpoint files
3. Shows feature name, current stage, status, and last updated
4. Lists all workflows in a scannable table

**Example:**
```bash
/workflow status
```

**Expected Output:**
```
Active Structured Workflows
═════════════════════════════════════════════════════════

Feature              Stage    Status       Updated          Path
─────────────────────────────────────────────────────────
oauth-auth          INTENTS  complete     2026-02-04       .olympus/workflow/oauth-auth/
user-dashboard      PRD      in_progress  2026-02-03       .olympus/workflow/user-dashboard/
notifications       IDEA     complete     2026-02-01       .olympus/workflow/notifications/

Total: 3 workflows | Ready to execute: 1
```

---

### `/olympus next {feature}`

Get the next ready executable task from a workflow.

**Parameters:**
- `{feature}` - Feature name (must have INTENTS generated)

**Behavior:**
1. Loads checkpoint and dependency graph
2. Identifies next ready task (dependencies met)
3. Returns task details with prompt and acceptance criteria
4. Ready to execute with `/ascent` or `/olympus`

**Example:**
```bash
/olympus next oauth-authentication
```

**Expected Output:**
```
Next Ready Task: INTENT-001 ✓ Ready
════════════════════════════════════════

Title: Create OAuthProvider abstraction
Status: pending
Dependencies: None
Estimated Effort: 3 points

Description:
Create an abstract OAuthProvider class that defines the interface
for OAuth provider implementations. This will allow us to support
multiple OAuth providers (Google, GitHub, Microsoft) with a
consistent implementation pattern.

What to build:
- OAuthProvider interface with abstract methods
- Utility functions for token handling
- Error handling for OAuth failures

Acceptance Criteria:
- [ ] OAuthProvider class defined in src/auth/providers/
- [ ] Abstract methods: authenticate(), getUser(), refreshToken()
- [ ] TypeScript types exported for consumers
- [ ] Unit tests for base functionality

Run: /ascent INTENT-001 oauth-authentication
```

---

## Artifact Format Reference

### IDEA Artifact Format

**File:** `.olympus/workflow/{feature}/idea.md`

```markdown
---
id: IDEA-2026-001
title: "OAuth Authentication Implementation"
created: 2026-02-04T10:30:00Z
status: complete
risk_tier: 2
workflow_id: oauth-authentication
---

## Problem Statement

Users need a secure way to sign in without creating a new password.
Currently, users must manage yet another username/password combination,
leading to poor signup conversion and high support burden.

## Business Context

**Stakeholders:**
- Product: Wants to increase signup conversion by 25%
- Engineering: Wants to reduce auth support tickets by 40%
- Security: Requires OAuth 2.0 with PKCE for web apps

**Impact:**
- Estimated 30% improvement in signup completion rate
- Reduces auth-related support tickets
- Competitive feature parity with similar products

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Signup conversion | +25% | Analytics dashboard |
| OAuth adoption | 40% of signups | User tracking |
| Support tickets | -40% for auth | Support system |

## Constraints

- **Timeline:** Must ship within 4 weeks (by 2026-03-04)
- **Technical:** Use existing session infrastructure, no new databases
- **Security:** No plaintext token storage, PKCE for web apps

## Risk Assessment

**Tier 2 (Medium):**
- OAuth provider outages could block signups (mitigated by fallback)
- Token refresh failures could break sessions (mitigated by refresh logic)
- User data mismatch between providers (mitigated by validation)
```

---

### PRD Artifact Format

**File:** `.olympus/workflow/{feature}/prd.md`

```markdown
---
id: PRD-2026-001
title: "OAuth Authentication - Product Requirements"
created: 2026-02-04T11:00:00Z
status: complete
workflow_id: oauth-authentication
validated_by: momus
validation_date: 2026-02-04T11:30:00Z
validation_coverage: 95%
---

## User Stories

### Story 1: Sign in with Google
**As a** new user
**I want to** sign in with my Google account
**So that** I don't have to create another password

**Acceptance Criteria:**
- [ ] "Sign in with Google" button visible on login page
- [ ] Clicking button redirects to Google OAuth consent
- [ ] After consent, user is signed in and redirected to dashboard
- [ ] User data (name, email, avatar) is populated in profile
- [ ] Works on Chrome, Firefox, Safari (latest 2 versions)

**Edge Cases:**
- User denies OAuth permission: Show friendly error, return to login
- User account already exists: Link OAuth to existing account
- User's email not public: Handle gracefully, prompt for email

### Story 2: Account Linking
**As an** existing user
**I want to** link my Google account to my existing account
**So that** I can sign in via Google in the future

**Acceptance Criteria:**
- [ ] "Link accounts" option in account settings
- [ ] OAuth flow completes and shows confirmation
- [ ] User can now sign in with either password or Google
- [ ] Unlink option available

## User Experience Flows

### Flow 1: New User Signup via OAuth
```
1. User lands on login page
2. Clicks "Sign in with Google"
3. Redirected to Google consent screen
4. User authorizes
5. Redirected to account creation (pre-filled with Google data)
6. User completes signup
7. Logged in, dashboard visible
```

## Validation (Momus Review)

✓ **PASSED** - 95% coverage
- All 6 IDEA constraints addressed in user stories
- Acceptance criteria are specific and testable
- Edge cases documented for high-risk flows
- No gaps between business goals and requirements
```

---

### SPEC Artifact Format

**File:** `.olympus/workflow/{feature}/spec.md`

```markdown
---
id: SPEC-2026-001
title: "OAuth Authentication - Technical Specification"
created: 2026-02-04T13:00:00Z
status: complete
workflow_id: oauth-authentication
validated_by: metis
validation_date: 2026-02-04T13:45:00Z
validation_coverage: 98%
---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│         Client (Web Browser)            │
│  - Login page with OAuth buttons        │
│  - Account linking UI                   │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│      OAuth Routes (src/api/auth/oauth)  │
│  - GET /auth/:provider/init             │
│  - GET /auth/:provider/callback         │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│    OAuthProvider Abstraction            │
│  - Handles provider-specific logic      │
│  - Manages tokens securely              │
│  - Abstracts away provider differences  │
└────────────┬────────────────────────────┘
             │
             ↓
┌─────────────────────────────────────────┐
│      External OAuth Providers           │
│  - Google OAuth 2.0                     │
│  - (Prepared for GitHub, Microsoft)     │
└─────────────────────────────────────────┘
```

## Components

### 1. OAuthProvider Abstraction (src/auth/providers/)

**Purpose:** Abstract interface for OAuth providers

**File:** `src/auth/providers/OAuthProvider.ts`

```typescript
interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string[];
}

abstract class OAuthProvider {
  constructor(config: OAuthConfig) { }

  abstract getAuthUrl(state: string): string;
  abstract exchangeCode(code: string): Promise<Token>;
  abstract getUser(token: Token): Promise<User>;
  abstract refreshToken(token: Token): Promise<Token>;
}
```

### 2. OAuth Routes (src/api/auth/oauth.ts)

**Purpose:** Handle OAuth flow and session management

**Endpoints:**
- `GET /auth/:provider/init` - Initiate OAuth flow
- `GET /auth/:provider/callback` - Handle OAuth callback

## Data Models

### OAuth Token Storage
- Stored in encrypted database column
- Never exposed in API responses
- Refreshed automatically before expiration

### Session Integration
- Uses existing SessionManager
- OAuth provider stored as session.provider
- Transparent to frontend

## External Dependencies

- **passport.js** (^0.6.0) - OAuth middleware
- **passport-google-oauth20** (^2.0.0) - Google provider

## Validation (Metis Review)

✓ **PASSED** - 98% coverage
- All 4 PRD user stories fully addressable
- Architecture supports multi-provider expansion
- Token handling follows security best practices
```

---

### INTENTS Artifact Format

**File:** `.olympus/workflow/{feature}/intents/INTENT-{NNN}.md`

```markdown
---
id: INTENT-001
title: "Create OAuthProvider Abstraction"
component: Authentication
estimated_effort: 3
status: pending
workflow_id: oauth-authentication
---

## Overview

Create an abstract OAuthProvider class that defines the interface for OAuth
provider implementations. This will allow us to support multiple OAuth
providers (Google, GitHub, Microsoft) with a consistent implementation pattern.

## What to Build

1. Create `src/auth/providers/` directory
2. Implement abstract `OAuthProvider` class
3. Implement utility functions for token handling
4. Add error types for OAuth failures

## Detailed Steps

1. **Create base provider class**
   - File: `src/auth/providers/OAuthProvider.ts`
   - Define abstract methods: getAuthUrl(), exchangeCode(), getUser(), refreshToken()
   - Add token storage interface

2. **Implement token utilities**
   - File: `src/auth/providers/token-utils.ts`
   - Functions: encryptToken(), decryptToken(), isTokenExpired(), refreshIfNeeded()

3. **Add error handling**
   - File: `src/auth/providers/errors.ts`
   - Error types: OAuthError, TokenExpiredError, ProviderUnavailableError

4. **Write tests**
   - File: `src/__tests__/auth/OAuthProvider.test.ts`
   - Test: Token encryption/decryption
   - Test: Token expiration detection
   - Test: Abstract methods enforcement

## Acceptance Criteria

- [ ] OAuthProvider abstract class in src/auth/providers/OAuthProvider.ts
- [ ] getAuthUrl(state: string): string method defined
- [ ] exchangeCode(code: string): Promise<Token> method defined
- [ ] getUser(token: Token): Promise<User> method defined
- [ ] refreshToken(token: Token): Promise<Token> method defined
- [ ] Token utilities handle encryption with app secret
- [ ] All error types exported from src/auth/providers/errors.ts
- [ ] 100% test coverage for utilities
- [ ] No TypeScript errors (tsc --noEmit)
- [ ] Documentation in component with usage examples

## Definition of Done

✓ Code is written and builds cleanly
✓ All tests passing
✓ Code review passed
✓ Documentation updated
✓ Ready for dependent tasks (INTENT-002)

## Dependencies

- None (foundation task)

## Patterns to Follow

- Use existing TypeScript patterns from src/services/
- Follow error handling from src/api/errors.ts
- Match code style in .eslintrc.json
```

---

### Dependency Graph Format

**File:** `.olympus/workflow/{feature}/intents/dependency-graph.json`

```json
{
  "nodes": [
    {
      "id": "INTENT-001",
      "title": "Create OAuthProvider abstraction",
      "component": "Authentication",
      "estimated_effort": 3
    },
    {
      "id": "INTENT-002",
      "title": "Implement Google OAuth handler",
      "component": "Authentication",
      "estimated_effort": 5
    },
    {
      "id": "INTENT-003",
      "title": "Add OAuth routes",
      "component": "API",
      "estimated_effort": 2
    },
    {
      "id": "INTENT-004",
      "title": "Update UI with login button",
      "component": "Frontend",
      "estimated_effort": 3
    },
    {
      "id": "INTENT-005",
      "title": "Add integration tests",
      "component": "Testing",
      "estimated_effort": 2
    }
  ],
  "edges": [
    {
      "from": "INTENT-001",
      "to": "INTENT-002"
    },
    {
      "from": "INTENT-002",
      "to": "INTENT-003"
    },
    {
      "from": "INTENT-003",
      "to": "INTENT-004"
    },
    {
      "from": "INTENT-004",
      "to": "INTENT-005"
    }
  ]
}
```

---

### Checkpoint File Format

**File:** `.olympus/workflow/{feature}/checkpoint.json`

```json
{
  "schema_version": "1.0.0",
  "workflow_id": "oauth-authentication",
  "feature_name": "oauth-authentication",
  "created_at": "2026-02-04T10:30:00Z",
  "updated_at": "2026-02-04T14:00:00Z",
  "current_stage": "intents",
  "status": "complete",
  "artifacts": {
    "idea": {
      "id": "IDEA-2026-001",
      "path": ".olympus/workflow/oauth-authentication/idea.md",
      "created_at": "2026-02-04T10:30:00Z",
      "validation_passed": true
    },
    "prd": {
      "id": "PRD-2026-001",
      "path": ".olympus/workflow/oauth-authentication/prd.md",
      "created_at": "2026-02-04T11:00:00Z",
      "validation_passed": true
    },
    "spec": {
      "id": "SPEC-2026-001",
      "path": ".olympus/workflow/oauth-authentication/spec.md",
      "created_at": "2026-02-04T13:00:00Z",
      "validation_passed": true
    },
    "intents": {
      "id": "INTENTS-2026-001",
      "path": ".olympus/workflow/oauth-authentication/intents/",
      "created_at": "2026-02-04T14:00:00Z",
      "validation_passed": true
    },
    "complete": null
  },
  "validation_results": {
    "idea": {
      "passed": true,
      "coverage_percentage": 100,
      "blocking_issues": [],
      "reviewer": "self",
      "timestamp": "2026-02-04T10:45:00Z"
    },
    "prd": {
      "passed": true,
      "coverage_percentage": 95,
      "blocking_issues": [],
      "reviewer": "momus",
      "timestamp": "2026-02-04T11:30:00Z"
    },
    "spec": {
      "passed": true,
      "coverage_percentage": 98,
      "blocking_issues": [],
      "reviewer": "metis",
      "timestamp": "2026-02-04T13:45:00Z"
    },
    "intents": {
      "passed": true,
      "coverage_percentage": 100,
      "blocking_issues": [],
      "timestamp": "2026-02-04T14:00:00Z"
    },
    "complete": null
  },
  "resume_context": {
    "last_completed_stage": "intents",
    "task_statuses": {
      "INTENT-001": "pending",
      "INTENT-002": "pending",
      "INTENT-003": "pending",
      "INTENT-004": "pending",
      "INTENT-005": "pending"
    }
  }
}
```

---

## Complete Workflow Example

### Scenario: Add OAuth Authentication

This example walks through a complete structured workflow from concept to execution.

#### Step 1: Start the IDEA Stage

```bash
> /idea oauth-auth
```

The system starts an interactive interview:

```
Interview: OAuth Authentication Feature

Question 1: What problem are we solving?
> Users need a way to sign in without remembering a password

Question 2: Who benefits from this feature?
> Product team (more signups), users (easier access), support (fewer auth tickets)

Question 3: How will we measure success?
> Signup completion rate increases 25%, OAuth adoption reaches 40%

Question 4: Any constraints?
> Must ship in 4 weeks, can't create new databases, requires PKCE

Question 5: Risk level (1=low, 2=medium, 3=high)?
> 2 - medium risk, existing infrastructure helps mitigate

IDEA artifact created: .olympus/workflow/oauth-auth/idea.md ✓
```

**Files created:**
```
.olympus/workflow/oauth-auth/
├── checkpoint.json
└── idea.md
```

#### Step 2: Generate PRD

```bash
> /prd oauth-auth
```

The system reads IDEA context and generates user stories:

```
Loading IDEA: "OAuth Authentication"
Risk tier: 2 (medium)
Success metrics: 25% conversion increase, 40% OAuth adoption

Generating PRD with user stories...

PRD Draft:
- As a new user, I want to sign in with Google...
- As an existing user, I want to link OAuth to my account...

Running Momus validation...
✓ PASSED - 95% coverage
  - All IDEA constraints addressed
  - User stories are testable
  - Edge cases documented

PRD artifact created: .olympus/workflow/oauth-auth/prd.md ✓
```

**Files created/updated:**
```
.olympus/workflow/oauth-auth/
├── checkpoint.json (updated with PRD reference)
├── idea.md
├── prd.md
└── validation/
    └── prd-validation.json
```

#### Step 3: Generate SPEC

```bash
> /spec oauth-auth
```

The system analyzes existing code and designs the architecture:

```
Loading IDEA and PRD...
Analyzing codebase patterns...

Found existing patterns:
- Session management in src/middleware/session.ts
- Error handling in src/api/errors.ts
- User model in src/models/User.ts

Designing architecture...

SPEC Draft:
1. Create OAuthProvider abstraction
2. Implement Google OAuth handler
3. Integrate with session middleware
4. Add OAuth routes

Running Metis validation...
✓ PASSED - 98% coverage
  - All PRD user stories addressable
  - Architecture is sound
  - Dependencies are stable

SPEC artifact created: .olympus/workflow/oauth-auth/spec.md ✓
```

**Files created/updated:**
```
.olympus/workflow/oauth-auth/
├── checkpoint.json (updated)
├── idea.md
├── prd.md
├── spec.md
└── validation/
    ├── prd-validation.json
    └── spec-validation.json
```

#### Step 4: Generate INTENTS

```bash
> /intents oauth-auth
```

The system breaks down the spec into executable tasks:

```
Loading SPEC...
Decomposing into executable tasks...

Generated:
✓ INTENT-001: Create OAuthProvider abstraction (3 points)
✓ INTENT-002: Implement Google OAuth handler (5 points)
✓ INTENT-003: Add OAuth routes (2 points)
✓ INTENT-004: Update login UI (3 points)
✓ INTENT-005: Add integration tests (2 points)

Total effort: 15 story points

Dependency chain:
  INTENT-001 → INTENT-002 → INTENT-003 → INTENT-004 → INTENT-005

Coverage validation: 100% ✓
All SPEC components have corresponding tasks.

Intents created: .olympus/workflow/oauth-auth/intents/ ✓
```

**Files created/updated:**
```
.olympus/workflow/oauth-auth/
├── checkpoint.json (status: complete)
├── idea.md
├── prd.md
├── spec.md
├── intents/
│   ├── INTENT-001.md
│   ├── INTENT-002.md
│   ├── INTENT-003.md
│   ├── INTENT-004.md
│   ├── INTENT-005.md
│   └── dependency-graph.json
└── validation/
    ├── prd-validation.json
    ├── spec-validation.json
    └── intents-validation.json
```

#### Step 5: Check Workflow Status

```bash
> /workflow status
```

Output:
```
Active Structured Workflows
═════════════════════════════════════════════════════════

Feature          Stage    Status      Updated
─────────────────────────────────────────────────────────
oauth-auth       INTENTS  complete    2026-02-04 14:30:00

Ready to execute: 1
```

#### Step 6: Check Next Ready Task

```bash
> /olympus next oauth-auth
```

Output:
```
Next Ready Task: INTENT-001 ✓ Ready
════════════════════════════════════════

Title: Create OAuthProvider Abstraction
Status: pending
Dependencies: None (foundation task)
Estimated Effort: 3 points

Description:
Create an abstract OAuthProvider class that defines the interface for
OAuth provider implementations. This will allow us to support multiple
OAuth providers with a consistent pattern.

Acceptance Criteria:
- [ ] OAuthProvider abstract class in src/auth/providers/
- [ ] getAuthUrl(), exchangeCode(), getUser(), refreshToken() methods
- [ ] Token utilities for encryption/decryption
- [ ] 100% test coverage

Run: /ascent INTENT-001 oauth-auth
```

#### Step 7: Execute All Tasks

```bash
> /ascent oauth-auth
```

The system executes all tasks in dependency order:

```
[THE ASCENT BEGINS - STRUCTURED WORKFLOW EXECUTION]

Workflow: oauth-auth
Total tasks: 5
Total effort: 15 points

═════════════════════════════════════════════════════════════

[1/5] Executing INTENT-001: Create OAuthProvider Abstraction

Prompt:
Create an abstract OAuthProvider class that defines the interface...

[Claude invokes Olympian executor]

[Olympian creates files]
✓ src/auth/providers/OAuthProvider.ts
✓ src/auth/providers/token-utils.ts
✓ src/auth/providers/errors.ts
✓ src/__tests__/auth/OAuthProvider.test.ts

[Verification]
✓ npm run build (no errors)
✓ npm test (5 tests passing)
✓ Code review checklist complete

Status: INTENT-001 → complete ✓

═════════════════════════════════════════════════════════════

[2/5] Executing INTENT-002: Implement Google OAuth Handler

Prompt:
Implement a concrete GoogleOAuthProvider that extends OAuthProvider...

[Olympian implements]
✓ src/auth/providers/GoogleOAuthProvider.ts
✓ Configuration in .env.example

[Verification]
✓ npm test (12 tests passing)
✓ Code review checklist complete

Status: INTENT-002 → complete ✓

═════════════════════════════════════════════════════════════

[3/5] Executing INTENT-003: Add OAuth Routes

Prompt:
Create OAuth routes that orchestrate the OAuth flow...

[Olympian implements]
✓ src/api/auth/oauth.ts
✓ GET /auth/:provider/init
✓ GET /auth/:provider/callback

[Verification]
✓ npm test (8 tests passing)

Status: INTENT-003 → complete ✓

═════════════════════════════════════════════════════════════

[4/5] Executing INTENT-004: Update Login UI

Prompt:
Add "Sign in with Google" button to login page...

[Frontend Engineer creates component]
✓ src/components/GoogleSignInButton.tsx
✓ Updated src/pages/Login.tsx

[Verification]
✓ npm run build (no errors)
✓ Component tests passing

Status: INTENT-004 → complete ✓

═════════════════════════════════════════════════════════════

[5/5] Executing INTENT-005: Add Integration Tests

Prompt:
Write end-to-end tests for the OAuth flow...

[Olympian implements]
✓ src/__tests__/integration/oauth.test.ts
✓ Tests: signup via Google, account linking, token refresh

[Verification]
✓ npm test (all 47 tests passing)
✓ Code coverage: 98%

Status: INTENT-005 → complete ✓

═════════════════════════════════════════════════════════════

[VERIFICATION CHECKLIST]

✓ All 5 tasks complete
✓ All tests passing (47/47)
✓ No TypeScript errors
✓ No linter errors
✓ Code review checklists signed off
✓ IDEA success metrics addressable
✓ PRD acceptance criteria satisfied
✓ SPEC architectural requirements met

<promise>DONE</promise>

✅ STRUCTURED WORKFLOW COMPLETE
   oauth-auth implementation fully executed

Feature is ready for deployment!
```

---

## Manual Commands

Beyond the automated commands, you can also manage workflows manually.

### Resume an Interrupted Workflow

If a workflow is paused (e.g., you stopped mid-execution):

```bash
> /plan continue

[System detects paused workflow: oauth-auth]
[Loads checkpoint]
[Shows current stage: INTENTS]
[Shows next ready task: INTENT-003]

Resume with: /ascent oauth-auth
```

### View Workflow Checkpoint Details

```bash
> /workflow status
```

Shows all workflows with their current stage and status.

### Delete a Workflow

If you need to start over:

```bash
rm -rf .olympus/workflow/oauth-auth
```

This will:
- Remove all artifacts
- Remove all intents
- Remove checkpoint
- Remove validation results

Next time you run `/idea oauth-auth`, it will start fresh.

---

## Troubleshooting

### Problem: "Workflow not found"

**Cause:** The feature name doesn't match an existing workflow.

**Solution:**
1. Check the exact feature name: `/workflow status`
2. Use the exact name from the status output
3. Or start a new workflow: `/idea {feature}`

### Problem: "IDEA artifact not found when running /prd"

**Cause:** The IDEA stage hasn't completed yet.

**Solution:**
1. Complete the IDEA stage: `/idea {feature}`
2. Then run: `/prd {feature}`

**Note:** Stages must complete in order: IDEA → PRD → SPEC → INTENTS

### Problem: Validation failed, task won't proceed

**Cause:** The artifact didn't meet validation criteria.

**Example:**
```
PRD Validation FAILED
- Coverage: 72% (need 85%)
- Missing: User story for edge case "OAuth token expiration"
- Blocker: Acceptance criteria not specific enough
```

**Solution:**
1. Read the validation report
2. Edit the artifact (`.olympus/workflow/{feature}/{stage}.md`)
3. Re-run the command to re-validate

### Problem: Dependency graph has circular dependencies

**Cause:** Task dependencies form a cycle (A→B→C→A)

**Solution:**
1. Check `.olympus/workflow/{feature}/intents/dependency-graph.json`
2. Edit INTENT files to fix dependencies
3. Re-run `/intents {feature}` to regenerate

### Problem: Task estimated as too large

**Cause:** An INTENT has >5-8 story points of work

**Solution:**
1. Split the task into smaller INTENTs
2. Update INTENT file to be more specific/atomic
3. Re-run `/intents {feature}` to regenerate dependencies

### Problem: Can't execute /ascent, says tasks are blocked

**Cause:** Dependencies haven't been completed yet.

**Solution:**
1. Check the dependency graph: `.olympus/workflow/{feature}/intents/dependency-graph.json`
2. Verify the task you want actually has all dependencies complete
3. Execute tasks in dependency order

**Example:**
```
INTENT-002 is blocked because INTENT-001 is not complete
Execute INTENT-001 first: /ascent INTENT-001 oauth-auth
```

### Problem: Workflow seems stuck in "in_progress" status

**Cause:** A stage was interrupted and never resumed.

**Solution:**
1. Check checkpoint: `.olympus/workflow/{feature}/checkpoint.json`
2. If you want to continue: Run the next command (e.g., `/prd {feature}`)
3. If you want to restart from that stage: Delete the stage artifact and checkpoint

---

## Summary

The Structured Workflow system provides a proven path from idea to implementation:

| Stage | Purpose | Output | Validation |
|-------|---------|--------|-----------|
| **IDEA** | Capture business problem | idea.md | Self (6 criteria) |
| **PRD** | Define user requirements | prd.md | Momus (coverage) |
| **SPEC** | Design technical solution | spec.md | Metis (feasibility) |
| **INTENTS** | Generate executable tasks | INTENT-*.md | Coverage (100%) |
| **EXECUTE** | Run all tasks in order | Feature complete | All tests pass |

**Key Benefits:**
- ✓ Clear progression from concept to code
- ✓ Built-in validation gates
- ✓ Pausable and resumable
- ✓ Comprehensive documentation
- ✓ Ready for code review and team sharing
- ✓ Tracks design decisions and rationale

**Start your first structured workflow:**

```bash
/idea your-feature-name
```

The system will guide you through each stage from there.
