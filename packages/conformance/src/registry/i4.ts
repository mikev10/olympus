import { compileError, external, pending, runtime } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { APPROVAL_OUTCOME_GATES_THE_STATION } from './line-assertions.js';
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
    runtime({
      id: 'I4.egress-entry-names-one-host',
      title:
        'an egress host list carrying a wildcard, a path, a prefix length, or whitespace is refused; a list of literal hosts is accepted, so the refusal is the entry being read and not the list being rejected',
      run: async () => {
        const { validatePolicyDocument } = await import('@olympus-ai/core');
        const document = grantingDocument();
        const scope = document.roles[GRANTED_ROLE];
        if (scope === undefined) throw new Error('I4: the fixture document defines no granted role');

        // Refusing the bare string 'all' while accepting ['*'] would leave the
        // authored form reading as an explicit allowlist while denoting every
        // host. Each of these denotes a set, or is not a host at all.
        for (const entry of ['*', '*.example.com', '0.0.0.0/0', '::/0', 'https://example.com', 'exa mple.com']) {
          const widened = { ...document, roles: { [GRANTED_ROLE]: { ...scope, network: { egress: [entry] } } } };
          const outcome = validatePolicyDocument(widened);
          if (outcome.ok) {
            throw new Error(
              `I4: a policy granting egress to ${JSON.stringify(entry)} was accepted. An egress list admits no ` +
                'wildcard, so an entry that denotes a set makes a restrictive-looking policy unrestricted.',
            );
          }
        }

        // The control: literal hosts are accepted, so the check above is the
        // entry being read rather than every list being refused.
        const literal = { ...document, roles: { [GRANTED_ROLE]: { ...scope, network: { egress: ['registry.npmjs.org', '192.0.2.10'] } } } };
        const accepted = validatePolicyDocument(literal);
        if (!accepted.ok) {
          throw new Error(`I4: a list of literal hosts was refused: ${accepted.defects.map((d) => d.problem).join('; ')}`);
        }
      },
    }),
    runtime({
      id: 'I4.role-lookup-ignores-the-prototype-chain',
      title:
        'a role the policy does not define is refused with capability-missing even when Object.prototype carries a scope-shaped value under that name, and a role named for a prototype member refuses rather than throwing; the resolved role map has no prototype',
      run: async () => {
        const { StrictPolicyEngine } = await import('@olympus-ai/core');
        const engine = new StrictPolicyEngine();
        const policy = engine.resolvePolicy(grantingDocument());
        const prototype = Object.prototype as Record<string, unknown>;

        if (Object.getPrototypeOf(policy.roles) !== null) {
          throw new Error('I4: the resolved role map has a prototype, so an undefined role can be answered by it');
        }

        // Pollution somewhere else in the process must not become a grant here.
        prototype[UNDEFINED_ROLE] = { stations: ['build'], tools: ['read'] };
        try {
          const outcome = engine.resolveCapabilities(UNDEFINED_ROLE, 'build', policy);
          if (outcome.ok) {
            throw new Error(
              `I4: role '${UNDEFINED_ROLE}' is defined nowhere in the policy and resolved to a grant because ` +
                'Object.prototype carried that name. Default deny has to be total, and a lookup that reads the ' +
                'prototype chain is not.',
            );
          }
          if (outcome.reason !== 'capability-missing') {
            throw new Error(`I4: the polluted role was refused as '${outcome.reason}'; expected 'capability-missing'`);
          }
          if (engine.resolveAutonomy(1, 'build', UNDEFINED_ROLE, policy).ok) {
            throw new Error('I4: resolveAutonomy granted a level to a role that exists only on Object.prototype');
          }
        } finally {
          Reflect.deleteProperty(prototype, UNDEFINED_ROLE);
        }

        // A role named for a prototype member must refuse, not throw: an
        // exception is not the refusal the contract promises, and a caller that
        // catches it has no reason recorded.
        for (const name of ['__proto__', 'constructor', 'toString', 'valueOf']) {
          const role = name as typeof UNDEFINED_ROLE;
          let refused: string;
          try {
            const outcome = engine.resolveCapabilities(role, 'build', policy);
            refused = outcome.ok ? 'granted' : outcome.reason;
          } catch {
            throw new Error(`I4: an ungranted role named '${name}' threw instead of refusing with capability-missing`);
          }
          if (refused !== 'capability-missing') {
            throw new Error(`I4: an ungranted role named '${name}' resolved as '${refused}'`);
          }
        }

        // The control: a real grant still resolves.
        if (!engine.resolveCapabilities(GRANTED_ROLE, 'build', policy).ok) {
          throw new Error('I4: the granted role was refused, so the guard is refusing everything');
        }
      },
    }),
    APPROVAL_OUTCOME_GATES_THE_STATION,
    external({
      id: 'I4.driver-tool-inventory-validated',
      title:
        'the CLI session offers exactly the tools the task granted and no wider set, every declared tool is one the CLI really has, '
        + 'and a grant outside the declaration is refused before the task starts',
      level: 'runtime',
      package: '@olympus-ai/driver-claude-code',
      file: 'test/invariants.test.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I4.task-capabilities-do-not-outlive-the-task',
      owner: 'P6',
      reason:
        'A sandbox is persistent by declaration (P2), and the driver serialises the foreground exec but not what a '
        + 'task leaves behind. Demonstrated during P5\'s external review: a process detached by one exec was still '
        + 'running when a later exec looked for it. A task granted Bash can therefore leave a process that keeps '
        + 'reading and writing the workspace, and reaching whatever the sandbox permits, while a later task holding a '
        + 'narrower grant runs beside it -- so the earlier task\'s capabilities are available during the later one, '
        + 'which is what default deny forbids. Bounding it means a process boundary the sandbox enforces or a '
        + 'container per task; a driver-side sweep would be a partial control that reads like a complete one. P6 '
        + 'collects a diff in a fresh sandbox and is where per-task isolation has to become real. Surfaced by P5.',
    }),
    pending({
      id: 'I4.model-credential-not-readable-by-the-task',
      owner: 'P12',
      reason:
        'The model credential reaches the CLI as an environment value on the exec, which keeps it out of every '
        + 'argument vector and off the mount table. It does not keep it from the model: the CLI and any tool the task '
        + 'runs share a user, so the value is readable from the process environment. Demonstrated during P5\'s '
        + 'external review -- a child printed it, and a later exec given no credential at all read it out of /proc. '
        + 'Closing it means the credential never enters the container: authentication at the egress layer the '
        + 'allowlist proxy already interposes (P10), with the sandbox holding a short-lived token or nothing at all. '
        + 'That spans the sandbox, the proxy and the driver, so it is neither a driver change nor a verification one: '
        + 'owned by P12, split out for it (D-P6-04). Surfaced by P5.',
    }),
    pending({
      id: 'I4.writable-globs-enforced-on-the-diff',
      owner: 'P6',
      reason:
        'A role\'s CapabilityScope.writableGlobs and the station\'s WriteBoundary.workspaceGlobs are carried into '
        + 'the run and enforced nowhere inside the workspace: the mount layer keeps an agent out of the Vault (I1) and '
        + 'the lock re-verification catches a write to a locked artifact (I3), but a build task that writes outside '
        + 'its globs, to a file nothing locked, is not refused. The only honest input is the diff the runtime '
        + 'collects itself; a driver\'s file-write events miss any write the driver does not observe, so checking '
        + 'them would read stronger than it is (D-P4-01). P6 collects base+diff in a fresh sandbox and must refuse a '
        + 'change outside the granted globs, and assert the refusal. Surfaced by P4.',
    }),
  ],
};
