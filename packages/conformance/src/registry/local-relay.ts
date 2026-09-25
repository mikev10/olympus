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
import type { LocalDockerProvider, SandboxHandle } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import { dockerHas, refusalFrom, specFor, withSandboxDirs } from './local-sandbox.js';

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

/** An upstream that reports whether the key it was sent is the one expected, and never echoes it. */
const UPSTREAM_SOURCE = `'use strict';
const expected = String(process.env.UPSTREAM_EXPECTED || '');
require('node:https').createServer({ key: process.env.UPSTREAM_KEY, cert: process.env.UPSTREAM_CERT }, function (q, s) {
  q.resume();
  q.on('end', function () {
    console.log('UPSTREAM ' + q.method + ' ' + q.url);
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
      const relay = { upstream: UPSTREAM_ORIGIN, paths: ['/v1/messages'], header: 'x-api-key', credential: CREDENTIAL, urlVariable: 'MODEL_BASE_URL' };

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
