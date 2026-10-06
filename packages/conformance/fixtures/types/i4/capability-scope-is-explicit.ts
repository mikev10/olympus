// I4: a role's scope must state every grant. No field is optional, so an
// omitted grant is a compile error rather than a silent default, and egress
// is either none or an explicit list.
import type { CapabilityScope } from '@olympus-ai/core';

declare const scope: CapabilityScope;

export const withoutTools: CapabilityScope = { // expect-error TS2741: Property 'tools' is missing
  stations: scope.stations,
  writableGlobs: scope.writableGlobs,
  network: scope.network,
  tier: scope.tier,
  tierByStation: scope.tierByStation,
  escalation: scope.escalation,
  autonomyCeiling: scope.autonomyCeiling,
  triggerKinds: scope.triggerKinds,
  budget: scope.budget,
};

export const withoutStations: CapabilityScope = { // expect-error TS2741: Property 'stations' is missing
  writableGlobs: scope.writableGlobs,
  tools: scope.tools,
  network: scope.network,
  tier: scope.tier,
  tierByStation: scope.tierByStation,
  escalation: scope.escalation,
  autonomyCeiling: scope.autonomyCeiling,
  triggerKinds: scope.triggerKinds,
  budget: scope.budget,
};

export const allEgress: CapabilityScope = { ...scope, network: { egress: 'all' } }; // expect-error TS2322: Type '"all"' is not assignable
export const anyEgress: CapabilityScope = { ...scope, network: { egress: '*' } }; // expect-error TS2322: Type '"*"' is not assignable
export const noEgress: CapabilityScope = { ...scope, network: { egress: 'none' } };
export const listedEgress: CapabilityScope = { ...scope, network: { egress: ['registry.npmjs.org'] } };

// Escalation is a grant the scope states, never one its absence implies (A-R14-01).
export const withoutEscalation: CapabilityScope = { // expect-error TS2741: Property 'escalation' is missing
  stations: scope.stations,
  writableGlobs: scope.writableGlobs,
  tools: scope.tools,
  network: scope.network,
  tier: scope.tier,
  tierByStation: scope.tierByStation,
  autonomyCeiling: scope.autonomyCeiling,
  triggerKinds: scope.triggerKinds,
  budget: scope.budget,
};
export const unboundedEscalation: CapabilityScope = { ...scope, escalation: { afterFailedGates: 1 } }; // expect-error TS2322: Property 'ceiling' is missing
