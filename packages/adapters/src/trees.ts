/**
 * The dependency trees each supported stack's install writes, by directory
 * name at any depth (A-R29-01, D-R29-10). A task's write under one is never
 * carried into the tree a check runs over, whatever the run's stack: a
 * `.venv` the change wrote would be its own judge, and a `__pycache__` file
 * is bytecode Python loads in place of the source its header names.
 */
export const NODE_DEPENDENCY_TREES: readonly string[] = Object.freeze(['node_modules']);
export const PYTHON_DEPENDENCY_TREES: readonly string[] = Object.freeze(['.venv', 'site-packages', '__pycache__']);

/** Every supported set's trees: what the carry rule, the tamper walk, and the adapters skip. */
export const DEPENDENCY_TREES: readonly string[] = Object.freeze([...NODE_DEPENDENCY_TREES, ...PYTHON_DEPENDENCY_TREES]);

const LOWER = new Set(DEPENDENCY_TREES.map((t) => t.toLowerCase()));

/** Whether a directory name is a dependency tree, in any case: `Node_Modules` lands in `node_modules` on a case-insensitive filesystem (D-R15-07). */
export function isDependencyTree(name: string): boolean {
  return LOWER.has(name.toLowerCase());
}

/**
 * The caches a stack's own tools write inside a dependency tree when they run
 * over a writable one, each as the entry a dependency-tree write is recorded
 * under: Vite's default `cacheDir`, where Vitest keeps its results
 * (D-R57-03). A builder that runs its tests writes there on every build. A
 * write under one is never carried, as no dependency-tree write is, and is not
 * recorded as one: the tree a check runs over has every dependency tree
 * replaced by the runtime's install first, so nothing in a cache reaches a
 * check. Matched exactly, case and all, so a variant is recorded as before.
 */
export const TOOL_CACHES: readonly string[] = Object.freeze(['node_modules/.vite']);

/** Whether a recorded dependency-tree entry is one of `TOOL_CACHES`, at the tree's root or below a directory of it. */
export function isToolCache(entry: string): boolean {
  return TOOL_CACHES.some((cache) => entry === cache || entry.endsWith(`/${cache}`));
}
