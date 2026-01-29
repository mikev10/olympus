/**
 * Agent Usage Reminder Types
 *
 * Tracks agent usage to encourage delegation to specialized agents.
 *
 * Olympus agent-usage-reminder hook for extending Claude Code behavior.
 */

export interface AgentUsageState {
  sessionID: string;
  agentUsed: boolean;
  reminderCount: number;
  updatedAt: number;
}
