# Bundled Hooks Hanging Issue

## Problem

The bundled `olympus-hooks.cjs` file hangs when invoked by Claude Code native installer (v2.1.19+) without piped stdin.

## Symptoms

- Claude Code hangs on startup with bundled hooks configured
- Hooks work fine when stdin is piped: `echo '{}' | node olympus-hooks.cjs --event=UserPromptSubmit`
- Hooks hang without piped stdin: `node olympus-hooks.cjs --event=UserPromptSubmit` (waits forever)

## Root Cause

The native Claude Code installer appears to invoke hooks differently than the npm version:
- May not close stdin properly
- May not pipe stdin at all
- Async stdin reading (`for await (const chunk of process.stdin)`) blocks indefinitely

## Attempted Fixes

1. **Timeout with setTimeout**: Added 3-second timeout to stdin reading - didn't work
2. **Readable events**: Switched to `readable` event pattern - still hangs
3. **TTY check**: Added `process.stdin.isTTY` check - still hangs
4. **Aggressive timeout + destroy**: Added 1-second timeout with `stdin.destroy()` - still hangs

None of these approaches prevented the hang in the bundled version.

## Workaround

Use individual `.mjs` hook files instead of the bundled version. These work correctly:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "node \"C:\\Users\\Mike\\.claude\\hooks\\keyword-detector.mjs\"",
        "timeout": 5000
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"C:\\Users\\Mike\\.claude\\hooks\\persistent-mode.mjs\"",
        "timeout": 5000
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"C:\\Users\\Mike\\.claude\\hooks\\session-start.mjs\"",
        "timeout": 3000
      }]
    }]
  }
}
```

## Mystery

The `.mjs` files use the **exact same** `for await (const chunk of process.stdin)` pattern but don't hang:

```javascript
// This works in .mjs files but hangs in bundled .cjs
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
```

Possible explanations:
1. esbuild bundling changes async iteration behavior
2. CommonJS format handles stdin differently than ES modules
3. The bundled file's initialization code interferes with stdin
4. Module loading order affects stdin availability

## **SOLUTION FOUND** ✅

### Actual Root Cause

The issue was **NOT** stdin hanging. The hooks were executing successfully, but **messages were not being injected into Claude's context** due to using the legacy JSON output format.

**Legacy format (doesn't work with native installer):**
```json
{
  "continue": true,
  "message": "Your context here"
}
```

**Current format (required for native installer v2.1.19+):**
```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Your context here"
  }
}
```

### Diagnosis Process

1. Added diagnostic logging to all hooks
2. Confirmed hooks **were** being invoked and executing successfully
3. Discovered hook output was correct but messages weren't reaching Claude
4. Research revealed native installer requires structured `hookSpecificOutput` format
5. Updated all hooks to use `additionalContext` instead of legacy `message` field

### The Fix

**For context-injecting hooks (UserPromptSubmit, SessionStart, PostToolUse):**
- Changed `message` field → `hookSpecificOutput.additionalContext`
- Added `hookEventName` field matching the hook event

**For blocking hooks (Stop):**
- Changed `reason` field → `stopReason`
- The `stopReason` is shown to user when `continue: false`

### Verified Working

After applying the fix:
- ✅ Ultrawork mode activates correctly
- ✅ Keyword detection injects proper instructions
- ✅ Session restoration works
- ✅ Persistence/continuation enforcement functions
- ✅ All hook messages appear in Claude's context

## Next Steps

- ~~Investigate esbuild bundling options~~ **Not needed - stdin was not the issue**
- ~~Test if unbundled CommonJS works~~ **Not needed - format was the issue**
- ~~Compare process.stdin state between .mjs and bundled .cjs~~ **Not needed**
- Update Olympus installer to use new hook format (DONE)
- Consider updating bundled hooks if still desired (use new format)

## Versions

- Claude Code Native: 2.1.19
- Node.js: (version used during testing)
- Platform: Windows (Git Bash)
- Olympus: 2.6.8

## Date

2026-01-26
