<!-- AIDLC-RULES-START -->
# AI-DLC Workflow Rules (Olympus-Native)

## Active Workflow
- **Workflow ID**: `installer-content-extraction`
- **Pathway**: Brownfield (brownfield-refactor)
- **State file**: `aidlc-docs/installer-content-extraction/checkpoint.json`
- **Human-readable state**: `aidlc-docs/installer-content-extraction/aidlc-state.md`
- **Audit log**: `aidlc-docs/installer-content-extraction/audit.md`

## Olympus Agent Delegation

Use Olympus agents for every workflow activity — do NOT implement directly unless the
task is trivial (single file, <10 lines). The delegation table below maps AI-DLC
workflow activities to the correct Olympus agent:

| Activity | Olympus Agent | When |
|----------|--------------|------|
| Strategic planning, intent interview | `prometheus` | Inception kickoff |
| Plan review / critical evaluation | `momus` | After each inception stage |
| Code implementation (multi-file) | `olympian` | Construction phase |
| Complex debugging / root-cause | `oracle` | Failures, unexpected behaviour |
| Codebase exploration / search | `explore` | Before coding, brownfield analysis |
| Documentation, requirements writing | `document-writer` | Artifact generation |
| Research, dependency lookup | `librarian` | Tech stack decisions |
| UI / frontend components | `frontend-engineer` | User-facing features |

**How to delegate:**
```
Task(subagent_type="olympian", description="Implement {unit-name}", prompt="...")
Task(subagent_type="oracle", description="Debug failing test", prompt="...")
Task(subagent_type="explore", description="Map codebase structure", prompt="...")
```

## Rule Detail Files (On-Demand Loading)

**CRITICAL**: When executing any stage, you MUST read the corresponding rule detail file BEFORE starting that stage's work. Rule files are located at:
`~/.claude/olympus/rules/` (installed by olympus-ai)

**Common rules** — MUST load at workflow start (MANDATORY):
- `~/.claude/olympus/rules/common/process-overview.md`
- `~/.claude/olympus/rules/common/session-continuity.md`
- `~/.claude/olympus/rules/common/content-validation.md`
- `~/.claude/olympus/rules/common/question-format-guide.md`

**Per-stage rules** — MUST load before executing each stage (MANDATORY):
- `~/.claude/olympus/rules/inception/workspace-detection.md`
- `~/.claude/olympus/rules/inception/reverse-engineering.md` — brownfield only
- `~/.claude/olympus/rules/inception/requirements-analysis.md`
- `~/.claude/olympus/rules/inception/user-stories.md`
- `~/.claude/olympus/rules/inception/workflow-planning.md`
- `~/.claude/olympus/rules/inception/application-design.md`
- `~/.claude/olympus/rules/inception/units-generation.md`
- `~/.claude/olympus/rules/construction/functional-design.md`
- `~/.claude/olympus/rules/construction/nfr-requirements.md`
- `~/.claude/olympus/rules/construction/nfr-design.md`
- `~/.claude/olympus/rules/construction/infrastructure-design.md`
- `~/.claude/olympus/rules/construction/code-generation.md`

## Directory Layout

```
aidlc-docs/installer-content-extraction/          # ALL documentation here
  checkpoint.json                  # Machine-readable state (V3)
  aidlc-state.md                   # Human-readable state
  audit.md                         # Append-only interaction log
  manifest.json                    # Artifact registry
  inception/
    intent.md
    nfr.md
    requirements-questions.md      # Q&A with [Answer]: tags
    requirements.md
    personas.md
    stories.md
    unit-of-work.md
    application-design/
    plans/
      workflow-routing.md
      execution-plan.md
  construction/
    {unit-name}/
      spec.md
      functional-design.md
      code-generation.md
  operations/
    deploy-guide.md
    runbook.md

[project source files]              # Application code — NEVER inside aidlc-docs/
```

## State Tracking Rules

1. **Dual tracking**: Every stage transition updates BOTH `checkpoint.json` (machine)
   AND `aidlc-state.md` (human). Never update one without the other.
2. **Audit log**: Append every user input and AI response to `audit.md` with ISO-8601
   timestamps. NEVER overwrite — always append/edit.
3. **Checkpoint persistence**: Save checkpoint after each stage completion (CCR-1).
4. **Plan-level checkboxes**: Mark plan steps `[x]` in the SAME interaction where work
   completes. No deferred updates.

## Inception Stages (in order)

1. Workspace Detection (always)
2. Reverse Engineering (brownfield — delegate to `explore` + `oracle`)
3. Requirements Analysis (always)
4. User Stories (conditional)
5. Workflow Planning (always)
6. Application Design (conditional)
7. Units Generation (conditional)

Each stage:
- Requires explicit human approval before proceeding (**do not auto-advance**)
- Produces a "REVIEW REQUIRED / WHAT'S NEXT" message after completion
- Logs all interactions in `audit.md`

## Construction Rules

- Complete each unit fully (design → code) before moving to the next unit
- Delegate code generation to `olympian` (or `olympian-high` for complex units)
- Use `oracle` for debugging failures, not re-running the same olympian prompt
- Mark code generation units fulfilled in `manifest.json` after human approval
- Run `npm run build:all && npm test` after each unit completes

## Must NOT Do

- Claim to override or supersede other built-in workflows
- Overwrite existing CLAUDE.md content outside these sentinel markers
- Implement multi-file changes without delegating to an Olympus agent
- Auto-advance past review gates without explicit human confirmation
- Write application code inside `aidlc-docs/`
<!-- AIDLC-RULES-END -->

# Olympus Project

## PROJECT CONTEXT

**What is Olympus?**
Olympus is a multi-agent orchestration system for Claude Code that enables intelligent task delegation, parallel execution, and specialized agent coordination. Tagline: "Summon the gods of code."

**Distribution:**
- **npm package**: `olympus-ai` (current version: 3.7.1)
- **GitHub**: https://github.com/mikev10/olympus
- **Claude Code plugin**: Distributed via `.claude-plugin` directory
- **CLI command**: `olympus-ai`

**Installation:**
Users install via: `npm install -g olympus-ai`
Postinstall script automatically configures `~/.claude/` with agents, commands, and skills.

**Target Audience:**
Claude Code users seeking enhanced orchestration capabilities, multi-agent delegation, and intelligent task automation.

**Quality Standards:**
- This is **production code** shipped to external users
- All changes must be **tested** (`npm test`) and production-ready
- Breaking changes require **semver** version bumps and migration guides
- Documentation must be **user-facing quality**
- Node.js ≥20.0.0 required

**Development Workflow:**
1. **Dogfooding**: Test changes by updating global `~/.claude/` installation
2. **Testing**: `npm run test` before commits, `npm run test:coverage` before releases
3. **Building**: `npm run build:all` (TypeScript + hooks)
4. **Releasing**: Update version, CHANGELOG.md, build, test, publish to npm, create GitHub release
5. **Distribution**: Build artifacts in `dist/`, plugin in `.claude-plugin/`

**Remember:** You're building a tool used by other developers. Code quality, documentation, and user experience matter.

## General Conventions

Primary language is TypeScript. Always use TypeScript for new files unless explicitly told otherwise. Follow existing project conventions for types, imports, and module structure.

## Workflow & Commits

After completing any feature implementation or bug fix, always: 1) run the build to verify compilation, 2) run the full test suite. Do NOT automatically commit — wait for the user to review changes and explicitly request a commit. When commits are requested, create atomic commits with descriptive messages and do not bundle unrelated changes into a single commit.

## Version Bump & Release Process

When bumping versions, always update the version number in ALL of these files:
- `package.json` (and run `npm install --package-lock-only` to sync lock file)
- `src/installer/index.ts` (VERSION constant)
- `src/__tests__/installer.test.ts` (expected version assertion)
- `.claude-plugin/plugin.json` (plugin version)
- `.claude/CLAUDE.md` (current version in PROJECT CONTEXT)

Then run the full build, run all tests, and create a single atomic commit with the format 'chore: bump version to X.Y.Z'.
