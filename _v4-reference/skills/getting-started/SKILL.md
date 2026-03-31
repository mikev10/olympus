---
description: Guided introduction to Olympus — capabilities overview and your first /plan workflow
---

# Welcome to Olympus

Olympus is a multi-agent orchestration layer for Claude Code. It gives you 20+ specialized AI agents, a structured development workflow (`/plan`), and a self-learning system that improves with every session.

This guide walks you through the key capabilities and gets you to a real result in your project in under 5 minutes.

---

## What Olympus Can Do

**Multi-agent orchestration** — Olympus automatically delegates work to specialist agents (architects, searchers, frontend engineers, QA testers) and routes each task to the right model tier (Haiku/Sonnet/Opus) to balance speed and quality.

**`/plan <task>`** — The AI-DLC structured workflow. Olympus interviews you to clarify requirements, produces a written plan you approve, then delegates construction to the right agents. Best for features, refactors, and anything non-trivial.

**`/ultrawork <task>`** — Maximum performance mode. Runs agents in parallel, doesn't wait for confirmation. Use when you need speed and the task is clear.

**`/ascent <task>`** — Persistence loop. Olympus will not stop until every todo is complete. Use when you need guaranteed completion.

**Self-learning** — Olympus records patterns and preferences across sessions. Future runs benefit from what past runs discovered.

---

## Your First Real Task

Let's use `/plan` on your actual project right now.

**Step 1 — Open Claude Code in your project directory** (you're likely already there).

**Step 2 — Pick a real task.** Think of something you've been meaning to do:
- Add a feature or endpoint
- Refactor a messy module
- Write tests for an untested area
- Fix a known bug or improve error handling

**Step 3 — Start the plan.** Type something like:

```
/plan add input validation to the user registration flow
```

or

```
/plan refactor the database layer to use the repository pattern
```

**What happens next:**
1. **Inception** — Olympus interviews you with targeted questions to clarify scope, edge cases, and constraints. Answer honestly; vague answers produce vague plans.
2. **Plan review** — You'll see a written plan before any code is touched. Request changes or approve it.
3. **Construction** — Olympus delegates implementation to specialist agents. You can watch progress or step away.

The whole cycle for a medium feature takes 15-30 minutes of AI work, with you approving at key checkpoints.

---

## Quick Reference

| Command | When to use |
|---------|-------------|
| `/plan <task>` | Features, refactors, anything that needs a plan first |
| `/ultrawork <task>` | Well-defined tasks where speed matters |
| `/ascent <task>` | Must-complete work — Olympus won't stop until done |
| `/deepsearch <query>` | Find anything in the codebase |
| `/analyze <target>` | Deep investigation of a file, function, or bug |
| `/olympus-default` | Make Olympus your default mode for every session |

---

## Next Steps

- Run `/olympus-default` to activate Olympus automatically in every Claude Code session.
- Run `/plan` on your first real task.
- Run `/deepsearch` or `/analyze` to explore unfamiliar parts of your codebase.

For full documentation, see the README or run `olympus info`.
