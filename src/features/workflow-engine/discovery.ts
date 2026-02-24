import * as path from 'path';
import * as fs from 'fs-extra';
import { ensureDiscoveryDir, getArtifactPath, writeArtifact } from './artifacts.js';
import { registerArtifact, updatePhaseStatus, addGateAuditEntry } from './manifest.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint.js';
import type { WorkflowPhase } from './phase-types.js';
import type { WorkflowStage } from './types.js';
import { scanWorkspace, selectKeyFiles, selectIntentRelevantFiles } from './brownfield-scanner.js';
import type { WorkspaceScanResult } from './brownfield-scanner.js';
import { buildStaticModelPrompt, writeModelsToArtifacts } from './brownfield-analysis.js';

/**
 * Source file extensions used for brownfield detection.
 * These represent actual implementation files, not config/docs.
 */
export const SOURCE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.c', '.cpp',
  '.cs',
  '.rb',
  '.swift',
  '.kt',
  '.css', '.scss',
  '.html',
  '.vue',
  '.svelte',
] as const;

/**
 * Directories to skip during brownfield detection.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.olympus',
  'aidlc-docs',
  '.next',
  '__pycache__',
  '.venv',
  'vendor',
  'target',
]);

/**
 * Discovery artifacts generated in the Discovery phase.
 */
export const DISCOVERY_ARTIFACTS = [
  'analysis-plan',
  'current-state-analysis',
  'regression-baseline',
  'change-impact',
  'static-model',
  'dynamic-model',
  'workspace-scan',
] as const;

export type DiscoveryArtifactType = typeof DISCOVERY_ARTIFACTS[number];

/**
 * Options for shouldRunDiscovery.
 */
export interface DiscoveryOptions {
  projectPath: string;
  brownfieldFlag?: boolean;    // --brownfield flag (force discovery)
  greenfieldFlag?: boolean;    // --greenfield flag (skip discovery)
  depthLevel?: 'shallow' | 'medium' | 'deep';  // SHALLOW skips discovery
}

/**
 * Options for executeDiscoveryPhase.
 */
export interface ExecuteDiscoveryOptions {
  projectPath: string;
  workflowId: string;
  featureName: string;
  manifestPath: string;
  includeFiles?: string[];
}

/**
 * Result of executeDiscoveryPhase.
 */
export interface DiscoveryResult {
  completed: boolean;
  gateRequired: boolean;        // true = gate approval needed before inception
  artifactsGenerated: string[];  // paths to generated artifacts
  sourceFileCount: number;
  brownfieldData?: {
    scanResult: WorkspaceScanResult;
    keyFiles: string[];
    relevantFiles: string[];
    staticModelPrompt: string;
  };
}

/**
 * Options for approving/rejecting the Discovery Gate.
 */
export interface DiscoveryGateOptions {
  projectPath: string;
  workflowId: string;
  manifestPath: string;
  feedback?: string;
}

/**
 * Recursively counts source files in a directory.
 * Skips common build/dependency directories.
 */
async function countSourceFiles(dirPath: string): Promise<number> {
  let count = 0;

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden entries (dotfiles/dotdirs) and common skip directories
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectory
        count += await countSourceFiles(fullPath);
      } else if (entry.isFile()) {
        // Check if file has a source extension
        const ext = path.extname(entry.name);
        if (SOURCE_EXTENSIONS.includes(ext as any)) {
          count++;
        }
      }
    }
  } catch (error) {
    // If we can't read a directory (permissions, etc.), just skip it
    console.error(`Error reading directory ${dirPath}:`, error);
  }

  return count;
}

/**
 * Detects if a project is brownfield (existing codebase) or greenfield (new project).
 * A project is considered brownfield if it has 3+ source files.
 */
export async function detectBrownfield(
  projectPath: string
): Promise<{ isBrownfield: boolean; sourceFileCount: number }> {
  const sourceFileCount = await countSourceFiles(projectPath);
  const isBrownfield = sourceFileCount >= 3;

  return {
    isBrownfield,
    sourceFileCount,
  };
}

/**
 * Determines if Discovery phase should run based on flags and auto-detection.
 */
export async function shouldRunDiscovery(options: DiscoveryOptions): Promise<boolean> {
  // Explicit greenfield flag skips discovery
  if (options.greenfieldFlag) {
    return false;
  }

  // SHALLOW depth skips discovery
  if (options.depthLevel === 'shallow') {
    return false;
  }

  // Explicit brownfield flag forces discovery
  if (options.brownfieldFlag) {
    return true;
  }

  // Auto-detect based on source file count
  const { isBrownfield } = await detectBrownfield(options.projectPath);
  return isBrownfield;
}

/**
 * Gets the markdown template content for a discovery artifact.
 */
export function getDiscoveryTemplate(
  artifactType: DiscoveryArtifactType,
  featureName: string
): string {
  const templates: Record<DiscoveryArtifactType, string> = {
    'analysis-plan': `# Analysis Plan

## Feature: ${featureName}

## Objectives
- Understand existing codebase architecture
- Identify integration points for proposed changes
- Assess regression risk

## Analysis Scope
<!-- Define directories, modules, and systems to analyze -->

## Analysis Steps
1. Static structure analysis
2. Dynamic behavior analysis
3. Dependency mapping
4. Test coverage assessment
5. Change impact prediction

## Out of Scope
<!-- Areas explicitly not analyzed -->
`,

    'current-state-analysis': `# Current State Analysis

## Feature: ${featureName}

## Architecture Overview
<!-- High-level architecture of the existing system -->

## Key Components
<!-- List major components and their responsibilities -->

## Technology Stack
<!-- Languages, frameworks, libraries in use -->

## Code Organization
<!-- Directory structure and module layout -->

## Known Technical Debt
<!-- Existing issues or areas needing improvement -->
`,

    'regression-baseline': `# Regression Baseline

## Feature: ${featureName}

## Existing Test Coverage
<!-- Current test suites and coverage metrics -->

## Critical Paths
<!-- User flows and system behaviors that must not break -->

## Integration Points
<!-- External services, APIs, databases that are currently integrated -->

## Baseline Metrics
<!-- Performance, reliability, and quality metrics to preserve -->

## Regression Risk Areas
<!-- Areas most likely to be affected by changes -->
`,

    'change-impact': `# Change Impact Analysis

## Feature: ${featureName}

## Proposed Changes Summary
<!-- Brief description of what will change -->

## Affected Components
<!-- Components that will be directly modified -->

## Downstream Dependencies
<!-- Components that depend on affected components -->

## Risk Assessment
| Area | Impact Level | Mitigation |
|------|-------------|------------|

## Migration Requirements
<!-- Data migrations, API changes, breaking changes -->
`,

    'static-model': `# Static Code Model

## Feature: ${featureName}

## Module Dependency Graph
<!-- How modules depend on each other -->

## Key Interfaces
<!-- Important interfaces, types, and contracts -->

## Data Models
<!-- Database schemas, data structures, state shapes -->

## Configuration
<!-- Environment variables, config files, feature flags -->

## Build Pipeline
<!-- Build tools, compilation steps, output artifacts -->
`,

    'dynamic-model': `# Dynamic Behavior Model

## Feature: ${featureName}

## Request/Response Flows
<!-- How requests flow through the system -->

## Event Handling
<!-- Event-driven behaviors and pub/sub patterns -->

## State Management
<!-- How state is managed and shared -->

## Background Processes
<!-- Cron jobs, workers, async operations -->

## Error Handling Patterns
<!-- How errors propagate and are handled -->
`,

    'workspace-scan': '', // JSON artifact generated by brownfield scanner, not a template
  };

  return templates[artifactType];
}

/**
 * Executes the Discovery phase, generating all discovery artifacts.
 */
export async function executeDiscoveryPhase(
  options: ExecuteDiscoveryOptions
): Promise<DiscoveryResult> {
  const { projectPath, workflowId, featureName, manifestPath } = options;

  try {
    // Ensure discovery directory exists
    await ensureDiscoveryDir(projectPath, workflowId);

    // Update manifest to mark discovery as in_progress
    const now = new Date().toISOString();
    updatePhaseStatus(manifestPath, 'discovery', 'in_progress', now);

    const artifactsGenerated: string[] = [];

    // Generate all discovery artifacts (workspace-scan is JSON, handled by brownfield scanner)
    for (const artifactType of DISCOVERY_ARTIFACTS) {
      if (artifactType === 'workspace-scan') continue;
      const template = getDiscoveryTemplate(artifactType, featureName);
      const artifactPath = getArtifactPath(projectPath, workflowId, artifactType as any);

      // Write the artifact using writeArtifact(projectPath, workflowId, artifactType, content)
      await writeArtifact(projectPath, workflowId, artifactType as any, template);
      artifactsGenerated.push(artifactPath);

      // Register in manifest (checksum auto-computed by registerArtifact)
      registerArtifact(manifestPath, {
        id: `DISCOVERY-${artifactType}`,
        type: artifactType,
        phase: 'discovery' as WorkflowPhase,
        stage: 'intent' as WorkflowStage,
        path: artifactPath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });
    }

    // Get source file count for the result
    const { sourceFileCount, isBrownfield } = await detectBrownfield(projectPath);

    let brownfieldData: DiscoveryResult['brownfieldData'];
    if (isBrownfield) {
      try {
        const scanResult = await scanWorkspace(projectPath);

        // Select key files (Tier 2)
        let keyFiles = selectKeyFiles(scanResult);

        if (options.includeFiles && options.includeFiles.length > 0) {
          const includeSet = new Set(keyFiles);
          for (const f of options.includeFiles) {
            if (!includeSet.has(f)) {
              keyFiles.push(f);
            }
          }
        }

        // Select intent-relevant files (Tier 3)
        const relevantFiles = selectIntentRelevantFiles(scanResult, featureName);

        const scanArtifactPath = getArtifactPath(projectPath, workflowId, 'workspace-scan' as any);
        await writeArtifact(projectPath, workflowId, 'workspace-scan' as any, JSON.stringify(scanResult, null, 2));
        artifactsGenerated.push(scanArtifactPath);

        registerArtifact(manifestPath, {
          id: 'DISCOVERY-workspace-scan',
          type: 'workspace-scan',
          phase: 'discovery' as WorkflowPhase,
          stage: 'intent' as WorkflowStage,
          path: scanArtifactPath,
          validation_passed: null,
          write_complete: true,
          checksum: null,
        });

        const analysisOptions = {
          projectPath,
          workflowId,
          featureName,
          scanResult,
          keyFiles,
          relevantFiles,
          intentText: featureName,
        };
        const staticModelPrompt = buildStaticModelPrompt(analysisOptions);

        const promptPath = path.join(projectPath, 'aidlc-docs', workflowId, 'discovery', 'static-model-prompt.md');
        await ensureDiscoveryDir(projectPath, workflowId);
        await fs.writeFile(promptPath, staticModelPrompt, 'utf-8');

        brownfieldData = {
          scanResult,
          keyFiles,
          relevantFiles,
          staticModelPrompt,
        };
      } catch (error) {
        console.error('[Discovery] Brownfield scanning failed (non-blocking):', error);
      }
    }

    // Mark discovery phase as blocked — awaiting Discovery Gate approval
    // The gate blocks until the user reviews discovery findings and approves
    updatePhaseStatus(manifestPath, 'discovery', 'blocked');

    // Save checkpoint: discovery artifacts generated, awaiting gate (CCR-1)
    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (checkpoint) {
      checkpoint.current_phase = 'discovery';
      checkpoint.phases.discovery.status = 'blocked';
      await saveCheckpoint(projectPath, checkpoint);
    }

    return {
      completed: false,
      gateRequired: true,
      artifactsGenerated,
      sourceFileCount,
      brownfieldData,
    };
  } catch (error) {
    console.error('[Discovery] Error executing discovery phase:', error);
    throw new Error(`Discovery phase failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Approves the Discovery Gate, completing the Discovery phase and transitioning to Inception.
 * Called after the user reviews discovery findings and approves.
 */
export async function approveDiscoveryGate(options: DiscoveryGateOptions): Promise<void> {
  const { projectPath, workflowId, manifestPath, feedback } = options;

  const completedAt = new Date().toISOString();

  // Update manifest: discovery -> complete
  updatePhaseStatus(manifestPath, 'discovery', 'complete', undefined, completedAt);

  // Record gate audit entry
  addGateAuditEntry(manifestPath, {
    phase: 'discovery',
    action: 'approved',
    actor: 'human',
    reason: feedback || null,
  });

  // Update checkpoint: move to inception (CCR-1)
  const checkpoint = await loadCheckpoint(projectPath, workflowId);
  if (checkpoint) {
    checkpoint.current_phase = 'inception';
    checkpoint.phases.discovery.status = 'complete';
    checkpoint.phases.discovery.completed_at = completedAt;
    await saveCheckpoint(projectPath, checkpoint);
  }
}

export async function populateDiscoveryModels(
  projectPath: string,
  workflowId: string,
  staticModelContent: string,
  dynamicModelContent: string
): Promise<void> {
  try {
    await writeModelsToArtifacts(projectPath, workflowId, staticModelContent, dynamicModelContent);
  } catch (error) {
    console.error('[Discovery] Failed to populate discovery models:', error);
    throw new Error(`Failed to populate discovery models: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Rejects the Discovery Gate, pausing the Discovery phase for revision.
 * Called when the user reviews discovery findings and requests changes.
 */
export async function rejectDiscoveryGate(options: DiscoveryGateOptions): Promise<void> {
  const { projectPath, workflowId, manifestPath, feedback } = options;

  // Update manifest: discovery -> paused (needs revision)
  updatePhaseStatus(manifestPath, 'discovery', 'paused');

  // Record gate audit entry
  addGateAuditEntry(manifestPath, {
    phase: 'discovery',
    action: 'rejected',
    actor: 'human',
    reason: feedback || null,
  });

  // Update checkpoint: stay in discovery phase (CCR-1)
  const checkpoint = await loadCheckpoint(projectPath, workflowId);
  if (checkpoint) {
    checkpoint.current_phase = 'discovery';
    checkpoint.phases.discovery.status = 'paused';
    await saveCheckpoint(projectPath, checkpoint);
  }
}
