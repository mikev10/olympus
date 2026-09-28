/**
 * A TLS upstream the relay suites can own: a private certificate authority's
 * worth of trust, an origin that reports what it was sent, and a host-side
 * search for a secret that puts nothing into the container it searches.
 *
 * Hermetic: nothing here reaches the internet. The upstream is a container on
 * the relay's own outbound network, so "the relay reached its upstream" is
 * observed rather than assumed, and "the sandbox cannot reach it directly" is
 * tested against a host that is demonstrably up.
 *
 * The certificate is made by `openssl` on the host, which every CI runner and
 * Git for Windows carry. Without it the suite fails rather than skipping, for
 * the reason `local.test.ts` gives for Docker.
 */
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { EGRESS_PROXY_IMAGE, type RelayBudget, type RelayMeter } from '../src/index.js';

const run = promisify(execFile);

/** The name the upstream answers to on the relay's outbound network, and the name its certificate carries. */
export const UPSTREAM_HOST = 'upstream.test';
export const UPSTREAM_PORT = 8443;
export const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}:${String(UPSTREAM_PORT)}`;

/** The model the suites' requests name, and its price: round numbers, so a charge can be checked by hand. */
export const TEST_MODEL = 'test-model-1';

/** A dollar per million tokens of every class but output, which is ten; a cache write held an hour costs two. */
export const TEST_METER: RelayMeter = {
  dialect: 'anthropic-messages',
  prices: {
    [TEST_MODEL]: { inputPerMTok: 1, outputPerMTok: 10, cacheReadPerMTok: 0.5, cacheWritePerMTok: 1.25, cacheWrite1hPerMTok: 2 },
  },
};

/** A budget no suite that is not about budgets comes near. */
export const TEST_BUDGET: RelayBudget = { maxTokens: 10_000_000, maxCostUsd: 100 };

/** What every upstream answer carries, so a body that arrives is known to have come from the upstream. */
export const UPSTREAM_MARKER = 'upstream-reached';

export interface Certificate {
  readonly cert: string;
  readonly key: string;
}

/** A self-signed certificate for `UPSTREAM_HOST`, valid for a day. It is its own root: the relay is given it as `relayTrust`. */
export async function makeCertificate(): Promise<Certificate> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-cert-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    await run(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1',
        '-subj', `/CN=${UPSTREAM_HOST}`, '-addext', `subjectAltName=DNS:${UPSTREAM_HOST}`,
        '-keyout', keyPath, '-out', certPath,
      ],
      // Git for Windows' runtime rewrites an argument that starts with `/` into a Windows path.
      { env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
    return { cert: await readFile(certPath, 'utf8'), key: await readFile(keyPath, 'utf8') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The upstream. It never echoes the credential: it reports whether the one it
 * was sent is the one it expected, so a test can prove the relay wrote the
 * provider's credential without the value ever travelling back into the
 * sandbox that asked.
 *
 * `/v1/messages/redirect` answers 302 to another origin, so a relay that
 * followed redirects would be caught sending the credential onward.
 *
 * `POST /v1/messages` answers as the Messages API does, with the usage a meter
 * reads (P13). What it answers is steered by `relay_test` in the request body,
 * which the relay forwards unchanged like the rest: `usage` (the four counts),
 * `omit` (`'final'` drops the output count, `'all'` every count), `status`,
 * `encoding` (`'gzip'`), `hold` (milliseconds before answering), and `hangup`
 * (`true` reads the whole request and closes without answering). `stream:
 * true` answers in server-sent events. It logs
 * the SHA-256 of every body it received and sent, so a suite can prove both
 * crossed the relay byte for byte.
 */
const UPSTREAM_SOURCE = `'use strict';
const https = require('node:https');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const expected = String(process.env.UPSTREAM_EXPECTED || '');
function sha(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function messages(q, s, body, echo) {
  let request = {};
  try { request = JSON.parse(body.toString('utf8')); } catch (error) { request = {}; }
  const t = request.relay_test || {};
  // The whole request arrived and no answer ever will: a call the upstream may have billed.
  if (t.hangup === true) { s.socket.destroy(); return; }
  // Held back, so other calls can arrive while this one is in flight.
  setTimeout(function () { answer(s, request, t, body, echo); }, typeof t.hold === 'number' ? t.hold : 0);
}
function answer(s, request, t, body, echo) {
  const counts = t.usage || { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 };
  const status = t.status || 200;
  const usage = t.omit === 'all' ? undefined : {
    input_tokens: counts.input,
    cache_read_input_tokens: counts.cacheRead,
    cache_creation_input_tokens: counts.cacheWrite,
    cache_creation: { ephemeral_5m_input_tokens: counts.cacheWrite, ephemeral_1h_input_tokens: 0 },
  };
  if (usage !== undefined && t.omit !== 'final') usage.output_tokens = counts.output;
  let payload;
  let type;
  if (status !== 200) {
    type = 'application/json';
    payload = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'test upstream' } });
  } else if (request.stream === true) {
    type = 'text/event-stream';
    const start = { id: 'msg_test', type: 'message', role: 'assistant', model: request.model, content: [] };
    if (usage !== undefined) start.usage = { input_tokens: usage.input_tokens, cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens, cache_creation: usage.cache_creation, output_tokens: 1 };
    const events = [
      ['message_start', { type: 'message_start', message: start }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: JSON.stringify(echo) } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ];
    if (t.omit !== 'final' && t.omit !== 'all') {
      events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: counts.output } }]);
      events.push(['message_stop', { type: 'message_stop' }]);
    }
    payload = events.map(function (e) { return 'event: ' + e[0] + '\\ndata: ' + JSON.stringify(e[1]) + '\\n\\n'; }).join('');
  } else {
    type = 'application/json';
    const message = Object.assign({ id: 'msg_test', type: 'message', role: 'assistant', model: request.model }, echo);
    if (usage !== undefined) message.usage = usage;
    payload = JSON.stringify(message);
  }
  let bytes = Buffer.from(payload, 'utf8');
  const headers = { 'content-type': type };
  if (t.encoding === 'gzip') { bytes = zlib.gzipSync(bytes); headers['content-encoding'] = 'gzip'; }
  console.log('UPSTREAM_BODY ' + sha(body) + ' UPSTREAM_SENT ' + sha(bytes));
  s.writeHead(status, headers);
  // Written in pieces, as a stream arrives, so a meter reading one whole chunk is not what passes.
  const step = Math.max(1, Math.ceil(bytes.length / 4));
  let at = 0;
  (function next() {
    if (at >= bytes.length) { s.end(); return; }
    s.write(bytes.subarray(at, at + step));
    at += step;
    setTimeout(next, 5);
  })();
}
https.createServer({ key: process.env.UPSTREAM_KEY, cert: process.env.UPSTREAM_CERT }, function (q, s) {
  const parts = [];
  q.on('data', function (c) { parts.push(c); });
  q.on('end', function () {
    const body = Buffer.concat(parts);
    console.log('UPSTREAM ' + q.method + ' ' + q.url);
    if (q.url.indexOf('/v1/messages/redirect') === 0) {
      s.writeHead(302, { location: 'https://elsewhere.invalid/v1/messages' });
      s.end();
      return;
    }
    let keys = 0;
    for (let i = 0; i < q.rawHeaders.length; i += 2) if (q.rawHeaders[i].toLowerCase() === 'x-api-key') keys += 1;
    const echo = {
      marker: '${UPSTREAM_MARKER}',
      method: q.method,
      url: q.url,
      host: q.headers.host,
      keyMatches: q.headers['x-api-key'] === expected,
      keyCount: keys,
      authorization: q.headers.authorization === undefined ? null : 'present',
      acceptEncoding: q.headers['accept-encoding'] === undefined ? null : q.headers['accept-encoding'],
      bodyBytes: body.length,
    };
    const path = q.url.split('?')[0];
    if (q.method === 'POST' && path === '/v1/messages') { messages(q, s, body, echo); return; }
    s.writeHead(200, { 'content-type': 'application/json' });
    s.end(JSON.stringify(echo));
  });
}).listen(${String(UPSTREAM_PORT)}, '0.0.0.0');
`;

/** Starts the upstream on `network` and returns its address there. The sandbox is never on that network. */
export async function startUpstream(name: string, network: string, certificate: Certificate, expected: string): Promise<string> {
  await run(
    'docker',
    [
      'run', '--detach', '--init', '--name', name,
      '--network', network, '--network-alias', UPSTREAM_HOST,
      '--env', 'UPSTREAM_KEY', '--env', 'UPSTREAM_CERT', '--env', 'UPSTREAM_EXPECTED',
      EGRESS_PROXY_IMAGE, 'node', '--eval', UPSTREAM_SOURCE,
    ],
    { env: { ...process.env, UPSTREAM_KEY: certificate.key, UPSTREAM_CERT: certificate.cert, UPSTREAM_EXPECTED: expected } },
  );
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run('docker', ['exec', name, 'node', '--eval',
        `require('node:net').connect(${String(UPSTREAM_PORT)}, '127.0.0.1').on('connect', function () { process.exit(0); }).on('error', function () { process.exit(1); });`,
      ]);
      const { stdout } = await run('docker', ['inspect', '--format', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name]);
      return stdout.trim();
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw new Error(`the upstream container ${name} never listened`);
}

/** The SHA-256 of each `POST /v1/messages` body the upstream received, and of the bytes it answered with, in order. */
export async function upstreamDigests(name: string): Promise<Array<{ received: string; sent: string }>> {
  const { stdout } = await run('docker', ['logs', name]);
  return stdout
    .split(/\r?\n/)
    .map((line) => /^UPSTREAM_BODY ([0-9a-f]{64}) UPSTREAM_SENT ([0-9a-f]{64})$/u.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ received: m[1] ?? '', sent: m[2] ?? '' }));
}

/** The requests the upstream received, one `METHOD url` per line. */
export async function upstreamLog(name: string): Promise<string[]> {
  const { stdout } = await run('docker', ['logs', name]);
  return stdout.split(/\r?\n/).filter((line) => line.startsWith('UPSTREAM ')).map((line) => line.slice('UPSTREAM '.length));
}

/**
 * Whether `secret` appears anywhere in a container's filesystem, searched from
 * the host through `docker export`.
 *
 * Nothing is run inside the container and the secret is never sent into it:
 * a scan that handed the container the value it was looking for would put it
 * there. The export covers every file of the container's own filesystem —
 * whoever may read it — and none of its mounts, which a caller searches
 * separately on the host.
 */
export function exportContains(container: string, secret: string): Promise<boolean> {
  const needle = Buffer.from(secret, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['export', container], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let tail = Buffer.alloc(0);
    let found = false;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (found) return;
      const window = Buffer.concat([tail, chunk]);
      if (window.includes(needle)) {
        found = true;
        return;
      }
      tail = window.subarray(Math.max(0, window.length - needle.length + 1));
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !found) reject(new Error(`docker export exited ${String(code)}: ${stderr.trim()}`));
      else resolve(found);
    });
  });
}

/**
 * The environment and argument vector of every process the container user can
 * read, read from inside, as the demonstrated exploit read them (D-P5-20). The
 * text comes back to the host, which does the searching.
 */
export const PROCESS_DUMP = 'for p in /proc/[0-9]*; do cat "$p/environ" "$p/cmdline" 2>/dev/null; printf "\\n"; done';

/** `docker inspect` of a container: every environment entry and argument it was started with. */
export async function inspectText(container: string): Promise<string> {
  const { stdout } = await run('docker', ['inspect', '--format', '{{json .Config.Env}} {{json .Config.Cmd}} {{json .Args}}', container]);
  return stdout;
}

/** One raw HTTP request, in the form a client inside the sandbox would send it. */
export function rawRequest(method: string, target: string, headers: Readonly<Record<string, string>> = {}): string {
  const lines = [`${method} ${target} HTTP/1.1`, 'Host: model-relay', 'Connection: close'];
  for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** The status code of a raw HTTP response, or `undefined` when there was none. */
export function statusOf(response: string): number | undefined {
  const match = /^HTTP\/1\.[01] (\d{3})/u.exec(response);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** The body of a raw HTTP response, with chunked framing removed when the response used it. */
export function bodyOf(response: string): string {
  const at = response.indexOf('\r\n\r\n');
  if (at === -1) return '';
  const raw = response.slice(at + 4);
  if (!/\r\ntransfer-encoding: *chunked/iu.test(response.slice(0, at))) return raw;
  let body = '';
  let rest = raw;
  for (;;) {
    const line = rest.indexOf('\r\n');
    if (line === -1) return body;
    const size = Number.parseInt(rest.slice(0, line), 16);
    if (!Number.isFinite(size) || size === 0) return body;
    body += rest.slice(line + 2, line + 2 + size);
    rest = rest.slice(line + 2 + size + 2);
  }
}
