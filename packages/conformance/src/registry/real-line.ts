/**
 * The composed line for assertions that need a run above L1: the real
 * components the host composes — `LocalVault`, `LocalDockerProvider`,
 * `ClaudeCodeDriver` — built through the graph builder over a line rig's
 * store, so admission attests every one of them (D-I1a-06).
 *
 * Nothing here calls a model. Admission makes no driver call, and every
 * assertion that uses this stops at admission or before the line drives; the
 * one scenario that needs a real call is paid and lives in `@olympus-ai/api`'s
 * paid suite (D-I1a-07). The credential the provider holds is a placeholder
 * no relay ever forwards, since no sandbox is asked for here.
 */
import type { BuiltGraph } from '@olympus-ai/api';
import type { AutonomyLevel, CapabilityScope, Policy, RoleId } from '@olympus-ai/core';
import { lineScope, linePolicy, type LineRig } from './line.js';

/** Real components over the rig's store. Needs a Docker daemon, as the sandbox assertions do. */
export async function realComponents(rig: LineRig): Promise<BuiltGraph> {
  const [{ buildGraph }, { LocalDockerProvider }, { LocalVault }, driverPackage] = await Promise.all([
    import('@olympus-ai/api'),
    import('@olympus-ai/sandbox'),
    import('@olympus-ai/vault'),
    import('@olympus-ai/driver-claude-code'),
  ]);
  const sandbox = await LocalDockerProvider.create({
    vaultPaths: [rig.dirs.store, rig.dirs.artifacts],
    credentials: { [driverPackage.MODEL_CREDENTIAL]: 'placeholder-never-forwarded' },
  });
  const driver = new driverPackage.ClaudeCodeDriver({ provider: sandbox });
  return buildGraph({
    vault: new LocalVault(rig.dirs),
    sandbox,
    driver,
    reviewer: driver,
    workspaces: rig.workspaces,
    profile: { buildImage: driverPackage.BASE_IMAGE, checkImage: driverPackage.BASE_IMAGE, limits: { cpus: 1, memoryMb: 512, pids: 128 } },
  });
}

/** A role the real driver can serve: its tools named as the driver's inventory names them. */
function realScope(stations: CapabilityScope['stations'], tier: CapabilityScope['tier'], level: AutonomyLevel): CapabilityScope {
  return { ...lineScope(stations, tier), tools: ['Read'], autonomyCeiling: level };
}

/** The rig's policy, opened to `level` everywhere a cap could hold a run below it, so what refuses is what the assertion names. */
export async function realPolicy(level: AutonomyLevel): Promise<Policy> {
  const base = await linePolicy();
  return linePolicy({}, {
    globalCap: level,
    roles: { ['builder' as RoleId]: realScope(['build', 'verify'], 'standard', level), ['reviewer' as RoleId]: realScope(['review'], 'deep', level) },
    triggers: { ...base.triggers, maxAutonomy: { human: level } },
  });
}
