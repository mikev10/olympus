/**
 * @olympus-ai/core: the runtime's contracts.
 *
 * I9: the runtime is a service and the CLI is a client. Nothing exported from
 * this package may assume a terminal, a TTY, or a foreground process; the
 * compiler lib is ES2022 with no DOM.
 * I10: no Greek names in identifiers, paths, config keys, or policy fields.
 * Both are asserted by the conformance suite (packages/conformance).
 */
export * from './run/types.js';
export * from './driver/contract.js';
export * from './policy/types.js';
export * from './station/types.js';
