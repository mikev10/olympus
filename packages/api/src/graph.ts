/**
 * The one place a component graph is built (D-A-I1-05).
 *
 * Provenance is read here, as the graph is built, and never again from the
 * components: `startRun` and `resumeRun` take only a graph this function
 * returned, and read the declarations it recorded. A graph changed after it
 * was built is a different object, carries no record, and is refused above
 * L1 as unbuilt.
 *
 * Provenance is positive (D-I1a-06). A component is safe only when it is an
 * instance of the real component for its slot — `LocalVault`,
 * `LocalDockerProvider`, `ClaudeCodeDriver` — and declares nothing. One that
 * declares itself unsafe is named by its declaration; any other is named
 * unattested. So a wrapper that does not forward a stub's declaration fails
 * closed: it is not the real component either, and it is refused above L1
 * whether or not it was built before the graph was. A `Proxy` around a real
 * component is still that component, and passes.
 */
import { ClaudeCodeDriver } from '@olympus-ai/driver-claude-code';
import { LocalDockerProvider } from '@olympus-ai/sandbox';
import type { SandboxSpec } from '@olympus-ai/sandbox';
import { LocalVault } from '@olympus-ai/vault';
import type { ComponentGraph } from './run.js';

import { GitHubIntegrator, type Integrator } from './integrate.js';
import { declarationOf, type UnsafeDeclaration } from './safety.js';

/**
 * What every sandbox the line provisions runs on and within (D-I1a-01). The
 * wall clock is not here: a build sandbox's is its scope's budget, a check
 * sandbox's is the check's timeout.
 */
export interface SandboxProfile {
  /** The image a driver task runs in: one that holds the driver's CLI. */
  readonly buildImage: string;
  /** The image a verification check runs in: one that runs the stack's tools. */
  readonly checkImage: string;
  readonly limits: Readonly<Omit<SandboxSpec['limits'], 'wallClockMs'>>;
}

export interface GraphParts extends ComponentGraph {
  /** Required with `LocalDockerProvider`, which refuses a sandbox with no image or limits. */
  readonly profile?: SandboxProfile | null;
}

declare const BUILT: unique symbol;

/** A graph `buildGraph` made. The brand makes an unbuilt graph a compile error; the record makes one a runtime refusal. */
export type BuiltGraph = ComponentGraph & {
  readonly profile: SandboxProfile | null;
  readonly integrator: Integrator | null;
  readonly [BUILT]: true;
};

const provenance = new WeakMap<object, readonly UnsafeDeclaration[]>();

type Slot = 'vault' | 'sandbox' | 'driver' | 'reviewer';

/** The real component each slot attests, by its exported name. */
const REAL: Readonly<Record<Slot, { readonly name: string; readonly is: (c: object) => boolean }>> = {
  vault: { name: 'LocalVault', is: (c) => c instanceof LocalVault },
  sandbox: { name: 'LocalDockerProvider', is: (c) => c instanceof LocalDockerProvider },
  driver: { name: 'ClaudeCodeDriver', is: (c) => c instanceof ClaudeCodeDriver },
  reviewer: { name: 'ClaudeCodeDriver', is: (c) => c instanceof ClaudeCodeDriver },
};

/** The declaration a slot's component carries, or the one the builder gives a component it cannot attest; undefined when it is real. */
function attest(slot: Slot, component: object): UnsafeDeclaration | undefined {
  const declared = declarationOf(slot, component);
  if (declared !== undefined) return declared;
  const real = REAL[slot];
  if (!real.is(component)) {
    return {
      component: `unattested ${slot}`,
      cannotEnforce: [
        `the ${slot} is not a ${real.name}, the ${slot} the graph builder can attest; a component it cannot attest may be a wrapper that dropped a stub's declaration, so no run on it goes above L1 (D-I1a-06)`,
      ],
    };
  }
  return undefined;
}

/** A driver whose calls go through no relay is unmetered, so it carries no run above L1 (A-I1a-02). */
function relayless(slot: 'driver' | 'reviewer', driver: ComponentGraph['driver']): UnsafeDeclaration | undefined {
  if (driver.relayRequest() !== null) return undefined;
  return {
    component: `${slot} ${driver.id}`,
    cannotEnforce: [`the ${slot} names no model relay, so what its calls cost is unmetered and no budget bounds them (A-I1a-02)`],
  };
}

/**
 * A graph that cannot merge carries no run above L1: at L2 the runtime merges
 * after the integrate approval, and nothing else may (D-I1b-05). Only a
 * `GitHubIntegrator` is attested, as only the real components are.
 */
function unmerged(integrator: object | null): UnsafeDeclaration | undefined {
  if (integrator === null) {
    return { component: 'no integrator', cannotEnforce: ['the graph has no integrator, so a passed run cannot be merged by the runtime; a human merges it, so no run on it goes above L1 (D-I1b-05)'] };
  }
  if (integrator instanceof GitHubIntegrator) return undefined;
  return {
    component: 'unattested integrator',
    cannotEnforce: ['the integrator is not a GitHubIntegrator, the integrator the graph builder can attest, so what it merges and with which credential is unknown (D-I1b-05)'],
  };
}

/**
 * Builds the graph, reading every component's provenance as it does. Order of
 * the declarations: vault, sandbox, driver, reviewer. A reviewer that is the
 * driver itself is read once.
 */
export function buildGraph(parts: GraphParts): BuiltGraph {
  const { profile, ...components } = parts;
  if ((profile ?? null) === null && components.sandbox instanceof LocalDockerProvider) {
    throw new Error('buildGraph: a LocalDockerProvider needs a sandbox profile; it refuses a sandbox with no image or limits (D-I1a-01)');
  }
  const declarations: UnsafeDeclaration[] = [];
  const slots = [['vault', components.vault], ['sandbox', components.sandbox], ['driver', components.driver], ['reviewer', components.reviewer]] as const;
  for (const [slot, component] of slots) {
    if (slot === 'reviewer' && component === components.driver) continue;
    const declared = attest(slot, component);
    if (declared !== undefined) {
      declarations.push(declared);
      continue;
    }
    if (slot === 'driver' || slot === 'reviewer') {
      const unmetered = relayless(slot, components[slot]);
      if (unmetered !== undefined) declarations.push(unmetered);
    }
  }
  const merger = unmerged(components.integrator ?? null);
  if (merger !== undefined) declarations.push(merger);
  const graph = Object.freeze({ ...components, integrator: components.integrator ?? null, profile: profile ?? null }) as BuiltGraph;
  provenance.set(graph, Object.freeze(declarations));
  return graph;
}

/** The declaration an unbuilt graph is refused under: nothing read its components when it was assembled. */
const UNBUILT: UnsafeDeclaration = {
  component: 'unbuilt graph',
  cannotEnforce: ['the component graph was not made by buildGraph, so no component in it was attested when it was assembled (D-A-I1-05)'],
};

/** Whether `buildGraph` made this graph. */
export function isBuilt(graph: ComponentGraph): graph is BuiltGraph {
  return provenance.has(graph);
}

/** Every declaration recorded when the graph was built; an unbuilt graph is one declaration of its own. */
export function provenanceOf(graph: ComponentGraph): readonly UnsafeDeclaration[] {
  return provenance.get(graph) ?? [UNBUILT];
}
