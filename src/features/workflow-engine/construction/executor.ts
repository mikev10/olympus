/**
 * Construction Phase Executor
 *
 * Orchestrates the complete Construction phase execution with a 2-phase pipeline:
 * 1. Decomposition phase: Parse intent.md, generate UNIT specs, generate BOLT specs per UNIT
 * 2. Design phase: Generate design artifacts (interfaces.json, data-flow.json, components.json)
 *
 * This is the main entry point for the Construction stage of the AIDLC methodology.
 *
 * Supports three depth modes:
 * - SHALLOW: Single BOLT directly from INTENT, no UNITs or design
 * - MEDIUM: Full decomposition + design (default)
 * - DEEP: Full decomposition + design (same as MEDIUM in v1)
 */

import fs from 'fs-extra';
import path from 'path';
import type { HierarchicalNode, ConstructionUnitProgress, PathwayType, ValidatorResult } from '../phase-types.js';
import type { ValidationResult } from '../types.js';
import { loadCheckpoint, saveCheckpoint } from '../checkpoint.js';
import { generateDocumentation, runPostDocGeneration, getRequiredSections, buildFeatureDocPrompt, type FeatureDocOptions, type DocumentationGenerationResult } from './documentation-generator.js';
import { evaluateRecreationReadiness } from './recreation-readiness.js';
import { runSecretsManagement } from '../secrets-management.js';
import { scanProject } from '../security-scanner.js';
import { generateQualityScorecard } from '../quality-scorecard.js';

type ConstructionStage = 'unit' | 'code-generation' | 'design';

import {
  parseIntentsFromDisk,
  parseIntentFromFile,
  decomposeIntentToUnits,
  buildDecompositionTree,
} from './decomposition.js';
import type { DecompositionTree, UnitSpec } from './decomposition.js';
import {
  generateInterfaceContracts,
  generateDataFlowDiagram,
  generateComponentDesign,
  validateDesign,
  writeDesignArtifacts,
} from './design.js';
import { validateUnits } from './validation.js';
import { runDualValidation } from '../alignment.js';
import { registerArtifact, linkArtifacts } from '../manifest.js';
import type { ArtifactLink } from '../phase-types.js';
import { createExpressBolt } from '../bolts/express-bolt-factory.js';
import { registerBoltsInCheckpoint } from '../bolts/bolt-planner.js';
import { BoltExecutor } from '../bolts/bolt-executor.js';
import type { StageHandlers } from '../bolts/bolt-executor.js';
import { appendToAudit } from '../audit-generator.js';

/**
 * Agent map for Construction stages. v1: all stages use generic 'olympian' agent.
 * v2 follow-up: specialized unit-writer, design-writer, bolt-executor agents.
 */
export const CONSTRUCTION_STAGE_AGENT_MAP: Record<ConstructionStage, string> = {
  unit: 'olympian',
  'code-generation': 'olympian',
  design: 'olympian',
};


/**
 * Options for controlling Construction phase execution.
 */
export interface ConstructionOptions {
  /** Decomposition depth: SHALLOW skips UNITs, MEDIUM/DEEP run full pipeline */
  depth?: 'SHALLOW' | 'MEDIUM' | 'DEEP';
  /** Maximum number of UNITs to generate (default 10) */
  max_units?: number;
  /** Maximum code generation tasks per UNIT (default 8) */
  max_code_gen_per_unit?: number;
  /** Maximum total code generation tasks across all UNITs (default 50) */
  max_total_code_gen?: number;
  /** Current checkpoint status - blocks if 'awaiting_dev_review' */
  checkpointStatus?: string;
  /** Optional callback invoked after successful decomposition for checkpoint persistence */
  onCheckpointSave?: () => Promise<void>;
  /** Pathway type — used to skip baseline capture for greenfield */
  pathwayType?: PathwayType;
  /** Test command to run for regression baseline capture (brownfield/bugfix only) */
  testCommand?: string;
}

export interface TestGenerationOptions {
  projectPath?: string;
  workflowId?: string;
  /** User override to allow completion even if tests fail or total === 0 */
  allowFailures?: boolean;
  /** Actual test results from running the test suite. When provided, enables regression analysis. */
  currentResults?: Array<{ name: string; filePath: string; status: 'passed' | 'failed' | 'skipped'; duration_ms: number }>;
}

export interface TestGenerationResult {
  status: 'completed' | 'blocked';
  unitId: string;
  tests_total: number;
  tests_passed: number;
  tests_failed: number;
  test_framework: string;
  reportPath: string;
  blockingReason?: string;
  regressions_count: number;
  flaky_count: number;
  validationPipeline?: import('./validators/types.js').PipelineResult;
}

/**
 * Progress tracking for Construction execution
 */
export interface ConstructionProgress {
  current_stage: ConstructionStage;
  units_total: number;
  units_complete: number;
  code_gen_total: number;
  code_gen_complete: number;
  design_complete: boolean;
  overall_percentage: number;
}


/**
 * ConstructionExecutor orchestrates the full Construction phase of AIDLC.
 *
 * The Construction phase takes the INTENT from the Inception phase and decomposes it into
 * executable work units:
 * - Units (architectural components)
 * - Design artifacts (interfaces, data flows, components)
 * - Bolts (atomic implementation tasks)
 *
 * @example
 * ```typescript
 * const executor = new ConstructionExecutor('/path/to/project', 'user-auth-workflow');
 * const result = await executor.execute(specContent);
 * if (result.passed) {
 *   console.log('Construction phase complete!');
 * }
 * ```
 */
export class ConstructionExecutor {
  private projectPath: string;
  private workflowId: string;
  private tree: DecompositionTree | null = null;
  private currentStage: ConstructionStage = 'unit';
  private totalUnits = 0;
  private totalCodeGenerations = 0;
  private totalEffort = 0;

  constructor(projectPath: string, workflowId: string) {
    this.projectPath = projectPath;
    this.workflowId = workflowId;
  }

  /**
   * Execute the Construction phase pipeline.
   *
   * For SHALLOW depth:
   *   - Creates a single BOLT directly from INTENT content
   *   - Skips UNIT generation and design artifacts
   *
   * For MEDIUM/DEEP depth:
   *   1. Decomposition phase: Parse intent, create UNITs, create BOLTs per UNIT
   *   2. Design phase: Generate interface contracts, DFDs, components
   *
   * @param specContent - Optional SPEC artifact content for design validation
   * @param options - Construction options (depth, limits, checkpoint)
   * @returns ValidationResult with overall pass/fail and blocking issues
   */
  async execute(specContent?: string, options: ConstructionOptions = {}): Promise<ValidationResult> {
    const {
      depth = 'MEDIUM',
      max_units = 10,
      max_code_gen_per_unit = 8,
      max_total_code_gen = 50,
      checkpointStatus,
      onCheckpointSave,
    } = options;

    // Block if awaiting developer review
    if (checkpointStatus === 'awaiting_dev_review') {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: [
          'Construction blocked: developer review of technical specification required (Risk Tier 3).',
        ],
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ConstructionExecutor] Starting Construction phase execution (depth: ${depth})`);

    const isBrownfield = options.pathwayType === 'brownfield-enhancement'
      || options.pathwayType === 'brownfield-refactor'
      || options.pathwayType === 'bugfix';

    if (isBrownfield && options.testCommand) {
      try {
        const { captureBaseline } = await import('./regression-baseline.js');
        await captureBaseline(this.projectPath, this.workflowId, options.testCommand);
        console.log('[ConstructionExecutor] Regression baseline captured');
      } catch (err) {
        console.error('[ConstructionExecutor] Baseline capture failed (non-fatal):', err);
      }
    }

    // SHALLOW depth: single express BOLT from INTENT, skip decomposition
    if (depth === 'SHALLOW') {
      return this.executeShallowViaBolt();
    }

    // MEDIUM / DEEP: full decomposition pipeline
    // Phase 1: Decomposition (units + bolts)
    this.currentStage = 'unit';
    const decompResult = await this.executeDecompositionPhase(max_units, max_code_gen_per_unit, max_total_code_gen, depth);
    if (!decompResult.passed) {
      console.error('[ConstructionExecutor] Decomposition phase failed');
      return decompResult;
    }
    console.log('[ConstructionExecutor] Decomposition phase complete');

    // Invoke checkpoint callback if provided
    if (onCheckpointSave) {
      try {
        await onCheckpointSave();
      } catch (err) {
        console.error('[ConstructionExecutor] Checkpoint save callback failed:', err);
      }
    }

    // Phase 2: Design artifacts
    this.currentStage = 'design';
    const designResult = await this.executeDesignStage(specContent);
    if (!designResult.passed) {
      console.error('[ConstructionExecutor] Design stage failed validation');
      return designResult;
    }
    console.log('[ConstructionExecutor] Design stage complete');

    // Return aggregate success result
    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current progress of Construction execution.
   */
  getProgress(): ConstructionProgress {
    let unitsTotal = 0;
    let unitsComplete = 0;

    if (this.tree) {
      for (const node of this.tree.nodes.values()) {
        if (node.type === 'unit') {
          unitsTotal++;
          if (node.status === 'complete') {
            unitsComplete++;
          }
        }
      }
    }

    const codeGenTotal = this.totalCodeGenerations;
    const codeGenComplete = 0;

    let overallPercentage = 0;
    if (this.currentStage === 'unit') {
      overallPercentage = unitsTotal > 0 ? Math.round((unitsComplete / unitsTotal) * 50) : 0;
    } else if (this.currentStage === 'code-generation') {
      overallPercentage = 50 + (codeGenTotal > 0 ? Math.round((codeGenComplete / codeGenTotal) * 25) : 0);
    } else if (this.currentStage === 'design') {
      overallPercentage = 75 + 25;
    }

    return {
      current_stage: this.currentStage,
      units_total: unitsTotal,
      units_complete: unitsComplete,
      code_gen_total: codeGenTotal,
      code_gen_complete: codeGenComplete,
      design_complete: this.currentStage === 'design',
      overall_percentage: overallPercentage,
    };
  }

  /**
   * Returns a summary of the decomposition state.
   */
  getDecompositionSummary(): { units: number; codeGenerations: number; totalEffort: number } {
    return {
      units: this.totalUnits,
      codeGenerations: this.totalCodeGenerations,
      totalEffort: this.totalEffort,
    };
  }

  async handleZeroBoltUnit(
    unitId: string,
    options: { projectPath?: string; workflowId?: string } = {}
  ): Promise<boolean> {
    const projectPath = options.projectPath || this.projectPath;
    const workflowId = options.workflowId || this.workflowId;

    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    if (!checkpoint) return false;

    const unitBoltCount = Object.values(checkpoint.construction_bolts ?? {})
      .filter(b => b.parent_unit_id === unitId).length;

    if (unitBoltCount > 0) return false;

    if (!checkpoint.construction_units) {
      checkpoint.construction_units = {} as Record<string, ConstructionUnitProgress>;
    }

    if (checkpoint.construction_units[unitId]) {
      checkpoint.construction_units[unitId].code_generation_status = 'completed';
    }

    appendToAudit(projectPath, workflowId, {
      timestamp: new Date().toISOString(),
      phase: 'construction',
      action: `Unit ${unitId} auto-fulfilled (zero bolts)`,
      actor: 'construction-executor',
      reason: null,
    });

    await saveCheckpoint(projectPath, checkpoint);
    console.log(`[ConstructionExecutor] Unit ${unitId} auto-fulfilled: 0 bolts registered`);
    return true;
  }

  async executeCodeGenerationWithPlanApproval(
    unitName: string,
    options: { projectPath?: string; workflowId?: string } = {}
  ): Promise<{ status: 'awaiting_code_plan_approval'; codePlanPath: string; prompt: string }> {
    const projectPath = options.projectPath || this.projectPath;
    const workflowId = options.workflowId || this.workflowId;

    const { buildCodePlanPath, dispatchCodeGeneration, buildCodeGenerationPrompt } = await import('../code-generation-executor.js');

    const codePlanPath = buildCodePlanPath(projectPath, workflowId, unitName);
    const dispatch = await dispatchCodeGeneration(projectPath, workflowId, unitName);

    const prompt = buildCodeGenerationPrompt(
      dispatch.context.intentSummary2,
      dispatch.context.intentSummary,
      dispatch.context.unitSpec,
      codePlanPath,
      dispatch.context.architectureContext
    );

    return {
      status: 'awaiting_code_plan_approval',
      codePlanPath,
      prompt,
    };
  }

  async approveCodePlan(
    unitName: string,
    feedback?: string
  ): Promise<{ status: 'executing_code_plan'; prompt: string }> {
    const { buildCodePlanPath, dispatchCodeGeneration, buildCodeGenerationPrompt } = await import('../code-generation-executor.js');
    const { addGateAuditEntry } = await import('../manifest.js');

    const codePlanPath = buildCodePlanPath(this.projectPath, this.workflowId, unitName);

    const planExists = await fs.pathExists(codePlanPath);
    if (!planExists) {
      throw new Error(`Code plan file not found at ${codePlanPath}. The agent must create the plan before it can be approved.`);
    }

    const manifestPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'manifest.json');
    try {
      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'human',
        reason: feedback || `Code plan for ${unitName} approved by developer`,
      });
    } catch (err) {
      console.error(`[ConstructionExecutor] Failed to record gate audit for ${unitName}:`, err);
    }

    const dispatch = await dispatchCodeGeneration(this.projectPath, this.workflowId, unitName);
    const prompt = buildCodeGenerationPrompt(
      dispatch.context.intentSummary2,
      dispatch.context.intentSummary,
      dispatch.context.unitSpec,
      undefined,
      dispatch.context.architectureContext
    );

    return {
      status: 'executing_code_plan',
      prompt,
    };
  }

  async autoApproveCodePlan(
    unitName: string,
    trustLevel: number
  ): Promise<{ status: 'executing_code_plan'; prompt: string }> {
    const { addGateAuditEntry } = await import('../manifest.js');

    const manifestPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'manifest.json');
    const isSilent = trustLevel >= 3;

    try {
      addGateAuditEntry(manifestPath, {
        phase: 'construction',
        action: 'approved',
        actor: 'trust',
        reason: isSilent
          ? `Code plan for ${unitName} auto-approved silently (trust level ${trustLevel})`
          : `Code plan for ${unitName} auto-approved with notification (trust level ${trustLevel})`,
      });
    } catch (err) {
      console.error(`[ConstructionExecutor] Failed to record gate audit for ${unitName}:`, err);
    }

    if (!isSilent) {
      console.log(`[ConstructionExecutor] Code plan for ${unitName} auto-approved (trust level ${trustLevel})`);
    }

    const { dispatchCodeGeneration, buildCodeGenerationPrompt } = await import('../code-generation-executor.js');
    const dispatch = await dispatchCodeGeneration(this.projectPath, this.workflowId, unitName);
    const prompt = buildCodeGenerationPrompt(
      dispatch.context.intentSummary2,
      dispatch.context.intentSummary,
      dispatch.context.unitSpec,
      undefined,
      dispatch.context.architectureContext
    );

    return {
      status: 'executing_code_plan',
      prompt,
    };
  }

  async executeTestGeneration(unitId: string, options: TestGenerationOptions = {}): Promise<TestGenerationResult> {
    const projectPath = options.projectPath || this.projectPath;
    const workflowId = options.workflowId || this.workflowId;

    const loaded = await loadCheckpoint(projectPath, workflowId);
    const checkpoint = loaded ?? {
      schema_version: '3.0.0' as const,
      workflow_id: workflowId,
      feature_name: '',
      current_phase: 'construction' as const,
      current_stage: 'code-generation' as const,
      status: 'in_progress' as const,
      phases: {} as any,
      manifest_path: '',
      trust_state_path: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      construction_units: {} as Record<string, ConstructionUnitProgress>,
    };

    if (!checkpoint.construction_units) {
      checkpoint.construction_units = {} as Record<string, ConstructionUnitProgress>;
    }

    let unitProgress: ConstructionUnitProgress = checkpoint.construction_units[unitId] ?? {
      unitId,
      stages: {
        'functional-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'nfr-requirements': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'nfr-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'infrastructure-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'code-generation': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'test-generation': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
      },
      code_plan_path: null,
      code_generation_status: 'not_started',
      tests_total: 0,
      tests_passed: 0,
      tests_failed: 0,
      test_framework: 'unknown',
      test_generation_status: 'not_started',
    };

    unitProgress.stages['test-generation'].status = 'in_progress';
    unitProgress.test_generation_status = 'in_progress';
    checkpoint.construction_units[unitId] = unitProgress;
    await saveCheckpoint(projectPath, checkpoint);

    const reportDir = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', unitId, 'testing');
    await fs.ensureDir(reportDir);
    const reportPath = path.join(reportDir, 'test-report.md');

    let codeSummaryContent = '';
    const codeSummaryPath = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', unitId, 'code', 'code-summary.md');
    try {
      if (await fs.pathExists(codeSummaryPath)) {
        codeSummaryContent = await fs.readFile(codeSummaryPath, 'utf-8');
      }
    } catch {}

    const framework = await this.detectTestFramework(projectPath);

    const now = new Date().toISOString();
    const scaffold = this.buildTestReportScaffold(unitId, framework, codeSummaryContent, now);
    await fs.writeFile(reportPath, scaffold, 'utf-8');

    let tests_total = 0;
    let tests_passed = 0;
    let tests_failed = 0;
    let regressions_count = 0;
    let flaky_count = 0;

    if (options.currentResults && options.currentResults.length > 0) {
      tests_total = options.currentResults.length;
      tests_passed = options.currentResults.filter(r => r.status === 'passed').length;
      tests_failed = options.currentResults.filter(r => r.status === 'failed').length;
    }

    let hasBaseline = false;
    let legitimateRegressionCount = 0;
    const baselinePath = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'regression-baseline.json');

    if (options.currentResults && tests_failed > 0 && await fs.pathExists(baselinePath)) {
      try {
        const { compareAgainstBaseline, writeRegressionReport } = await import('./regression-baseline.js');
        const { categorizeFailure, buildRegressionSummary } = await import('./regression-categorizer.js');

        const baseline: import('../phase-types.js').RegressionBaseline = await fs.readJson(baselinePath);
        hasBaseline = true;
        const diff = compareAgainstBaseline(baseline, options.currentResults);

        const categories: import('../phase-types.js').RegressionCategory[] = [];
        const failures: import('../phase-types.js').RegressionReport['failures'] = [];

        for (const failure of diff.new_failures) {
          const baselineEntry = baseline.tests.find(t => t.name === failure.name) ?? null;
          const category = categorizeFailure(failure.name, baselineEntry, []);
          categories.push(category);
          failures.push({
            test_name: failure.name,
            file_path: failure.filePath,
            category,
            rationale: category === 'legitimate_regression' ? 'Test was passing in baseline, now fails'
              : category === 'flaky' ? 'Test passed on re-run without code changes'
              : category === 'intentional_change' ? 'New test not present in baseline'
              : 'Test was already failing in baseline',
          });
        }

        const summary = buildRegressionSummary(
          failures.map(f => ({ test_name: f.test_name, file_path: f.file_path })),
          categories
        );
        regressions_count = summary.regressions_count;
        flaky_count = summary.flaky_count;
        legitimateRegressionCount = summary.regressions_count;

        const report: import('../phase-types.js').RegressionReport = {
          workflow_id: workflowId,
          unit_id: unitId,
          baseline_captured_at: baseline.captured_at,
          compared_at: new Date().toISOString(),
          failures,
          total_regressions: categories.filter(c => c !== 'pre_existing_failure').length,
          legitimate_regressions: summary.regressions_count,
        };
        await writeRegressionReport(projectPath, workflowId, unitId, report);
      } catch (err) {
        console.error(`[ConstructionExecutor] Regression analysis failed for ${unitId} (non-fatal):`, err);
      }
    }

    let status: 'completed' | 'blocked' = 'completed';
    let blockingReason: string | undefined;

    if (options.allowFailures !== true) {
      if (tests_total === 0) {
        status = 'blocked';
        blockingReason = `No tests detected for unit ${unitId}. Set allowFailures: true to override.`;
      } else if (hasBaseline && legitimateRegressionCount > 0) {
        status = 'blocked';
        blockingReason = `${legitimateRegressionCount} legitimate regression(s) for unit ${unitId}. Flaky: ${flaky_count} (non-blocking). Fix regressions before proceeding.`;
      } else if (!hasBaseline && tests_failed > 0) {
        status = 'blocked';
        blockingReason = `${tests_failed} test(s) failed for unit ${unitId}. Set allowFailures: true to override.`;
      }
    }

    unitProgress.stages['test-generation'].status = status === 'completed' ? 'completed' : 'in_progress';
    unitProgress.stages['test-generation'].artifact_path = reportPath;
    if (status === 'completed') {
      unitProgress.stages['test-generation'].completed_at = now;
    }
    unitProgress.tests_total = tests_total;
    unitProgress.tests_passed = tests_passed;
    unitProgress.tests_failed = tests_failed;
    unitProgress.test_framework = framework;
    unitProgress.test_generation_status = status === 'completed' ? 'completed' : 'in_progress';
    unitProgress.regressions_count = regressions_count;
    unitProgress.flaky_count = flaky_count;

    checkpoint.construction_units[unitId] = unitProgress;
    await saveCheckpoint(projectPath, checkpoint);

    if (status === 'completed') {
      try {
        const { updateArchitectureModel } = await import('../architecture-model.js');
        const unitFiles = await this.discoverUnitFiles(projectPath, workflowId, unitId);
        if (unitFiles.length > 0) {
          await updateArchitectureModel(projectPath, unitFiles);
          unitProgress.architecture_model_status = 'updated';
          checkpoint.construction_units[unitId] = unitProgress;
          await saveCheckpoint(projectPath, checkpoint);
        }
      } catch (err) {
        console.error(`[ConstructionExecutor] Architecture model update failed for ${unitId} (non-blocking):`, err);
        unitProgress.architecture_model_status = 'failed';
        checkpoint.construction_units[unitId] = unitProgress;
        try { await saveCheckpoint(projectPath, checkpoint); } catch (saveErr) { console.warn('[ConstructionExecutor] Failed to save checkpoint after architecture model failure:', saveErr); }
      }
    }

    let validationPipeline: import('./validators/types.js').PipelineResult | undefined;

    if (status === 'completed') {
      try {
        const {
          runValidationPipeline,
          shouldSkipValidator,
          updateCheckpointForValidator,
          createQualityValidator,
          createMutationValidator,
          createTraceabilityValidator,
          createContractValidator,
          createCoverageValidator,
        } = await import('./validators/index.js');

        const unitFiles = await this.discoverUnitFiles(projectPath, workflowId, unitId);
        const apiSurfaceFiles = this.detectApiSurfaceFiles(unitFiles);
        const workflowDepth = this.deriveWorkflowDepth(
          checkpoint as import('../phase-types.js').WorkflowCheckpointV3
        );

        const validatorConfig: import('./validators/types.js').ValidatorConfig = {
          timeoutBudgetMs: 30000,
          allowFailures: options.allowFailures ?? false,
          workflowDepth,
          unitId,
          unitFiles,
          apiSurfaceFiles,
          projectPath,
          workflowId,
        };

        const validators = new Map<
          import('./validators/types.js').ValidatorName,
          import('./validators/types.js').ValidatorFn
        >();
        validators.set('quality', createQualityValidator());

        if (!shouldSkipValidator('mutation', validatorConfig).skip) {
          validators.set('mutation', createMutationValidator());
        }

        validators.set('traceability', createTraceabilityValidator());

        if (!shouldSkipValidator('contract', validatorConfig).skip) {
          validators.set('contract', createContractValidator());
        }

        validators.set('coverage', createCoverageValidator());

        validationPipeline = await runValidationPipeline(validators, validatorConfig);

        for (const { validator, result: vResult } of validationPipeline.results) {
          const checkpointStatus: import('../phase-types.js').ValidatorStatus =
            vResult.status === 'passed' || vResult.status === 'warned' ? 'completed'
            : vResult.status === 'skipped' ? 'skipped'
            : 'in_progress';

          const coveragePct = validator === 'coverage'
            ? (vResult as ValidatorResult & { coverage_percentage?: number }).coverage_percentage
            : undefined;

          const criticalGapCount = validator === 'coverage'
            ? vResult.findings.filter(f => f.category === 'uncovered-critical-file').length
            : undefined;

          await updateCheckpointForValidator(
            projectPath, workflowId, unitId, validator, checkpointStatus, coveragePct, criticalGapCount
          );
        }

        if (!options.allowFailures) {
          const blockingValidators = validationPipeline.results.filter(
            r => r.result.status === 'failed'
          );
          if (blockingValidators.length > 0) {
            status = 'blocked';
            blockingReason = `Validation blocked: ${blockingValidators.map(v => v.validator).join(', ')}`;

            unitProgress.stages['test-generation'].status = 'in_progress';
            unitProgress.test_generation_status = 'in_progress';
            checkpoint.construction_units[unitId] = unitProgress;
            await saveCheckpoint(projectPath, checkpoint);
          }
        }
      } catch (err) {
        console.error(`[ConstructionExecutor] Validation pipeline failed for ${unitId} (non-fatal):`, err);
      }
    }

    const result: TestGenerationResult = {
      status,
      unitId,
      tests_total,
      tests_passed,
      tests_failed,
      test_framework: framework,
      reportPath,
      blockingReason,
      regressions_count,
      flaky_count,
      validationPipeline,
    };

    return result;
  }

  /**
   * Validates that a bugfix unit has satisfied the missing-test requirement.
   *
   * For non-bugfix pathways returns `{ valid: true }` immediately.
   * For bugfix pathway: test-generation must be completed AND tests_total > 0.
   */
  async validateBugfixTestRequirement(
    unitId: string,
    options: TestGenerationOptions = {}
  ): Promise<{ valid: boolean; reason?: string }> {
    try {
      const projectPath = options.projectPath || this.projectPath;
      const workflowId = options.workflowId || this.workflowId;

      const loaded = await loadCheckpoint(projectPath, workflowId);
      if (!loaded) {
        return { valid: false, reason: 'checkpoint not found' };
      }

      if (loaded.pathway_type !== 'bugfix') {
        return { valid: true };
      }

      const unitProgress = loaded.construction_units?.[unitId];
      if (!unitProgress) {
        return { valid: false, reason: `no unit progress found for unit ${unitId}` };
      }

      const tgStatus = unitProgress.stages?.['test-generation']?.status;
      if (tgStatus !== 'completed') {
        return { valid: false, reason: 'test-generation stage not completed for bugfix unit' };
      }

      const testsTotal = unitProgress.tests_total ?? 0;
      if (testsTotal === 0) {
        return { valid: false, reason: 'bugfix unit must have at least one test (tests_total === 0)' };
      }

      return { valid: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ConstructionExecutor] validateBugfixTestRequirement error for ${unitId}:`, err);
      return { valid: false, reason: `validation error: ${message}` };
    }
  }

  async executeDocumentationGeneration(
    unitId: string,
    options: { projectPath?: string; workflowId?: string } = {}
  ): Promise<DocumentationGenerationResult> {
    const projectPath = options.projectPath || this.projectPath;
    const workflowId = options.workflowId || this.workflowId;

    const checkpoint = await loadCheckpoint(projectPath, workflowId);
    const depth = checkpoint?.depth_score
      ? checkpoint.depth_score <= 12 ? 'minimal' : checkpoint.depth_score <= 20 ? 'standard' : 'comprehensive'
      : 'standard';
    const pathway = checkpoint?.pathway_type || 'brownfield-enhancement';

    const unitFiles = await this.discoverUnitFiles(projectPath, workflowId, unitId);

    const docOptions: FeatureDocOptions = {
      unitId,
      workflowId,
      projectPath,
      depth,
      pathway,
      unitFiles,
    };

    const featureDocResult = generateDocumentation(docOptions);

    let impactScanResult: DocumentationGenerationResult['impactScan'];
    let adrCount = 0;
    let adrEntries: Array<{ path: string; title: string; number: number }> = [];
    let recreationReadinessResult: DocumentationGenerationResult['recreationReadiness'];

    if (featureDocResult.status === 'completed') {
      try {
        const postDocResult = runPostDocGeneration({
          projectPath,
          workflowId,
          unitId,
          modifiedFiles: docOptions.unitFiles || [],
        });
        impactScanResult = { status: postDocResult.impactScan.status, path: postDocResult.impactScan.reportPath };
        adrCount = postDocResult.adrCount;
        if ((postDocResult as any).adrEntries) {
          adrEntries = (postDocResult as any).adrEntries;
        }
      } catch {
        // Non-fatal: impact scan and ADR generation are advisory
      }

      if (featureDocResult.path && pathway !== 'bugfix' && depth !== 'minimal') {
        try {
          const unitData = checkpoint?.construction_units?.[unitId];
          const readinessResult = evaluateRecreationReadiness({
            featureDocPath: featureDocResult.path,
            projectPath,
            depth,
            pathway,
            override: unitData?.recreation_readiness_override,
            overrideRationale: unitData?.recreation_readiness_override_rationale ?? undefined,
          });
          recreationReadinessResult = readinessResult;
        } catch {
          // Non-fatal: recreation readiness is advisory
        }
      }
    }

    if (checkpoint?.construction_units?.[unitId]) {
      const unit = checkpoint.construction_units[unitId];
      unit.feature_doc_status = featureDocResult.status === 'completed' ? 'completed' : 'not_started';
      unit.feature_doc_path = featureDocResult.path;
      unit.impact_scan_status = impactScanResult?.status === 'completed' ? 'completed' : 'not_started';
      unit.impact_scan_report_path = impactScanResult?.path ?? null;
      unit.adr_count = adrCount;
      unit.adr_entries = adrEntries.length > 0 ? adrEntries : undefined;
      if (recreationReadinessResult) {
        unit.recreation_readiness_score = recreationReadinessResult.overall_score;
        unit.recreation_readiness_dimensions = recreationReadinessResult.dimensions ?? null;
      }
      if (featureDocResult.status === 'completed') {
        unit.doc_generation_agent = CONSTRUCTION_STAGE_AGENT_MAP['code-generation'];
        unit.doc_generation_prompt = buildFeatureDocPrompt(docOptions);
      }
      await saveCheckpoint(projectPath, checkpoint);
    }

    return { featureDoc: featureDocResult, impactScan: impactScanResult, adrCount, recreationReadiness: recreationReadinessResult };
  }

  async executeUnitCompletion(
    unitId: string,
    options: TestGenerationOptions & { skipDocumentation?: boolean } = {}
  ): Promise<{ testGeneration: TestGenerationResult; documentation?: DocumentationGenerationResult }> {
    const projectPath = options.projectPath || this.projectPath;
    const workflowId = options.workflowId || this.workflowId;

    const testResult = await this.executeTestGeneration(unitId, options);

    if (testResult.status === 'completed') {
      try {
        const unitFiles = await this.discoverUnitFiles(projectPath, workflowId, unitId);
        if (unitFiles.length > 0) {
          runSecretsManagement(projectPath, unitFiles);
        }
      } catch (err) {
        console.error(`[ConstructionExecutor] Secrets management failed for ${unitId} (non-blocking):`, err);
      }

      try {
        const unitFiles = await this.discoverUnitFiles(projectPath, workflowId, unitId);
        const scanResult = await scanProject({
          projectPath,
          workflowId,
          unitId,
          includeGlobs: unitFiles.length > 0 ? unitFiles : undefined,
        });

        const checkpoint = await loadCheckpoint(projectPath, workflowId);
        if (checkpoint?.construction_units?.[unitId]) {
          const unit = checkpoint.construction_units[unitId];
          unit.security_scan_status = scanResult.status === 'completed' ? 'completed'
            : scanResult.status === 'failed' ? 'in_progress' : 'not_started';
          unit.security_findings_critical = scanResult.findings.filter(f => f.severity === 'critical').length;
          unit.security_findings_warning = scanResult.findings.filter(f => f.severity === 'warning').length;
          unit.security_findings_info = scanResult.findings.filter(f => f.severity === 'info').length;
          await saveCheckpoint(projectPath, checkpoint);
        }
      } catch (err) {
        console.error(`[ConstructionExecutor] Security scan failed for ${unitId} (non-blocking):`, err);
      }

      if (!options.skipDocumentation) {
        const docResult = await this.executeDocumentationGeneration(unitId, {
          projectPath,
          workflowId,
        });
        return { testGeneration: testResult, documentation: docResult };
      }
    }

    return { testGeneration: testResult };
  }

  async executeSmokeTest(options: { projectPath?: string; workflowId?: string } = {}): Promise<{
    status: 'passed' | 'failed' | 'not_run';
    reportPath: string | null;
  }> {
    const projectPath = options.projectPath || this.projectPath;
    const workflowId = options.workflowId || this.workflowId;

    const loaded = await loadCheckpoint(projectPath, workflowId);
    if (!loaded || !loaded.construction_units) {
      return { status: 'not_run', reportPath: null };
    }

    const units = loaded.construction_units;
    const unitIds = Object.keys(units);

    if (unitIds.length === 0) {
      return { status: 'not_run', reportPath: null };
    }

    let totalTests = 0;
    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalRegressions = 0;
    let totalFlaky = 0;
    let unitsTested = 0;
    let unitsPassed = 0;

    const unitRows: string[] = [];

    for (const id of unitIds) {
      const u = units[id];
      const uTotal = u.tests_total ?? 0;
      const uPassed = u.tests_passed ?? 0;
      const uFailed = u.tests_failed ?? 0;
      const uSkipped = uTotal - uPassed - uFailed;
      const uRegressions = u.regressions_count ?? 0;
      const uFlaky = u.flaky_count ?? 0;

      if (uTotal > 0) {
        unitsTested++;
        if (uFailed === 0) unitsPassed++;
      }

      totalTests += uTotal;
      totalPassed += uPassed;
      totalFailed += uFailed;
      totalSkipped += Math.max(0, uSkipped);
      totalRegressions += uRegressions;
      totalFlaky += uFlaky;

      const statusEmoji = uTotal === 0 ? '⚠️' : uFailed === 0 ? '✅' : '❌';
      unitRows.push(`| ${id} | ${uTotal} | ${uPassed} | ${uFailed} | ${uRegressions} | ${uFlaky} | ${statusEmoji} |`);
    }

    const overallStatus: 'passed' | 'failed' | 'not_run' = totalTests === 0 ? 'not_run'
      : totalFailed === 0 ? 'passed'
      : 'failed';

    const reportDir = path.join(projectPath, 'aidlc-docs', workflowId, 'construction', 'build-and-test');
    await fs.ensureDir(reportDir);
    const reportPath = path.join(reportDir, 'test-report.md');

    const now = new Date().toISOString();
    const report = `# Build-Level Test Report

**Workflow ID**: ${workflowId}
**Generated At**: ${now}
**Status**: ${overallStatus.toUpperCase()}

## Summary

| Metric | Count |
|--------|-------|
| Total Tests | ${totalTests} |
| Passed | ${totalPassed} |
| Failed | ${totalFailed} |
| Skipped | ${totalSkipped} |
| Regressions | ${totalRegressions} |
| Flaky | ${totalFlaky} |
| Units Tested | ${unitsTested} |
| Units All-Passing | ${unitsPassed} |

## Per-Unit Breakdown

| Unit | Total | Passed | Failed | Regressions | Flaky | Status |
|------|-------|--------|--------|-------------|-------|--------|
${unitRows.join('\n')}
`;

    await fs.writeFile(reportPath, report, 'utf-8');

    try {
      const coverageRows: string[] = [];
      let totalCovPct = 0;
      let totalCriticalGaps = 0;
      let unitsWithCoverage = 0;

      for (const id of unitIds) {
        const u = units[id];
        const pct = u.coverage_percentage ?? null;
        const gaps = u.critical_gap_count ?? 0;
        totalCriticalGaps += gaps;
        if (pct !== null) {
          totalCovPct += pct;
          unitsWithCoverage++;
        }
        const tier = pct === null ? 'N/A'
          : pct >= 90 ? 'Exemplary'
          : pct >= 75 ? 'Commendable'
          : pct >= 60 ? 'Acceptable'
          : 'Below threshold';
        coverageRows.push(`| ${id} | ${pct !== null ? pct + '%' : 'N/A'} | ${gaps} | ${tier} |`);
      }

      const avgCoverage = unitsWithCoverage > 0
        ? Math.round((totalCovPct / unitsWithCoverage) * 10) / 10
        : null;

      const coverageReport = `# Workflow Coverage Report

**Workflow ID**: ${workflowId}
**Generated At**: ${now}

## Summary

| Metric | Value |
|--------|-------|
| Average Coverage | ${avgCoverage !== null ? avgCoverage + '%' : 'N/A'} |
| Critical Gaps (total) | ${totalCriticalGaps} |
| Units with Coverage Data | ${unitsWithCoverage} / ${unitIds.length} |

## Per-Unit Coverage

| Unit | Coverage | Critical Gaps | Tier |
|------|----------|---------------|------|
${coverageRows.join('\n')}
`;

      const coverageReportPath = path.join(reportDir, 'coverage-report.md');
      await fs.writeFile(coverageReportPath, coverageReport, 'utf-8');
    } catch (err) {
      console.error('[ConstructionExecutor] Workflow-level coverage report failed (non-fatal):', err);
    }

    const smokeResult: import('../phase-types.js').SmokeTestResult = {
      status: overallStatus,
      tests_total: totalTests,
      tests_passed: totalPassed,
      tests_failed: totalFailed,
      tests_skipped: totalSkipped,
      regressions_total: totalRegressions,
      flaky_total: totalFlaky,
      units_tested: unitsTested,
      units_passed: unitsPassed,
      report_path: reportPath,
      completed_at: now,
    };

    loaded.smoke_test = smokeResult;
    loaded.updated_at = now;
    await saveCheckpoint(projectPath, loaded);

    try {
      const { generateChangelogEntry } = await import('../changelog-generator.js');
      const unitIds = Object.keys(units);
      generateChangelogEntry({
        projectPath,
        workflowId,
        featureName: loaded.feature_name ?? workflowId,
        unitIds,
        pathway: loaded.pathway_type ?? undefined,
      });
    } catch (err) {
      console.error('[ConstructionExecutor] Changelog generation failed (non-fatal):', err);
    }

    try {
      const refreshedCheckpoint = await loadCheckpoint(projectPath, workflowId);
      if (refreshedCheckpoint) {
        generateQualityScorecard(refreshedCheckpoint, {
          projectPath,
          workflowId,
          featureName: refreshedCheckpoint.feature_name ?? workflowId,
        });
      }
    } catch (err) {
      console.error('[ConstructionExecutor] Quality scorecard generation failed (non-fatal):', err);
    }

    return { status: overallStatus, reportPath };
  }

  async captureBugDescription(
    description: string,
    options?: { projectPath?: string; workflowId?: string }
  ): Promise<void> {
    try {
      const projectPath = options?.projectPath || this.projectPath;
      const workflowId = options?.workflowId || this.workflowId;

      const loaded = await loadCheckpoint(projectPath, workflowId);
      const checkpoint = (loaded ?? {
        schema_version: '3.0.0' as const,
        workflow_id: workflowId,
        feature_name: '',
        current_phase: 'construction' as const,
        current_stage: 'code-generation' as const,
        status: 'in_progress' as const,
        phases: {} as any,
        manifest_path: '',
        trust_state_path: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        construction_units: {} as Record<string, ConstructionUnitProgress>,
      }) as import('../phase-types.js').WorkflowCheckpointV3;

      checkpoint.bug_description = description;
      checkpoint.updated_at = new Date().toISOString();

      await saveCheckpoint(projectPath, checkpoint);
    } catch (err) {
      console.error('[ConstructionExecutor] captureBugDescription error:', err);
    }
  }

  /**
   * Discover source files associated with a construction unit by parsing
   * the code-summary.md artifact for file paths.
   */
  private async discoverUnitFiles(projectPath: string, workflowId: string, unitId: string): Promise<string[]> {
    const codeSummaryPath = path.join(
      projectPath, 'aidlc-docs', workflowId, 'construction', unitId, 'code', 'code-summary.md'
    );
    try {
      if (!await fs.pathExists(codeSummaryPath)) return [];
      const content = await fs.readFile(codeSummaryPath, 'utf-8');
      const files: string[] = [];
      // Match lines like: - `src/foo/bar.ts` or - src/foo/bar.ts or | src/foo/bar.ts |
      const patterns = [
        /[`|]\s*([\w/.\\-]+\.\w{1,5})\s*[`|]/g,
        /^[-*]\s+`?([\w/.\\-]+\.\w{1,5})`?\s*$/gm,
      ];
      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          const filePath = match[1];
          if (!files.includes(filePath)) files.push(filePath);
        }
      }
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Filter unit files to find likely API surface files (routes, controllers, endpoints).
   */
  private detectApiSurfaceFiles(unitFiles: string[]): string[] {
    const apiPatterns = [
      /route/i, /controller/i, /handler/i, /endpoint/i,
      /api\//i, /server/i, /middleware/i, /graphql/i,
    ];
    return unitFiles.filter(f => apiPatterns.some(p => p.test(f)));
  }

  /**
   * Derive a numeric workflow depth (0=bugfix, 1=minimal, 2=standard+) from checkpoint state.
   */
  private deriveWorkflowDepth(checkpoint: import('../phase-types.js').WorkflowCheckpointV3): number {
    if (checkpoint.pathway_type === 'bugfix') return 0;
    const score = checkpoint.depth_score ?? 3;
    return score <= 2 ? 1 : 2;
  }

  private async detectTestFramework(projectPath: string): Promise<string> {
    const pkgPath = path.join(projectPath, 'package.json');
    try {
      if (!(await fs.pathExists(pkgPath))) {
        return 'unknown';
      }
      const content = await fs.readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (allDeps['vitest']) return 'vitest';
      if (allDeps['jest']) return 'jest';
      if (allDeps['mocha']) return 'mocha';
      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private buildTestReportScaffold(unitId: string, framework: string, codeSummaryContent: string, now: string): string {
    let filesInScope = '_No code-summary.md found — files in scope unknown._';
    if (codeSummaryContent) {
      const match = codeSummaryContent.match(/## Files (?:created|modified|created\/modified)[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
      if (match && match[1].trim()) {
        filesInScope = match[1].trim();
      }
    }

    return `---
unit_id: ${unitId}
framework: ${framework}
generated_at: ${now}
---

# Test Report — ${unitId}

## Files in Scope

${filesInScope}

## Test Results

| Metric | Value |
|--------|-------|
| tests_total | 0 |
| tests_passed | 0 |
| tests_failed | 0 |

## Test Types

- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests

## Failure Details

_No failures recorded._

## Override

_allowFailures was not set._
`;
  }

  private async executeShallowViaBolt(): Promise<ValidationResult> {
    const intentPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'inception', 'intent.md');

    let intentTitle = 'Shallow Implementation';
    let intentEffort = 2;
    let intentContent = '';

    const parsed = await parseIntentFromFile(intentPath);
    if (parsed) {
      intentContent = parsed.content;
      const titleMatch = intentContent.match(/^title:\s*(.+)$/m);
      if (titleMatch) {
        intentTitle = titleMatch[1].trim().replace(/^["']|["']$/g, '');
      }
      const effortMatch = intentContent.match(/^estimated_effort:\s*(\d+)/m);
      if (effortMatch) {
        intentEffort = Number(effortMatch[1]);
      }
    } else {
      const intentDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'inception');
      const intents = await parseIntentsFromDisk(intentDir);
      if (intents.length === 0) {
        return {
          passed: false,
          coverage_percentage: 0,
          blocking_issues: ['No intent found for SHALLOW construction'],
          reviewer: 'construction-executor',
          timestamp: new Date().toISOString(),
        };
      }
      intentTitle = intents[0].title;
      intentEffort = intents[0].estimated_effort;
    }

    const unit: HierarchicalNode = {
      id: 'shallow-impl',
      type: 'unit',
      title: intentTitle,
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: intentEffort,
    };

    const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    if (!checkpoint) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No checkpoint found for SHALLOW construction'],
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    const expressBolt = createExpressBolt(unit, intentContent, checkpoint);
    registerBoltsInCheckpoint([expressBolt], checkpoint);

    const handlers: StageHandlers = {
      onElaboration: async () => ({ success: true }),
      onCodeGeneration: async () => ({ success: true }),
      onBuildAndTest: async () => ({ success: true }),
      onReview: async () => ({ success: true }),
    };

    const result = await BoltExecutor.execute(
      expressBolt, checkpoint, this.projectPath, this.workflowId, handlers,
    );

    console.log(`[ConstructionExecutor] SHALLOW express bolt completed with status: ${result.status}`);

    return {
      passed: result.status === 'done',
      coverage_percentage: result.status === 'done' ? 100 : 0,
      blocking_issues: result.status === 'done' ? [] : [`Express bolt failed with status: ${result.status}`],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute the decomposition phase: parse intent, create UNITs, create BOLTs per UNIT.
   *
   * Reads from inception/intent.md (new-style) or falls back to INTENT-*.md (old-style).
   *
   * @private
   */
  private async executeDecompositionPhase(
    maxUnits: number,
    maxCodeGenPerUnit: number,
    maxTotalCodeGen: number,
    depth: 'SHALLOW' | 'MEDIUM' | 'DEEP' = 'MEDIUM'
  ): Promise<ValidationResult> {
    const intentDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'inception');
    const constructionDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction');

    await fs.ensureDir(constructionDir);

    // Try new-style intent.md first
    const intentPath = path.join(intentDir, 'intent.md');
    const parsed = await parseIntentFromFile(intentPath);

    // Read INTENT content for dual validation
    const intentFilePath = path.join(intentDir, 'intent.md');
    let intentContent = '';
    try {
      if (await fs.pathExists(intentFilePath)) {
        intentContent = await fs.readFile(intentFilePath, 'utf-8');
      }
    } catch {
      // intent.md is optional for validation
    }

    if (parsed) {
      return this.executeDecompositionFromIntent(
        parsed,
        intentDir,
        constructionDir,
        maxUnits,
        maxCodeGenPerUnit,
        maxTotalCodeGen,
        intentContent,
        depth
      );
    }

    // Fall back to old-style INTENT-*.md parsing
    return this.executeDecompositionFromLegacyIntents(
      intentDir,
      constructionDir,
      maxUnits,
      maxCodeGenPerUnit,
      maxTotalCodeGen,
      intentContent
    );
  }

  /**
   * Decompose from a new-style single intent.md file.
   *
   * @private
   */
  private async executeDecompositionFromIntent(
    parsed: { content: string; proposedUnits: Array<{ id: string; title: string; description: string }> },
    intentDir: string,
    constructionDir: string,
    maxUnits: number,
    _maxCodeGenPerUnit: number,
    _maxTotalCodeGen: number,
    rootIntentContent: string,
    depth: 'SHALLOW' | 'MEDIUM' | 'DEEP' = 'MEDIUM'
  ): Promise<ValidationResult> {
    const intentContent = parsed.content;
    const titleMatch = intentContent.match(/^title:\s*(.+)$/m);
    const effortMatch = intentContent.match(/^estimated_effort:\s*(\d+)/m);
    const intentTitle = titleMatch
      ? titleMatch[1].trim().replace(/^["']|["']$/g, '')
      : 'Untitled Intent';
    const intentEffort = effortMatch ? Number(effortMatch[1]) : 0;

    // Use INTENT-001 as the canonical ID for the single intent (compatible with validator)
    const intentId = 'INTENT-001';
    const intentNode: HierarchicalNode = {
      id: intentId,
      type: 'intent',
      title: intentTitle,
      parent_id: null,
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: intentEffort,
    };

    // Write a bridge INTENT-001.md file so the validator can find valid parent references
    const bridgeIntentContent = `---
id: ${intentId}
title: ${intentTitle}
status: pending
estimated_effort: ${intentEffort}
dependencies: []
---

# Task: ${intentTitle}

## Goal
${intentTitle}

## Component
Auto-generated

## Acceptance Criteria
- [ ] All units complete

## Implementation Steps
1. Execute construction pipeline

## Technical Notes
Generated from inception/intent.md
`;
    await fs.writeFile(
      path.join(intentDir, `${intentId}.md`),
      bridgeIntentContent,
      'utf-8'
    );

    // Build UnitSpecs from proposed units
    const unitSpecs: UnitSpec[] = parsed.proposedUnits.map(pu => ({
      title: pu.title,
      estimated_effort: Math.ceil(intentEffort / Math.max(parsed.proposedUnits.length, 1)),
      description: pu.description,
    }));

    // If no proposed units, create one unit from the intent itself
    if (unitSpecs.length === 0) {
      unitSpecs.push({
        title: intentTitle,
        estimated_effort: intentEffort,
        description: `Implementation unit for ${intentTitle}`,
      });
    }

    // Decompose intent to units with limit
    const allUnits = decomposeIntentToUnits(intentNode, unitSpecs, maxUnits);

    const blockingIssues: string[] = [];

    for (const unit of allUnits) {
      const unitDir = path.join(constructionDir, unit.id);
      await fs.ensureDir(unitDir);

      // Write unit spec.md
      const unitContent = this.formatUnitMarkdown(unit, intentNode.id, intentContent);
      await fs.writeFile(path.join(unitDir, 'spec.md'), unitContent, 'utf-8');
      // Also write top-level UNIT-NNN.md for backward compat / validation
      await fs.writeFile(path.join(constructionDir, `${unit.id}.md`), unitContent, 'utf-8');

      // Register UNIT in manifest with parent-child link to intent
      this.registerConstructionArtifact(unit.id, 'unit', 'unit', path.join(unitDir, 'spec.md'));
      this.linkConstructionArtifacts(intentId, unit.id, 'derives');

      this.runUnitValidation(unitContent, intentContent, rootIntentContent, intentNode.id, unit.id);

      // Per-unit design stages (AWS AI-DLC alignment)
      try {
        const { UnitStageRunner } = await import('./unit-stage-runner.js');
        const { loadCheckpoint: loadCp, saveCheckpoint: saveCp } = await import('../checkpoint.js');
        const stageRunner = new UnitStageRunner(this.projectPath, this.workflowId);
        await stageRunner.executeForUnit(unit.id, depth, rootIntentContent, undefined, async (uid, prog) => {
          const cp = await loadCp(this.projectPath, this.workflowId);
          if (cp) {
            if (!cp.construction_units) cp.construction_units = {};
            cp.construction_units[uid] = prog;
            await saveCp(this.projectPath, cp);
          }
        });
      } catch (err) {
        console.error(`[ConstructionExecutor] Unit stage runner failed for ${unit.id}:`, err);
      }

    }

    this.tree = buildDecompositionTree([intentNode]);
    for (const unit of allUnits) {
      this.tree.nodes.set(unit.id, unit);
    }

    this.totalUnits = allUnits.length;
    this.totalCodeGenerations = allUnits.length;
    this.totalEffort = allUnits.reduce((sum, u) => sum + u.estimated_effort, 0);

    console.log(
      `[ConstructionExecutor] Created ${allUnits.length} units for code generation`
    );

    // Validate units against intents
    const validationResult = await validateUnits(constructionDir, intentDir);
    if (!validationResult.passed) {
      return validationResult;
    }

    if (blockingIssues.length > 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: blockingIssues,
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Fall back to old-style INTENT-*.md decomposition for backward compatibility.
   *
   * @private
   */
  private async executeDecompositionFromLegacyIntents(
    intentDir: string,
    constructionDir: string,
    maxUnits: number,
    _maxCodeGenPerUnit: number,
    _maxTotalCodeGen: number,
    rootIntentContent: string
  ): Promise<ValidationResult> {
    const intents = await parseIntentsFromDisk(intentDir);
    if (intents.length === 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No intents found in Inception phase'],
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ConstructionExecutor] Found ${intents.length} intents to decompose (legacy mode)`);

    let intentFileContent = '';
    try {
      const intentFiles = await fs.readdir(intentDir);
      const firstIntent = intentFiles.find(f => f.startsWith('INTENT-') && f.endsWith('.md'));
      if (firstIntent) {
        intentFileContent = await fs.readFile(path.join(intentDir, firstIntent), 'utf-8');
      }
    } catch {
      // Best effort
    }

    const allUnits: HierarchicalNode[] = [];
    const blockingIssues: string[] = [];

    for (const intent of intents) {
      const unitSpecs: UnitSpec[] = [
        {
          title: intent.title,
          estimated_effort: intent.estimated_effort,
          description: `Implementation unit for ${intent.title}`,
        },
      ];

      const units = decomposeIntentToUnits(intent, unitSpecs, maxUnits);
      allUnits.push(...units);

      for (const unit of units) {
        const unitFilePath = path.join(constructionDir, `${unit.id}.md`);
        const unitContent = this.formatUnitMarkdown(unit, intent.id);
        await fs.writeFile(unitFilePath, unitContent, 'utf-8');

        const unitDir = path.join(constructionDir, unit.id);
        await fs.ensureDir(unitDir);
        await fs.writeFile(path.join(unitDir, 'spec.md'), unitContent, 'utf-8');

        this.registerConstructionArtifact(unit.id, 'unit', 'unit', path.join(unitDir, 'spec.md'));
        this.linkConstructionArtifacts(intent.id, unit.id, 'derives');

        this.runUnitValidation(unitContent, intentFileContent, rootIntentContent, intent.id, unit.id);
      }
    }

    console.log(
      `[ConstructionExecutor] Created ${allUnits.length} units for code generation`
    );

    this.tree = buildDecompositionTree(intents);
    for (const unit of allUnits) {
      this.tree.nodes.set(unit.id, unit);
    }

    this.totalUnits = allUnits.length;
    this.totalCodeGenerations = allUnits.length;
    this.totalEffort = allUnits.reduce((sum, u) => sum + u.estimated_effort, 0);

    // Validate units
    const validationResult = await validateUnits(constructionDir, intentDir);
    if (!validationResult.passed) {
      return validationResult;
    }

    if (blockingIssues.length > 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: blockingIssues,
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute the DESIGN stage of Construction.
   *
   * 1. Read units from disk
   * 2. Generate interface contracts
   * 3. Generate data flow diagrams
   * 4. Generate component designs
   * 5. Write design artifacts to construction/design/
   * 6. Validate design artifacts
   *
   * @private
   */
  private async executeDesignStage(specContent?: string): Promise<ValidationResult> {
    const constructionDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction');

    const unitEntries = await fs.readdir(constructionDir, { withFileTypes: true });
    const units: HierarchicalNode[] = [];

    for (const entry of unitEntries) {
      if (entry.isDirectory() && entry.name !== 'design') {
        const specPath = path.join(constructionDir, entry.name, 'spec.md');
        if (await fs.pathExists(specPath)) {
          const content = await fs.readFile(specPath, 'utf-8');
          const unit = this.parseUnitFromMarkdown(content, entry.name);
          if (unit) {
            units.push(unit);
          }
        }
      } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'design') {
        const filePath = path.join(constructionDir, entry.name);
        const content = await fs.readFile(filePath, 'utf-8');
        const unit = this.parseUnitFromMarkdown(content, entry.name.replace('.md', ''));
        if (unit) {
          units.push(unit);
        }
      }
    }

    if (units.length === 0) {
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['No units found to generate design artifacts'],
        reviewer: 'construction-executor',
        timestamp: new Date().toISOString(),
      };
    }

    console.log(`[ConstructionExecutor] Generating design artifacts for ${units.length} units`);

    // Generate design artifacts
    const interfaces = generateInterfaceContracts(units, specContent || '');
    const dataFlows = generateDataFlowDiagram(units, interfaces);
    const components = generateComponentDesign(units, interfaces, dataFlows);

    // Write design artifacts
    await writeDesignArtifacts(this.projectPath, this.workflowId, {
      interfaces,
      dataFlows,
      components,
    });

    // Register design artifacts in manifest
    const designDir = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'construction', 'design');
    this.registerConstructionArtifact('design-interfaces', 'interface-contracts', 'unit', path.join(designDir, 'interfaces.json'));
    this.registerConstructionArtifact('design-data-flow', 'data-flow-diagram', 'unit', path.join(designDir, 'data-flow.json'));
    this.registerConstructionArtifact('design-components', 'component-design', 'unit', path.join(designDir, 'components.json'));

    // Validate design
    if (specContent) {
      const validationResult = validateDesign(
        {
          interfaces,
          dataFlows,
          components,
        },
        specContent
      );
      return validationResult;
    }

    // No spec provided, return passing result
    return {
      passed: true,
      coverage_percentage: 100,
      blocking_issues: [],
      reviewer: 'construction-executor',
      timestamp: new Date().toISOString(),
    };
  }

  private runUnitValidation(
    unitContent: string,
    intentContent: string,
    rootIntentContent: string,
    intentId: string,
    unitId: string
  ): void {
    if (!intentContent || !rootIntentContent) {
      return;
    }

    try {
      const result = runDualValidation(
        unitContent,
        intentContent,
        rootIntentContent,
        'intent-to-unit',
        'unit-to-intent',
        intentId,
        unitId,
        `intent-${this.workflowId}`
      );

      if (!result.passed) {
        console.warn(
          `[ConstructionExecutor] Dual validation warning for ${unitId}: parent=${result.parentCheck.alignment_passed}, root=${result.rootCheck.alignment_passed}`
        );
      }
    } catch (err) {
      console.error(`[ConstructionExecutor] Dual validation error for ${unitId}:`, err);
    }
  }


  /**
   * Register a construction artifact in the manifest with proper metadata.
   * Silently handles errors to avoid blocking the construction pipeline.
   *
   * @private
   */
  private registerConstructionArtifact(
    artifactId: string,
    artifactType: string,
    stage: 'unit' | 'code-generation',
    artifactPath: string
  ): void {
    try {
      const manifestPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'manifest.json');
      registerArtifact(manifestPath, {
        id: artifactId,
        type: artifactType,
        phase: 'construction',
        stage: stage,
        path: artifactPath,
        validation_passed: null,
        write_complete: true,
        checksum: null,
      });
    } catch (err) {
      console.error(`[ConstructionExecutor] Failed to register artifact ${artifactId}:`, err);
    }
  }

  /**
   * Link two artifacts in the manifest (parent-child relationship).
   * Silently handles errors to avoid blocking the construction pipeline.
   *
   * @private
   */
  private linkConstructionArtifacts(
    sourceId: string,
    targetId: string,
    linkType: 'derives' | 'implements'
  ): void {
    try {
      const manifestPath = path.join(this.projectPath, 'aidlc-docs', this.workflowId, 'manifest.json');
      linkArtifacts(manifestPath, {
        source_id: sourceId,
        target_id: targetId,
        link_type: linkType,
      });
    } catch (err) {
      console.error(`[ConstructionExecutor] Failed to link ${sourceId} -> ${targetId}:`, err);
    }
  }

  /**
   * Format a unit as a markdown file with the new UNIT template format.
   *
   * Produces frontmatter compatible with the existing validation system
   * (unquoted values, required sections: Goal, Acceptance Criteria, Implementation Notes).
   *
   * @private
   */
  private formatUnitMarkdown(
    unit: HierarchicalNode,
    parentIntentId: string,
    _intentContent?: string
  ): string {
    const now = new Date().toISOString();
    return `---
id: ${unit.id}
title: ${unit.title}
parent_intent: ${parentIntentId}
status: ${unit.status}
estimated_effort: ${unit.estimated_effort}
created: ${now}
---

# ${unit.id}: ${unit.title}

## Goal

${unit.title}

## Scope & Responsibility
Implementation unit for ${unit.title}

## Interface Contracts

### Inputs
- To be defined during design phase

### Outputs
- To be defined during design phase

### API Surface
To be defined during design phase

## Dependencies
- **Internal**: None identified
- **External**: None identified

## Target Files
- [ ] To be identified during code generation

## Design Artifacts
See construction/design/ for generated artifacts

## Acceptance Criteria
- [ ] Unit implementation complete
- [ ] Tests passing

## Implementation Notes

Implementation details for ${unit.title}.

## Traceability
- Parent INTENT: ${parentIntentId} (inception/intent.md)
- Root INTENT: intent-${this.workflowId} (inception/intent.md)
`;
  }


  /**
   * Parse a unit from markdown content.
   *
   * @private
   */
  private parseUnitFromMarkdown(content: string, unitId: string): HierarchicalNode | null {
    try {
      // Parse frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) {
        return null;
      }

      const frontmatter = frontmatterMatch[1];
      const lines = frontmatter.split('\n');
      const metadata: Record<string, any> = {};

      for (const line of lines) {
        const match = line.match(/^(\w+):\s*(.+)$/);
        if (match) {
          const [, key, value] = match;
          // Strip surrounding quotes
          const cleaned = value.trim().replace(/^["']|["']$/g, '');
          if (!isNaN(Number(cleaned))) {
            metadata[key] = Number(cleaned);
          } else {
            metadata[key] = cleaned;
          }
        }
      }

      return {
        id: unitId,
        type: 'unit',
        title: metadata.title || 'Untitled Unit',
        parent_id: metadata.parent_intent || null,
        children_ids: [],
        status: metadata.status || 'pending',
        assigned_agent: metadata.assigned_agent || null,
        estimated_effort: metadata.estimated_effort || 0,
      };
    } catch (error) {
      console.error(`Failed to parse unit from markdown:`, error);
      return null;
    }
  }
}
