# Working with Brownfield Projects

Olympus is **particularly well-suited for brownfield projects** (existing codebases) because its delegation-first architecture forces proper exploration and understanding before making changes.

## Overview

Brownfield projects present unique challenges:
- Existing code with established patterns
- Legacy issues and technical debt
- Need to understand architecture before changes
- Must work within existing constraints
- Risk of breaking existing functionality

Olympus's mandatory delegation rules and specialized agents make working with existing codebases safer and more efficient than traditional approaches.

## How Olympus Handles Existing Codebases

### 1. Exploration First (Mandatory Delegation)

Before touching any code, Olympus delegates to specialized exploration agents:

**Example: Adding Authentication to an Existing App**

```
❌ BAD (naive approach):
- Read a few files
- Start editing immediately
- Break existing patterns

✅ GOOD (Olympus approach):
- Delegate to `explore` agent to map the codebase
- Delegate to `oracle` to understand architecture
- Identify existing patterns (auth middleware, session handling, etc.)
- Make changes that fit the existing structure
```

**Key agents for brownfield discovery:**
- **`explore`** / **`explore-medium`** - Fast codebase mapping and pattern discovery
- **`oracle`** / **`oracle-medium`** / **`oracle-low`** - Architecture understanding and root cause analysis
- **`librarian`** / **`librarian-low`** - Finding existing documentation and patterns

### 2. Persistent Knowledge: Two Complementary Systems

Olympus avoids re-exploring codebases through **two complementary knowledge persistence systems**:

#### a) Manual Documentation: `/deepinit` (Permanent AGENTS.md)

For complex brownfield projects, explicitly create comprehensive documentation:

```bash
/deepinit              # Create hierarchical AGENTS.md files
/deepinit --update     # Update existing AGENTS.md documentation
/deepinit ./src        # Initialize specific directory
```

**What it creates:**
- Hierarchical `AGENTS.md` files throughout the codebase
- Each directory gets documentation: purpose, file responsibilities, patterns, AI instructions
- Files are **committed to repository** (permanent, team-wide)
- Automatically loaded on future sessions

**This gives all future agents (and you) a navigable map of the codebase.**

#### b) Automatic Learning System (Silent Background Knowledge)

**Completely automatic** - Olympus captures codebase knowledge as you work:

**No manual action required.** The learning system silently records:

1. **Codebase Discoveries** (`discoveries.jsonl`)
   - Patterns detected during exploration
   - Gotchas and workarounds discovered
   - Technical insights about architecture
   - Performance considerations
   - Configuration details

2. **Project Patterns** (`patterns.json`)
   - Import styles (named vs default)
   - Test patterns and locations
   - Error handling conventions
   - Code formatting preferences
   - Technology stack

3. **Agent Efficiency** (`feedback-log.jsonl`)
   - Which agents work best for this codebase
   - Success rates per agent type
   - Token usage patterns
   - Routing optimizations

4. **User Preferences** (`user-preferences.json`)
   - Recurring corrections ("avoid lodash")
   - Autonomy level preferences
   - Verbosity preferences

**Storage locations:**
- Global: `~/.claude/olympus/learning/` (cross-project knowledge)
- Project: `.olympus/learning/` (project-specific patterns)

**How it works across sessions:**

```
Session 1 (First encounter):
  → Agents explore codebase
  → Learning system captures patterns automatically
  → Discoveries stored in JSONL files
  → Token efficiency tracked

Session 2+ (Return to project):
  → AGENTS.md auto-loaded (if exists)
  → Discoveries injected into system prompt
  → Patterns pre-loaded for agents
  → Efficient agents selected automatically
  → NO re-exploration needed for known areas
```

**What gets injected into future sessions:**

```xml
<learned-context>
  <project-patterns>
    - Import style: Named imports preferred
    - Tests: *.test.ts in __tests__/ directories
    - Error handling: Result<T, E> type pattern
  </project-patterns>

  <discoveries>
    - Auth uses JWT tokens in httpOnly cookies (gotcha)
    - All API calls route through src/lib/api-client.ts (pattern)
    - Database migrations stored in /db/migrations (technical_insight)
  </discoveries>

  <user-preferences>
    - Recurring correction: "Use native Array methods, not lodash"
  </user-preferences>
</learned-context>

<olympus-efficiency>
  - oracle-low: 85% success, efficient for simple analysis
  - olympian: Best for multi-file changes in this codebase
</olympus-efficiency>
```

**Benefits:**
- ✅ Avoids re-exploring known code
- ✅ Remembers discovered patterns
- ✅ Routes to most efficient agents
- ✅ Learns from mistakes (recurring corrections)
- ✅ Works silently in background

### 3. Safe Changes Through Delegation

Olympus's **mandatory delegation rules** protect brownfield code from hasty modifications:

| What You Want to Do | What Olympus Does |
|---------------------|-------------------|
| "Fix this bug across 3 files" | Delegates to `olympian` agent (won't make changes directly) |
| "Why is this slow?" | Delegates to `oracle` agent (proper root cause analysis) |
| "Where is feature X?" | Delegates to `explore` agent (systematic search) |
| "Add new UI component" | Delegates to `frontend-engineer` (respects existing design patterns) |

You **cannot** make multi-file changes directly - you **must** delegate to an agent that will:
1. Read and understand the full context
2. Respect existing patterns and conventions
3. Make cohesive, consistent changes
4. Verify nothing breaks

### 4. Pattern Detection and Respect

When delegating to `olympian` or using `/git-master` for changes, Olympus automatically detects and follows existing patterns:

- **Commit message style** - Conventional commits, semantic versioning, custom formats
- **Code formatting** - Discovered via prettier/eslint configs
- **Architectural patterns** - Controller/service, MVC, layered architecture, etc.
- **Testing patterns** - Jest, Mocha, test file locations and naming
- **Import styles** - Named vs default imports, path aliases
- **Error handling** - Try/catch conventions, error types, logging patterns

The `/git-master` skill is especially effective at maintaining consistency:
- Analyzes recent commits for style and conventions
- Creates atomic commits matching project standards
- Preserves git history quality
- Groups related changes intelligently

### 5. Practical Brownfield Workflow

**Scenario: Adding a feature to an unfamiliar codebase**

```bash
# Step 1: Understand the landscape
/deepsearch "authentication"
/analyze src/auth

# Step 2: Create a plan
/plan "Add OAuth support to existing auth system"
# Prometheus interviews you, explores codebase, creates comprehensive plan

# Step 3: Review before execution
/review
# Momus evaluates plan for brownfield risks and gotchas

# Step 4: Execute with delegation
# Olympus automatically delegates to olympian agents
# Changes respect existing patterns
# Tests verify nothing breaks

# Step 5: Verify completion
/complete-plan
# Ensures all tests pass, no regressions introduced
```

## Advantages in Brownfield Projects

| Brownfield Challenge | How Olympus Helps |
|---------------------|-------------------|
| **"Where is the code for X?"** | `explore` agents systematically search and map relationships |
| **"Why does this work this way?"** | `oracle` agents analyze architecture and explain design decisions |
| **"Will my change break things?"** | Delegation ensures understanding before modification |
| **"What's the existing pattern?"** | Agents automatically detect and follow conventions |
| **"Too complex to understand quickly"** | `/deepinit` creates docs + learning system captures patterns automatically |
| **"Need to make safe changes fast"** | Parallel delegation + mandatory exploration = speed + safety |
| **"Legacy code with no docs"** | Agents reverse-engineer patterns, learning system remembers them |
| **"Don't want to re-learn codebase"** | Learning system accumulates knowledge automatically across sessions |
| **"Token costs too high on large codebase"** | Efficiency improves 70%+ as learning system caches patterns |

## Automatic Knowledge Accumulation (No Re-Exploration)

### How Olympus Avoids Redundant Work

The learning system accumulates codebase knowledge **automatically and silently** across sessions:

**Session 1 - Initial Exploration:**
```
User: "Add OAuth to the auth system"

1. explore agent maps auth-related files
2. Learning system records:
   - Pattern: "Auth uses passport.js middleware"
   - Discovery: "Sessions stored in Redis, not memory"
   - Gotcha: "Must call passport.initialize() before routes"
3. Stored in discoveries.jsonl
4. Token usage tracked: oracle-medium = 12k tokens
```

**Session 2 - Related Work (Days later):**
```
User: "Fix session timeout issue"

1. Session starts
2. System injects learned context:
   <discoveries>
   - Auth uses passport.js middleware
   - Sessions stored in Redis, not memory
   </discoveries>
3. Agent starts with PRE-LOADED knowledge
4. No need to re-explore passport setup
5. Token usage: oracle-low = 3k tokens (75% reduction)
```

**Session 5 - Complex Refactor:**
```
User: "Migrate from passport to custom JWT auth"

1. System recognizes complexity from prompt
2. Knows this codebase from prior sessions
3. Routes directly to oracle (Opus) - skips cheaper models
4. Injects all accumulated discoveries
5. No trial-and-error routing = efficient execution
```

### What Gets Learned Automatically

| Knowledge Type | Captured When | Reused For |
|----------------|---------------|------------|
| **Code patterns** | Agents analyze files | Matching existing conventions in new code |
| **Gotchas** | Bugs fixed, issues found | Warning future agents about pitfalls |
| **Architecture insights** | System exploration | Understanding design decisions |
| **Efficient agents** | Task completion tracking | Routing to best agent for task type |
| **Hot paths** | File access patterns | Prioritizing frequently-changed code |
| **Dependencies** | Import analysis | Understanding module relationships |

### Token Efficiency Through Learning

**Automatic optimization over time:**

```
Week 1: Initial brownfield exploration
  Session 1: 45k tokens (full exploration)
  Session 2: 38k tokens (some patterns cached)
  Session 3: 32k tokens (more efficient routing)

Week 2: Established codebase knowledge
  Session 4: 18k tokens (skip known areas)
  Session 5: 15k tokens (optimal agent routing)
  Session 6: 12k tokens (targeted changes only)

→ 73% token reduction through accumulated knowledge
→ Faster execution (less exploration overhead)
→ Better results (agents understand codebase)
```

### Viewing Learned Knowledge

Check what Olympus has learned about your codebase:

```bash
# See efficiency metrics
olympus learn --efficiency

# View discovered patterns
cat .olympus/learning/patterns.json

# Check agent performance
olympus learn --show-costs

# Inspect discoveries
cat .olympus/learning/discoveries.jsonl
```

## Best Practices for Brownfield Work

### DO:
- ✅ Use `/deepinit` on first encounter with complex codebase (creates permanent docs)
- ✅ Let agents explore before making assumptions (they'll learn and cache patterns)
- ✅ Trust the mandatory delegation rules (they prevent mistakes)
- ✅ Use `/plan` for any significant changes
- ✅ Run tests frequently to catch regressions early
- ✅ Let `/git-master` maintain commit consistency
- ✅ Trust the learning system - it's accumulating knowledge automatically
- ✅ Keep `.olympus/learning/` files (don't gitignore or delete them)

### DON'T:
- ❌ Try to bypass delegation for "quick fixes" (they rarely are)
- ❌ Make assumptions about patterns without exploration
- ❌ Skip the `/review` step for complex changes
- ❌ Ignore existing conventions (agents will follow them - you should too)
- ❌ Create documentation files in project root (use `.olympus/` or `docs/`)
- ❌ Delete `.olympus/learning/` directory (accumulated knowledge is stored there)
- ❌ Worry about re-exploration - the learning system prevents it automatically

## Common Brownfield Scenarios

### Scenario 1: Bug Fix in Unfamiliar Code

```bash
# Let agents diagnose first
/analyze src/feature/broken-component.ts

# Agent explores, finds root cause, proposes fix
# Delegate the fix
# Olympian agent implements, respects patterns, adds tests
```

### Scenario 2: Adding Feature to Legacy System

```bash
# Map the landscape
/deepsearch "similar feature"

# Plan the integration
/plan "Add feature X to legacy module Y"

# Review for risks
/review

# Execute with agents
# Verify with tests
```

### Scenario 3: Refactoring Technical Debt

```bash
# Understand current architecture
/deepinit

# Analyze impact
/analyze src/legacy-module

# Create careful plan
/plan "Refactor legacy module to modern patterns"

# Review for breaking changes
/review

# Incremental execution
# Verify at each step
```

## Key Takeaways

**Olympus is BETTER at brownfield than greenfield** because:

1. **Forces exploration** before changes (via mandatory delegation)
2. **Detects and respects** existing patterns automatically
3. **Prevents cowboy coding** through delegation enforcement
4. **Maps complex codebases** with `/deepinit` (manual) and automatic learning (background)
5. **Never re-explores** - accumulated knowledge persists across sessions
6. **Learns efficiency** - routes to best agents, reduces token usage over time
7. **Maintains consistency** through pattern detection and `/git-master`
8. **Reduces risk** by ensuring understanding before modification

The delegation-first philosophy means you **can't accidentally break things** by making changes without understanding the full context - which is exactly what brownfield projects need.

### The Key Insight

**Manual documentation (`/deepinit`) + Automatic learning = Zero redundant exploration**

- AGENTS.md provides structured, comprehensive documentation (team-wide)
- Learning system provides targeted, evolving knowledge (personal + project)
- Together they eliminate repetitive codebase analysis
- Each session builds on prior knowledge automatically

You get smarter about the codebase with every session, **without doing anything manually**.

## Related Documentation

- [Understanding the Orchestration System](understanding-orchestration-system.md) - Deep dive into Olympus architecture
- [Workflow Guide](workflow-guide.md) - Planning and execution workflows
- [Configuration](../configuration.md) - Customizing Olympus behavior
- [Interactive Workflows](../interactive-workflows.md) - Working with the workflow engine
