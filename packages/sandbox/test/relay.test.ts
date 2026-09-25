/**
 * The model relay, against a real daemon (P12).
 *
 * The relay holds a credential the sandbox never does, and forwards the
 * sandbox's requests to one upstream with it, for a granted set of paths. Every
 * property is observed from inside a real sandbox against a real TLS upstream
 * this suite owns, and the credential here is a canary made for the run: the
 * suite proves where a value goes, and a real key would prove nothing more.
 *
 * These tests require Docker and `openssl`, and fail without either, for the
 * reason `local.test.ts` gives.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  EGRESS_PROXY_IMAGE,
  LocalDockerProvider,
  RELAY_ALIAS,
  RELAY_PORT,
  RELAY_SOURCE,
  RELAY_URL,
  SandboxRefusal,
  StubSandboxProvider,
  checkRelay,
  relayOf,
  type AppliedRelay,
  type RelaySpec,
  type SandboxHandle,
  type SandboxSpec,
} from '../src/index.js';
import { TEST_IMAGE } from './image.js';
import {
  PROCESS_DUMP,
  UPSTREAM_HOST,
  UPSTREAM_MARKER,
  UPSTREAM_ORIGIN,
  UPSTREAM_PORT,
  bodyOf,
  exportContains,
  inspectText,
  makeCertificate,
  rawRequest,
  startUpstream,
  statusOf,
  upstreamLog,
  type Certificate,
} from './upstream.js';

const run = promisify(execFile);

/** The name the specs use for the credential; what the provider holds under it is made fresh per test. */
const CREDENTIAL = 'model';

/** The variable the sandbox is told the relay's address in. Deliberately not a vendor's name: the relay is not one vendor's. */
const URL_VARIABLE = 'MODEL_BASE_URL';

function relaySpec(overrides: Partial<RelaySpec> = {}): RelaySpec {
  return {
    upstream: UPSTREAM_ORIGIN,
    paths: ['/v1/messages'],
    header: 'x-api-key',
    credential: CREDENTIAL,
    urlVariable: URL_VARIABLE,
    ...overrides,
  };
}

let certificate: Certificate;
let secret: string;
let provider: LocalDockerProvider;
let base: string;
let workspace: string;
const live: SandboxHandle[] = [];
const upstreams: string[] = [];

function specFor(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: TEST_IMAGE,
    mounts: { workspace: { source: workspace, target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 120_000 },
    user: { uid: 0, gid: 0 },
    relay: relaySpec(),
    ...overrides,
  };
}

async function provisioned(spec: SandboxSpec = specFor(), using: LocalDockerProvider = provider): Promise<SandboxHandle> {
  const handle = await using.provision(spec);
  live.push(handle);
  return handle;
}

function relayFor(handle: SandboxHandle, using: LocalDockerProvider = provider): AppliedRelay {
  const relay = relayOf(using.appliedControls(handle).egress);
  if (relay === undefined) throw new Error('expected a sandbox with a relay');
  return relay;
}

/** Starts the upstream on the relay's outbound network, where the sandbox is not. */
async function withUpstream(relay: AppliedRelay): Promise<{ name: string; address: string }> {
  const name = `relay-upstream-${randomUUID()}`;
  upstreams.push(name);
  const address = await startUpstream(name, relay.outboundNetwork, certificate, secret);
  return { name, address };
}

/**
 * One raw request to the relay, spoken from inside the sandbox. BusyBox `nc`
 * stops at the end of its input, before a forwarded answer can arrive, so the
 * input is held open until the relay closes the connection (`Connection: close`).
 */
async function toRelay(handle: SandboxHandle, request: string, using: LocalDockerProvider = provider): Promise<string> {
  const result = await using.exec(
    handle,
    ['sh', '-c', `(cat; sleep 8) | nc -w 10 ${RELAY_ALIAS} ${String(RELAY_PORT)}`],
    { stdin: request },
  );
  return result.stdout;
}

async function refusal(body: () => unknown): Promise<SandboxRefusal> {
  try {
    await body();
  } catch (error) {
    if (error instanceof SandboxRefusal) return error;
    throw error;
  }
  throw new Error('expected a SandboxRefusal, but the call returned');
}

async function containerExists(name: string): Promise<boolean> {
  try {
    await run('docker', ['inspect', '--type', 'container', name]);
    return true;
  } catch {
    return false;
  }
}

async function networkExists(name: string): Promise<boolean> {
  try {
    await run('docker', ['network', 'inspect', name]);
    return true;
  } catch {
    return false;
  }
}

/** Removes the upstreams first: a network with one still attached cannot be removed with its sandbox. */
async function removeUpstreams(): Promise<void> {
  while (upstreams.length > 0) {
    const name = upstreams.pop();
    if (name === undefined) continue;
    await run('docker', ['rm', '--force', '--volumes', name]).catch(() => undefined);
  }
}

beforeAll(async () => {
  certificate = await makeCertificate();
});

beforeEach(async () => {
  secret = `canary-${randomUUID()}-${randomUUID()}`;
  base = await mkdtemp(join(tmpdir(), 'relay-'));
  workspace = join(base, 'workspace');
  await mkdir(workspace, { recursive: true });
  provider = await LocalDockerProvider.create({ vaultPaths: [], credentials: { [CREDENTIAL]: secret }, relayTrust: certificate.cert });
});

afterEach(async () => {
  await removeUpstreams();
  while (live.length > 0) {
    const handle = live.pop();
    if (handle === undefined) continue;
    await provider.destroy(handle).catch(() => undefined);
  }
  await rm(base, { recursive: true, force: true });
});

describe('the relay forwards its grant, with its own credential, to its own upstream', () => {
  test("a granted path reaches the upstream with the provider's credential, and the client's key, authorization, and Host are discarded", async () => {
    const handle = await provisioned();
    await withUpstream(relayFor(handle));

    const response = await toRelay(
      handle,
      rawRequest('POST', '/v1/messages?beta=true', {
        'x-api-key': 'a-key-of-the-tasks-own',
        authorization: 'Bearer another-one',
        'content-type': 'application/json',
        'content-length': '2',
      }) + '{}',
    );
    expect(statusOf(response)).toBe(200);
    const seen = JSON.parse(bodyOf(response)) as Record<string, unknown>;
    expect(seen).toMatchObject({
      marker: UPSTREAM_MARKER,
      method: 'POST',
      // The query travels; only the path is checked against the grant.
      url: '/v1/messages?beta=true',
      host: `${UPSTREAM_HOST}:${String(UPSTREAM_PORT)}`,
      keyMatches: true,
      // Exactly one key: the provider's replaced the client's rather than joining it.
      keyCount: 1,
      authorization: null,
      bodyBytes: 2,
    });
  });

  test('a path outside the grant is refused with 403 naming it, and the upstream never sees it', async () => {
    const handle = await provisioned();
    const upstream = await withUpstream(relayFor(handle));

    const refused = [
      '/v1/files',
      '/v1/messagesx',
      '/v1/messages/../files',
      '/v1/messages/%2e%2e/files',
      '/v1//messages',
      '/',
    ];
    for (const path of refused) {
      const response = await toRelay(handle, rawRequest('GET', path));
      expect(statusOf(response), path).toBe(403);
      expect(bodyOf(response), path).toContain(path);
    }
    // A sub-path of the grant is inside it, so the refusals above are the grant's and not a relay refusing everything.
    expect(statusOf(await toRelay(handle, rawRequest('GET', '/v1/messages/count_tokens')))).toBe(200);
    expect(await upstreamLog(upstream.name)).toStrictEqual(['GET /v1/messages/count_tokens']);
  });

  test('an absolute-form target, CONNECT, and a protocol upgrade are refused, so no request names another origin', async () => {
    const handle = await provisioned();
    const upstream = await withUpstream(relayFor(handle));

    expect(statusOf(await toRelay(handle, rawRequest('GET', 'http://elsewhere.invalid/v1/messages')))).toBe(400);
    expect(statusOf(await toRelay(handle, rawRequest('GET', `${UPSTREAM_ORIGIN}/v1/messages`)))).toBe(400);
    expect(statusOf(await toRelay(handle, `CONNECT ${UPSTREAM_HOST}:${String(UPSTREAM_PORT)} HTTP/1.1\r\nHost: x\r\n\r\n`))).toBe(405);
    expect(
      statusOf(await toRelay(handle, rawRequest('GET', '/v1/messages', { upgrade: 'websocket', connection: 'Upgrade' }).replace('Connection: close\r\n', ''))),
    ).toBe(400);
    expect(await upstreamLog(upstream.name)).toStrictEqual([]);
  });

  test('a redirect from the upstream is passed back and never followed', async () => {
    const handle = await provisioned();
    const upstream = await withUpstream(relayFor(handle));

    const response = await toRelay(handle, rawRequest('GET', '/v1/messages/redirect'));
    expect(statusOf(response)).toBe(302);
    expect(response.toLowerCase()).toContain('location: https://elsewhere.invalid/v1/messages');
    expect(await upstreamLog(upstream.name)).toStrictEqual(['GET /v1/messages/redirect']);
  });

  test("the upstream's certificate is verified: a relay that does not trust it forwards nothing", async () => {
    const untrusting = await LocalDockerProvider.create({ vaultPaths: [], credentials: { [CREDENTIAL]: secret } });
    const handle = await untrusting.provision(specFor());
    try {
      const relay = relayFor(handle, untrusting);
      const name = `relay-upstream-${randomUUID()}`;
      upstreams.push(name);
      await startUpstream(name, relay.outboundNetwork, certificate, secret);

      const response = await toRelay(handle, rawRequest('GET', '/v1/messages'), untrusting);
      expect(statusOf(response)).toBe(502);
      expect(bodyOf(response)).not.toContain(UPSTREAM_MARKER);
      expect(await upstreamLog(name)).toStrictEqual([]);
    } finally {
      await removeUpstreams();
      await untrusting.destroy(handle);
    }
  });
});

describe('the credential never enters the sandbox', () => {
  test('no process, file, environment entry, or argument of the sandbox holds it — and the same search finds one that is put there', async () => {
    const handle = await provisioned();
    await withUpstream(relayFor(handle));
    const containerId = provider.appliedControls(handle).containerId;

    // The relay was used, so the scan below runs over a sandbox whose model traffic flowed.
    const used = await toRelay(handle, rawRequest('GET', '/v1/messages'));
    expect(JSON.parse(bodyOf(used))).toMatchObject({ keyMatches: true });

    // A process left running, as the exploit left one, and every process's environment and argv read from inside.
    await provider.exec(handle, ['sh', '-c', 'sleep 300 >/dev/null 2>&1 &']);
    const dumped = await provider.exec(handle, ['sh', '-c', PROCESS_DUMP]);
    expect(dumped.stdout).not.toBe('');
    expect(dumped.stdout).not.toContain(secret);

    expect(await exportContains(containerId, secret)).toBe(false);
    expect(await inspectText(containerId)).not.toContain(secret);
    for (const entry of await readdir(workspace)) {
      expect(await readFile(join(workspace, entry), 'utf8')).not.toContain(secret);
    }

    // The control. The value handed to an exec, as P5 handed the credential, is found by the same
    // process dump and the same export. Without this, "found nothing" could mean the scan looked nowhere.
    await provider.exec(handle, ['sh', '-c', 'sleep 300 >/dev/null 2>&1 & env > /tmp/leaked'], { env: { LEAKED: secret } });
    const leaked = await provider.exec(handle, ['sh', '-c', PROCESS_DUMP]);
    expect(leaked.stdout).toContain(secret);
    expect(await exportContains(containerId, secret)).toBe(true);
  });

  test('appliedControls records the relay by name, and no recorded field holds the value', async () => {
    const handle = await provisioned();
    const controls = provider.appliedControls(handle);
    const relay = relayFor(handle);

    expect(JSON.stringify(controls)).not.toContain(secret);
    expect(relay).toMatchObject({
      upstream: UPSTREAM_ORIGIN,
      paths: ['/v1/messages'],
      header: 'x-api-key',
      credential: CREDENTIAL,
      urlVariable: URL_VARIABLE,
      endpoint: `${RELAY_ALIAS}:${String(RELAY_PORT)}`,
      ownsNetworks: true,
    });
    // The credential is passed by name: the value is on the `docker` process, not in the argv.
    expect(relay.runArgs).toStrictEqual(expect.arrayContaining(['--env', 'RELAY_CREDENTIAL', '--read-only', '--cap-drop', 'ALL']));

    // The sandbox is told where the relay is, and nothing else.
    expect(controls.runArgs).toStrictEqual(expect.arrayContaining(['--env', `${URL_VARIABLE}=${RELAY_URL}`]));
    const told = await provider.exec(handle, ['sh', '-c', `printf %s "$${URL_VARIABLE}"`]);
    expect(told.stdout).toBe(RELAY_URL);
  });
});

describe('the relay is the only route to its upstream', () => {
  test('under deny-all the sandbox is on the relay\'s network alone, and the upstream is unreachable directly, by name and by address', async () => {
    const handle = await provisioned();
    const controls = provider.appliedControls(handle);
    const relay = relayFor(handle);
    const upstream = await withUpstream(relay);

    expect(controls.egress.mode).toBe('deny-all');
    expect(controls.egress.network).toBe(relay.internalNetwork);
    expect(controls.runArgs).toStrictEqual(expect.arrayContaining(['--network', relay.internalNetwork]));
    expect(controls.runArgs).not.toContain(relay.outboundNetwork);
    expect(controls.runArgs.join(' ')).not.toContain('PROXY');
    const { stdout } = await run('docker', ['inspect', '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', controls.containerId]);
    expect(stdout.trim().split(/\s+/)).toStrictEqual([relay.internalNetwork]);

    const routes = await provider.exec(handle, ['sh', '-c', 'ip route']);
    expect(routes.stdout).not.toContain('default');
    // The name does not resolve, and the address has no route: the kernel's answer, not an application's.
    const byName = await provider.exec(handle, ['sh', '-c', `wget -T 3 -O - http://${UPSTREAM_HOST}:${String(UPSTREAM_PORT)}/ 2>&1; echo EXIT=$?`]);
    expect(byName.stdout).toContain('bad address');
    expect(byName.stdout).not.toContain('EXIT=0');
    const byAddress = await provider.exec(handle, ['sh', '-c', `wget -T 3 -O - http://${upstream.address}:${String(UPSTREAM_PORT)}/ 2>&1; echo EXIT=$?`]);
    expect(byAddress.stdout).toContain('unreachable');
    expect(byAddress.stdout).not.toContain('EXIT=0');
  });

  test('beside an allowlist the relay shares the proxy\'s networks, NO_PROXY names it, and the proxy refuses the upstream\'s host', async () => {
    const handle = await provisioned(specFor({ egress: { mode: 'allowlist', allow: ['example.com'] } }));
    const controls = provider.appliedControls(handle);
    if (controls.egress.mode !== 'allowlist') throw new Error('expected an allowlist sandbox');
    const relay = relayFor(handle);
    await withUpstream(relay);

    expect(relay.ownsNetworks).toBe(false);
    expect(relay.internalNetwork).toBe(controls.egress.proxy.internalNetwork);
    expect(relay.outboundNetwork).toBe(controls.egress.proxy.outboundNetwork);
    expect(controls.runArgs).toStrictEqual(expect.arrayContaining([`NO_PROXY=localhost,127.0.0.1,::1,${RELAY_ALIAS}`]));

    const through = await toRelay(handle, rawRequest('GET', '/v1/messages'));
    expect(JSON.parse(bodyOf(through))).toMatchObject({ marker: UPSTREAM_MARKER, keyMatches: true });

    // The upstream's host is not on the allowlist, so the proxy is no second route to it.
    const tunnel = await provider.exec(
      handle,
      ['sh', '-c', `printf 'CONNECT ${UPSTREAM_HOST}:${String(UPSTREAM_PORT)} HTTP/1.1\\r\\n\\r\\n' | nc -w 4 egress-proxy 3128`],
    );
    expect(tunnel.stdout).toContain('403');
  });
});

describe('the relay lives and dies with its sandbox', () => {
  test('under deny-all the relay and both its networks are destroyed with the sandbox', async () => {
    const handle = await provisioned();
    const relay = relayFor(handle);
    expect(await containerExists(relay.name)).toBe(true);

    await provider.destroy(handle);
    expect(await containerExists(relay.name)).toBe(false);
    expect(await networkExists(relay.internalNetwork)).toBe(false);
    expect(await networkExists(relay.outboundNetwork)).toBe(false);
  });

  test('beside an allowlist the relay, the proxy, and their networks are all destroyed with the sandbox', async () => {
    const handle = await provisioned(specFor({ egress: { mode: 'allowlist', allow: ['example.com'] } }));
    const controls = provider.appliedControls(handle);
    if (controls.egress.mode !== 'allowlist') throw new Error('expected an allowlist sandbox');
    const relay = relayFor(handle);

    await provider.destroy(handle);
    expect(await containerExists(relay.name)).toBe(false);
    expect(await containerExists(controls.egress.proxy.name)).toBe(false);
    expect(await networkExists(controls.egress.proxy.internalNetwork)).toBe(false);
    expect(await networkExists(controls.egress.proxy.outboundNetwork)).toBe(false);
  });

  test('a provision that fails after the relay started leaves no relay behind', async () => {
    const before = await run('docker', ['ps', '--all', '--format', '{{.Names}}']);
    const relaysBefore = before.stdout.split(/\r?\n/).filter((n) => n.startsWith('model-relay-'));

    // An image with no shell starts and exits, so the provision is refused after the relay is up.
    const refused = await refusal(() => provider.provision(specFor({ image: EGRESS_PROXY_IMAGE.replace(/@.*/u, '@sha256:' + '0'.repeat(64)) })));
    expect(refused.layer).toBe('image');

    const after = await run('docker', ['ps', '--all', '--format', '{{.Names}}']);
    expect(after.stdout.split(/\r?\n/).filter((n) => n.startsWith('model-relay-'))).toStrictEqual(relaysBefore);
  });
});

describe('a relay that cannot be applied exactly is refused (I5)', () => {
  test('a credential the provider was not given is refused, naming it and never a value', async () => {
    const refused = await refusal(() => provider.provision(specFor({ relay: relaySpec({ credential: 'nobody-gave-me-this' }) })));
    expect(refused.layer).toBe('relay');
    expect(refused.message).toContain('nobody-gave-me-this');
    expect(refused.message).not.toContain(secret);

    const bare = await LocalDockerProvider.create({ vaultPaths: [] });
    expect((await refusal(() => bare.provision(specFor()))).layer).toBe('relay');
  });

  test('an upstream that is not an https origin naming a host is refused', () => {
    const held = new Set([CREDENTIAL]);
    for (const upstream of [
      'http://api.example.com',
      'https://api.example.com/',
      'https://api.example.com/v1',
      'https://api.example.com?x=1',
      'https://user:pass@api.example.com',
      'https://192.0.2.10',
      'https://[::1]',
      'api.example.com',
      '',
    ]) {
      expect(() => checkRelay(relaySpec({ upstream }), held), upstream).toThrow(SandboxRefusal);
    }
    expect(checkRelay(relaySpec({ upstream: 'https://api.example.com' }), held).upstreamHost).toBe('api.example.com');
  });

  test('an empty grant, or a path the relay could not match exactly, is refused rather than read as everything', () => {
    const held = new Set([CREDENTIAL]);
    for (const paths of [[], ['v1/messages'], ['/v1/messages/'], ['/v1/../files'], ['/v1/%2e'], ['/v1/messages?x'], ['/'], ['']]) {
      expect(() => checkRelay(relaySpec({ paths }), held), JSON.stringify(paths)).toThrow(SandboxRefusal);
    }
  });

  test('a header the credential cannot be written to, and a variable that would replace the proxy\'s, are refused', () => {
    const held = new Set([CREDENTIAL]);
    for (const header of ['host', 'Content-Length', 'connection', 'x api key', '']) {
      expect(() => checkRelay(relaySpec({ header }), held), header).toThrow(SandboxRefusal);
    }
    for (const urlVariable of ['HTTPS_PROXY', 'no_proxy', '1URL', 'A=B', '']) {
      expect(() => checkRelay(relaySpec({ urlVariable }), held), urlVariable).toThrow(SandboxRefusal);
    }
  });

  test('a provider given a credential with no value, or under a name a spec could not match, refuses to be built', async () => {
    expect((await refusal(() => LocalDockerProvider.create({ vaultPaths: [], credentials: { model: '' } }))).layer).toBe('relay');
    expect((await refusal(() => LocalDockerProvider.create({ vaultPaths: [], credentials: { 'Not A Name': 'x' } }))).layer).toBe('relay');
  });

  test('the stub provider, which runs commands on the host, refuses every relay', async () => {
    const stub = new StubSandboxProvider();
    expect((await refusal(() => stub.provision(specFor()))).layer).toBe('relay');
  });

  test('the relay itself refuses to start without a credential or a grant', async () => {
    const attempts: Array<Record<string, string>> = [
      { RELAY_UPSTREAM: UPSTREAM_ORIGIN, RELAY_PATHS: '["/v1/messages"]', RELAY_HEADER: 'x-api-key', RELAY_PORT: '8080' },
      { RELAY_CREDENTIAL: 'x', RELAY_UPSTREAM: UPSTREAM_ORIGIN, RELAY_PATHS: '[]', RELAY_HEADER: 'x-api-key', RELAY_PORT: '8080' },
      { RELAY_CREDENTIAL: 'x', RELAY_UPSTREAM: 'http://api.example.com', RELAY_PATHS: '["/v1"]', RELAY_HEADER: 'x-api-key', RELAY_PORT: '8080' },
    ];
    for (const env of attempts) {
      const flags = Object.entries(env).flatMap(([name, value]) => ['--env', `${name}=${value}`]);
      const outcome = await run('docker', ['run', '--rm', ...flags, EGRESS_PROXY_IMAGE, 'node', '--eval', RELAY_SOURCE]).then(
        () => 0,
        (error: unknown) => (error as { code?: number }).code ?? -1,
      );
      expect(outcome, JSON.stringify(env)).not.toBe(0);
    }
  });
});
