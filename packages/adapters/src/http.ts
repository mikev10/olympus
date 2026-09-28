/**
 * An HTTP scenario, served inside the sandbox, observed by a probe the
 * product cannot reach, and judged on the host (P11).
 *
 * The scenario owns its server (D-P11-03): `serve` is started detached in the
 * sandbox, and the provider's probe — a container in the sandbox's network
 * namespace and out of its filesystem — sends the requests and reports what
 * came back. The comparison against `expected` happens here, in the runtime's
 * own process, as the CLI adapter's does. A client inside the product's
 * container would be one the product could replace, and what it observed
 * would be the product's report of itself.
 *
 * One scenario per handle. The first scenario's server holds the sandbox until
 * the sandbox ends, and nothing inside the product's container is trusted to
 * stop it, so a second scenario on the same handle is refused rather than
 * answered by whatever is still listening. The fresh sandbox per check is P6's.
 *
 * `expected` comes from locked acceptance criteria and never from the
 * implementation (I3). This adapter cannot check that; it takes the value it
 * is handed and refuses one it cannot read.
 */
import type { CheckResult, ExpectationMismatch, ExpectationOutcome } from '@olympus-ai/integrity';
import type { ProbeExchange, ProbeObservation, ProbeRequest, ProbeResult, SandboxHandle, SandboxProvider } from '@olympus-ai/sandbox';
import { refuse } from './refusal.js';
import type { BehavioralAdapter, BehavioralScenario } from './types.js';

export interface HttpInput {
  readonly serve: readonly [string, ...string[]];
  readonly port: number;
  readonly readyWithinMs: number;
  readonly exchanges: readonly [ProbeExchange, ...ProbeExchange[]];
}

/** What one response must show. `headers` are compared by name, case-insensitively, and only those named. */
export interface HttpExpectedResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly bodyIncludes?: readonly string[];
  /** The body parsed as JSON and compared structurally, so key order and whitespace do not matter. */
  readonly json?: unknown;
}

export interface HttpExpected {
  readonly exchanges: readonly HttpExpectedResponse[];
}

/** How long a server has to start listening when the scenario does not say. */
export const DEFAULT_READY_WITHIN_MS = 10_000;

const INPUT_KEYS: ReadonlySet<string> = new Set(['serve', 'port', 'readyWithinMs', 'exchanges']);
const EXCHANGE_KEYS: ReadonlySet<string> = new Set(['method', 'path', 'headers', 'body']);
const EXPECTED_KEYS: ReadonlySet<string> = new Set(['exchanges']);
const RESPONSE_KEYS: ReadonlySet<string> = new Set(['status', 'headers', 'body', 'bodyIncludes', 'json']);
/** How much of an observed body a mismatch quotes; the whole observation is in the result beside it. */
const QUOTE_LIMIT = 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.has(key));
  if (extra.length > 0) {
    refuse('unrecognised-scenario', `${label} has ${extra.map((k) => `${label}.${k}`).join(', ')}, which this adapter does not know; it is refused rather than ignored`);
  }
}

function strings(value: unknown, label: string): readonly [string, ...string[]] {
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string' && item !== '')) {
    refuse('unrecognised-scenario', `${label} must be a non-empty array of non-empty strings`);
  }
  const [first, ...rest] = value;
  if (first === undefined) refuse('unrecognised-scenario', `${label} must be a non-empty array of non-empty strings`);
  return [first, ...rest];
}

function stringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (!isRecord(value) || !Object.values(value).every((v) => typeof v === 'string')) {
    refuse('unrecognised-scenario', `${label} must be an object of names to strings`);
  }
  return value as Readonly<Record<string, string>>;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    refuse('unrecognised-scenario', `${label} must be an integer from ${String(min)} to ${String(max)}`);
  }
  return value;
}

function readExchange(value: unknown, i: number): ProbeExchange {
  const at = `input.exchanges[${String(i)}]`;
  if (!isRecord(value)) refuse('unrecognised-scenario', `${at} must be an object`);
  unknownKeys(value, EXCHANGE_KEYS, at);
  if (typeof value.method !== 'string' || value.method === '') refuse('unrecognised-scenario', `${at}.method must be a non-empty string`);
  if (typeof value.path !== 'string' || !value.path.startsWith('/')) refuse('unrecognised-scenario', `${at}.path must be a string beginning with /`);
  if (value.body !== undefined && typeof value.body !== 'string') refuse('unrecognised-scenario', `${at}.body must be a string`);
  return {
    method: value.method,
    path: value.path,
    ...(value.headers === undefined ? {} : { headers: stringRecord(value.headers, `${at}.headers`) }),
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
  };
}

function readResponse(value: unknown, i: number): HttpExpectedResponse {
  const at = `expected.exchanges[${String(i)}]`;
  if (!isRecord(value)) refuse('unrecognised-scenario', `${at} must be an object`);
  unknownKeys(value, RESPONSE_KEYS, at);
  if (value.body !== undefined && typeof value.body !== 'string') refuse('unrecognised-scenario', `${at}.body must be a string`);
  return {
    status: integer(value.status, `${at}.status`, 100, 599),
    ...(value.headers === undefined ? {} : { headers: stringRecord(value.headers, `${at}.headers`) }),
    ...(typeof value.body === 'string' ? { body: value.body } : {}),
    ...(value.bodyIncludes === undefined ? {} : { bodyIncludes: strings(value.bodyIncludes, `${at}.bodyIncludes`) }),
    ...('json' in value ? { json: value.json } : {}),
  };
}

export function readHttpScenario(scenario: BehavioralScenario): { input: HttpInput; expected: HttpExpected } {
  if (typeof scenario.id !== 'string' || scenario.id === '') refuse('unrecognised-scenario', 'scenario.id must be a non-empty string');
  const { input, expected } = scenario;
  if (!isRecord(input)) refuse('unrecognised-scenario', `scenario ${scenario.id}: input must be an object`);
  unknownKeys(input, INPUT_KEYS, 'input');
  const serve = strings(input.serve, 'input.serve');
  const port = integer(input.port, 'input.port', 1, 65535);
  const readyWithinMs = input.readyWithinMs === undefined ? DEFAULT_READY_WITHIN_MS : integer(input.readyWithinMs, 'input.readyWithinMs', 1, 600_000);
  if (!Array.isArray(input.exchanges)) refuse('unrecognised-scenario', 'input.exchanges must be a non-empty array');
  const [first, ...rest] = input.exchanges.map(readExchange);
  if (first === undefined) refuse('unrecognised-scenario', 'input.exchanges must be a non-empty array');

  if (!isRecord(expected)) refuse('unrecognised-scenario', `scenario ${scenario.id}: expected must be an object`);
  unknownKeys(expected, EXPECTED_KEYS, 'expected');
  if (!Array.isArray(expected.exchanges)) refuse('unrecognised-scenario', 'expected.exchanges must be an array');
  const responses = expected.exchanges.map(readResponse);
  if (responses.length !== rest.length + 1) {
    refuse('unrecognised-scenario', `expected.exchanges has ${String(responses.length)} entries for ${String(rest.length + 1)} in input.exchanges; each request needs one expected response`);
  }
  return { input: { serve, port, readyWithinMs, exchanges: [first, ...rest] }, expected: { exchanges: responses } };
}

function quote(observed: string): string {
  if (observed.length <= QUOTE_LIMIT) return observed;
  return `${observed.slice(0, QUOTE_LIMIT)}… (${String(observed.length - QUOTE_LIMIT)} more characters in the result)`;
}

/** Key order is not part of a JSON value, so both sides are written with their keys sorted before they are compared. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return value === undefined ? 'undefined' : JSON.stringify(value);
}

function compareResponse(expected: HttpExpectedResponse, observed: ProbeObservation, at: string, out: ExpectationMismatch[]): void {
  if (observed.kind === 'no-response') {
    out.push({ field: at, expected: `a response with status ${String(expected.status)}`, observed: observed.reason });
    return;
  }
  if (observed.status !== expected.status) out.push({ field: `${at}.status`, expected: String(expected.status), observed: String(observed.status) });
  for (const [name, value] of Object.entries(expected.headers ?? {})) {
    const seen = observed.headers[name.toLowerCase()];
    if (seen !== value) out.push({ field: `${at}.headers.${name.toLowerCase()}`, expected: value, observed: seen ?? '(absent)' });
  }
  const wantsBody = expected.body !== undefined || expected.bodyIncludes !== undefined || 'json' in expected;
  if (observed.kind === 'oversized') {
    if (wantsBody) out.push({ field: `${at}.body`, expected: 'a body within the probe\'s limit', observed: `more than ${String(observed.limitBytes)} bytes` });
    return;
  }
  if (expected.body !== undefined && observed.body !== expected.body) out.push({ field: `${at}.body`, expected: expected.body, observed: quote(observed.body) });
  (expected.bodyIncludes ?? []).forEach((fragment, i) => {
    if (!observed.body.includes(fragment)) out.push({ field: `${at}.bodyIncludes[${String(i)}]`, expected: fragment, observed: quote(observed.body) });
  });
  if ('json' in expected) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(observed.body);
    } catch {
      out.push({ field: `${at}.json`, expected: canonical(expected.json), observed: `not JSON: ${quote(observed.body)}` });
      return;
    }
    if (canonical(parsed) !== canonical(expected.json)) out.push({ field: `${at}.json`, expected: canonical(expected.json), observed: quote(canonical(parsed)) });
  }
}

/** The runtime's comparison. Pure, so what decides a verdict is testable without a container. */
export function compareHttp(expected: HttpExpected, observed: ProbeResult): ExpectationOutcome {
  const mismatches: ExpectationMismatch[] = [];
  if (!observed.ready) {
    mismatches.push({ field: 'ready', expected: 'the server listening on its port', observed: 'nothing accepted a connection before readyWithinMs passed' });
  } else {
    expected.exchanges.forEach((response, i) => {
      const at = `exchanges[${String(i)}]`;
      const seen = observed.observations[i];
      if (seen === undefined) mismatches.push({ field: at, expected: `a response with status ${String(response.status)}`, observed: 'no observation' });
      else compareResponse(response, seen, at, mismatches);
    });
  }
  const [first, ...rest] = mismatches;
  return first === undefined ? { held: true } : { held: false, mismatches: [first, ...rest] };
}

/** A provider with a probe. Narrowed once, at construction, so `run` never finds it missing. */
type ProbingProvider = SandboxProvider & { probe(h: SandboxHandle, request: ProbeRequest): Promise<ProbeResult> };

export function canProbe(provider: SandboxProvider): provider is ProbingProvider {
  return typeof provider.probe === 'function';
}

export class HttpBehavioralAdapter implements BehavioralAdapter {
  readonly kind = 'http' as const;
  readonly #provider: ProbingProvider;
  readonly #served = new Set<SandboxHandle>();

  /** The provider that provisioned the handles this adapter will be given. One without a probe is refused: it cannot observe the product from outside it. */
  constructor(provider: SandboxProvider) {
    if (!canProbe(provider)) {
      refuse('unsupported-feature', `sandbox provider ${provider.id} has no probe, so an HTTP client would run where the product can replace it`);
    }
    this.#provider = provider;
  }

  async run(scenario: BehavioralScenario, h: SandboxHandle): Promise<CheckResult> {
    const { input, expected } = readHttpScenario(scenario);
    if (this.#served.has(h)) {
      refuse('unrecognised-scenario', `scenario ${scenario.id}: sandbox ${h} already ran an HTTP scenario, whose server still holds it; each HTTP scenario needs a fresh sandbox`);
    }
    this.#served.add(h);
    const startedAt = new Date().toISOString();
    // A provider that cannot run the command throws, and there is no result to report: the
    // caller's gate treats a required check with no result as a failure.
    const started = await this.#provider.exec(h, [...input.serve], { detach: true });
    const base = { checkId: scenario.id, exitCode: started.exitCode, stderr: started.stderr, suiteCount: null, startedAt };
    if (started.exitCode !== 0) {
      return {
        ...base,
        stdout: '',
        expectation: { held: false, mismatches: [{ field: 'serve', expected: 'the server started', observed: `the start exited ${String(started.exitCode)}: ${quote(started.stderr)}` }] },
        durationMs: started.durationMs,
      };
    }
    const observed = await this.#provider.probe(h, { port: input.port, readyWithinMs: input.readyWithinMs, exchanges: input.exchanges });
    return {
      ...base,
      // The probe's whole report is the evidence; the expectation is the verdict drawn from it.
      stdout: JSON.stringify(observed),
      expectation: compareHttp(expected, observed),
      durationMs: started.durationMs + observed.durationMs,
    };
  }
}
