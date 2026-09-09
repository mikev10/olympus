/**
 * I5 applied to the skeleton. A component that cannot enforce what its
 * contract implies declares that through a property on its own interface.
 * The runtime enumerates the declarations before a run starts and refuses
 * to carry a run above L1 while any exist, naming each one. Nothing in the
 * contracts changes: the declaration is a property a stub adds, and the
 * runtime's ComponentGraph is where it is read.
 *
 * `unsafeComponents` reads the property structurally (`'unsafe' in
 * component`), so a stub in vault, sandbox, or core needs no import from this
 * package to declare itself. The conformance fixture I5.stubs-declare-unsafe
 * is what pins each stub's property to this type.
 */
import type { ComponentGraph } from './run.js';

export interface UnsafeDeclaration {
  /** The exported name: 'StubVault', 'SkeletonLine'. */
  readonly component: string;
  /** One line per control the component does not provide. Never empty. */
  readonly cannotEnforce: readonly string[];
}

export interface DeclaresUnsafe {
  readonly unsafe: UnsafeDeclaration;
}

/**
 * The line's own declaration (S1 finding 3). If only the three
 * infrastructure stubs declared themselves, replacing them would lift the
 * L1 cap while the line still faked its half. Deleted by the unit that
 * replaces the line.
 */
export const SKELETON_LINE: DeclaresUnsafe = {
  unsafe: {
    component: 'SkeletonLine',
    cannotEnforce: [
      'no policy engine: the requested level is not resolved against a station or global cap, and no approval is evaluated',
      'no tamper analysis: GateResult.tamper is empty by construction, not because analysis found nothing',
      'no claim/evidence diff: EvidenceBundle.claimEvidenceDiff is empty by construction',
      'no station beyond spec, build, and verify: the run stops at verify, and review does not exist',
    ],
  },
};

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/**
 * The component's declaration, or undefined when it carries none. An
 * `unsafe` property that is not a well-formed declaration is an error, not
 * an absence: a component that tries to declare and fails must not pass as
 * safe.
 */
function declarationOf(slot: 'vault' | 'sandbox' | 'driver', component: object): UnsafeDeclaration | undefined {
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

/** Every declaration in the graph, plus the line's own. Order: vault, sandbox, driver, line. */
export function unsafeComponents(graph: ComponentGraph): UnsafeDeclaration[] {
  const declarations: UnsafeDeclaration[] = [];
  for (const [slot, component] of [['vault', graph.vault], ['sandbox', graph.sandbox], ['driver', graph.driver]] as const) {
    const declaration = declarationOf(slot, component);
    if (declaration !== undefined) declarations.push(declaration);
  }
  declarations.push(SKELETON_LINE.unsafe);
  return declarations;
}
