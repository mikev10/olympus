/**
 * R9: separation of duties across every seat. Each row of the matrix the unit
 * adds is one assertion here, and each fails when its check is deleted:
 *
 * - an author's identity — role, driver, and model — never reviews its change;
 * - the security seat's family is checked against every author's;
 * - the security seat is read-only and given its grants alone;
 * - each seat's identity is in run state;
 * - the local token reaches no sandbox.
 *
 * The rows R9 keeps rather than adds — a test drafter of the builder's family,
 * the review seat's grants, the merge credential — are asserted where they
 * were built (R19, P6, I1b).
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AutonomyLevel, ModelFamily, RoleId, RunState, SeatIdentity, TaskId, TaskRequest } from '@olympus-ai/core';
import type { SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { UsageRecord } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_REVIEW, HELLO_TASK, linePolicy, readArtifact, stubDriver, withLine, type ObservedDriver } from './line.js';
import { inTask, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

const SECURITY = `${HELLO_REVIEW}.security` as TaskId;

/** A seat's identity, as the line records one (A-R9-01). */
function seat(family: string, role: string, driver = 'conformance@1', model = 'm'): SeatIdentity {
  return { role: { id: role as RoleId, sha256: 'a'.repeat(64) }, driver, model: { provider: 'conformance', family: family as ModelFamily, model, version: '1' } };
}

/** A stub driver that names itself `id`, so two drivers of one family are told apart by the record. */
async function namedDriver(id: string, family?: string): Promise<ObservedDriver> {
  const inner = await stubDriver(family === undefined ? {} : { family });
  return Object.assign(inner, { provenanceId: () => id });
}

/** A stub sandbox that keeps every spec the line provisions. */
async function recordingSandbox(): Promise<{ sandbox: SandboxProvider; specs: SandboxSpec[] }> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  const inner = new StubSandboxProvider();
  const specs: SandboxSpec[] = [];
  const sandbox: SandboxProvider = Object.assign(Object.create(inner) as SandboxProvider, {
    provision: (spec: SandboxSpec) => {
      specs.push(spec);
      return inner.provision(spec);
    },
  });
  return { sandbox, specs };
}

function passedOrWaiting(state: RunState, context: string): void {
  if (state.tasks[HELLO_REVIEW] !== 'passed' || state.tasks[SECURITY] !== 'passed') {
    throw new Error(`${context} control: the review seat and the security seat did not both pass (${JSON.stringify(state.tasks)})`);
  }
}

export const AUTHOR_IDENTITY_NEVER_REVIEWS: LocalAssertion = runtime({
  id: 'I6.author-identity-never-reviews-its-change',
  title:
    "an identity that authored a change never reviews it, where identity is role, driver, and model, not family alone: admission refuses a graph whose build task names a reviewing role, and the seat refuses a reviewer whose identity is an author's, or whose role or driver was not recorded, at every level; another role on the same driver and model is graded, never refused (R9, D-R9-04)",
  run: async () => {
    const { seatReviewer } = await core();
    const authors = [seat('claude', 'builder')];
    for (const level of [0, 1, 2, 3] as AutonomyLevel[]) {
      let seated = true;
      try {
        seatReviewer('r' as TaskId, 'review', authors, seat('claude', 'builder'), level);
      } catch {
        seated = false;
      }
      if (seated) throw new Error(`I6: an author's own identity was seated as its reviewer at L${String(level)}`);
      for (const unrecorded of [{ ...seat('gpt', 'reviewer'), driver: null }, { ...seat('gpt', 'reviewer'), role: null }]) {
        let read = true;
        try {
          seatReviewer('r' as TaskId, 'security', authors, unrecorded, level);
        } catch {
          read = false;
        }
        if (read) throw new Error(`I6: a reviewer whose role or driver was not recorded was seated at L${String(level)}, read as different`);
      }
    }
    const control = seatReviewer('r' as TaskId, 'review', authors, seat('claude', 'reviewer'), 1);
    if (!control.ok || control.seat.independence !== 'same-model') throw new Error(`I6 control: another role on the same model was ${JSON.stringify(control)}`);

    for (const role of ['reviewer', 'security-reviewer']) {
      await withLine(`r9-i6-role-${role}-`, async (rig) => {
        const { startRun } = await api();
        await writeFile(join(rig.dirs.artifacts, 'graph.json'), JSON.stringify({
          tasks: [
            { id: HELLO_TASK, station: 'build', role, dependsOn: [], dependencySet: ['**'] },
            { id: HELLO_REVIEW, station: 'review', role: 'reviewer', dependsOn: [HELLO_TASK], dependencySet: ['**'] },
          ],
        }));
        const outcome = await startRun(await rig.request(await rig.components()));
        if (outcome.ok || outcome.reason !== 'invalid-request' || !outcome.problems.some((p) => p.code === 'reviewing-role')) {
          throw new Error(`I6: a build task under the ${role} role was not refused at admission: ${JSON.stringify(outcome)}`);
        }
      });
    }
  },
});

export const SECURITY_SEAT_FAMILY_CHECKED: LocalAssertion = runtime({
  id: 'I6.security-seat-family-checked-against-every-author',
  title:
    "beside every review task the graph names, the line seats a security reviewer, which no graph can name or omit, and checks its family against every author's as the reviewer's is checked: on the line a seat of the author's family records its reduced grade and one of another family records different-family, and at L3 a security seat sharing any author's family is refused (R9, D-R9-03)",
  run: async () => {
    const { parseGraph } = await api();
    const { seatReviewer } = await core();
    const bind = { runId: 'r9' as RunState['runId'], baseCommit: '0', workspace: '/w' };
    const graph = (tasks: unknown[]) => parseGraph({ tasks }, bind);
    const named = graph([
      { id: 'b', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] },
      { id: 'r', station: 'review', role: 'reviewer', dependsOn: ['b'], dependencySet: ['**'] },
    ]);
    if (!named.ok || !named.graph.tasks.some((t) => t.id === 'r.security' && t.station === 'review' && t.dependsOn.join() === 'b')) {
      throw new Error(`I6: a graph with one review task was not given a security seat beside it: ${JSON.stringify(named)}`);
    }
    const planted = graph([
      { id: 'b', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] },
      { id: 'r', station: 'review', role: 'reviewer', dependsOn: ['b'], dependencySet: ['**'] },
      { id: 'r.security', station: 'review', role: 'reviewer', dependsOn: ['b'], dependencySet: ['**'] },
    ]);
    if (planted.ok || !planted.problems.some((p) => p.code === 'reserved')) throw new Error('I6: a graph naming the security seat itself was admitted');

    const authors = [seat('claude', 'builder'), seat('gpt', 'builder', 'other@1')];
    const l3 = seatReviewer(SECURITY, 'security', authors, seat('gpt', 'security-reviewer'), 3);
    if (l3.ok || l3.reason !== 'same-family-reviewer') throw new Error(`I6: a security seat sharing an author's family at L3 was ${JSON.stringify(l3)}`);
    const l3Other = seatReviewer(SECURITY, 'security', authors, seat('gemini', 'security-reviewer'), 3);
    if (!l3Other.ok || l3Other.seat.kind !== 'security' || l3Other.seat.independence !== 'different-family') throw new Error('I6 control: a security seat of another family at L3 was not seated');

    for (const [family, independence] of [['stub', 'same-model'], ['other-family', 'different-family']] as const) {
      await withLine(`r9-i6-security-${independence}-`, async (rig) => {
        const { startRun } = await api();
        const author = await stubDriver();
        const reviewer = await stubDriver({ family });
        await startRun(await rig.request(await rig.components({ driver: author, reviewer })));
        const state = await rig.state();
        passedOrWaiting(state, 'I6');
        const security = state.reviews.find((s) => s.kind === 'security');
        if (security === undefined) throw new Error(`I6: no security seat was recorded among ${JSON.stringify(state.reviews)}`);
        if (security.task !== SECURITY || security.independence !== independence || security.reviewer.model.family !== family || !security.authors.every((a) => a.model.family === 'stub')) {
          throw new Error(`I6: a ${family} security reviewer of a stub author was recorded as ${JSON.stringify(security)}`);
        }
      });
    }
  },
});

export const SECURITY_SEAT_READS_ONLY_ITS_GRANTS: LocalAssertion = runtime({
  id: 'I4.security-seat-reads-only-its-grants',
  title:
    "the security seat runs under the security-reviewer role in a read-only sandbox holding what the review seat's holds but the acceptance tests, and is given the locked spec with its security part, the diff, and the evidence bundle, and nothing else: not the acceptance tests the review seat is given, the author's narrative, or the plan; and its contract is cut from the review contract, never added to (R9)",
  run: async () => {
    const { securitySeatContract, SECURITY_SEAT_GRANTS, STATION_CONTRACTS } = await core();
    const widened = { ...STATION_CONTRACTS.review, allowedContext: [...STATION_CONTRACTS.review.allowedContext, 'acceptance-tests', 'author-narrative', 'plan', 'conversation'] as const };
    const cut = securitySeatContract({ ...widened, allowedContext: [...widened.allowedContext] });
    if (!cut.allowedContext.every((g) => SECURITY_SEAT_GRANTS.includes(g)) || cut.writeBoundary.workspaceGlobs.length !== 0) {
      throw new Error(`I4: the security seat's contract was ${JSON.stringify(cut.allowedContext)} over a widened review contract`);
    }

    const SENTINEL = 'AUTHOR-NARRATIVE-SENTINEL: every test passes';
    await withLine('r9-i4-security-view-', async (rig) => {
      const { startRun } = await api();
      const { sandbox, specs } = await recordingSandbox();
      const probe = ['graph.json', 'verify.json', '.git/author-notes', 'spec.md', 'src/change.ts', 'acceptance.md'];
      const look = `const fs = require('node:fs'); console.log(JSON.stringify(${JSON.stringify(probe)}.map((p) => fs.existsSync(p))));`;
      const seen = new Map<string, string>();
      const author = await stubDriver({
        narrative: SENTINEL,
        during: async (req: TaskRequest) => {
          await inTask(sandbox, req, writes({ 'src/change.ts': 'changed', '.git/author-notes': 'the plan, as the author sees it' }));
        },
      });
      const reviewer = await stubDriver({
        family: 'other-family',
        during: async (req: TaskRequest) => {
          seen.set(req.taskId, (await inTask(sandbox, req, look)).trim());
        },
      });
      await startRun(await rig.request(await rig.components({ sandbox, driver: author, reviewer }), {}));
      passedOrWaiting(await rig.state(), 'I4');
      const req = reviewer.requests.find((r) => r.taskId === SECURITY);
      const review = reviewer.requests.find((r) => r.taskId === HELLO_REVIEW);
      if (req === undefined || review === undefined) throw new Error(`I4: the reviewer ran ${JSON.stringify(reviewer.requests.map((r) => r.taskId))}, not both seats`);
      if (req.role.role !== 'security-reviewer' || review.role.role !== 'reviewer') throw new Error(`I4: the seats ran under ${req.role.role} and ${review.role.role}`);
      const context = `${req.stablePrefix}\n${req.variableSuffix}`;
      const tests = (await readArtifact(rig.dirs, 'acceptance.md')).trim();
      if (!`${review.stablePrefix}\n${review.variableSuffix}`.includes(tests)) throw new Error('I4 control: the review seat was not given the acceptance tests');
      if (context.includes(tests) || context.includes('[acceptance-tests]')) throw new Error('I4: the security seat was given the acceptance tests');
      if (context.includes('AUTHOR-NARRATIVE-SENTINEL') || context.includes('[plan]')) throw new Error("I4: the security seat was given the author's narrative or the plan");
      for (const grant of ['[locked-spec]', '[diff]', '[evidence-bundle]']) if (!context.includes(grant)) throw new Error(`I4: the security seat was not given ${grant}`);
      if (!context.includes((await readArtifact(rig.dirs, 'security.json')).trim())) throw new Error("I4: the security seat was not given the spec's security part");
      // The seats differ by one file: the acceptance tests, which the review seat is granted and the security seat is not (codex-3).
      if (seen.get(SECURITY) !== '[false,false,false,true,true,false]' || seen.get(HELLO_REVIEW) !== '[false,false,false,true,true,true]') {
        throw new Error(`I4: the security seat's workspace held ${String(seen.get(SECURITY))}, the review seat's ${String(seen.get(HELLO_REVIEW))}`);
      }
      // Every writable sandbox is a build's: neither review seat was given one.
      const writable = specs.filter((s) => s.mounts.workspace.mode === 'rw').length;
      if (writable !== author.requests.length) throw new Error(`I4: ${String(writable)} writable sandboxes were provisioned for ${String(author.requests.length)} builds`);
    });
  },
});

export const SEAT_IDENTITY_IN_RUN_STATE: LocalAssertion = runtime({
  id: 'I2.each-seat-identity-is-in-run-state',
  title:
    "each seat's identity — the role admission pinned, the driver the runtime called, and the model — is in run state: every usage record run state references names its call's driver, and each review and security seat records its reviewer's and its authors' identities from those records, never from a driver's field; a seat committed before R9 is read as not recorded (A-R9-01)",
  run: async () => {
    await withLine('r9-i2-identity-', async (rig) => {
      const { startRun, readUsage } = await api();
      const author = await namedDriver('author-driver@1');
      const reviewer = await namedDriver('reviewer-driver@1', 'other-family');
      const components = await rig.components({ driver: author, reviewer });
      await startRun(await rig.request(components));
      const state = await rig.state();
      passedOrWaiting(state, 'I2');
      const calls: UsageRecord[] = await readUsage(components.vault, state);
      const expected = (r: UsageRecord): string => (r.station === 'build' ? 'author-driver@1' : 'reviewer-driver@1');
      const wrong = calls.filter((r) => r.driver !== expected(r));
      if (calls.length === 0 || wrong.length > 0) throw new Error(`I2: usage records name the drivers ${JSON.stringify(calls.map((r) => [r.taskId, r.driver]))}`);
      const pinned = new Map(calls.map((r) => [r.taskId as string, r.role]));
      for (const kind of ['review', 'security'] as const) {
        const s = state.reviews.find((x) => x.kind === kind);
        const role = kind === 'review' ? 'reviewer' : 'security-reviewer';
        if (s === undefined) throw new Error(`I2: no ${kind} seat is in run state`);
        if (s.reviewer.role?.id !== role || s.reviewer.role.sha256 !== pinned.get(s.task)?.sha256 || s.reviewer.driver !== 'reviewer-driver@1') {
          throw new Error(`I2: the ${kind} seat records its reviewer as ${JSON.stringify(s.reviewer)}`);
        }
        if (s.authors.length === 0 || !s.authors.every((a) => a.role?.id === 'builder' && a.role.sha256 === pinned.get(HELLO_TASK)?.sha256 && a.driver === 'author-driver@1')) {
          throw new Error(`I2: the ${kind} seat records its authors as ${JSON.stringify(s.authors)}`);
        }
      }
    });

    // A reviewer that resolves to another family and reports the author's model: the claim may lower
    // the grade, never write the record. The seat's reviewer is the model the runtime resolved (codex-1).
    await withLine('r9-i2-claimed-', async (rig) => {
      const { startRun } = await api();
      const author = await stubDriver();
      const reviewer = await stubDriver({ family: 'other-family' });
      const authorModel = author.resolveModel('standard');
      const run = reviewer.runTask.bind(reviewer);
      Object.assign(reviewer, { runTask: async (req: TaskRequest) => ({ ...(await run(req)), model: { ...authorModel } }) });
      await startRun(await rig.request(await rig.components({ driver: author, reviewer })));
      const state = await rig.state();
      for (const s of state.reviews) {
        if (s.reviewer.model.family !== 'other-family') throw new Error(`I2: the ${s.kind} seat records the model its reviewer reported, ${JSON.stringify(s.reviewer.model)}, not the one the runtime resolved`);
        if (s.independence === 'different-family') throw new Error(`I6: a reviewer reporting the author's model was graded ${s.independence}; the claim must still lower the grade`);
      }
      if (state.reviews.length !== 2) throw new Error(`I2 control: ${String(state.reviews.length)} seats were recorded`);
    });

    // A seat as a runtime before R9 committed it: model identities, no kind.
    await withLine('r9-i2-before-', async (rig) => {
      const { LocalVault } = await import('@olympus-ai/vault');
      await (await api()).startRun(await rig.request(await rig.components()));
      const state = await rig.state();
      const dir = join(rig.dirs.store, 'runs', rig.runId, 'state');
      const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
      const latest = files.at(-1);
      if (latest === undefined) throw new Error('I2 control: no state file was written');
      const model = { provider: 'p', family: 'claude', model: 'm', version: '1' };
      const body = JSON.parse(await readFile(join(dir, latest), 'utf8')) as Record<string, unknown>;
      await writeFile(join(dir, latest), JSON.stringify({ ...body, reviews: [{ task: HELLO_REVIEW, authors: [model], reviewer: model, independence: 'same-model' }] }));
      const read = (await new LocalVault(rig.dirs).readRunState(rig.runId)).reviews[0];
      if (read?.kind !== 'review' || read.reviewer.role !== null || read.reviewer.driver !== null || read.authors[0]?.driver !== null) {
        throw new Error(`I2: a seat committed before R9 was read as ${JSON.stringify(read)}, not as not recorded`);
      }
      if (state.reviews.some((s) => s.reviewer.driver === null)) throw new Error('I2 control: the line wrote a seat whose driver was not recorded');
    });
  },
});

const LOCAL_TOKEN = 'r9-local-token-never-in-a-sandbox-0123456789';

export const LOCAL_TOKEN_REACHES_NO_SANDBOX: LocalAssertion = runtime({
  id: 'I4.local-token-reaches-no-sandbox',
  title:
    "the local token an approval is made with is held by the API server alone: a run created and approved over HTTP passes, its approval is the token's principal, and no sandbox the line provisions, no task request, and no Vault record carries the token (R9, D-P9-06)",
  timeoutMs: 120_000,
  run: async () => {
    await withLine('r9-i4-token-', async (rig) => {
      const { createApiServer } = await api();
      const { sandbox, specs } = await recordingSandbox();
      const driver = await stubDriver();
      const reviewer = await stubDriver({ family: 'other-family' });
      const components = await rig.components({ sandbox, driver, reviewer });
      const policyFile = join(rig.dirs.artifacts, '..', 'policy.yaml');
      await writeFile(policyFile, JSON.stringify(await linePolicy()));
      const req = await rig.request(components);
      const server = createApiServer({ components, token: LOCAL_TOKEN, principal: 'r9-principal', policyFile, rolesDirectory: rig.roles });
      const address = await server.listen(0, '127.0.0.1');
      const headers = { authorization: `Bearer ${LOCAL_TOKEN}`, 'content-type': 'application/json' };
      const settled = async (runId: string): Promise<{ standing: { standing: string }; state: RunState }> => {
        for (let i = 0; i < 800; i += 1) {
          const view = (await (await fetch(`${address}/runs/${runId}`, { headers })).json()) as { driving: boolean; standing: { standing: string }; state: RunState };
          if (!view.driving) return view;
          await new Promise((done) => setTimeout(done, 25));
        }
        throw new Error(`I4 control: run ${runId} never settled`);
      };
      try {
        const body = { workspace: req.workspace, baseCommit: req.baseCommit, requestedLevel: req.requestedLevel, artifacts: req.artifacts, approvedCostUsd: req.approvedCostUsd };
        const created = await fetch(`${address}/runs`, { method: 'POST', headers, body: JSON.stringify(body) });
        if (created.status !== 201 && created.status !== 202 && created.status !== 200) throw new Error(`I4 control: create answered ${String(created.status)}: ${await created.text()}`);
        const { runId } = (await created.json()) as { runId: string };
        const waiting = await settled(runId);
        if (waiting.standing.standing !== 'awaiting-approval') throw new Error(`I4 control: the run stands ${JSON.stringify(waiting.standing)}`);
        const approved = await fetch(`${address}/runs/${runId}/approve`, { method: 'POST', headers, body: JSON.stringify({ key: 'integrate:1' }) });
        if (approved.status !== 200) throw new Error(`I4 control: approve answered ${String(approved.status)}`);
        const done = await settled(runId);
        if (done.standing.standing !== 'passed' || !done.state.approvals.some((g) => g.approvedBy === 'r9-principal')) {
          throw new Error(`I4 control: the run did not pass on the principal's approval: ${JSON.stringify(done.standing)}`);
        }
      } finally {
        await server.close();
      }
      if (specs.length === 0 || driver.requests.length === 0 || reviewer.requests.length === 0) throw new Error('I4 control: no sandbox was provisioned or no seat ran');
      if (JSON.stringify(specs).includes(LOCAL_TOKEN)) throw new Error('I4: a sandbox spec carries the local token');
      if (JSON.stringify([...driver.requests, ...reviewer.requests]).includes(LOCAL_TOKEN)) throw new Error('I4: a task request carries the local token');
      let stored = '';
      for (const entry of await readdir(rig.dirs.store, { recursive: true, withFileTypes: true })) {
        if (entry.isFile()) stored += await readFile(join(entry.parentPath, entry.name), 'utf8').catch(() => '');
      }
      if (stored.includes(LOCAL_TOKEN)) throw new Error('I4: the Vault holds the local token');
    });
  },
});
