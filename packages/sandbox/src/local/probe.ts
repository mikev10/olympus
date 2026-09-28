/**
 * The HTTP probe: the client an HTTP scenario observes the product through
 * (A-P11-01).
 *
 * The shape, and why it is this shape:
 *
 * - One container per `probe()` call, started with
 *   `--network container:<sandbox>`. It shares the sandbox's network
 *   namespace — its loopback, and under an allowlist its route to the proxy —
 *   and not its filesystem or its process tree. The product can answer the
 *   probe's requests, which is what is being tested, and cannot replace the
 *   probe, which is what makes the answer evidence (D-P11-01).
 * - It joins a namespace that already exists and adds nothing to it that
 *   outlives the call: a deny-all sandbox is still `--network none`, and no
 *   network, route, or container is created for it (D-P11-02).
 * - It connects to the loopback and no other host. The request names a port,
 *   never a URL, so the probe is not a way out of the sandbox.
 * - It observes and decides nothing. Status, headers, and body go to its
 *   stdout as JSON, and the comparison against what the scenario expected runs
 *   in the runtime's own process.
 *
 * Built the way the proxy and relay are: source passed to `node --eval` in the
 * same pinned image, read-only, every capability dropped, nothing mounted.
 */
import type { ProbeExchange, ProbeObservation, ProbeRequest, ProbeResult } from '../types.js';
import { refuse } from './refusal.js';

/** A body larger than this is reported `oversized`, with no body, rather than truncated. */
export const PROBE_BODY_LIMIT_BYTES = 1024 * 1024;

/** How long one request waits for its response, from the moment it is sent. */
export const PROBE_RESPONSE_MS = 10_000;

/** A method is an HTTP token: RFC 9110's `tchar`, which excludes every separator and whitespace. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** True when `text` holds a character below space, or DEL, which no request target or header value may carry. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The probe. Passed to `node --eval` as one argv element; its request arrives
 * on stdin, so nothing a scenario supplies is on any command line.
 *
 * Both loopback addresses are tried, because a server told to listen on
 * `localhost` binds whichever one its resolver prefers. Whichever accepted a
 * connection first is the one every request goes to.
 */
export const PROBE_SOURCE = `'use strict';
const http = require('node:http');
const net = require('node:net');

const LIMIT = Number(process.env.PROBE_BODY_LIMIT);
const RESPONSE_MS = Number(process.env.PROBE_RESPONSE_MS);

function fail(message) {
  process.stderr.write('probe: ' + message + '\\n');
  process.exit(2);
}

function accepts(host, port) {
  return new Promise(function (resolve) {
    const socket = net.connect({ host: host, port: port });
    socket.once('connect', function () { socket.destroy(); resolve(true); });
    socket.once('error', function () { socket.destroy(); resolve(false); });
  });
}

async function ready(port, withinMs) {
  const deadline = Date.now() + withinMs;
  for (;;) {
    for (const host of ['127.0.0.1', '::1']) {
      if (await accepts(host, port)) return host;
    }
    if (Date.now() >= deadline) return null;
    await new Promise(function (r) { setTimeout(r, 100); });
  }
}

function headersOf(res) {
  const out = {};
  for (const [name, value] of Object.entries(res.headers)) {
    out[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return out;
}

function send(host, port, exchange) {
  return new Promise(function (resolve) {
    let settled = false;
    let deadline;
    function settle(observation) { if (!settled) { settled = true; clearTimeout(deadline); resolve(observation); } }
    const req = http.request({
      host: host, port: port, method: exchange.method, path: exchange.path,
      headers: exchange.headers || {}, agent: false,
    }, function (res) {
      const chunks = [];
      let size = 0;
      res.on('data', function (chunk) {
        size += chunk.length;
        if (size > LIMIT) {
          settle({ kind: 'oversized', status: res.statusCode, headers: headersOf(res), limitBytes: LIMIT });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', function () {
        settle({ kind: 'response', status: res.statusCode, headers: headersOf(res), body: Buffer.concat(chunks).toString('utf8') });
      });
      res.on('error', function (error) { settle({ kind: 'no-response', reason: 'the response broke off: ' + error.message }); });
    });
    // A timer of its own, not req.setTimeout: that one measures socket idleness, and a body
    // trickled a byte at a time would keep resetting it.
    deadline = setTimeout(function () {
      settle({ kind: 'no-response', reason: 'no complete response within ' + RESPONSE_MS + 'ms' });
      req.destroy();
    }, RESPONSE_MS);
    req.on('error', function (error) { settle({ kind: 'no-response', reason: error.message }); });
    if (exchange.body !== undefined) req.write(exchange.body);
    req.end();
  });
}

async function main(text) {
  if (!Number.isInteger(LIMIT) || LIMIT <= 0 || !Number.isInteger(RESPONSE_MS) || RESPONSE_MS <= 0) fail('no body limit or response timeout');
  let request;
  try { request = JSON.parse(text); } catch (error) { fail('the request is not JSON'); }
  const started = Date.now();
  const host = await ready(request.port, request.readyWithinMs);
  const observations = [];
  if (host !== null) {
    for (const exchange of request.exchanges) observations.push(await send(host, request.port, exchange));
  }
  process.stdout.write(JSON.stringify({ ready: host !== null, observations: observations, durationMs: Date.now() - started }));
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { input += chunk; });
process.stdin.on('end', function () { main(input).catch(function (error) { fail(String(error && error.stack || error)); }); });
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkExchange(exchange: ProbeExchange, i: number): void {
  const at = `exchanges[${String(i)}]`;
  if (typeof exchange.method !== 'string' || !TOKEN.test(exchange.method)) refuse('probe', `${at}.method must be an HTTP method token`);
  if (typeof exchange.path !== 'string' || !exchange.path.startsWith('/') || /\s/.test(exchange.path) || hasControl(exchange.path)) {
    refuse('probe', `${at}.path must begin with / and contain no whitespace or control characters; the host is always the sandbox's loopback`);
  }
  if (exchange.headers !== undefined) {
    if (!isRecord(exchange.headers)) refuse('probe', `${at}.headers must be an object of names to strings`);
    for (const [name, value] of Object.entries(exchange.headers)) {
      if (!TOKEN.test(name)) refuse('probe', `${at}.headers has a name that is not an HTTP token: ${JSON.stringify(name)}`);
      if (typeof value !== 'string' || hasControl(value)) refuse('probe', `${at}.headers.${name} must be a string with no line breaks or control characters`);
    }
  }
  if (exchange.body !== undefined && typeof exchange.body !== 'string') refuse('probe', `${at}.body must be a string`);
}

/** Refuses a request the probe could not send as written, naming the field, rather than sending something else. */
export function checkProbeRequest(request: ProbeRequest): void {
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) refuse('probe', 'port must be an integer from 1 to 65535');
  if (!Number.isInteger(request.readyWithinMs) || request.readyWithinMs <= 0) refuse('probe', 'readyWithinMs must be a positive integer');
  if (!Array.isArray(request.exchanges) || request.exchanges.length === 0) refuse('probe', 'exchanges must be a non-empty list');
  request.exchanges.forEach(checkExchange);
}

function stringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((v) => typeof v === 'string');
}

function readObservation(value: unknown): ProbeObservation {
  if (!isRecord(value)) throw new Error('an observation is not an object');
  if (value.kind === 'no-response' && typeof value.reason === 'string') return { kind: 'no-response', reason: value.reason };
  if (typeof value.status !== 'number' || !stringRecord(value.headers)) throw new Error('an observation has no status or headers');
  if (value.kind === 'response' && typeof value.body === 'string') return { kind: 'response', status: value.status, headers: value.headers, body: value.body };
  if (value.kind === 'oversized' && typeof value.limitBytes === 'number') {
    return { kind: 'oversized', status: value.status, headers: value.headers, limitBytes: value.limitBytes };
  }
  throw new Error(`an observation has an unknown shape: ${JSON.stringify(value).slice(0, 200)}`);
}

/**
 * Reads what the probe printed. The probe is the runtime's own code, so a
 * shape this does not know is the probe breaking, and it throws rather than
 * reports an observation it did not make.
 */
export function readProbeOutput(stdout: string, sent: number): ProbeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`the probe printed something that is not JSON: ${stdout.slice(0, 200)}`);
  }
  if (!isRecord(parsed) || typeof parsed.ready !== 'boolean' || !Array.isArray(parsed.observations) || typeof parsed.durationMs !== 'number') {
    throw new Error('the probe printed a result with an unknown shape');
  }
  const observations = parsed.observations.map(readObservation);
  const expected = parsed.ready ? sent : 0;
  if (observations.length !== expected) {
    throw new Error(`the probe reported ${String(observations.length)} observations for ${String(expected)} requests`);
  }
  return { ready: parsed.ready, observations, durationMs: parsed.durationMs };
}

/**
 * The `docker run` for one probe. `--rm` so a probe that finished is gone; the
 * provider also removes it by name if its call is still running when the
 * sandbox ends, so none outlives its sandbox.
 */
export function probeRunArgs(name: string, sandboxContainer: string, image: string): string[] {
  return [
    'run', '--rm', '--interactive',
    '--name', name,
    '--network', `container:${sandboxContainer}`,
    '--env', `PROBE_BODY_LIMIT=${String(PROBE_BODY_LIMIT_BYTES)}`,
    '--env', `PROBE_RESPONSE_MS=${String(PROBE_RESPONSE_MS)}`,
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    image,
    'node', '--eval', PROBE_SOURCE,
  ];
}
