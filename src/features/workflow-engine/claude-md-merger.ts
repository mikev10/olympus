/**
 * CLAUDE.md Sentinel Merger
 *
 * Provides idempotent, non-destructive injection of AI-DLC rules into
 * project CLAUDE.md files using sentinel markers.
 *
 * Design principles:
 * - NEVER overwrites content outside sentinel markers
 * - Idempotent: merge(merge(x)) === merge(x)
 * - Removal is clean: no leftover whitespace artifacts
 * - Rules reference Olympus agents by name (not generic AI placeholders)
 * - Does NOT include "OVERRIDES all other built-in workflows" language
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { PathwayType } from './phase-types.js';

export const SENTINEL_START = '<!-- AIDLC-RULES-START -->';
export const SENTINEL_END = '<!-- AIDLC-RULES-END -->';

/**
 * Check whether a CLAUDE.md string contains the AIDLC sentinel block.
 */
export function hasAidlcRules(content: string): boolean {
  return content.includes(SENTINEL_START) && content.includes(SENTINEL_END);
}

/**
 * Inject or update the AIDLC rules block in a CLAUDE.md string.
 *
 * - If sentinels already exist: replaces the content between them.
 * - If sentinels are absent: prepends the block at the top.
 * - Idempotent: calling twice with the same rules yields the same result.
 *
 * @param existingContent - Current CLAUDE.md text (may be empty or absent).
 * @param aidlcRules - The rules text to inject (without sentinel tags).
 * @returns The merged CLAUDE.md string.
 */
export function mergeAidlcRules(existingContent: string, aidlcRules: string): string {
  const block = `${SENTINEL_START}\n${aidlcRules}\n${SENTINEL_END}`;

  if (hasAidlcRules(existingContent)) {
    const startIdx = existingContent.indexOf(SENTINEL_START);
    const endIdx = existingContent.indexOf(SENTINEL_END) + SENTINEL_END.length;
    const trimmedBefore = existingContent.slice(0, startIdx).replace(/\s+$/, '');
    const trimmedAfter = existingContent.slice(endIdx).replace(/^\s+/, '');
    if (trimmedAfter) {
      return `${block}\n\n${trimmedAfter}`;
    }
    return block;
  }

  const trimmedExisting = existingContent.replace(/^\s+/, '');
  if (trimmedExisting) {
    return `${block}\n\n${trimmedExisting}`;
  }
  return block;
}

/**
 * Remove the AIDLC sentinel block from a CLAUDE.md string.
 *
 * Removal is clean: no leftover blank lines or markers remain.
 *
 * @param existingContent - Current CLAUDE.md text.
 * @returns CLAUDE.md text with the sentinel block stripped.
 */
export function removeAidlcRules(existingContent: string): string {
  if (!hasAidlcRules(existingContent)) {
    return existingContent;
  }

  const startIdx = existingContent.indexOf(SENTINEL_START);
  const endIdx = existingContent.indexOf(SENTINEL_END) + SENTINEL_END.length;

  const before = existingContent.slice(0, startIdx).replace(/\s+$/, '');
  const after = existingContent.slice(endIdx).replace(/^\s+/, '');

  if (before && after) {
    return `${before}\n\n${after}`;
  } else if (before) {
    return before;
  } else if (after) {
    return after;
  }
  return '';
}

/**
 * Generate the AI-DLC rules block adapted for Olympus.
 *
 * The content references Olympus-native agents for every workflow activity
 * and enforces mandatory loading of rule detail files from
 * `~/.claude/olympus/rules/ (installed by olympus-ai)` following the AWS AI-DLC pattern.
 *
 * @param workflowId - Active workflow identifier (slug).
 * @param pathwayType - Whether the project is greenfield or brownfield.
 * @returns Rules text (without sentinel wrappers).
 */
export function getAidlcRulesContent(workflowId: string, pathwayType: PathwayType): string {
  const isGreenfield = pathwayType === 'greenfield';
  const pathwayLabel = isGreenfield ? 'Greenfield' : 'Brownfield';

  return `# AI-DLC Workflow Rules (Olympus-Native)

## Active Workflow
- **Workflow ID**: \`${workflowId}\`
- **Pathway**: ${pathwayLabel} (${pathwayType})
- **State file**: \`aidlc-docs/${workflowId}/checkpoint.json\`
- **Human-readable state**: \`aidlc-docs/${workflowId}/aidlc-state.md\`
- **Audit log**: \`aidlc-docs/${workflowId}/audit.md\`

## Olympus Agent Delegation

Use Olympus agents for every workflow activity — do NOT implement directly unless the
task is trivial (single file, <10 lines). The delegation table below maps AI-DLC
workflow activities to the correct Olympus agent:

| Activity | Olympus Agent | When |
|----------|--------------|------|
| Strategic planning, intent interview | \`prometheus\` | Inception kickoff |
| Plan review / critical evaluation | \`momus\` | After each inception stage |
| Code implementation (multi-file) | \`olympian\` | Construction phase |
| Complex debugging / root-cause | \`oracle\` | Failures, unexpected behaviour |
| Codebase exploration / search | \`explore\` | Before coding, brownfield analysis |
| Documentation, requirements writing | \`document-writer\` | Artifact generation |
| Research, dependency lookup | \`librarian\` | Tech stack decisions |
| UI / frontend components | \`frontend-engineer\` | User-facing features |

**How to delegate:**
\`\`\`
Task(subagent_type="olympian", description="Implement {unit-name}", prompt="...")
Task(subagent_type="oracle", description="Debug failing test", prompt="...")
Task(subagent_type="explore", description="Map codebase structure", prompt="...")
\`\`\`

## Rule Detail Files (On-Demand Loading)

**CRITICAL**: When executing any stage, you MUST read the corresponding rule detail file BEFORE starting that stage's work. Rule files are located at:
\`~/.claude/olympus/rules/\` (installed by olympus-ai)

**Common rules** — MUST load at workflow start (MANDATORY):
- \`~/.claude/olympus/rules/common/process-overview.md\`
- \`~/.claude/olympus/rules/common/session-continuity.md\`
- \`~/.claude/olympus/rules/common/content-validation.md\`
- \`~/.claude/olympus/rules/common/question-format-guide.md\`

**Per-stage rules** — MUST load before executing each stage (MANDATORY):
- \`~/.claude/olympus/rules/inception/workspace-detection.md\`
${isGreenfield ? '' : '- `~/.claude/olympus/rules/inception/reverse-engineering.md` — brownfield only\n'}- \`~/.claude/olympus/rules/inception/requirements-analysis.md\`
- \`~/.claude/olympus/rules/inception/user-stories.md\`
- \`~/.claude/olympus/rules/inception/workflow-planning.md\`
- \`~/.claude/olympus/rules/inception/application-design.md\`
- \`~/.claude/olympus/rules/inception/units-generation.md\`
- \`~/.claude/olympus/rules/construction/functional-design.md\`
- \`~/.claude/olympus/rules/construction/nfr-requirements.md\`
- \`~/.claude/olympus/rules/construction/nfr-design.md\`
- \`~/.claude/olympus/rules/construction/infrastructure-design.md\`
- \`~/.claude/olympus/rules/construction/code-generation.md\`

## Directory Layout

\`\`\`
aidlc-docs/{workflow-id}/          # ALL documentation here
  checkpoint.json                  # Machine-readable state (V3)
  aidlc-state.md                   # Human-readable state
  audit.md                         # Append-only interaction log
  manifest.json                    # Artifact registry
  inception/
    intent.md
    nfr.md
    requirements-questions.md      # Q&A with [Answer]: tags
    requirements.md
    personas.md
    stories.md
    unit-of-work.md
    application-design/
    plans/
      workflow-routing.md
      execution-plan.md
  construction/
    {unit-name}/
      spec.md
      functional-design.md
      code-generation.md
  operations/
    deploy-guide.md
    runbook.md

[project source files]              # Application code — NEVER inside aidlc-docs/
\`\`\`

## State Tracking Rules

1. **Dual tracking**: Every stage transition updates BOTH \`checkpoint.json\` (machine)
   AND \`aidlc-state.md\` (human). Never update one without the other.
2. **Audit log**: Append every user input and AI response to \`audit.md\` with ISO-8601
   timestamps. NEVER overwrite — always append/edit.
3. **Checkpoint persistence**: Save checkpoint after each stage completion (CCR-1).
4. **Plan-level checkboxes**: Mark plan steps \`[x]\` in the SAME interaction where work
   completes. No deferred updates.

## Inception Stages (in order)

${isGreenfield
    ? `1. Workspace Detection (always)
2. Requirements Analysis (always)
3. User Stories (conditional)
4. Workflow Planning (always)
5. Application Design (conditional)
6. Units Generation (conditional)`
    : `1. Workspace Detection (always)
2. Reverse Engineering (brownfield — delegate to \`explore\` + \`oracle\`)
3. Requirements Analysis (always)
4. User Stories (conditional)
5. Workflow Planning (always)
6. Application Design (conditional)
7. Units Generation (conditional)`}

Each stage:
- Requires explicit human approval before proceeding (**do not auto-advance**)
- Produces a "REVIEW REQUIRED / WHAT'S NEXT" message after completion
- Logs all interactions in \`audit.md\`

## Construction Rules

- Complete each unit fully (design → code) before moving to the next unit
- Delegate code generation to \`olympian\` (or \`olympian-high\` for complex units)
- Use \`oracle\` for debugging failures, not re-running the same olympian prompt
- Mark code generation units fulfilled in \`manifest.json\` after human approval
- Run \`npm run build:all && npm test\` after each unit completes

## Must NOT Do

- Claim to override or supersede other built-in workflows
- Overwrite existing CLAUDE.md content outside these sentinel markers
- Implement multi-file changes without delegating to an Olympus agent
- Auto-advance past review gates without explicit human confirmation
- Write application code inside \`aidlc-docs/\``;
}

/**
 * Read and return the core-workflow.md content installed by olympus-ai.
 * Returns the content if found, or null if the file does not exist.
 * This will be wired into the install pipeline by the core-workflow unit.
 */
export function getNativeAidlcRulesContent(): string | null {
  const coreWorkflowPath = join(homedir(), '.claude', 'olympus', 'rules', 'core-workflow.md');
  if (!existsSync(coreWorkflowPath)) {
    return null;
  }
  return readFileSync(coreWorkflowPath, 'utf-8');
}
