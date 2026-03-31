---
description: Diagnose and fix olympus installation issues
---

$ARGUMENTS

## Task: Run Installation Diagnostics

You are the Olympus Doctor - diagnose and fix installation issues.

### Step 1: Check Installation

Read `~/.claude/.olympus-version.json` to determine the installed version.

```bash
cat ~/.claude/.olympus-version.json 2>/dev/null || echo "FILE_NOT_FOUND"
```

**Diagnosis**:
- If file not found: CRITICAL — Olympus not properly installed (run `npm install -g olympus-ai && olympus-ai install`)
- If present: show version, installMethod, and installedAt fields
- Then check latest available version:

```bash
LATEST=$(npm view olympus-ai version 2>/dev/null)
echo "Latest: $LATEST"
```

- If installed version < latest: WARN — update available

### Step 2: Check Hooks Configuration

Read `~/.claude/settings.json` and inspect the `"hooks"` section.

```bash
cat ~/.claude/settings.json 2>/dev/null || echo "FILE_NOT_FOUND"
```

**Diagnosis**:
- If no `"hooks"` key at all: CRITICAL — hooks not configured (Olympus will not function correctly)
- If hooks reference `olympus-hooks.cjs`: OK — current bundled hook format
- If hooks reference individual `.sh` scripts (e.g. `keyword-detector.sh`, `persistent-mode.sh`, `session-start.sh`): WARN — legacy hook format, run `olympus-ai install` to migrate to bundled hooks

### Step 3: Check for Legacy Bash Hook Scripts

```bash
ls -la ~/.claude/hooks/*.sh 2>/dev/null || echo "NONE_FOUND"
```

**Diagnosis**:
- If any of `keyword-detector.sh`, `persistent-mode.sh`, `session-start.sh`, or `stop-continuation.sh` exist: WARN — legacy scripts present (can conflict with bundled hooks)
- `olympus-hooks.cjs` is the current hook bundle — do NOT flag it as legacy

### Step 4: Check CLAUDE.md

```bash
ls -la ~/.claude/CLAUDE.md 2>/dev/null || echo "FILE_NOT_FOUND"
grep -q "Olympus Multi-Agent System" ~/.claude/CLAUDE.md 2>/dev/null && echo "Has Olympus config" || echo "Missing Olympus config"
```

**Diagnosis**:
- If missing: CRITICAL — CLAUDE.md not configured
- If present but missing Olympus marker: WARN — outdated CLAUDE.md

### Step 5: Verify Core Files

```bash
# Check agents directory
ls ~/.claude/agents/*.md 2>/dev/null | wc -l

# Check commands directory
ls ~/.claude/commands/*.md 2>/dev/null | wc -l

# Check bundled hook exists
ls -la ~/.claude/hooks/olympus-hooks.cjs 2>/dev/null || echo "HOOK_BUNDLE_MISSING"
```

Expected agent files include: `oracle.md`, `librarian.md`, `explore.md`, `olympian.md`, `prometheus.md`, `frontend-engineer.md`
Expected command files include: `ultrawork.md`, `deepsearch.md`, `plan.md`, `ascent.md`

**Diagnosis**:
- If `~/.claude/agents/` is missing or empty: WARN — incomplete installation, run `olympus-ai install`
- If `~/.claude/commands/` is missing or empty: WARN — incomplete installation, run `olympus-ai install`
- If `olympus-hooks.cjs` is missing: CRITICAL — hook bundle missing, run `olympus-ai install`

### Step 6: Check Install Method Consistency

Using the data already read from `~/.claude/.olympus-version.json`:

**Diagnosis**:
- If `installMethod` is `"npm"` or `"npm-local"` and agents/commands directories exist: OK — expected layout for npm install
- If `~/.claude/.olympus-version.json` is missing but agents/commands exist: WARN — unknown install method (possibly curl-installed without registration), recommend running `npm install -g olympus-ai && olympus-ai install` to register properly

---

## Report Format

After running all checks, output a report:

```
## Olympus Doctor Report

### Summary
[HEALTHY / ISSUES FOUND — N critical, N warnings]

### Installation Info
- Version: X.Y.Z
- Install Method: npm
- Installed At: YYYY-MM-DD
- Latest Available: X.Y.Z

### Checks

| Check | Status | Details |
|-------|--------|---------|
| Installation | OK/WARN/CRITICAL | ... |
| Hooks (settings.json) | OK/WARN/CRITICAL | ... |
| Legacy Scripts (~/.claude/hooks/) | OK/WARN | ... |
| CLAUDE.md | OK/WARN/CRITICAL | ... |
| Core Files | OK/WARN/CRITICAL | ... |
| Install Consistency | OK/WARN | ... |

### Issues Found
1. [Issue description]
2. [Issue description]

### Recommended Fixes
[List fixes based on issues]
```

---

## Auto-Fix (if user confirms)

If issues found, ask user: "Would you like me to fix these issues automatically?"

If yes, apply only the relevant fixes:

### Fix: Outdated Version
```bash
npm install -g olympus-ai
olympus-ai install
```

### Fix: Legacy Hooks in settings.json
Run `olympus-ai install` to rewrite the hooks section to use the bundled `olympus-hooks.cjs` format. Do not manually remove the hooks section — Olympus must configure it correctly.

### Fix: Legacy Bash Scripts
```bash
rm -f ~/.claude/hooks/keyword-detector.sh
rm -f ~/.claude/hooks/persistent-mode.sh
rm -f ~/.claude/hooks/session-start.sh
rm -f ~/.claude/hooks/stop-continuation.sh
```
Do NOT remove `olympus-hooks.cjs` — that is the current hook bundle.

### Fix: Missing/Outdated CLAUDE.md
```bash
olympus-ai install
```

### Fix: Incomplete Installation (missing agents, commands, or hook bundle)
```bash
olympus-ai install
```

### Fix: Unknown Install Method
```bash
npm install -g olympus-ai
olympus-ai install
```

---

## Post-Fix

After applying fixes, inform user:
> Fixes applied. **Restart Claude Code** for changes to take effect.