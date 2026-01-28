import type { AgentPerformance, UserPreferences } from './types.js';
import { existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface PromptPatch {
  agent_name: string;
  patch_type: 'append' | 'prepend';
  content: string;
  reason: string;
  confidence: number;
  evidence_count: number;
}

export interface PatchResult {
  agent_name: string;
  success: boolean;
  backup_path?: string;
  error?: string;
}

/** Generate prompt patches based on learnings */
export function generatePromptPatches(
  agentPerformance: Map<string, AgentPerformance>,
  userPreferences: UserPreferences
): PromptPatch[] {
  const patches: PromptPatch[] = [];

  // Generate patches from agent failure patterns
  for (const [agent, perf] of agentPerformance) {
    for (const failure of perf.failure_patterns) {
      if (failure.count >= 3) {
        patches.push({
          agent_name: agent,
          patch_type: 'append',
          content: `\n\n## Learned: ${failure.pattern}\nBe extra careful with: ${failure.pattern}. This has been flagged ${failure.count} times.`,
          reason: `Agent failed on "${failure.pattern}" ${failure.count} times`,
          confidence: Math.min(0.5 + failure.count * 0.1, 0.95),
          evidence_count: failure.count,
        });
      }
    }
  }

  // Generate patches from user preferences
  if (userPreferences.verbosity === 'concise') {
    patches.push({
      agent_name: '*',  // All agents
      patch_type: 'append',
      content: '\n\n## User Preference\nKeep responses concise. Avoid unnecessary verbosity.',
      reason: 'User prefers concise responses',
      confidence: 0.85,
      evidence_count: 3,
    });
  }

  for (const rule of userPreferences.explicit_rules) {
    patches.push({
      agent_name: '*',
      patch_type: 'append',
      content: `\n\n## User Rule\n${rule}`,
      reason: 'Explicit user preference',
      confidence: 0.95,
      evidence_count: 1,
    });
  }

  return patches;
}

/** Preview patches (dry run) */
export function previewPatches(patches: PromptPatch[]): string {
  const lines: string[] = ['Suggested Prompt Patches:', ''];

  for (const patch of patches) {
    lines.push(`Agent: ${patch.agent_name}`);
    lines.push(`Type: ${patch.patch_type}`);
    lines.push(`Reason: ${patch.reason}`);
    lines.push(`Confidence: ${(patch.confidence * 100).toFixed(0)}%`);
    lines.push(`Content: ${patch.content.substring(0, 100)}...`);
    lines.push('---');
  }

  return lines.join('\n');
}

/** Apply patches to agent prompt files */
export function applyPromptPatches(
  patches: PromptPatch[],
  agentsDir: string = join(homedir(), '.claude', 'agents')
): PatchResult[] {
  const results: PatchResult[] = [];

  for (const patch of patches) {
    const agentFiles = patch.agent_name === '*'
      ? getAllAgentFiles(agentsDir)
      : [join(agentsDir, `${patch.agent_name}.md`)];

    for (const filePath of agentFiles) {
      if (!existsSync(filePath)) {
        results.push({
          agent_name: patch.agent_name,
          success: false,
          error: `File not found: ${filePath}`,
        });
        continue;
      }

      try {
        // Create backup
        const backupPath = `${filePath}.backup.${Date.now()}`;
        copyFileSync(filePath, backupPath);

        // Read current content
        const content = readFileSync(filePath, 'utf-8');

        // Apply patch
        const newContent = patch.patch_type === 'prepend'
          ? patch.content + '\n\n' + content
          : content + '\n' + patch.content;

        writeFileSync(filePath, newContent, 'utf-8');

        results.push({
          agent_name: patch.agent_name,
          success: true,
          backup_path: backupPath,
        });
      } catch (error) {
        results.push({
          agent_name: patch.agent_name,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return results;
}

/** Revert a patch using backup file */
export function revertPatch(backupPath: string): boolean {
  const originalPath = backupPath.replace(/\.backup\.\d+$/, '');
  try {
    copyFileSync(backupPath, originalPath);
    return true;
  } catch {
    return false;
  }
}

function getAllAgentFiles(agentsDir: string): string[] {
  if (!existsSync(agentsDir)) return [];

  return readdirSync(agentsDir)
    .filter((f: string) => f.endsWith('.md'))
    .map((f: string) => join(agentsDir, f));
}
