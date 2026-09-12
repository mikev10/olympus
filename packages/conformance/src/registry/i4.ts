import { compileError, pending, runtime } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import {
  FORBIDDEN_STATION, GRANTED_ROLE, GRANTED_STATIONS, GRANTED_TOOLS,
  UNDEFINED_ROLE, UNGRANTED_TOOL, grantingDocument,
} from './policy.js';

/** I4: Default deny. */
export const I4: InvariantEntry = {
  title: INVARIANTS.I4,
  assertions: [
    compileError({
      id: 'I4.capability-scope-is-explicit',
      title: 'CapabilityScope requires every grant to be stated, and egress is none or an explicit list',
      fixture: 'i4/capability-scope-is-explicit.ts',
    }),
    compileError({
      id: 'I4.task-request-tools-are-required',
      title: 'TaskRequest cannot be built without the policy-granted tool list or the sandbox',
      fixture: 'i4/task-request-tools-are-required.ts',
    }),
    compileError({
      id: 'I4.compiled-role-carries-no-grants',
      title: 'CompiledRole has no field for tools, network, globs, or autonomy; policy is the only source of grants',
      fixture: 'i4/compiled-role-carries-no-grants.ts',
    }),
    compileError({
      id: 'I4.resolved-policy-is-total',
      title: 'Policy.approvals requires all forty station:level keys; only PolicyDocument may be sparse',
      fixture: 'i4/resolved-policy-is-total.ts',
    }),
    compileError({
      id: 'I4.tool-grant-requires-an-inventory',
      title:
        'validateToolGrants cannot be called without the driver tool inventory: the parameter has no default and is not optional, so there is no path that validates nothing',
      fixture: 'i4/tool-grant-requires-an-inventory.ts',
    }),
    runtime({
      id: 'I4.unlisted-capability-refused',
      title:
        'the real engine refuses a role the policy does not define (capability-missing) and a station outside a defined role scope (station-forbidden); a granted station returns exactly the stated scope, so the refusals are rules rather than an empty policy',
      run: async () => {
        const { StrictPolicyEngine } = await import('@olympus-ai/core');
        const engine = new StrictPolicyEngine();
        const policy = engine.resolvePolicy(grantingDocument());

        const undefinedRole = engine.resolveCapabilities(UNDEFINED_ROLE, 'build', policy);
        if (undefinedRole.ok) {
          throw new Error('I4: a role the policy does not define resolved to a capability scope');
        }
        if (undefinedRole.reason !== 'capability-missing') {
          throw new Error(`I4: an undefined role was refused as '${undefinedRole.reason}'; expected 'capability-missing'`);
        }

        const forbidden = engine.resolveCapabilities(GRANTED_ROLE, FORBIDDEN_STATION, policy);
        if (forbidden.ok) {
          throw new Error(`I4: role '${GRANTED_ROLE}' resolved a scope at '${FORBIDDEN_STATION}', which its policy does not list`);
        }
        if (forbidden.reason !== 'station-forbidden') {
          throw new Error(`I4: a station outside the role scope was refused as '${forbidden.reason}'; expected 'station-forbidden'`);
        }

        // The control: an engine that refuses everything would satisfy both
        // checks above while granting nothing, so a granted station must
        // resolve, and to exactly what the document states.
        for (const station of GRANTED_STATIONS) {
          const granted = engine.resolveCapabilities(GRANTED_ROLE, station, policy);
          if (!granted.ok) {
            throw new Error(`I4: role '${GRANTED_ROLE}' was refused at '${station}', which its policy grants (${granted.reason})`);
          }
          if (granted.scope.tools.join(',') !== GRANTED_TOOLS.join(',')) {
            throw new Error(`I4: the resolved scope at '${station}' carries tools [${granted.scope.tools.join(', ')}]; expected [${GRANTED_TOOLS.join(', ')}]`);
          }
          if (granted.scope.tools.includes(UNGRANTED_TOOL)) {
            throw new Error(`I4: the resolved scope carries '${UNGRANTED_TOOL}', which no role in the document grants`);
          }
          if (granted.scope.network.egress !== 'none') {
            throw new Error('I4: the resolved scope widened egress beyond what the document granted');
          }
        }

        // A grant is not a handle on the policy: widening what came back must
        // not widen what the next caller receives.
        const held = engine.resolveCapabilities(GRANTED_ROLE, 'build', policy);
        if (!held.ok) throw new Error('I4: the control resolution was refused');
        try {
          held.scope.tools.push(UNGRANTED_TOOL);
        } catch {
          // Frozen, which is the intended arrangement.
        }
        const next = engine.resolveCapabilities(GRANTED_ROLE, 'build', policy);
        if (!next.ok) throw new Error('I4: the second resolution was refused');
        if (next.scope.tools.includes(UNGRANTED_TOOL)) {
          throw new Error(`I4: mutating a resolved scope added '${UNGRANTED_TOOL}' to what the policy grants`);
        }
      },
    }),
    runtime({
      id: 'I4.omitted-approval-is-human-required',
      title:
        'resolvePolicy fills every approval the document omits with human-required and never auto, while carrying a stated approval through unchanged, so the filling is a default rather than a rewrite',
      run: async () => {
        const { APPROVAL_KEYS, AUTONOMY_LEVELS, STATION_IDS, StrictPolicyEngine } = await import('@olympus-ai/core');
        const engine = new StrictPolicyEngine();
        const document = grantingDocument();
        const stated = APPROVAL_KEYS.filter((key) => document.approvals[key] !== undefined);
        if (stated.length !== 1) {
          throw new Error(`I4: the fixture document must state exactly one approval for this assertion to mean anything; it states ${String(stated.length)}`);
        }
        const policy = engine.resolvePolicy(document);

        const expected = STATION_IDS.length * AUTONOMY_LEVELS.length;
        const keys = Object.keys(policy.approvals);
        if (keys.length !== expected) {
          throw new Error(`I4: the resolved policy carries ${String(keys.length)} approvals; the table must be total at ${String(expected)}`);
        }
        // Totality is proved by the count above; this loop is about what the
        // omitted keys were filled with.
        for (const key of APPROVAL_KEYS) {
          if (stated.includes(key)) continue;
          const outcome = policy.approvals[key];
          if (outcome !== 'human-required') {
            throw new Error(`I4: '${key}' was omitted by the document and resolved to '${outcome}'; an unconfigured approval must be human-required`);
          }
        }
        // The stated entry survives: a resolver that overwrote everything with
        // human-required would pass the loop above and be wrong.
        const [statedKey] = stated;
        if (statedKey === undefined) throw new Error('I4: the stated approval list has one entry and no entry in it');
        if (policy.approvals[statedKey] !== document.approvals[statedKey]) {
          throw new Error(`I4: the document stated '${statedKey}' and the resolved policy reports '${policy.approvals[statedKey]}'`);
        }
      },
    }),
    runtime({
      id: 'I4.empty-inventory-refuses-every-grant',
      title:
        'validateToolGrants against an empty inventory refuses every tool the policy grants, naming each with its role; an empty inventory is never read as allow-all',
      run: async () => {
        const { StrictPolicyEngine, validateToolGrants } = await import('@olympus-ai/core');
        const engine = new StrictPolicyEngine();
        const policy = engine.resolvePolicy(grantingDocument());

        const empty = validateToolGrants(policy, []);
        if (empty.ok) {
          throw new Error(`I4: an empty inventory admitted ${String(GRANTED_TOOLS.length)} granted tool(s); an inventory offering nothing grants nothing`);
        }
        if (empty.ungranted.length !== GRANTED_TOOLS.length) {
          throw new Error(`I4: an empty inventory named ${String(empty.ungranted.length)} ungranted tool(s); expected all ${String(GRANTED_TOOLS.length)}`);
        }
        for (const tool of GRANTED_TOOLS) {
          if (!empty.ungranted.some((u) => u.tool === tool && u.role === GRANTED_ROLE)) {
            throw new Error(`I4: '${tool}' was granted to '${GRANTED_ROLE}' and the refusal does not name the pair`);
          }
        }

        // The control: a full inventory passes, so the refusal above is the
        // inventory doing work rather than the function refusing always.
        const full = validateToolGrants(policy, [...GRANTED_TOOLS]);
        if (!full.ok) {
          throw new Error(`I4: an inventory covering every grant was still refused (${full.detail})`);
        }
        // And one short of the grants refuses exactly the missing one.
        const [first] = GRANTED_TOOLS;
        if (first === undefined) throw new Error('I4: the granted tool list is empty');
        const partial = validateToolGrants(policy, [first]);
        if (partial.ok) throw new Error('I4: an inventory missing a granted tool was accepted');
        if (partial.ungranted.length !== GRANTED_TOOLS.length - 1) {
          throw new Error(`I4: a partial inventory named ${String(partial.ungranted.length)} ungranted tool(s); expected ${String(GRANTED_TOOLS.length - 1)}`);
        }
      },
    }),
  ],
  pending: [
    pending({
      id: 'I4.driver-tool-inventory-validated',
      owner: 'P5',
      reason:
        'validateToolGrants takes the inventory of tools a driver offers as a mandatory argument, and nothing '
        + 'can yet produce a real one: DriverCapabilities holds feature flags and no tool list, so a policy can '
        + 'still grant a tool no driver exposes and only a hand-written inventory would notice. P5 owes the '
        + 'driver-side half — a Driver that declares its tools — and the assertion that a grant outside that '
        + `declaration is refused. Split from P3's half by D-P3-04; the F2 known gap records both.`,
    }),
  ],
};
