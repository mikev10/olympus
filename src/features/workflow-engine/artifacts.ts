import * as path from 'path';
import * as fs from 'fs-extra';
import { WorkflowStage, IntentTask, IntentNode, DependencyGraph } from './types.js';
import { WorkflowPhase } from './phase-types.js';

/**
 * Ensures the workflow directory structure exists.
 * Creates:
 * - .olympus/workflow/{workflowId}/
 * - .olympus/workflow/{workflowId}/intents/
 * - .olympus/workflow/{workflowId}/validation/
 * - .olympus/workflow/{workflowId}/checkpoint.json (if not exists)
 *
 * Idempotent - safe to call multiple times.
 * @throws Error if disk is full or permissions are denied
 */
export async function ensureWorkflowDir(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);
  const intentsDir = path.join(workflowDir, 'intents');
  const validationDir = path.join(workflowDir, 'validation');
  const checkpointPath = path.join(workflowDir, 'checkpoint.json');

  try {
    // Create directories
    await fs.ensureDir(workflowDir);
    await fs.ensureDir(intentsDir);
    await fs.ensureDir(validationDir);

    // Initialize checkpoint.json if it doesn't exist
    if (!await fs.pathExists(checkpointPath)) {
      await fs.writeJson(checkpointPath, {
        workflow_id: workflowId,
        current_stage: 'idea',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { spaces: 2 });
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to create workflow directory: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Attempted path: ${workflowDir}`);
      throw new Error(
        'Failed to create workflow directory: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to create workflow directory: Permission denied`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        `Failed to create workflow directory: Permission denied for ${workflowDir}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to create workflow directory: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        'Failed to create workflow directory: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to create workflow directory: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    console.error(`[Artifacts] Path: ${workflowDir}`);
    throw new Error(
      `Failed to create workflow directory for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Returns the file path for a given workflow stage artifact.
 *
 * @throws Error if stage is 'complete' (no artifact for complete stage)
 * @throws Error if stage is 'intents' (intents is a directory, not a file)
 */
export function getArtifactPath(projectPath: string, workflowId: string, stage: WorkflowStage): string {
  if (stage === 'complete') {
    throw new Error('No artifact file for complete stage');
  }

  if (stage === 'intents') {
    throw new Error('Intents is a directory, not a single file. Use getIntentsDir() instead.');
  }

  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);

  const artifactMap: Record<Exclude<WorkflowStage, 'complete' | 'intents'>, string> = {
    'idea': 'idea.md',
    'prd': 'prd.md',
    'spec': 'spec.md',
  };

  const filename = artifactMap[stage as Exclude<WorkflowStage, 'complete' | 'intents'>];
  return path.join(workflowDir, filename);
}

/**
 * Writes artifact content to the correct path for the given stage.
 * Creates parent directories if needed.
 *
 * @throws Error if stage is 'intents' (use different function for multiple intent files)
 * @throws Error if stage is 'complete' (no artifact for complete stage)
 * @throws Error if disk is full or permissions are denied
 */
export async function writeArtifact(
  projectPath: string,
  workflowId: string,
  stage: WorkflowStage,
  content: string
): Promise<void> {
  if (stage === 'intents') {
    throw new Error('Cannot write single artifact for intents stage. Use writeIntentFile() instead.');
  }

  const artifactPath = getArtifactPath(projectPath, workflowId, stage);

  try {
    await fs.ensureDir(path.dirname(artifactPath));
    await fs.writeFile(artifactPath, content, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to write ${stage} artifact: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to write ${stage} artifact: Disk is full. Please free up space and retry.`
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to write ${stage} artifact: Permission denied`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to write ${stage} artifact: Permission denied for ${artifactPath}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to write ${stage} artifact: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to write ${stage} artifact: Filesystem is read-only`
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to write ${stage} artifact: ${err.message}`);
    console.error(`[Artifacts] Path: ${artifactPath}`);
    throw new Error(
      `Failed to write ${stage} artifact: ${err.message}`
    );
  }
}

/**
 * Reads artifact content from the correct path for the given stage.
 *
 * @returns Content of the artifact, or null if the file doesn't exist
 * @throws Error if stage is 'intents' (use different function to read multiple files)
 * @throws Error if stage is 'complete' (no artifact for complete stage)
 * @throws Error if permissions are denied or file is corrupt
 */
export async function readArtifact(
  projectPath: string,
  workflowId: string,
  stage: WorkflowStage
): Promise<string | null> {
  if (stage === 'intents') {
    throw new Error('Cannot read single artifact for intents stage. Use readIntentFiles() instead.');
  }

  const artifactPath = getArtifactPath(projectPath, workflowId, stage);

  try {
    if (!await fs.pathExists(artifactPath)) {
      return null;
    }

    return await fs.readFile(artifactPath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // File not found is expected (return null)
    if (err.code === 'ENOENT') {
      return null;
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to read ${stage} artifact: Permission denied`);
      console.error(`[Artifacts] Path: ${artifactPath}`);
      throw new Error(
        `Failed to read ${stage} artifact: Permission denied for ${artifactPath}`
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to read ${stage} artifact: ${err.message}`);
    console.error(`[Artifacts] Path: ${artifactPath}`);
    throw new Error(
      `Failed to read ${stage} artifact: ${err.message}`
    );
  }
}

/**
 * Generates a dependency graph from an array of intent tasks.
 * Creates nodes and edges representing task dependencies.
 *
 * @param tasks - Array of IntentTask objects with dependencies
 * @returns DependencyGraph with nodes and edges
 *
 * @example
 * const tasks = [
 *   { id: "A", title: "Task A", component: "Auth", estimated_effort: 3, dependencies: [] },
 *   { id: "B", title: "Task B", component: "Auth", estimated_effort: 2, dependencies: ["A"] }
 * ];
 * const graph = generateDependencyGraph(tasks);
 * // Returns: { nodes: [...], edges: [{ from: "A", to: "B" }] }
 */
export function generateDependencyGraph(tasks: IntentTask[]): DependencyGraph {
  const nodes: IntentNode[] = tasks.map(task => ({
    id: task.id,
    title: task.title,
    component: task.component,
    estimated_effort: task.estimated_effort,
  }));

  const edges: { from: string; to: string }[] = [];
  for (const task of tasks) {
    for (const dep of task.dependencies) {
      edges.push({ from: dep, to: task.id });
    }
  }

  return { nodes, edges };
}

/**
 * Validates a dependency graph for cycles and structural integrity.
 * Throws errors if:
 * - Circular dependencies are detected
 * - Node IDs are not unique
 * - Edge references point to non-existent nodes
 *
 * @param graph - The dependency graph to validate
 * @throws Error if validation fails with detailed message
 *
 * @example
 * validateDependencyGraph(graph); // Throws if graph has cycles
 */
export function validateDependencyGraph(graph: DependencyGraph): void {
  // Validate unique node IDs
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (nodeIds.has(node.id)) {
      throw new Error(`Duplicate node ID detected: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  // Validate all edges reference existing nodes
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      throw new Error(`Edge references non-existent node: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      throw new Error(`Edge references non-existent node: ${edge.to}`);
    }
  }

  // Detect circular dependencies using DFS
  const adjacencyList = new Map<string, string[]>();
  for (const node of graph.nodes) {
    adjacencyList.set(node.id, []);
  }
  for (const edge of graph.edges) {
    adjacencyList.get(edge.from)!.push(edge.to);
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recStack.add(nodeId);
    path.push(nodeId);

    const neighbors = adjacencyList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          return true;
        }
      } else if (recStack.has(neighbor)) {
        // Found a cycle
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart).concat(neighbor);
        throw new Error(`Circular dependency detected: ${cycle.join(' -> ')}`);
      }
    }

    recStack.delete(nodeId);
    path.pop();
    return false;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }
}

/**
 * Returns the execution order of tasks based on dependency graph.
 * Uses topological sort (Kahn's algorithm) to determine order.
 *
 * @param graph - The dependency graph to sort
 * @returns Array of task IDs in execution order
 * @throws Error if graph contains cycles (should validate first)
 *
 * @example
 * const order = getExecutionOrder(graph);
 * // Returns: ["TASK-001", "TASK-002", "TASK-003"]
 */
export function getExecutionOrder(graph: DependencyGraph): string[] {
  // Build adjacency list and in-degree map
  const adjacencyList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const node of graph.nodes) {
    adjacencyList.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  // Build graph
  for (const edge of graph.edges) {
    adjacencyList.get(edge.from)!.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const result: string[] = [];

  // Start with nodes that have no dependencies
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    // Reduce in-degree for neighbors
    const neighbors = adjacencyList.get(current) || [];
    for (const neighbor of neighbors) {
      const newDegree = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDegree);

      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  // If result doesn't contain all nodes, there's a cycle
  if (result.length !== graph.nodes.length) {
    throw new Error('Cannot determine execution order: graph contains cycles');
  }

  return result;
}

/**
 * Links workflow artifacts to the master plan file.
 * Creates or updates .olympus/plans/{workflowId}-plan.md with references
 * to all structured workflow artifacts.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @throws Error if disk is full or permissions are denied
 *
 * @example
 * await linkMasterPlan('/path/to/project', 'wf-2024-01-15-user-auth');
 * // Creates/updates .olympus/plans/wf-2024-01-15-user-auth-plan.md
 */
export async function linkMasterPlan(
  projectPath: string,
  workflowId: string
): Promise<void> {
  const plansDir = path.join(projectPath, '.olympus', 'plans');
  const planPath = path.join(plansDir, `${workflowId}-plan.md`);

  try {
    await fs.ensureDir(plansDir);

  const artifactsSection = `## Structured Artifacts

This feature was developed using the structured workflow system:

- [IDEA Artifact](.olympus/workflow/${workflowId}/idea.md)
- [PRD Artifact](.olympus/workflow/${workflowId}/prd.md)
- [SPEC Artifact](.olympus/workflow/${workflowId}/spec.md)
- [Intent Files](.olympus/workflow/${workflowId}/intents/)
- [Dependency Graph](.olympus/workflow/${workflowId}/intents/dependency-graph.json)
- [Workflow Checkpoint](.olympus/workflow/${workflowId}/checkpoint.json)
`;

    let content = '';

    if (await fs.pathExists(planPath)) {
      // Read existing file
      content = await fs.readFile(planPath, 'utf-8');

      // Check if Structured Artifacts section exists
      const sectionRegex = /## Structured Artifacts[\s\S]*?(?=\n## |$)/;
      if (sectionRegex.test(content)) {
        // Replace existing section
        content = content.replace(sectionRegex, artifactsSection.trim());
      } else {
        // Append section at the end
        content = content.trim() + '\n\n' + artifactsSection;
      }
    } else {
      // Create new file with header
      content = `# Plan: ${workflowId}

${artifactsSection}`;
    }

    await fs.writeFile(planPath, content, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to link master plan: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Path: ${planPath}`);
      throw new Error(
        'Failed to link master plan: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to link master plan: Permission denied`);
      console.error(`[Artifacts] Path: ${planPath}`);
      throw new Error(
        `Failed to link master plan: Permission denied for ${planPath}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to link master plan: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${planPath}`);
      throw new Error(
        'Failed to link master plan: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to link master plan: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    console.error(`[Artifacts] Path: ${planPath}`);
    throw new Error(
      `Failed to link master plan for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Ensures the phase-based workflow directory structure exists.
 * Creates:
 * - .olympus/workflow/{workflowId}/
 * - .olympus/workflow/{workflowId}/vision/
 * - .olympus/workflow/{workflowId}/vision/intents/
 * - .olympus/workflow/{workflowId}/vision/validation/
 * - .olympus/workflow/{workflowId}/forge/
 * - .olympus/workflow/{workflowId}/forge/units/
 * - .olympus/workflow/{workflowId}/forge/design/
 * - .olympus/workflow/{workflowId}/forge/bolts/
 * - .olympus/workflow/{workflowId}/forge/bolts/results/
 * - .olympus/workflow/{workflowId}/forge/validation/
 * - .olympus/workflow/{workflowId}/summit/
 * - .olympus/workflow/{workflowId}/summit/validation/
 *
 * Idempotent - safe to call multiple times.
 * Does NOT create manifest.json (that's manifest.ts's job).
 * @throws Error if disk is full or permissions are denied
 */
export async function ensurePhaseWorkflowDir(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);

  try {
    // Create base workflow directory
    await fs.ensureDir(workflowDir);

    // Create Vision phase directories
    await fs.ensureDir(path.join(workflowDir, 'vision'));
    await fs.ensureDir(path.join(workflowDir, 'vision', 'intents'));
    await fs.ensureDir(path.join(workflowDir, 'vision', 'validation'));

    // Create Forge phase directories
    await fs.ensureDir(path.join(workflowDir, 'forge'));
    await fs.ensureDir(path.join(workflowDir, 'forge', 'units'));
    await fs.ensureDir(path.join(workflowDir, 'forge', 'design'));
    await fs.ensureDir(path.join(workflowDir, 'forge', 'bolts'));
    await fs.ensureDir(path.join(workflowDir, 'forge', 'bolts', 'results'));
    await fs.ensureDir(path.join(workflowDir, 'forge', 'validation'));

    // Create Summit phase directories
    await fs.ensureDir(path.join(workflowDir, 'summit'));
    await fs.ensureDir(path.join(workflowDir, 'summit', 'validation'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to create phase workflow directory: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Attempted path: ${workflowDir}`);
      throw new Error(
        'Failed to create phase workflow directory: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to create phase workflow directory: Permission denied`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        `Failed to create phase workflow directory: Permission denied for ${workflowDir}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to create phase workflow directory: Read-only filesystem`);
      console.error(`[Artifacts] Path: ${workflowDir}`);
      throw new Error(
        'Failed to create phase workflow directory: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to create phase workflow directory: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    console.error(`[Artifacts] Path: ${workflowDir}`);
    throw new Error(
      `Failed to create phase workflow directory for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Checks if a workflow directory uses the legacy flat layout or the new phase-based layout.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @returns true if the workflow uses the legacy flat layout (no vision/ subdirectory),
 *          false if it uses the new phase-based layout (has vision/ subdirectory)
 */
export async function isLegacyLayout(projectPath: string, workflowId: string): Promise<boolean> {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);
  const visionDir = path.join(workflowDir, 'vision');

  try {
    return !await fs.pathExists(visionDir);
  } catch (error) {
    // If we can't read the directory, assume it's legacy
    return true;
  }
}

/**
 * Migrates a workflow from the legacy flat layout to the new phase-based layout.
 * Moves:
 * - idea.md -> vision/idea.md
 * - prd.md -> vision/prd.md
 * - spec.md -> vision/spec.md
 * - intents/ -> vision/intents/
 * - validation/ -> vision/validation/
 *
 * Preserves:
 * - checkpoint.json (remains in root)
 * - manifest.json (remains in root)
 *
 * Creates:
 * - forge/ and summit/ directories
 *
 * Idempotent - if already migrated (vision/ exists), returns early without error.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @throws Error if disk is full, permissions are denied, or filesystem errors occur
 */
export async function migrateLayout(projectPath: string, workflowId: string): Promise<void> {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);
  const visionDir = path.join(workflowDir, 'vision');

  try {
    // If already migrated, return early
    if (await fs.pathExists(visionDir)) {
      return;
    }

    // Create the phase-based directory structure
    await ensurePhaseWorkflowDir(projectPath, workflowId);

    // Move artifacts if they exist
    const filesToMove = [
      { from: 'idea.md', to: path.join('vision', 'idea.md') },
      { from: 'prd.md', to: path.join('vision', 'prd.md') },
      { from: 'spec.md', to: path.join('vision', 'spec.md') },
    ];

    for (const file of filesToMove) {
      const sourcePath = path.join(workflowDir, file.from);
      const targetPath = path.join(workflowDir, file.to);

      if (await fs.pathExists(sourcePath)) {
        await fs.move(sourcePath, targetPath, { overwrite: false });
      }
    }

    // Move directories if they exist
    const dirsToMove = [
      { from: 'intents', to: path.join('vision', 'intents') },
      { from: 'validation', to: path.join('vision', 'validation') },
    ];

    for (const dir of dirsToMove) {
      const sourcePath = path.join(workflowDir, dir.from);
      const targetPath = path.join(workflowDir, dir.to);

      if (await fs.pathExists(sourcePath)) {
        // Ensure target parent exists
        await fs.ensureDir(path.dirname(targetPath));

        // Move the directory
        await fs.move(sourcePath, targetPath, { overwrite: false });
      }
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    // Handle disk full error
    if (err.code === 'ENOSPC') {
      console.error(`[Artifacts] Failed to migrate layout: Disk full`);
      console.error(`[Artifacts] Please free up disk space and try again.`);
      console.error(`[Artifacts] Workflow ID: ${workflowId}`);
      throw new Error(
        'Failed to migrate workflow layout: Disk is full. Please free up space and retry.'
      );
    }

    // Handle permission denied error
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Artifacts] Failed to migrate layout: Permission denied`);
      console.error(`[Artifacts] Workflow ID: ${workflowId}`);
      throw new Error(
        `Failed to migrate workflow layout: Permission denied for ${workflowId}`
      );
    }

    // Handle read-only filesystem
    if (err.code === 'EROFS') {
      console.error(`[Artifacts] Failed to migrate layout: Read-only filesystem`);
      console.error(`[Artifacts] Workflow ID: ${workflowId}`);
      throw new Error(
        'Failed to migrate workflow layout: Filesystem is read-only'
      );
    }

    // Generic error with context
    console.error(`[Artifacts] Failed to migrate layout: ${err.message}`);
    console.error(`[Artifacts] Workflow ID: ${workflowId}`);
    throw new Error(
      `Failed to migrate workflow layout for ${workflowId}: ${err.message}`
    );
  }
}

/**
 * Returns the file path for an artifact in the phase-based layout.
 *
 * @param projectPath - Root path of the project
 * @param workflowId - Unique workflow identifier
 * @param phase - Workflow phase ('vision', 'forge', or 'summit')
 * @param stage - Stage within the phase (e.g., 'idea', 'units', 'deploy')
 * @param filename - Name of the file
 * @returns Absolute path to the artifact file
 *
 * @example
 * getPhaseArtifactPath(p, id, 'vision', 'idea', 'idea.md')
 * // Returns: .olympus/workflow/{id}/vision/idea.md
 *
 * getPhaseArtifactPath(p, id, 'forge', 'units', 'UNIT-001.md')
 * // Returns: .olympus/workflow/{id}/forge/units/UNIT-001.md
 *
 * getPhaseArtifactPath(p, id, 'summit', 'deploy', 'deploy-guide.md')
 * // Returns: .olympus/workflow/{id}/summit/deploy-guide.md
 */
export function getPhaseArtifactPath(
  projectPath: string,
  workflowId: string,
  phase: WorkflowPhase,
  stage: string,
  filename: string
): string {
  const workflowDir = path.join(projectPath, '.olympus', 'workflow', workflowId);

  // Determine subdirectory structure based on stage
  // Stages that map to subdirectories
  const subdirStages = ['intents', 'validation', 'units', 'design', 'bolts', 'results'];

  if (subdirStages.includes(stage)) {
    // Special case: results is a subdirectory within bolts
    if (stage === 'results') {
      return path.join(workflowDir, phase, 'bolts', 'results', filename);
    }
    // Other stages map directly to subdirectories
    return path.join(workflowDir, phase, stage, filename);
  } else {
    // Other stages are files directly in the phase directory
    return path.join(workflowDir, phase, filename);
  }
}
