/**
 * `integrate`'s merge, its credential, and the per-run report (I1b).
 *
 * The line runs over the real filesystem Vault, the stub sandbox, and a stub
 * driver, as the other line assertions do, with a real `GitHubIntegrator`
 * pointed at a GitHub server held in process (`kit/fake-github.ts`), so the
 * merge path runs whole with no network and no model. The one assertion that
 * needs Docker provisions real sandboxes under every egress policy the line
 * grants and tries the remote from each.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraphParts, RunOutcome } from '@olympus-ai/api';
import type { Policy, RoleId, VaultRef } from '@olympus-ai/core';
import type { MeterReading, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { IntegrationRecord } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import { withFakeGitHub, type FakeGitHub } from '../kit/fake-github.js';
import { HELLO_TASK, linePolicy, refusalOf, stubDriver, withLine, type LineRig } from './line.js';
import { specFor, throughProxy, withProvider, withSandbox } from './local-sandbox.js';
import { inTask, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');

const TOKEN = 'ghp_conformance-token-never-in-a-sandbox';
const REPORT_TOKEN = 'conformance-report-token-of-32-characters-or-more';

/** What every sandbox in the report scenario reads: 300 of 500 input tokens from the cache. */
const REPORT_METER: MeterReading = { kind: 'metered', calls: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 300, cacheWriteTokens: 100, costUsd: 0.002, exhausted: 'none', refused: 0 };

/** What the build task adds: one file, so the run has a change to merge. */
const FEATURE = { 'src/feature.ts': 'export const feature = 1;\n' };

interface Integrating {
  readonly rig: LineRig;
  readonly github: FakeGitHub;
  readonly baseCommit: string;
  /** Every spec the stub sandbox was asked to provision. */
  readonly specs: SandboxSpec[];
  /** A fresh graph over the same store, with an integrator against `github`, as a new process would open it. */
  components(overrides?: Partial<GraphParts>): ReturnType<LineRig['components']>;
}

/** The hello fixture, seeded as the remote's base commit, with a build task that adds `FEATURE`. */
/** `meter`, when given, is what every sandbox reads at its destroy. */
async function withIntegration<T>(prefix: string, body: (it: Integrating) => Promise<T>, meter?: MeterReading): Promise<T> {
  return withLine(prefix, async (rig) =>
    withFakeGitHub(rig.dirs.artifacts, { token: TOKEN }, async (github, baseCommit) => {
      const { GitHubIntegrator } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const specs: SandboxSpec[] = [];
      const components: Integrating['components'] = async (overrides = {}) => {
        const inner = new StubSandboxProvider();
        const sandbox: SandboxProvider = Object.assign(Object.create(inner) as SandboxProvider, {
          ...(meter === undefined ? {} : { destroy: async (handle: Parameters<SandboxProvider['destroy']>[0]) => ({ ...(await inner.destroy(handle)), meter }) }),
          provision: (spec: SandboxSpec) => {
            specs.push(spec);
            return inner.provision(spec);
          },
        });
        const driver = await stubDriver({
          during: async (req) => {
            if (req.taskId === HELLO_TASK) await inTask(sandbox, req, writes(FEATURE));
          },
        });
        const integrator = new GitHubIntegrator({ repository: github.repository, baseBranch: github.baseBranch, token: TOKEN, apiBase: github.apiBase });
        return rig.components({ sandbox, driver, reviewer: driver, integrator, ...overrides });
      };
      return body({ rig, github, baseCommit, specs, components });
    }),
  );
}

async function integrationOf(rig: LineRig): Promise<IntegrationRecord[]> {
  const { readIntegration } = await api();
  const { LocalVault } = await import('@olympus-ai/vault');
  return readIntegration(new LocalVault(rig.dirs), rig.runId);
}

/** Drives to the integrate approval, approves it, and resumes. */
async function approveAndResume(it: Integrating): Promise<RunOutcome> {
  const { approveStation, resumeRun } = await api();
  const components = await it.components();
  const approved = await approveStation({ runId: it.rig.runId, key: 'integrate:1', approvedBy: 'conformance', vault: components.vault });
  if (!approved.ok) throw new Error(`the integrate approval was refused: ${approved.message}`);
  return resumeRun({ runId: it.rig.runId, components: await it.components() });
}

async function toApproval(it: Integrating): Promise<void> {
  const { startRun } = await api();
  const waiting = refusalOf(await startRun(await it.rig.request(await it.components(), { baseCommit: it.baseCommit })), 'integrate');
  if (waiting.at !== 'integrate' || waiting.transition.reason !== 'approval-required') {
    throw new Error(`the run did not reach the integrate approval (${waiting.at}, ${waiting.transition.reason}); the control is broken`);
  }
}

export const INTEGRATE_MERGES_THE_VERIFIED_TREE = runtime({
  id: 'I5.integrate-merges-the-verified-tree-after-the-gate',
  title:
    "integrate pushes the run's accepted change and opens its pull request before the exit, merges only after a human approved the exit, and what merges is the base commit with exactly the verified diff; the merge is recorded in the Vault, and a resume after it neither opens nor merges again",
  run: async () => {
    await withIntegration('i1b-merge-', async (it) => {
      const { runStanding } = await api();
      const branch = `factory/${it.rig.runId}`;
      await toApproval(it);
      // Opened, not merged: the approver sees what will merge, and the base has not moved.
      const pulls = it.github.pulls();
      if (pulls.length !== 1 || pulls[0]?.headRef !== branch || pulls[0].merged) throw new Error(`I5: the integrate approval was reached with pull requests ${JSON.stringify(pulls)}, not one open at ${branch}`);
      if (it.github.head(it.github.baseBranch) !== it.baseCommit) throw new Error('I5: the base branch moved before the integrate approval');
      const opened = await integrationOf(it.rig);
      if (opened.length !== 1 || opened[0]?.kind !== 'opened') throw new Error(`I5: the Vault holds ${JSON.stringify(opened.map((r) => r.kind))} at the approval, not one opened record`);
      const pushed = it.github.head(branch);
      if (it.github.parents(pushed).join() !== it.baseCommit) throw new Error('I5: the pushed commit is not built on the base commit');

      const outcome = await approveAndResume(it);
      if (!outcome.ok) throw new Error(`I5: the approved run did not pass: ${JSON.stringify(outcome)}`);
      const merged = it.github.pulls()[0];
      if (merged?.merged !== true || merged.mergeCommit === null) throw new Error('I5: the approved run passed without its pull request merged');
      if (it.github.head(it.github.baseBranch) !== merged.mergeCommit) throw new Error('I5: the base branch is not at the merge');

      // What merged is base plus the verified diff, and nothing else.
      const before = it.github.files(it.baseCommit);
      const after = it.github.files(merged.mergeCommit);
      const added = [...after.keys()].filter((p) => !before.has(p));
      const changed = [...before.keys()].filter((p) => Buffer.compare(Buffer.from(before.get(p)?.bytes ?? []), Buffer.from(after.get(p)?.bytes ?? [])) !== 0);
      if (added.join() !== 'src/feature.ts' || changed.length !== 0) throw new Error(`I5: the merge added ${added.join(', ')} and changed ${changed.join(', ')}, not exactly the verified diff`);
      if (new TextDecoder().decode(after.get('src/feature.ts')?.bytes) !== FEATURE['src/feature.ts']) throw new Error('I5: the merged file is not the bytes the checks ran over');

      const records = await integrationOf(it.rig);
      const record = records.find((r) => r.kind === 'merged');
      if (record?.kind !== 'merged' || record.mergeCommit !== merged.mergeCommit || record.commit !== pushed) throw new Error('I5: the Vault does not record the merge GitHub made');
      const { LocalVault } = await import('@olympus-ai/vault');
      if ((await runStanding(new LocalVault(it.rig.dirs), it.rig.runId)).standing.standing !== 'passed') throw new Error('I5: a merged run does not stand passed');

      // A resume of the finished run touches the remote no further.
      const writes = it.github.requests.filter((r) => r.method !== 'GET').length;
      const { resumeRun } = await api();
      await resumeRun({ runId: it.rig.runId, components: await it.components() });
      if (it.github.requests.filter((r) => r.method !== 'GET').length !== writes || it.github.pulls().length !== 1) throw new Error('I5: a resume of a merged run wrote to the remote again');
    });

    // A stop between the merge and its record: the grant is still unspent, and the resume records the merge GitHub made rather than making another.
    await withIntegration('i1b-merge-lost-', async (it) => {
      const { approveStation, resumeRun } = await api();
      await toApproval(it);
      const components = await it.components();
      const approved = await approveStation({ runId: it.rig.runId, key: 'integrate:1', approvedBy: 'conformance', vault: components.vault });
      if (!approved.ok) throw new Error('I5 control: the integrate approval was refused');
      const real = await it.components();
      const recordIntegration = async (r: IntegrationRecord): Promise<VaultRef> => (r.kind === 'merged' ? Promise.reject(new Error('stopped before the merge was recorded')) : real.vault.recordIntegration(r));
      const losing = new Proxy(real.vault, {
        get: (target, key) => {
          if (key === 'recordIntegration') return recordIntegration;
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
      let stopped = false;
      try {
        await resumeRun({ runId: it.rig.runId, components: await it.components({ vault: losing }) });
      } catch {
        stopped = true;
      }
      if (!stopped || it.github.pulls()[0]?.merged !== true) throw new Error('I5 control: the merge was not made before the stop');
      const outcome = await resumeRun({ runId: it.rig.runId, components: await it.components() });
      if (!outcome.ok) throw new Error(`I5: a resume after a merge whose record was lost did not pass: ${JSON.stringify(outcome)}`);
      const merges = it.github.requests.filter((r) => r.method === 'PUT').length;
      const record = (await integrationOf(it.rig)).find((r) => r.kind === 'merged');
      if (merges !== 1 || record?.kind !== 'merged' || record.mergeCommit !== it.github.pulls()[0]?.mergeCommit) {
        throw new Error(`I5: the resume made ${String(merges)} merge requests, or recorded a merge other than the one made`);
      }
    });
  },
});

export const FAILED_INTEGRATION_NEVER_REPORTS_DONE = runtime({
  id: 'I5.failed-integration-never-reports-done',
  title:
    "a merge GitHub refuses, a base branch that moved after the run was verified, an accepted empty change, and a base commit that is not the base the run was built over each stop the run at integrate with nothing merged; none stands passed",
  run: async () => {
    const { runStanding } = await api();
    const { LocalVault } = await import('@olympus-ai/vault');
    const notPassed = async (it: Integrating, context: string): Promise<void> => {
      if (it.github.pulls().some((p) => p.merged)) throw new Error(`I5: ${context}: a pull request was merged`);
      if ((await integrationOf(it.rig)).some((r) => r.kind === 'merged')) throw new Error(`I5: ${context}: the Vault records a merge`);
      if ((await runStanding(new LocalVault(it.rig.dirs), it.rig.runId)).standing.standing === 'passed') throw new Error(`I5: ${context}: the run stands passed`);
    };
    const rejects = async (work: Promise<unknown>, pattern: RegExp, context: string): Promise<void> => {
      let threw: unknown;
      try {
        await work;
      } catch (error) {
        threw = error;
      }
      if (!(threw instanceof Error) || !pattern.test(threw.message)) throw new Error(`I5: ${context} did not stop the run at integrate: ${String(threw)}`);
    };

    await withIntegration('i1b-refused-', async (it) => {
      await toApproval(it);
      it.github.failMerge = true;
      await rejects(approveAndResume(it), /did not merge|405/u, 'a merge GitHub refused');
      await notPassed(it, 'a merge GitHub refused');
    });

    await withIntegration('i1b-moved-', async (it) => {
      await toApproval(it);
      it.github.moveBase();
      await rejects(approveAndResume(it), /moved/u, 'a base branch moved after verification');
      await notPassed(it, 'a moved base');
    });

    await withIntegration('i1b-empty-', async (it) => {
      // A build that writes nothing: no pull request to open, so the run halts at integrate's work, before a human is asked to approve a merge of nothing.
      const { startRun } = await api();
      const idle = await stubDriver();
      await rejects(
        (async () => startRun(await it.rig.request(await it.components({ driver: idle, reviewer: idle }), { baseCommit: it.baseCommit })))(),
        /accepted no change/u,
        'an accepted empty change',
      );
      if (it.github.pulls().length !== 0) throw new Error('I5: a pull request was opened for an empty change');
      await notPassed(it, 'an accepted empty change');
    });

    await withIntegration('i1b-drift-', async (it) => {
      // The working copy the run is admitted from differs from the commit it names.
      await writeFile(join(it.rig.dirs.artifacts, 'spec.md'), '# hello\n\nNot what the base commit holds.\n');
      const { startRun } = await api();
      await rejects(
        (async () => startRun(await it.rig.request(await it.components(), { baseCommit: it.baseCommit })))(),
        /not the base the run was verified over/u,
        'a base commit that is not the admitted base',
      );
      if (it.github.hasBranch(`factory/${it.rig.runId}`)) throw new Error('I5: a branch was pushed over a base that is not the verified one');
      await notPassed(it, 'a drifted base');
    });
  },
});

/** Every file under `dir`, read as text. */
async function allText(dir: string): Promise<string> {
  let out = '';
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out += await readFile(join(entry.parentPath, entry.name), 'utf8').catch(() => '');
  }
  return out;
}

export const MERGE_TOKEN_REACHES_NO_SANDBOX = runtime({
  id: 'I4.merge-credential-reaches-no-sandbox',
  title:
    "the token that pushes and merges is held by the host's integrator alone: no sandbox the line provisions, no task request, and no Vault record carries it; and admission refuses a policy whose egress allowlist names a host the remote is reached on",
  run: async () => {
    await withIntegration('i1b-token-', async (it) => {
      await toApproval(it);
      const outcome = await approveAndResume(it);
      if (!outcome.ok) throw new Error('I4 control: the run did not merge');
      if (!it.github.requests.every((r) => r.authorization === `Bearer ${TOKEN}`)) throw new Error('I4 control: a request reached the remote without the token');
      if (it.specs.length === 0) throw new Error('I4 control: no sandbox was provisioned');
      if (JSON.stringify(it.specs).includes(TOKEN)) throw new Error('I4: a sandbox spec carries the merge token');
      if ((await allText(it.rig.dirs.store)).includes(TOKEN)) throw new Error('I4: the Vault holds the merge token');
    });

    await withIntegration('i1b-egress-', async (it) => {
      const { startRun } = await api();
      const base = await linePolicy();
      for (const host of ['github.com', 'api.github.com', 'codeload.github.com', 'objects.githubusercontent.com']) {
        const builder = base.roles['builder' as RoleId];
        if (builder === undefined) throw new Error('I4 control: the line policy has no builder');
        const policy: Policy = { ...base, roles: { ...base.roles, ['builder' as RoleId]: { ...builder, network: { egress: ['registry.npmjs.org', host] } } } };
        const outcome = await startRun(await it.rig.request(await it.components(), { baseCommit: it.baseCommit, policy }));
        if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'reaches-git-remote')) {
          throw new Error(`I4: a policy granting egress to ${host} was not refused for reaching the git remote: ${JSON.stringify(outcome)}`);
        }
      }
      // The control: the same grant without the remote is admitted.
      const builder = base.roles['builder' as RoleId];
      if (builder === undefined) throw new Error('I4 control: the line policy has no builder');
      const allowed: Policy = { ...base, roles: { ...base.roles, ['builder' as RoleId]: { ...builder, network: { egress: ['registry.npmjs.org'] } } } };
      const admitted = await startRun(await it.rig.request(await it.components(), { baseCommit: it.baseCommit, policy: allowed }));
      if (!admitted.ok && admitted.reason === 'invalid-request') throw new Error(`I4 control: a grant that does not reach the remote was refused: ${JSON.stringify(admitted.problems)}`);
    });
  },
});

export const GIT_REMOTE_UNREACHABLE_FROM_EVERY_SANDBOX = runtime({
  id: 'I4.git-remote-unreachable-from-every-sandbox',
  title:
    "a real sandbox under each egress policy the line grants — the checks' deny-all, and an allowlist an admitted policy grants a role — cannot reach github.com or api.github.com: deny-all has no interface but loopback, and the allowlist's proxy refuses each remote host by name",
  run: async () => {
    const { egressFor } = await api();
    await withProvider('i1b-remote-', async (provider, dirs) => {
      const remote = ['github.com', 'api.github.com'];
      // The checks' sandbox, and a role scope that names no hosts.
      await withSandbox(provider, specFor(dirs, 'ro', { egress: egressFor({ egress: 'none' }) }), async (handle) => {
        const interfaces = (await provider.exec(handle, ['ls', '/sys/class/net'])).stdout.split(/\s+/u).filter((n) => n !== '');
        if (interfaces.join() !== 'lo') throw new Error(`I4: a deny-all sandbox has interfaces ${interfaces.join(', ')}, a route the remote could be reached by`);
        for (const host of remote) {
          const tried = await provider.exec(handle, ['sh', '-c', `wget -T 4 -O - https://${host}/ 2>&1; echo EXIT=$?`]);
          if (tried.stdout.includes('EXIT=0')) throw new Error(`I4: ${host} was reached from a deny-all sandbox`);
        }
      });
      // An allowlist an admitted policy grants a role: the remote is not on it, and its proxy says so.
      await withSandbox(provider, specFor(dirs, 'rw', { egress: egressFor({ egress: ['registry.npmjs.org'] }) }), async (handle) => {
        for (const host of remote) {
          const answer = await throughProxy(provider, handle, `CONNECT ${host}:443 HTTP/1.0`);
          if (!answer.includes('403') || !answer.includes(host)) throw new Error(`I4: the allowlist's proxy did not refuse ${host} by name: ${answer}`);
        }
      });
    });
  },
});

export const RUN_REPORT_READS_ONLY_RECORDS = runtime({
  id: 'I2.run-report-reads-only-records',
  title:
    "the per-run report is derived from the Vault alone: its cost is the totals of the usage records, each call names the model the runtime resolved, a claim the evidence contradicts appears as the bundle's mismatch, every gate and approval is the one P14 recorded, and the merge is the integration record; the API serves it and the CLI prints it",
  run: async () => {
    await withIntegration('i1b-report-', async (it) => {
      const { costTotals, readUsage, runReport } = await api();
      const { LocalVault } = await import('@olympus-ai/vault');
      // The stub driver claims no file changed while its task writes one: the runtime's diff of claim and evidence says so.
      await toApproval(it);
      const outcome = await approveAndResume(it);
      if (!outcome.ok) throw new Error('I2 control: the run did not pass');
      const vault = new LocalVault(it.rig.dirs);
      const report = await runReport(vault, it.rig.runId);
      const state = await vault.readRunState(it.rig.runId);
      const usage = await readUsage(vault, state);
      if (JSON.stringify(report.cost) !== JSON.stringify(costTotals(usage))) throw new Error('I2: the report cost is not the totals of the usage records');
      // The arithmetic, against figures computed here and not by the helper production calls: every call read REPORT_METER.
      const read = usage.filter((r) => r.reading.kind !== 'pending').length;
      const m = report.cost.run.metered;
      if (read === 0 || report.calls.length !== read) throw new Error(`I2 control: the report lists ${String(report.calls.length)} calls for ${String(read)} readings`);
      if (m.calls !== read || m.inputTokens !== 100 * read || m.outputTokens !== 10 * read || m.cacheReadTokens !== 300 * read || m.cacheWriteTokens !== 100 * read || Math.abs(m.costUsd - 0.002 * read) > 1e-12) {
        throw new Error(`I2: the report's metered totals are not ${String(read)} calls of the reading each made: ${JSON.stringify(m)}`);
      }
      if (report.cacheHitRate !== 0.6) throw new Error(`I2: the report's cache-hit rate is ${String(report.cacheHitRate)}, not 300 cached of 500 input tokens`);
      if (report.calls.length === 0 || report.calls.some((c) => typeof c.model.family !== 'string' || c.model.family === '')) throw new Error('I2: a call in the report names no model');
      if (report.standing.standing !== 'passed') throw new Error(`I2: the report says ${report.standing.standing} for a merged run`);
      const integrate = report.stations.find((s) => s.station === 'integrate');
      if (integrate?.gate !== 'passed' || integrate.approvals !== 1) throw new Error(`I2: the report's integrate gate is ${JSON.stringify(integrate)}, not passed on one approval`);
      if (report.decisions['approval-granted'] !== 1) throw new Error('I2: the report does not count the approval P14 recorded');
      const merge = report.integration.find((r) => r.kind === 'merged');
      if (merge?.kind !== 'merged' || merge.mergeCommit !== it.github.head(it.github.baseBranch)) throw new Error('I2: the report does not carry the merge the Vault records');
      const differences: string[] = [];
      for (const ref of state.evidenceRefs) differences.push(...(JSON.parse(new TextDecoder().decode(await vault.read(ref))) as { claimEvidenceDiff: string[] }).claimEvidenceDiff);
      if (differences.length === 0) throw new Error('I2 control: no bundle records a mismatch between claim and evidence');
      if (JSON.stringify(report.mismatches.flatMap((m) => m.differences)) !== JSON.stringify(differences)) throw new Error("I2: the report's mismatches are not the evidence bundles' own");

      // Served and printed: the API's report is the same object, and the CLI asks for it.
      const { createApiServer } = await api();
      const server = createApiServer({ components: await it.components(), token: REPORT_TOKEN, principal: 'conformance', policyFile: join(it.rig.dirs.artifacts, 'missing-policy.yaml') });
      const address = await server.listen(0, '127.0.0.1');
      try {
        const res = await fetch(`${address}/runs/${it.rig.runId}/report`, { headers: { authorization: `Bearer ${REPORT_TOKEN}` } });
        if (res.status !== 200) throw new Error(`I2: GET /runs/:id/report answered ${String(res.status)}`);
        const served = (await res.json()) as typeof report;
        if (JSON.stringify(served.cost) !== JSON.stringify(report.cost) || served.integration.length !== report.integration.length) throw new Error('I2: the served report is not the one derived from the Vault');
      } finally {
        await server.close();
      }
    }, REPORT_METER);

    // With no meter there is no input to rate: the cache-hit rate is null, not 0.
    await withIntegration('i1b-report-unmetered-', async (it) => {
      const { runReport } = await api();
      const { LocalVault } = await import('@olympus-ai/vault');
      await toApproval(it);
      if (!(await approveAndResume(it)).ok) throw new Error('I2 control: the unmetered run did not pass');
      const report = await runReport(new LocalVault(it.rig.dirs), it.rig.runId);
      if (report.cost.run.unmetered === 0) throw new Error('I2 control: the unmetered run recorded a metered call');
      if (report.cacheHitRate !== null) throw new Error(`I2: an unmetered run's cache-hit rate is ${String(report.cacheHitRate)}, not null`);
    });
  },
});
