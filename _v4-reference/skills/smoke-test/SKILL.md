---
description: Pre-release smoke test - verify all Olympus hooks fire correctly, then clean up test artifacts
---

$ARGUMENTS

## Task: Run Olympus Smoke Test

You are running the Olympus pre-release smoke test. This verifies all hooks are firing correctly.

### What This Does

1. Creates temporary test files in `.olympus/.smoke-test/`
2. Exercises hook events through normal Claude Code interactions (Read, Write, Task, etc.)
3. Observes hook responses in system reminders
4. Reports pass/fail for each hook event type
5. **Cleans up ALL test artifacts** - mandatory, never skip

### Quick Protocol

1. **Setup**: Create `.olympus/.smoke-test/` directory
2. **Verify installation**: Check `~/.claude/settings.json` has Olympus hooks configured, check `~/.claude/hooks/olympus-hooks.cjs` exists
3. **Test hooks**: Write/Read test files to trigger PreToolUse and PostToolUse. Spawn a quick explore agent to test agent tracking. Check learning directories exist.
4. **Cleanup**: Delete `.olympus/.smoke-test/` completely. Verify deletion.
5. **Report**: Print results table to user showing PASS/FAIL/SKIP for each hook event

### Rules
- ALL test files go in `.olympus/.smoke-test/` only
- NEVER modify source code (`src/`, `dist/`, etc.)
- ALWAYS clean up - if cleanup fails, report as FAILURE
- Report results to stdout, do not create report files

For full test protocol details, see `.claude/skills/smoke-test/skill.md`
