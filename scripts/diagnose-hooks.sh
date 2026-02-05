#!/bin/bash
# Olympus Hooks Diagnostic Script
# Tests hook execution and data capture

set -e

echo "╔═══════════════════════════════════════════════════════╗"
echo "║     Olympus Hooks Diagnostic Script                  ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""

HOOKS_FILE="$HOME/.claude/hooks/olympus-hooks.cjs"
DEBUG_LOG="$HOME/.claude/olympus/learning/hooks-debug.log"
SESSION_STATE=".olympus/session-state.json"
FEEDBACK_LOG="$HOME/.claude/olympus/learning/feedback-log.jsonl"

# Test 1: Check if hooks file exists
echo "Test 1: Checking hooks file..."
if [ -f "$HOOKS_FILE" ]; then
    echo "  ✓ Hooks file exists: $HOOKS_FILE"
    echo "    Size: $(wc -c < "$HOOKS_FILE") bytes"
    echo "    Modified: $(stat -c '%y' "$HOOKS_FILE" 2>/dev/null || stat -f '%Sm' "$HOOKS_FILE")"
else
    echo "  ✗ Hooks file NOT found: $HOOKS_FILE"
    exit 1
fi
echo ""

# Test 2: Check settings.json configuration
echo "Test 2: Checking settings.json hooks configuration..."
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
    if grep -q "olympus-hooks.cjs" "$SETTINGS"; then
        echo "  ✓ Hooks configured in settings.json"
        echo "    Configured events:"
        grep -o '"[A-Za-z]*": \[' "$SETTINGS" | grep -v hooks | head -5
    else
        echo "  ✗ olympus-hooks.cjs NOT found in settings.json"
    fi
else
    echo "  ✗ settings.json NOT found"
fi
echo ""

# Test 3: Test UserPromptSubmit hook with REAL context structure
echo "Test 3: Testing UserPromptSubmit hook execution..."
TEST_INPUT=$(cat <<'EOF'
{
  "session_id": "diagnostic-test-001",
  "transcript_path": "/tmp/transcript.jsonl",
  "cwd": "$PWD",
  "permission_mode": "default",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "This is a diagnostic test prompt"
}
EOF
)

echo "  Input JSON:"
echo "$TEST_INPUT" | head -3
echo ""
echo "  Executing hook..."
RESULT=$(echo "$TEST_INPUT" | node "$HOOKS_FILE" --event=UserPromptSubmit 2>&1)
EXIT_CODE=$?
echo "  Exit code: $EXIT_CODE"
echo "  Output: $RESULT"
echo ""

# Test 4: Test PostToolUse hook
echo "Test 4: Testing PostToolUse hook execution..."
TEST_INPUT=$(cat <<'EOF'
{
  "session_id": "diagnostic-test-001",
  "transcript_path": "/tmp/transcript.jsonl",
  "cwd": "$PWD",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse",
  "tool_name": "Read",
  "tool_input": {"file_path": "/tmp/test.txt"},
  "tool_response": {"success": true}
}
EOF
)

RESULT=$(echo "$TEST_INPUT" | node "$HOOKS_FILE" --event=PostToolUse 2>&1)
EXIT_CODE=$?
echo "  Exit code: $EXIT_CODE"
echo "  Output: $RESULT"
echo ""

# Test 5: Test Stop hook
echo "Test 5: Testing Stop hook execution..."
TEST_INPUT=$(cat <<'EOF'
{
  "session_id": "diagnostic-test-001",
  "transcript_path": "/tmp/transcript.jsonl",
  "cwd": "$PWD",
  "permission_mode": "default",
  "hook_event_name": "Stop",
  "stop_hook_active": true
}
EOF
)

RESULT=$(echo "$TEST_INPUT" | node "$HOOKS_FILE" --event=Stop 2>&1)
EXIT_CODE=$?
echo "  Exit code: $EXIT_CODE"
echo "  Output: $RESULT"
echo ""

# Test 6: Check if session state was updated
echo "Test 6: Checking session state file..."
if [ -f "$SESSION_STATE" ]; then
    echo "  ✓ Session state exists"
    echo "    Last modified: $(stat -c '%y' "$SESSION_STATE" 2>/dev/null || stat -f '%Sm' "$SESSION_STATE")"
    echo "    Content preview:"
    head -10 "$SESSION_STATE" | sed 's/^/    /'
else
    echo "  ✗ Session state NOT found: $SESSION_STATE"
fi
echo ""

# Test 7: Check feedback log
echo "Test 7: Checking feedback log..."
if [ -f "$FEEDBACK_LOG" ]; then
    ENTRY_COUNT=$(wc -l < "$FEEDBACK_LOG")
    echo "  ✓ Feedback log exists"
    echo "    Entries: $ENTRY_COUNT"
    if [ "$ENTRY_COUNT" -gt 0 ]; then
        echo "    Latest entry:"
        tail -1 "$FEEDBACK_LOG" | sed 's/^/    /'
    fi
else
    echo "  ✗ Feedback log NOT found: $FEEDBACK_LOG"
fi
echo ""

# Test 8: Check debug log (if enabled)
echo "Test 8: Checking debug log..."
if [ -f "$DEBUG_LOG" ]; then
    LINE_COUNT=$(wc -l < "$DEBUG_LOG")
    echo "  ✓ Debug log exists"
    echo "    Lines: $LINE_COUNT"
    echo "    Recent entries:"
    tail -5 "$DEBUG_LOG" | sed 's/^/    /'
else
    echo "  ℹ Debug log not found (enable with OLYMPUS_DEBUG_HOOKS=1)"
fi
echo ""

# Test 9: Check for shell profile pollution
echo "Test 9: Checking for shell profile pollution..."
PROFILE_OUTPUT=$(/bin/bash -i -c 'exit' 2>&1)
if [ -n "$PROFILE_OUTPUT" ]; then
    echo "  ⚠ WARNING: Shell profile produces output"
    echo "    This can break JSON parsing in hooks!"
    echo "    Output:"
    echo "$PROFILE_OUTPUT" | head -3 | sed 's/^/    /'
else
    echo "  ✓ No shell profile pollution detected"
fi
echo ""

# Summary
echo "╔═══════════════════════════════════════════════════════╗"
echo "║     Diagnostic Summary                                ║"
echo "╚═══════════════════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Enable debug mode: export OLYMPUS_DEBUG_HOOKS=1"
echo "  2. Start Claude Code session: claude"
echo "  3. Monitor debug log: tail -f $DEBUG_LOG"
echo "  4. Send a message and check if hooks capture data"
echo ""
