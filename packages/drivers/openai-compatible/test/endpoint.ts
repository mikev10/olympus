/**
 * An OpenAI-compatible endpoint the suites own: a TLS origin in its own
 * container, on a network only the relay joins, answering the chat API with a
 * conversation the test scripts.
 *
 * No model is called. The script rides in the task's user message, which the
 * driver sends on every turn: `{"turns": [...]}`, one entry per model call,
 * picked by how many assistant messages the request already holds. A turn is
 * `{"content": "..."}` to finish, `{"calls": [{"name", "arguments"}]}` to call
 * tools, and may carry `model` (answer as another model, or `null` for none),
 * `usage: false` (answer with no usage), `status` (answer with an error), and
 * `hold` (milliseconds before answering).
 *
 * It logs every request body, base64, and whether the credential arrived as
 * `Bearer <expected>`, so an assertion reads what the endpoint received rather
 * than what the driver meant to send. It never echoes the credential.
 *
 * Requires Docker and `openssl`, and fails without either, as the sandbox's
 * relay suites do.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { EGRESS_PROXY_IMAGE } from '@olympus-ai/sandbox';

const run = promisify(execFile);

export const ENDPOINT_HOST = 'endpoint.test';
export const ENDPOINT_PORT = 8443;
export const ENDPOINT_ORIGIN = `https://${ENDPOINT_HOST}:${String(ENDPOINT_PORT)}`;
export const ENDPOINT_PATH = '/v1/chat/completions';

export interface Certificate {
  readonly cert: string;
  readonly key: string;
}

/** A self-signed certificate for `ENDPOINT_HOST`, valid for a day, handed to the provider as `relayTrust`. */
export async function makeCertificate(): Promise<Certificate> {
  const dir = await mkdtemp(join(tmpdir(), 'endpoint-cert-'));
  try {
    await run(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1',
        '-subj', `/CN=${ENDPOINT_HOST}`, '-addext', `subjectAltName=DNS:${ENDPOINT_HOST}`,
        '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'),
      ],
      // Git for Windows' runtime rewrites an argument that starts with `/` into a Windows path.
      { env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
    );
    return { cert: await readFile(join(dir, 'cert.pem'), 'utf8'), key: await readFile(join(dir, 'key.pem'), 'utf8') };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One scripted model call. */
export interface ScriptedTurn {
  readonly content?: string;
  readonly calls?: ReadonlyArray<{ readonly name: string; readonly arguments: Record<string, unknown> | string }>;
  readonly model?: string | null;
  readonly usage?: false | { readonly prompt: number; readonly completion: number; readonly cached?: number };
  readonly status?: number;
  readonly hold?: number;
}

/** The user message that scripts a conversation. */
export function script(turns: readonly ScriptedTurn[]): string {
  return JSON.stringify({ turns });
}

const ENDPOINT_SOURCE = `'use strict';
const expected = String(process.env.ENDPOINT_EXPECTED || '');
require('node:https').createServer({ key: process.env.ENDPOINT_KEY, cert: process.env.ENDPOINT_CERT }, function (q, s) {
  const parts = [];
  q.on('data', function (c) { parts.push(c); });
  q.on('end', function () {
    const raw = Buffer.concat(parts);
    console.log('ENDPOINT ' + q.method + ' ' + q.url + ' ' + String(q.headers.authorization === 'Bearer ' + expected) + ' ' + raw.toString('base64'));
    let request = {};
    try { request = JSON.parse(raw.toString('utf8')); } catch (error) { request = {}; }
    const messages = Array.isArray(request.messages) ? request.messages : [];
    const user = messages.find(function (m) { return m && m.role === 'user'; });
    let turns = [];
    try { turns = JSON.parse(user.content).turns || []; } catch (error) { turns = []; }
    const index = messages.filter(function (m) { return m && m.role === 'assistant'; }).length;
    const t = turns[index] || { content: 'script exhausted' };
    setTimeout(function () {
      if (t.status) {
        s.writeHead(t.status, { 'content-type': 'application/json' });
        s.end(JSON.stringify({ error: { type: 'server_error', message: 'scripted failure' } }));
        return;
      }
      const message = { role: 'assistant', content: t.content === undefined ? null : t.content };
      if (Array.isArray(t.calls)) {
        message.tool_calls = t.calls.map(function (c, i) {
          return { id: 'call_' + String(index) + '_' + String(i), type: 'function',
            function: { name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments) } };
        });
      }
      const answer = { id: 'chat_' + String(index), object: 'chat.completion',
        choices: [{ index: 0, message: message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] };
      if (t.model !== null) answer.model = t.model === undefined ? request.model : t.model;
      if (t.usage !== false) {
        const u = t.usage || { prompt: 100, completion: 10, cached: 0 };
        answer.usage = { prompt_tokens: u.prompt, completion_tokens: u.completion, prompt_tokens_details: { cached_tokens: u.cached || 0 } };
      }
      const body = JSON.stringify(answer);
      s.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
      s.end(body);
    }, typeof t.hold === 'number' ? t.hold : 0);
  });
}).listen(${String(ENDPOINT_PORT)}, '0.0.0.0');
`;

/** Starts the endpoint on `network` under `ENDPOINT_HOST`. The sandbox is never on that network. */
export async function startEndpoint(name: string, network: string, certificate: Certificate, expected: string): Promise<void> {
  await run(
    'docker',
    [
      'run', '--detach', '--init', '--name', name, '--network', network, '--network-alias', ENDPOINT_HOST,
      '--env', 'ENDPOINT_KEY', '--env', 'ENDPOINT_CERT', '--env', 'ENDPOINT_EXPECTED',
      EGRESS_PROXY_IMAGE, 'node', '--eval', ENDPOINT_SOURCE,
    ],
    { env: { ...process.env, ENDPOINT_KEY: certificate.key, ENDPOINT_CERT: certificate.cert, ENDPOINT_EXPECTED: expected } },
  );
  const probe =
    `require('node:net').connect(${String(ENDPOINT_PORT)}, '127.0.0.1')` +
    ".on('connect', function () { process.exit(0); }).on('error', function () { process.exit(1); });";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run('docker', ['exec', name, 'node', '--eval', probe]);
      return;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw new Error(`the endpoint container ${name} never listened`);
}

/** One request the endpoint received: its path, whether the bearer credential matched, and its body. */
export interface Received {
  readonly method: string;
  readonly path: string;
  readonly bearerMatches: boolean;
  readonly body: Record<string, unknown>;
}

export async function received(name: string): Promise<Received[]> {
  const { stdout } = await run('docker', ['logs', name], { maxBuffer: 64 * 1024 * 1024 });
  return stdout
    .split(/\r?\n/u)
    .map((line) => /^ENDPOINT (\S+) (\S+) (true|false) (\S*)$/u.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      method: m[1] ?? '',
      path: m[2] ?? '',
      bearerMatches: m[3] === 'true',
      body: JSON.parse(Buffer.from(m[4] ?? '', 'base64').toString('utf8') || '{}') as Record<string, unknown>,
    }));
}
