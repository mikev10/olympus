import type { ValidatorResult } from '../../phase-types.js';

export type ValidatorName = 'quality' | 'mutation' | 'traceability' | 'contract' | 'coverage';

export interface ValidatorConfig {
  timeoutBudgetMs: number;
  allowFailures: boolean;
  workflowDepth: number;
  unitId: string;
  unitFiles: string[];
  apiSurfaceFiles: string[];
  projectPath: string;
  workflowId: string;
}

export type ValidatorRiskTier = 'critical' | 'moderate' | 'low';

export interface RiskKeywordConfig {
  critical: string[];
  moderate: string[];
  low: string[];
}

export interface PipelineResult {
  results: Array<{ validator: ValidatorName; result: ValidatorResult }>;
}

export type ValidatorFn = (config: ValidatorConfig) => Promise<ValidatorResult>;
