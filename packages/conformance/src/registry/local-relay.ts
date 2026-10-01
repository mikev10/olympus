/**
 * The registry's assertion over the model relay (P12), against a real daemon.
 *
 * Hermetic, as the egress assertion is: the upstream is a TLS origin this
 * assertion starts on the relay's own outbound network, with a certificate
 * `openssl` makes on the host for the run, and the credential is a canary. The
 * relay's properties are about where a value goes and which requests carry
 * it, and a real key would prove nothing more.
 *
 * Requires a Docker daemon and `openssl`, and fails without either, for the
 * reason `local-sandbox.ts` gives.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LocalDockerProvider, MeterReading, RelayBudget, RelayMeter, RelaySpec, SandboxHandle } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import { dockerHas, refusalFrom, specFor, withSandboxDirs, type SandboxDirs } from './local-sandbox.js';

const docker = promisify(execFile);

const UPSTREAM_HOST = 'upstream.test';
const UPSTREAM_PORT = 8443;
const UPSTREAM_ORIGIN = `https://${UPSTREAM_HOST}:${String(UPSTREAM_PORT)}`;
const UPSTREAM_MARKER = 'upstream-reached';
const CREDENTIAL = 'model';

/** A self-signed certificate for the upstream's name, valid for a day, handed to the relay as its trust. */
async function makeCertificate(): Promise<{ cert: string; key: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'relay-cert-'));
  try {
    await docker(
      'openssl',
      [
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1',
        '-subj', `/CN=${UPSTREAM_HOST}`, '-addext', `subjectAltName=DNS:${UPSTREAM_HOST}`,
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

/**
 * An upstream that reports whether the key it was sent is the one expected,
 * and never echoes it. `POST /v1/messages` answers as the Messages API does,
 * with the usage the request's `relay_test` names, for the meter to read (P13).
 */
const UPSTREAM_SOURCE = `'use strict';
const expected = String(process.env.UPSTREAM_EXPECTED || '');
require('node:https').createServer({ key: process.env.UPSTREAM_KEY, cert: process.env.UPSTREAM_CERT }, function (q, s) {
  const parts = [];
  q.on('data', function (c) { parts.push(c); });
  q.on('end', function () {
    console.log('UPSTREAM ' + q.method + ' ' + q.url);
    if (q.method === 'POST' && q.url.split('?')[0] === '/v1/messages') {
      let request = {};
      try { request = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (error) { request = {}; }
      const t = request.relay_test || {};
      const message = { id: 'msg', type: 'message', role: 'assistant', model: request.model, content: [] };
      if (t.omit !== 'all') {
        message.usage = { input_tokens: t.input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
        if (t.omit !== 'final') message.usage.output_tokens = t.output;
      }
      const answer = JSON.stringify(message);
      s.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(answer) });
      s.end(answer);
      return;
    }
    let keys = 0;
    for (let i = 0; i < q.rawHeaders.length; i += 2) if (q.rawHeaders[i].toLowerCase() === 'x-api-key') keys += 1;
    const body = JSON.stringify({ marker: '${UPSTREAM_MARKER}', host: q.headers.host, keyMatches: q.headers['x-api-key'] === expected, keyCount: keys });
    s.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
    s.end(body);
  });
}).listen(${String(UPSTREAM_PORT)}, '0.0.0.0');
`;

async function startUpstream(name: string, network: string, certificate: { cert: string; key: string }, expected: string): Promise<string> {
  const { EGRESS_PROXY_IMAGE } = await import('@olympus-ai/sandbox');
  await docker(
    'docker',
    [
      'run', '--detach', '--init', '--name', name, '--network', network, '--network-alias', UPSTREAM_HOST,
      '--env', 'UPSTREAM_KEY', '--env', 'UPSTREAM_CERT', '--env', 'UPSTREAM_EXPECTED',
      EGRESS_PROXY_IMAGE, 'node', '--eval', UPSTREAM_SOURCE,
    ],
    { env: { ...process.env, UPSTREAM_KEY: certificate.key, UPSTREAM_CERT: certificate.cert, UPSTREAM_EXPECTED: expected } },
  );
  const probe =
    `require('node:net').connect(${String(UPSTREAM_PORT)}, '127.0.0.1')` +
    ".on('connect', function () { process.exit(0); }).on('error', function () { process.exit(1); });";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await docker('docker', ['exec', name, 'node', '--eval', probe]);
      const { stdout } = await docker('docker', ['inspect', '--format', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name]);
      return stdout.trim();
    } catch {
      await new Promise((done) => {
        setTimeout(done, 250).unref();
      });
    }
  }
  throw new Error(`the upstream container ${name} never listened`);
}

/**
 * One raw request to the relay from inside the sandbox. BusyBox `nc` stops at
 * the end of its input, before a forwarded answer arrives, so the input is
 * held open until the relay closes the connection.
 */
async function toRelay(provider: LocalDockerProvider, handle: SandboxHandle, method: string, target: string, headers: Record<string, string> = {}): Promise<{ status: number | undefined; body: string }> {
  const { RELAY_ALIAS, RELAY_PORT } = await import('@olympus-ai/sandbox');
  const lines = [`${method} ${target} HTTP/1.1`, 'Host: model-relay', 'Connection: close', ...Object.entries(headers).map(([n, v]) => `${n}: ${v}`)];
  const result = await provider.exec(handle, ['sh', '-c', `(cat; sleep 8) | nc -w 10 ${RELAY_ALIAS} ${String(RELAY_PORT)}`], {
    stdin: `${lines.join('\r\n')}\r\n\r\n`,
  });
  const text = result.stdout;
  const status = /^HTTP\/1\.[01] (\d{3})/u.exec(text)?.[1];
  const at = text.indexOf('\r\n\r\n');
  return { status: status === undefined ? undefined : Number(status), body: at === -1 ? '' : text.slice(at + 4) };
}

export const MODEL_RELAY_FORWARDS_ONLY_ITS_GRANT = runtime({
  id: 'I4.model-relay-forwards-only-its-grant',
  title:
    "a sandbox's model relay forwards its granted paths to its one upstream with the provider's credential in place of the client's, " +
    'refuses every other path and every absolute-form target, is the only route to the upstream, records the credential by name alone, ' +
    'and goes with the sandbox; a credential the provider was not given is refused at provisioning',
  run: async () => {
    const certificate = await makeCertificate();
    const secret = `canary-${randomUUID()}-${randomUUID()}`;
    await withSandboxDirs('i4-model-relay-', async (dirs) => {
      const { LocalDockerProvider: Provider, relayOf } = await import('@olympus-ai/sandbox');
      const provider = await Provider.create({ vaultPaths: [dirs.vault], credentials: { [CREDENTIAL]: secret }, relayTrust: certificate.cert });
      const relay = meteredRelay();

      // I4: a credential not given is not available. The refusal names it and carries no value.
      const unheld = await refusalFrom(() => provider.provision(specFor(dirs, 'rw', { relay: { ...relay, credential: 'never-given' } })));
      if (unheld.layer !== 'relay' || !unheld.message.includes('never-given') || unheld.message.includes(secret)) {
        throw new Error(`I4: a relay naming an unheld credential was refused at the ${unheld.layer} layer with: ${unheld.message}`);
      }

      const handle = await provider.provision(specFor(dirs, 'rw', { relay }));
      const applied = relayOf(provider.appliedControls(handle).egress);
      if (applied === undefined) {
        await provider.destroy(handle);
        throw new Error('I4: a spec with a relay was provisioned without one');
      }
      const upstreamName = `relay-upstream-${randomUUID()}`;
      try {
        const address = await startUpstream(upstreamName, applied.outboundNetwork, certificate, secret);

        // The grant, with a key of the task's own in the request: the provider's replaces it rather than joining it.
        const granted = await toRelay(provider, handle, 'GET', '/v1/messages?beta=true', { 'x-api-key': 'the-tasks-own', authorization: 'Bearer x' });
        const seen = JSON.parse(granted.body) as { marker?: string; host?: string; keyMatches?: boolean; keyCount?: number };
        if (granted.status !== 200 || seen.marker !== UPSTREAM_MARKER || seen.keyMatches !== true || seen.keyCount !== 1) {
          throw new Error(`I4: the granted path did not reach the upstream with the provider's credential alone: ${granted.body}`);
        }
        if (seen.host !== `${UPSTREAM_HOST}:${String(UPSTREAM_PORT)}`) {
          throw new Error(`I4: the upstream was asked for host ${String(seen.host)}, not its own`);
        }

        // Everything else is refused before it reaches the upstream.
        for (const path of ['/v1/files', '/v1/messages/../files', '/v1/messagesx']) {
          const refused = await toRelay(provider, handle, 'GET', path);
          if (refused.status !== 403 || !refused.body.includes(path)) {
            throw new Error(`I4: the ungranted path ${path} was answered ${String(refused.status)}: ${refused.body}`);
          }
        }
        const absolute = await toRelay(provider, handle, 'GET', 'http://elsewhere.invalid/v1/messages');
        if (absolute.status !== 400) throw new Error(`I4: an absolute-form target was answered ${String(absolute.status)}`);
        const { stdout: log } = await docker('docker', ['logs', upstreamName]);
        const reached = log.split(/\r?\n/u).filter((line) => line.startsWith('UPSTREAM '));
        if (reached.length !== 1 || reached[0] !== 'UPSTREAM GET /v1/messages?beta=true') {
          throw new Error(`I4: the upstream received requests beyond the grant: ${reached.join('; ')}`);
        }

        // The only route: the upstream's own address is unreachable from the sandbox.
        const direct = await provider.exec(handle, ['sh', '-c', `wget -T 3 -O - http://${address}:${String(UPSTREAM_PORT)}/ 2>&1; echo EXIT=$?`]);
        if (!direct.stdout.includes('unreachable') || direct.stdout.includes('EXIT=0')) {
          throw new Error(`I4: the upstream was reachable from the sandbox without the relay: ${direct.stdout}`);
        }

        // By name only: no applied control, and no process in the sandbox, holds the value.
        if (JSON.stringify(provider.appliedControls(handle)).includes(secret)) {
          throw new Error('I4: appliedControls records the credential value');
        }
        const dump = await provider.exec(handle, ['sh', '-c', 'for p in /proc/[0-9]*; do cat "$p/environ" "$p/cmdline" 2>/dev/null; done']);
        if (dump.stdout === '' || dump.stdout.includes(secret)) {
          throw new Error('I4: the credential is readable from a process in the sandbox, or the process dump read nothing');
        }
      } finally {
        await docker('docker', ['rm', '--force', '--volumes', upstreamName]).catch(() => undefined);
        await provider.destroy(handle);
      }

      // The relay is the sandbox's, and goes with it.
      for (const [kind, name] of [
        ['container', applied.name],
        ['network', applied.internalNetwork],
        ['network', applied.outboundNetwork],
      ] as const) {
        if (await dockerHas(kind, name)) throw new Error(`I4: the ${kind} ${name} outlived the sandbox its relay served`);
      }
    });
  },
});

/** The model the metered entries name, priced so a charge can be checked by hand: a dollar per million input tokens, ten per million output. */
const METERED_MODEL = 'conformance-model';
const METER: RelayMeter = {
  dialect: 'anthropic-messages',
  prices: { [METERED_MODEL]: { inputPerMTok: 1, outputPerMTok: 10, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, cacheWrite1hPerMTok: 2 } },
};
const AMPLE: RelayBudget = { maxTokens: 1_000_000_000, maxCostUsd: 100 };

function meteredRelay(budget: RelayBudget = AMPLE): RelaySpec {
  return { upstream: UPSTREAM_ORIGIN, paths: ['/v1/messages'], header: 'x-api-key', credential: CREDENTIAL, urlVariable: 'MODEL_BASE_URL', budget, meter: METER };
}

/** A Messages API request the upstream answers with the usage it names; `omit` drops the final output count, or every count. */
function message(input: number, output: number, omit?: 'final' | 'all', model = METERED_MODEL): Record<string, unknown> {
  return { model, max_tokens: 64, messages: [], relay_test: { input, output, ...(omit === undefined ? {} : { omit }) } };
}

/**
 * Sends each request in turn from inside the sandbox, with `node` rather than
 * a model's CLI: the budget binds whatever calls the relay, and a task that
 * bypasses its CLI is the case it exists for.
 */
const CLIENT = `
const http = require('node:http');
const base = new URL(process.env.MODEL_BASE_URL);
function send(body) {
  return new Promise(function (resolve) {
    const bytes = Buffer.from(JSON.stringify(body));
    const q = http.request({ host: base.hostname, port: base.port, method: 'POST', path: '/v1/messages', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) } }, function (s) {
      let text = '';
      s.on('data', function (c) { text += c; });
      s.on('end', function () { resolve({ status: s.statusCode, body: text }); });
    });
    q.on('error', function (e) { resolve({ status: 0, body: String(e.message) }); });
    q.end(bytes);
  });
}
let input = '';
process.stdin.on('data', function (c) { input += c; });
process.stdin.on('end', async function () {
  const out = [];
  for (const body of JSON.parse(input)) out.push(await send(body));
  process.stdout.write(JSON.stringify(out));
});
`;

async function sendAll(provider: LocalDockerProvider, handle: SandboxHandle, bodies: readonly unknown[]): Promise<Array<{ status: number; body: string }>> {
  const result = await provider.exec(handle, ['node', '--eval', CLIENT], { stdin: JSON.stringify(bodies) });
  if (result.exitCode !== 0) throw new Error(`the in-sandbox client exited ${String(result.exitCode)}: ${result.stderr}`);
  return JSON.parse(result.stdout) as Array<{ status: number; body: string }>;
}

/**
 * Provisions a metered sandbox on the proxy's Node image, starts the upstream
 * beside its relay, runs `body`, then removes the upstream and destroys the
 * sandbox, returning what the relay counted.
 */
async function withMeteredSandbox(
  provider: LocalDockerProvider,
  dirs: SandboxDirs,
  certificate: { cert: string; key: string },
  budget: RelayBudget,
  body: (handle: SandboxHandle, upstreamLog: () => Promise<string[]>) => Promise<void>,
): Promise<MeterReading> {
  const { EGRESS_PROXY_IMAGE, relayOf } = await import('@olympus-ai/sandbox');
  const handle = await provider.provision(specFor(dirs, 'rw', { image: EGRESS_PROXY_IMAGE, relay: meteredRelay(budget) }));
  const upstreamName = `relay-upstream-${randomUUID()}`;
  let destroyed = false;
  try {
    const applied = relayOf(provider.appliedControls(handle).egress);
    if (applied === undefined) throw new Error('a spec with a relay was provisioned without one');
    await startUpstream(upstreamName, applied.outboundNetwork, certificate, 'unused');
    await body(handle, async () => {
      const { stdout } = await docker('docker', ['logs', upstreamName]);
      return stdout.split(/\r?\n/u).filter((line) => line.startsWith('UPSTREAM POST '));
    });
    await docker('docker', ['rm', '--force', '--volumes', upstreamName]);
    destroyed = true;
    return (await provider.destroy(handle)).meter;
  } finally {
    if (!destroyed) {
      await docker('docker', ['rm', '--force', '--volumes', upstreamName]).catch(() => undefined);
      await provider.destroy(handle).catch(() => undefined);
    }
  }
}

function metered(reading: MeterReading, context: string): Extract<MeterReading, { kind: 'metered' }> {
  if (reading.kind !== 'metered') throw new Error(`${context}: a sandbox with a relay returned an unmetered reading`);
  return reading;
}

export const MODEL_RELAY_ENFORCES_BUDGET = runtime({
  id: 'I4.model-relay-enforces-budget',
  title:
    "a sandbox's relay counts what each call used and, once its budget's dollars or tokens are spent, refuses every later call with a status the client does not retry, naming the bound — " +
    'for calls made from inside the sandbox by node rather than a model CLI; destroy returns what it counted, and a relay with no budget is refused at provisioning',
  run: async () => {
    const certificate = await makeCertificate();
    await withSandboxDirs('i4-relay-budget-', async (dirs) => {
      const { LocalDockerProvider: Provider } = await import('@olympus-ai/sandbox');
      const provider = await Provider.create({ vaultPaths: [dirs.vault], credentials: { [CREDENTIAL]: `canary-${randomUUID()}` }, relayTrust: certificate.cert });

      // I5 beside I4: a relay nothing bounds is not started.
      const { budget: _dropped, ...unbounded } = meteredRelay();
      const refused = await refusalFrom(() => provider.provision(specFor(dirs, 'rw', { relay: unbounded as RelaySpec })));
      if (refused.layer !== 'relay' || !refused.message.includes('relay.budget')) {
        throw new Error(`I4: a relay with no budget was refused at the ${refused.layer} layer with: ${refused.message}`);
      }

      // Each call costs 1000 * $1 + 100 * $10 per million: $0.002. The second crosses $0.003.
      for (const [bound, budget] of [
        ['maxCostUsd', { maxTokens: 1_000_000_000, maxCostUsd: 0.003 }],
        ['maxTokens', { maxTokens: 2000, maxCostUsd: 100 }],
      ] as const) {
        const reading = metered(
          await withMeteredSandbox(provider, dirs, certificate, budget, async (handle, upstreamLog) => {
            const answers = await sendAll(provider, handle, [message(1000, 100), message(1000, 100), message(1000, 100)]);
            const statuses = answers.map((a) => a.status).join(',');
            if (statuses !== '200,200,402') throw new Error(`I4: under ${bound} the calls were answered ${statuses}, expected 200,200,402`);
            if (!(answers[2]?.body ?? '').includes(bound)) throw new Error(`I4: the refusal does not name ${bound}: ${answers[2]?.body ?? ''}`);
            const reached = await upstreamLog();
            if (reached.length !== 2) throw new Error(`I4: the upstream received ${String(reached.length)} calls under ${bound}; the refused one must not reach it`);
          }),
          'I4',
        );
        const exhausted = bound === 'maxCostUsd' ? 'cost' : 'tokens';
        if (reading.calls !== 2 || reading.inputTokens !== 2000 || reading.outputTokens !== 200 || reading.refused !== 1 || reading.exhausted !== exhausted) {
          throw new Error(`I4: under ${bound} destroy read ${JSON.stringify(reading)}`);
        }
      }
    });
  },
});

export const MODEL_RELAY_FAILS_CLOSED_ON_UNMETERED_USAGE = runtime({
  id: 'I5.model-relay-fails-closed-on-unmetered-usage',
  title:
    'what the relay cannot count it does not forgive: a model with no price is refused before the upstream sees it, an answer with its input and no final usage is charged max_tokens as output, ' +
    'an answer with no readable usage stops the relay forwarding, and a relay log that does not account for itself makes destroy throw while the relay is still torn down',
  run: async () => {
    const certificate = await makeCertificate();
    await withSandboxDirs('i5-relay-unmetered-', async (dirs) => {
      const { LocalDockerProvider: Provider, relayOf } = await import('@olympus-ai/sandbox');
      const provider = await Provider.create({ vaultPaths: [dirs.vault], credentials: { [CREDENTIAL]: `canary-${randomUUID()}` }, relayTrust: certificate.cert });

      const reading = metered(
        await withMeteredSandbox(provider, dirs, certificate, AMPLE, async (handle, upstreamLog) => {
          const unpriced = await sendAll(provider, handle, [message(10, 1, undefined, 'unpriced-model')]);
          if (unpriced[0]?.status !== 400 || !unpriced[0].body.includes('unpriced-model') || (await upstreamLog()).length !== 0) {
            throw new Error(`I5: an unpriced model was answered ${JSON.stringify(unpriced)} or reached the upstream`);
          }
          // Charged its ceiling: 64 output tokens, not the 7 the upstream never reported.
          const partial = await sendAll(provider, handle, [message(1000, 7, 'final')]);
          if (partial[0]?.status !== 200) throw new Error(`I5: a call with partial usage was answered ${JSON.stringify(partial)}`);
          const blind = await sendAll(provider, handle, [message(1000, 7, 'all'), message(10, 1)]);
          if (blind.map((a) => a.status).join(',') !== '200,402') throw new Error(`I5: after an unreadable answer the relay answered ${JSON.stringify(blind)}`);
        }),
        'I5',
      );
      if (reading.calls !== 2 || reading.inputTokens !== 1000 || reading.outputTokens !== 64 + 64 || reading.exhausted !== 'unreadable' || reading.refused !== 2) {
        throw new Error(`I5: destroy read ${JSON.stringify(reading)}`);
      }

      // A relay killed before it could write its closing line leaves a log that may not hold every call.
      const { EGRESS_PROXY_IMAGE } = await import('@olympus-ai/sandbox');
      const handle = await provider.provision(specFor(dirs, 'rw', { image: EGRESS_PROXY_IMAGE, relay: meteredRelay() }));
      const applied = relayOf(provider.appliedControls(handle).egress);
      if (applied === undefined) throw new Error('I5: a spec with a relay was provisioned without one');
      await docker('docker', ['kill', applied.containerId]);
      const outcome = await provider.destroy(handle).then(
        (r) => `returned ${JSON.stringify(r)}`,
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
      if (!outcome.includes('closing meter line')) throw new Error(`I5: destroy over an unaccounted relay log ${outcome}`);
      if (await dockerHas('container', applied.name)) throw new Error('I5: the relay outlived a destroy whose meter could not be read');
    });
  },
});
