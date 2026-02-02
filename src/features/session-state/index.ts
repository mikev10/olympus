/**
 * Session State Tracking
 *
 * Tracks recent task completions to enable smart verification edit detection.
 * Maintains in-memory state of the last 3 completed tasks and their modified files.
 */

export interface TaskCompletion {
  timestamp: number;
  filesModified: string[];
  taskId: string;
}

/**
 * SessionState tracks recent task completions and determines if an edit
 * qualifies as a "verification edit" (small edit on recently-modified file).
 */
export class SessionState {
  private recentTasks: TaskCompletion[] = [];
  private readonly maxTracked = 3;

  /**
   * Record a task completion with its modified files
   */
  recordTaskCompletion(completion: TaskCompletion): void {
    this.recentTasks.unshift(completion);
    if (this.recentTasks.length > this.maxTracked) {
      this.recentTasks.pop();
    }
  }

  /**
   * Check if a file edit qualifies as a verification edit:
   * - File was modified by one of the last 3 tasks
   * - Edit is small (< 10 lines changed)
   */
  isVerificationEdit(filePath: string, linesChanged: number): boolean {
    // Check if file was modified by any of last 3 tasks
    const wasModifiedByTask = this.recentTasks.some((task) =>
      task.filesModified.includes(filePath)
    );

    // Must be small edit (< 10 lines) on file from recent task
    return wasModifiedByTask && linesChanged < 10;
  }

  /**
   * Get all files modified by recent tasks (deduplicated)
   */
  getRecentTaskFiles(): string[] {
    const allFiles = this.recentTasks.flatMap((t) => t.filesModified);
    return Array.from(new Set(allFiles));
  }

  /**
   * Get recent task completions (for debugging/testing)
   */
  getRecentTasks(): TaskCompletion[] {
    return [...this.recentTasks];
  }

  /**
   * Clear all tracked tasks (for testing)
   */
  clear(): void {
    this.recentTasks = [];
  }

  /**
   * Get number of tracked tasks
   */
  get trackedCount(): number {
    return this.recentTasks.length;
  }
}

/**
 * Singleton instance for the session
 */
export const sessionState = new SessionState();
