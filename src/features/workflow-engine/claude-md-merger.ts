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

All workflow stages, agent delegation, directory layout, and rules are defined in the
AI-DLC Core Workflow reference (loaded from core-workflow.md). This block only tracks
the active workflow identity above.`;
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
