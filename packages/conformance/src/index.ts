/**
 * @olympus-ai/conformance: the kit that lets any package prove an invariant
 * in isolation, with no factory run, plus the registry that maps every
 * invariant (I1-I10) and every capability claim to its assertions.
 *
 * Compile-error assertions compile an annotated fixture with the same
 * strictness as the contracts (kit/fixtures.ts). Runtime assertions are plain
 * functions. Lint-backed assertions read ESLint's resolved configuration and
 * lint a fixture (kit/eslint.ts). Another package contributes an assertion
 * with `invariantTest` and the registry lists it as external.
 */
export * from './kit/types.js';
export * from './kit/workspace.js';
export * from './kit/baseline.js';
export * from './kit/fixtures.js';
export * from './kit/registry.js';
export * from './kit/assert.js';
export * from './kit/eslint.js';
export * from './kit/scan.js';
export * from './kit/vitest.js';
export { REGISTRY } from './registry/index.js';
