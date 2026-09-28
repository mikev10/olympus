/**
 * The HTTP surface (P9): the run lifecycle over a real socket, the local
 * token, the worst-case cost a run above L0 must have approved, cancellation
 * of a run nothing is driving and of one being driven, and the event stream.
 */
import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { StubDriver, type PolicyDocument, type RunState, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import { StubSandboxProvider, type SandboxHandle, type SandboxSpec } from '@olympus-ai/sandbox';
import { createApiServer, egressFor, worstCaseCost, type ApiServer, type ComponentGraph, type CreatedRun, type RunView } from '../src/index.js';
import { ARTIFACTS, BASE_COMMIT, makeWorkspace, policy, policyDocument, removeWorkspace, roleScope, stubComponents, BUILDER, REVIEWER } from './harness.js';
import { DelegatingDriver, DelegatingSandbox } from './wrappers.js';

const TOKEN = 't'.repeat(40);
const PRINCIPAL = 'local-operator';

let workspace: string;
let components: ComponentGraph;
let server: ApiServer | undefined;
let url: string;

async function writePolicy(doc: PolicyDocument = policyDocument()): Promise<string> {
  const file = `${workspace}.policy.yaml`;
  // JSON is YAML: the loader reads it through the same hardened path.
  await writeFile(file, JSON.stringify(doc));
  return file;
}

async function serve(overrides: Partial<ComponentGraph> = {}, doc?: PolicyDocument): Promise<void> {
  components = { ...stubComponents(workspace), ...overrides };
  server = createApiServer({ components, token: TOKEN, principal: PRINCIPAL, policyFile: await writePolicy(doc) });
  url = await server.listen(0, '127.0.0.1');
}

async function call(method: string, path: string, body?: unknown, token: string | null = TOKEN): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${url}${path}`, body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const figure = worstCaseCost(
    { tasks: [
      { id: 'hello', station: 'build', role: BUILDER } as never,
      { id: 'hello-review', station: 'review', role: 'reviewer' } as never,
    ], edges: [] },
    policy(),
  ).usd;
  return { workspace, baseCommit: BASE_COMMIT, requestedLevel: 1, artifacts: ARTIFACTS, approvedCostUsd: figure, ...overrides };
}

/** Waits until the server has stopped driving the run, then returns what it serves. */
async function settled(runId: string): Promise<RunView> {
  for (let i = 0; i < 400; i += 1) {
    const res = await call('GET', `/runs/${runId}`);
    const view = res.body as RunView;
    if (!view.driving) return view;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error(`run ${runId} never settled`);
}

async function created(overrides: Record<string, unknown> = {}): Promise<CreatedRun> {
  const res = await call('POST', '/runs', createBody(overrides));
  expect(res.status).toBe(201);
  return res.body as CreatedRun;
}

beforeEach(async () => {
  workspace = await makeWorkspace('p9-server-');
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await removeWorkspace(workspace);
});

describe('the local token (I4)', () => {
  test('a request without the token, or with a wrong one, is refused with 401 and changes nothing', async () => {
    await serve();
    for (const token of [null, 'wrong', `${TOKEN}x`, TOKEN.slice(1)]) {
      const res = await call('POST', '/runs', createBody(), token);
      expect(res).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    }
    const probe = await call('GET', '/runs/anything', undefined, null);
    expect(probe.status).toBe(401);
  });

  test('a server is not constructed with a short token or no principal', () => {
    const base = { components: stubComponents(workspace), policyFile: 'x', principal: PRINCIPAL };
    expect(() => createApiServer({ ...base, token: 'short' })).toThrow(/at least 32/);
    expect(() => createApiServer({ ...base, token: TOKEN, principal: ' ' })).toThrow(/principal/);
  });
});

describe('the run lifecycle over HTTP', () => {
  test('create admits and drives; status derives where the run stands; approve records the principal and drives on to passed', async () => {
    await serve();
    const run = await created();
    expect(run.state.station).toBe('intake');
    const waiting = await settled(run.runId);
    expect(waiting.standing).toEqual({ standing: 'awaiting-approval', key: 'integrate:1' });
    expect(waiting.lastOutcome).toMatchObject({ kind: 'outcome', outcome: { ok: false, reason: 'refused', transition: { reason: 'approval-required' } } });

    // Who approved is the token's principal; a body that tries to say otherwise is refused.
    const claimed = await call('POST', `/runs/${run.runId}/approve`, { key: 'integrate:1', approvedBy: 'someone-else' });
    expect(claimed).toMatchObject({ status: 400, body: { error: 'bad-request' } });
    const approved = await call('POST', `/runs/${run.runId}/approve`, { key: 'integrate:1' });
    expect(approved.status).toBe(200);
    const done = await settled(run.runId);
    expect(done.standing).toEqual({ standing: 'passed' });
    expect(done.state.approvals).toEqual([expect.objectContaining({ key: 'integrate:1', approvedBy: PRINCIPAL })]);
    expect(done.lastOutcome).toMatchObject({ kind: 'outcome', outcome: { ok: true } });
  });

  test('an unknown run is 404; an unknown route is 404; a wrong method is 405; a body key the wire does not define is 400', async () => {
    await serve();
    expect((await call('GET', '/runs/nope')).status).toBe(404);
    expect((await call('GET', '/elsewhere')).status).toBe(404);
    expect((await call('GET', '/runs')).status).toBe(405);
    expect(await call('POST', '/runs', { ...createBody(), policy: {} })).toMatchObject({ status: 400, body: { message: 'unknown policy' } });
    expect(await call('POST', '/runs', { ...createBody(), workspace: 'relative' })).toMatchObject({ status: 400 });
  });

  test('a policy file the loader refuses refuses every create, naming why', async () => {
    await serve();
    await writeFile(`${workspace}.policy.yaml`, 'a: &x [1]\nb: *x\n');
    const res = await call('POST', '/runs', createBody());
    expect(res).toMatchObject({ status: 422, body: { error: 'refused', refusal: { ok: false, code: 'alias' } } });
  });
});

describe('the worst-case cost, approved before a run starts (D-P9-03)', () => {
  test('above L0, a create without the exact figure is refused with the figure, and nothing is recorded', async () => {
    await serve();
    for (const approvedCostUsd of [null, 0, 11.99, 12.01, 1e9]) {
      const res = await call('POST', '/runs', createBody({ approvedCostUsd }));
      expect(res).toMatchObject({
        status: 422,
        body: { refusal: { reason: 'cost-unapproved', approvedCostUsd, worstCase: { usd: 12, calls: 12 } } },
      });
    }
  });

  test('at L0 no figure is needed', async () => {
    await serve();
    const run = await created({ requestedLevel: 0, approvedCostUsd: null });
    expect((await settled(run.runId)).standing).toEqual({ standing: 'awaiting-approval', key: 'integrate:0' });
  });
});

/** A driver that holds its first call until the test lets it go. */
class HeldDriver extends DelegatingDriver {
  release: () => void = () => undefined;
  readonly entered: Promise<void>;
  private enter: () => void = () => undefined;
  private readonly gate: Promise<void>;

  constructor() {
    super(new StubDriver());
    this.entered = new Promise((done) => { this.enter = done; });
    this.gate = new Promise((done) => { this.release = done; });
  }

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    this.enter();
    await this.gate;
    return this.inner.runTask(req);
  }
}

describe('cancel (A-P9-01)', () => {
  test('a run nothing is driving is cancelled by the principal; status reads it back, and a later approve cannot carry it on', async () => {
    await serve();
    const run = await created();
    await settled(run.runId);
    const res = await call('POST', `/runs/${run.runId}/cancel`);
    expect(res.status).toBe(200);
    const view = res.body as RunView;
    expect(view.state.cancelled).toEqual({ by: PRINCIPAL, at: expect.any(String) as unknown });
    expect(view.standing).toMatchObject({ standing: 'stopped', refusal: { reason: 'cancelled', cancelledBy: PRINCIPAL } });
    expect((await call('GET', `/runs/${run.runId}`)).body).toMatchObject({ state: { cancelled: { by: PRINCIPAL } } });
    expect((await call('POST', `/runs/${run.runId}/approve`, { key: 'integrate:1' })).status).toBe(409);
  });

  test('cancelling a finished run is refused, not a success that changes nothing', async () => {
    await serve();
    const run = await created();
    await settled(run.runId);
    const ap = await call('POST', `/runs/${run.runId}/approve`, { key: 'integrate:1' });
    const st = await settled(run.runId);
    expect(ap.status).toBe(200);
    expect(st.standing).toEqual({ standing: 'passed' });
    // Read again, nothing driving: a passed run stays passed, and its spent grant is not asked for twice.
    expect(((await call('GET', `/runs/${run.runId}`)).body as RunView).standing).toEqual({ standing: 'passed' });
    expect((await call('POST', `/runs/${run.runId}/approve`, { key: 'integrate:1' })).status).toBe(409);
    const res = await call('POST', `/runs/${run.runId}/cancel`);
    expect(res).toMatchObject({ status: 409, body: { error: 'refused', refusal: { reason: 'finished' } } });
    expect(((await call('GET', `/runs/${run.runId}`)).body as RunView).state.cancelled).toBeNull();
    // Cancelled once, a second cancel is refused the same way.
    const second = await created();
    await settled(second.runId);
    expect((await call('POST', `/runs/${second.runId}/cancel`)).status).toBe(200);
    expect((await call('POST', `/runs/${second.runId}/cancel`)).status).toBe(409);
  });

  test('a run being driven is cancelled by the line between steps, and the call in flight keeps its usage record (D-P9-04)', async () => {
    const driver = new HeldDriver();
    await serve({ driver });
    const run = await created();
    await driver.entered;
    const cancelling = call('POST', `/runs/${run.runId}/cancel`);
    await new Promise((done) => setTimeout(done, 50));
    driver.release();
    const res = await cancelling;
    expect(res.status).toBe(200);
    const view = res.body as RunView;
    expect(view.state.cancelled).toMatchObject({ by: PRINCIPAL });
    expect(view.state.usage).toHaveLength(1);
    expect(view.state.results).toHaveProperty('hello');
    expect(view.lastOutcome).toMatchObject({ kind: 'outcome', outcome: { reason: 'refused', transition: { reason: 'cancelled' } } });
  });
});

describe('the event stream', () => {
  test('streams every committed state of a drive, then the standing, then how the drive ended; all of it data', async () => {
    const driver = new HeldDriver();
    await serve({ driver });
    const run = await created();
    await driver.entered;
    const res = await fetch(`${url}/runs/${run.runId}/events`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    driver.release();
    const text = await res.text();
    const events = text.trim().split('\n\n').map((block) => {
      const [name = '', data = ''] = block.split('\n');
      return { event: name.replace('event: ', ''), data: JSON.parse(data.replace('data: ', '')) as unknown };
    });
    expect(events[0]?.event).toBe('state');
    expect(events.at(-2)).toEqual({ event: 'standing', data: { standing: 'awaiting-approval', key: 'integrate:1' } });
    expect(events.at(-1)).toMatchObject({ event: 'end', data: { kind: 'outcome' } });
    const versions = events.filter((e) => e.event === 'state').map((e) => Number((e.data as RunState).version));
    expect(versions.length).toBeGreaterThan(3);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });

  test('a stream opened on a run nothing is driving sends its state, its standing, and the end, then closes', async () => {
    await serve();
    const run = await created();
    await settled(run.runId);
    const text = await (await fetch(`${url}/runs/${run.runId}/events`, { headers: { authorization: `Bearer ${TOKEN}` } })).text();
    expect(text.split('\n\n').filter((b) => b !== '').map((b) => b.split('\n')[0])).toEqual(['event: state', 'event: standing', 'event: end']);
  });
});

class RecordingSandbox extends DelegatingSandbox {
  readonly specs: SandboxSpec[] = [];

  override provision(spec: SandboxSpec): Promise<SandboxHandle> {
    this.specs.push(spec);
    return this.inner.provision(spec);
  }
}

describe('egress follows the grant (D-P9-05)', () => {
  test('a role granting no hosts gets a deny-all sandbox, never an empty allowlist the provider refuses', async () => {
    expect(egressFor({ egress: [] })).toEqual({ mode: 'deny-all', allow: [] });
    expect(egressFor({ egress: 'none' })).toEqual({ mode: 'deny-all', allow: [] });
    expect(egressFor({ egress: ['api.example.com'] })).toEqual({ mode: 'allowlist', allow: ['api.example.com'] });

    const sandbox = new RecordingSandbox(new StubSandboxProvider());
    const doc = policyDocument({ roles: { [BUILDER]: { ...roleScope('builder'), network: { egress: [] } }, [REVIEWER]: roleScope('reviewer') } });
    await serve({ sandbox }, doc);
    const run = await created();
    await settled(run.runId);
    expect(sandbox.specs.length).toBeGreaterThan(0);
    for (const spec of sandbox.specs) expect(spec.egress).toEqual({ mode: 'deny-all', allow: [] });
  });
});

