/**
 * Construction Phase Module
 *
 * Hierarchical decomposition and design system for the ODLC Construction phase.
 * Transforms Inception phase INTENTs into executable UNITs and BOLTs.
 */

// Decomposition (INTENT → UNIT → BOLT)
export * from './decomposition.js';

// Design system (interface contracts, data flows, components)
export * from './design.js';

// Construction executor (orchestrates decomposition + design)
export {
  ConstructionExecutor,
  ForgeExecutor,
  CONSTRUCTION_STAGE_AGENT_MAP,
  FORGE_STAGE_AGENT_MAP,
} from './executor.js';
export type { ConstructionProgress, ConstructionOptions, ForgeProgress } from './executor.js';

// Validation for forge artifacts
export { validateUnits, validateDesignArtifacts, validateBolt, validateForgePhase, validateConstructionPhase } from './validation.js';
