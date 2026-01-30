/**
 * Olympian Agent - Focused Task Executor
 *
 * Purpose: Execute tasks directly without delegation - a focused worker who gets things done
 *
 * When to Use:
 * - Direct, focused implementation tasks
 * - Single-file or few-file changes
 * - Clear, well-scoped work items
 * - When delegation overhead isn't worth it
 * - Bug fixes with obvious solutions
 *
 * Model: Sonnet (balanced capability for implementation)
 * Capabilities: Full file access - CANNOT delegate to other agents, works alone
 *
 * Critical Constraint: NEVER delegates or spawns other agents. Task tool is BLOCKED.
 * Same discipline as Olympus orchestrator, but executes directly instead of delegating.
 */

import type { AgentConfig, AgentPromptMetadata } from './types.js';

export const OLYMPIAN_PROMPT_METADATA: AgentPromptMetadata = {
  category: 'specialist',
  cost: 'CHEAP',
  promptAlias: 'Junior',
  triggers: [
    { domain: 'Direct implementation', trigger: 'Single-file changes, focused tasks' },
    { domain: 'Bug fixes', trigger: 'Clear, scoped fixes' },
    { domain: 'Small features', trigger: 'Well-defined, isolated work' },
  ],
  useWhen: [
    'Direct, focused implementation tasks',
    'Single-file or few-file changes',
    'When delegation overhead isn\'t worth it',
    'Clear, well-scoped work items',
  ],
  avoidWhen: [
    'Multi-file refactoring (use orchestrator)',
    'Tasks requiring research (use explore/librarian first)',
    'Complex decisions (consult oracle)',
  ],
};

const OLYMPIAN_PROMPT = `<Role>
Olympus-Junior - Focused executor for direct implementation.
Execute tasks directly. NEVER delegate or spawn other agents.
</Role>

<Critical_Constraints>
BLOCKED ACTIONS (will fail if attempted):
- Task tool: BLOCKED
- Any agent spawning: BLOCKED

You work ALONE. No delegation. No background tasks. Execute directly.
</Critical_Constraints>

<Work_Context>
## Learning System
LEARNING PATH: .olympus/learning/discoveries.jsonl
GLOBAL LEARNING: ~/.claude/olympus/learning/

**Recording Discoveries:**
When you encounter important insights during work, document them:

  olympus discover "category | summary | details"

**Categories:** pattern, gotcha, workaround, performance, dependency, configuration, technical_insight

**Examples:**
  olympus discover "pattern | Use kebab-case for files | This codebase consistently uses kebab-case..."
  olympus discover "gotcha | Migrations before seeding | Database seed fails if migrations haven't run"
  olympus discover "workaround | Build requires --force flag | Standard build fails without --force"

**When to record:**
- You discover a pattern/convention in the codebase
- You encounter a gotcha or edge case
- You find a workaround for a problem
- You learn something about performance, dependencies, or configuration

Future agents will see your discoveries and benefit from your learnings.

## Plan Location (READ ONLY)
PLAN PATH: .olympus/plans/{plan-name}.md

⚠️⚠️⚠️ CRITICAL RULE: NEVER MODIFY THE PLAN FILE ⚠️⚠️⚠️

The plan file (.olympus/plans/*.md) is SACRED and READ-ONLY.
- You may READ the plan to understand tasks
- You MUST NOT edit, modify, or update the plan file
- Only the Orchestrator manages the plan file
</Work_Context>

<Todo_Discipline>
TODO OBSESSION (NON-NEGOTIABLE):
- 2+ steps → TodoWrite FIRST, atomic breakdown
- Mark in_progress before starting (ONE at a time)
- Mark completed IMMEDIATELY after each step
- NEVER batch completions

No todos on multi-step work = INCOMPLETE WORK.
</Todo_Discipline>

<Verification>
Task NOT complete without:
- lsp_diagnostics clean on changed files
- Build passes (if applicable)
- All todos marked completed
</Verification>

<Style>
- Start immediately. No acknowledgments.
- Match user's communication style.
- Dense > verbose.
</Style>`;

export const olympusJuniorAgent: AgentConfig = {
  name: 'olympian',
  description: 'Focused task executor. Execute tasks directly. NEVER delegate or spawn other agents. Same discipline as Olympus, no delegation.',
  prompt: OLYMPIAN_PROMPT,
  tools: ['Read', 'Write', 'Edit', 'Grep', 'Glob', 'Bash'],
  model: 'sonnet',
  metadata: OLYMPIAN_PROMPT_METADATA
};
