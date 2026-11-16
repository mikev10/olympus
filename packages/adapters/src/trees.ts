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
