<!-- AIDLC-RULES-START -->
# AI-DLC Workflow Rules (Olympus-Native)

## Active Workflow
- **Workflow ID**: `bolt-lifecycle-alignment`
- **Pathway**: Brownfield (brownfield-enhancement)
- **State file**: `aidlc-docs/bolt-lifecycle-alignment/checkpoint.json`
- **Human-readable state**: `aidlc-docs/bolt-lifecycle-alignment/aidlc-state.md`
- **Audit log**: `aidlc-docs/bolt-lifecycle-alignment/audit.md`

All workflow stages, agent delegation, directory layout, and rules are defined in the
global `~/.claude/CLAUDE.md` (installed by Olympus). This block only tracks the active
workflow identity — do NOT search for a separate core-workflow.md file.
<!-- AIDLC-RULES-END -->

# Olympus Project

## PROJECT CONTEXT

**What is Olympus?**
Olympus is a multi-agent orchestration system for Claude Code that enables intelligent task delegation, parallel execution, and specialized agent coordination. Tagline: "Summon the gods of code."

**Distribution:**
- **npm package**: `olympus-ai` (current version: 4.5.12)
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

## Key Patterns

### Bolt Lifecycle
- **Folder structure**: `{workflowId}/construction/{UNIT-NNN-slug}/bolts/BOLT-NNN-slug/spec.md` (spec) and `review.md` (review artifact)
- **Naming convention**: `BOLT-NNN-slug` — global sequential numbering across ALL units (not per-unit)
- **Lifecycle states**: `planned` → `in_progress` → `built` → `in_review` → `done` | `failed`
- **Execution stages** (per bolt): `elaboration` → `code_generation` → `build_and_test` → `review`
- **Express bolt**: `depth_target <= 4` OR pathway is `bugfix` — skips elaboration stage; `express_mode: true` in frontmatter
- **Key modules** (all in `src/features/workflow-engine/bolts/`):
  - `bolt-planner.ts` — decomposes units into bolts, validates coverage
  - `bolt-executor.ts` — drives per-bolt execution stages
  - `bolt-reviewer.ts` — quality gate, returns decision objects via `reviewCallback`
  - `express-bolt-factory.ts` — creates express bolts, sets `express_mode: true`
  - `bolt-spec-validator.ts` — validates spec frontmatter and required sections
- **Checkpoint fields**:
  - `construction_bolts`: map of bolt IDs to `ConstructionBoltProgress` objects
  - `active_bolt_id`: bolt currently in execution (`null` when idle)
  - `active_bolt_stage`: current execution stage of the active bolt
- **Coverage thresholds**: >=95% pass, 80-94% warn + mandatory acknowledgment, <80% hard block
- **Review thresholds**: >=70% auto-approve, 50-69% advisory + acknowledgment, <50% hard block (never overridden by trust level)
