// I2: a Task is a static definition. Status lives only in RunState.tasks, so
// there is exactly one place it can be read from and a RunState alone is
// enough to resume a run.
import type { RunState, Task, TaskStatus } from '@olympus-ai/core';

declare const task: Task;
declare const state: RunState;

export const fromTask = task.status; // expect-error TS2339: Property 'status' does not exist on type 'Task'
export const fromState: TaskStatus | undefined = state.tasks[task.id];
