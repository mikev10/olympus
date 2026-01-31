# Olympus Workflow Guide

A practical guide to choosing the right workflow for your task and executing it effectively with Olympus.

---

## TL;DR - Decision Flow

```
How complex is your task?
├─ Simple (1-2 steps, single file)
│  └─ Just prompt normally in Claude Code
│
├─ Standard (multi-step, clear requirements)
│  └─ Use /olympus <task>
│
├─ Fast & Parallel (independent subtasks)
│  └─ Use /ultrawork <task>
│
├─ Complex & Unclear (need planning)
│  └─ Use /plan → answer questions → /olympus
│
└─ Must Complete (critical, can't be partial)
   └─ Use /ascent <task>
```

**Quick Reference:**

| Keyword | Command | When to Use |
|---------|---------|-------------|
| Quick fix | Normal prompt | Single-file, < 5 lines, obvious solution |
| Standard | `/olympus` | Multi-step, delegatable, clear scope |
| Maximum speed | `/ultrawork` | Many independent tasks, speed critical |
| Need clarity | `/plan` | Requirements unclear, strategic decisions needed |
| Must finish | `/ascent` | Critical task, cannot be incomplete |

---

## 1. Workflow Overview

Olympus provides multiple workflows optimized for different scenarios. Understanding when to use each maximizes your productivity.

### The Four Core Workflows

```mermaid
flowchart LR
    Request[Task Request]

    Request --> Simple[Simple Task]
    Request --> Standard[Standard Task]
    Request --> Complex[Complex Task]
    Request --> Critical[Critical Task]

    Simple --> Normal[Normal Prompt]
    Standard --> Olympus["/olympus"]
    Complex --> Plan["/plan"]
    Critical --> Ascent["/ascent"]

    Normal --> Done1[Direct Execution]
    Olympus --> Delegate[Delegation + Todos]
    Plan --> Interview[Prometheus Interview]
    Ascent --> Guarantee[Continuation Guarantee]

    Delegate --> Done2[Verified Complete]
    Interview --> Execute["/olympus execution"]
    Execute --> Done3[Plan Complete]
    Guarantee --> Done4[Cannot Stop Early]
```

---

## 2. Workflow Selection Guide

### When to Use Normal Prompts

**Best for:**
- Single-file edits (< 5 lines)
- Obvious fixes with clear solutions
- Quick lookups or explanations
- File reads or simple searches

**Example:**
```
> Fix the typo in line 42 of auth.ts
> What does this function do?
> Read the config file
```

**Why not Olympus?** Overhead of todo creation and delegation isn't worth it for trivial tasks.

---

### When to Use `/olympus`

**Best for:**
- Multi-file changes (2+ files)
- Tasks requiring specialized agents (architecture, UI, docs)
- Standard feature implementation
- Refactoring with clear scope
- Tasks you want to track with todos

**Example:**
```
> /olympus implement JWT authentication
> /olympus refactor the API layer to use async/await
> /olympus add validation to all user inputs
```

**What happens:**
1. Creates todo list automatically
2. Delegates to appropriate agents (Oracle for analysis, Olympian for implementation)
3. Tracks progress with checkboxes
4. Verifies each step before marking complete
5. Learns from your corrections

**When to skip:** Task is unclear, requirements are ambiguous, or you need strategic planning first.

---

### When to Use `/ultrawork`

**Best for:**
- Tasks with many independent subtasks
- Speed is critical
- Research and documentation (parallel searches)
- Large refactoring across many files
- When you want maximum throughput

**Example:**
```
> /ultrawork document all API endpoints
> /ultrawork refactor entire authentication system
> /ultrawork research and implement caching strategy
```

**What changes from `/olympus`:**
- Spawns multiple agents **in parallel** (3-5 concurrent)
- Doesn't wait for one task to finish before starting the next
- Background execution for all compatible operations
- More aggressive delegation (even small tasks)
- Continues until ALL tasks verified complete

**Trade-off:** Higher token usage, but 3-5x faster completion.

---

### When to Use `/plan` → `/olympus`

**Best for:**
- Complex projects (multi-day work)
- Unclear or evolving requirements
- Strategic decisions needed (architecture, tech stack, approach)
- Critical production changes where mistakes are costly
- Learning projects where you want to understand before implementing
- Tasks where you're not sure what the right approach is

**Example:**
```
> /plan migrate from REST API to GraphQL
> /plan build real-time collaboration features
> /plan refactor monolith to microservices
```

**The Planning Workflow:**

```mermaid
sequenceDiagram
    participant You
    participant Prometheus
    participant Explore as Explore Agent
    participant Librarian as Librarian Agent
    participant Plan as .olympus/plans/
    participant Claude as Claude (Olympus)

    You->>Prometheus: /plan <description>
    Prometheus->>Prometheus: Enter interview mode

    par Research Phase
        Prometheus->>Explore: Search codebase patterns
        Prometheus->>Librarian: Research best practices
    end

    Explore->>Prometheus: Existing patterns found
    Librarian->>Prometheus: Documentation & examples

    loop Interview
        Prometheus->>You: Clarifying question
        You->>Prometheus: Answer
        Note over Prometheus: Builds understanding
    end

    You->>Prometheus: "Create the plan"
    Prometheus->>Plan: Write comprehensive plan
    Plan->>You: .olympus/plans/migration.md

    You->>Claude: /olympus
    Claude->>Plan: Read plan
    Claude->>Claude: Execute plan tasks
    Claude->>You: Implementation complete
```

**Benefits:**
- Requirements are clarified upfront
- Strategic decisions documented
- Can review plan before execution
- Less back-and-forth during implementation
- Plan serves as documentation

---

### When to Use `/ascent`

**Best for:**
- Must-complete tasks (all tests must pass, all errors must be fixed)
- Critical bug fixes that need full resolution
- Tasks that often get abandoned incomplete
- When you need a guarantee of completion
- Clean-up tasks (fix all linter errors, resolve all TODOs)

**Example:**
```
> /ascent fix all TypeScript errors
> /ascent resolve all failing tests
> /ascent complete the authentication implementation
```

**What The Ascent guarantees:**
1. Creates comprehensive todo list
2. **Cannot stop until all todos are complete**
3. System reminder if attempting to exit early
4. Re-verification if any step fails
5. Only exits via `<promise>DONE</promise>` or user cancellation

**Warning:** Use this when you're committed to finishing. The Ascent Never Ends.

**Exit conditions:**
- ✅ `<promise>DONE</promise>` - All verified complete
- ✅ `/cancel-ascent` - Manual cancellation
- ❌ "Stop" or "that's enough" - Ignored, continuation enforced

---

## 3. Detailed Workflow Examples

### Workflow 1: Standard Feature Implementation

**Scenario:** Add user profile editing functionality

**Approach:** `/olympus`

```bash
> /olympus add user profile editing with avatar upload
```

**Execution:**
```
[Olympus creates todos]
- [ ] Design database schema for profile data
- [ ] Create API endpoint for profile updates
- [ ] Add file upload handling for avatars
- [ ] Create frontend form component
- [ ] Add validation and error handling
- [ ] Write tests for profile update flow

[Delegations]
1. Oracle: Analyze existing user model, recommend schema changes
2. Olympian: Implement API endpoint
3. Frontend Engineer: Create profile form component
4. Olympian: Add validation logic
5. Olympian: Write tests

[Verifications after each step]
- lsp_diagnostics on changed files
- npm test (if applicable)
- Manual review of output

[Result]
✅ All todos complete, feature verified working
```

**Timeline:** 10-20 minutes with proper delegation

---

### Workflow 2: Large Parallel Refactoring

**Scenario:** Convert entire codebase from JavaScript to TypeScript

**Approach:** `/ultrawork`

```bash
> /ultrawork convert all JavaScript files to TypeScript
```

**Execution:**
```
[Ultrawork spawns multiple agents in parallel]

Agent 1 (Olympian): Convert src/auth/*.js (3 files)
Agent 2 (Olympian): Convert src/api/*.js (5 files)
Agent 3 (Olympian): Convert src/utils/*.js (4 files)
Agent 4 (Olympian): Update imports and references
Agent 5 (Document Writer): Update documentation

All agents run simultaneously ↑

[Background verification]
- tsc --noEmit (runs in background)
- eslint check (runs in background)

[Cleanup phase]
- Fix any type errors found
- Update package.json and configs
- Run full test suite

[Result]
✅ Entire codebase converted in ~1/3 the time
```

**Timeline:** 30-60 minutes vs 2-3 hours sequential

---

### Workflow 3: Strategic Planning + Execution

**Scenario:** Add OAuth authentication (unclear which provider, uncertain about implementation)

**Approach:** `/plan` → `/olympus`

#### Phase 1: Planning

```bash
> /plan add OAuth authentication to the application
```

**Prometheus interview:**
```
Prometheus: I'll help you plan OAuth authentication implementation.

[Prometheus launches explore agent to find existing auth code]

Questions:
1. Which OAuth provider(s)? (Google, GitHub, Microsoft, custom, multiple?)
2. Do you have existing user sessions to integrate with?
3. Token storage preference? (JWT, server-side sessions, database?)
4. Required scopes/permissions?
5. Do you need to support both social login and email/password?

[You answer questions]

Prometheus: Creating comprehensive plan...

[Prometheus launches librarian to research OAuth best practices]

Plan created: .olympus/plans/oauth-authentication.md
```

**Plan structure:**
```markdown
# OAuth Authentication Implementation Plan

## Overview
Implement OAuth 2.0 authentication with Google as primary provider...

## Phase 1: Infrastructure Setup
- [ ] Install passport.js and passport-google-oauth20
- [ ] Configure OAuth credentials in Google Console
- [ ] Set up environment variables

## Phase 2: Backend Implementation
- [ ] Create OAuth routes (/auth/google, /auth/callback)
- [ ] Implement user lookup/creation logic
- [ ] Add session management
- [ ] Handle token refresh

## Phase 3: Frontend Integration
- [ ] Add "Sign in with Google" button
- [ ] Implement OAuth redirect flow
- [ ] Handle success/error states

## Phase 4: Testing & Security
- [ ] Test login flow end-to-end
- [ ] Add CSRF protection
- [ ] Implement rate limiting
- [ ] Security audit

## Acceptance Criteria
- User can sign in with Google
- User data persists across sessions
- Security best practices followed
```

#### Phase 2: Execution

```bash
> /olympus
```

**Execution:**
```
[Claude reads .olympus/plans/oauth-authentication.md]
[Creates todos from plan phases]

Delegating Phase 1:
→ Olympian: Install dependencies, configure environment

Delegating Phase 2:
→ Oracle: Review OAuth flow for security concerns
→ Olympian: Implement OAuth routes
→ Olympian: Add session management

Delegating Phase 3:
→ Frontend Engineer: Create sign-in UI component
→ Olympian: Wire up OAuth redirect handling

Delegating Phase 4:
→ QA Tester: Test login flow
→ Oracle: Security review

[All phases complete]
✅ Plan fully implemented and verified
```

**Timeline:** 20 minutes planning + 40 minutes execution = 1 hour total

---

### Workflow 4: Critical Bug Fix (Must Complete)

**Scenario:** Production bug - users can't checkout, must be fixed completely

**Approach:** `/ascent`

```bash
> /ascent fix the checkout bug where users get stuck after payment
```

**Execution with continuation guarantee:**
```
[The Ascent begins - cannot stop until complete]

[Creates comprehensive todos]
- [ ] Reproduce the bug locally
- [ ] Identify root cause
- [ ] Fix the issue
- [ ] Add regression test
- [ ] Verify in all browsers
- [ ] Deploy fix

[Step 1: Reproduce]
→ Olympian: Set up test environment, reproduce bug
✅ Bug reproduced - payment confirmation not triggering state update

[Step 2: Root cause]
→ Oracle: Analyze payment flow and state management
✅ Issue identified - race condition in async payment handler

[Step 3: Fix]
→ Olympian: Implement fix with proper async handling
✅ Fix applied

[Step 4: Test]
→ Olympian: Add test covering the race condition
✅ Test added and passing

[Step 5: Verify]
→ QA Tester: Test in Chrome, Firefox, Safari
✅ All browsers working

[System check: All todos complete?]
[lsp_diagnostics: Clean]
[Tests: All passing]

<promise>DONE</promise>

✅ Bug fixed, tested, and verified
```

**Note:** If you tried to stop at step 3, system would enforce continuation:

```
> That's enough for now

[SYSTEM REMINDER - TODO CONTINUATION]
Incomplete tasks remain:
- [ ] Add regression test
- [ ] Verify in all browsers
- [ ] Deploy fix

Continue working. The Ascent Never Ends.
```

---

## 4. Best Practices

### For All Workflows

**1. Let Olympus create todos**
- Don't manually break down tasks - let Olympus analyze and create todos
- Todos help track progress and ensure nothing is forgotten
- Review todo list before declaring completion

**2. Trust but verify**
- Olympus verifies each step (lsp_diagnostics, tests)
- But do a final review of important changes
- Use `git diff` before committing

**3. Let it learn**
- Correct naturally: "No, use interfaces instead of types"
- Be specific: "Always prefer async/await over .then()"
- After 3 corrections, Olympus learns the pattern

**4. Use project CLAUDE.md**
- Put conventions in `.claude/CLAUDE.md`
- Examples: file naming, import patterns, code style
- Olympus reads this at session start

### For `/olympus` Workflow

**Do:**
- ✅ Give clear, specific tasks
- ✅ Let it delegate to specialists
- ✅ Review delegated work before next step
- ✅ Use for multi-file changes

**Don't:**
- ❌ Micromanage the delegation
- ❌ Stop work before verification
- ❌ Use for trivial single-line changes

### For `/ultrawork` Workflow

**Do:**
- ✅ Use for tasks with independent subtasks
- ✅ Expect higher token usage
- ✅ Let agents run in parallel
- ✅ Use background execution

**Don't:**
- ❌ Use for tasks with sequential dependencies
- ❌ Interrupt mid-execution (agents may be running)
- ❌ Use for simple tasks (overhead not worth it)

### For `/plan` → `/olympus` Workflow

**Do:**
- ✅ Take time in Prometheus interview
- ✅ Ask follow-up questions
- ✅ Review plan before executing
- ✅ Use for strategic decisions

**Don't:**
- ❌ Rush the planning phase
- ❌ Skip questions Prometheus asks
- ❌ Start executing without reviewing the plan
- ❌ Use for well-understood simple tasks

### For `/ascent` Workflow

**Do:**
- ✅ Use for critical, must-complete tasks
- ✅ Commit to finishing
- ✅ Let continuation enforcement work
- ✅ Verify all exit conditions met

**Don't:**
- ❌ Use casually (it's intense)
- ❌ Try to stop early (it won't let you)
- ❌ Use for exploratory work
- ❌ Forget `/cancel-ascent` exists if truly needed

---

## 5. Skill Combination Patterns

Skills can be **stacked** for powerful workflows:

### Pattern: Planning + Ultrawork

```bash
# Step 1: Plan the work
> /plan refactor authentication system

[Prometheus creates plan]

# Step 2: Execute with maximum speed
> /ultrawork
```

**Result:** Strategic planning + parallel execution = fast, high-quality results

---

### Pattern: Olympus + Ascent

```bash
> /ascent /olympus implement user dashboard
```

**Result:** Standard orchestration + completion guarantee = reliable delivery

---

### Pattern: Ultrawork + Git Master

```bash
> /ultrawork refactor API layer
```

**Auto-activated:** `git-master` skill activates automatically for multi-file changes

**Result:** Fast parallel work + atomic git commits

---

## 6. Common Patterns & Recipes

### Recipe: Feature from Scratch

```bash
# If you know exactly what to build:
> /olympus build user notifications system

# If requirements are unclear:
> /plan build user notifications system
[Answer Prometheus questions]
> /olympus
```

---

### Recipe: Bug Investigation + Fix

```bash
# For straightforward bugs:
> /olympus fix the login redirect bug

# For complex, critical bugs:
> /ascent investigate and fix why emails aren't sending
```

---

### Recipe: Large Codebase Refactoring

```bash
# Step 1: Understand scope
> /plan refactor from class components to hooks

# Step 2: Execute in parallel
> /ultrawork

# Result: Strategic plan + fast execution
```

---

### Recipe: Documentation Generation

```bash
# Multiple independent docs:
> /ultrawork generate README, API docs, and usage guide

# Single complex doc:
> /olympus create comprehensive API documentation
```

---

### Recipe: Learning a Codebase

```bash
# Quick exploration:
> /deepsearch authentication flow

# Strategic understanding:
> /plan understand the architecture and data flow
[Don't execute - use plan as documentation]
```

---

## 7. Troubleshooting Workflows

### Problem: Task stalls or gets confused

**Solution: Use `/plan` first**
```bash
> /plan [original task]
[Clarify requirements with Prometheus]
> /olympus
```

---

### Problem: Need to pause multi-step work

**Solution: Check todo list, resume later**
```bash
# Todos persist across sessions
# Next session, just prompt:
> Continue the previous task

# Olympus reads todo state and resumes
```

---

### Problem: Agent chose wrong approach

**Solution: Correct once, let learning system adapt**
```bash
> No, use [correct approach] instead

# After 3 similar corrections:
> Olympus learns your preference automatically
```

---

### Problem: Task incomplete but "done"

**Solution: Use `/ascent` for completion guarantee**
```bash
> /ascent [task]

# Olympus won't stop until verified complete
```

---

## 8. Workflow Decision Tree (Detailed)

```
START: You have a task
│
├─ Is it a single obvious change?
│  ├─ YES → Normal prompt
│  └─ NO → Continue
│
├─ Do you know exactly what to build?
│  ├─ NO → Use /plan (Prometheus clarifies)
│  └─ YES → Continue
│
├─ Can subtasks run independently?
│  ├─ YES → Use /ultrawork (parallel execution)
│  └─ NO → Continue
│
├─ Is incomplete work unacceptable?
│  ├─ YES → Use /ascent (completion guarantee)
│  └─ NO → Continue
│
└─ Default: Use /olympus (standard orchestration)
```

---

## 9. Performance Optimization Tips

### Maximize Parallel Work

```bash
# Don't do this (sequential):
> /olympus task1, then task2, then task3

# Do this (parallel):
> /ultrawork task1, task2, and task3
```

---

### Minimize Planning When Clear

```bash
# Don't over-plan simple tasks:
❌ /plan add a button to the navbar

# Just do it:
✅ /olympus add logout button to navbar
```

---

### Use Background Execution

Olympus automatically backgrounds:
- npm install, pip install
- npm test, pytest
- npm run build
- git operations (fetch, pull)

Don't wait for these - Olympus continues working.

---

### Leverage Learning System

```bash
# First time (you teach):
> /olympus implement feature X
> "No, use pattern Y instead"

# After 3 corrections:
> /olympus implement feature Z
# Olympus automatically uses pattern Y
```

---

## 10. When NOT to Use Olympus

Skip Olympus orchestration for:

1. **Simple reads**: "Show me the config file"
2. **Quick questions**: "What does this function do?"
3. **Obvious one-liners**: "Fix typo on line 42"
4. **Exploratory prompts**: "What are the different ways to implement X?"

Use normal Claude Code for these - orchestration overhead isn't worth it.

---

## Summary: Your Olympus Workflow Toolkit

| Situation | Command | Key Benefit |
|-----------|---------|-------------|
| Simple task | Normal prompt | Fast, no overhead |
| Standard task | `/olympus` | Delegation + tracking |
| Fast & parallel | `/ultrawork` | 3-5x speedup |
| Need planning | `/plan` → `/olympus` | Clarity + execution |
| Must complete | `/ascent` | Completion guarantee |
| Search | `/deepsearch` | Thorough exploration |
| Analysis | `/analyze` | Deep investigation |

**Remember:**
- Start with the simplest approach that works
- Escalate to more powerful workflows when needed
- Let Olympus learn from your corrections
- Trust the orchestration, but verify results

---

**The right workflow makes all the difference.** Choose wisely, execute confidently.
