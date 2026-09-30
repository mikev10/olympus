/**
 * The runtime as a service over HTTP (I9). It serves the run lifecycle —
 * create, status, approve, cancel, and an event stream — and nothing it does
 * reads a terminal, argv, or the process's streams: its host constructs it,
 * hands it the components and the local token, and tells it where to listen.
 *
 * The components are the host's (D-P9-01). The policy is read from the file
 * the host names, through the hardened loader, on every create. Run state is
 * the Vault's; this server keeps in memory only what routes events to open
 * streams and which runs it is driving now.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isAbsolute } from 'node:path';
import { isApprovalKey, type RunCancellation, type RunId, type RunState } from '@olympus-ai/core';
import { loadPolicyFile } from '../policy-file.js';
import { admitRun, approveStation, cancelRun, resumeRun, runStanding, type ComponentGraph, type DriveHooks, type RunOutcome } from '../run.js';
import type { ApproveBody, CreateRunBody, CreatedRun, DriveEnd, ErrorBody, ErrorCode, RunEvent, RunView } from './wire.js';

export interface ApiServerOptions {
  readonly components: ComponentGraph;
  /** The local token every request must bear. At least 32 characters; a shorter one is refused at construction. */
  readonly token: string;
  /** Who a request bearing the token is, as approvals and cancellations record it. */
  readonly principal: string;
  /** The `policy.yaml` every run is admitted under. */
  readonly policyFile: string;
}

export interface ApiServer {
  /** Resolves with the URL the server is reachable at. */
  listen(port: number, host: string): Promise<string>;
  /** Stops accepting, ends open streams, and waits for every drive in flight to finish. */
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MIN_TOKEN_LENGTH = 32;

interface Tracked {
  drive: Promise<void> | null;
  cancel: RunCancellation | null;
  lastOutcome: DriveEnd | null;
  readonly streams: Set<(event: RunEvent) => void>;
}

class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly refusal: unknown;

  constructor(status: number, code: ErrorCode, message: string, refusal?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.refusal = refusal;
  }
}

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendError(res: ServerResponse, error: HttpError): void {
  const body: ErrorBody = error.refusal === undefined
    ? { error: error.code, message: error.message }
    : { error: error.code, message: error.message, refusal: error.refusal };
  if (error.status === 401) res.setHeader('www-authenticate', 'Bearer');
  send(res, error.status, body);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    length += buffer.byteLength;
    if (length > MAX_BODY_BYTES) throw new HttpError(413, 'too-large', `the request body exceeds ${String(MAX_BODY_BYTES)} bytes`);
    chunks.push(buffer);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed;
  } catch {
    throw new HttpError(400, 'bad-request', 'the request body is not JSON');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Default deny on the wire too: a key the body does not define is refused, not ignored. */
function exactKeys(value: Record<string, unknown>, keys: readonly string[], at: string): void {
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !Object.hasOwn(value, key));
  if (extra.length > 0 || missing.length > 0) {
    const parts = [...missing.map((k) => `missing ${at}${k}`), ...extra.map((k) => `unknown ${at}${k}`)];
    throw new HttpError(400, 'bad-request', parts.join('; '));
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function createBody(value: unknown): CreateRunBody {
  if (!isRecord(value)) throw new HttpError(400, 'bad-request', 'the body must be an object');
  exactKeys(value, ['workspace', 'baseCommit', 'requestedLevel', 'artifacts', 'approvedCostUsd'], '');
  const { workspace, baseCommit, requestedLevel, artifacts, approvedCostUsd } = value;
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new HttpError(400, 'bad-request', 'workspace must be an absolute path on the server');
  if (typeof baseCommit !== 'string' || baseCommit === '') throw new HttpError(400, 'bad-request', 'baseCommit must be a non-empty string');
  if (requestedLevel !== 0 && requestedLevel !== 1 && requestedLevel !== 2 && requestedLevel !== 3) {
    throw new HttpError(400, 'bad-request', 'requestedLevel must be 0, 1, 2, or 3');
  }
  if (approvedCostUsd !== null && (typeof approvedCostUsd !== 'number' || !Number.isFinite(approvedCostUsd))) {
    throw new HttpError(400, 'bad-request', 'approvedCostUsd must be a number or null');
  }
  if (!isRecord(artifacts)) throw new HttpError(400, 'bad-request', 'artifacts must be an object');
  exactKeys(artifacts, ['spec', 'acceptanceTests', 'verificationManifest', 'taskGraph'], 'artifacts.');
  const { spec, acceptanceTests, verificationManifest, taskGraph } = artifacts;
  if (!isStringArray(spec) || !isStringArray(acceptanceTests) || typeof verificationManifest !== 'string' || typeof taskGraph !== 'string') {
    throw new HttpError(400, 'bad-request', 'artifacts: spec and acceptanceTests are string arrays; verificationManifest and taskGraph are strings');
  }
  return { workspace, baseCommit, requestedLevel, artifacts: { spec, acceptanceTests, verificationManifest, taskGraph }, approvedCostUsd };
}

function approveBody(value: unknown): ApproveBody {
  if (!isRecord(value)) throw new HttpError(400, 'bad-request', 'the body must be an object');
  exactKeys(value, ['key'], '');
  if (!isApprovalKey(value.key)) throw new HttpError(400, 'bad-request', `'${String(value.key)}' is not a station:level approval key`);
  return { key: value.key };
}

/** HTTP status for a refusal before or on the line: the caller's input, or the runtime saying no. */
function refusalStatus(outcome: Exclude<RunOutcome, { ok: true }>): number {
  return outcome.reason === 'invalid-request' ? 400 : 422;
}

export function createApiServer(options: ApiServerOptions): ApiServer {
  if (typeof options.token !== 'string' || options.token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`api server: the local token must be at least ${String(MIN_TOKEN_LENGTH)} characters`);
  }
  if (typeof options.principal !== 'string' || options.principal.trim() === '') throw new Error('api server: principal must name who the token is');
  const expected = digest(`Bearer ${options.token}`);
  const { components, principal } = options;
  const runs = new Map<RunId, Tracked>();
  const open = new Set<ServerResponse>();

  const tracked = (runId: RunId): Tracked => {
    let entry = runs.get(runId);
    if (entry === undefined) {
      entry = { drive: null, cancel: null, lastOutcome: null, streams: new Set() };
      runs.set(runId, entry);
    }
    return entry;
  };

  const publish = (entry: Tracked, event: RunEvent): void => {
    for (const stream of entry.streams) stream(event);
  };

  /** Drives a run in the background; the returned promise never rejects. */
  const drive = (runId: RunId, start: (hooks: DriveHooks) => Promise<RunOutcome>): void => {
    const entry = tracked(runId);
    entry.cancel = null;
    const hooks: DriveHooks = {
      cancelRequested: () => entry.cancel,
      onCommit: (state) => { publish(entry, { event: 'state', data: state }); },
    };
    entry.drive = start(hooks)
      .then((outcome): DriveEnd => ({ kind: 'outcome', outcome }), (error: unknown): DriveEnd => ({ kind: 'error', message: describe(error) }))
      .then((end) => (end.kind === 'error' ? halt(runId, end) : end))
      .then(async (end) => {
        entry.lastOutcome = end;
        entry.drive = null;
        entry.cancel = null;
        const standing = await runStanding(components.vault, runId).then((s) => s.standing, () => undefined);
        if (standing !== undefined) publish(entry, { event: 'standing', data: standing });
        publish(entry, { event: 'end', data: end });
      });
  };

  /**
   * A drive that ended in an error, rather than a refusal the line committed,
   * left the run's state as it was mid-step, which status would read as open
   * and a cancel would relabel. The halt is committed so the stop is the
   * Vault's record, and survives this process (A-P9-02). A run already
   * cancelled keeps that record instead; if the halt cannot be committed, the
   * drive's end says so.
   */
  const halt = async (runId: RunId, end: DriveEnd & { kind: 'error' }): Promise<DriveEnd> => {
    try {
      const state = await components.vault.readRunState(runId);
      if (state.cancelled !== null || state.halted !== null) return end;
      await components.vault.commitRunState({ ...state, halted: { at: new Date().toISOString(), message: end.message } }, state.version);
      return end;
    } catch (error) {
      return { kind: 'error', message: `${end.message}; the halt could not be recorded: ${describe(error)}` };
    }
  };

  const view = async (runId: RunId): Promise<RunView> => {
    // Taken before the read, not after: a drive that ends while the state is read has committed
    // past what was read, and a view saying `driving: false` beside that state would present a
    // stale standing as settled. Read first, a drive running at the start is still reported.
    const entry = runs.get(runId);
    const driving = entry?.drive != null;
    const lastOutcome = entry?.lastOutcome ?? null;
    let read: { state: RunState; standing: RunView['standing'] };
    try {
      read = await runStanding(components.vault, runId);
    } catch (error) {
      throw new HttpError(404, 'not-found', `no run ${runId}: ${describe(error)}`);
    }
    return { runId, state: read.state, standing: read.standing, driving, lastOutcome };
  };

  const create = async (body: CreateRunBody): Promise<CreatedRun> => {
    const policy = await loadPolicyFile(options.policyFile);
    if (!policy.ok) throw new HttpError(422, 'refused', `the server's policy file is refused: ${policy.message}`, policy);
    const runId = randomUUID() as RunId;
    const admission = await admitRun({ runId, ...body, policy: policy.policy, components });
    if (!admission.ok) throw new HttpError(refusalStatus(admission), 'refused', `run refused: ${admission.reason}`, admission);
    const { admitted } = admission;
    drive(runId, (hooks) => admitted.drive(hooks));
    return { runId, worstCase: admitted.worstCase, state: admitted.state };
  };

  const approve = async (runId: RunId, body: ApproveBody): Promise<RunView> => {
    const entry = tracked(runId);
    if (entry.drive !== null) throw new HttpError(409, 'conflict', `run ${runId} is being driven; it is not waiting for an approval`);
    await view(runId);
    const outcome = await approveStation({ runId, key: body.key, approvedBy: principal, vault: components.vault });
    if (!outcome.ok) throw new HttpError(outcome.reason === 'invalid-request' ? 400 : 409, 'refused', outcome.message, outcome);
    drive(runId, (hooks) => resumeRun({ runId, components }, hooks));
    return view(runId);
  };

  const cancel = async (runId: RunId): Promise<RunView> => {
    await view(runId);
    const entry = tracked(runId);
    const inFlight = entry.drive;
    if (inFlight !== null) {
      entry.cancel = { by: principal, at: new Date().toISOString() };
      await inFlight;
      const after = await view(runId);
      if (after.state.cancelled === null) {
        throw new HttpError(409, 'refused', `run ${runId} finished before the cancellation was taken; there is nothing to cancel`, after.standing);
      }
      return after;
    }
    const outcome = await cancelRun({ runId, by: principal, vault: components.vault });
    if (!outcome.ok) throw new HttpError(outcome.reason === 'finished' ? 409 : 400, 'refused', outcome.message, outcome);
    const now = await view(runId);
    publish(entry, { event: 'state', data: now.state });
    publish(entry, { event: 'standing', data: now.standing });
    return now;
  };

  const events = async (runId: RunId, res: ServerResponse): Promise<void> => {
    const now = await view(runId);
    const entry = tracked(runId);
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    open.add(res);
    const write = (event: RunEvent): void => {
      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
    };
    const finish = (): void => {
      entry.streams.delete(stream);
      open.delete(res);
      res.end();
    };
    const stream = (event: RunEvent): void => {
      write(event);
      if (event.event === 'end') finish();
    };
    write({ event: 'state', data: now.state });
    write({ event: 'standing', data: now.standing });
    if (entry.drive === null) {
      write({ event: 'end', data: entry.lastOutcome });
      open.delete(res);
      res.end();
      return;
    }
    entry.streams.add(stream);
    res.on('close', () => {
      entry.streams.delete(stream);
      open.delete(res);
    });
  };

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const presented = digest(req.headers.authorization ?? '');
    if (!timingSafeEqual(presented, expected)) throw new HttpError(401, 'unauthorized', 'a valid local token is required');
    const url = new URL(req.url ?? '/', 'http://server.invalid');
    const parts = url.pathname.split('/').filter((p) => p !== '');
    const method = req.method ?? 'GET';
    if (parts[0] !== 'runs' || parts.length > 3) throw new HttpError(404, 'not-found', `no route ${url.pathname}`);
    if (parts.length === 1) {
      if (method !== 'POST') throw new HttpError(405, 'method-not-allowed', `${method} ${url.pathname}`);
      send(res, 201, await create(createBody(await readJson(req))));
      return;
    }
    const runId = decodeURIComponent(parts[1] ?? '') as RunId;
    const action = parts[2];
    if (action === undefined) {
      if (method !== 'GET') throw new HttpError(405, 'method-not-allowed', `${method} ${url.pathname}`);
      send(res, 200, await view(runId));
      return;
    }
    if (action === 'events') {
      if (method !== 'GET') throw new HttpError(405, 'method-not-allowed', `${method} ${url.pathname}`);
      await events(runId, res);
      return;
    }
    if (action === 'approve' || action === 'cancel') {
      if (method !== 'POST') throw new HttpError(405, 'method-not-allowed', `${method} ${url.pathname}`);
      send(res, 200, action === 'approve' ? await approve(runId, approveBody(await readJson(req))) : await cancel(runId));
      return;
    }
    throw new HttpError(404, 'not-found', `no route ${url.pathname}`);
  };

  const server: Server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const http = error instanceof HttpError ? error : new HttpError(500, 'internal', describe(error));
      if (res.headersSent) {
        res.end();
        return;
      }
      sendError(res, http);
    });
  });

  return {
    listen: (port, host) => new Promise((resolveUrl, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('api server: listening on something other than a TCP port'));
          return;
        }
        const shown = address.family === 'IPv6' ? `[${address.address}]` : address.address;
        resolveUrl(`http://${shown}:${String(address.port)}`);
      });
    }),
    close: async () => {
      for (const res of open) res.end();
      open.clear();
      await new Promise<void>((done) => {
        server.close(() => { done(); });
        server.closeAllConnections();
      });
      await Promise.all([...runs.values()].flatMap((entry) => (entry.drive === null ? [] : [entry.drive])));
    },
  };
}
