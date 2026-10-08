/**
 * Readiness (R1): scans one repository at one commit and derives the highest
 * autonomy level it can support, from probes that executed, with the probe
 * that holds the ceiling named. Subtractive only (I4): the ceiling is the
 * fourth term of the effective-level formula and lowers a level or does
 * nothing.
 */
export * from './types.js';
export { CEILING_BEARING, L0_PROBES, L1_PROBES, L2_PROBES, PROBES, definitionOf, type ProbeDefinition } from './probes.js';
export { deriveCeiling, type Derivation } from './derive.js';
export {
  resolveWithReadiness,
  type BoundingTerm,
  type BoundRefusal,
  type ReadinessResolution,
  type ScopeRefusal,
} from './resolve.js';
export {
  NOT_SCANNED,
  NPM_REGISTRY,
  SECRET_SCAN_IMAGE,
  ceilingOf,
  scan,
  type BranchProtectionChecker,
  type ScanOptions,
} from './scan.js';
export { renderReport } from './report.js';
