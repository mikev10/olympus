/**
 * The filtering proxy an `allowlist` egress policy is enforced by.
 *
 * The shape, and why it is this shape:
 *
 * - The sandbox container joins one **internal** Docker network. An internal
 *   network carries no default route, so from inside the container every
 *   address off that subnet is `Network unreachable` — the kernel's answer,
 *   not an application's. There is nothing to bypass, because there is no
 *   second path to take. Unsetting every proxy environment variable does not
 *   produce one.
 * - The only other thing on that network is the proxy, reachable by a fixed
 *   alias. The proxy is also on a second, outbound network, which is where
 *   its own route off the host is. The sandbox is never on that network, and
 *   nothing forwards between the two: the proxy terminates the connection and
 *   opens its own.
 * - The proxy allows or refuses by **host**, and reads nothing inside the
 *   connection. `CONNECT` is a blind tunnel; TLS is never terminated,
 *   inspected, or re-originated. Interception is out of scope for this unit
 *   and not a thing to add later without deciding again: a man-in-the-middle
 *   holding the workspace's credentials is a larger risk than the one it
 *   would close.
 *
 * The proxy runs from source passed on the command line, so no image has to be
 * built and nothing is mounted into the proxy container. The container is the
 * provider's, started with the sandbox and destroyed with it.
 */
import { dockerCli } from './docker.js';

/**
 * The image the proxy runs on, pinned by digest so the filter a reviewer gets
 * is the filter CI got. Node because the proxy is written in it; alpine
 * because the proxy needs nothing else.
 */
export const EGRESS_PROXY_IMAGE = 'node@sha256:b6f26b36c8ff49624cfdac716b8ea1138d606df02586a77d364bb5536a634f85';

/** The port the proxy listens on, inside its own container. Nothing is published to the host. */
export const PROXY_PORT = 3128;

/**
 * The name the sandbox reaches the proxy by. A network alias rather than the
 * container name, so the address the sandbox is given does not change with
 * the container's generated id.
 */
export const PROXY_ALIAS = 'egress-proxy';

/**
 * The proxy itself. Passed to `node --eval` as one argv element, so there is
 * no shell, no mount, and no image build between this source and what runs.
 *
 * It fails closed twice over: an empty allowlist and a missing port each exit
 * non-zero rather than start a server, so a misconfigured proxy is a sandbox
 * that never comes up rather than a route out that grants everything.
 */
export const PROXY_SOURCE = `'use strict';
const http = require('node:http');
const net = require('node:net');

const allow = new Set(
  String(process.env.EGRESS_ALLOW || '')
    .split(',')
    .map(function (h) { return h.trim().toLowerCase(); })
    .filter(function (h) { return h !== ''; })
);
const port = Number(process.env.EGRESS_PORT);

if (allow.size === 0) {
  console.error('egress-proxy: no allowlist; refusing to start a route out that grants everything');
  process.exit(1);
}
if (!Number.isInteger(port) || port <= 0) {
  console.error('egress-proxy: no listen port');
  process.exit(1);
}

// host[:port], with an IPv6 literal bracketed. The port is the caller's; the
// grant is by host, so only the host is matched.
function split(authority) {
  const value = String(authority || '');
  if (value.charAt(0) === '[') {
    const end = value.indexOf(']');
    if (end === -1) return null;
    const rest = value.slice(end + 1);
    if (rest !== '' && rest.charAt(0) !== ':') return null;
    return { host: value.slice(1, end).toLowerCase(), port: rest === '' ? null : rest.slice(1) };
  }
  const colon = value.indexOf(':');
  if (colon === -1) return { host: value.toLowerCase(), port: null };
  return { host: value.slice(0, colon).toLowerCase(), port: value.slice(colon + 1) };
}

function permitted(target) {
  return target !== null && target.host !== '' && allow.has(target.host);
}

function denied(target) {
  return 'egress-proxy: ' + (target === null ? 'the request named no host' : target.host + ' is not on the allowlist');
}

// One line per connection, to this container's stdout. It is readable with
// \`docker logs\` for as long as the sandbox lives and goes when the sandbox
// goes: nothing collects it into an evidence bundle, and this unit claims
// nothing more than the line. Collection is P6's.
function record(verdict, target) {
  console.log('egress-proxy: ' + verdict + ' ' + (target === null ? '(no host)' : target.host));
}

const server = http.createServer(function (req, res) {
  // A proxy is addressed in absolute form. Origin form means the client
  // believes it is talking to the origin server, and answering it would be
  // this proxy pretending to be a host it was never asked about.
  let url = null;
  try { url = new URL(req.url); } catch (error) { url = null; }
  if (url === null || url.protocol !== 'http:') {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('egress-proxy: an absolute-form http:// request is required; https goes through CONNECT\\n');
    return;
  }
  const target = split(url.host);
  if (!permitted(target)) {
    record('refused', target);
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end(denied(target) + '\\n');
    return;
  }
  record('opened', target);
  const upstream = http.request(
    {
      host: target.host,
      port: target.port === null ? 80 : Number(target.port),
      method: req.method,
      path: url.pathname + url.search,
      headers: req.headers,
    },
    function (answer) {
      res.writeHead(answer.statusCode || 502, answer.headers);
      answer.pipe(res);
    }
  );
  upstream.on('error', function (error) {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('egress-proxy: upstream failed: ' + error.message + '\\n');
  });
  req.pipe(upstream);
});

server.on('connect', function (req, socket, head) {
  socket.on('error', function () { socket.destroy(); });
  const target = split(req.url);
  if (!permitted(target)) {
    record('refused', target);
    socket.end('HTTP/1.1 403 Forbidden\\r\\nContent-Type: text/plain\\r\\nConnection: close\\r\\n\\r\\n' + denied(target) + '\\n');
    return;
  }
  record('tunnelled', target);
  // A blind tunnel: bytes are copied, never read. This is the whole of the
  // no-interception rule, and it is why the grant can only ever be by host.
  const upstream = net.connect(target.port === null ? 443 : Number(target.port), target.host, function () {
    socket.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');
    if (head && head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', function (error) {
    socket.end('HTTP/1.1 502 Bad Gateway\\r\\nConnection: close\\r\\n\\r\\negress-proxy: ' + error.message + '\\n');
  });
});

// A malformed request must not take the proxy down with it; the sandbox it
// serves would lose its only route out for a reason it did not cause.
server.on('clientError', function (error, socket) {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n');
});

server.listen(port, '0.0.0.0', function () {
  console.log('egress-proxy listening on ' + String(port) + ' for ' + Array.from(allow).join(','));
});
`;

/**
 * The proxy and the two networks one sandbox's egress was applied with.
 * Recorded rather than assumed: "this container reaches one host" is a claim,
 * and this is the evidence for it, readable by an auditor and by the
 * conformance suite.
 */
export interface AppliedProxy {
  readonly containerId: string;
  /** The container name, so a leaked proxy can be found by name after the run. */
  readonly name: string;
  /** The internal network the sandbox is on. No default route: it is the reason there is nothing to bypass. */
  readonly internalNetwork: string;
  /** The proxy's own outbound network. The sandbox is never on it. */
  readonly outboundNetwork: string;
  /** `host:port`, as the sandbox's proxy environment variables name it. */
  readonly endpoint: string;
  /** The exact argv `docker run` was given for the proxy, so a reviewer can reproduce it. */
  readonly runArgs: readonly string[];
}

/** How long each of the proxy's own lifecycle commands may take. */
export interface ProxyOptions {
  readonly executable: string;
  readonly image: string;
  readonly timeoutMs: number;
}

/** A readiness probe, run inside the proxy container: the port is open or it is not. */
const READY_SOURCE =
  "require('node:net').connect(Number(process.env.EGRESS_PORT), '127.0.0.1')" +
  ".on('connect', function (s) { process.exit(0); })" +
  ".on('error', function () { process.exit(1); });";

/** How many times readiness is probed before the proxy is declared not to have come up, and how long between. */
const READY_ATTEMPTS = 40;
const READY_INTERVAL_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms).unref();
  });
}

/** Docker's own object names, derived from one id so a leak is traceable to the sandbox that leaked it (I10: no Greek name reaches `docker ps`). */
export function proxyNames(id: string): { readonly container: string; readonly internal: string; readonly outbound: string } {
  return { container: `egress-proxy-${id}`, internal: `egress-in-${id}`, outbound: `egress-out-${id}` };
}

/**
 * Creates the two networks and starts the proxy on both.
 *
 * The internal network is created `--internal`, which is what removes the
 * default route from every container on it. The outbound network is an
 * ordinary bridge — a dedicated one rather than Docker's shared default,
 * because the proxy is by design the one thing here allowed off the host, and
 * putting it on the network every other container shares would widen exactly
 * what this unit narrows.
 *
 * Anything that fails takes the whole attempt down with it: the caller gets a
 * thrown error and nothing left running, never a proxy that is half there.
 */
export async function startProxy(id: string, hosts: readonly string[], options: ProxyOptions): Promise<AppliedProxy> {
  const names = proxyNames(id);
  const created: string[] = [];
  let containerId = '';

  const run = async (args: string[]): Promise<string> => {
    const result = await dockerCli(options.executable, args, { timeoutMs: options.timeoutMs });
    if (result.exitCode !== 0) {
      throw new Error(`docker ${args[0] ?? ''} exited ${String(result.exitCode)}: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result.stdout.trim();
  };

  try {
    await run(['network', 'create', '--internal', '--driver', 'bridge', names.internal]);
    created.push(names.internal);
    await run(['network', 'create', '--driver', 'bridge', names.outbound]);
    created.push(names.outbound);

    const runArgs = [
      'run', '--detach', '--init',
      '--name', names.container,
      '--network', names.internal,
      '--network-alias', PROXY_ALIAS,
      '--env', `EGRESS_ALLOW=${hosts.join(',')}`,
      '--env', `EGRESS_PORT=${String(PROXY_PORT)}`,
      // The proxy holds no secret and writes nothing; it needs neither.
      '--read-only',
      '--cap-drop', 'ALL',
      options.image,
      'node', '--eval', PROXY_SOURCE,
    ];
    containerId = await run(runArgs);
    if (containerId === '') throw new Error('docker run reported no container id for the egress proxy');

    // The outbound side is attached after the container exists, so the proxy
    // is never briefly on a network the sandbox can also reach.
    await run(['network', 'connect', names.outbound, containerId]);

    await requireListening(containerId, options);

    return {
      containerId,
      name: names.container,
      internalNetwork: names.internal,
      outboundNetwork: names.outbound,
      endpoint: `${PROXY_ALIAS}:${String(PROXY_PORT)}`,
      runArgs: Object.freeze([...runArgs]),
    };
  } catch (error) {
    await teardown(options, containerId === '' ? names.container : containerId, created);
    throw error;
  }
}

/**
 * Waits until the proxy is answering on its own port, or fails.
 *
 * Probed from inside the proxy container rather than inferred from a log line:
 * a handle must not be returned for a sandbox whose only route out is not yet
 * listening, because the first request would fail as if the host had been
 * refused and the difference matters.
 */
async function requireListening(containerId: string, options: ProxyOptions): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const probe = await dockerCli(options.executable, ['exec', containerId, 'node', '--eval', READY_SOURCE], {
      timeoutMs: options.timeoutMs,
    });
    if (probe.exitCode === 0) return;
    const alive = await dockerCli(options.executable, ['inspect', '--format', '{{.State.Running}}', containerId], {
      timeoutMs: options.timeoutMs,
    });
    if (alive.stdout.trim() !== 'true') {
      const logs = await dockerCli(options.executable, ['logs', '--tail', '20', containerId], { timeoutMs: options.timeoutMs });
      throw new Error(`the egress proxy exited before it listened: ${(logs.stderr + logs.stdout).trim()}`);
    }
    await wait(READY_INTERVAL_MS);
  }
  throw new Error(
    `the egress proxy did not listen on port ${String(PROXY_PORT)} within ` +
      `${String((READY_ATTEMPTS * READY_INTERVAL_MS) / 1000)}s; the sandbox would have had no route out`,
  );
}

/**
 * Removes the proxy container and then its networks, in that order — a
 * network with an endpoint on it cannot be removed. Best effort by design:
 * every step is attempted even when an earlier one failed, so one stuck
 * object does not leave the rest behind.
 */
async function teardown(options: ProxyOptions, container: string, networks: readonly string[]): Promise<Error | undefined> {
  let failure: Error | undefined;
  const note = (error: Error): void => {
    failure ??= error;
  };

  if (container !== '') {
    const removed = await dockerCli(options.executable, ['rm', '--force', '--volumes', container], { timeoutMs: options.timeoutMs });
    // A container that was never created is not a leak; `docker rm` says so and this is not it.
    if (removed.exitCode !== 0 && !removed.stderr.includes('No such container')) {
      note(new Error(`docker rm exited ${String(removed.exitCode)} for the egress proxy ${container}: ${removed.stderr.trim()}`));
    }
  }
  for (const network of networks) {
    const removed = await dockerCli(options.executable, ['network', 'rm', network], { timeoutMs: options.timeoutMs });
    if (removed.exitCode !== 0 && !removed.stderr.includes('not found')) {
      note(new Error(`docker network rm exited ${String(removed.exitCode)} for ${network}: ${removed.stderr.trim()}`));
    }
  }
  return failure;
}

/**
 * Destroys a proxy and both its networks. Returns the first failure rather
 * than throwing it, so a caller already refusing for a better reason decides
 * which to report.
 */
export function stopProxy(applied: AppliedProxy, options: ProxyOptions): Promise<Error | undefined> {
  return teardown(options, applied.containerId, [applied.internalNetwork, applied.outboundNetwork]);
}
