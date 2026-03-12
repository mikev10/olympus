<!-- AIDLC-RULES-START -->
# AI-DLC Workflow Rules (Olympus-Native)

## Active Workflow
No active workflow. Use `/plan` to start a new one.

All workflow stages, agent delegation, directory layout, and rules are defined in the
AI-DLC Core Workflow reference (loaded from core-workflow.md). This block only tracks
the active workflow identity above.
<!-- AIDLC-RULES-END -->

# Olympus Project

## PROJECT CONTEXT

**What is Olympus?**
Olympus is a multi-agent orchestration system for Claude Code that enables intelligent task delegation, parallel execution, and specialized agent coordination. Tagline: "Summon the gods of code."

**Distribution:**
- **npm package**: `olympus-ai` (current version: 4.4.3)
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
