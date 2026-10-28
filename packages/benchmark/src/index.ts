/**
 * @olympus-ai/benchmark: the false-done benchmark (R7). A versioned corpus
 * of seeded false-dones and clean controls, carried through the line and
 * through a driver alone, and reported as bounded rates against the corpus
 * version that produced them. No runtime package depends on this one: the
 * corpus and its answer key are out of every driver's and learner's reach
 * (D-R7-03).
 */
export * from './alone.js';
export * from './corpus.js';
export * from './deterministic.js';
export * from './line.js';
export * from './result.js';
export * from './seats.js';
export * from './model.js';
export * from './critic.js';
