/**
 * Workflow Execution Module
 *
 * Handles task status tracking, dependency resolution, and execution order.
 * Integrates with checkpoint.ts for persistence and dependency-graph.json for task relationships.
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { loadCheckpoint, saveCheckpoint } from './checkpoint.js';
import { WorkflowCheckpoint, DependencyGraph } from './types.js';

const WORKFLOW_DIR = '.olympus/workflow';
const DEPENDENCY_GRAPH_PATH = 'intents/dependency-graph.json';

/**
 * Task execution status.
 *
 * - pending: Task hasn't started yet
 * - in_progress: Currently working on this task
 * - complete: Task is finished
 * - failed: Task execution failed
 * - blocked: Cannot proceed due to unmet dependencies
 */
export type TaskStatus = 'pending' | 'in_progress' | 'complete' | 'failed' | 'blocked';

/**
 * Task status record stored in checkpoint.
 */
export interface TaskStatusRecord {
  /** Task ID */
  task_id: string;

  /** Current status */
  status: TaskStatus;

  /** ISO timestamp when status was last updated */
  updated_at: string;

  /** Error message if status is 'failed' */
  error?: string;
}

/**
 * Update the status of a task in the workflow checkpoint.
 * Creates a new status record or updates existing one.
 * Automatically updates the master plan progress section.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow
 * @param taskId - ID of the task to update
 * @param status - New status for the task
 * @param error - Optional error message if status is 'failed'
 * @throws Error if checkpoint doesn't exist
 */
export async function updateTaskStatus(
  projectPath: string,
  workflowId: string,
  taskId: string,
  status: TaskStatus,
  error?: string
): Promise<void> {
  const checkpoint = await loadCheckpoint(projectPath, workflowId);

  if (!checkpoint) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  // Initialize task_statuses if it doesn't exist
  if (!checkpoint.resume_context) {
    checkpoint.resume_context = {};
  }
  if (!checkpoint.resume_context.task_statuses) {
    checkpoint.resume_context.task_statuses = [];
  }

  const taskStatuses = checkpoint.resume_context.task_statuses as TaskStatusRecord[];

  // Find existing status record
  const existingIndex = taskStatuses.findIndex(t => t.task_id === taskId);

  const statusRecord: TaskStatusRecord = {
    task_id: taskId,
    status,
    updated_at: new Date().toISOString(),
    ...(error && { error })
  };

  if (existingIndex >= 0) {
    // Update existing record
    taskStatuses[existingIndex] = statusRecord;
  } else {
    // Add new record
    taskStatuses.push(statusRecord);
  }

  // Save updated checkpoint
  await saveCheckpoint(projectPath, checkpoint);

  // Update master plan progress section
  try {
    await updateMasterPlanProgress(projectPath, workflowId);
  } catch (error) {
    // Log warning but don't fail the status update if plan update fails
    console.warn(`Failed to update master plan progress: ${(error as Error).message}`);
  }
}

/**
 * Get the current status of a task.
 * Returns 'pending' if task hasn't been started yet.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow
 * @param taskId - ID of the task
 * @returns Current task status
 * @throws Error if checkpoint doesn't exist
 */
export async function getTaskStatus(
  projectPath: string,
  workflowId: string,
  taskId: string
): Promise<TaskStatus> {
  const checkpoint = await loadCheckpoint(projectPath, workflowId);

  if (!checkpoint) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const taskStatuses = checkpoint.resume_context?.task_statuses as TaskStatusRecord[] | undefined;

  if (!taskStatuses) {
    return 'pending';
  }

  const statusRecord = taskStatuses.find(t => t.task_id === taskId);
  return statusRecord ? statusRecord.status : 'pending';
}

/**
 * Load dependency graph from disk.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow
 * @returns Dependency graph or null if not found
 */
async function loadDependencyGraph(
  projectPath: string,
  workflowId: string
): Promise<DependencyGraph | null> {
  const graphPath = join(
    projectPath,
    WORKFLOW_DIR,
    workflowId,
    DEPENDENCY_GRAPH_PATH
  );

  try {
    const exists = await fs.pathExists(graphPath);
    if (!exists) {
      return null;
    }

    return await fs.readJson(graphPath);
  } catch (error) {
    console.warn(`Failed to load dependency graph for ${workflowId}:`, (error as Error).message);
    return null;
  }
}

/**
 * Get all tasks that are blocked by unmet dependencies.
 * A task is blocked if any of its dependencies are not in 'complete' status.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow
 * @returns Array of blocked task IDs
 * @throws Error if checkpoint doesn't exist
 */
export async function getBlockedTasks(
  projectPath: string,
  workflowId: string
): Promise<string[]> {
  const checkpoint = await loadCheckpoint(projectPath, workflowId);

  if (!checkpoint) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const graph = await loadDependencyGraph(projectPath, workflowId);

  if (!graph) {
    return [];
  }

  const taskStatuses = checkpoint.resume_context?.task_statuses as TaskStatusRecord[] | undefined;

  const blockedTasks: string[] = [];

  // Build dependency map: task -> [dependencies]
  const dependencyMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!dependencyMap.has(edge.to)) {
      dependencyMap.set(edge.to, []);
    }
    dependencyMap.get(edge.to)!.push(edge.from);
  }

  // Check each task with dependencies
  for (const [taskId, dependencies] of dependencyMap.entries()) {
    const hasUnmetDependencies = dependencies.some(depId => {
      const depStatus = taskStatuses?.find(t => t.task_id === depId)?.status || 'pending';
      return depStatus !== 'complete';
    });

    if (hasUnmetDependencies) {
      blockedTasks.push(taskId);
    }
  }

  return blockedTasks;
}

/**
 * Get the next task that is ready to execute.
 * A task is ready if:
 * - Its status is 'pending'
 * - All of its dependencies are in 'complete' status
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow
 * @returns Next ready task ID or null if no tasks are ready
 * @throws Error if checkpoint doesn't exist
 */
export async function getNextReadyTask(
  projectPath: string,
  workflowId: string
): Promise<string | null> {
  const checkpoint = await loadCheckpoint(projectPath, workflowId);

  if (!checkpoint) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const graph = await loadDependencyGraph(projectPath, workflowId);

  if (!graph || graph.nodes.length === 0) {
    return null;
  }

  const taskStatuses = checkpoint.resume_context?.task_statuses as TaskStatusRecord[] | undefined;

  // Build dependency map: task -> [dependencies]
  const dependencyMap = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!dependencyMap.has(edge.to)) {
      dependencyMap.set(edge.to, []);
    }
    dependencyMap.get(edge.to)!.push(edge.from);
  }

  // Find first pending task with all dependencies met
  for (const node of graph.nodes) {
    const taskId = node.id;
    const currentStatus = taskStatuses?.find(t => t.task_id === taskId)?.status || 'pending';

    // Skip if not pending
    if (currentStatus !== 'pending') {
      continue;
    }

    // Check if all dependencies are complete
    const dependencies = dependencyMap.get(taskId) || [];
    const allDependenciesMet = dependencies.every(depId => {
      const depStatus = taskStatuses?.find(t => t.task_id === depId)?.status || 'pending';
      return depStatus === 'complete';
    });

    if (allDependenciesMet) {
      return taskId;
    }
  }

  return null;
}

/**
 * Detect circular dependencies in the dependency graph.
 * Uses depth-first search with cycle detection.
 *
 * @param graph - Dependency graph to check
 * @returns Array of task IDs involved in circular dependencies (empty if no cycles)
 */
function detectCircularDependencies(graph: DependencyGraph): string[] {
  const adjacencyList = new Map<string, string[]>();

  // Build adjacency list
  for (const edge of graph.edges) {
    if (!adjacencyList.has(edge.from)) {
      adjacencyList.set(edge.from, []);
    }
    adjacencyList.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycleNodes = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          cycleNodes.add(node);
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        // Cycle detected
        cycleNodes.add(node);
        cycleNodes.add(neighbor);
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  // Check all nodes
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return Array.from(cycleNodes);
}

/**
 * Get execution order for all tasks in the workflow.
 * Uses topological sorting based on the dependency graph.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - ID of the workflow
 * @returns Array of task IDs in execution order
 * @throws Error if checkpoint doesn't exist
 * @throws Error if dependency graph contains circular dependencies
 * @throws Error if dependency graph doesn't exist
 */
export async function getExecutionOrder(
  projectPath: string,
  workflowId: string
): Promise<string[]> {
  const checkpoint = await loadCheckpoint(projectPath, workflowId);

  if (!checkpoint) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const graph = await loadDependencyGraph(projectPath, workflowId);

  if (!graph) {
    throw new Error(`Dependency graph not found for workflow ${workflowId}`);
  }

  // Check for circular dependencies
  const circularDeps = detectCircularDependencies(graph);
  if (circularDeps.length > 0) {
    throw new Error(`Circular dependencies detected: ${circularDeps.join(', ')}`);
  }

  // Topological sort using Kahn's algorithm
  const inDegree = new Map<string, number>();
  const adjacencyList = new Map<string, string[]>();

  // Initialize in-degrees and adjacency list
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
    adjacencyList.set(node.id, []);
  }

  // Build adjacency list and calculate in-degrees
  for (const edge of graph.edges) {
    adjacencyList.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // Queue of nodes with no incoming edges
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    // Reduce in-degree for neighbors
    const neighbors = adjacencyList.get(current) || [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If sorted array doesn't contain all nodes, there's a cycle (shouldn't happen due to earlier check)
  if (sorted.length !== graph.nodes.length) {
    throw new Error('Failed to compute execution order: cyclic dependency detected');
  }

  return sorted;
}

/**
 * Update the master plan file with current progress information.
 * Updates/creates a "## Progress" section showing completion stats, current task, and blocked tasks.
 *
 * @param baseDir - Base directory of the project (typically process.cwd())
 * @param workflowId - ID of the workflow
 * @throws Error if checkpoint or dependency graph doesn't exist
 */
export async function updateMasterPlanProgress(
  baseDir: string,
  workflowId: string
): Promise<void> {
  const checkpoint = await loadCheckpoint(baseDir, workflowId);

  if (!checkpoint) {
    throw new Error(`Workflow ${workflowId} not found`);
  }

  const graph = await loadDependencyGraph(baseDir, workflowId);

  if (!graph) {
    throw new Error(`Dependency graph not found for workflow ${workflowId}`);
  }

  const planPath = join(baseDir, '.olympus', 'plans', `${workflowId}-plan.md`);

  // Check if plan file exists
  const planExists = await fs.pathExists(planPath);
  if (!planExists) {
    console.warn(`Plan file not found: ${planPath}`);
    return;
  }

  // Read existing plan content
  let planContent = await fs.readFile(planPath, 'utf-8');

  // Get task statuses
  const taskStatuses = checkpoint.resume_context?.task_statuses as TaskStatusRecord[] | undefined;

  // Calculate completion statistics
  const totalTasks = graph.nodes.length;
  const completedTasks = taskStatuses?.filter(t => t.status === 'complete').length || 0;
  const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  // Find current in-progress task
  const inProgressTask = taskStatuses?.find(t => t.status === 'in_progress');
  const inProgressNode = inProgressTask
    ? graph.nodes.find(n => n.id === inProgressTask.task_id)
    : null;

  // Get blocked tasks
  const blockedTaskIds = await getBlockedTasks(baseDir, workflowId);
  const blockedNodes = blockedTaskIds
    .map(id => graph.nodes.find(n => n.id === id))
    .filter((n): n is typeof graph.nodes[0] => n !== undefined);

  // Build progress section content
  let progressSection = '## Progress\n\n';
  progressSection += `**Completion**: ${completedTasks}/${totalTasks} tasks (${completionPercentage}%)\n\n`;

  if (inProgressNode) {
    progressSection += `**Current Task**: ${inProgressNode.id} - ${inProgressNode.title}\n\n`;
  }

  if (blockedNodes.length > 0) {
    progressSection += `**Blocked Tasks**:\n`;
    for (const node of blockedNodes) {
      progressSection += `- ${node.id} - ${node.title}\n`;
    }
    progressSection += '\n';
  }

  progressSection += `**Last Updated**: ${new Date().toISOString()}\n\n`;

  // Check if progress section already exists
  const progressRegex = /^## Progress\s*\n[\s\S]*?(?=\n## |\n---|\n$)/m;
  const hasProgressSection = progressRegex.test(planContent);

  if (hasProgressSection) {
    // Replace existing progress section
    planContent = planContent.replace(progressRegex, progressSection.trim() + '\n');
  } else {
    // Insert progress section after the first heading or at the beginning
    const firstHeadingMatch = planContent.match(/^# .+$/m);
    if (firstHeadingMatch && firstHeadingMatch.index !== undefined) {
      const insertPosition = firstHeadingMatch.index + firstHeadingMatch[0].length;
      planContent =
        planContent.slice(0, insertPosition) +
        '\n\n' +
        progressSection +
        planContent.slice(insertPosition);
    } else {
      // No heading found, prepend to beginning
      planContent = progressSection + planContent;
    }
  }

  // Write updated plan back to disk
  await fs.writeFile(planPath, planContent, 'utf-8');
}
