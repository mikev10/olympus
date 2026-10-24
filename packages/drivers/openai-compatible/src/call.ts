/**
 * The one program the driver runs inside the sandbox to make a model call
 * (D-R6-01).
 *
 * It reads a request body on stdin, posts it to the relay at the address the
 * provider set in `RELAY_URL_VARIABLE`, and prints the status and the body as
 * one JSON line. It holds no credential: the relay discards whatever
 * authentication a client sends and writes its own (P12). It sets no timeout:
 * a long generation is bounded by the sandbox's wall clock and the relay's
 * budget, not by a client default that would cut a call the relay still
 * charges.
 *
 * Passed to `node --eval` as one argv element, with the path as the next, so
 * nothing is written to the workspace, which the agent can write (I3).
 */

/** The variable the provider sets in the sandbox to the relay's address. */
export const RELAY_URL_VARIABLE = 'MODEL_RELAY_URL';

export const CALL_SOURCE = `'use strict';
const http = require('node:http');
const base = new URL(String(process.env.${RELAY_URL_VARIABLE} || ''));
const path = String(process.argv[1] || '');
const parts = [];
process.stdin.on('data', function (c) { parts.push(c); });
process.stdin.on('end', function () {
  const body = Buffer.concat(parts);
  const q = http.request({
    host: base.hostname, port: base.port, method: 'POST', path: path, agent: false,
    headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
  }, function (s) {
    const out = [];
    s.on('data', function (c) { out.push(c); });
    s.on('end', function () {
      process.stdout.write(JSON.stringify({ status: s.statusCode, body: Buffer.concat(out).toString('utf8') }));
    });
  });
  q.on('error', function (e) { process.stderr.write('model call failed: ' + String(e && e.message || e)); process.exit(2); });
  q.end(body);
});
`;
