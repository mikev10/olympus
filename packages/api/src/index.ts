/**
 * @olympus-ai/api: the runtime as a service. This package holds the
 * programmatic entry points (`startRun`, `resumeRun`, `approveStation`), the
 * safety declaration the runtime enforces before a run starts (I5), and the
 * request validation that refuses what the line could not trust. The line
 * runs stations 1-8 through the station machine in `@olympus-ai/core`.
 *
 * I9: nothing here assumes a terminal, a TTY, or a foreground process. The
 * conformance scan I9.api-never-touches-a-terminal asserts it.
 */
export * from './gate.js';
export * from './safety.js';
export * from './run.js';
export * from './validate.js';
