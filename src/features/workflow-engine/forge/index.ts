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

// Forge executor (orchestrates units → design → build)
export { ForgeExecutor, FORGE_STAGE_AGENT_MAP } from './executor.js';
export type { ForgeProgress } from './executor.js';

// Validation for forge artifacts
export { validateUnits, validateDesignArtifacts, validateBolt, validateForgePhase } from './validation.js';
