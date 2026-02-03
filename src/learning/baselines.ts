/**
 * Session baseline calculation and storage
 * Tracks expected token usage per session for anomaly detection
 */

/**
 * Session baseline data structure
 */
export interface SessionBaseline {
  overall_avg: number;                      // Global average across all sessions
  by_task_type: Record<string, number>;     // Average by inferred task type
  by_project: Record<string, number>;       // Average by project path
  sample_count: number;                     // Total sessions tracked
  last_updated: string;                     // ISO timestamp
}

/**
 * Default baseline when no historical data exists
 */
const DEFAULT_BASELINE_TOKENS = 10000; // 10k tokens

/**
 * Get session baseline for a project/task type
 * Returns defaults when insufficient data
 *
 * @param projectPath - Optional project path for project-specific baseline
 * @param taskType - Optional task type for task-specific baseline
 * @param baseline - Existing baseline data (optional)
 * @returns Baseline token count
 */
export function getSessionBaseline(
  projectPath?: string,
  taskType?: string,
  baseline?: SessionBaseline
): number {
  // No baseline data - return cold start default
  if (!baseline) {
    return DEFAULT_BASELINE_TOKENS;
  }

  // Insufficient samples - return cold start default
  if (baseline.sample_count < 5) {
    return DEFAULT_BASELINE_TOKENS;
  }

  // Try project-specific baseline first
  if (projectPath && baseline.by_project[projectPath] !== undefined) {
    return baseline.by_project[projectPath];
  }

  // Try task-type baseline next
  if (taskType && baseline.by_task_type[taskType] !== undefined) {
    return baseline.by_task_type[taskType];
  }

  // Fall back to overall average
  return baseline.overall_avg;
}

/**
 * Update session baseline with new session data
 * Uses incremental averaging to avoid full recalculation
 *
 * @param sessionTokens - Tokens used in this session
 * @param projectPath - Project path for this session
 * @param taskType - Optional task type for this session
 * @param currentBaseline - Current baseline data (or undefined for first session)
 * @returns Updated baseline
 */
export function updateSessionBaseline(
  sessionTokens: number,
  projectPath: string,
  taskType?: string,
  currentBaseline?: SessionBaseline
): SessionBaseline {
  if (sessionTokens < 0) {
    throw new Error('Session tokens cannot be negative');
  }

  // Initialize baseline if first session
  if (!currentBaseline) {
    return {
      overall_avg: sessionTokens,
      by_task_type: taskType ? { [taskType]: sessionTokens } : {},
      by_project: { [projectPath]: sessionTokens },
      sample_count: 1,
      last_updated: new Date().toISOString()
    };
  }

  // Calculate new overall average using incremental approach
  const newSampleCount = currentBaseline.sample_count + 1;
  const newOverallAvg =
    (currentBaseline.overall_avg * currentBaseline.sample_count + sessionTokens) / newSampleCount;

  // Update project-specific average
  const projectCount = currentBaseline.by_project[projectPath]
    ? getProjectCount(currentBaseline, projectPath)
    : 0;
  const newProjectCount = projectCount + 1;
  const currentProjectAvg = currentBaseline.by_project[projectPath] || sessionTokens;
  const newProjectAvg =
    (currentProjectAvg * projectCount + sessionTokens) / newProjectCount;

  // Update task-type average if provided
  let newTaskTypeAvgs = { ...currentBaseline.by_task_type };
  if (taskType) {
    const taskCount = currentBaseline.by_task_type[taskType]
      ? getTaskTypeCount(currentBaseline, taskType)
      : 0;
    const newTaskCount = taskCount + 1;
    const currentTaskAvg = currentBaseline.by_task_type[taskType] || sessionTokens;
    const newTaskAvg =
      (currentTaskAvg * taskCount + sessionTokens) / newTaskCount;
    newTaskTypeAvgs[taskType] = newTaskAvg;
  }

  return {
    overall_avg: newOverallAvg,
    by_task_type: newTaskTypeAvgs,
    by_project: {
      ...currentBaseline.by_project,
      [projectPath]: newProjectAvg
    },
    sample_count: newSampleCount,
    last_updated: new Date().toISOString()
  };
}

/**
 * Helper to get project count (would ideally be tracked separately)
 * For now, we approximate based on overall count and unique projects
 * This is a simplification - in production you'd track counts separately
 */
function getProjectCount(baseline: SessionBaseline, projectPath: string): number {
  // Approximate: assume equal distribution across projects
  // In real implementation, track counts in SessionBaseline
  const projectCount = Object.keys(baseline.by_project).length;
  return Math.max(1, Math.floor(baseline.sample_count / projectCount));
}

/**
 * Helper to get task type count
 */
function getTaskTypeCount(baseline: SessionBaseline, taskType: string): number {
  // Approximate: assume equal distribution across task types
  const taskTypeCount = Object.keys(baseline.by_task_type).length;
  return Math.max(1, Math.floor(baseline.sample_count / taskTypeCount));
}

/**
 * Get warning threshold based on baseline and multiplier
 *
 * @param baseline - Current baseline token count
 * @param multiplier - Warning threshold multiplier (default: 1.5)
 * @returns Warning threshold in tokens
 */
export function getWarningThreshold(
  baseline: number,
  multiplier: number = 1.5
): number {
  if (baseline < 0 || multiplier < 0) {
    throw new Error('Baseline and multiplier must be non-negative');
  }

  return baseline * multiplier;
}
