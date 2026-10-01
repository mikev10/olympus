# Single Source of Truth for Generated Artifacts

**Removing hand-maintained duplicates from agent definitions and version numbers**

**Date:** October 1, 2026
**Status:** Planned (not started)
**Inspiration:** [Cloudflare Forge](https://blog.cloudflare.com/forge-open-source-generation-pipeline/), which generates SDKs, CLIs and docs from a single API definition

---

## Summary

Olympus keeps some information in several hand-edited copies that must be updated together. This proposal makes one copy authoritative and either generates the others at build time or fails tests when they diverge.

Adopting Forge itself is out of scope. Forge works from API specs (OpenAPI) to SDKs, and Olympus has neither. Only its "one source, many outputs" pattern applies.

---

## Problem 1: Agent definitions are duplicated

Each agent prompt lives in two places:

| Location | Used by |
|----------|---------|
| `src/agents/definitions.ts` (and per-agent files such as `qa-tester.ts`) | Agent SDK / programmatic use |
| `resources/agents/*.md` | Installer copies these to `~/.claude/agents/` (`src/installer/index.ts`, `installAgents`) |

Nothing checks that the two copies match, so an edit to one can silently miss the other.

### Proposed fix

**Option A (recommended): generate the markdown from TypeScript**
- Add a build step (for example `scripts/generate-agents.mjs`, wired into `build:all`) that writes `resources/agents/<name>.md` from each `AgentConfig`, producing frontmatter (`name`, `description`, `tools`, `model`) plus the prompt body.
- Mark the generated files with a header comment saying not to edit them by hand.
- Add a test that regenerates the files in memory and fails if the committed files differ, so CI catches stale output.

**Option B: keep both copies and add a consistency test**
- Cheaper, but both copies are still edited by hand.
- A test parses each `.md` file and asserts that its body and frontmatter match the matching `AgentConfig`.

Before choosing, audit the current copies for drift. Some divergence may be intentional, for example deprecated agents such as `orchestrator-olympus`, or differences between installed and SDK prompts.

---

## Problem 2: The version number lives in five files

A release bump currently requires editing:

- `package.json` (and `package-lock.json`)
- `src/installer/index.ts` (`VERSION`)
- `src/__tests__/installer.test.ts` (expected version)
- `.claude-plugin/plugin.json`
- `.claude/CLAUDE.md` (project context)

### Proposed fix

- Treat `package.json` as the source of truth.
- Add `scripts/sync-version.mjs` (or an `npm version` lifecycle hook) that writes the version into the other files.
- Change `installer.test.ts` to compare `VERSION` with `package.json` instead of a hard-coded string.
- Add a test that fails if `plugin.json` or `VERSION` differs from `package.json`.
- Update the release steps in `.claude/CLAUDE.md` once this is in place.

---

## Possible follow-up: install preview on pull requests

Similar to Forge's preview-on-every-PR model: in CI, build the package and run the installer against a temporary `HOME`, then check that the expected agents, commands, skills and hooks land in the temporary `~/.claude/`. This catches installer regressions before an npm release. It is more work than the two fixes above, so it is a separate item.

---

## Effort and priority

| Item | Effort | Value |
|------|--------|-------|
| Version sync and consistency test | ~1–2 hours | High: removes a manual release step that is easy to get wrong |
| Agent markdown generation (Option A) | ~half a day, including the drift audit | High: prevents prompt drift |
| Install preview in CI | ~1 day | Medium |
