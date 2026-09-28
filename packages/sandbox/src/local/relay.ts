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
 *   the credential.
 * - It meters what the sandbox spends and enforces the sandbox's budget (P13).
 *   It is the one component on the model's only route that the task cannot
 *   reach, so a bound it enforces is one the task cannot remove. For a metered
 *   call it reads two things, the request's model and the response's usage,
 *   and forwards both bodies unchanged (D-P13-02).
 *
 * Built the way the proxy is: source passed to `node --eval` in the same
 * pinned image, read-only, every capability dropped, nothing mounted.
 */
import { dockerCli } from './docker.js';
import { normalizeHost } from './egress.js';
import { refuse, withLeftovers } from './refusal.js';
import type { MeterReading, ModelPrice, RelayBudget, RelayMeter, RelaySpec } from '../types.js';

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
 * What a relay writes for each metered event, one line each, to its own
 * stdout. Only the provider reads it, with `docker logs` after the sandbox
 * stopped (D-P13-07). Every value on the line is `JSON.stringify`'d, the path
 * lines in `record` included, so nothing a client sends can begin a line of its own.
 */
export const METER_PREFIX = 'model-relay-meter ';

/**
 * The relay itself. Passed to `node --eval` as one argv element, so there is
 * no shell, no mount, and no image build between this source and what runs.
 *
 * It fails closed at start: no credential, no header, an upstream that is not
 * an `https` origin, an empty grant, no budget, a meter for a dialect it does
 * not read, a price table it cannot charge from, or no port each exit non-zero
 * rather than start a server, so a misconfigured relay is a sandbox that never
 * comes up rather than one whose model calls fail later for a reason nothing
 * recorded.
 *
 * Metering (P13), for the `anthropic-messages` dialect:
 *
 * - `POST /v1/messages` is metered. The request body is buffered to read its
 *   `model` and `max_tokens`, and forwarded byte for byte; a model the price
 *   table does not name is refused before anything is sent (D-P13-04). The
 *   response is streamed back unchanged while a copy is read for its usage.
 * - `POST /v1/messages/count_tokens`, `GET`, and `HEAD` cost nothing upstream
 *   and are forwarded unmetered. Every other request is refused: a write whose
 *   cost the meter cannot count is spend the budget cannot see (D-P13-12).
 * - One metered call is in flight at a time, so a call begun under budget ends
 *   over it by at most one call, as D-P13-03 states (D-P13-13).
 * - After each response the totals are updated; once the tokens (all four
 *   classes, D-P13-05) or the dollars reach their bound, every later request is
 *   refused with 402 and `x-should-retry: false`, naming the bound.
 * - A successful response with its input usage and no final output usage is
 *   charged `max_tokens` as output; one with no readable usage at all is
 *   charged `max_tokens` as output, marks the budget `unreadable`, and stops
 *   the relay forwarding. A response in a content encoding the relay did not
 *   ask for is unreadable. A response that is not a success is charged nothing.
 * - On SIGTERM it stops taking requests, cuts off any call still in flight —
 *   which is then charged by the rules above — and writes a `closed` line, the
 *   provider's proof that the log it reads is complete.
 */
export const RELAY_SOURCE = `'use strict';
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { StringDecoder } = require('node:string_decoder');

function fail(why) {
  console.error('model-relay: ' + why);
  process.exit(1);
}

function parsed(name) {
  try { return JSON.parse(String(process.env[name] || '')); } catch (error) { return null; }
}

const credential = String(process.env.RELAY_CREDENTIAL || '');
const header = String(process.env.RELAY_HEADER || '').toLowerCase();
const port = Number(process.env.RELAY_PORT);
const trust = String(process.env.RELAY_TRUST || '');
let upstream = null;
try { upstream = new URL(String(process.env.RELAY_UPSTREAM || '')); } catch (error) { upstream = null; }
const paths = parsed('RELAY_PATHS');
const budget = parsed('RELAY_BUDGET');
const meter = parsed('RELAY_METER');

function positive(n) { return typeof n === 'number' && Number.isFinite(n) && n > 0; }
function price(n) { return typeof n === 'number' && Number.isFinite(n) && n >= 0; }
const PRICE_FIELDS = ['inputPerMTok', 'outputPerMTok', 'cacheReadPerMTok', 'cacheWritePerMTok', 'cacheWrite1hPerMTok'];

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
if (budget === null || typeof budget !== 'object' || !positive(budget.maxTokens) || !positive(budget.maxCostUsd)) {
  fail('no budget; a relay that forwarded without one would be a route to unbounded spend');
}
if (meter === null || typeof meter !== 'object' || meter.dialect !== 'anthropic-messages') {
  fail('no meter for a dialect this relay reads');
}
const prices = meter.prices;
if (prices === null || typeof prices !== 'object' || Array.isArray(prices) || Object.keys(prices).length === 0 ||
    !Object.keys(prices).every(function (m) {
      const p = prices[m];
      return p !== null && typeof p === 'object' && PRICE_FIELDS.every(function (f) { return price(p[f]); });
    })) {
  fail('no price table the relay can charge from');
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

// What a request costs, as the anthropic-messages dialect knows it.
function kindOf(method, path) {
  if (method === 'POST' && path === '/v1/messages') return 'metered';
  if (method === 'POST' && path === '/v1/messages/count_tokens') return 'free';
  if (method === 'GET' || method === 'HEAD') return 'free';
  return 'unmeterable';
}

// Never forwarded from the client. The authentication headers because the
// client's key, whatever it is, is not the one this relay vouches for; Host
// because the upstream is fixed; accept-encoding because the meter reads the
// response as sent; the rest because they describe this hop and not the next.
const DROPPED = new Set([
  'authorization', 'x-api-key', 'proxy-authorization', 'host', 'connection', 'keep-alive', 'accept-encoding',
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

const totals = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, refused: 0 };
let exhausted = 'none';

function meterLine(event) {
  event.totals = totals;
  event.exhausted = exhausted;
  console.log('${METER_PREFIX}' + JSON.stringify(event));
}

function exhaust(reason) {
  if (exhausted === 'none') exhausted = reason;
}

function refuseWith(res, status, type, message, reason) {
  totals.refused += 1;
  meterLine({ event: 'refused', reason: reason });
  res.writeHead(status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
  res.end(JSON.stringify({ type: 'error', error: { type: type, message: 'model-relay: ' + message } }));
}

function refuseSpent(res) {
  const why = exhausted === 'unreadable'
    ? 'a response whose usage could not be read was charged its ceiling, and no later call is forwarded'
    : exhausted === 'tokens'
      ? 'the budget of ' + String(budget.maxTokens) + ' tokens (maxTokens) is spent'
      : 'the budget of ' + String(budget.maxCostUsd) + ' USD (maxCostUsd) is spent';
  refuseWith(res, 402, 'budget_exhausted', why, 'exhausted');
}

// The usage a response reports. input_tokens read is 'any'; output_tokens
// read where the dialect puts the final count is 'final'.
function usageReader() {
  const u = { any: false, final: false, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, write5m: null, write1h: null };
  function count(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null; }
  u.take = function (usage, final) {
    if (usage === null || typeof usage !== 'object') return;
    const input = count(usage.input_tokens);
    if (input !== null) { u.input = input; u.any = true; }
    const cacheRead = count(usage.cache_read_input_tokens);
    if (cacheRead !== null) u.cacheRead = cacheRead;
    const cacheWrite = count(usage.cache_creation_input_tokens);
    if (cacheWrite !== null) u.cacheWrite = cacheWrite;
    const split = usage.cache_creation;
    if (split !== null && typeof split === 'object') {
      if (count(split.ephemeral_5m_input_tokens) !== null) u.write5m = split.ephemeral_5m_input_tokens;
      if (count(split.ephemeral_1h_input_tokens) !== null) u.write1h = split.ephemeral_1h_input_tokens;
    }
    const output = count(usage.output_tokens);
    if (output !== null) { u.output = output; if (final) u.final = true; }
  };
  return u;
}

// Server-sent events: a data line of message_start carries the input usage,
// and each message_delta the running final usage. Lines longer than any usage
// event are skipped whole rather than read from the middle.
const LINE_LIMIT = 1 << 20;
function streamParser(u) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let skipping = false;
  function line(text) {
    if (text.indexOf('data:') !== 0) return;
    let event = null;
    try { event = JSON.parse(text.slice(5)); } catch (error) { return; }
    if (event === null || typeof event !== 'object') return;
    if (event.type === 'message_start' && event.message !== null && typeof event.message === 'object') u.take(event.message.usage, false);
    else if (event.type === 'message_delta') u.take(event.usage, true);
  }
  return function (chunk) {
    buffer += decoder.write(chunk);
    let at = buffer.indexOf('\\n');
    while (at !== -1) {
      const text = buffer.slice(0, at).replace(/\\r$/, '');
      buffer = buffer.slice(at + 1);
      if (skipping) skipping = false; else line(text);
      at = buffer.indexOf('\\n');
    }
    if (buffer.length > LINE_LIMIT) { buffer = ''; skipping = true; }
  };
}

// A whole JSON body: its usage is final.
const BODY_LIMIT = 32 << 20;
function bodyParser(u) {
  const parts = [];
  let size = 0;
  return {
    write: function (chunk) {
      size += chunk.length;
      if (size <= BODY_LIMIT) parts.push(chunk);
    },
    end: function () {
      if (size > BODY_LIMIT) return;
      let body = null;
      try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch (error) { return; }
      if (body !== null && typeof body === 'object') u.take(body.usage, true);
    },
  };
}

function charge(model, maxTokens, u, success) {
  const p = prices[model];
  let charged = 'read';
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, write5m = 0, write1h = 0;
  if (!success) {
    charged = 'error';
  } else if (!u.any) {
    charged = 'unreadable';
    output = maxTokens;
  } else {
    input = u.input; cacheRead = u.cacheRead; cacheWrite = u.cacheWrite;
    // A write the response did not say was five-minute is charged as an hour's.
    write5m = u.write5m === null ? 0 : Math.min(u.write5m, cacheWrite);
    write1h = cacheWrite - write5m;
    if (u.final) output = u.output;
    else { charged = 'ceiling'; output = Math.max(maxTokens, u.output); }
  }
  const costUsd = (input * p.inputPerMTok + output * p.outputPerMTok + cacheRead * p.cacheReadPerMTok +
    write5m * p.cacheWritePerMTok + write1h * p.cacheWrite1hPerMTok) / 1e6;
  totals.calls += 1;
  totals.inputTokens += input;
  totals.outputTokens += output;
  totals.cacheReadTokens += cacheRead;
  totals.cacheWriteTokens += cacheWrite;
  totals.costUsd += costUsd;
  if (charged === 'unreadable') exhaust('unreadable');
  if (totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens >= budget.maxTokens) exhaust('tokens');
  if (totals.costUsd >= budget.maxCostUsd) exhaust('cost');
  meterLine({
    event: 'call', model: model, charged: charged,
    inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, costUsd: costUsd,
  });
}

const ca = trust === '' ? undefined : tls.rootCertificates.concat([trust]);

function send(req, res, target, path, headers, body, done) {
  headers.host = upstream.host;
  headers[header] = credential;
  headers['accept-encoding'] = 'identity';
  let answered = false;
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
    answered = true;
    record('forwarded', req.method, path, answer.statusCode);
    // A redirect is passed back, never followed: following one would send the
    // credential to wherever the upstream pointed.
    res.writeHead(answer.statusCode || 502, forwarded(answer.headers, HOP));
    // The client going away does not stop the read: the upstream bills what it
    // generates, so the meter reads to the end whether or not anyone listens.
    res.on('error', function () {});
    answer.on('data', function (chunk) { if (!res.destroyed) res.write(chunk); });
    let ended = false;
    answer.on('end', function () { ended = true; res.end(); done(answer, true); });
    answer.on('close', function () { if (!ended) { res.destroy(); done(answer, false); } });
    answer.on('error', function () {});
    if (done.watch !== undefined) done.watch(answer);
  });
  outbound.on('error', function (error) {
    // Once an answer arrived, its own close settles the call.
    if (answered) return;
    record('failed', req.method, path);
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('model-relay: upstream failed: ' + String(error.code || error.message) + '\\n');
    done(null, false);
  });
  if (done.outbound !== undefined) done.outbound(outbound);
  if (body === null) req.pipe(outbound); else outbound.end(body);
}

// One metered call at a time (D-P13-13).
let busy = false;
const waiting = [];
function acquire(turn) {
  if (busy) { waiting.push(turn); return; }
  busy = true;
  turn();
}
function release() {
  const next = waiting.shift();
  if (next === undefined) { busy = false; return; }
  next();
}

const inFlight = new Set();
let closing = false;

function metered(req, res, target, path) {
  acquire(function () {
    if (closing || req.destroyed) { res.destroy(); release(); return; }
    if (exhausted !== 'none') { refuseSpent(res); release(); return; }
    const parts = [];
    let size = 0;
    req.on('data', function (chunk) { size += chunk.length; if (size <= BODY_LIMIT) parts.push(chunk); });
    req.on('error', function () {});
    req.on('end', function () {
      if (closing) { res.destroy(); release(); return; }
      if (size > BODY_LIMIT) {
        refuseWith(res, 413, 'request_too_large', 'a metered request body is limited to ' + String(BODY_LIMIT) + ' bytes', 'unreadable-request');
        release();
        return;
      }
      const body = Buffer.concat(parts);
      let request = null;
      try { request = JSON.parse(body.toString('utf8')); } catch (error) { request = null; }
      const model = request !== null && typeof request === 'object' && typeof request.model === 'string' ? request.model : null;
      const maxTokens = request !== null && typeof request === 'object' ? request.max_tokens : undefined;
      if (model === null || !Object.prototype.hasOwnProperty.call(prices, model)) {
        refuseWith(res, 400, 'invalid_request_error',
          (model === null ? 'the request names no model' : 'the model ' + JSON.stringify(model.slice(0, 200)) + ' has no price') +
          ', so its cost cannot be counted and it is not sent', 'unpriced');
        release();
        return;
      }
      if (!Number.isInteger(maxTokens) || maxTokens <= 0) {
        refuseWith(res, 400, 'invalid_request_error', 'the request names no max_tokens, so an unreadable answer has no ceiling to charge', 'unreadable-request');
        release();
        return;
      }
      const u = usageReader();
      let reader = null;
      let settled = false;
      const call = { outbound: null, cut: false, sent: false };
      inFlight.add(call);
      const headers = forwarded(req.headers, DROPPED);
      if (req.headers['content-length'] === undefined) headers['content-length'] = String(body.length);
      function done(answer, complete) {
        if (settled) return;
        settled = true;
        if (reader !== null && reader.end !== undefined && complete) reader.end();
        // A call with no answer may still be billed if the relay cut it off at close, or if
        // its whole request was sent before it failed, so either is charged as unreadable.
        // Only a failure before the request left the relay is provably free.
        const status = answer === null ? 0 : answer.statusCode || 0;
        charge(model, maxTokens, u, answer === null ? call.cut || call.sent : status >= 200 && status < 300);
        inFlight.delete(call);
        release();
        if (closing && inFlight.size === 0) finish();
      }
      done.outbound = function (outbound) {
        call.outbound = outbound;
        outbound.on('finish', function () { call.sent = true; });
      };
      done.watch = function (answer) {
        const encoding = String(answer.headers['content-encoding'] || 'identity').toLowerCase();
        const type = String(answer.headers['content-type'] || '').toLowerCase();
        if (encoding !== 'identity') return;
        if (type.indexOf('text/event-stream') === 0) {
          const parse = streamParser(u);
          answer.on('data', parse);
        } else if (type.indexOf('application/json') === 0) {
          reader = bodyParser(u);
          answer.on('data', reader.write);
        }
      };
      send(req, res, target, path, headers, body, done);
    });
  });
}

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
  if (exhausted !== 'none') {
    record('refused', req.method, path);
    refuseSpent(res);
    return;
  }
  const kind = kindOf(req.method, path);
  if (kind === 'unmeterable') {
    record('refused', req.method, path);
    refuseWith(res, 403, 'permission_error', String(req.method) + ' ' + path + ' has a cost the meter cannot count, so it is not sent', 'unmeterable');
    return;
  }
  if (kind === 'metered') { metered(req, res, target, path); return; }
  const headers = forwarded(req.headers, DROPPED);
  send(req, res, target, path, headers, null, function () {});
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

// The provider stops the relay after the sandbox is gone, then reads the log.
// A call still in flight is cut off and charged by the usual rules, and the
// closed line is written last, so a log without one is a log cut short.
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  meterLine({ event: 'closed' });
  server.closeAllConnections();
  // stdout to a pipe is synchronous on Linux, so the line is written before this exits.
  setImmediate(function () { process.exit(0); });
}
process.on('SIGTERM', function () {
  if (closing) return;
  closing = true;
  server.close();
  waiting.splice(0).forEach(function (turn) { turn(); });
  if (inFlight.size === 0) { finish(); return; }
  inFlight.forEach(function (call) {
    call.cut = true;
    if (call.outbound !== null) call.outbound.destroy();
  });
});

// A metered request can wait its turn behind a long generation; the sandbox's wall clock bounds it, not this.
server.requestTimeout = 0;

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
  readonly budget: RelayBudget;
  readonly meter: RelayMeter;
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
  /** The bounds the relay enforces for this sandbox's driver call. */
  readonly budget: RelayBudget;
  /** The dialect it reads usage in, and the prices it charges. */
  readonly meter: RelayMeter;
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
  const budget = checkBudget(relay.budget);
  const meter = checkMeter(relay.meter);
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
    budget,
    meter,
  };
}

/** The dialects the relay's source reads. A closed set: a dialect not here is refused, never guessed at (D-P13-06). */
const DIALECTS: ReadonlySet<string> = new Set<RelayMeter['dialect']>(['anthropic-messages']);

type PriceField = keyof ModelPrice;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A value as a refusal names it: `undefined` has no JSON form, so it is spelled out. */
function shown(value: unknown): string {
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

/** I5: a relay nothing bounds is refused, never started as one that forwards everything. */
function checkBudget(budget: unknown): RelayBudget {
  if (!isRecord(budget)) {
    refuse('relay', 'relay.budget is missing. A relay with no budget would be a route to unbounded spend, so it is refused rather than started (A-P13-01).');
  }
  const bound = (field: 'maxTokens' | 'maxCostUsd'): number => {
    const value = budget[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      refuse('relay', `relay.budget.${field} must be a positive finite number, not ${shown(value)}; a bound that is not one bounds nothing`);
    }
    return value;
  };
  return { maxTokens: bound('maxTokens'), maxCostUsd: bound('maxCostUsd') };
}

/** I5: a meter the relay cannot read or charge from is refused at provisioning, naming the field. */
function checkMeter(meter: unknown): RelayMeter {
  if (!isRecord(meter)) {
    refuse('relay', 'relay.meter is missing. A relay that cannot count what a call used cannot enforce a budget, so it is refused (A-P13-01).');
  }
  if (typeof meter.dialect !== 'string' || !DIALECTS.has(meter.dialect)) {
    refuse('relay', `relay.meter.dialect ${shown(meter.dialect)} is not one this relay reads; it reads ${[...DIALECTS].join(', ')}`);
  }
  const prices = meter.prices;
  if (!isRecord(prices) || Object.keys(prices).length === 0) {
    refuse('relay', 'relay.meter.prices names no model. Every model would be refused as unpriced, so the relay is refused instead.');
  }
  const table: Record<string, ModelPrice> = {};
  for (const [model, price] of Object.entries(prices)) {
    if (model.trim() === '' || !isRecord(price)) refuse('relay', `relay.meter.prices[${JSON.stringify(model)}] is not a price`);
    const at = (field: PriceField): number => {
      const value = price[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        refuse('relay', `relay.meter.prices[${JSON.stringify(model)}].${field} must be a non-negative finite number, not ${shown(value)}`);
      }
      return value;
    };
    table[model] = Object.freeze({
      inputPerMTok: at('inputPerMTok'),
      outputPerMTok: at('outputPerMTok'),
      cacheReadPerMTok: at('cacheReadPerMTok'),
      cacheWritePerMTok: at('cacheWritePerMTok'),
      cacheWrite1hPerMTok: at('cacheWrite1hPerMTok'),
    });
  }
  return { dialect: 'anthropic-messages', prices: Object.freeze(table) };
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
      '--env', `RELAY_BUDGET=${JSON.stringify(plan.budget)}`,
      '--env', `RELAY_METER=${JSON.stringify(plan.meter)}`,
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
      budget: plan.budget,
      meter: plan.meter,
      endpoint: `${RELAY_ALIAS}:${String(RELAY_PORT)}`,
      internalNetwork: internal,
      outboundNetwork: outbound,
      ownsNetworks: shared === undefined,
      runArgs: Object.freeze([...runArgs]),
    };
  } catch (error) {
    throw withLeftovers(error, await teardown(options, containerId === '' ? names.container : containerId, created));
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

/**
 * Removes the relay container and then any networks it created. Every step is
 * attempted, whichever failed before it — a `docker` that times out or cannot
 * be spawned is a failed step, not the end of the teardown — and every failure
 * is reported, each naming what it left behind (external review, codex-3).
 */
async function teardown(options: RelayOptions, container: string, networks: readonly string[]): Promise<Error | undefined> {
  const failures: string[] = [];
  const attempt = async (args: string[], gone: string, what: string): Promise<void> => {
    try {
      const removed = await dockerCli(options.executable, args, { timeoutMs: options.timeoutMs });
      if (removed.exitCode !== 0 && !removed.stderr.includes(gone)) {
        failures.push(`docker ${args.slice(0, 2).join(' ')} exited ${String(removed.exitCode)} for ${what}: ${removed.stderr.trim()}`);
      }
    } catch (error) {
      failures.push(`docker ${args.slice(0, 2).join(' ')} failed for ${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // A container that was never created is not a leak; `docker rm` says so and this is not it.
  if (container !== '') await attempt(['rm', '--force', '--volumes', container], 'No such container', `the model relay ${container}`);
  for (const network of networks) await attempt(['network', 'rm', network], 'not found', `the network ${network}`);
  return failures.length === 0 ? undefined : new Error(`the model relay was not fully removed: ${failures.join('; ')}`);
}

/** How long a stopped relay has to charge what was in flight and write its closing line. */
const STOP_SECONDS = 20;

const TOTAL_FIELDS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd', 'refused'] as const;
type Totals = Record<(typeof TOTAL_FIELDS)[number], number>;

const EXHAUSTED = ['none', 'tokens', 'cost', 'unreadable'] as const;

function exhaustedOf(value: unknown): (typeof EXHAUSTED)[number] | undefined {
  return EXHAUSTED.find((e) => e === value);
}

function countsOf(value: unknown, fields: ReadonlyArray<(typeof TOTAL_FIELDS)[number]>): Partial<Totals> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Partial<Totals> = {};
  for (const field of fields) {
    const n = value[field];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return undefined;
    out[field] = n;
  }
  return out;
}

/**
 * Turns a relay's log into its reading, or throws. The reading is the sum of
 * the per-call lines, taken in the order the relay wrote them, and must equal
 * the running totals on the relay's last line: two figures that disagree mean
 * a log that is not the relay's whole account. A log with no closing line was
 * cut short, and a reading from it would be a floor presented as a total.
 */
export function meterReadingFrom(log: string): Extract<MeterReading, { kind: 'metered' }> {
  const events: Array<Record<string, unknown>> = [];
  for (const line of log.split(/\r?\n/u)) {
    if (!line.startsWith(METER_PREFIX)) continue;
    let event: unknown;
    try {
      event = JSON.parse(line.slice(METER_PREFIX.length));
    } catch {
      throw new Error(`the model relay's meter line is not JSON: ${line.slice(0, 200)}`);
    }
    if (!isRecord(event)) throw new Error(`the model relay's meter line is not a record: ${line.slice(0, 200)}`);
    events.push(event);
  }
  const last = events.at(-1);
  if (last?.event !== 'closed') {
    throw new Error('the model relay did not write its closing meter line, so its log may not hold every call it forwarded');
  }
  const sum: Totals = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, refused: 0 };
  for (const event of events) {
    if (event.event === 'refused') sum.refused += 1;
    if (event.event !== 'call') continue;
    const call = countsOf(event, ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'costUsd']);
    if (call === undefined) throw new Error('a model relay call line is missing a count');
    sum.calls += 1;
    sum.inputTokens += call.inputTokens ?? 0;
    sum.outputTokens += call.outputTokens ?? 0;
    sum.cacheReadTokens += call.cacheReadTokens ?? 0;
    sum.cacheWriteTokens += call.cacheWriteTokens ?? 0;
    sum.costUsd += call.costUsd ?? 0;
  }
  const stated = countsOf(last.totals, TOTAL_FIELDS);
  const exhausted = exhaustedOf(last.exhausted);
  if (stated === undefined || exhausted === undefined) {
    throw new Error("the model relay's closing meter line does not carry its totals");
  }
  const differs = TOTAL_FIELDS.filter((k) => sum[k] !== stated[k]);
  if (differs.length > 0) {
    throw new Error(
      `the model relay's per-call lines do not sum to its running totals (${differs.map((k) => `${k}: ${String(sum[k])} against ${String(stated[k])}`).join(', ')})`,
    );
  }
  return { kind: 'metered', ...sum, exhausted };
}

/**
 * Stops the relay, then reads what it counted. Called once the sandbox
 * container is gone, so nothing can spend after the read (D-P13-07). The
 * relay is stopped rather than killed so it charges what was in flight and
 * writes its closing line; the container is kept for `stopRelay` to remove.
 * Throws when the log cannot be read or does not account for itself.
 */
export async function readMeter(applied: AppliedRelay, options: RelayOptions): Promise<MeterReading> {
  const stopped = await dockerCli(options.executable, ['stop', '--time', String(STOP_SECONDS), applied.containerId], {
    timeoutMs: options.timeoutMs,
  });
  if (stopped.exitCode !== 0) {
    throw new Error(`docker stop exited ${String(stopped.exitCode)} for the model relay ${applied.name}: ${stopped.stderr.trim()}`);
  }
  const logs = await dockerCli(options.executable, ['logs', applied.containerId], { timeoutMs: options.timeoutMs });
  if (logs.exitCode !== 0) {
    throw new Error(`docker logs exited ${String(logs.exitCode)} for the model relay ${applied.name}: ${logs.stderr.trim()}`);
  }
  return meterReadingFrom(logs.stdout);
}

/**
 * Destroys a relay, and its networks when it created them. Returns the first
 * failure rather than throwing it. Under an allowlist it must run before the
 * proxy's teardown: a network with the relay still on it cannot be removed.
 */
export function stopRelay(applied: AppliedRelay, options: RelayOptions): Promise<Error | undefined> {
  return teardown(options, applied.containerId, applied.ownsNetworks ? [applied.internalNetwork, applied.outboundNetwork] : []);
}
