import type { ValidatorResult, ValidatorStatus, Finding, ConstructionUnitProgress } from '../../phase-types.js';
import type { ValidatorName, ValidatorFn, ValidatorConfig, PipelineResult } from './types.js';
import { loadCheckpoint, saveCheckpoint } from '../../checkpoint.js';

const PIPELINE_ORDER: ValidatorName[] = ['quality', 'mutation', 'traceability', 'contract', 'coverage'];

const VALIDATOR_FIELD_MAP: Record<ValidatorName, keyof ConstructionUnitProgress> = {
  quality: 'quality_validation_status',
  mutation: 'mutation_validation_status',
  traceability: 'traceability_status',
  contract: 'contract_validation_status',
  coverage: 'coverage_status',
};

export async function runValidationPipeline(
  validators: Map<ValidatorName, ValidatorFn>,
  config: ValidatorConfig
): Promise<PipelineResult> {
  const results: PipelineResult['results'] = [];

  for (const name of PIPELINE_ORDER) {
    const fn = validators.get(name);
    if (!fn) {
      continue;
    }

    let result: ValidatorResult;

    try {
      const timeoutPromise = new Promise<ValidatorResult>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), config.timeoutBudgetMs)
      );

      result = await Promise.race([fn(config), timeoutPromise]);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'timeout';
      const errorFinding: Finding = {
        id: `${name}-error`,
        severity: 'error',
        category: isTimeout ? 'timeout' : 'runtime-error',
        message: isTimeout
          ? `Validator '${name}' exceeded timeout of ${config.timeoutBudgetMs}ms`
          : `Validator '${name}' threw an error: ${err instanceof Error ? err.message : String(err)}`,
      };
      console.error(`[ValidatorPipeline] ${name} validator failed:`, err);
      result = {
        status: isTimeout ? 'timeout' : 'failed',
        findings: [errorFinding],
        artifactPath: '',
      };
    }

    results.push({ validator: name, result });
  }

  return { results };
}

export function shouldSkipValidator(
  name: ValidatorName,
  config: ValidatorConfig
): { skip: boolean; reason?: string } {
  if (name === 'mutation') {
    const criticalKeywords = [
      'auth', 'payment', 'security', 'encrypt', 'token',
      'credential', 'password', 'session', 'permission',
    ];
    const hasCritical = config.unitFiles.some(f =>
      criticalKeywords.some(k => f.toLowerCase().includes(k))
    );
    if (!hasCritical) {
      return { skip: true, reason: 'No critical-path keywords found in unit files' };
    }
  }

  if (name === 'contract') {
    if (config.apiSurfaceFiles.length === 0) {
      return { skip: true, reason: 'No API surface files in unit' };
    }
  }

  return { skip: false };
}

export function applyAllowFailures(result: ValidatorResult): ValidatorResult {
  return {
    ...result,
    status: 'passed',
    findings: result.findings.map(f => ({ ...f, severity: 'info' as const })),
  };
}

export async function updateCheckpointForValidator(
  projectPath: string,
  workflowId: string,
  unitId: string,
  validatorName: ValidatorName,
  status: ValidatorStatus,
  coveragePercentage?: number
): Promise<void> {
  const checkpoint = await loadCheckpoint(projectPath, workflowId);
  if (!checkpoint || !checkpoint.construction_units) {
    return;
  }

  const unit = checkpoint.construction_units[unitId];
  if (!unit) {
    return;
  }

  const field = VALIDATOR_FIELD_MAP[validatorName];
  (unit as unknown as Record<string, unknown>)[field as string] = status;

  if (validatorName === 'coverage' && coveragePercentage !== undefined) {
    unit.coverage_percentage = coveragePercentage;
  }

  await saveCheckpoint(projectPath, checkpoint);
}
