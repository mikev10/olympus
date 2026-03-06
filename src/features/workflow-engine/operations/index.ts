/**
 * Operations Phase Module
 *
 * Template-based artifact generation for the Operations phase of AIDLC.
 * v1: Documentation generation only, no actual deployment.
 */
export {
  generateDeployGuide,
  generateRunbook,
  generateMonitoringConfig,
  generateReleaseNotes,
  generateCostAnalysis,
  generateOperationsArtifacts,
} from './templates.js';
export type { OperationsContext, OperationsResult } from './templates.js';
