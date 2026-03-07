# The Olympus Manifesto

## Core Philosophy: Humans Direct, Agents Execute

**The human's job is to steer. The agent's job is to row.**

Olympus draws a hard line between *directing* work and *doing* work. You set the destination, approve the route, and review the results. The system handles everything in between — autonomously, in parallel, verified before delivery.

Olympus is built on the principle that **humans should never be implementers**. When a human must write code, fix bugs, or babysit an agent mid-task, the system has failed. But when a human approves a design, greenlights a plan, or corrects a preference? That's governance — and it makes the output better.

---

## The Five Tenets

### 1. Humans Approve, Agents Implement

**Human as implementer = system failure. Human as decision-maker = good governance.**

Traditional AI coding: You prompt → AI responds → You fix → AI tries again → You fix → ...

This collaborative back-and-forth is a failure mode, not a feature. You became the AI's debugger.

But the solution isn't to remove humans entirely — it's to put them in the right seat. Humans are executives, not laborers. You approve direction, review deliverables, and course-correct when needed. You never write the code yourself.

**The Three Tiers of Human Involvement:**

| Tier | Human Role | When | Example |
|------|-----------|------|---------|
| **Strategic** | Director — defines what to build | Inception phase | Approving requirements, signing off on architecture |
| **Tactical** | Approver — reviews AI-produced plans | Phase gates | Greenlighting a code generation plan, reviewing designs |
| **Execution** | Hands-off — AI works autonomously | Within any stage | Agent delegation, parallel execution, The Ascent |

**Implementation:**
- **Structured Workflow** - AI-DLC phases with approval gates at natural boundaries
- **The Ascent** - Cannot stop until verified complete within a phase
- **Continuation Enforcement** - System continues working, not waiting
- **Verification Built-In** - Oracle reviews, lsp_diagnostics, test runs

**Anti-pattern:**
```
User: "Add authentication"
Agent: [writes some code]
Agent: "I've started the implementation. What method would you like?"
User: "JWT"  ← BLOCKER: Human had to intervene mid-implementation
Agent: [continues]
Agent: "Should I add refresh tokens?"
User: "Yes"  ← BLOCKER: Another mid-task interruption
```

**Olympus pattern:**
```
User: "/plan add authentication"
Olympus: [analyzes workspace, gathers requirements, interviews you]
User: ✓ Approves requirements
Olympus: [designs architecture, creates code generation plan]
User: ✓ Approves plan
Olympus: [implements autonomously — parallel agents, tests, verification]
Result: Production-ready authentication with JWT and refresh tokens
```

**Key insight:** Humans make decisions at **phase gates** — between stages of work. They never intervene **during execution** within a stage. The AI does all the analysis, design, and implementation. The human approves, steers, and reviews.

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
- [ ] Todo list shows 100% completion
- [ ] All code changes compile/run without errors
- [ ] All tests pass (if applicable)
- [ ] User's original request is FULLY addressed
- [ ] No obvious bugs or issues remain
- [ ] You have TESTED the changes, not just written them

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

## Governance and Learning: The Two Loops

Olympus has two feedback loops — one for steering work, one for getting smarter.

### The Governance Loop

The AI-DLC workflow gives you control at natural boundaries without micromanaging execution:

```
┌──────────────────────────────────────────────────────┐
│  INCEPTION: You define what to build                  │
│  Requirements → Design → Plan                         │
│  You approve at each gate                             │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│  CONSTRUCTION: Agents build it                        │
│  Design → Code → Test (autonomous within each stage)  │
│  You approve plans and review output at gates         │
└──────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────┐
│  REVIEW: You verify the result                        │
│  Correct if needed → Olympus learns                   │
└──────────────────────────────────────────────────────┘
```

**What you approve at gates:**
- Requirements and scope — "Is this what I want?"
- Architecture and design — "Is this the right approach?"
- Code generation plans — "Does this plan make sense?"
- Completed output — "Does this work?"

**What happens between gates (autonomous):**
- Agents analyze, design, and implement
- Multiple agents work in parallel
- Oracle verifies, tests run, diagnostics check
- The Ascent ensures no stage ends incomplete

### The Learning Loop

Every interaction teaches Olympus your preferences — whether at a gate or during free-form work.

**What Olympus learns from:**

| Your Action | What's Captured | How It's Applied |
|-------------|----------------|-----------------|
| "No, this should handle X differently" | Task-specific correction | Recorded in feedback log |
| "Use async/await instead of .then()" | Style preference | Applied in future sessions |
| "This project uses kebab-case for files" | Project convention | Auto-applied per project |
| "Always use TypeScript interfaces" | Explicit rule (never decays) | Injected at every session start |

**How learning works:**

Learning is threshold-based, not session-based. It can happen within a single long session or across many.

1. **Feedback capture** — Corrections and preferences recorded to `feedback-log.jsonl`
2. **Pattern extraction** — After 10+ entries, Jaccard similarity clusters similar feedback; 3+ similar corrections become a learned pattern
3. **Explicit rules** — "Always X" or "Never Y" statements take effect immediately and never decay (regular patterns expire after 30 days of inactivity)
4. **Session injection** — At every session start, learned preferences, patterns, and discoveries are automatically injected into context

**Result:** The more you use Olympus, the less you need to correct it.

### The Relationship

**What we ask of you:**
- Approve direction at gates — you're the decision-maker
- Correct when something's wrong — your feedback makes Olympus smarter
- Teach your preferences — "always/never" rules are captured permanently

**What Olympus delivers:**
- Autonomous execution within each stage — no babysitting
- Structured gates that give you control without slowing you down
- A learning system that remembers your corrections and preferences
- Each session starts smarter than the last

**This is not "human-in-the-loop"** — it's governance at the gates, autonomy between them, and learning throughout.

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

**Human as implementer = system failure**

**Human as director = good governance**

**Human as reviewer = continuous learning**

These three lines capture the Olympus philosophy.

You are not pair-programming with the AI. You are **delegating** to it. You set direction at phase gates, approve plans and designs, and review completed work. Between those gates, the system executes autonomously — verifying its own output, delegating to specialists, and running in parallel.

Your role is strategic: define intent, approve direction, review results, correct as needed. The system learns from your corrections and improves over time. The more you use it, the less you need to steer.

**Olympus doesn't make you a better AI prompter.**

**Olympus makes you a better engineer by letting you focus on decisions, not implementation.**

---

Summon the gods of code. Direct them. Let them execute.

The Ascent Never Ends.
