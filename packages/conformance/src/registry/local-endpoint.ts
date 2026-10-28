/**
 * The registry's assertions over a relay to a local model endpoint (R21),
 * against a real daemon.
 *
 * Hermetic: the endpoint is a plain `http` listener this assertion starts on
 * the host, on a port the operating system picks, and nothing is sent to a
 * model. Its properties are about which declarations open the route to the
 * host, what reaches the endpoint along it, and who else can use it.
 *
 * Requires a Docker daemon, and fails without one, for the reason
 * `local-sandbox.ts` gives.
 */
import { execFile, spawn } from 'node:child_process';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { promisify } from 'node:util';
import type { LocalDockerProvider, RelayMeter, RelaySpec, SandboxHandle } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import { dockerHas, refusalFrom, specFor, withSandboxDirs } from './local-sandbox.js';

const docker = promisify(execFile);

const CHAT_PATH = '/v1/chat/completions';
const LOCAL_MODEL = 'local-model';
const METER: RelayMeter = {
  dialect: 'openai-chat',
  prices: { [LOCAL_MODEL]: { inputPerMTok: 0, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0, cacheWrite1hPerMTok: 0 } },
};

/** A keyless relay to `port` on the Docker host (A-R21-01, A-R21-02). */
function localRelay(port: number): RelaySpec {
  return {
    upstream: { local: 'docker-host', port },
    paths: [CHAT_PATH],
    header: 'api-key',
    scheme: 'none',
    credential: null,
    urlVariable: 'MODEL_BASE_URL',
    budget: { maxTokens: 1_000_000, maxCostUsd: 1 },
    meter: METER,
  };
}

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

/**
 * An endpoint on the host that records every request and answers a chat call
 * as the chat API does, naming the request's model and reporting usage.
 */
async function startEndpoint(): Promise<{ port: number; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = createServer((q, s) => {
    const parts: Buffer[] = [];
    q.on('data', (c: Buffer) => parts.push(c));
    q.on('end', () => {
      seen.push({ method: q.method ?? '', url: q.url ?? '', headers: q.headers });
      let model: unknown;
      try {
        model = (JSON.parse(Buffer.concat(parts).toString('utf8')) as { model?: unknown }).model;
      } catch {
        model = null;
      }
      const answer = JSON.stringify({
        id: 'chat', object: 'chat.completion', model,
        choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });
      s.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(answer) });
      s.end(answer);
    });
  });
  // Every interface: on a Linux engine the host gateway is the bridge's address, not loopback.
  await new Promise<void>((done) => server.listen(0, '0.0.0.0', done));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    seen,
    close: () => new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => { done(); });
    }),
  };
}

/** One chat call to the relay from inside the sandbox, carrying a key of the task's own in every header a key could go in. */
const CLIENT = `
const http = require('node:http');
const base = new URL(process.env.MODEL_BASE_URL);
const bytes = Buffer.from(JSON.stringify({ model: '${LOCAL_MODEL}', max_tokens: 16, messages: [] }));
const q = http.request({ host: base.hostname, port: base.port, method: 'POST', path: '${CHAT_PATH}', agent: false,
  headers: { 'content-type': 'application/json', 'content-length': String(bytes.length),
    authorization: 'Bearer the-tasks-own', 'x-api-key': 'the-tasks-own', 'api-key': 'the-tasks-own' } }, function (s) {
  let text = '';
  s.on('data', function (c) { text += c; });
  s.on('end', function () { process.stdout.write(JSON.stringify({ status: s.statusCode, body: text })); });
});
q.on('error', function (e) { process.stdout.write(JSON.stringify({ status: 0, body: String(e.message) })); });
q.end(bytes);
`;

/** Tries the endpoint directly from inside the sandbox at each address, and prints what each attempt came to. */
const DIRECT = `
const http = require('node:http');
const port = Number(process.argv[1]);
const hosts = JSON.parse(process.argv[2]);
Promise.all(hosts.map(function (host) {
  return new Promise(function (resolve) {
    const q = http.get({ host: host, port: port, path: '/direct', timeout: 3000, agent: false }, function (s) {
      s.resume();
      resolve(host + ' reached ' + String(s.statusCode));
    });
    q.on('timeout', function () { q.destroy(new Error('timeout')); });
    q.on('error', function (e) { resolve(host + ' failed ' + String(e.code || e.message)); });
  });
})).then(function (lines) { process.stdout.write(JSON.stringify(lines)); });
`;

/** Every address the relay container resolves `model-host` to: the host gateway, as the daemon set it. */
async function gatewayAddresses(relayContainer: string, alias: string): Promise<string[]> {
  const { stdout } = await docker('docker', [
    'exec', relayContainer, 'node', '--eval',
    `require('node:dns').lookup('${alias}', { all: true }, function (e, a) { process.stdout.write(JSON.stringify(e ? [] : a.map(function (x) { return x.address; }))); });`,
  ]);
  return JSON.parse(stdout) as string[];
}

export const MODEL_RELAY_REACHES_THE_DOCKER_HOST_ONLY_AS_DECLARED = runtime({
  id: 'I4.model-relay-reaches-the-docker-host-only-as-declared',
  title:
    'a relay declared local reaches its endpoint on the Docker host over http, on a port the provider was given, with no credential and none of the task\'s, ' +
    'metered as any relay is; the route is the relay container\'s alone, so the sandbox reaches the endpoint by no name or address; ' +
    'a port the provider was not given, or a provider given none, is refused at provisioning; and the relay goes with the sandbox (A-R21-01..03)',
  run: async () => {
    const endpoint = await startEndpoint();
    try {
      await withSandboxDirs('i4-local-endpoint-', async (dirs) => {
        const { EGRESS_PROXY_IMAGE, LOCAL_UPSTREAM_ALIAS, LocalDockerProvider: Provider, relayOf } = await import('@olympus-ai/sandbox');

        // I4: the route is the provider's to grant. None given, or another port given, refuses the spec naming the port.
        const ungranted = await Provider.create({ vaultPaths: [dirs.vault] });
        const none = await refusalFrom(() => ungranted.provision(specFor(dirs, 'rw', { image: EGRESS_PROXY_IMAGE, relay: localRelay(endpoint.port) })));
        const provider: LocalDockerProvider = await Provider.create({ vaultPaths: [dirs.vault], dockerHostPorts: [endpoint.port] });
        const other = endpoint.port === 65535 ? endpoint.port - 1 : endpoint.port + 1;
        const elsewhere = await refusalFrom(() => provider.provision(specFor(dirs, 'rw', { image: EGRESS_PROXY_IMAGE, relay: localRelay(other) })));
        for (const [what, refusal, port] of [['a provider given no port', none, endpoint.port], ['a port not given', elsewhere, other]] as const) {
          if (refusal.layer !== 'relay' || !refusal.message.includes(String(port))) {
            throw new Error(`I4: ${what} was refused at the ${refusal.layer} layer with: ${refusal.message}`);
          }
        }

        const handle: SandboxHandle = await provider.provision(specFor(dirs, 'rw', { image: EGRESS_PROXY_IMAGE, relay: localRelay(endpoint.port) }));
        const applied = relayOf(provider.appliedControls(handle).egress);
        let destroyed = false;
        try {
          if (applied === undefined) throw new Error('I4: a spec with a local relay was provisioned without one');
          const route = `${LOCAL_UPSTREAM_ALIAS}:host-gateway`;
          if (
            applied.local !== 'docker-host' ||
            applied.credential !== null ||
            applied.upstream !== `http://${LOCAL_UPSTREAM_ALIAS}:${String(endpoint.port)}` ||
            applied.runArgs.filter((arg) => arg === route).length !== 1 ||
            applied.runArgs.some((arg, i) => applied.runArgs[i - 1] === '--env' && arg.split('=')[0] === 'RELAY_CREDENTIAL')
          ) {
            throw new Error(`I4: the local relay was applied as ${JSON.stringify({ ...applied, runArgs: applied.runArgs.filter((a) => !a.includes('\n')) })}`);
          }

          // The granted call reaches the endpoint, and nothing the task sent as a key goes with it.
          const call = await provider.exec(handle, ['node', '--eval', CLIENT]);
          const answer = JSON.parse(call.stdout) as { status: number; body: string };
          if (answer.status !== 200 || (JSON.parse(answer.body) as { model?: unknown }).model !== LOCAL_MODEL) {
            throw new Error(`I4: the granted call through the local relay was answered ${call.stdout} ${call.stderr}`);
          }
          if (endpoint.seen.length !== 1 || endpoint.seen[0]?.method !== 'POST' || endpoint.seen[0].url !== CHAT_PATH) {
            throw new Error(`I4: the endpoint received ${JSON.stringify(endpoint.seen.map((s) => `${s.method} ${s.url}`))}`);
          }
          const leaked = ['authorization', 'x-api-key', 'api-key', 'proxy-authorization'].filter((h) => endpoint.seen[0]?.headers[h] !== undefined);
          if (leaked.length > 0) throw new Error(`I4: the endpoint received the task's ${leaked.join(', ')}`);

          // The route is the relay's: from the sandbox, the endpoint is reachable by no name and no address.
          const hosts = [LOCAL_UPSTREAM_ALIAS, 'host.docker.internal', ...(await gatewayAddresses(applied.containerId, LOCAL_UPSTREAM_ALIAS))];
          if (hosts.length < 3) throw new Error('I4: the relay container resolved no address for the host gateway');
          const direct = await provider.exec(handle, ['node', '--eval', DIRECT, String(endpoint.port), JSON.stringify(hosts)]);
          const attempts = JSON.parse(direct.stdout) as string[];
          // Read again, not narrowed: the endpoint records asynchronously, and a request from the sandbox would land here.
          if (attempts.length !== hosts.length || attempts.some((line) => line.includes(' reached ')) || [...endpoint.seen].length !== 1) {
            throw new Error(`I4: the sandbox reached the Docker host's endpoint without the relay: ${direct.stdout}`);
          }

          destroyed = true;
          const reading = (await provider.destroy(handle)).meter;
          if (reading.kind !== 'metered' || reading.calls !== 1 || reading.inputTokens !== 100 || reading.outputTokens !== 10) {
            throw new Error(`I4: the local relay's call was read as ${JSON.stringify(reading)}`);
          }
        } finally {
          if (!destroyed) await provider.destroy(handle).catch(() => undefined);
        }

        for (const [kind, name] of [
          ['container', applied.name],
          ['network', applied.internalNetwork],
          ['network', applied.outboundNetwork],
        ] as const) {
          if (await dockerHas(kind, name)) throw new Error(`I4: the ${kind} ${name} outlived the sandbox its local relay served`);
        }
      });
    } finally {
      await endpoint.close();
    }
  },
});

/** A port nothing is listening on, for the relay's start to bind. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((done) => server.close(() => { done(); }));
  return port;
}

/** Runs the relay's own source on the host with `env`, and returns how it ended within a few seconds and what it wrote. */
async function relayStart(source: string, env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  const child = spawn(process.execPath, ['--eval', source], { env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (c: Buffer) => (output += c.toString('utf8')));
  child.stderr.on('data', (c: Buffer) => (output += c.toString('utf8')));
  return new Promise((done) => {
    const timer = setTimeout(() => {
      child.kill();
    }, 5000);
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
    child.stdout.on('data', () => {
      if (output.includes('listening')) child.kill();
    });
  });
}

export const MODEL_RELAY_REFUSES_AN_UNDECLARED_LOCAL_ENDPOINT = runtime({
  id: 'I5.model-relay-refuses-an-undeclared-local-endpoint',
  title:
    'http and an absent credential are each reached only by declaration: an http URL, localhost included, is refused; a null credential is refused ' +
    'without the none scheme, the none scheme without a null credential, and either with an https upstream; an absent credential is refused, never read as none; ' +
    'a local upstream with a bad port, another host, or another field is refused; and the relay\'s own start refuses the same when handed them (A-R21-01, A-R21-02)',
  run: async () => {
    const { checkRelay, LOCAL_UPSTREAM_ALIAS, RELAY_SOURCE, SandboxRefusal } = await import('@olympus-ai/sandbox');
    const held = new Set(['model']);
    const ports = new Set([11434]);
    const base = localRelay(11434);
    const keyed = { ...base, upstream: 'https://models.example', scheme: 'bearer', credential: 'model' } as const;
    // The declared case is accepted, so every refusal below is the one change it names.
    const plan = checkRelay(base, held, ports);
    if (plan.credential !== null || plan.local !== 'docker-host' || plan.upstream !== `http://${LOCAL_UPSTREAM_ALIAS}:11434`) {
      throw new Error(`I5: a declared local relay was planned as ${JSON.stringify(plan)}`);
    }
    checkRelay(keyed, held, ports);

    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, RegExp]> = [
      ['an http URL', { ...keyed, upstream: 'http://models.example' }, /relay\.upstream/u],
      ['localhost over http', { ...base, upstream: 'http://localhost:11434' }, /relay\.upstream/u],
      ['host.docker.internal over http', { ...keyed, upstream: `http://host.docker.internal:11434` }, /relay\.upstream/u],
      ['a null credential with an https upstream', { ...keyed, scheme: 'none', credential: null }, /local/u],
      ['a null credential under raw', { ...base, scheme: 'raw' }, /relay\.credential/u],
      ['a null credential under bearer', { ...base, scheme: 'bearer' }, /relay\.credential/u],
      ['the none scheme with a credential', { ...base, credential: 'model' }, /relay\.credential/u],
      ['no credential at all', { ...base, credential: undefined }, /relay\.credential/u],
      ['an empty credential under none', { ...base, credential: '' }, /relay\.credential/u],
      ['port 0', { ...base, upstream: { local: 'docker-host', port: 0 } }, /port/u],
      ['port 65536', { ...base, upstream: { local: 'docker-host', port: 65536 } }, /port/u],
      ['a fractional port', { ...base, upstream: { local: 'docker-host', port: 80.5 } }, /port/u],
      ['a port as text', { ...base, upstream: { local: 'docker-host', port: '11434' } }, /port/u],
      ['another local host', { ...base, upstream: { local: 'lan', port: 11434 } }, /docker-host/u],
      ['a port the provider was not given', { ...base, upstream: { local: 'docker-host', port: 11435 } }, /11435/u],
      ['a local upstream naming a host', { ...base, upstream: { local: 'docker-host', port: 11434, host: 'gpu.lan' } }, /relay\.upstream/u],
    ];
    for (const [what, spec, cause] of cases) {
      let refused: unknown;
      try {
        checkRelay(spec as unknown as RelaySpec, held, ports);
      } catch (error) {
        refused = error;
      }
      if (!(refused instanceof SandboxRefusal) || refused.layer !== 'relay' || !cause.test(refused.message)) {
        throw new Error(`I5: ${what} was not refused at the relay layer for its cause: ${refused instanceof Error ? refused.message : 'accepted'}`);
      }
    }

    // The relay's own start: handed what checkRelay refuses, it exits before it listens.
    const env = {
      RELAY_UPSTREAM: `http://${LOCAL_UPSTREAM_ALIAS}:11434`,
      RELAY_LOCAL: 'docker-host',
      RELAY_PATHS: JSON.stringify([CHAT_PATH]),
      RELAY_HEADER: 'api-key',
      RELAY_SCHEME: 'none',
      RELAY_PORT: String(await freePort()),
      RELAY_BUDGET: JSON.stringify({ maxTokens: 1000, maxCostUsd: 1 }),
      RELAY_METER: JSON.stringify(METER),
    };
    const started = await relayStart(RELAY_SOURCE, env);
    if (!started.output.includes('listening')) {
      throw new Error(`I5: the relay's start refused a declared local endpoint: ${started.output}`);
    }
    const starts: ReadonlyArray<readonly [string, Record<string, string>, RegExp]> = [
      ['an http upstream not started local', { ...env, RELAY_LOCAL: '', RELAY_SCHEME: 'bearer', RELAY_CREDENTIAL: 'model' }, /https origin/u],
      ['a local upstream naming another host', { ...env, RELAY_UPSTREAM: 'http://gpu.lan:11434' }, /local upstream/u],
      ['a local upstream over https', { ...env, RELAY_UPSTREAM: `https://${LOCAL_UPSTREAM_ALIAS}:11434` }, /local upstream/u],
      ['no credential under raw', { ...env, RELAY_SCHEME: 'raw' }, /no credential/u],
      ['no credential with an https upstream', { ...env, RELAY_LOCAL: '', RELAY_UPSTREAM: 'https://models.example' }, /no credential/u],
      ['a credential under none', { ...env, RELAY_CREDENTIAL: 'model' }, /none/u],
    ];
    for (const [what, given, cause] of starts) {
      const ended = await relayStart(RELAY_SOURCE, given);
      if (ended.code === 0 || ended.code === null || ended.output.includes('listening') || !cause.test(ended.output)) {
        throw new Error(`I5: the relay started with ${what}, or refused it for another cause (exit ${String(ended.code)}): ${ended.output}`);
      }
    }
  },
});
