/**
 * I5 applied to the components. A component that cannot enforce what its
 * contract implies declares that through a property on its own interface.
 * The runtime refuses to carry a run above L1 while any declaration exists,
 * naming each one. The declarations are read once, by `buildGraph`, when the
 * graph is built (D-A-I1-05), together with the ones the builder gives a
 * component it cannot attest (D-I1a-06).
 *
 * `declarationOf` reads the property structurally (`'unsafe' in
 * component`), so a stub in vault, sandbox, or core needs no import from this
 * package to declare itself. The conformance fixture I5.stubs-declare-unsafe
 * is what pins each stub's property to this type.
 */
import { provenanceOf } from './graph.js';
import type { ComponentGraph } from './run.js';

export interface UnsafeDeclaration {
  /** The exported name: 'StubVault', 'StubDriver'. */
  readonly component: string;
  /** One line per control the component does not provide. Never empty. */
  readonly cannotEnforce: readonly string[];
}

export interface DeclaresUnsafe {
  readonly unsafe: UnsafeDeclaration;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * The component's declaration, or undefined when it carries none. An
 * `unsafe` property that is not a well-formed declaration is an error, not
 * an absence: a component that tries to declare and fails must not pass as
 * safe.
 */
export function declarationOf(slot: 'vault' | 'sandbox' | 'driver' | 'reviewer', component: object): UnsafeDeclaration | undefined {
  if (!('unsafe' in component)) return undefined;
  const unsafe: unknown = component.unsafe;
  if (typeof unsafe !== 'object' || unsafe === null || !('component' in unsafe) || !('cannotEnforce' in unsafe)) {
    throw new Error(`the ${slot} component carries an unsafe property that is not a declaration`);
  }
  const { component: name, cannotEnforce } = unsafe;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`the ${slot} component's unsafe declaration has no component name`);
  }
  if (!isStringArray(cannotEnforce) || cannotEnforce.length === 0) {
    throw new Error(`${name} (the ${slot} component) declares itself unsafe but names nothing it cannot enforce`);
  }
  return { component: name, cannotEnforce };
}

/**
 * Every declaration recorded when the graph was built, in the builder's order:
 * vault, sandbox, driver, reviewer. A graph `buildGraph` did not make is one
 * declaration, naming it unbuilt.
 */
export function unsafeComponents(graph: ComponentGraph): UnsafeDeclaration[] {
  return [...provenanceOf(graph)];
}
