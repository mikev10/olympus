# The Olympus Manifesto

## Core Philosophy: Autonomous Execution, Human Intent

**Human intervention during agentic work is fundamentally a wrong signal.**

The system should function autonomously - like a compiler or a self-driving car. You don't want to manually steer partway through the journey. You specify the destination, and the system gets you there.

Olympus is built on the principle that **human-in-the-loop equals blocker**. Not collaboration. Not partnership. A blocker. When a human must step in mid-execution, it means the system failed.

---

## The Five Tenets

### 1. Eliminate Human Bottlenecks

**Human involvement during execution signals system failure.**

Traditional AI coding: You prompt → AI responds → You fix → AI tries again → You fix → ...

This collaborative back-and-forth is a failure mode, not a feature.

**Olympus approach:**
- You specify intent once
- Olympus executes autonomously
- Result is production-ready

**Implementation:**
- **The Ascent** - Cannot stop until verified complete
- **Continuation Enforcement** - System reminds you to continue if incomplete
- **Background Execution** - Doesn't wait for human approvals mid-task
- **Verification Built-In** - Oracle reviews, lsp_diagnostics, test runs

**Anti-pattern:**
```
User: "Add authentication"
Agent: [writes some code]
Agent: "I've started the implementation. What method would you like?"
User: "JWT"  ← BLOCKER: Human had to intervene
Agent: [continues]
Agent: "Should I add refresh tokens?"
User: "Yes"  ← BLOCKER: Another intervention
```

**Olympus pattern:**
```
User: "/plan add authentication"
Prometheus: [interviews you BEFORE starting]
Prometheus: [creates complete plan]
User: "/olympus"
Olympus: [executes plan autonomously to completion]
Result: ✅ Production-ready authentication with JWT and refresh tokens
```

**Key insight:** Clarification happens **before execution** (planning phase) or **after completion** (review phase). Never during.

---

### 2. Production-Ready Output

**Code quality must match what a senior engineer would deliver - not a rough draft requiring cleanup.**

You shouldn't need to:
- Fix edge cases the AI missed
- Add error handling
- Improve variable names
- Refactor "AI slop" code patterns
- Write the tests yourself

**Olympus standard:**
- Proper error handling
- Follows existing codebase patterns
- Includes appropriate tests
- Passes lsp_diagnostics
- Verified by Oracle before declaration of completion

**This is enforced:**

```markdown
## The Ascent Verification Checklist

Before outputting `<promise>DONE</promise>`:
- [ ] All code compiles/runs without errors
- [ ] All tests pass
- [ ] Oracle verified production-ready
- [ ] Follows existing patterns
- [ ] No obvious bugs remain

If ANY checkbox is unchecked, CONTINUE WORKING.
```

**Result:** You get production-ready code, not a prototype you need to fix.

---

### 3. Token Investment Over Efficiency

**Higher computational costs are acceptable when they eliminate human cognitive load.**

A human hour is worth infinitely more than compute cost.

**Olympus priorities:**
1. Minimize human intervention → #1 priority
2. Minimize human review time → #2 priority
3. Minimize token usage → #3 priority (distant third)

**How we balance this:**
- Smart model routing: Haiku for simple tasks, Opus for complex
- Parallel execution: Spend more tokens to deliver 3-5x faster
- Oracle reviews: Spend tokens on verification to catch issues before human sees them
- Learning system: Invest tokens now to reduce future mistakes

**Example:**

Traditional approach (token-efficient, human-expensive):
```
Agent writes code → Human finds bugs → Agent fixes → Human reviews again
Tokens: 5K | Human time: 30 minutes
```

Olympus approach (token-expensive, human-efficient):
```
Agent analyzes (Oracle) → Multiple agents work in parallel →
Oracle verifies → Tests run → Result delivered complete
Tokens: 20K | Human time: 2 minutes review
```

**Trade:** 4x tokens for 15x less human time. Worth it.

---

### 4. Minimize User Cognitive Load

**You specify WHAT you want. The agent determines HOW.**

You shouldn't need to:
- Break tasks into subtasks (agent creates todos)
- Decide which agent to use (automatic delegation)
- Know when to parallelize (ultrawork does it)
- Remember to verify (built into workflow)
- Manually track progress (todos persist across sessions)

**Two modes serve this:**

**Prometheus Mode** (`/plan`):
- Interview-based requirement clarification
- You answer questions, agent figures out approach
- Creates comprehensive plan before execution
- Use when requirements are unclear

**Ultrawork Mode** (`/ultrawork`):
- Direct execution, maximum speed
- You give high-level intent, agent figures out everything
- Parallel execution by default
- Use when you know what you want and want it fast

**Example - User says:**
```
> /ultrawork refactor entire auth system to OAuth 2.0
```

**Agent determines:**
- Which files to change (explore agent finds them)
- Proper OAuth flow (librarian researches best practices)
- Database schema changes (oracle analyzes implications)
- How to parallelize work (multiple olympian agents)
- What tests to write (coverage of critical paths)
- How to verify (Oracle + test suite)

**User doesn't micromanage. Agent orchestrates.**

---

### 5. Predictable, Continuous, Delegatable Work

**Like a compiler: accept input consistently, produce verified results, survive interruptions.**

The system should be:
- **Predictable** - Same input produces reliable output
- **Continuous** - Works until complete, can't be half-done
- **Delegatable** - You can walk away and come back

**Olympus implementation:**

**Predictability:**
- Verification is mandatory (not optional)
- Production-ready is the only acceptable state
- No "partial implementations"

**Continuity:**
- **The Ascent Never Ends** - Cannot stop until verified complete
- Continuation enforcement - System reminds you to continue
- Todos persist across sessions - Resume anytime

**Delegatability:**
- Background execution - Long operations don't block
- Session recovery - Can close terminal and resume later
- Learning system - Future sessions benefit from past corrections

**The Ideal Loop:**

```
Human Intent → Agent Execution → Verified Result
              ↑                        ↓
              └────── Learning ────────┘
```

Minimal intervention. Maximum autonomy. Continuous improvement.

---

## The Learning Paradox: Review Without Interruption

**Manifesto principle:** Human intervention during work = blocker

**Learning principle:** Human corrections improve future performance

**How do we reconcile this?**

### Post-Completion Review (Not Interruption)

Review happens **AFTER** autonomous completion, not during:

```
┌─────────────────────────────────────────────────────┐
│         AUTONOMOUS EXECUTION (No Intervention)       │
│  Olympus works → Verifies → Delivers complete result│
└─────────────────────────────────────────────────────┘
                        ↓
                   [COMPLETE]
                        ↓
┌─────────────────────────────────────────────────────┐
│         POST-COMPLETION REVIEW (Learning Phase)      │
│   You review → Correct if needed → Olympus learns   │
└─────────────────────────────────────────────────────┘
```

**This is not a blocker because:**
1. Work is already complete and production-ready
2. Review happens at your convenience
3. Corrections improve FUTURE executions, not current one
4. You're training the system, not fixing broken work

### What to Review

**Correctness** - Does it do what you asked?
- If no: "No, this should handle X differently"
- Learning captured: Task-specific correction

**Style** - Does it match your preferences?
- If no: "Use async/await instead of .then()"
- Learning captured: Style preference (applied to future work)

**Patterns** - Does it follow codebase conventions?
- If no: "This project uses kebab-case for files"
- Learning captured: Project convention (applied automatically)

**Quality** - Is it production-ready?
- If no: "Add error handling for network failures"
- Learning captured: Quality standard (enforced in future)

### How Learning Works

**Session 1-2:** You correct Claude a few times
```
You: "No, use TypeScript interfaces instead of types"
→ Olympus: Records feedback
```

**Session 3:** Pattern detected (3+ similar corrections)
```
→ Olympus: Learns preference "Use interfaces over types"
→ Stored in ~/.claude/olympus/learning/user-preferences.json
```

**Session 4+:** Preference automatically applied
```
→ Olympus: Uses interfaces by default (no correction needed)
→ Human cognitive load reduced
```

**Result:** Review time decreases over time as system learns.

### The Social Contract

**We ask you to review because:**
- It makes Olympus smarter for everyone
- Your corrections teach the system your preferences
- Patterns you identify become automatic
- Future executions require less review

**In return, Olympus promises:**
- Never interrupt you mid-execution
- Deliver production-ready results
- Learn from corrections so mistakes don't repeat
- Reduce your review burden over time

**This is not "human-in-the-loop"** - it's "human-in-the-training-loop."

Execution is autonomous. Learning is collaborative.

---

## Anti-Patterns We Reject

### ❌ Chatbot Collaboration
```
You: "Add a feature"
Agent: "Sure! I'll start by..."
Agent: [some code]
Agent: "What do you think? Should I continue?"
You: [reviews incomplete work]
You: "Yes, but change X"
Agent: [more code]
Agent: "How's this?"
```

**Problem:** You're pair-programming with the AI. Inefficient and exhausting.

**Olympus approach:** `/olympus add feature` → complete implementation → review when ready

---

### ❌ Premature Declarations
```
Agent: [writes some code]
Agent: "Done! ✓"
You: [tests it]
You: "It doesn't work, you forgot error handling"
Agent: [fixes]
Agent: "Done! ✓"
You: [tests again]
You: "The tests are failing"
```

**Problem:** Agent declares completion before verification.

**Olympus approach:** Verification is built-in. Cannot declare complete without:
- Oracle review
- Test suite passing
- lsp_diagnostics clean
- Explicit verification checklist

The `<promise>DONE</promise>` tag is a sacred contract - only output when truly complete.

---

### ❌ Unclear Requirements Leading to Rework
```
You: "Build authentication"
Agent: [builds password auth]
You: "No, I wanted OAuth"
Agent: [rebuilds as OAuth]
You: "I meant with Google specifically"
Agent: [rebuilds again]
```

**Problem:** Agent guesses instead of clarifying upfront.

**Olympus approach:** `/plan build authentication` → Prometheus interviews you → clarifies OAuth provider, flows, storage → creates plan → executes once, correctly

---

### ❌ Token Optimization at Human Expense
```
Agent: [writes minimal code]
Agent: "I've scaffolded the basic structure. You can fill in the details."
```

**Problem:** Saved tokens, wasted human time.

**Olympus approach:** Production-ready or nothing. Never deliver scaffolds that require human completion.

---

## The Olympus Promise

When you activate Olympus, you get:

1. **Autonomous execution** - No mid-task interruptions
2. **Production-ready results** - Senior engineer quality code
3. **Verified completion** - Oracle review + tests before delivery
4. **Continuous improvement** - Learning system makes it smarter
5. **Completion guarantee** - With `/ascent`, cannot stop early

**In exchange, we ask:**

1. **Review completed work** - Help the learning system improve
2. **Correct when needed** - Teach Olympus your preferences
3. **Use planning for unclear tasks** - Let Prometheus clarify before execution

---

## Why This Matters

**Traditional AI coding:**
- You write prompts
- AI writes drafts
- You fix bugs
- AI tries again
- You review
- You fix more issues
- Eventually you just do it yourself

**Result:** You became an AI debugger.

**Olympus approach:**
- You specify intent (`/olympus add feature` or `/plan complex project`)
- Olympus executes autonomously
- Oracle verifies production-ready
- Tests pass
- You review complete work
- Corrections improve future performance

**Result:** You remain an engineer. Olympus is your autonomous team.

---

## The Ascent: Olympus's Commitment

**"The Ascent Never Ends"** is not just a tagline. It's a commitment:

- We will not stop until the task is complete
- We will verify before claiming completion
- We will parallelize for maximum speed
- We will delegate to specialists
- We will learn from your corrections
- We will deliver production-ready results

**Like climbing Mount Olympus:** The journey continues until the summit is reached. No shortcuts. No giving up. Complete or not at all.

When you activate `/ascent`, you invoke this commitment explicitly. The system binds itself to your task until verified completion.

---

## Conclusion

**Human intervention during execution = blocker**

**Human review after completion = learning**

This is the distinction that makes Olympus work.

You are not collaborating with the AI during execution. You are **delegating** to it. It executes autonomously, verifies independently, and delivers complete results.

Your role is strategic: specify intent, review results, correct as needed. The system learns from your corrections and improves over time.

**Olympus doesn't make you a better AI prompter.**

**Olympus makes you a better engineer by removing the need to prompt at all.**

---

Summon the gods of code. Let them work autonomously.

The Ascent Never Ends.
