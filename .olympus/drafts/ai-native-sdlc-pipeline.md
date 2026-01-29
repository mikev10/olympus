# AI-Native SDLC Pipeline for Olympus

**Version**: 1.0.0-draft
**Created**: 2026-01-16
**Status**: Draft - Awaiting Review

---

## Executive Summary

This plan extends Olympus from a code-execution orchestrator to a **full software development lifecycle (SDLC) platform**. The system will automate the entire journey from idea capture to production deployment, with AI driving execution and humans providing approval at strategic gates.

### Key Innovations

1. **Intent-Based Work Management**: Replace traditional Scrum hierarchy (Epic → Feature → User Story → Task) with a streamlined AI-native model (Epic → Intent)
2. **AI-Driven Pipeline**: Each SDLC stage is executed by specialized AI agents with human approval gates
3. **Brownfield-First Design**: Comprehensive codebase analysis with cached reference documents to support legacy systems
4. **Session Continuity**: Automatic checkpointing for seamless cross-day handoffs
5. **Stakeholder Visibility**: Sync to Azure DevOps/Jira with role-based approval workflows

---

## Vision & Goals

### The Problem

Current AI coding tools enter the SDLC too late—after humans have already:
- Captured and validated ideas
- Written PRDs and specifications
- Decomposed work into tickets
- Managed backlog in Jira/DevOps

In brownfield projects, this is especially painful because:
- Legacy constraints aren't surfaced until implementation
- Specs assume things about the codebase that aren't true
- Technical debt influences what's possible
- Dependencies are entangled and undocumented

### The Solution

An AI-driven pipeline where:
```
IDEA → PRD → SPEC → INTENTS → CODE → QA → DEPLOY
  ↑      ↑      ↑       ↑        ↑     ↑      ↑
 [H]    [H]    [H]     [H]      [H]   [H]    [H]

 [H] = Human approval gate
```

Each stage:
1. AI executes autonomously
2. Outputs structured artifact
3. Presents to human with summary + recommendations
4. Waits for approval before proceeding
5. On rejection: AI provides fix suggestions, waits for human guidance

### Success Criteria

| Metric | Target |
|--------|--------|
| Time from idea to production | 50%+ reduction |
| PRD/Spec quality | Consistent structure, fewer revision cycles |
| Stakeholder visibility | Real-time status without manual updates |
| Brownfield compatibility | Works with legacy codebases out-of-box |
| Token efficiency | <20% overhead vs current Olympus workflows |

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OLYMPUS SDLC PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐                 │
│  │  IDEA    │──▶│   PRD    │──▶│   SPEC   │──▶│ INTENTS  │                 │
│  │  INTAKE  │   │ WRITER   │   │  WRITER  │   │GENERATOR │                 │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘                 │
│       │              │              │              │                        │
│       ▼              ▼              ▼              ▼                        │
│   idea.md        prd.md         spec.md      .intents/                     │
│       │              │              │              │                        │
│      [H]            [H]            [H]            [H]                       │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                    INTENT EXECUTION ENGINE                            │   │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐              │   │
│  │  │ INTENT  │──▶│ OLYMPUS │──▶│   QA    │──▶│ DEPLOY  │              │   │
│  │  │  001    │   │  EXEC   │   │ VERIFY  │   │  GATE   │              │   │
│  │  └─────────┘   └────┬────┘   └────┬────┘   └────┬────┘              │   │
│  │                     │             │             │                    │   │
│  │                    [H]           [H]           [H]                   │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         SUPPORTING SYSTEMS                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  CODEBASE    │  │   SESSION    │  │   DEVOPS     │  │  APPROVAL    │   │
│  │  ANALYSIS    │  │ CHECKPOINT   │  │    SYNC      │  │   ROLES      │   │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Work Item Hierarchy (AI-Native Scrum)

```
TRADITIONAL                    AI-NATIVE
───────────────────────────    ───────────────────────────
Epic                           Epic
  └─ Feature                     └─ Intent
       └─ User Story                  ├─ Prompt (executable)
            └─ Task                   ├─ Interview Questions
                 └─ Subtask           ├─ Acceptance Criteria
                                      ├─ Dependencies
                                      ├─ Affected Areas
                                      ├─ Assignee (AI/Human)
                                      └─ Handoff Points

                                 (Subtasks handled internally by AI)
```

### Directory Structure

```
project/
├── .olympus/
│   ├── config.jsonc              # Pipeline configuration
│   ├── architecture.md           # Cached codebase analysis (auto-updated)
│   ├── checkpoints/              # Session continuity
│   │   └── 2026-01-16-session.md
│   ├── drafts/                   # Work-in-progress plans
│   └── plans/                    # Approved plans
├── .intents/
│   ├── index.md                  # Intent registry & dependency graph
│   └── {epic-slug}/
│       ├── INTENT-001.intent.md
│       ├── INTENT-002.intent.md
│       └── ...
├── .sdlc/
│   ├── ideas/
│   │   └── {idea-slug}.idea.md
│   ├── prds/
│   │   └── {prd-slug}.prd.md
│   └── specs/
│       └── {spec-slug}.spec.md
└── src/
    └── ... (existing codebase)
```

---

## Component Specifications

### Component 1: Codebase Analysis System

**Purpose**: Generate and maintain a comprehensive reference document of the codebase architecture to avoid redundant token-expensive analysis.

#### 1.1 Initial Analysis Agent (`codebase-analyzer`)

**Trigger**: First run, or when reference doc is missing/stale

**Process**:
1. Scan entire codebase structure
2. Identify architectural patterns
3. Map dependencies and data flow
4. Document tech stack and versions
5. Surface constraints and technical debt
6. Generate `.olympus/architecture.md`

**Output**: `.olympus/architecture.md`

```markdown
# Codebase Architecture Reference

**Generated**: 2026-01-16T14:30:00Z
**Hash**: abc123... (for staleness detection)
**Files Analyzed**: 1,247

## Tech Stack
- Runtime: Node.js 20.x
- Framework: Express 4.18
- Database: PostgreSQL 15 + Redis 7
- ORM: Prisma 5.x
- Auth: Passport.js (local + OAuth)
- Testing: Vitest + Playwright

## Architecture Overview
[Mermaid diagram or structured description]

## Key Modules
### /src/auth
- Purpose: Authentication and session management
- Patterns: Strategy pattern (Passport)
- Dependencies: express-session, connect-redis, passport-*
- Constraints:
  - Session store uses deprecated connect-redis v6 API
  - No support for token refresh currently
- Technical Debt:
  - Mixed callback/promise patterns
  - No rate limiting on auth endpoints

### /src/api
[...]

## Database Schema Summary
[Key tables and relationships]

## External Integrations
[APIs, services, webhooks]

## Known Constraints
1. No downtime deployments required (blue-green)
2. Must support IE11 for legacy customers
3. PCI compliance for payment data

## Migration Considerations
[Common patterns for changes in this codebase]
```

#### 1.2 Staleness Detection Hook

**Trigger**: On significant file changes (configurable threshold)

**Logic**:
```typescript
// Pseudocode
if (changedFiles.some(affectsArchitecture)) {
  markSectionsStale(affectedSections);
  // Does NOT re-analyze immediately
  // Flags for incremental update on next pipeline run
}

function affectsArchitecture(file) {
  return file.matches([
    '**/package.json',
    '**/tsconfig.json',
    '**/prisma/schema.prisma',
    '**/docker-compose.yml',
    'src/*/index.ts',  // Module entry points
    // Configurable patterns
  ]);
}
```

#### 1.3 Incremental Update

**Trigger**: Pipeline start when stale sections exist

**Process**:
1. Identify stale sections from hook flags
2. Re-analyze only affected modules
3. Update architecture.md sections
4. Update hash and timestamp

**Token Efficiency**: ~80-90% reduction vs full re-analysis

---

### Component 2: Idea Intake System

**Purpose**: Structured capture of ideas/VOC with guided questioning.

#### 2.1 Idea Intake Agent (`idea-intake`)

**Model**: Sonnet (interview-capable, cost-effective)

**Trigger**: `/idea` command or API call

**Process**:
1. Greet and explain process
2. Ask structured questions (configurable)
3. Capture responses
4. Generate idea.md
5. Present summary for approval

**Default Interview Questions**:
1. What is the idea? (free-form description)
2. Who requested it? (stakeholder identification)
3. Who are the affected customers/users?
4. What is the expected ROI or business value?
5. Does competition offer this?
6. What is the deadline or urgency?
7. How will we measure success?
8. Are there any KPIs associated?

**Output**: `.sdlc/ideas/{slug}.idea.md`

```markdown
# Idea: Google OAuth Integration

**ID**: IDEA-2026-001
**Created**: 2026-01-16
**Status**: Awaiting PRD
**Requested By**: Product Team (Sarah Chen)

## Description
Allow users to sign in with their Google accounts instead of
creating a separate username/password.

## Business Context
| Question | Answer |
|----------|--------|
| Affected Users | All users, especially new signups |
| ROI | Expected 30% increase in signup conversion |
| Competition | Yes - all major competitors offer this |
| Deadline | Q1 2026 |
| Success Metrics | Signup conversion rate, time-to-first-action |
| KPIs | 30% conversion increase, <5s auth flow |

## Initial Assessment
- **Feasibility**: High (standard OAuth flow)
- **Complexity**: Medium (existing auth system needs modification)
- **Dependencies**: None identified

## Approval
- [ ] Approved for PRD generation
- Approver: _______________
- Date: _______________
```

#### 2.2 Idea Commands

| Command | Description |
|---------|-------------|
| `/idea` | Start new idea intake interview |
| `/idea list` | List all ideas and their status |
| `/idea show <id>` | Display specific idea |
| `/idea approve <id>` | Approve idea for PRD generation |
| `/idea reject <id>` | Reject idea with reason |

---

### Component 3: PRD Generation System

**Purpose**: Generate Product Requirements Document from approved idea + codebase context.

#### 3.1 PRD Writer Agent (`prd-writer`)

**Model**: Opus (complex reasoning, high-quality output)

**Inputs**:
- Approved idea.md
- architecture.md (codebase context)
- Existing PRDs (for style consistency)

**Process**:
1. Analyze idea and codebase context
2. Identify user stories and acceptance criteria
3. Document edge cases
4. Identify dependencies
5. Generate prd.md
6. Present for approval

**Output**: `.sdlc/prds/{slug}.prd.md`

```markdown
# PRD: Google OAuth Integration

**ID**: PRD-2026-001
**Idea**: IDEA-2026-001
**Created**: 2026-01-16
**Status**: Draft
**Author**: AI (prd-writer)

## Overview
Enable users to authenticate using their Google accounts,
providing a faster signup/login experience.

## User Stories

### US-1: New User Google Signup
**As a** new user
**I want to** sign up using my Google account
**So that** I don't have to create and remember another password

**Acceptance Criteria**:
- [ ] "Sign in with Google" button on signup page
- [ ] Clicking initiates Google OAuth flow
- [ ] On success, account created with Google email
- [ ] User redirected to onboarding flow
- [ ] If email exists, prompt to link accounts

### US-2: Existing User Google Login
**As an** existing user with linked Google account
**I want to** log in using Google
**So that** I can access my account quickly

**Acceptance Criteria**:
- [ ] "Sign in with Google" button on login page
- [ ] Successful auth logs user in
- [ ] Session persists according to existing rules

### US-3: Account Linking
**As an** existing user with email/password
**I want to** link my Google account
**So that** I can use either method to log in

**Acceptance Criteria**:
- [ ] Link option in account settings
- [ ] Verify ownership via Google OAuth
- [ ] Store association in database
- [ ] Show linked status in settings

## Edge Cases
1. **Email mismatch**: User's Google email differs from account email
2. **Multiple Google accounts**: User has multiple Google accounts
3. **Unlink request**: User wants to remove Google association
4. **Google account deleted**: Linked Google account no longer exists
5. **Rate limiting**: Too many OAuth attempts

## Dependencies
- Google Cloud Console project (API credentials)
- passport-google-oauth20 package
- Database migration for OAuth tokens

## Out of Scope
- Other OAuth providers (Apple, GitHub) - future work
- Enterprise SSO/SAML
- MFA integration with Google

## Codebase Impact
*From architecture.md analysis:*
- **Affected Modules**: src/auth/, src/models/user.ts, src/routes/auth.ts
- **Constraints**: Session store uses connect-redis v6 (may need upgrade)
- **Technical Debt**: Existing auth has mixed callback/promise patterns

## Approval
- [ ] Product Manager: _______________
- [ ] Tech Lead: _______________
- Date: _______________
```

#### 3.2 PRD Commands

| Command | Description |
|---------|-------------|
| `/prd <idea-id>` | Generate PRD from approved idea |
| `/prd list` | List all PRDs and status |
| `/prd show <id>` | Display specific PRD |
| `/prd approve <id>` | Approve PRD for spec generation |
| `/prd reject <id>` | Reject with feedback |

---

### Component 4: Specification Generation System

**Purpose**: Generate technical specification from approved PRD + deep codebase analysis.

#### 4.1 Spec Writer Agent (`spec-writer`)

**Model**: Opus (architectural reasoning required)

**Inputs**:
- Approved prd.md
- architecture.md
- Relevant source files (deep read)

**Process**:
1. Deep-dive affected code areas
2. Design technical approach
3. Define API contracts
4. Specify data models
5. Document integration points
6. Generate spec.md
7. Present for approval

**Output**: `.sdlc/specs/{slug}.spec.md`

```markdown
# Technical Specification: Google OAuth Integration

**ID**: SPEC-2026-001
**PRD**: PRD-2026-001
**Created**: 2026-01-16
**Status**: Draft
**Author**: AI (spec-writer)

## Technical Design

### Approach
Implement Google OAuth2 using passport-google-oauth20 strategy,
integrating with existing Passport.js authentication system.

### Architecture Decision
**Options Considered**:
1. Add strategy to existing Passport setup (recommended)
2. Implement custom OAuth2 flow
3. Use third-party auth service (Auth0, etc.)

**Decision**: Option 1 - consistent with existing patterns,
minimal disruption, leverages existing session management.

## API Contracts

### GET /auth/google
Initiates Google OAuth flow.

**Response**: 302 Redirect to Google consent screen

### GET /auth/google/callback
Handles OAuth callback from Google.

**Query Parameters**:
- `code`: Authorization code from Google
- `state`: CSRF token

**Responses**:
- 302 → `/dashboard` (success, existing user)
- 302 → `/onboarding` (success, new user)
- 302 → `/auth/link-account?email=...` (email exists, not linked)
- 302 → `/login?error=oauth_failed` (failure)

### POST /api/user/link-google
Links Google account to existing user.

**Headers**: `Authorization: Bearer <token>`

**Body**: `{ googleIdToken: string }`

**Responses**:
- 200: `{ linked: true, googleEmail: string }`
- 400: `{ error: "already_linked" }`
- 401: Unauthorized

### DELETE /api/user/unlink-google
Removes Google account link.

**Headers**: `Authorization: Bearer <token>`

**Responses**:
- 200: `{ unlinked: true }`
- 400: `{ error: "no_google_linked" }`
- 400: `{ error: "only_auth_method" }` (can't unlink if no password)

## Data Models

### Migration: Add OAuth tokens table

```sql
CREATE TABLE oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL, -- 'google'
  provider_user_id VARCHAR(255) NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_oauth_tokens_user_id ON oauth_tokens(user_id);
CREATE INDEX idx_oauth_tokens_provider ON oauth_tokens(provider, provider_user_id);
```

### User Model Extension

```typescript
// Extend existing User type
interface User {
  // ... existing fields
  oauthTokens?: OAuthToken[];
  hasGoogleLinked?: boolean;
}
```

## File Changes

| File | Change Type | Description |
|------|-------------|-------------|
| src/auth/strategies/google.ts | Create | Google OAuth strategy |
| src/auth/index.ts | Modify | Register Google strategy |
| src/routes/auth.ts | Modify | Add OAuth routes |
| src/routes/api/user.ts | Modify | Add link/unlink endpoints |
| src/models/oauth-token.ts | Create | OAuthToken model |
| src/models/user.ts | Modify | Add OAuth relations |
| prisma/schema.prisma | Modify | Add OAuthToken model |
| migrations/xxx_oauth_tokens.sql | Create | Database migration |

## Dependencies

### New Packages
```json
{
  "passport-google-oauth20": "^2.0.0",
  "@types/passport-google-oauth20": "^2.0.0"
}
```

### Environment Variables
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

## Security Considerations

1. **Token Storage**: Encrypt refresh tokens at rest (AES-256)
2. **CSRF**: Use `state` parameter in OAuth flow
3. **Rate Limiting**: 10 OAuth attempts per minute per IP
4. **Token Rotation**: Rotate refresh tokens on each use
5. **Scope Minimization**: Request only `email` and `profile` scopes

## Testing Strategy

### Unit Tests
- Strategy configuration
- Token encryption/decryption
- User model OAuth methods

### Integration Tests
- Full OAuth flow (mocked Google)
- Account linking flow
- Edge cases (email mismatch, etc.)

### E2E Tests
- Real Google OAuth (test credentials)
- UI button clicks through to success

## Rollout Plan

1. **Phase 1**: Internal testing (feature flag)
2. **Phase 2**: Beta users (10%)
3. **Phase 3**: General availability

## Approval
- [ ] Tech Lead: _______________
- [ ] Security Review: _______________
- Date: _______________
```

#### 4.2 Spec Commands

| Command | Description |
|---------|-------------|
| `/spec <prd-id>` | Generate spec from approved PRD |
| `/spec list` | List all specs and status |
| `/spec show <id>` | Display specific spec |
| `/spec approve <id>` | Approve spec for intent generation |
| `/spec reject <id>` | Reject with feedback |

---

### Component 5: Intent Generation System

**Purpose**: Decompose approved specification into executable Intents.

#### 5.1 Intent Generator Agent (`intent-generator`)

**Model**: Opus (decomposition requires architectural understanding)

**Inputs**:
- Approved spec.md
- architecture.md
- Existing intents (for consistency)

**Process**:
1. Analyze spec for logical work units
2. Identify dependencies between units
3. Generate atomic Intents
4. Create dependency graph
5. Present for approval

**Output**: `.intents/{epic}/INTENT-XXX.intent.md`

#### 5.2 Intent File Format

```markdown
# INTENT-001: Google OAuth Strategy Setup

---
id: INTENT-001
epic: google-oauth
spec: SPEC-2026-001
title: Google OAuth Strategy Setup
status: pending
assignee: ai
priority: 1
dependencies: []
blocks: [INTENT-002, INTENT-003]
created: 2026-01-16
updated: 2026-01-16
devops_id: null  # Populated when synced
---

## Prompt

Create the Google OAuth2 Passport strategy that integrates with our
existing authentication system. The strategy should:

1. Use passport-google-oauth20
2. Handle both new user creation and existing user login
3. Support account linking for users with matching email
4. Store OAuth tokens in the new oauth_tokens table

Reference the existing local strategy in src/auth/strategies/local.ts
for patterns.

## Interview Questions

Before starting, clarify:
- Should we auto-create accounts for new Google users, or require explicit signup first?
- For email matches, should we auto-link or require user confirmation?
- What user profile fields should we pull from Google? (name, avatar, etc.)

## Acceptance Criteria

- [ ] passport-google-oauth20 installed and configured
- [ ] Google strategy created in src/auth/strategies/google.ts
- [ ] Strategy registered in src/auth/index.ts
- [ ] Unit tests for strategy logic
- [ ] Works with existing session management

## Affected Areas

From codebase analysis:
- src/auth/ - Main auth module
- src/config/passport.ts - Strategy registration
- package.json - New dependency

## Technical Notes

- Existing session store uses connect-redis v6
- Auth module uses mixed callback/promise patterns (follow existing style)
- See SPEC-2026-001 for full API contracts

## Handoff Points

- After completion: Security review of token handling
- Blocks: INTENT-002 (OAuth routes), INTENT-003 (Token model)

## Progress

<!-- Updated by AI during execution -->

## Completion

- [ ] Code complete
- [ ] Tests passing
- [ ] PR ready for review
```

#### 5.3 Intent Registry

`.intents/index.md`:

```markdown
# Intent Registry

**Epic**: google-oauth
**Spec**: SPEC-2026-001
**Generated**: 2026-01-16

## Dependency Graph

```
INTENT-001 (OAuth Strategy) ─┬──▶ INTENT-002 (OAuth Routes)
                             │
                             └──▶ INTENT-003 (Token Model)
                                       │
INTENT-002 ──────────────────┬─────────┘
                             │
                             ▼
                       INTENT-004 (Account Linking)
                             │
                             ▼
                       INTENT-005 (UI Components)
                             │
                             ▼
                       INTENT-006 (E2E Tests)
```

## Status Summary

| Intent | Title | Status | Assignee | Priority |
|--------|-------|--------|----------|----------|
| INTENT-001 | OAuth Strategy Setup | pending | ai | 1 |
| INTENT-002 | OAuth Routes | pending | ai | 2 |
| INTENT-003 | Token Model & Migration | pending | ai | 2 |
| INTENT-004 | Account Linking | pending | ai | 3 |
| INTENT-005 | UI Components | pending | ai | 4 |
| INTENT-006 | E2E Tests | pending | ai | 5 |

## Approval

- [ ] Intent decomposition approved
- Approver: _______________
- Date: _______________
```

#### 5.4 Intent Commands

| Command | Description |
|---------|-------------|
| `/intents generate <spec-id>` | Generate intents from spec |
| `/intents list [epic]` | List intents, optionally filtered by epic |
| `/intents show <id>` | Display specific intent |
| `/intents graph [epic]` | Show dependency graph |
| `/intents approve <id>` | Approve intent for execution |
| `/intents approve-all <epic>` | Approve all intents in epic |
| `/intents start <id>` | Begin executing an intent |
| `/intents status` | Show execution status |

---

### Component 6: Intent Execution Engine

**Purpose**: Execute approved Intents using existing Olympus orchestration.

#### 6.1 Execution Flow

```
Intent Approved
      │
      ▼
┌─────────────────┐
│ Load Intent     │
│ - Read prompt   │
│ - Check deps    │
│ - Load context  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Interview Phase │◀──┐
│ (if questions)  │   │
└────────┬────────┘   │
         │            │
         ▼            │
      [Human]─────────┘ (answer questions)
         │
         ▼
┌─────────────────┐
│ Olympus Execute │
│ - TodoWrite     │
│ - Agent delegation │
│ - Loop until done │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Verify Complete │
│ - Check criteria│
│ - Run tests     │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
   Pass      Fail
    │         │
    ▼         ▼
 [Human]   Continue
  Gate      Loop
```

#### 6.2 Integration with Olympus

The Intent Execution Engine uses existing Olympus components:

| Olympus Component | Role in Intent Execution |
|-------------------|--------------------------|
| TodoWrite | Track subtasks within intent |
| Agents (olympian, oracle, etc.) | Execute specialized work |
| `/complete-plan` pattern | Verify acceptance criteria |
| Background execution | Long-running tasks |
| Hooks | Status updates, checkpoints |

#### 6.3 Execution Commands

| Command | Description |
|---------|-------------|
| `/intent run <id>` | Execute single intent |
| `/intent run-next <epic>` | Execute next ready intent |
| `/intent run-all <epic>` | Execute all ready intents (with gates) |
| `/intent pause <id>` | Pause execution |
| `/intent resume <id>` | Resume paused execution |

---

### Component 7: Session Checkpoint System

**Purpose**: Automatically capture session state for cross-day continuity.

#### 7.1 Checkpoint Structure

`.olympus/checkpoints/{date}-session.md`:

```markdown
# Session Checkpoint

**Date**: 2026-01-16
**Time**: 17:45:00
**Duration**: 4h 23m
**Auto-generated**: true

## Active Work

### Epic: google-oauth
**Intent**: INTENT-002 (OAuth Routes)
**Status**: in_progress

### Todo State
```json
[
  {"content": "Create GET /auth/google route", "status": "completed"},
  {"content": "Create callback route", "status": "completed"},
  {"content": "Handle error cases", "status": "in_progress"},
  {"content": "Add rate limiting", "status": "pending"},
  {"content": "Write route tests", "status": "pending"}
]
```

## Completed This Session

- [x] INTENT-001: OAuth Strategy Setup
- [x] Installed passport-google-oauth20
- [x] Created strategy file
- [x] Registered with Passport

## Decisions Made

1. **Auto-create accounts**: Yes, for new Google users
2. **Email matching**: Require user confirmation before linking
3. **Profile fields**: Pull name and avatar from Google

## Blockers Encountered

1. **connect-redis v6**: Deprecated API, works but logs warnings
   - Decision: Defer upgrade to separate intent
   - Workaround: Suppress warnings for now

## Key Files Modified

- src/auth/strategies/google.ts (created)
- src/auth/index.ts (modified)
- src/routes/auth.ts (in progress)
- package.json (modified)

## Resume Prompt

Continue implementing OAuth routes for Google authentication.
Currently working on error handling for the callback route.
The happy path works, need to handle:
- OAuth denial by user
- Invalid state token (CSRF)
- Google API errors

See src/routes/auth.ts:45-80 for current progress.

## Conversation Summary

[AI-generated summary of key discussion points]
```

#### 7.2 Checkpoint Triggers

| Trigger | Behavior |
|---------|----------|
| Session end (user exits) | Auto-generate checkpoint |
| `/checkpoint` command | Manual checkpoint |
| Long idle (30 min) | Auto-checkpoint + notify |
| Intent completion | Checkpoint + status update |

#### 7.3 Resume Flow

```
/resume
   │
   ▼
┌─────────────────┐
│ Load checkpoint │
│ - Read latest   │
│ - Parse state   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Restore state   │
│ - Load todos    │
│ - Set context   │
│ - Load intent   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Confirm resume  │
│ "Continue from  │
│  [summary]?"    │
└────────┬────────┘
         │
         ▼
      [Human]
      Confirm
         │
         ▼
   Continue work
```

#### 7.4 Checkpoint Commands

| Command | Description |
|---------|-------------|
| `/checkpoint` | Create manual checkpoint |
| `/checkpoint show` | Display current session state |
| `/resume` | Resume from latest checkpoint |
| `/resume <date>` | Resume from specific checkpoint |
| `/checkpoints list` | List available checkpoints |

---

### Component 8: DevOps Sync System

**Purpose**: Bidirectional sync between Intent system and Azure DevOps/Jira.

#### 8.1 Sync Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SYNC ENGINE                               │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  .intents/*.md ◀──────────────────────▶ Azure DevOps        │
│                      Bidirectional                           │
│                                                              │
│  Sync Events:                                                │
│  - Intent created → Create work item                         │
│  - Intent updated → Update work item                         │
│  - Work item updated → Update intent (if changed externally) │
│  - Status changed → Sync both directions                     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### 8.2 Field Mapping

| Intent Field | Azure DevOps Field | Jira Field |
|--------------|-------------------|------------|
| id | Custom field | Custom field |
| title | Title | Summary |
| prompt | Description | Description |
| status | State | Status |
| assignee | Assigned To | Assignee |
| priority | Priority | Priority |
| epic | Parent (Epic) | Epic Link |
| acceptance_criteria | Acceptance Criteria | AC field |

#### 8.3 Stakeholder View Translation

Intents appear in DevOps/Jira as regular work items:

| Internal (Intent) | External (Stakeholder View) |
|-------------------|----------------------------|
| INTENT-001 | Work Item #142: "OAuth Strategy Setup" |
| Status: in_progress | Status: Active |
| Assignee: ai | Assignee: "AI Agent" (service account) |
| 3/5 subtasks done | Progress: 60% |

#### 8.4 Sync Commands

| Command | Description |
|---------|-------------|
| `/sync setup` | Configure DevOps/Jira connection |
| `/sync push` | Push local intents to DevOps |
| `/sync pull` | Pull DevOps updates to local |
| `/sync status` | Show sync status |
| `/sync auto on/off` | Enable/disable auto-sync |

**MVP Note**: Sync is optional for MVP. Markdown-only workflow is fully functional.

---

### Component 9: Human Gate System

**Purpose**: Manage approval workflows with role-based permissions.

#### 9.1 Gate Types

| Gate | Default Approvers | Artifact |
|------|-------------------|----------|
| Idea | Product Manager | idea.md |
| PRD | Product Manager, Tech Lead | prd.md |
| Spec | Tech Lead, Security (if applicable) | spec.md |
| Intents | Tech Lead | .intents/*.md |
| Code PR | Tech Lead, Peer | Pull Request |
| QA | QA Lead | Test Report |
| Deploy | Release Manager | Deployment |

#### 9.2 Gate Modes

**Blocking (default)**:
```
AI completes work
       │
       ▼
   Present to
    approver
       │
       ▼
   [WAIT for
    response]
       │
   ┌───┴───┐
   │       │
Approve  Reject
   │       │
   ▼       ▼
Continue  AI provides
          suggestions,
          waits for
          guidance
```

**Notification (flag: `--notify`)**:
```
AI completes work
       │
       ▼
   Flag for review
       │
       ▼
   Continue to next
   stage (provisional)
       │
       ▼
   If rejected later,
   rollback or revise
```

#### 9.3 Rejection Handling

On rejection, the system:
1. Records rejection reason
2. AI analyzes feedback
3. AI provides recommended fixes
4. AI waits for human guidance
5. Human can:
   - Accept AI recommendations
   - Provide different guidance
   - Take over manually

**Example rejection flow**:
```
Reviewer: Reject - "Security concern: tokens should be encrypted"

AI Response:
"Understood. I recommend the following changes:

1. Add AES-256 encryption for refresh tokens in oauth_tokens table
2. Add encryption key to environment variables
3. Update token storage/retrieval to encrypt/decrypt

Files affected:
- src/models/oauth-token.ts (add encryption)
- src/config/index.ts (add encryption key config)

Do you want me to proceed with these changes, or do you have
different guidance?"
```

#### 9.4 Gate Commands

| Command | Description |
|---------|-------------|
| `/gate status` | Show pending approvals |
| `/gate approve <artifact>` | Approve artifact |
| `/gate reject <artifact>` | Reject with feedback |
| `/gate delegate <artifact> <user>` | Delegate approval |
| `/gate config` | Configure approvers by role |

---

### Component 10: QA Verification System

**Purpose**: Verify implementation matches PRD/Spec before deployment.

#### 10.1 QA Generator Agent (`qa-generator`)

**Model**: Sonnet (test generation is well-understood)

**Inputs**:
- spec.md (test requirements)
- Implemented code
- Existing test patterns

**Process**:
1. Parse acceptance criteria from spec
2. Generate test cases (unit, integration, e2e)
3. Map tests to requirements
4. Execute test suite
5. Generate coverage report
6. Present for QA approval

#### 10.2 Compliance Checker

Verifies implementation matches original PRD/Spec:

```
┌─────────────────┐     ┌─────────────────┐
│    PRD.md       │     │   Implemented   │
│    SPEC.md      │────▶│     Code        │
│   Intents       │     │                 │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
            ┌─────────────────┐
            │   Compliance    │
            │    Checker      │
            └────────┬────────┘
                     │
                     ▼
            ┌─────────────────┐
            │   Gap Report    │
            │ - Missing items │
            │ - Deviations    │
            │ - Suggestions   │
            └─────────────────┘
```

#### 10.3 QA Commands

| Command | Description |
|---------|-------------|
| `/qa generate <spec-id>` | Generate test cases from spec |
| `/qa run` | Execute test suite |
| `/qa compliance <spec-id>` | Check implementation vs spec |
| `/qa report` | Generate QA report |

---

### Component 11: Deployment Gate

**Purpose**: Manage deployment approvals and execution.

#### 11.1 Deployment Checklist

Before deployment, verify:
- [ ] All intents complete
- [ ] All tests passing
- [ ] Compliance check passed
- [ ] Security review complete (if applicable)
- [ ] Documentation updated
- [ ] Rollback plan documented

#### 11.2 Deployment Commands

| Command | Description |
|---------|-------------|
| `/deploy check <epic>` | Verify deployment readiness |
| `/deploy plan <epic>` | Generate deployment plan |
| `/deploy execute <epic>` | Execute deployment (with gate) |
| `/deploy rollback <epic>` | Rollback deployment |

---

## Implementation Phases

### Phase 1: Foundation (MVP)

**Goal**: Core pipeline with markdown-only workflow

**Components**:
1. Codebase Analysis System (initial + staleness hooks)
2. Idea Intake Agent
3. PRD Writer Agent
4. Session Checkpoint System (auto-generate)

**Deliverables**:
- `.olympus/architecture.md` generation
- `/idea` command with interview flow
- `/prd` command with codebase-aware generation
- `/checkpoint` and `/resume` commands
- Basic human gates (blocking mode)

**Dependencies**: None (builds on existing Olympus)

---

### Phase 2: Specification & Intents

**Goal**: Complete document generation pipeline

**Components**:
1. Spec Writer Agent
2. Intent Generator Agent
3. Intent File Format & Registry
4. Dependency Graph Management

**Deliverables**:
- `/spec` command with deep codebase analysis
- `/intents generate` command
- `.intents/` directory structure
- Intent dependency visualization
- Intent approval workflow

**Dependencies**: Phase 1 complete

---

### Phase 3: Execution Engine

**Goal**: Intent execution with Olympus integration

**Components**:
1. Intent Execution Engine
2. Interview Phase for Intents
3. Acceptance Criteria Verification
4. Progress Tracking & Updates

**Deliverables**:
- `/intent run` commands
- Automatic todo generation from intents
- Integration with existing agents
- Real-time progress updates to intent files

**Dependencies**: Phase 2 complete

---

### Phase 4: QA & Compliance

**Goal**: Automated testing and verification

**Components**:
1. QA Generator Agent
2. Compliance Checker
3. Gap Report Generation
4. Test Execution Integration

**Deliverables**:
- `/qa generate` command
- `/qa compliance` command
- PRD/Spec traceability matrix
- Automated test suggestions

**Dependencies**: Phase 3 complete

---

### Phase 5: DevOps Integration

**Goal**: External system synchronization

**Components**:
1. Azure DevOps Sync
2. Jira Sync (adapter pattern)
3. Bidirectional Status Updates
4. Stakeholder View Translation

**Deliverables**:
- `/sync` commands
- Azure DevOps work item creation
- Status synchronization
- Configurable field mapping

**Dependencies**: Phase 4 complete (can be parallelized)

---

### Phase 6: Advanced Gates & Roles

**Goal**: Enterprise-ready approval workflows

**Components**:
1. Role-Based Approvers
2. Notification Mode
3. Delegation Workflow
4. Audit Trail

**Deliverables**:
- Configurable approver roles
- `--notify` flag for async approval
- Delegation commands
- Approval history tracking

**Dependencies**: Phase 5 complete

---

## Technical Implementation

### New Agents

| Agent | File | Model | Purpose |
|-------|------|-------|---------|
| `codebase-analyzer` | `src/agents/codebase-analyzer.ts` | Opus | Initial codebase analysis |
| `idea-intake` | `src/agents/idea-intake.ts` | Sonnet | VOC interview |
| `prd-writer` | `src/agents/prd-writer.ts` | Opus | PRD generation |
| `spec-writer` | `src/agents/spec-writer.ts` | Opus | Technical spec |
| `intent-generator` | `src/agents/intent-generator.ts` | Opus | Work decomposition |
| `qa-generator` | `src/agents/qa-generator.ts` | Sonnet | Test generation |
| `compliance-checker` | `src/agents/compliance-checker.ts` | Sonnet | Spec verification |

### New Slash Commands

| Command | File | Description |
|---------|------|-------------|
| `/idea` | `.claude/commands/idea.md` | Idea intake |
| `/prd` | `.claude/commands/prd.md` | PRD generation |
| `/spec` | `.claude/commands/spec.md` | Spec generation |
| `/intents` | `.claude/commands/intents.md` | Intent management |
| `/intent` | `.claude/commands/intent.md` | Intent execution |
| `/checkpoint` | `.claude/commands/checkpoint.md` | Session save |
| `/resume` | `.claude/commands/resume.md` | Session restore |
| `/qa` | `.claude/commands/qa.md` | QA operations |
| `/sync` | `.claude/commands/sync.md` | DevOps sync |
| `/gate` | `.claude/commands/gate.md` | Approval management |
| `/deploy` | `.claude/commands/deploy.md` | Deployment |

### New Hooks

| Hook | File | Trigger | Purpose |
|------|------|---------|---------|
| `architecture-staleness` | `src/hooks/architecture-staleness.ts` | File change | Flag stale sections |
| `auto-checkpoint` | `src/hooks/auto-checkpoint.ts` | Session end | Save state |
| `intent-progress` | `src/hooks/intent-progress.ts` | Todo update | Sync to intent file |
| `gate-notification` | `src/hooks/gate-notification.ts` | Stage complete | Notify approvers |

### Configuration Schema

```typescript
// src/shared/types.ts - extend existing config

interface SDLCConfig {
  // Codebase Analysis
  analysis: {
    autoUpdate: boolean;
    stalenessPatterns: string[];
    excludePatterns: string[];
  };

  // Pipeline
  pipeline: {
    stages: ('idea' | 'prd' | 'spec' | 'intents' | 'code' | 'qa' | 'deploy')[];
    gateMode: 'blocking' | 'notification';
  };

  // Approvers
  approvers: {
    idea: string[];      // Role names or user IDs
    prd: string[];
    spec: string[];
    intents: string[];
    code: string[];
    qa: string[];
    deploy: string[];
  };

  // DevOps Integration
  devops: {
    provider: 'azure-devops' | 'jira' | 'none';
    connection?: {
      url: string;
      project: string;
      token: string;  // Reference to env var
    };
    autoSync: boolean;
    fieldMapping: Record<string, string>;
  };

  // Session
  session: {
    autoCheckpoint: boolean;
    checkpointDir: string;
    idleCheckpointMinutes: number;
  };
}
```

---

## Success Metrics

### Quantitative

| Metric | Measurement | Target |
|--------|-------------|--------|
| Cycle Time | Days from idea.md to deployment | 50% reduction |
| Revision Cycles | PRD/Spec rejections before approval | <2 average |
| Token Efficiency | Tokens used vs. baseline Olympus | <120% |
| Automation Rate | % of pipeline stages handled by AI | >80% |
| Test Coverage | Auto-generated tests covering spec | >70% |

### Qualitative

| Metric | Measurement | Target |
|--------|-------------|--------|
| Artifact Quality | Consistency, completeness of outputs | High (subjective) |
| Stakeholder Satisfaction | Can track progress without training | Yes |
| Developer Experience | Friction in approval workflow | Low |
| Brownfield Compatibility | Works with legacy codebases | Yes |

### Measurement Approach

1. **Baseline**: Measure current manual SDLC metrics before rollout
2. **A/B Testing**: Run parallel with traditional workflow initially
3. **Feedback Loop**: Collect user feedback per phase
4. **Iteration**: Adjust based on metrics after each phase

---

## Risks and Mitigations

### Risk 1: Token Cost Explosion

**Risk**: Comprehensive codebase analysis burns excessive tokens

**Mitigation**:
- Cache architecture.md and use incremental updates
- Smart staleness detection (only re-analyze what changed)
- Token budgets per operation
- Cost monitoring dashboard

### Risk 2: Low-Quality AI Outputs

**Risk**: PRDs/Specs don't meet human quality bar

**Mitigation**:
- Use Opus for complex generation tasks
- Include human examples in prompts
- Iterative refinement based on rejections
- Quality gates at each stage

### Risk 3: Approval Fatigue

**Risk**: Too many gates slow down workflow

**Mitigation**:
- Notification mode for trusted users
- Batch approvals for related items
- Smart defaults (auto-approve low-risk items)
- Configurable gate granularity

### Risk 4: DevOps Sync Conflicts

**Risk**: External changes conflict with local intents

**Mitigation**:
- Local-first architecture (markdown is source of truth)
- Conflict detection and resolution UI
- Audit trail for sync operations
- Manual override option

### Risk 5: Session State Loss

**Risk**: Checkpoints don't capture enough context

**Mitigation**:
- Comprehensive checkpoint format
- Include conversation summary
- Test resume flow extensively
- Manual checkpoint option for critical points

### Risk 6: Brownfield Complexity

**Risk**: Codebase analysis misses critical constraints

**Mitigation**:
- Human review of architecture.md
- Flag "low confidence" areas
- Allow manual additions to architecture doc
- Iterative improvement based on implementation failures

---

## Appendices

### Appendix A: Command Reference

[Complete list of all new commands with examples]

### Appendix B: File Format Specifications

[Detailed schemas for idea.md, prd.md, spec.md, intent.md]

### Appendix C: Agent Prompt Templates

[Full prompts for each new agent]

### Appendix D: Migration Guide

[How to adopt SDLC pipeline in existing projects]

---

## Approval

### Plan Review

- [ ] Technical review complete
- [ ] Scope review complete
- [ ] Risk assessment complete

### Implementation Approval

- [ ] Phase 1 approved to begin
- Approver: _______________
- Date: _______________

---

*This plan was generated by Prometheus strategic planning.*
*Ready for review with `/review`*