#!/bin/bash
# Olympus Mode Wrapper for Claude CLI
# Enforces task completion discipline through system prompt injection

# Core Olympus enforcement prompt
OLYMPUS_PROMPT="You are in OLYMPUS MODE. You CANNOT stop with incomplete todos. ALWAYS use TodoWrite to track tasks. Mark complete IMMEDIATELY when done. Verify ALL work before stopping. The ascent never ends until EVERY task reaches completion."

# Execute claude with appended system prompt, passing through all arguments
exec claude --append-system-prompt "$OLYMPUS_PROMPT" "$@"
