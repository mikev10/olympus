/**
 * The inspection (D-R26-02): what the session would send, read before the
 * task runs.
 *
 * The pinned CLI never prints the tools its session holds, so the driver asks
 * the one party that sees them: the endpoint. Before every task it runs the
 * same invocation once against this endpoint, started on the sandbox's own
 * loopback inside the same exec. The endpoint records every request it is
 * sent and answers a `POST .../responses` with a completed response that has
 * no output and no usage, so the CLI ends its turn at once, no model is
 * called, and no token is spent. Anything else is answered 404 and recorded,
 * so a CLI that reached for a second endpoint is seen doing it.
 *
 * What it captured is printed between two marker lines, after the CLI has
 * exited and the endpoint has been stopped, and the driver reads only what is
 * between them. The marker carries a fresh nonce per inspection, so nothing
 * the CLI printed can forge the block.
 */

/** The variable the endpoint's source travels in: never an argument, never a file the task can write first. */
export const CAPTURE_SOURCE_VARIABLE = 'DRIVER_CAPTURE_SOURCE';

/** The variable the marker nonce travels in. */
export const CAPTURE_NONCE_VARIABLE = 'DRIVER_CAPTURE_NONCE';

/**
 * The endpoint. `node --eval "$DRIVER_CAPTURE_SOURCE" <dir>`: it listens on an
 * ephemeral loopback port, writes the port to `<dir>/port` once listening, and
 * rewrites `<dir>/requests.json` after every request it receives.
 */
export const CAPTURE_SOURCE = `'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const dir = process.argv[1];
const seen = [];
const server = http.createServer(function (req, res) {
  const parts = [];
  let size = 0;
  req.on('data', function (c) { size += c.length; if (size <= 16 << 20) parts.push(c); });
  req.on('end', function () {
    const url = String(req.url || '');
    seen.push({ method: req.method, url: url, authorization: req.headers.authorization === undefined ? null : String(req.headers.authorization),
      body: size <= 16 << 20 ? Buffer.concat(parts).toString('utf8') : null });
    fs.writeFileSync(path.join(dir, 'requests.json'), JSON.stringify(seen));
    if (req.method !== 'POST' || !/\\/responses$/.test(url.split('?')[0])) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const id = 'inspection';
    res.write('event: response.created\\ndata: ' + JSON.stringify({ type: 'response.created', response: { id: id, status: 'in_progress', output: [], usage: null } }) + '\\n\\n');
    res.end('event: response.completed\\ndata: ' + JSON.stringify({ type: 'response.completed', response: { id: id, status: 'completed', output: [],
      usage: { input_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens: 0, total_tokens: 0 } } }) + '\\n\\n');
  });
});
server.listen(0, '127.0.0.1', function () { fs.writeFileSync(path.join(dir, 'port'), String(server.address().port)); });
`;

/** One request the endpoint recorded. */
export interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string | null;
}

/** What one inspection read, or why there is nothing to read. */
export type Captured = { readonly requests: readonly CapturedRequest[] } | { readonly missing: string };

export function markers(nonce: string): { readonly begin: string; readonly end: string } {
  return { begin: `driver-capture-begin-${nonce}`, end: `driver-capture-end-${nonce}` };
}

/** The block between the markers in `stdout`, parsed, or why it could not be. */
export function capturedFrom(stdout: string, nonce: string): Captured {
  const { begin, end } = markers(nonce);
  const lines = stdout.split(/\r?\n/u);
  const from = lines.indexOf(begin);
  const to = lines.indexOf(end);
  if (from === -1 || to === -1 || to <= from) return { missing: 'the inspection printed no capture block' };
  const block = lines.slice(from + 1, to).join('\n').trim();
  if (block === '') return { missing: 'the capture endpoint recorded no request' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch {
    return { missing: 'the capture block is not JSON' };
  }
  if (!Array.isArray(parsed)) return { missing: 'the capture block is not a list of requests' };
  const requests: CapturedRequest[] = [];
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== 'object' || entry === null) return { missing: 'the capture block holds an entry that is not a request' };
    const r = entry as Record<string, unknown>;
    if (typeof r.method !== 'string' || typeof r.url !== 'string') return { missing: 'the capture block holds a request with no method or URL' };
    requests.push({
      method: r.method,
      url: r.url,
      authorization: typeof r.authorization === 'string' ? r.authorization : null,
      body: typeof r.body === 'string' ? r.body : null,
    });
  }
  return { requests };
}
