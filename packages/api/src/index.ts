/**
 * @olympus-ai/api: the runtime as a service. This package holds the
 * programmatic entry point (`startRun`) and the safety declaration the
 * runtime enforces before a run starts (I5). The line it drives is the
 * walking skeleton: three stations over stubs, replaced piece by piece in
 * Phase 2.
 *
 * I9: nothing here assumes a terminal, a TTY, or a foreground process. The
 * conformance scan I9.api-never-touches-a-terminal asserts it.
 */
export * from './safety.js';
export * from './run.js';
