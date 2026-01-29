# Olympus Mode Aliases for Claude CLI
# Add these to your ~/.bashrc or ~/.zshrc

# Primary Olympus alias - enforces task completion discipline
alias claude-s='/home/bellman/.claude/claude-olympus.sh'

# Work mode alias - shorter alternative
alias claudew='/home/bellman/.claude/claude-olympus.sh'

# Usage examples:
#   claude-s "Refactor the API layer"
#   claudew "Fix all failing tests"
#   claude-s --model opus "Debug this complex issue"

# Installation:
# 1. Add the aliases above to your shell config (~/.bashrc or ~/.zshrc)
# 2. Reload: source ~/.bashrc  (or source ~/.zshrc)
# 3. Use: claude-s "your task here"
