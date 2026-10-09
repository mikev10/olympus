/**
 * The assertions R1 owns, over `@olympus-ai/readiness`: that a readiness
 * ceiling only ever lowers (I4), that an indeterminate probe derives as an
 * absent one and a refusal names the term that bound it (I5), and that every
 * probe declared ceiling-bearing has an assertion that fails when the probe
 * is deleted (I8). The compile-error assertions read fixtures under
 * fixtures/types; the one that scans a repository needs a Docker daemon and
 * fails without one, for the reason `local-sandbox.ts` gives.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AutonomyLevel, Policy, RoleId, StationId } from '@olympus-ai/core';
import type { ProbeId, ProbeOutcome, ProbeResult, ReadinessCeiling, ScanOptions } from '@olympus-ai/readiness';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { compileError, runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { withProvider } from './local-sandbox.js';
import { BUILD_CAP, GRANTED_ROLE, ROLE_CEILING, grantingDocument } from './policy.js';

const run = promisify(execFile);
const readiness = () => import('@olympus-ai/readiness');
const LEVELS: readonly AutonomyLevel[] = [0, 1, 2, 3];
const OUTCOMES: readonly ProbeOutcome[] = ['supported', 'absent', 'indeterminate'];

/** A result the runtime would have built, with static evidence: derivation reads only the outcome. */
function result(probe: ProbeId, outcome: ProbeOutcome): ProbeResult {
  return {
    probe,
    pillar: 'testing',
    ceilingBearing: true,
    outcome,
    detail: `fixture: ${probe} ${outcome}`,
    evidence: { via: 'static', read: 'fixture' },
    collectedBy: 'runtime',
  };
}

/** Every assignment of an outcome to each probe, as result arrays. 3^n of them. */
function* permutations(probes: readonly ProbeId[]): Generator<ProbeResult[]> {
  const total = OUTCOMES.length ** probes.length;
  for (let n = 0; n < total; n++) {
    let rest = n;
    const out: ProbeResult[] = [];
    for (const probe of probes) {
      out.push(result(probe, OUTCOMES[rest % OUTCOMES.length] ?? 'absent'));
      rest = Math.floor(rest / OUTCOMES.length);
    }
    yield out;
  }
}

/** Every policy shape the attribution has to tell apart: each cap from L0 to L3, the station cap set or not. */
function policies(base: Policy): Policy[] {
  const out: Policy[] = [];
  const role = base.roles[GRANTED_ROLE];
  if (role === undefined) throw new Error('readiness fixture: the granting document lost its role');
  for (const globalCap of LEVELS) {
    for (const stationCap of [undefined, ...LEVELS]) {
      for (const autonomyCeiling of LEVELS) {
        out.push({
          ...base,
          globalCap,
          stationCaps: stationCap === undefined ? {} : { build: stationCap },
          roles: { ...base.roles, [GRANTED_ROLE]: { ...role, autonomyCeiling } },
        });
      }
    }
  }
  return out;
}

export const READINESS_OUTCOME_IS_RUNTIME_DERIVED: LocalAssertion = compileError({
  id: 'I2.readiness-outcome-is-runtime-derived',
  title:
    "ProbeResult and ReadinessReport carry collectedBy: 'runtime' and no other value, and no field of either can be written after it is built; an outcome labelled as a model's or a driver's does not typecheck. A shape check: the label is a literal any caller can write, so where an outcome came from rests on scan() being what builds it, not on this type",
  fixture: 'i2/readiness-outcome-is-runtime-derived.ts',
});

export const READINESS_NEVER_RAISES_A_CAP: LocalAssertion = runtime({
  id: 'I4.readiness-never-raises-a-cap',
  title:
    'over every outcome permutation of the ceiling-bearing probes the derived ceiling is L0-L2, never L3; and over every derived ceiling, policy cap, and requested level, the four-term resolver grants only what the policy engine alone grants, at the same level, and never above the readiness ceiling',
  run: async () => {
    const { CEILING_BEARING, deriveCeiling, resolveWithReadiness, NOT_SCANNED } = await readiness();
    const { StrictPolicyEngine } = await import('@olympus-ai/core');
    const engine = new StrictPolicyEngine();

    const ceilings = new Map<string, ReadinessCeiling>([['not-scanned', NOT_SCANNED]]);
    for (const results of permutations(CEILING_BEARING)) {
      const derived = deriveCeiling(results);
      if (!([0, 1, 2] as number[]).includes(derived.level)) {
        throw new Error(`I4: a scan derived L${String(derived.level)}; no scan may derive above L2`);
      }
      const key = `${String(derived.level)}:${derived.heldBy.kind === 'probe' ? derived.heldBy.probe : 'scan-limit'}`;
      if (!ceilings.has(key)) ceilings.set(key, { kind: 'scanned', ...derived, commit: 'fixture' });
    }
    if (![...ceilings.values()].some((c) => c.kind === 'scanned' && c.level === 2)) {
      throw new Error('I4 control: no permutation derived L2, so the derivation lowers everything and proves nothing');
    }

    const station: StationId = 'build';
    for (const policy of policies(engine.resolvePolicy(grantingDocument()))) {
      for (const requested of LEVELS) {
        const alone = engine.resolveAutonomy(requested, station, GRANTED_ROLE, policy);
        for (const ceiling of ceilings.values()) {
          const four = resolveWithReadiness(engine, requested, station, GRANTED_ROLE, policy, ceiling);
          if (!four.ok) continue;
          if (!alone.ok) {
            throw new Error(`I4: readiness granted L${String(requested)} the policy engine refused (${alone.detail})`);
          }
          if (four.level !== alone.level) {
            throw new Error(`I4: readiness changed a granted level from L${String(alone.level)} to L${String(four.level)}`);
          }
          if (ceiling.kind === 'scanned' && four.level > ceiling.level) {
            throw new Error(`I4: L${String(four.level)} was granted above a readiness ceiling of L${String(ceiling.level)}`);
          }
        }
        // An absent scan leaves the other three terms exactly as they were.
        const unscanned = resolveWithReadiness(engine, requested, station, GRANTED_ROLE, policy, NOT_SCANNED);
        if (unscanned.ok !== alone.ok || (unscanned.ok && alone.ok && unscanned.level !== alone.level)) {
          throw new Error(`I4: an unscanned repository resolved L${String(requested)} differently from the policy alone`);
        }
      }
    }
  },
});

export const ABSENT_SCAN_IS_NOT_A_PASS: LocalAssertion = compileError({
  id: 'I4.absent-scan-is-not-a-pass',
  title:
    "the readiness term is a required parameter with an explicit 'not-scanned' state: omitting it, passing undefined, or passing a possibly-absent report's ceiling does not typecheck, a level is unreachable before narrowing to a scan, and a scanned ceiling cannot carry L3",
  fixture: 'i4/absent-scan-is-not-a-pass.ts',
});

export const INDETERMINATE_PROBE_LOWERS: LocalAssertion = runtime({
  id: 'I5.indeterminate-probe-lowers',
  title:
    'for each ceiling-bearing probe and every outcome permutation of the others, the probe indeterminate derives exactly the ceiling and holding probe it derives absent, and never above what it derives supported',
  run: async () => {
    const { CEILING_BEARING, deriveCeiling } = await readiness();
    for (const probe of CEILING_BEARING) {
      const others = CEILING_BEARING.filter((p) => p !== probe);
      for (const rest of permutations(others)) {
        const indeterminate = deriveCeiling([...rest, result(probe, 'indeterminate')]);
        const absent = deriveCeiling([...rest, result(probe, 'absent')]);
        const supported = deriveCeiling([...rest, result(probe, 'supported')]);
        if (indeterminate.level !== absent.level || JSON.stringify(indeterminate.heldBy) !== JSON.stringify(absent.heldBy)) {
          throw new Error(
            `I5: ${probe} indeterminate derived L${String(indeterminate.level)} ${JSON.stringify(indeterminate.heldBy)}, ` +
            `absent derived L${String(absent.level)} ${JSON.stringify(absent.heldBy)}`,
          );
        }
        if (indeterminate.level > supported.level) {
          throw new Error(`I5: ${probe} indeterminate derived above the same probe supported`);
        }
      }
    }
    // A probe the results do not carry at all is not supported, and is named.
    const missing = deriveCeiling([]);
    if (missing.level !== 0 || missing.heldBy.kind !== 'probe') throw new Error('I5: an empty result set did not derive L0 naming a probe');
  },
});

/** A git repository holding `files` in one commit, under `root`. */
async function gitRepository(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const git = (...args: string[]) => run('git', ['-C', root, '-c', 'user.email=conformance@example.invalid', '-c', 'user.name=conformance', ...args]);
  await git('init', '--quiet', '--initial-branch=main');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'fixture');
}

/** Scan options over the conformance node image, with modest limits and no branch-protection checker. */
export async function scanOptions(provider: SandboxProvider, checkout: string): Promise<ScanOptions> {
  const { EGRESS_PROXY_IMAGE } = await import('@olympus-ai/sandbox');
  const { NPM_REGISTRY, SECRET_SCAN_IMAGE } = await readiness();
  return {
    checkout,
    revision: 'HEAD',
    provider,
    image: EGRESS_PROXY_IMAGE,
    secretScanImage: SECRET_SCAN_IMAGE,
    limits: { cpus: 1, memoryMb: 1024, pids: 256 },
    user: { uid: 0, gid: 0 },
    timeouts: { installMs: 300_000, probeMs: 120_000, coldProvisionMs: 60_000 },
    registries: NPM_REGISTRY,
    protectedPaths: ['.github/**', 'package.json'],
    branchProtection: null,
  };
}

export const UNSUPPORTED_STACK_REFUSES: LocalAssertion = runtime({
  id: 'I5.unsupported-stack-refuses',
  title:
    'a repository that builds clean but declares no supported test framework derives L0 held by testing.adapter, whose detail names the missing adapter, and enumeration is never reported supported over an empty suite (needs Docker)',
  run: async () => {
    const { scan } = await readiness();
    await withProvider('conformance-readiness-', async (provider, dirs) => {
      await gitRepository(dirs.readable, {
        'package.json': JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, scripts: { build: 'node -e "0"' }, devDependencies: {} }),
        'package-lock.json': JSON.stringify({
          name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
          packages: { '': { name: 'fixture', version: '1.0.0' } },
        }),
        'index.js': 'module.exports = 1;\n',
      });
      const report = await scan(await scanOptions(provider, dirs.readable));
      const outcome = (id: ProbeId) => report.probes.find((p) => p.probe === id);
      for (const id of ['build.pinned-manifest', 'build.install', 'build.clean'] as const) {
        if (outcome(id)?.outcome !== 'supported') {
          throw new Error(`I5 control: ${id} was ${outcome(id)?.outcome ?? 'missing'} (${outcome(id)?.detail ?? ''}), so the build did not isolate the adapter`);
        }
      }
      const { ceiling } = report;
      if (ceiling.level !== 0 || ceiling.heldBy.kind !== 'probe' || ceiling.heldBy.probe !== 'testing.adapter') {
        throw new Error(`I5: an unsupported stack derived L${String(ceiling.level)} held by ${JSON.stringify(ceiling.heldBy)}`);
      }
      const adapter = outcome('testing.adapter');
      if (adapter?.outcome !== 'absent' || !adapter.detail.includes('neither vitest nor jest')) {
        throw new Error(`I5: testing.adapter did not name the missing adapter: ${adapter?.detail ?? 'missing'}`);
      }
      if (outcome('testing.enumerate')?.outcome === 'supported') {
        throw new Error('I5: an unsupported stack reported its suite enumeration supported');
      }
    });
  },
});

export const REFUSAL_NAMES_THE_BOUNDING_TERM: LocalAssertion = runtime({
  id: 'I5.refusal-names-the-bounding-term',
  title:
    "a request refused by the readiness ceiling names readiness and its holding probe; one refused by the global cap, the station cap, or the role ceiling names that cap; one over several names each; none reports a bare 'exceeds-cap', and non-cap refusals pass through as the engine made them",
  run: async () => {
    const { resolveWithReadiness, NOT_SCANNED } = await readiness();
    const { StrictPolicyEngine } = await import('@olympus-ai/core');
    const engine = new StrictPolicyEngine();
    const base = engine.resolvePolicy(grantingDocument());
    const station: StationId = 'build';
    const held: ReadinessCeiling = { kind: 'scanned', level: 1, heldBy: { kind: 'probe', probe: 'testing.coverage' }, commit: 'abc123' };
    const terms = (policy: Policy, requested: AutonomyLevel, ceiling: ReadinessCeiling, role: RoleId = GRANTED_ROLE): string[] => {
      const resolved = resolveWithReadiness(engine, requested, station, role, policy, ceiling);
      if (resolved.ok) return [];
      if ((resolved.reason as string) === 'exceeds-cap') throw new Error(`I5: a refusal reported a bare exceeds-cap: ${resolved.detail}`);
      if (resolved.reason !== 'exceeds-bound') return [resolved.reason];
      return resolved.bounds.map((b) => b.term);
    };
    const expect = (label: string, got: string[], want: string[]) => {
      if (JSON.stringify([...got].sort()) !== JSON.stringify([...want].sort())) {
        throw new Error(`I5: ${label} named [${got.join(', ')}], expected [${want.join(', ')}]`);
      }
    };
    const loose: Policy = { ...base, globalCap: 3, stationCaps: {}, roles: { ...base.roles } };
    const role = loose.roles[GRANTED_ROLE];
    if (role === undefined) throw new Error('I5 fixture: the granting document lost its role');
    const open: Policy = { ...loose, roles: { ...loose.roles, [GRANTED_ROLE]: { ...role, autonomyCeiling: 3 } } };

    expect('readiness alone', terms(open, 2, held), ['readiness']);
    const resolved = resolveWithReadiness(engine, 2, station, GRANTED_ROLE, open, held);
    if (resolved.ok || resolved.reason !== 'exceeds-bound' || !resolved.detail.includes('testing.coverage')) {
      throw new Error('I5: a readiness refusal did not name the probe holding the ceiling');
    }
    expect('the global cap alone', terms({ ...open, globalCap: 1 }, 2, NOT_SCANNED), ['global-cap']);
    expect('the station cap alone', terms({ ...open, stationCaps: { build: BUILD_CAP } }, 2, NOT_SCANNED), ['station-cap']);
    expect('the role ceiling alone', terms({ ...open, roles: { ...open.roles, [GRANTED_ROLE]: { ...role, autonomyCeiling: 1 } } }, 2, NOT_SCANNED), ['role-ceiling']);
    expect('readiness and the global cap', terms({ ...open, globalCap: 1 }, 2, held), ['readiness', 'global-cap']);
    if (base.globalCap !== 3 || BUILD_CAP !== 1 || ROLE_CEILING !== 2) throw new Error('I5 fixture: the granting document no longer has caps L3, L1, L2');
    expect('every term below the request', terms(base, 3, held), ['readiness', 'station-cap', 'role-ceiling']);
    expect('within every bound', terms(open, 1, held), []);
    expect('a role the policy does not define', terms(open, 1, held, 'reviewer' as RoleId), ['capability-missing']);
  },
});

/**
 * One assertion per ceiling-bearing probe: with every other ceiling-bearing
 * probe supported and this one absent, the ceiling drops to the stated level
 * and names this probe. The keys are compared both ways with the package's
 * declared set, so deleting a probe, or one the derivation stops reading,
 * fails here.
 */
const PROBE_LOWERS_TO: Readonly<Record<string, AutonomyLevel>> = {
  'build.pinned-manifest': 0,
  'build.install': 0,
  'build.clean': 0,
  'testing.adapter': 0,
  'testing.enumerate': 0,
  'testing.green-at-base': 0,
  'testing.coverage': 1,
  'testing.tamper-analysis': 1,
  'integrate.protected-paths': 1,
  'integrate.secret-scan': 1,
  'integrate.branch-protection': 1,
};

export const CEILING_BEARING_PROBE_HAS_AN_ASSERTION: LocalAssertion = runtime({
  id: 'I8.ceiling-bearing-probe-has-an-assertion',
  title:
    'every probe the readiness package declares ceiling-bearing has an entry here and every entry is a declared ceiling-bearing probe; each one, absent while every other is supported, lowers the ceiling to its stated level and is named as the probe holding it',
  run: async () => {
    const { CEILING_BEARING, PROBES, deriveCeiling } = await readiness();
    const declared = new Set<string>(CEILING_BEARING);
    const asserted = new Set(Object.keys(PROBE_LOWERS_TO));
    const unasserted = [...declared].filter((id) => !asserted.has(id));
    const undeclared = [...asserted].filter((id) => !declared.has(id));
    if (unasserted.length > 0) throw new Error(`I8: ceiling-bearing probes with no assertion: ${unasserted.join(', ')}`);
    if (undeclared.length > 0) throw new Error(`I8: assertions for probes no longer declared ceiling-bearing: ${undeclared.join(', ')}`);
    if (new Set(PROBES.map((p) => p.id)).size !== PROBES.length) throw new Error('I8: a probe is declared twice');

    const all = CEILING_BEARING.map((id) => result(id, 'supported'));
    const top = deriveCeiling(all);
    if (top.level !== 2) throw new Error(`I8 control: every probe supported derived L${String(top.level)}, not L2`);
    for (const [probe, level] of Object.entries(PROBE_LOWERS_TO)) {
      const derived = deriveCeiling(all.map((r) => (r.probe === probe ? result(r.probe, 'absent') : r)));
      if (derived.level !== level || derived.heldBy.kind !== 'probe' || derived.heldBy.probe !== probe) {
        throw new Error(
          `I8: ${probe} absent derived L${String(derived.level)} held by ${JSON.stringify(derived.heldBy)}; ` +
          `expected L${String(level)} held by ${probe}`,
        );
      }
    }
  },
});
