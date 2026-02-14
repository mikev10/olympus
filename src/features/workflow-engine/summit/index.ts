/**
 * Operations Phase Module
 *
 * Template-based artifact generation for the Operations phase of ODLC.
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
export type { OperationsContext, SummitContext, OperationsResult } from './templates.js';
