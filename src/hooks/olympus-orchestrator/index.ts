/**
 * Olympus Orchestrator Hook - Delegation Enforcement
 *
 * Trigger: tool-call event (Write/Edit tool usage)
 *
 * Behavior:
 * - Detects when orchestrator attempts direct file modification
 * - Allows modifications only to .olympus/ directory
 * - Injects reminders to delegate to subagents for code changes
 *
 * User Impact: Enforces "conductor mindset" - orchestrators delegate, not implement
 */

import { execSync } from 'child_process';
import {
  HOOK_NAME,
  ALLOWED_PATH_PREFIX,
  WRITE_EDIT_TOOLS,
  DIRECT_WORK_REMINDER,
  ORCHESTRATOR_DELEGATION_REQUIRED,
  QUEST_CONTINUATION_PROMPT,
  VERIFICATION_REMINDER,
  SINGLE_TASK_DIRECTIVE,
  DELEGATION_REQUIRED_ERROR,
} from './constants.js';
import {
  readQuestState,
  getPlanProgress,
} from '../../features/quest-state/index.js';
import { SessionState } from '../../features/session-state/index.js';
import { logViolation } from '../../features/hook-logging/index.js';

// Re-export constants
export * from './constants.js';

// Module-level session state instance
const sessionState = new SessionState();

/**
 * Input for tool execution hooks
 */
export interface ToolExecuteInput {
  toolName: string;
  toolInput?: Record<string, unknown>;
  sessionId?: string;
  directory?: string;
  sessionState?: SessionState;
}

/**
 * Output for tool execution hooks
 */
export interface ToolExecuteOutput {
  continue: boolean;
  message?: string;
  modifiedOutput?: string;
}

/**
 * Git file change statistics
 */
interface GitFileStat {
  path: string;
  added: number;
  removed: number;
  status: 'modified' | 'added' | 'deleted';
}

/**
 * Check if a file path is allowed for direct orchestrator modification
 */
export function isAllowedPath(filePath: string): boolean {
  if (!filePath) return true;
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes(ALLOWED_PATH_PREFIX);
}

/**
 * Check if a file is a test file
 */
export function isTestFile(filePath: string): boolean {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('__tests__/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.js') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.js')
  );
}

/**
 * Calculate lines changed from tool input
 */
export function calculateLinesChanged(
  toolName: string,
  toolInput?: Record<string, unknown>
): number {
  if (!toolInput) return 0;

  // For Edit tool, calculate based on old_string and new_string
  if (toolName === 'Edit' || toolName === 'edit') {
    const oldString = (toolInput.old_string ?? '') as string;
    const newString = (toolInput.new_string ?? '') as string;
    if (!oldString && !newString) return 0;
    const oldLines = oldString.split('\n').length;
    const newLines = newString.split('\n').length;
    return Math.abs(newLines - oldLines);
  }

  // For Write tool, calculate based on content
  if (toolName === 'Write' || toolName === 'write') {
    const content = (toolInput.content ?? '') as string;
    if (!content) return 0;
    return content.split('\n').length;
  }

  return 0;
}

/**
 * Check if a tool is a write/edit tool
 */
export function isWriteEditTool(toolName: string): boolean {
  return WRITE_EDIT_TOOLS.includes(toolName);
}

/**
 * Get git diff statistics for the working directory
 */
export function getGitDiffStats(directory: string): GitFileStat[] {
  try {
    const output = execSync('git diff --numstat HEAD', {
      cwd: directory,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!output) return [];

    const statusOutput = execSync('git status --porcelain', {
      cwd: directory,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    const statusMap = new Map<string, 'modified' | 'added' | 'deleted'>();
    for (const line of statusOutput.split('\n')) {
      if (!line) continue;
      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3);
      if (status === 'A' || status === '??') {
        statusMap.set(filePath, 'added');
      } else if (status === 'D') {
        statusMap.set(filePath, 'deleted');
      } else {
        statusMap.set(filePath, 'modified');
      }
    }

    const stats: GitFileStat[] = [];
    for (const line of output.split('\n')) {
      const parts = line.split('\t');
      if (parts.length < 3) continue;

      const [addedStr, removedStr, path] = parts;
      const added = addedStr === '-' ? 0 : parseInt(addedStr, 10);
      const removed = removedStr === '-' ? 0 : parseInt(removedStr, 10);

      stats.push({
        path,
        added,
        removed,
        status: statusMap.get(path) ?? 'modified',
      });
    }

    return stats;
  } catch {
    return [];
  }
}

/**
 * Format file changes for display
 */
export function formatFileChanges(stats: GitFileStat[]): string {
  if (stats.length === 0) return '[FILE CHANGES SUMMARY]\nNo file changes detected.\n';

  const modified = stats.filter((s) => s.status === 'modified');
  const added = stats.filter((s) => s.status === 'added');
  const deleted = stats.filter((s) => s.status === 'deleted');

  const lines: string[] = ['[FILE CHANGES SUMMARY]'];

  if (modified.length > 0) {
    lines.push('Modified files:');
    for (const f of modified) {
      lines.push(`  ${f.path}  (+${f.added}, -${f.removed})`);
    }
    lines.push('');
  }

  if (added.length > 0) {
    lines.push('Created files:');
    for (const f of added) {
      lines.push(`  ${f.path}  (+${f.added})`);
    }
    lines.push('');
  }

  if (deleted.length > 0) {
    lines.push('Deleted files:');
    for (const f of deleted) {
      lines.push(`  ${f.path}  (-${f.removed})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Build verification reminder with session context
 */
export function buildVerificationReminder(sessionId?: string): string {
  let reminder = VERIFICATION_REMINDER;

  if (sessionId) {
    reminder += `

---

**If ANY verification fails, resume the subagent with the fix:**
Task tool with resume="${sessionId}", prompt="fix: [describe the specific failure]"`;
  }

  return reminder;
}

/**
 * Build orchestrator reminder with plan progress
 */
export function buildOrchestratorReminder(
  planName: string,
  progress: { total: number; completed: number },
  sessionId?: string
): string {
  const remaining = progress.total - progress.completed;
  return `
---

**State:** Plan: ${planName} | ${progress.completed}/${progress.total} done, ${remaining} left

---

${buildVerificationReminder(sessionId)}

ALL pass? → commit atomic unit, mark \`[x]\`, next task.`;
}

/**
 * Build quest continuation message
 */
export function buildQuestContinuation(
  planName: string,
  remaining: number,
  total: number
): string {
  return QUEST_CONTINUATION_PROMPT.replace(/{PLAN_NAME}/g, planName) +
    `\n\n[Status: ${total - remaining}/${total} completed, ${remaining} remaining]`;
}

/**
 * Process pre-tool-use hook for orchestrator
 * Implements HARD BLOCKING for direct source file modifications
 */
export function processOrchestratorPreTool(input: ToolExecuteInput): ToolExecuteOutput {
  const { toolName, toolInput, directory } = input;
  const workDir = directory || process.cwd();

  // Only check write/edit tools
  if (!isWriteEditTool(toolName)) {
    return { continue: true };
  }

  // Extract file path from tool input
  const filePath = (toolInput?.filePath ?? toolInput?.path ?? toolInput?.file) as string | undefined;

  if (!filePath) {
    return { continue: true };
  }

  const normalizedPath = filePath.replace(/\\/g, '/');

  // ALWAYS ALLOW: .olympus/ paths
  if (isAllowedPath(normalizedPath)) {
    logViolation(
      {
        timestamp: new Date().toISOString(),
        filePath: normalizedPath,
        toolName,
        wasBlocked: false,
        reason: 'Allowed: .olympus/ path',
      },
      workDir
    );
    return { continue: true };
  }

  // ALWAYS ALLOW: Test file creation
  if (isTestFile(normalizedPath)) {
    logViolation(
      {
        timestamp: new Date().toISOString(),
        filePath: normalizedPath,
        toolName,
        wasBlocked: false,
        reason: 'Allowed: Test file',
      },
      workDir
    );
    return { continue: true };
  }

  // Check for verification edit exception
  const linesChanged = calculateLinesChanged(toolName, toolInput);
  if (sessionState.isVerificationEdit(normalizedPath, linesChanged)) {
    logViolation(
      {
        timestamp: new Date().toISOString(),
        filePath: normalizedPath,
        toolName,
        linesChanged,
        wasBlocked: false,
        reason: `Allowed: Verification edit (${linesChanged} lines on recent task file)`,
      },
      workDir
    );
    return { continue: true };
  }

  // HARD BLOCK: Direct source file modification
  logViolation(
    {
      timestamp: new Date().toISOString(),
      filePath: normalizedPath,
      toolName,
      linesChanged,
      wasBlocked: true,
      reason: 'Blocked: Direct source file modification (delegation required)',
    },
    workDir
  );

  return {
    continue: false,
    message: DELEGATION_REQUIRED_ERROR,
  };
}

/**
 * Process post-tool-use hook for orchestrator
 * Adds reminders after file modifications and Task delegations
 * Records Task completions in session state
 */
export function processOrchestratorPostTool(
  input: ToolExecuteInput,
  output: string
): ToolExecuteOutput {
  const { toolName, toolInput, directory, sessionId } = input;
  const workDir = directory || process.cwd();

  // Handle write/edit tools
  if (isWriteEditTool(toolName)) {
    const filePath = (toolInput?.filePath ?? toolInput?.path ?? toolInput?.file) as string | undefined;

    if (filePath && !isAllowedPath(filePath)) {
      return {
        continue: true,
        modifiedOutput: output + DIRECT_WORK_REMINDER,
      };
    }
  }

  // Handle Task tool completion
  if (toolName === 'Task' || toolName === 'task') {
    // Check for background task launch
    const isBackgroundLaunch = output.includes('Background task launched') || output.includes('Background task resumed');
    if (isBackgroundLaunch) {
      return { continue: true };
    }

    // Get git stats and record task completion
    const gitStats = getGitDiffStats(workDir);
    const filesModified = gitStats.map((stat) => stat.path);

    // Record task completion in session state
    sessionState.recordTaskCompletion({
      timestamp: Date.now(),
      filesModified,
      taskId: sessionId || `task-${Date.now()}`,
    });

    const fileChanges = formatFileChanges(gitStats);

    // Check for quest state
    const questState = readQuestState(workDir);

    if (questState) {
      const progress = getPlanProgress(questState.active_plan);

      const enhancedOutput = `
## SUBAGENT WORK COMPLETED

${fileChanges}
<system-reminder>
${buildOrchestratorReminder(questState.plan_name, progress, sessionId)}
</system-reminder>`;

      return {
        continue: true,
        modifiedOutput: enhancedOutput,
      };
    }

    // No quest state - add standalone verification reminder
    return {
      continue: true,
      modifiedOutput: output + `\n<system-reminder>\n${buildVerificationReminder(sessionId)}\n</system-reminder>`,
    };
  }

  return { continue: true };
}

/**
 * Check if quest has incomplete tasks and build continuation prompt
 */
export function checkQuestContinuation(directory: string): {
  shouldContinue: boolean;
  message?: string;
} {
  const questState = readQuestState(directory);

  if (!questState) {
    return { shouldContinue: false };
  }

  const progress = getPlanProgress(questState.active_plan);

  if (progress.isComplete) {
    return { shouldContinue: false };
  }

  const remaining = progress.total - progress.completed;

  return {
    shouldContinue: true,
    message: buildQuestContinuation(questState.plan_name, remaining, progress.total),
  };
}

/**
 * Create olympus orchestrator hook handlers
 */
export function createOlympusOrchestratorHook(directory: string) {
  return {
    /**
     * Hook name identifier
     */
    name: HOOK_NAME,

    /**
     * Pre-tool execution handler
     */
    preTool: (toolName: string, toolInput: Record<string, unknown>) => {
      return processOrchestratorPreTool({
        toolName,
        toolInput,
        directory,
      });
    },

    /**
     * Post-tool execution handler
     */
    postTool: (toolName: string, toolInput: Record<string, unknown>, output: string) => {
      return processOrchestratorPostTool(
        { toolName, toolInput, directory },
        output
      );
    },

    /**
     * Check for quest continuation on session idle
     */
    checkContinuation: () => {
      return checkQuestContinuation(directory);
    },

    /**
     * Get single task directive for subagent prompts
     */
    getSingleTaskDirective: () => SINGLE_TASK_DIRECTIVE,
  };
}
