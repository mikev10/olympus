import * as path from 'path';
import * as fs from 'fs-extra';
import { ensureDiscoveryDir, getArtifactPath, writeArtifact, appendAuditEntry } from './artifacts.js';
import { registerArtifact, updatePhaseStatus, addGateAuditEntry } from './manifest.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint.js';
import type { WorkflowPhase } from './phase-types.js';
import type { WorkflowStage } from './types.js';
import { scanWorkspace, selectKeyFiles, selectIntentRelevantFiles, generateComponentInventory, generateTechnologyStack, generateDependencies } from './brownfield-scanner.js';
import type { WorkspaceScanResult } from './brownfield-scanner.js';
import {
  readCacheManifest,
  writeCacheManifest,
  isCacheStale,
  incrementalRescan,
  buildInitialManifest,
} from './discovery-cache.js';
import { getGitHeadSha } from './git-utils.js';
import { writeProjectPatterns } from '../../learning/project-patterns.js';
import { buildStaticModelPrompt, writeModelsToArtifacts } from './brownfield-analysis.js';
import { generateArchitectureModel, saveArchitectureModel } from './architecture-model.js';
import { detectDesignSystems } from './design-system-detection.js';
import type { DesignSystemInfo } from './design-system-detection.js';

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
  forceRescan?: boolean;
}

export interface DiscoveryResult {
  completed: boolean;
  gateRequired: boolean;
  artifactsGenerated: string[];
  sourceFileCount: number;
  agentsMdDetected?: boolean;
  agentsMdFileCount?: number;
  deepinitSuggested?: boolean;
  deepinitUpdateMode?: boolean;
  agentsMdStale?: boolean;
  architectureModelGenerated?: boolean;
  designSystem?: DesignSystemInfo;
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

async function getDeepInitThreshold(projectPath: string): Promise<number> {
  const DEFAULT_THRESHOLD = 50;
  try {
    const configPath = path.join(projectPath, '.olympus', 'config.json');
    const raw = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(raw) as { deepinit_threshold?: number };
    return config.deepinit_threshold ?? DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

function getToolVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '../../../package.json');
    const pkg = JSON.parse(require('fs').readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
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

## AGENTS.md Status
<!-- Populated during brownfield scanning. Indicates whether AGENTS.md files were found. -->

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
        let scanResult: WorkspaceScanResult;

        const forceRescan = options.forceRescan === true;
        const cachedManifest = forceRescan ? null : await readCacheManifest(projectPath);

        const toolVersion = getToolVersion();
        let incrementalFailed = false;

        if (cachedManifest && !forceRescan) {
          const stalenessCheck = await isCacheStale(projectPath, cachedManifest, toolVersion);
          if (!stalenessCheck.stale) {
            const cachedScanPath = getArtifactPath(projectPath, workflowId, 'workspace-scan' as any);
            try {
              const cachedScanRaw = await fs.readFile(cachedScanPath, 'utf-8');
              scanResult = JSON.parse(cachedScanRaw) as WorkspaceScanResult;
            } catch {
              scanResult = await scanWorkspace(projectPath);
            }
          } else if (stalenessCheck.changedFiles && stalenessCheck.changedFiles.length > 0) {
            const cachedScanPath = getArtifactPath(projectPath, workflowId, 'workspace-scan' as any);
            try {
              const cachedScanRaw = await fs.readFile(cachedScanPath, 'utf-8');
              const existingResult = JSON.parse(cachedScanRaw) as WorkspaceScanResult;
              const rescanResult = await incrementalRescan(projectPath, stalenessCheck.changedFiles, existingResult);
              // If incrementalRescan returned the existingResult unchanged (fallback on error),
              // don't advance the SHA anchor — the partial scan didn't succeed
              if (rescanResult === existingResult) {
                incrementalFailed = true;
              }
              scanResult = rescanResult;
            } catch {
              scanResult = await scanWorkspace(projectPath);
            }
          } else {
            scanResult = await scanWorkspace(projectPath);
          }
        } else {
          scanResult = await scanWorkspace(projectPath);
        }

        // Only advance the SHA anchor if the scan actually succeeded.
        // Failed incremental rescans preserve the previous SHA so the next run retries.
        const gitSha = incrementalFailed && cachedManifest
          ? cachedManifest.gitSha
          : await getGitHeadSha(projectPath);
        const agentsMdStatus = (scanResult.agentsMdEntries && scanResult.agentsMdEntries.length > 0) ? 'present' as const : 'absent' as const;
        const newManifest = buildInitialManifest(gitSha, scanResult, {}, agentsMdStatus, toolVersion);
        await writeCacheManifest(projectPath, newManifest);

        writeProjectPatterns(projectPath, scanResult);

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

    let designSystem: DesignSystemInfo | undefined;
    try {
      designSystem = await detectDesignSystems(projectPath);
    } catch {
      // non-blocking
    }

    let architectureModelGenerated: boolean | undefined;
    if (brownfieldData) {
      try {
        const archModel = await generateArchitectureModel(projectPath, brownfieldData.scanResult, designSystem);
        await saveArchitectureModel(projectPath, archModel);
        architectureModelGenerated = true;
      } catch (err) {
        console.error('[Discovery] Architecture model generation failed (non-blocking):', err);
        architectureModelGenerated = false;
      }
    }

    let agentsMdDetected = false;
    let agentsMdFileCount: number | undefined;
    let deepinitSuggested = false;
    let deepinitUpdateMode = false;

    const deepinitThreshold = await getDeepInitThreshold(projectPath);

    let agentsMdStale = false;

    if (brownfieldData) {
      if (brownfieldData.scanResult.agentsMdEntries && brownfieldData.scanResult.agentsMdEntries.length > 0) {
        agentsMdDetected = true;
        agentsMdFileCount = brownfieldData.scanResult.agentsMdEntries.length;
        deepinitSuggested = false;

        try {
          const { isFileStale } = await import('./git-utils.js');
          for (const entry of brownfieldData.scanResult.agentsMdEntries) {
            if (await isFileStale(projectPath, entry.relativeFilePath, 30)) {
              agentsMdStale = true;
              break;
            }
          }
        } catch {
          // non-blocking
        }

        if (agentsMdStale) {
          deepinitSuggested = true;
          deepinitUpdateMode = true;
        }

        // Register AGENTS.md files as workflow artifacts
        for (const entry of brownfieldData.scanResult.agentsMdEntries) {
          registerArtifact(manifestPath, {
            id: `DISCOVERY-agents-md-${path.basename(path.dirname(entry.relativeFilePath)) || 'root'}`,
            type: 'structural-map',
            phase: 'discovery' as WorkflowPhase,
            stage: 'intent' as WorkflowStage,
            path: entry.relativeFilePath,
            validation_passed: null,
            write_complete: true,
            checksum: null,
          });
        }
      } else {
        deepinitSuggested = sourceFileCount >= deepinitThreshold;
      }
    } else if (isBrownfield) {
      deepinitSuggested = sourceFileCount >= deepinitThreshold;
    }

    try {
      const analysisPlanPath = getArtifactPath(projectPath, workflowId, 'analysis-plan' as any);
      const analysisPlanContent = await fs.readFile(analysisPlanPath, 'utf-8');
      const agentsMdStatusText = agentsMdDetected
        ? `**Status**: Present (${agentsMdFileCount} file(s) found)${agentsMdStale ? ' — **Stale** (>30 days old)' : ''}\n**Files**:\n${brownfieldData!.scanResult.agentsMdEntries!.map(e => `- \`${e.relativeFilePath}\``).join('\n')}`
        : '**Status**: Absent — no AGENTS.md files found in project';
      const updated = analysisPlanContent.replace(
        /## AGENTS\.md Status\n<!-- Populated during brownfield scanning\. Indicates whether AGENTS\.md files were found\. -->/,
        `## AGENTS.md Status\n${agentsMdStatusText}`
      );
      if (updated !== analysisPlanContent) {
        await fs.writeFile(analysisPlanPath, updated, 'utf-8');
      }
    } catch {
      // non-blocking
    }

    if (agentsMdStale && brownfieldData) {
      try {
        const cachedManifest = await readCacheManifest(projectPath);
        if (cachedManifest) {
          cachedManifest.agentsMdStatus = 'stale';
          await writeCacheManifest(projectPath, cachedManifest);
        }
      } catch {
        // non-blocking
      }
    }

    try {
      const deepinitStatus = agentsMdDetected ? 'pre-existing' : deepinitSuggested ? 'suggested' : 'skipped';
      const agentsMdInfo = agentsMdDetected
        ? `AGENTS.md detected (${agentsMdFileCount} file(s), stale: ${agentsMdStale})`
        : 'No AGENTS.md files found';
      await appendAuditEntry(projectPath, workflowId, `## Discovery — Deepinit Detection
**Timestamp**: ${new Date().toISOString()}
**Source file count**: ${sourceFileCount}
**Deepinit threshold**: ${deepinitThreshold}
**Deepinit status**: ${deepinitStatus}
**AGENTS.md**: ${agentsMdInfo}

---
`);
    } catch {
      // non-blocking
    }

    updatePhaseStatus(manifestPath, 'discovery', 'blocked');

    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (checkpoint) {
      checkpoint.current_phase = 'discovery';
      checkpoint.phases.discovery.status = 'blocked';
      if (agentsMdDetected && deepinitUpdateMode) {
        checkpoint.deepinit_status = 'suggested';
      } else if (agentsMdDetected) {
        checkpoint.deepinit_status = 'pre-existing';
      } else if (deepinitSuggested) {
        checkpoint.deepinit_status = 'suggested';
      } else if (isBrownfield) {
        checkpoint.deepinit_status = 'skipped';
      } else {
        checkpoint.deepinit_status = 'not_applicable';
      }
      await saveCheckpoint(projectPath, checkpoint);
    }

    return {
      completed: false,
      gateRequired: true,
      artifactsGenerated,
      sourceFileCount,
      agentsMdDetected,
      agentsMdFileCount,
      agentsMdStale,
      deepinitSuggested,
      deepinitUpdateMode,
      architectureModelGenerated,
      designSystem,
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

export async function writeExtendedDiscoveryArtifacts(
  projectPath: string,
  workflowId: string,
  scan: WorkspaceScanResult,
  agentGeneratedArtifacts: {
    currentStateAnalysis?: string;
    staticModel?: string;
    dynamicModel?: string;
    changeImpact?: string;
    regressionBaseline?: string;
  }
): Promise<string[]> {
  const discoveryDir = path.join(projectPath, 'aidlc-docs', workflowId, 'discovery');
  await fs.ensureDir(discoveryDir);

  const manifestPath = path.join(projectPath, 'aidlc-docs', workflowId, 'manifest.json');
  const writtenPaths: string[] = [];

  // Generate current-state-analysis from scanner data if not provided
  const currentStateContent = agentGeneratedArtifacts.currentStateAnalysis ?? [
    '# Current State Analysis',
    '',
    '## Component Inventory',
    generateComponentInventory(scan),
    '',
    '## Technology Stack',
    generateTechnologyStack(scan),
    '',
    '## Dependencies',
    generateDependencies(scan),
  ].join('\n');

  const artifacts: Array<{ id: string; filename: string; content: string | undefined }> = [
    { id: 'current-state-analysis', filename: 'current-state-analysis.md', content: currentStateContent },
    { id: 'static-model', filename: 'static-model.md', content: agentGeneratedArtifacts.staticModel },
    { id: 'dynamic-model', filename: 'dynamic-model.md', content: agentGeneratedArtifacts.dynamicModel },
    { id: 'change-impact', filename: 'change-impact.md', content: agentGeneratedArtifacts.changeImpact },
    { id: 'regression-baseline', filename: 'regression-baseline.md', content: agentGeneratedArtifacts.regressionBaseline },
  ];

  for (const artifact of artifacts) {
    if (!artifact.content) continue;
    const filePath = path.join(discoveryDir, artifact.filename);
    await fs.writeFile(filePath, artifact.content, 'utf8');
    registerArtifact(manifestPath, {
      id: `DISCOVERY-${artifact.id}`,
      type: artifact.id,
      phase: 'discovery' as WorkflowPhase,
      stage: 'intent' as WorkflowStage,
      path: filePath,
      validation_passed: null,
      write_complete: true,
      checksum: null,
    });
    writtenPaths.push(filePath);
  }

  return writtenPaths;
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
