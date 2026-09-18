/**
 * The egress allowlist, against a real daemon.
 *
 * Hermetic: nothing here reaches the internet. The allowlisted host is an
 * origin container this suite starts on the proxy's own outbound network, so
 * "reaches an allowlisted host" is observed rather than assumed, and a host
 * that is refused is refused while being demonstrably reachable *from the
 * proxy*. That is the difference that matters — a test whose denied host was
 * simply unreachable would pass against a provider with no allowlist at all.
 *
 * These tests require Docker and fail without it, for the reason `local.test.ts`
 * gives: the network layer is where an allowlist is enforced, and there is no
 * way to observe an enforcement that has no container to enforce it in (I5,
 * D-P2-02).
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  EGRESS_PROXY_IMAGE,
  LocalDockerProvider,
  PROXY_ALIAS,
  PROXY_PORT,
  SandboxRefusal,
  type AppliedControls,
  type SandboxHandle,
  type SandboxSpec,
} from '../src/index.js';
import { TEST_IMAGE } from './image.js';

const run = promisify(execFile);

/** What the origin container answers with, so a body that arrives is known to have come from it. */
const ORIGIN_BODY = 'origin-reached';
const ORIGIN_PORT = 8080;

/** A host that is not on the allowlist and does not resolve anywhere: the refusal must be the list, and must come before any lookup. */
const BLOCKED_NAME = 'blocked.invalid';

/** A documentation-range address (RFC 5737), so a refusal by address cannot be an accident of the local network. */
const BLOCKED_ADDRESS = '198.51.100.9';

const ORIGIN_SOURCE =
  "require('node:http').createServer(function (q, s) { s.end('" + ORIGIN_BODY + "'); })" +
  '.listen(' + String(ORIGIN_PORT) + ", '0.0.0.0');";

/** An origin that reports back the Host header it received, so what the upstream was asked for is observed and not inferred. */
const ECHO_SOURCE =
  "require('node:http').createServer(function (q, s) { s.end('HOST-SEEN=' + String(q.headers.host)); })" +
  '.listen(' + String(ORIGIN_PORT) + ", '0.0.0.0');";

/**
 * A proxied GET whose Host header the caller chooses, run inside the sandbox.
 * `path` is absolute-form, which is how a proxy is addressed; the Host header
 * is separate and is what a fronting attempt controls.
 */
function frontingClient(origin: string, hostHeader: string): string {
  return (
    "const r = require('node:http').request(" +
    `{ host: '${PROXY_ALIAS}', port: ${String(PROXY_PORT)}, method: 'GET', ` +
    `path: 'http://${origin}:${String(ORIGIN_PORT)}/', headers: { host: '${hostHeader}' } }, ` +
    "function (a) { let b = ''; a.on('data', function (d) { b += d; }); " +
    "a.on('end', function () { console.log('STATUS=' + String(a.statusCode) + ' BODY=' + b); }); });" +
    "r.on('error', function (e) { console.log('ERROR=' + e.message); }); r.end();"
  );
}

let provider: LocalDockerProvider;
let base: string;
let workspace: string;
const live: SandboxHandle[] = [];
const origins: string[] = [];

function specFor(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: TEST_IMAGE,
    mounts: { workspace: { source: workspace, target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 120_000 },
    ...overrides,
  };
}

async function provisionWith(allow: readonly string[]): Promise<SandboxHandle> {
  const handle = await provider.provision(specFor({ egress: { mode: 'allowlist', allow: [...allow] } }));
  live.push(handle);
  return handle;
}

/**
 * The allowlist branch of the applied controls, or a failure. Narrowing here
 * rather than in each test keeps a `deny-all` sandbox from silently satisfying
 * an assertion written about an allowlist.
 */
function allowlistControls(handle: SandboxHandle): AppliedControls & { egress: { mode: 'allowlist' } } {
  const controls = provider.appliedControls(handle);
  if (controls.egress.mode !== 'allowlist') throw new Error(`expected an allowlist sandbox, got ${controls.egress.mode}`);
  return controls as AppliedControls & { egress: { mode: 'allowlist' } };
}

/** Starts the origin on the proxy's outbound network and waits for it to answer. The sandbox is never on that network. */
async function startOrigin(name: string, network: string, source: string = ORIGIN_SOURCE): Promise<string> {
  origins.push(name);
  await run('docker', [
    'run', '--detach', '--init', '--name', name,
    '--network', network, '--network-alias', name,
    EGRESS_PROXY_IMAGE, 'node', '--eval', source,
  ]);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await run('docker', ['exec', name, 'node', '--eval',
        `require('node:net').connect(${String(ORIGIN_PORT)}, '127.0.0.1').on('connect', function () { process.exit(0); }).on('error', function () { process.exit(1); });`,
      ]);
      const { stdout } = await run('docker', ['inspect', '--format', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name]);
      return stdout.trim();
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw new Error(`the origin container ${name} never listened`);
}

/** One raw request to the proxy, spoken from inside the sandbox. Raw, so the proxy's own answer is read rather than a client's summary of it. */
async function throughProxy(handle: SandboxHandle, request: string): Promise<string> {
  const result = await provider.exec(handle, [
    'sh', '-c', `printf '${request}\\r\\n\\r\\n' | nc -w 4 ${PROXY_ALIAS} ${String(PROXY_PORT)}`,
  ]);
  return result.stdout + result.stderr;
}

/**
 * Removes one origin container. A test that destroys its sandbox while the
 * origin is still attached to the proxy's outbound network is asking the
 * provider to remove a network that still has an endpoint on it, which Docker
 * refuses and the provider reports rather than swallows. The order is the
 * test's to get right.
 */
async function removeOrigin(name: string): Promise<void> {
  await run('docker', ['rm', '--force', '--volumes', name]);
  const at = origins.indexOf(name);
  if (at !== -1) origins.splice(at, 1);
}

/** The egress networks Docker currently holds, so a leak is counted against what was there before rather than against the whole host. */
async function egressNetworks(): Promise<string[]> {
  const { stdout } = await run('docker', ['network', 'ls', '--format', '{{.Name}}']);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('egress-'));
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

async function refusal(body: () => unknown): Promise<SandboxRefusal> {
  try {
    await body();
  } catch (error) {
    if (error instanceof SandboxRefusal) return error;
    throw error;
  }
  throw new Error('expected a SandboxRefusal, but the call returned');
}

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'egress-allowlist-'));
  workspace = join(base, 'workspace');
  await mkdir(workspace, { recursive: true });
  provider = await LocalDockerProvider.create({ vaultPaths: [] });
});

afterEach(async () => {
  while (origins.length > 0) {
    const name = origins.pop();
    if (name === undefined) continue;
    try {
      await run('docker', ['rm', '--force', '--volumes', name]);
    } catch {
      // Already gone, or never started.
    }
  }
  while (live.length > 0) {
    const handle = live.pop();
    if (handle === undefined) continue;
    try {
      await provider.destroy(handle);
    } catch {
      // Already destroyed by the test, or by the wall clock.
    }
  }
  await rm(base, { recursive: true, force: true });
});

describe('an allowlist is applied, and is the only route out', () => {
  test('the allowlisted host is reached and every other host is refused, by name and by address', async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provisionWith([originName]);
    const controls = allowlistControls(handle);
    const originAddress = await startOrigin(originName, controls.egress.proxy.outboundNetwork);

    // The grant: the named host is reached, and the body proves it was the origin that answered
    // and not the proxy answering on its behalf.
    const allowed = await provider.exec(handle, [
      'sh', '-c', `wget -T 8 -O - http://${originName}:${String(ORIGIN_PORT)}/ 2>&1`,
    ]);
    expect(allowed.stdout).toContain(ORIGIN_BODY);
    expect(allowed.exitCode).toBe(0);

    // Refused by name, before any lookup: the proxy never resolves a host it will not open.
    const byName = await throughProxy(handle, `GET http://${BLOCKED_NAME}/ HTTP/1.0`);
    expect(byName).toContain('403');
    expect(byName).toContain(BLOCKED_NAME);

    // Refused by address, so the refusal is not DNS alone.
    const byAddress = await throughProxy(handle, `GET http://${BLOCKED_ADDRESS}/ HTTP/1.0`);
    expect(byAddress).toContain('403');
    expect(byAddress).toContain(BLOCKED_ADDRESS);

    // The strongest form: the origin's own address, which the proxy can certainly reach, because
    // it just did — under a different name. It is refused for the one reason under test, that the
    // address is not on the list. A denied host that was merely unreachable would prove nothing.
    const sameHostByAddress = await throughProxy(handle, `GET http://${originAddress}:${String(ORIGIN_PORT)}/ HTTP/1.0`);
    expect(sameHostByAddress).toContain('403');
    expect(sameHostByAddress).not.toContain(ORIGIN_BODY);
  });

  test('CONNECT is tunnelled for an allowlisted host and refused for every other, with nothing inside the connection read', async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provisionWith([originName]);
    const controls = allowlistControls(handle);
    await startOrigin(originName, controls.egress.proxy.outboundNetwork);

    const opened = await throughProxy(handle, `CONNECT ${originName}:${String(ORIGIN_PORT)} HTTP/1.1`);
    expect(opened).toContain('200 Connection Established');

    const refused = await throughProxy(handle, `CONNECT ${BLOCKED_NAME}:443 HTTP/1.1`);
    expect(refused).toContain('403');
    expect(refused).toContain(BLOCKED_NAME);
  });

  test('the direct route does not exist: unsetting every proxy variable reaches nothing at all', async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provisionWith([originName]);
    const controls = allowlistControls(handle);
    const originAddress = await startOrigin(originName, controls.egress.proxy.outboundNetwork);

    // There is no default route, so there is nothing to ask politely not to use. Asserted on the
    // routing table as well as on a failed request: a request also fails when a tool is missing.
    const routes = await provider.exec(handle, ['sh', '-c', 'ip route']);
    expect(routes.stdout).not.toContain('default');

    const bypass =
      'unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY; ' +
      `wget -T 4 -O - http://${originAddress}:${String(ORIGIN_PORT)}/ 2>&1`;
    const direct = await provider.exec(handle, ['sh', '-c', bypass]);
    expect(direct.exitCode).not.toBe(0);
    expect(direct.stdout + direct.stderr).not.toContain(ORIGIN_BODY);
    expect(direct.stdout + direct.stderr).toContain('unreachable');

    // And nothing off the subnet at all, by an address the proxy was never asked about.
    const elsewhere = await provider.exec(handle, ['sh', '-c', `wget -T 4 -O /dev/null http://${BLOCKED_ADDRESS}/ 2>&1`]);
    expect(elsewhere.exitCode).not.toBe(0);
  });

  test('removing the proxy from the path makes the allowlisted host unreachable, rather than reachable', async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provisionWith([originName]);
    const controls = allowlistControls(handle);
    const originAddress = await startOrigin(originName, controls.egress.proxy.outboundNetwork);

    const before = await provider.exec(handle, ['sh', '-c', `wget -T 8 -O - http://${originName}:${String(ORIGIN_PORT)}/ 2>&1`]);
    expect(before.stdout).toContain(ORIGIN_BODY);

    // The counterfactual this whole suite rests on. If the reach above had come from anywhere
    // but the proxy, it would survive the proxy being stopped, and this assertion would fail.
    await run('docker', ['stop', '--timeout', '1', controls.egress.proxy.containerId]);
    const after = await provider.exec(handle, ['sh', '-c', `wget -T 8 -O - http://${originName}:${String(ORIGIN_PORT)}/ 2>&1`]);
    expect(after.exitCode).not.toBe(0);
    expect(after.stdout + after.stderr).not.toContain(ORIGIN_BODY);

    // And with the proxy variables unset, so the failure above is not merely wget being pointed
    // at a stopped proxy. With no proxy and no route there is no way out at all; without this
    // second half the assertion would pass even against a network that had a default route.
    // External review of P10, finding 3.
    const direct = await provider.exec(handle, [
      'sh', '-c',
      'unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY no_proxy NO_PROXY; ' +
        `wget -T 4 -O - http://${originAddress}:${String(ORIGIN_PORT)}/ 2>&1`,
    ]);
    expect(direct.exitCode).not.toBe(0);
    expect(direct.stdout + direct.stderr).not.toContain(ORIGIN_BODY);
    expect(direct.stdout + direct.stderr).toContain('unreachable');
  });
});

describe('the grant is the host the upstream is asked for', () => {
  test("a client's own Host header is discarded: an allowlisted host is asked for the host that was granted", async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provider.provision(
      // The node image as the sandbox, so the probe can set a Host header exactly. Busybox wget
      // cannot, and the header is the whole of what this assertion is about.
      specFor({ image: EGRESS_PROXY_IMAGE, egress: { mode: 'allowlist', allow: [originName] } }),
    );
    live.push(handle);
    const controls = allowlistControls(handle);
    await startOrigin(originName, controls.egress.proxy.outboundNetwork, ECHO_SOURCE);

    // The control: an honest client, whose Host names the host it asked for.
    const honest = await provider.exec(handle, ['node', '--eval', frontingClient(originName, `${originName}:${String(ORIGIN_PORT)}`)]);
    expect(honest.stdout).toContain(`HOST-SEEN=${originName}:${String(ORIGIN_PORT)}`);

    // The attack: absolute-form to the granted host, carrying someone else's Host. The
    // connection goes to a granted host either way; what is under test is which site the
    // infrastructure in front of it would be asked to serve. RFC 7230 5.3.2 requires the
    // received Host to be replaced by the one in the request target.
    const fronted = await provider.exec(handle, ['node', '--eval', frontingClient(originName, 'evil.example')]);
    expect(fronted.stdout).not.toContain('HOST-SEEN=evil.example');
    expect(fronted.stdout).toContain(`HOST-SEEN=${originName}:${String(ORIGIN_PORT)}`);
  });

  test('an authority whose port is not a port is refused, and the proxy survives to refuse the next one', async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provisionWith([originName]);
    const controls = allowlistControls(handle);
    await startOrigin(originName, controls.egress.proxy.outboundNetwork);

    // The host half is on the allowlist and the port half is not a number. Passing that on
    // reaches the socket layer as NaN, which throws where nothing catches it.
    const malformed = await throughProxy(handle, `CONNECT ${originName}:${String(ORIGIN_PORT)}@evil.example HTTP/1.1`);
    expect(malformed).toContain('403');

    const running = await run('docker', ['inspect', '--format', '{{.State.Running}}', controls.egress.proxy.containerId]);
    expect(running.stdout.trim()).toBe('true');

    // The sandbox still has the egress it was granted. A proxy that died here would take the
    // only route out with it, and the run would fail for a reason nothing recorded.
    const after = await provider.exec(handle, ['sh', '-c', `wget -T 8 -O - http://${originName}:${String(ORIGIN_PORT)}/ 2>&1`]);
    expect(after.stdout).toContain(ORIGIN_BODY);
  });
});

describe('what the proxy records, and what that is not', () => {
  test('each connection is one line on the proxy container stdout, and it goes when the sandbox goes', async () => {
    const originName = `egress-origin-${randomUUID()}`;
    const handle = await provisionWith([originName]);
    const controls = allowlistControls(handle);
    await startOrigin(originName, controls.egress.proxy.outboundNetwork);

    await provider.exec(handle, ['sh', '-c', `wget -T 8 -O - http://${originName}:${String(ORIGIN_PORT)}/ 2>&1`]);
    await throughProxy(handle, `GET http://${BLOCKED_NAME}/ HTTP/1.0`);

    const logs = await run('docker', ['logs', controls.egress.proxy.containerId]);
    const lines = logs.stdout + logs.stderr;
    expect(lines).toContain(`egress-proxy: opened ${originName}`);
    expect(lines).toContain(`egress-proxy: refused ${BLOCKED_NAME}`);

    // What this is not. The line lives in the proxy container and is destroyed with it, so it is
    // readable during a run and is not evidence afterwards. Nothing collects it into an evidence
    // bundle, and this unit claims nothing more than the line; collection is P6's.
    await removeOrigin(originName);
    await provider.destroy(handle);
    live.length = 0;
    expect(await containerExists(controls.egress.proxy.name)).toBe(false);
  });
});

describe('the applied controls are the evidence', () => {
  test('appliedControls records the allowlist, the proxy, and the argv both containers were started with', async () => {
    const handle = await provisionWith(['Example.COM', 'example.com', '192.0.2.10']);
    const controls = allowlistControls(handle);

    // Normalised as the proxy matches: lower-cased, and the duplicate collapsed.
    expect(controls.egress.allow).toStrictEqual(['example.com', '192.0.2.10']);
    expect(controls.egress.network).toBe(controls.egress.proxy.internalNetwork);
    expect(controls.egress.proxy.endpoint).toBe(`${PROXY_ALIAS}:${String(PROXY_PORT)}`);

    // The sandbox is on the internal network and on nothing else.
    expect(controls.runArgs).toStrictEqual(expect.arrayContaining(['--network', controls.egress.proxy.internalNetwork]));
    expect(controls.runArgs).not.toContain(controls.egress.proxy.outboundNetwork);

    // The proxy's argv carries the allowlist it was started with, so what it was told is readable
    // beside what it did.
    expect(controls.egress.proxy.runArgs).toStrictEqual(
      expect.arrayContaining(['--env', 'EGRESS_ALLOW=example.com,192.0.2.10']),
    );
    expect(controls.egress.proxy.runArgs).toStrictEqual(expect.arrayContaining(['--network-alias', PROXY_ALIAS]));

    const { stdout } = await run('docker', [
      'inspect', '--format', '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', controls.containerId,
    ]);
    expect(stdout.trim().split(/\s+/)).toStrictEqual([controls.egress.proxy.internalNetwork]);
  });

  test('the proxy and both its networks are destroyed with the sandbox they serve', async () => {
    const handle = await provisionWith(['example.com']);
    const { egress } = allowlistControls(handle);
    expect(await containerExists(egress.proxy.name)).toBe(true);
    expect(await networkExists(egress.proxy.internalNetwork)).toBe(true);
    expect(await networkExists(egress.proxy.outboundNetwork)).toBe(true);

    await provider.destroy(handle);
    live.length = 0;

    expect(await containerExists(egress.proxy.name)).toBe(false);
    expect(await networkExists(egress.proxy.internalNetwork)).toBe(false);
    expect(await networkExists(egress.proxy.outboundNetwork)).toBe(false);
  });

  test('a sandbox that could not start leaves no proxy and no network behind', async () => {
    const before = await egressNetworks();

    // A spec that gets past every check and then fails at `docker run`: the image does not exist,
    // which is only discovered after the proxy has been stood up for it.
    const error = await refusal(() =>
      provider.provision(
        specFor({ image: 'no-such-image-for-p10:latest', egress: { mode: 'allowlist', allow: ['example.com'] } }),
      ),
    );
    expect(error.layer).toBe('image');

    expect(await egressNetworks()).toStrictEqual(before);
    const containers = await run('docker', ['ps', '--all', '--format', '{{.Names}}']);
    expect(containers.stdout).not.toContain('egress-proxy-');
  });
});
