/**
 * The I5 assertions the walking skeleton's own declaration stood in for until
 * I1a deleted it (D-P6-01, D-A-I1-05, D-I1a-06). Each runs a composition
 * above L1 through `startRun` or `admitRun`, so each would pass vacuously
 * while any blanket refusal stood, and each has a control showing the run it
 * refuses is one the line would otherwise admit.
 *
 * No model is called: every run here stops at admission.
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { BuiltGraph } from '@olympus-ai/api';
import type { Driver, TaskRequest } from '@olympus-ai/core';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_TASK, stubDriver, withLine, type LineRig } from './line.js';
import { refusalFrom } from './local-sandbox.js';
import { realComponents, realPolicy } from './real-line.js';

const api = async () => import('@olympus-ai/api');

/** A driver made by delegating every contract method, the way a logging or counting wrapper is, and carrying no `unsafe` of its own. */
function forgetful(inner: Driver): Driver {
  return {
    id: inner.id,
    contractVersion: inner.contractVersion,
    provenanceId: () => inner.provenanceId(),
    capabilities: () => inner.capabilities(),
    declaredTools: () => inner.declaredTools(),
    resolveModel: (tier) => inner.resolveModel(tier),
    relayRequest: () => inner.relayRequest(),
    runTask: (req) => inner.runTask(req),
    cancel: (taskId) => inner.cancel(taskId),
    emitArtifacts: (roles, dir) => inner.emitArtifacts(roles, dir),
    on: (kind, handler) => { inner.on(kind, handler); },
  };
}

/** Started at L2 on exactly `components`: the rig builds an unbuilt graph it is handed, so the request's graph is set after. */
async function refusedAsUnsafe(rig: LineRig, components: BuiltGraph, expected: string, context: string): Promise<void> {
  const { startRun } = await api();
  const req = await rig.request(await realComponents(rig), { requestedLevel: 2, policy: await realPolicy(2) });
  const outcome = await startRun({ ...req, components });
  if (outcome.ok || outcome.reason !== 'unsafe-above-l1') {
    throw new Error(`I5: ${context} was not refused as unsafe-above-l1 at L2 (got ${outcome.ok ? 'a completed run' : outcome.reason})`);
  }
  const names = outcome.unsafe.map((u) => u.component);
  if (!names.includes(expected)) throw new Error(`I5: ${context} was refused naming [${names.join(', ')}], not ${expected}`);
}

export const UNSAFE_DECLARATION_SURVIVES_COMPOSITION: LocalAssertion = runtime({
  id: 'I5.unsafe-declaration-survives-composition',
  title:
    'a stub wrapped without forwarding its declaration is refused above L1 whether it was wrapped before the graph was built (named unattested) or swapped into a graph after it (named unbuilt); the same real graph unwrapped is admitted at L2, so the refusal is the wrapper\'s',
  run: async () => {
    await withLine('i1a-compose-', async (rig) => {
      const { admitRun, buildGraph } = await api();
      const { StubDriver } = await import('@olympus-ai/core');
      const real = await realComponents(rig);

      // Before the build: the wrapper is all the builder sees, and it is not the real driver.
      const wrapped = forgetful(new StubDriver());
      await refusedAsUnsafe(rig, buildGraph({ ...real, driver: wrapped, reviewer: wrapped }), 'unattested driver', 'a stub driver wrapped before the build');
      // The rig's own scripted driver is such a wrapper; it fails closed too.
      const scripted = await stubDriver();
      await refusedAsUnsafe(rig, buildGraph({ ...real, driver: scripted, reviewer: scripted }), 'unattested driver', "the rig's scripted driver");
      // After the build: the graph the provenance was read for is not the graph handed in.
      await refusedAsUnsafe(rig, { ...real, driver: wrapped, reviewer: wrapped }, 'unbuilt graph', 'a stub driver swapped into a built graph');

      // The control: the real graph itself is admitted at L2.
      const admitted = await admitRun(await rig.request(real, { requestedLevel: 2, policy: await realPolicy(2) }));
      if (!admitted.ok) throw new Error(`I5: the real graph at L2 was refused (${admitted.reason}), so the refusals above prove nothing`);
    });
  },
});

export const ADAPTER_REFUSAL_REFUSES_L3_END_TO_END: LocalAssertion = runtime({
  id: 'I5.adapter-refusal-refuses-l3-end-to-end',
  title:
    "an L3 run started through startRun on the real composition is refused at admission as controls-unavailable, naming exactly the controls the base's adapter set lacks, mutation among them; nothing is driven",
  run: async () => {
    await withLine('i1a-l3-', async (rig) => {
      const { startRun } = await api();
      const adapters = await import('@olympus-ai/adapters');
      const outcome = await startRun(await rig.request(await realComponents(rig), { requestedLevel: 3, policy: await realPolicy(3) }));
      if (outcome.ok || outcome.reason !== 'controls-unavailable') {
        throw new Error(`I5: an L3 run on the real composition was not refused as controls-unavailable (got ${outcome.ok ? 'a completed run' : outcome.reason})`);
      }
      const set = await adapters.buildAdapterSet(rig.dirs.artifacts, { provider: null, coverage: null });
      const expected = [...new Set([...set.unavailableControls(), ...adapters.missingControls(set)])].sort();
      if (outcome.unavailable.join(',') !== expected.join(',')) {
        throw new Error(`I5: the L3 refusal named [${outcome.unavailable.join(', ')}]; the adapter set lacks [${expected.join(', ')}]`);
      }
      if (!outcome.unavailable.includes('mutation')) throw new Error('I5: the L3 refusal did not name mutation, which no M1 adapter set provides');
      const state = await rig.state().catch(() => null);
      if (state !== null && state.station !== 'intake') throw new Error(`I5: the refused L3 run was driven to ${state.station}`);
    });
  },
});

/** Where the hello fixture stops at L1 on the stubs, and what the approver is told there. */
async function integrateEscalations(rig: LineRig): Promise<readonly string[]> {
  const { startRun } = await api();
  const outcome = await startRun(await rig.request(await rig.components()));
  if (outcome.ok || outcome.reason !== 'refused' || outcome.at !== 'integrate' || outcome.transition.reason !== 'approval-required') {
    throw new Error(`I5: the hello fixture did not stop at the integrate approval (got ${outcome.ok ? 'a completed run' : outcome.reason})`);
  }
  return outcome.transition.escalations;
}

export const UNANALYSED_TESTS_ESCALATE_THE_APPROVAL: LocalAssertion = runtime({
  id: 'I5.unanalysed-tests-escalate-the-integrate-approval',
  title:
    "a repository with no vitest or jest reaches the integrate approval with the unanalysed suite named among its escalations, read from the admission record, so the approver is not shown an empty tamper report as a clean one; the same repository declaring vitest is not so named",
  run: async () => {
    const { UNANALYSED_TESTS } = await api();
    await withLine('i1a-untested-', async (rig) => {
      const escalations = await integrateEscalations(rig);
      if (!escalations.includes(UNANALYSED_TESTS)) throw new Error(`I5: a run with no test framework reached the integrate approval escalated by [${escalations.join('; ')}], not the unanalysed suite`);
    });
    // The control: the finding is the missing framework's, not every run's.
    await withLine('i1a-tested-', async (rig) => {
      await writeFile(join(rig.dirs.artifacts, 'package.json'), JSON.stringify({ name: 'hello', private: true, devDependencies: { vitest: '^4.1.0' } }));
      const escalations = await integrateEscalations(rig);
      if (escalations.includes(UNANALYSED_TESTS)) throw new Error('I5: a run whose repository declares vitest was escalated as having no test framework');
    });
  },
});

/** The composition with the line's real sandbox, a recording of every spec it was asked for, and a scripted driver whose task does `during`. */
async function composedAtL1(rig: LineRig, during: (sandbox: SandboxProvider, req: TaskRequest) => Promise<void>): Promise<{ components: BuiltGraph; real: BuiltGraph; specs: SandboxSpec[] }> {
  const { buildGraph } = await api();
  const real = await realComponents(rig);
  const specs: SandboxSpec[] = [];
  const recording: SandboxProvider = {
    id: real.sandbox.id,
    capabilities: () => real.sandbox.capabilities(),
    provision: (spec) => { specs.push(spec); return real.sandbox.provision(spec); },
    exec: (h, cmd, options) => real.sandbox.exec(h, cmd, options),
    destroy: (h) => real.sandbox.destroy(h),
  };
  const driver = await stubDriver({ during: (req) => (req.taskId === HELLO_TASK ? during(real.sandbox, req) : Promise.resolve()) });
  // Below L2, where a scripted driver and a recording wrapper are named and not refused; the Vault and the containers are real.
  // No integrator: at L1 a human merges (D-I1b-05), and a task that writes nothing halts at an integrator's open (D-I1b-04).
  return { components: buildGraph({ ...real, sandbox: recording, driver, reviewer: driver, integrator: null }), real, specs };
}

export const COMPOSED_HOST_MOUNTS_NO_VAULT: LocalAssertion = runtime({
  id: 'I1.composed-host-mounts-no-vault',
  title:
    "a run on the composed line, in real containers, provisions no sandbox that mounts the Vault's store or the repository it resolves locked paths against, and a sandbox that asks to mount the store is refused by the mount layer",
  run: async () => {
    await withLine('i1a-no-vault-', async (rig) => {
      const { startRun } = await api();
      const { components, real, specs } = await composedAtL1(rig, async () => Promise.resolve());
      const outcome = await startRun(await rig.request(components));
      if (outcome.ok || outcome.reason !== 'refused' || outcome.at !== 'integrate') throw new Error(`I1: the composed run did not reach the integrate approval (got ${outcome.ok ? 'a completed run' : outcome.reason})`);
      if (specs.length < 3) throw new Error(`I1: the composed run provisioned ${String(specs.length)} sandboxes; a build, a check, and a review were expected`);
      const vaultRoots = [rig.dirs.store, rig.dirs.artifacts].map((p) => resolve(p));
      for (const spec of specs) {
        const sources = [spec.mounts.workspace.source, ...spec.mounts.others.map((m) => m.source)].map((p) => resolve(p));
        const reached = sources.filter((source) => vaultRoots.some((root) => source === root || source.startsWith(`${root}${sep}`) || root.startsWith(`${source}${sep}`)));
        if (reached.length > 0) throw new Error(`I1: a sandbox on the composed line mounted ${reached.join(', ')}`);
      }
      const first = specs[0];
      if (first === undefined) throw new Error('I1: unreachable');
      const refusal = await refusalFrom(() => real.sandbox.provision({ ...first, mounts: { workspace: { ...first.mounts.workspace, source: rig.dirs.store }, others: [] } }));
      if (refusal.layer !== 'mount') throw new Error(`I1: a sandbox mounting the Vault's store was refused at ${refusal.layer}, not the mount layer: ${refusal.message}`);
    });
  },
});

export const COMPOSED_HOST_LOCKED_TEST_CHANGE_FAILS: LocalAssertion = runtime({
  id: 'I3.composed-host-locked-test-change-fails',
  title:
    'a build task on the composed line that rewrites the locked acceptance test inside its real container fails the run: it never reaches the integrate approval, and the change is recorded against it',
  run: async () => {
    await withLine('i1a-locked-', async (rig) => {
      const { startRun } = await api();
      const { components } = await composedAtL1(rig, async (sandbox, req) => {
        const result = await sandbox.exec(req.sandbox, ['sh', '-c', "printf '# rewritten by the task\n- nothing is required\n' > /workspace/acceptance.md"]);
        if (result.exitCode !== 0) throw new Error(`the task could not write its workspace: ${result.stderr}`);
      });
      const outcome = await startRun(await rig.request(components));
      if (outcome.ok) throw new Error('I3: a run whose task rewrote the locked acceptance test completed');
      if (outcome.reason === 'refused' && outcome.at === 'integrate') throw new Error('I3: a run whose task rewrote the locked acceptance test reached the integrate approval');
      const state = await rig.state();
      if (state.violations.length === 0) throw new Error(`I3: the rewrite of a locked test recorded no violation (the run ended ${outcome.reason})`);
    });
  },
});
