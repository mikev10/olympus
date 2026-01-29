# Olympus Architecture: Multi-Agent Orchestration System

This document explains the architectural principles of Olympus, a comprehensive multi-agent orchestration framework for Claude Code.

---

## Overview

| Aspect | Implementation | Benefit |
|--------|----------------|---------|
| Master Agent | **Fixed orchestrator with skill composition** | Consistent behavior, enhanced via skills |
| Sub Agents | **Specialized agents via Task tool** | Focused expertise domains |
| Routing | **Skill-based activation + agent delegation** | Flexible, composable behaviors |
| Model Tiering | **Low/Medium/High variants (haiku/sonnet/opus)** | Cost optimization |

---

## Architecture Philosophy

Olympus is built around a **fixed master agent** enhanced through **skill composition**. The orchestrator cannot be swapped out, but its behavior can be dramatically modified through skill injection.

### Fixed Master with Skill Layers

Claude Code provides a **fixed master agent** - the conversation always runs through the same Claude instance.

```
┌─────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE RUNTIME                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  CLAUDE MASTER  │  ← FIXED, cannot swap
                    │   (Always On)   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌───────────┐  ┌───────────┐  ┌───────────┐
       │  oracle   │  │ librarian │  │  explore  │
       │ (Opus)    │  │ (Sonnet)  │  │ (Haiku)   │
       └───────────┘  └───────────┘  └───────────┘
              ↑              ↑              ↑
              └──────────────┼──────────────┘
                             │
                    Only as SUB-agents
                    (via Task tool)
```

### Skill-Based Enhancement

We **inject behaviors** into the fixed master through Skills:

```
┌─────────────────────────────────────────────────────────────┐
│                    CLAUDE CODE + SKILLS                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  CLAUDE MASTER  │
                    │                 │
                    │  ┌───────────┐  │
                    │  │  SKILL    │  │  ← Injected behavior
                    │  │  LAYER    │  │
                    │  └───────────┘  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         Sub-agents    Sub-agents    Sub-agents
```

### How Skills Work

Skills are **behavior injections** that modify how the master agent operates:

```markdown
# When user says "plan the auth system"

1. CLAUDE.md contains routing rules
2. Claude detects "plan" → planning task
3. Claude invokes Skill(skill: "prometheus")
4. Prometheus skill template is injected
5. Claude now BEHAVES like Prometheus
6. But it's still the same master agent
```

---

## The Elegant Solution: Intelligent Skill Activation

### Skill Layers

We solved the "can't swap master" limitation by creating **composable skill layers**:

```
┌─────────────────────────────────────────────────────────────┐
│                    SKILL COMPOSITION                         │
└─────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │  GUARANTEE LAYER (optional)                              │
  │  ┌─────────────┐                                        │
  │  │ ascent  │  "Cannot stop until verified done"     │
  │  └─────────────┘                                        │
  └─────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  ENHANCEMENT LAYER (0-N skills)                          │
  │  ┌───────────┐ ┌───────────┐ ┌─────────────────┐        │
  │  │ ultrawork │ │git-master │ │ frontend-ui-ux  │        │
  │  │ (parallel)│ │ (commits) │ │   (design)      │        │
  │  └───────────┘ └───────────┘ └─────────────────┘        │
  └─────────────────────────────────────────────────────────┘
                              │
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  EXECUTION LAYER (pick one primary)                      │
  │  ┌───────────┐ ┌─────────────┐ ┌────────────┐           │
  │  │ olympus  │ │ orchestrator│ │ prometheus │           │
  │  │ (build)   │ │ (coordinate)│ │  (plan)    │           │
  │  └───────────┘ └─────────────┘ └────────────┘           │
  └─────────────────────────────────────────────────────────┘
```

### Composition Formula

```
[Execution Skill] + [0-N Enhancement Skills] + [Optional Guarantee]
```

### Examples

```
Task: "Add dark mode with proper commits"
Skills: olympus + frontend-ui-ux + git-master

Task: "ultrawork: refactor entire API"
Skills: ultrawork + olympus + git-master

Task: "Plan auth, then implement completely"
Skills: prometheus → olympus + ascent (transition)

Task: "Fix bug, don't stop until done"
Skills: olympus + ascent
```

---

## Skill-Based Workflow Example

### Complex Project: Planning → Implementation

```
1. User: "Plan the authentication system"
2. Claude: Activates prometheus skill
3. Claude (as Prometheus): Creates comprehensive plan
4. User: "Now implement it"
5. Claude: Transitions to olympus skill  ← Same context preserved!
6. Claude (as Olympus): Implements (already has plan in context)
```

### Benefits of Skill Composition

| Aspect | Skill-Based Approach |
|--------|---------------------|
| Context | Preserved across transitions |
| Transitions | Seamless, fluid |
| Composition | Multiple skills stack |
| State | In-conversation |
| User Experience | Natural language |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              OLYMPUS                                     │
│                     Intelligent Skill Activation                         │
└─────────────────────────────────────────────────────────────────────────┘

  User Input                      Skill Detection                 Execution
  ──────────                      ───────────────                 ─────────
       │                                │                              │
       ▼                                ▼                              ▼
┌─────────────┐              ┌──────────────────┐           ┌─────────────────┐
│  "ultrawork │              │   CLAUDE.md      │           │ SKILL ACTIVATED │
│   refactor  │─────────────▶│   Auto-Routing   │──────────▶│                 │
│   the API"  │              │                  │           │ ultrawork +     │
└─────────────┘              │ Task Type:       │           │ olympus +      │
                             │  - Implementation│           │ git-master      │
                             │  - Multi-file    │           │                 │
                             │  - Parallel OK   │           │ ┌─────────────┐ │
                             │                  │           │ │ Parallel    │ │
                             │ Skills:          │           │ │ agents      │ │
                             │  - ultrawork ✓   │           │ │ launched    │ │
                             │  - olympus ✓    │           │ └─────────────┘ │
                             │  - git-master ✓  │           │                 │
                             └──────────────────┘           │ ┌─────────────┐ │
                                                            │ │ Atomic      │ │
                                                            │ │ commits     │ │
                                                            │ └─────────────┘ │
                                                            └─────────────────┘
```

---

## Implementation Details

### CLAUDE.md Auto-Routing Section

```markdown
## INTELLIGENT SKILL ACTIVATION

Skills ENHANCE your capabilities. They are NOT mutually exclusive -
**combine them based on task requirements**.

### Task Type → Skill Selection

Use your judgment to detect task type and activate appropriate skills:

| Task Type | Skill Combination | When |
|-----------|-------------------|------|
| Multi-step implementation | `olympus` | Building features |
| + parallel subtasks | `+ ultrawork` | 3+ independent tasks |
| + multi-file changes | `+ git-master` | 3+ files |
| UI/frontend work | `+ frontend-ui-ux` | Components, styling |
| Strategic planning | `prometheus` | Need plan first |
| Must complete | `+ ascent` | Completion critical |

### Activation Guidance

- **DO NOT** wait for explicit skill invocation
- **DO** use your judgment
- **DO** combine skills when multiple apply
- **EXPLICIT** slash commands always take precedence
```

### Skill Invocation Flow

```typescript
// Conceptual flow (happens in Claude's reasoning)

function handleUserRequest(request: string) {
  // 1. Detect task type
  const taskType = analyzeTaskType(request);

  // 2. Select skill combination
  const skills = selectSkills(taskType);
  // e.g., ['olympus', 'ultrawork', 'git-master']

  // 3. Invoke skills (stacked)
  for (const skill of skills) {
    invoke(Skill, { skill });  // Skill tool
  }

  // 4. Execute with combined behaviors
  executeTask(request);
}
```

---


## Conclusion

The **skill-based routing system** provides powerful orchestration capabilities:

1. **Preserves context** across mode changes
2. **Enables composition** (ultrawork + git-master + olympus)
3. **Natural language** activation (no explicit mode switching)
4. **Judgment-based** routing (Claude decides based on task)

The skill layer architecture provides a fluid and powerful orchestration experience.

---

## References

- [Claude Code](https://claude.ai/code) - AI-powered development environment
- [Claude Code Skills](https://docs.anthropic.com/claude-code/skills) - Skill documentation
- [Intelligent Skill Activation](./README.md#intelligent-skill-activation-beta) - Beta feature docs
