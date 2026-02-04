# Interactive Workflows: When to Execute Directly vs Delegate

## The Problem

When users invoke commands that require real-time interaction (like `/plan`), questions asked by agents via `AskUserQuestion` tool are trapped in the agent's subprocess context and **not visible to the user** until the agent completes or is explicitly queried.

This creates a terrible UX where users wait indefinitely without seeing questions, eventually asking "are you done?" just to discover questions were asked but hidden.

## The Solution

**Rule**: Commands requiring real-time user interaction should execute workflows directly in the main conversation, NOT delegate to agents using `AskUserQuestion`.

## Pattern Comparison

### ❌ Bad: Hidden Questions (Broken UX)

```markdown
# /plan command (OLD)
**IMMEDIATELY** use the Task tool to spawn the prometheus agent:

Task(
  subagent_type="prometheus",
  prompt="Interview the user..."
)
```

**What happens:**
1. User runs `/plan`
2. Orchestrator spawns prometheus agent via Task tool
3. Agent asks questions via AskUserQuestion
4. Questions are trapped in agent context - **USER SEES NOTHING**
5. User waits indefinitely
6. User asks "are you done?"
7. Orchestrator relays questions from agent output
8. Terrible experience

### ✅ Good: Direct Execution (Immediate Visibility)

```markdown
# /plan command (NEW)
You are now conducting a strategic planning session as Prometheus.

**CRITICAL**: Ask questions DIRECTLY to the user via your normal message output.
Questions MUST be visible immediately.

Begin by asking your first clarifying questions about the task.
```

**What happens:**
1. User runs `/plan`
2. Orchestrator executes planning workflow directly
3. Orchestrator outputs questions in regular messages
4. Questions immediately visible to user
5. User responds
6. Conversation continues naturally
7. Great experience

## When to Use Each Pattern

### Execute Directly (Main Conversation)

Use when workflow requires **real-time user interaction**:

| Use Case | Why |
|----------|-----|
| `/plan` - Planning interviews | Questions must be visible immediately |
| `/review` - Interactive review | Feedback needs immediate visibility |
| Any command with user dialog | Direct I/O required |

**Implementation:**
- Command template includes full workflow instructions
- Orchestrator executes workflow directly
- Questions output as regular text messages
- User sees everything immediately

### Delegate to Agent (Task Tool)

Use when workflow is **self-contained** or **background work**:

| Use Case | Why |
|----------|-----|
| Research (`explore`, `librarian`) | No user interaction needed |
| Code execution (`olympian`) | Fully specified task |
| Analysis (`oracle`, `metis`) | Takes input, produces output |
| Background work | Can run async |

**Implementation:**
- Task tool spawns agent subprocess
- Agent completes work autonomously
- Returns result when done
- No mid-execution user input needed

## Agent Design Guidelines

If an agent MIGHT be used via Task delegation, it should:

1. **Never use AskUserQuestion** - Output questions as regular text instead
2. **Document this clearly** in agent prompt
3. **Assume non-interactive** execution context

### Example: Prometheus Agent Update

```typescript
// In prometheus agent prompt:
## CRITICAL: How to Ask Questions

**ALWAYS output your questions as regular text in your response.
NEVER use the AskUserQuestion tool.**

Why: When running as a delegated agent, AskUserQuestion creates
questions that are not visible to the user. Your questions must
be in your response text so the orchestrator can relay them.

Example response format:
```
I need to understand a few things:

1. **Document Ownership**: Will documents be team-owned or user-authored?
2. **Linking Semantics**: What does "linking" mean here?

Once you answer these, I can create the plan.
```

**DO NOT** use AskUserQuestion. Output questions as text.
```

## Implementation Checklist

When creating/updating interactive commands:

- [ ] Identify if command requires real-time user interaction
- [ ] If YES: Execute directly, output questions as text
- [ ] If NO: Can delegate via Task tool
- [ ] Update command template with clear instructions
- [ ] Update agent (if exists) to never use AskUserQuestion
- [ ] Test with actual user workflow
- [ ] Verify questions appear immediately

## Testing

To verify an interactive command works correctly:

1. Run the command: `/plan <task>`
2. **Immediately check**: Do questions appear?
3. If spinner shows "Done" but no questions → **BUG**
4. If questions appear immediately → **WORKING**

## Related Issues

- [Issue #XXX](link): "/plan questions not visible to user"
- User feedback: "I never saw the questions until I asked if it was done"

## Key Takeaway

**Interactive workflows must happen in the main conversation thread, not in agent subprocesses, to ensure real-time visibility to the user.**
