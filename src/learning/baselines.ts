/**
 * Session baseline calculation and storage
 * Tracks expected token usage per session for anomaly detection
 */

export interface SessionBaseline {
  overall_avg: number;
  by_task_type: Record<string, number>;
  sample_count: number;
  last_updated: string;
}

const DEFAULT_BASELINE_TOKENS = 10000;

export function getSessionBaseline(
  taskType?: string,
  baseline?: SessionBaseline
): number {
  if (!baseline) {
    return DEFAULT_BASELINE_TOKENS;
  }

  if (baseline.sample_count < 5) {
    return DEFAULT_BASELINE_TOKENS;
  }

  if (taskType && baseline.by_task_type[taskType] !== undefined) {
    return baseline.by_task_type[taskType];
  }

  return baseline.overall_avg;
}

export function updateSessionBaseline(
  sessionTokens: number,
  taskType?: string,
  currentBaseline?: SessionBaseline
): SessionBaseline {
  if (sessionTokens < 0) {
    throw new Error('Session tokens cannot be negative');
  }

  if (!currentBaseline) {
    return {
      overall_avg: sessionTokens,
      by_task_type: taskType ? { [taskType]: sessionTokens } : {},
      sample_count: 1,
      last_updated: new Date().toISOString()
    };
  }

  const newSampleCount = currentBaseline.sample_count + 1;
  const newOverallAvg =
    (currentBaseline.overall_avg * currentBaseline.sample_count + sessionTokens) / newSampleCount;

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
    sample_count: newSampleCount,
    last_updated: new Date().toISOString()
  };
}

function getTaskTypeCount(baseline: SessionBaseline, taskType: string): number {
  const taskTypeCount = Object.keys(baseline.by_task_type).length;
  return Math.max(1, Math.floor(baseline.sample_count / taskTypeCount));
}

export function getWarningThreshold(
  baseline: number,
  multiplier: number = 1.5
): number {
  if (baseline < 0 || multiplier < 0) {
    throw new Error('Baseline and multiplier must be non-negative');
  }

  return baseline * multiplier;
}
