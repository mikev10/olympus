/**
 * Agent Usage Reminder Hook
 *
 * Reminds users to use specialized agents when they make direct tool calls
 * for searching or fetching content instead of delegating to agents.
 *
 * This hook tracks tool usage and appends reminder messages to tool outputs
 * when users haven't been using agents effectively.
 *
 * Olympus agent-usage-reminder hook for extending Claude Code behavior.
 * Adapted for Claude Code's shell-based hook system.
 */

import {
  loadAgentUsageState,
  saveAgentUsageState,
  clearAgentUsageState,
} from './storage.js';
import { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE } from './constants.js';
import type { AgentUsageState } from './types.js';
import { readAscentState } from '../ascent/index.js';
import { readUltraworkState } from '../ultrawork-state/index.js';
import { readOlympusState } from '../olympus-state/index.js';

// Re-export types and utilities
export { loadAgentUsageState, saveAgentUsageState, clearAgentUsageState } from './storage.js';
export { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE } from './constants.js';
export type { AgentUsageState } from './types.js';

interface ToolExecuteInput {
  tool: string;
  sessionID: string;
  callID: string;
  properties?: Record<string, unknown>;
}

interface ToolExecuteOutput {
  title: string;
  output: string;
  metadata: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: unknown;
  };
}

interface DirectOperationTracker {
  consecutiveCount: number;
  lastToolName: string;
  lastFilePath: string;
  sessionId: string;
}

/**
 * Check if any persistent mode is active that requires strict conductor enforcement
 */
function isStrictConductorModeActive(directory?: string): { active: boolean; mode: string } {
  const workingDir = directory || process.cwd();

  const ascentState = readAscentState(workingDir);
  if (ascentState?.active) {
    return { active: true, mode: 'ascent' };
  }

  const olympusState = readOlympusState(workingDir);
  if (olympusState?.active) {
    return { active: true, mode: 'olympus' };
  }

  const ultraworkState = readUltraworkState(workingDir);
  if (ultraworkState?.active) {
    return { active: true, mode: 'ultrawork' };
  }

  return { active: false, mode: 'none' };
}

/**
 * Extract file path from tool input
 */
function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  return (obj.file_path || obj.filePath || obj.path) as string | null;
}

/**
 * Get strict conductor reminder when too many direct operations occur
 */
function getStrictConductorReminder(consecutiveOps: number, mode: string): string | null {
  if (consecutiveOps < 3) {
    return null; // Allow a few direct operations
  }

  const severity = consecutiveOps >= 5 ? 'CRITICAL' : 'WARNING';

  return `<conductor-violation severity="${severity}">

[${severity}: CONDUCTOR MODE VIOLATION - ${mode.toUpperCase()} ACTIVE]

You have made ${consecutiveOps} consecutive direct file operations without delegation.

**In ${mode} mode, you are a CONDUCTOR, not a worker.**

| Action | Required Approach |
|--------|-------------------|
| Multi-file changes | **DELEGATE** to olympian |
| UI/component work | **DELEGATE** to frontend-engineer |
| Complex logic | **DELEGATE** to olympian |

**STOP making direct edits. Delegate the remaining work:**

\`\`\`
Task(subagent_type="olympian", prompt="Continue implementing: [describe remaining work]")
\`\`\`

${consecutiveOps >= 5 ? '**CRITICAL**: Too many direct operations. Your next action MUST be delegation.' : ''}

</conductor-violation>

---

`;
}

export function createAgentUsageReminderHook() {
  const sessionStates = new Map<string, AgentUsageState>();
  const directOperationTrackers = new Map<string, DirectOperationTracker>();

  function getOrCreateState(sessionID: string): AgentUsageState {
    if (!sessionStates.has(sessionID)) {
      const persisted = loadAgentUsageState(sessionID);
      const state: AgentUsageState = persisted ?? {
        sessionID,
        agentUsed: false,
        reminderCount: 0,
        updatedAt: Date.now(),
      };
      sessionStates.set(sessionID, state);
    }
    return sessionStates.get(sessionID)!;
  }

  function markAgentUsed(sessionID: string): void {
    const state = getOrCreateState(sessionID);
    state.agentUsed = true;
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  }

  function resetState(sessionID: string): void {
    sessionStates.delete(sessionID);
    clearAgentUsageState(sessionID);
    directOperationTrackers.delete(sessionID);
  }

  function trackDirectOperation(sessionID: string, toolName: string, filePath: string): number {
    const tracker = directOperationTrackers.get(sessionID) || {
      consecutiveCount: 0,
      lastToolName: '',
      lastFilePath: '',
      sessionId: sessionID
    };

    // Reset if it's a Task tool (delegation occurred)
    if (toolName.toLowerCase() === 'task') {
      tracker.consecutiveCount = 0;
      directOperationTrackers.set(sessionID, tracker);
      return 0;
    }

    // Increment for edit/write operations
    if (['edit', 'write', 'multiedit'].includes(toolName.toLowerCase())) {
      tracker.consecutiveCount++;
      tracker.lastToolName = toolName;
      tracker.lastFilePath = filePath;
      directOperationTrackers.set(sessionID, tracker);
    }

    return tracker.consecutiveCount;
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ) => {
    const { tool, sessionID } = input;
    const toolLower = tool.toLowerCase();

    // Mark agent as used if agent tool was called
    if (AGENT_TOOLS.has(toolLower)) {
      markAgentUsed(sessionID);
      // Reset direct operation count when agent is used
      trackDirectOperation(sessionID, toolLower, '');
      return;
    }

    // Track direct operations for strict conductor mode
    const toolInput = input.properties || {};
    const filePath = extractFilePath(toolInput);
    const consecutiveOps = trackDirectOperation(sessionID, toolLower, filePath || '');

    // Check if strict conductor mode is active
    const strictMode = isStrictConductorModeActive();

    if (strictMode.active) {
      const strictReminder = getStrictConductorReminder(consecutiveOps, strictMode.mode);
      if (strictReminder) {
        // Prepend strict reminder (higher priority than normal reminder)
        output.output = strictReminder + output.output;
        return;
      }
    }

    // Only track target tools (search/fetch tools)
    if (!TARGET_TOOLS.has(toolLower)) {
      return;
    }

    const state = getOrCreateState(sessionID);

    // Don't remind if agent has been used
    if (state.agentUsed) {
      return;
    }

    // Append reminder message to output
    output.output += REMINDER_MESSAGE;
    state.reminderCount++;
    state.updatedAt = Date.now();
    saveAgentUsageState(state);
  };

  const eventHandler = async ({ event }: EventInput) => {
    const props = event.properties as Record<string, unknown> | undefined;

    // Clean up state when session is deleted
    if (event.type === 'session.deleted') {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id) {
        resetState(sessionInfo.id);
      }
    }

    // Clean up state when session is compacted
    if (event.type === 'session.compacted') {
      const sessionID = (props?.sessionID ??
        (props?.info as { id?: string } | undefined)?.id) as string | undefined;
      if (sessionID) {
        resetState(sessionID);
      }
    }
  };

  return {
    'tool.execute.after': toolExecuteAfter,
    event: eventHandler,
  };
}
