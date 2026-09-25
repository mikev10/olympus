/**
 * The model relay: where a sandbox's model credential lives instead of the
 * sandbox (P12).
 *
 * The shape, and why it is this shape:
 *
 * - The credential never enters the sandbox container. A value set on an exec
 *   is readable by every process that exec starts and, through `/proc`, by
 *   later ones (D-P5-20). The relay is a separate container the provider
 *   starts and owns, so its environment is in a PID namespace nothing in the
 *   sandbox can see.
 * - The sandbox addresses the relay by name, over the sandbox's own internal
 *   network, and sends a placeholder where a key would go. The relay discards
 *   every authentication header the client sent, writes the credential into
 *   the one header its grant names, and forwards to one fixed `https` origin
 *   with the certificate verified.
 * - The relay forwards a granted set of path prefixes and refuses everything
 *   else (D-P12-04). An API key reaches more than the one endpoint a CLI needs,
 *   and default deny applies to what a credential can do as well as to where
 *   it can go.
 * - It is not the egress proxy and is not in the proxy's connections
 *   (D-P12-01). The proxy is a blind tunnel that holds nothing; the relay reads
 *   the request line and headers, which it must to check the path and replace
 *   the credential, and streams the body without parsing it.
 *
 * Built the way the proxy is: source passed to `node --eval` in the same
 * pinned image, read-only, every capability dropped, nothing mounted.
 */
import { dockerCli } from './docker.js';
import { normalizeHost } from './egress.js';
import { refuse } from './refusal.js';
import type { RelaySpec } from '../types.js';

/** The port the relay listens on, inside its own container. Nothing is published to the host. */
export const RELAY_PORT = 8080;

/**
 * The name the sandbox reaches the relay by. A network alias rather than the
 * container name, so the address the sandbox is given does not change with the
 * container's generated id.
 */
export const RELAY_ALIAS = 'model-relay';

/** The address the sandbox is given in `RelaySpec.urlVariable`. Plain HTTP: the network is the sandbox's own. */
export const RELAY_URL = `http://${RELAY_ALIAS}:${String(RELAY_PORT)}`;

/**
 * The relay itself. Passed to `node --eval` as one argv element, so there is
 * no shell, no mount, and no image build between this source and what runs.
 *
 * It fails closed at start: no credential, no header, an upstream that is not
 * an `https` origin, an empty grant, or no port each exit non-zero rather than
 * start a server, so a misconfigured relay is a sandbox that never comes up
 * rather than one whose model calls fail later for a reason nothing recorded.
 */
export const RELAY_SOURCE = `'use strict';
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');

function fail(why) {
  console.error('model-relay: ' + why);
  process.exit(1);
}

const credential = String(process.env.RELAY_CREDENTIAL || '');
const header = String(process.env.RELAY_HEADER || '').toLowerCase();
const port = Number(process.env.RELAY_PORT);
const trust = String(process.env.RELAY_TRUST || '');
let upstream = null;
try { upstream = new URL(String(process.env.RELAY_UPSTREAM || '')); } catch (error) { upstream = null; }
let paths = null;
try { paths = JSON.parse(String(process.env.RELAY_PATHS || '')); } catch (error) { paths = null; }

if (credential === '') fail('no credential; a relay that forwarded without one would be an unauthenticated route out');
if (header === '') fail('no header to write the credential to');
if (upstream === null || upstream.protocol !== 'https:' || upstream.pathname !== '/' || upstream.search !== '' ||
    upstream.hash !== '' || upstream.username !== '' || upstream.password !== '') {
  fail('the upstream is not an https origin');
}
if (!Array.isArray(paths) || paths.length === 0 ||
    !paths.every(function (p) { return typeof p === 'string' && p.charAt(0) === '/'; })) {
  fail('no path grant; a relay that forwarded every path would hand the task the whole credential');
}
if (!Number.isInteger(port) || port <= 0) fail('no listen port');

// One path segment: no dot segment, no percent-encoding, nothing an upstream
// could normalise into a path outside the grant. '/v1/messages/../files' is
// refused here rather than trusted to be read the same way on both sides.
const SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

function granted(path) {
  if (path.charAt(0) !== '/') return false;
  if (!path.slice(1).split('/').every(function (s) { return SEGMENT.test(s); })) return false;
  return paths.some(function (p) { return path === p || path.indexOf(p + '/') === 0; });
}

// Never forwarded from the client. The authentication headers because the
// client's key, whatever it is, is not the one this relay vouches for; Host
// because the upstream is fixed; the rest because they describe this hop and
// not the next.
const DROPPED = new Set([
  'authorization', 'x-api-key', 'proxy-authorization', 'host', 'connection', 'keep-alive',
  'proxy-authenticate', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'trailer', 'te']);

function forwarded(source, drop) {
  const named = String(source.connection || '').toLowerCase().split(',').map(function (h) { return h.trim(); });
  const out = {};
  Object.keys(source).forEach(function (name) {
    if (drop.has(name) || named.indexOf(name) !== -1) return;
    out[name] = source[name];
  });
  return out;
}

// One line per request, to this container's stdout, readable with docker logs
// for as long as the sandbox lives. Method and path only: never a header,
// never a body, never the query.
function record(verdict, method, path, status) {
  console.log('model-relay: ' + verdict + ' ' + String(method) + ' ' + JSON.stringify(String(path).slice(0, 200)) +
    (status === undefined ? '' : ' ' + String(status)));
}

const ca = trust === '' ? undefined : tls.rootCertificates.concat([trust]);

const server = http.createServer(function (req, res) {
  const target = String(req.url || '');
  // Origin form only. An absolute-form target names an origin, and the only
  // origin this relay reaches is its own upstream; a request that names
  // another is refused rather than quietly redirected.
  if (target.charAt(0) !== '/') {
    record('refused', req.method, target);
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('model-relay: an origin-form request is required\\n');
    return;
  }
  const query = target.indexOf('?');
  const path = query === -1 ? target : target.slice(0, query);
  if (!granted(path)) {
    record('refused', req.method, path);
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('model-relay: ' + path + ' is not granted\\n');
    return;
  }
  const headers = forwarded(req.headers, DROPPED);
  headers.host = upstream.host;
  headers[header] = credential;
  const outbound = https.request({
    protocol: 'https:',
    hostname: upstream.hostname,
    port: upstream.port === '' ? 443 : Number(upstream.port),
    servername: upstream.hostname,
    method: req.method,
    path: target,
    headers: headers,
    ca: ca,
  }, function (answer) {
    record('forwarded', req.method, path, answer.statusCode);
    // A redirect is passed back, never followed: following one would send the
    // credential to wherever the upstream pointed.
    res.writeHead(answer.statusCode || 502, forwarded(answer.headers, HOP));
    answer.pipe(res);
  });
  outbound.on('error', function (error) {
    record('failed', req.method, path);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('model-relay: upstream failed: ' + String(error.code || error.message) + '\\n');
  });
  req.pipe(outbound);
});

// Neither a tunnel nor a protocol switch: both would carry bytes past the path check.
server.on('connect', function (req, socket) {
  record('refused', 'CONNECT', req.url);
  socket.end('HTTP/1.1 405 Method Not Allowed\\r\\nConnection: close\\r\\n\\r\\n');
});
server.on('upgrade', function (req, socket) {
  record('refused', 'UPGRADE', req.url);
  socket.end('HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n');
});
server.on('clientError', function (error, socket) {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\\r\\nConnection: close\\r\\n\\r\\n');
});

server.listen(port, '0.0.0.0', function () {
  console.log('model-relay listening on ' + String(port) + ' for ' + upstream.origin + ' ' + JSON.stringify(paths));
});
`;

/**
 * A relay request as the provider will apply it: validated, normalised, and
 * carrying the credential's name alone. The value is looked up at start time
 * and never stored beside the plan.
 */
export interface RelayPlan {
  readonly upstream: string;
  readonly upstreamHost: string;
  readonly paths: readonly string[];
  readonly header: string;
  readonly credential: string;
  readonly urlVariable: string;
}

/** What one sandbox's relay was applied with, and the evidence for it. Holds the credential's name and never its value. */
export interface AppliedRelay {
  readonly containerId: string;
  /** The container name, so a leaked relay can be found by name after the run. */
  readonly name: string;
  readonly upstream: string;
  readonly paths: readonly string[];
  readonly header: string;
  /** The name of the credential the relay holds. The value is in no field of this record. */
  readonly credential: string;
  /** The variable the sandbox was given the relay's address in. */
  readonly urlVariable: string;
  /** `host:port`, as the sandbox reaches it. */
  readonly endpoint: string;
  /** The internal network the relay shares with the sandbox. */
  readonly internalNetwork: string;
  /** The relay's own outbound network. The sandbox is never on it. */
  readonly outboundNetwork: string;
  /**
   * Whether the relay created the two networks and removes them. True under
   * `deny-all`, where the relay is the only thing beside the sandbox; false
   * under an allowlist, where it joins the proxy's networks and the proxy
   * removes them.
   */
  readonly ownsNetworks: boolean;
  /** The exact argv `docker run` was given for the relay, so a reviewer can reproduce it. No value in it is secret. */
  readonly runArgs: readonly string[];
}

/** How the relay's own lifecycle commands run. */
export interface RelayOptions {
  readonly executable: string;
  readonly image: string;
  readonly timeoutMs: number;
}

/** A path prefix as the relay matches it: `/`, then segments with no dot segment and no encoding, no trailing slash. */
const PATH_PREFIX = /^(?:\/[A-Za-z0-9_~-][A-Za-z0-9._~-]*)+$/u;

/** An HTTP header name (RFC 9110 token). */
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u;

/** Headers that describe the connection or the framing. Writing a credential into one would break the request or smuggle one. */
const RESERVED_HEADERS = new Set([
  'host', 'connection', 'keep-alive', 'content-length', 'content-type', 'transfer-encoding', 'te', 'trailer', 'upgrade',
  'proxy-authorization', 'proxy-authenticate', 'proxy-connection',
]);

/** A plain environment-variable name, as `ExecOptions.env` requires one. */
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** The variables the provider sets itself under an allowlist. A relay that took one of these names would silently replace the proxy's. */
const RESERVED_VARIABLES = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy']);

/** A credential's name: lower-case letters, digits, and interior hyphens. */
export const CREDENTIAL_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

/**
 * Checks a relay request before any container starts, and refuses every one
 * the provider could not apply exactly as written (I5).
 *
 * `held` is the names of the credentials the provider was given. A request
 * naming any other is refused here: there is no value to put in the relay,
 * and a relay started without one would be a sandbox whose every model call
 * failed with an authentication error that says nothing about the provider.
 */
export function checkRelay(relay: RelaySpec, held: ReadonlySet<string>): RelayPlan {
  let origin: URL | undefined;
  try {
    origin = new URL(relay.upstream);
  } catch {
    origin = undefined;
  }
  const host = origin === undefined ? undefined : normalizeHost(origin.hostname);
  if (
    origin?.protocol !== 'https:' ||
    origin.origin !== relay.upstream ||
    host === undefined ||
    host.includes(':') ||
    /^[0-9.]+$/u.test(host)
  ) {
    refuse(
      'relay',
      `relay.upstream must be an https origin naming a host, with no path, query, credentials, or trailing slash — ` +
        `'https://api.example.com' — not ${JSON.stringify(relay.upstream)}. The relay verifies the upstream's certificate against that name, ` +
        'and anything else is a destination it cannot vouch for.',
    );
  }

  if (!Array.isArray(relay.paths) || relay.paths.length === 0) {
    refuse('relay', 'relay.paths is empty. A relay that forwarded every path would hand the task the whole credential, so an empty grant is refused rather than read as everything.');
  }
  const bad = relay.paths.filter((p) => typeof p !== 'string' || !PATH_PREFIX.test(p));
  if (bad.length > 0) {
    refuse(
      'relay',
      `relay.paths must each be a path prefix of plain segments — no dot segment, no percent-encoding, no query, no trailing slash. ` +
        `Refused: ${bad.map((p) => JSON.stringify(p)).join(', ')}.`,
    );
  }

  if (!HEADER_NAME.test(relay.header) || RESERVED_HEADERS.has(relay.header.toLowerCase())) {
    refuse('relay', `relay.header ${JSON.stringify(relay.header)} is not a header a credential can be written to`);
  }
  if (!ENV_NAME.test(relay.urlVariable) || RESERVED_VARIABLES.has(relay.urlVariable)) {
    refuse('relay', `relay.urlVariable ${JSON.stringify(relay.urlVariable)} is not a plain environment-variable name the provider leaves unset`);
  }
  if (!held.has(relay.credential)) {
    refuse(
      'relay',
      `relay.credential names ${JSON.stringify(relay.credential)}, which this provider was not given. ` +
        'A credential reaches a relay only from LocalDockerOptions.credentials; a spec names one and never carries a value.',
    );
  }
  return {
    upstream: relay.upstream,
    upstreamHost: host,
    paths: [...new Set(relay.paths)],
    header: relay.header.toLowerCase(),
    credential: relay.credential,
    urlVariable: relay.urlVariable,
  };
}

/** Docker's own object names for one sandbox's relay (I10: no Greek name reaches `docker ps`). */
export function relayNames(id: string): { readonly container: string; readonly internal: string; readonly outbound: string } {
  return { container: `model-relay-${id}`, internal: `relay-in-${id}`, outbound: `relay-out-${id}` };
}

/** The networks a relay joins when the proxy already created them. */
export interface SharedNetworks {
  readonly internal: string;
  readonly outbound: string;
}

/** Probed from inside the relay container: the port is open or it is not. */
const READY_SOURCE =
  "require('node:net').connect(Number(process.env.RELAY_PORT), '127.0.0.1')" +
  ".on('connect', function () { process.exit(0); })" +
  ".on('error', function () { process.exit(1); });";

const READY_ATTEMPTS = 40;
const READY_INTERVAL_MS = 250;

function wait(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms).unref();
  });
}

/**
 * Starts the relay for one sandbox.
 *
 * With `shared`, the relay joins networks the proxy created. Without it, the
 * relay creates its own — an internal network with no default route, which the
 * sandbox will join, and an outbound bridge the sandbox never joins — exactly
 * as the proxy does, and removes them when it goes.
 *
 * The credential reaches the container as `--env RELAY_CREDENTIAL` with the
 * value set on the `docker` process, so it is in no argument vector on the
 * host. The daemon does keep the value in the relay container's own
 * configuration, readable with `docker inspect` on the host: the host is the
 * runtime's and inside the trust boundary, and the sandbox has no Docker
 * socket to ask. `trust` is extra root certificates, PEM, for an upstream a private
 * authority signed; it is not secret and travels the same way only because a
 * PEM block is unreadable in an argv.
 *
 * Anything that fails takes the whole attempt down with it.
 */
export async function startRelay(
  id: string,
  plan: RelayPlan,
  credential: string,
  trust: string | undefined,
  shared: SharedNetworks | undefined,
  options: RelayOptions,
): Promise<AppliedRelay> {
  const names = relayNames(id);
  const created: string[] = [];
  let containerId = '';

  const run = async (args: string[], env?: Record<string, string>): Promise<string> => {
    const result = await dockerCli(options.executable, args, { timeoutMs: options.timeoutMs, ...(env === undefined ? {} : { env }) });
    if (result.exitCode !== 0) {
      throw new Error(`docker ${args[0] ?? ''} exited ${String(result.exitCode)}: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result.stdout.trim();
  };

  const internal = shared?.internal ?? names.internal;
  const outbound = shared?.outbound ?? names.outbound;
  try {
    if (shared === undefined) {
      await run(['network', 'create', '--internal', '--driver', 'bridge', names.internal]);
      created.push(names.internal);
      await run(['network', 'create', '--driver', 'bridge', names.outbound]);
      created.push(names.outbound);
    }

    const secrets: Record<string, string> = { RELAY_CREDENTIAL: credential };
    if (trust !== undefined) secrets.RELAY_TRUST = trust;
    const runArgs = [
      'run', '--detach', '--init',
      '--name', names.container,
      '--network', internal,
      '--network-alias', RELAY_ALIAS,
      '--env', `RELAY_UPSTREAM=${plan.upstream}`,
      '--env', `RELAY_PATHS=${JSON.stringify(plan.paths)}`,
      '--env', `RELAY_HEADER=${plan.header}`,
      '--env', `RELAY_PORT=${String(RELAY_PORT)}`,
      // Names only: the values are on the `docker` process, never in this argv.
      ...Object.keys(secrets).flatMap((name) => ['--env', name]),
      '--read-only',
      '--cap-drop', 'ALL',
      options.image,
      'node', '--eval', RELAY_SOURCE,
    ];
    containerId = await run(runArgs, secrets);
    if (containerId === '') throw new Error('docker run reported no container id for the model relay');

    // Attached after the container exists, so the relay is never briefly on a network the sandbox can reach.
    await run(['network', 'connect', outbound, containerId]);

    await requireListening(containerId, options);

    return {
      containerId,
      name: names.container,
      upstream: plan.upstream,
      paths: Object.freeze([...plan.paths]),
      header: plan.header,
      credential: plan.credential,
      urlVariable: plan.urlVariable,
      endpoint: `${RELAY_ALIAS}:${String(RELAY_PORT)}`,
      internalNetwork: internal,
      outboundNetwork: outbound,
      ownsNetworks: shared === undefined,
      runArgs: Object.freeze([...runArgs]),
    };
  } catch (error) {
    await teardown(options, containerId === '' ? names.container : containerId, created);
    throw error;
  }
}

async function requireListening(containerId: string, options: RelayOptions): Promise<void> {
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
    const probe = await dockerCli(options.executable, ['exec', containerId, 'node', '--eval', READY_SOURCE], { timeoutMs: options.timeoutMs });
    if (probe.exitCode === 0) return;
    const alive = await dockerCli(options.executable, ['inspect', '--format', '{{.State.Running}}', containerId], { timeoutMs: options.timeoutMs });
    if (alive.stdout.trim() !== 'true') {
      const logs = await dockerCli(options.executable, ['logs', '--tail', '20', containerId], { timeoutMs: options.timeoutMs });
      throw new Error(`the model relay exited before it listened: ${(logs.stderr + logs.stdout).trim()}`);
    }
    await wait(READY_INTERVAL_MS);
  }
  throw new Error(
    `the model relay did not listen on port ${String(RELAY_PORT)} within ${String((READY_ATTEMPTS * READY_INTERVAL_MS) / 1000)}s`,
  );
}

/** Removes the relay container and then any networks it created. Best effort: every step is attempted. */
async function teardown(options: RelayOptions, container: string, networks: readonly string[]): Promise<Error | undefined> {
  let failure: Error | undefined;
  if (container !== '') {
    const removed = await dockerCli(options.executable, ['rm', '--force', '--volumes', container], { timeoutMs: options.timeoutMs });
    if (removed.exitCode !== 0 && !removed.stderr.includes('No such container')) {
      failure = new Error(`docker rm exited ${String(removed.exitCode)} for the model relay ${container}: ${removed.stderr.trim()}`);
    }
  }
  for (const network of networks) {
    const removed = await dockerCli(options.executable, ['network', 'rm', network], { timeoutMs: options.timeoutMs });
    if (removed.exitCode !== 0 && !removed.stderr.includes('not found')) {
      failure ??= new Error(`docker network rm exited ${String(removed.exitCode)} for ${network}: ${removed.stderr.trim()}`);
    }
  }
  return failure;
}

/**
 * Destroys a relay, and its networks when it created them. Returns the first
 * failure rather than throwing it. Under an allowlist it must run before the
 * proxy's teardown: a network with the relay still on it cannot be removed.
 */
export function stopRelay(applied: AppliedRelay, options: RelayOptions): Promise<Error | undefined> {
  return teardown(options, applied.containerId, applied.ownsNetworks ? [applied.internalNetwork, applied.outboundNetwork] : []);
}
