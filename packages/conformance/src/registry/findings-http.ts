/**
 * R28: a person dismisses a finding, with a cause and no text. The runtime
 * lists every located finding and whether it is open; only a person's request,
 * carrying the local token, gives one an outcome, and a finding has one outcome
 * for good. The CLI is a client of that route and sends nothing else (I9).
 *
 * Each assertion drives the real HTTP server over a real filesystem Vault, and
 * the real CLI over an injected fetch.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { FindingSummary } from '@olympus-ai/api';
import type { ModelFamily, SeatIdentity } from '@olympus-ai/core';
import type { NightlyRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { drafting } from './drafting.js';
import { withLine } from './line.js';

const api = async () => import('@olympus-ai/api');
const core = async () => import('@olympus-ai/core');

const TOKEN = 'conformance-token-of-at-least-thirty-two-chars';
const NOTE = 'R28-DISMISSAL-NOTE-fixed-by-hand';

function seat(family: string): SeatIdentity {
  return { role: null, driver: 'scripted', model: { provider: family, family: family as ModelFamily, model: `${family}-model`, version: '1' } };
}

/** A nightly record whose reviewer seat raised one located tree finding, stored in `vault`. */
async function seedFinding(vault: Vault): Promise<void> {
  const { TREE_CATEGORIES } = await core();
  const category = TREE_CATEGORIES[0];
  const record: NightlyRecord = {
    schedule: 'conformance', template: 'nightly-tree-review', date: '2026-11-20',
    startedAt: '2026-11-20T02:00:00.000Z', endedAt: '2026-11-20T02:01:00.000Z',
    outcome: { kind: 'completed' }, findings: [], integrity: null, security: null, observation: null, collectedBy: 'runtime',
    review: {
      subject: null, role: null, usage: null, egress: null, claim: null,
      seat: { reviewer: seat('claude'), authors: [], independence: 'no-author', level: 1 },
      findings: [{ kind: 'tree', category, path: 'src/index.ts', line: 1, candidate: { none: 'budget' } }],
    },
  };
  await vault.recordNightly(record);
}

async function lookup(address: string, token: string | null, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${address}${path}`, body === undefined ? { method, headers } : { method, headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => null)) };
}

export const FINDING_DISMISSAL_IS_A_PERSONS: LocalAssertion = runtime({
  id: 'I2.finding-dismissal-is-a-persons',
  title:
    'GET /findings lists a located finding as open; POST /findings/:id/dismiss, with the token, records a dismissal with a cause from the closed set and no text, 404 for an id naming no finding, 409 for a second outcome; ' +
    'a body carrying text or an unknown cause writes nothing, and a request without the token is refused',
  timeoutMs: 120_000,
  run: async () => {
    await withLine('r28-dismiss-', async (rig) => {
      const { createApiServer } = await api();
      const { LocalVault } = await import('@olympus-ai/vault');
      const vault = new LocalVault(rig.dirs);
      await seedFinding(vault);
      const policyFile = join(rig.dirs.artifacts, '..', 'policy.yaml');
      await writeFile(policyFile, '{}');
      const r = await drafting(rig);
      const server = createApiServer({ components: await r.components(), token: TOKEN, principal: 'conformance', policyFile, rolesDirectory: rig.roles });
      const address = await server.listen(0, '127.0.0.1');
      const stored = async (): Promise<string[]> => (await vault.readFindingOutcomes()).map((e) => (e.record.outcome.kind === 'dismissed' ? e.record.outcome.cause : e.record.outcome.kind));
      try {
        const listed = await lookup(address, TOKEN, 'GET', '/findings');
        const open = listed.json as FindingSummary[];
        if (listed.status !== 200 || !Array.isArray(open) || open.length !== 1) throw new Error(`I2: GET /findings answered ${String(listed.status)} ${JSON.stringify(listed.json)}, not the one seeded finding`);
        const [first] = open;
        if (first?.outcome.kind !== 'open') throw new Error(`I2: a finding with no outcome listed as ${JSON.stringify(first?.outcome)}, not open`);
        const id = first.id;
        const path = `/findings/${encodeURIComponent(id)}/dismiss`;

        const texted = await lookup(address, TOKEN, 'POST', path, { cause: 'not-a-defect', note: NOTE });
        if (texted.status !== 400) throw new Error(`I2: a dismissal carrying text answered ${String(texted.status)}, not 400`);
        if ((await stored()).length !== 0) throw new Error('I2: a refused dismissal that carried text wrote an outcome');
        const unknownCause = await lookup(address, TOKEN, 'POST', path, { cause: 'the reviewer is wrong' });
        if (unknownCause.status !== 400) throw new Error(`I2: a dismissal with a cause outside the closed set answered ${String(unknownCause.status)}, not 400`);
        if ((await stored()).length !== 0) throw new Error('I2: a refused dismissal with an unknown cause wrote an outcome');
        const noToken = await lookup(address, null, 'POST', path, { cause: 'duplicate' });
        if (noToken.status !== 401) throw new Error(`I2: a dismissal without the token answered ${String(noToken.status)}, not 401`);
        if ((await stored()).length !== 0) throw new Error('I2: a dismissal without the token wrote an outcome');

        const absent = `nightly:${createHash('sha256').update('no such record').digest('hex')}:0`;
        const missing = await lookup(address, TOKEN, 'POST', `/findings/${encodeURIComponent(absent)}/dismiss`, { cause: 'duplicate' });
        if (missing.status !== 404) throw new Error(`I2: a dismissal of an id naming no finding answered ${String(missing.status)}, not 404`);

        const done = await lookup(address, TOKEN, 'POST', path, { cause: 'duplicate' });
        const summary = done.json as FindingSummary;
        if (done.status !== 200 || summary.outcome.kind !== 'dismissed' || summary.outcome.cause !== 'duplicate') throw new Error(`I2: the dismissal answered ${String(done.status)} ${JSON.stringify(done.json)}`);
        const after = (await lookup(address, TOKEN, 'GET', '/findings')).json as FindingSummary[];
        const now = after.find((f) => f.id === id);
        if (now?.outcome.kind !== 'dismissed' || now.outcome.cause !== 'duplicate') throw new Error(`I2: the dismissed finding lists as ${JSON.stringify(now?.outcome)}`);

        const again = await lookup(address, TOKEN, 'POST', path, { cause: 'not-a-defect' });
        if (again.status !== 409) throw new Error(`I2: a second dismissal answered ${String(again.status)}, not 409`);
        const held = await stored();
        if (held.length !== 1 || held[0] !== 'duplicate') throw new Error(`I2: the store holds ${JSON.stringify(held)}, not one dismissal for duplicate`);
        if (JSON.stringify(await vault.readFindingOutcomes()).includes(NOTE)) throw new Error('I2: a dismissal holds text a person sent');
      } finally {
        await server.close();
      }
    });
  },
});

export const FINDING_DISMISSAL_THROUGH_THE_CLI: LocalAssertion = runtime({
  id: 'I2.finding-dismissal-through-the-cli',
  title:
    'the CLI\'s dismiss-finding <id> --cause <cause> sends POST findings/<id>/dismiss with the body {"cause":...} and nothing else; without --cause it is a usage error that sends nothing',
  run: async () => {
    const { runCli } = await import('olympus-ai');
    const sent: Array<{ url: string; method: string; body: string | null }> = [];
    const capture = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      sent.push({ url: input instanceof Request ? input.url : input.toString(), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
      return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch;
    const out: string[] = [];
    const err: string[] = [];
    const io = { env: {}, fetch: capture, out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    const base = ['--url', 'http://127.0.0.1:9', '--token', TOKEN];
    const id = `review:run-1:${'a'.repeat(64)}:0`;

    const code = await runCli(['dismiss-finding', id, '--cause', 'not-a-defect', ...base], io);
    if (code !== 0) throw new Error(`I2: dismiss-finding exited ${String(code)}: ${err.join(' ')}`);
    const [one] = sent;
    if (sent.length !== 1 || one === undefined) throw new Error(`I2: dismiss-finding sent ${String(sent.length)} requests, not one`);
    if (one.method !== 'POST' || !one.url.endsWith(`/findings/${encodeURIComponent(id)}/dismiss`)) throw new Error(`I2: dismiss-finding sent ${one.method} ${one.url}`);
    if (one.body !== '{"cause":"not-a-defect"}') throw new Error(`I2: dismiss-finding sent the body ${String(one.body)}, not exactly the cause`);

    sent.length = 0;
    const missing = await runCli(['dismiss-finding', id, ...base], io);
    if (missing !== 2) throw new Error(`I2: dismiss-finding without --cause exited ${String(missing)}, not the usage error 2`);
    if (sent.length !== 0) throw new Error('I2: dismiss-finding without --cause sent a request');
  },
});
