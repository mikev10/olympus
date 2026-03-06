/**
 * Construction Phase Module
 *
 * Hierarchical decomposition and design system for the AIDLC Construction phase.
 * Transforms Inception phase INTENTs into executable UNITs and BOLTs.
 */

// Decomposition (INTENT → UNIT → BOLT)
export * from './decomposition.js';

// Design system (interface contracts, data flows, components)
export * from './design.js';

// Construction executor (orchestrates decomposition + design)
export {
  ConstructionExecutor,
  CONSTRUCTION_STAGE_AGENT_MAP,
} from './executor.js';
export type { ConstructionProgress, ConstructionOptions } from './executor.js';

// Validation for construction artifacts
export { validateUnits, validateDesignArtifacts, validateBolt, validateConstructionPhase } from './validation.js';
