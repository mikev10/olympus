/**
 * A browser scenario, served inside the sandbox, driven by a browser the
 * product cannot reach, and judged on the host (R3).
 *
 * The scenario owns its server, as an HTTP scenario does (D-P11-03): `serve`
 * is started detached in the sandbox, and the provider's browser, a container
 * in the sandbox's network namespace and out of its filesystem, carries out
 * the steps and reports what was on the page. The comparison against
 * `expected` happens here, in the runtime's own process. A browser inside the
 * product's container would be one the product could replace, and what it
 * saw would be the product's report of itself (I2).
 *
 * A step names its element by what a person sees: a role and accessible
 * name, a label, or visible text. Nothing here reads a selector, a script, or
 * a URL, so a scenario locked before `build` does not depend on markup the
 * agent chooses afterwards (I3).
 *
 * One scenario per handle, per adapter, for the reason the HTTP adapter
 * gives: the first scenario's server holds the sandbox until it ends.
 *
 * `expected` comes from locked acceptance criteria and never from the
 * implementation. This adapter cannot check that; it takes the value it is
 * handed and refuses one it cannot read.
 */
import type { CheckResult, ExpectationMismatch, ExpectationOutcome } from '@olympus-ai/integrity';
import type { BrowseObservation, BrowseRequest, BrowseResult, BrowseStep, BrowseTarget, SandboxHandle, SandboxProvider } from '@olympus-ai/sandbox';
import { DEFAULT_READY_WITHIN_MS } from './http.js';
import { refuse } from './refusal.js';
import type { BehavioralAdapter, BehavioralScenario } from './types.js';

export interface BrowserInput {
  readonly serve: readonly [string, ...string[]];
  readonly port: number;
  readonly readyWithinMs: number;
  readonly steps: readonly [BrowseStep, ...BrowseStep[]];
  /** The hosts the locked scenario expects the page to ask for and do without, lower-cased. A refused host not listed here fails the scenario (D-A-BR-05). */
  readonly mayBlock: readonly string[];
}

/**
 * What one `observe` step must show. Only the fields named are compared, and
 * at least one is named. Unless `matched` is named, the target must have
 * matched exactly one element: an expectation is never held against one
 * element picked from several, or against none (D-R3-08). Unless `visible` is
 * named, `text` and `value` are held against a visible element only.
 */
export interface BrowserExpectedObservation {
  readonly matched?: number;
  readonly visible?: boolean;
  readonly text?: string;
  /** `null` holds the element to having no value at all, as anything but a form field does. */
  readonly value?: string | null;
  readonly path?: string;
  readonly title?: string;
}

export interface BrowserExpected {
  readonly observations: readonly BrowserExpectedObservation[];
}

const INPUT_KEYS: ReadonlySet<string> = new Set(['serve', 'port', 'readyWithinMs', 'steps', 'mayBlock']);
const EXPECTED_KEYS: ReadonlySet<string> = new Set(['observations']);
const OBSERVATION_KEYS: ReadonlySet<string> = new Set(['matched', 'visible', 'text', 'value', 'path', 'title']);
const STEP_KEYS: Readonly<Record<BrowseStep['do'], ReadonlySet<string>>> = {
  goto: new Set(['do', 'path']),
  click: new Set(['do', 'target']),
  fill: new Set(['do', 'target', 'value']),
  press: new Set(['do', 'key']),
  observe: new Set(['do', 'target']),
};
/** How much of an observed text a mismatch quotes; the whole observation is in the result beside it. */
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

/** An array's entries by index, holes included as undefined, so none is an entry nothing checked. */
function dense(value: readonly unknown[]): unknown[] {
  return Array.from(value);
}

function strings(value: unknown, label: string): string[] {
  const items = Array.isArray(value) ? dense(value) : [];
  if (!Array.isArray(value) || !items.every((item): item is string => typeof item === 'string' && item.trim() !== '')) {
    refuse('unrecognised-scenario', `${label} must be an array of non-empty strings`);
  }
  return items;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    refuse('unrecognised-scenario', `${label} must be an integer from ${String(min)} to ${String(max)}`);
  }
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') refuse('unrecognised-scenario', `${label} must be a non-empty string`);
  return value;
}

function readTarget(value: unknown, at: string): BrowseTarget {
  const forms = 'a role and name, a label, or a text';
  if (!isRecord(value)) refuse('unrecognised-scenario', `${at} must name its element by ${forms}`);
  const keys = Object.keys(value).sort().join(',');
  if (keys === 'name,role') {
    if (typeof value.name !== 'string') refuse('unrecognised-scenario', `${at}.name must be a string`);
    return { role: text(value.role, `${at}.role`), name: value.name };
  }
  if (keys === 'label') return { label: text(value.label, `${at}.label`) };
  if (keys === 'text') return { text: text(value.text, `${at}.text`) };
  // A selector, a script, or a URL is a key none of the three forms has.
  refuse('unrecognised-scenario', `${at} must name its element by exactly one of ${forms}; it has ${Object.keys(value).join(', ') || 'no key'}`);
}

function readStep(value: unknown, i: number): BrowseStep {
  const at = `input.steps[${String(i)}]`;
  if (!isRecord(value)) refuse('unrecognised-scenario', `${at} must be an object`);
  const kind = value.do;
  if (kind !== 'goto' && kind !== 'click' && kind !== 'fill' && kind !== 'press' && kind !== 'observe') {
    refuse('unrecognised-scenario', `${at}.do must be one of goto, click, fill, press, observe`);
  }
  unknownKeys(value, STEP_KEYS[kind], at);
  if (kind === 'goto') {
    if (typeof value.path !== 'string' || !value.path.startsWith('/') || /\s/u.test(value.path)) {
      refuse('unrecognised-scenario', `${at}.path must be a path beginning with / and holding no whitespace; the host is always the sandbox's loopback`);
    }
    return { do: 'goto', path: value.path };
  }
  if (kind === 'press') return { do: 'press', key: text(value.key, `${at}.key`) };
  const target = readTarget(value.target, `${at}.target`);
  if (kind === 'fill') {
    if (typeof value.value !== 'string') refuse('unrecognised-scenario', `${at}.value must be a string`);
    return { do: 'fill', target, value: value.value };
  }
  return { do: kind, target };
}

function readObservation(value: unknown, i: number): BrowserExpectedObservation {
  const at = `expected.observations[${String(i)}]`;
  if (!isRecord(value)) refuse('unrecognised-scenario', `${at} must be an object`);
  unknownKeys(value, OBSERVATION_KEYS, at);
  // An entry that names nothing would hold the page to nothing.
  if (Object.keys(value).length === 0) refuse('unrecognised-scenario', `${at} names no field, so it would hold the page to nothing`);
  if (value.visible !== undefined && typeof value.visible !== 'boolean') refuse('unrecognised-scenario', `${at}.visible must be true or false`);
  for (const field of ['text', 'path', 'title'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'string') refuse('unrecognised-scenario', `${at}.${field} must be a string`);
  }
  if ('value' in value && value.value !== null && typeof value.value !== 'string') refuse('unrecognised-scenario', `${at}.value must be a string or null`);
  // visible, text, and value are read from one element, so an entry that expects none or several cannot also name them.
  if (value.matched !== undefined && value.matched !== 1 && (value.visible !== undefined || value.text !== undefined || 'value' in value)) {
    refuse('unrecognised-scenario', `${at}.matched is not 1, so ${at} cannot also name visible, text, or value: there is no one element to read them from`);
  }
  return {
    ...(value.matched === undefined ? {} : { matched: integer(value.matched, `${at}.matched`, 0, 1_000_000) }),
    ...(typeof value.visible === 'boolean' ? { visible: value.visible } : {}),
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...('value' in value ? { value: value.value as string | null } : {}),
    ...(typeof value.path === 'string' ? { path: value.path } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
  };
}

export function readBrowserScenario(scenario: BehavioralScenario): { input: BrowserInput; expected: BrowserExpected } {
  if (typeof scenario.id !== 'string' || scenario.id === '') refuse('unrecognised-scenario', 'scenario.id must be a non-empty string');
  const { input, expected } = scenario;
  if (!isRecord(input)) refuse('unrecognised-scenario', `scenario ${scenario.id}: input must be an object`);
  unknownKeys(input, INPUT_KEYS, 'input');
  const [command, ...args] = strings(input.serve, 'input.serve');
  if (command === undefined) refuse('unrecognised-scenario', 'input.serve must be a non-empty array of non-empty strings');
  const port = integer(input.port, 'input.port', 1, 65535);
  const readyWithinMs = input.readyWithinMs === undefined ? DEFAULT_READY_WITHIN_MS : integer(input.readyWithinMs, 'input.readyWithinMs', 1, 600_000);
  if (!Array.isArray(input.steps)) refuse('unrecognised-scenario', 'input.steps must be a non-empty array');
  const [first, ...rest] = dense(input.steps).map(readStep);
  if (first === undefined) refuse('unrecognised-scenario', 'input.steps must be a non-empty array');
  // The browser starts on no page, so a step before the first goto has nothing to act on.
  if (first.do !== 'goto') refuse('unrecognised-scenario', 'input.steps[0] must be a goto: the browser starts on no page');
  const observes = [first, ...rest].filter((step) => step.do === 'observe').length;
  if (observes === 0) refuse('unrecognised-scenario', 'input.steps has no observe step, so the scenario would judge nothing');
  const mayBlock = input.mayBlock === undefined ? [] : strings(input.mayBlock, 'input.mayBlock').map((host) => host.trim().toLowerCase());

  if (!isRecord(expected)) refuse('unrecognised-scenario', `scenario ${scenario.id}: expected must be an object`);
  unknownKeys(expected, EXPECTED_KEYS, 'expected');
  if (!Array.isArray(expected.observations)) refuse('unrecognised-scenario', 'expected.observations must be an array');
  const observations = dense(expected.observations).map(readObservation);
  if (observations.length !== observes) {
    refuse('unrecognised-scenario', `expected.observations has ${String(observations.length)} entries for ${String(observes)} observe steps in input.steps; each observe step needs one`);
  }
  return { input: { serve: [command, ...args], port, readyWithinMs, steps: [first, ...rest], mayBlock }, expected: { observations } };
}

function quote(observed: string): string {
  if (observed.length <= QUOTE_LIMIT) return observed;
  return `${observed.slice(0, QUOTE_LIMIT)}… (${String(observed.length - QUOTE_LIMIT)} more characters in the result)`;
}

function compareObservation(expected: BrowserExpectedObservation, observed: BrowseObservation, at: string, out: ExpectationMismatch[]): void {
  if (observed.kind === 'not-reached') {
    out.push({ field: at, expected: 'an observation of the page', observed: `none was made: ${observed.reason}` });
    return;
  }
  const wanted = expected.matched ?? 1;
  if (observed.matched !== wanted) {
    out.push({
      field: `${at}.matched`,
      expected: expected.matched === undefined ? 'exactly 1 element, since no element is picked from several or from none' : String(wanted),
      observed: String(observed.matched),
    });
  }
  // What an element shows is compared only when the target named one element. Otherwise the mismatch on matched above is the failure.
  if (observed.matched === 1) {
    if (expected.visible !== undefined && observed.visible !== expected.visible) {
      out.push({ field: `${at}.visible`, expected: String(expected.visible), observed: String(observed.visible) });
    }
    // Text and a value are what a person reads. Held against an element nobody can see, they would pass on a page
    // that shows nothing, so they require a visible one unless the scenario says it expects the element hidden.
    if (expected.visible === undefined && !observed.visible && (expected.text !== undefined || 'value' in expected)) {
      out.push({ field: `${at}.visible`, expected: 'true, since text and value are read from an element a person can see', observed: 'false' });
    }
    if (expected.text !== undefined && observed.text !== expected.text) out.push({ field: `${at}.text`, expected: expected.text, observed: quote(observed.text) });
    if ('value' in expected && observed.value !== expected.value) {
      out.push({ field: `${at}.value`, expected: expected.value ?? '(no value)', observed: observed.value === null ? '(no value)' : quote(observed.value) });
    }
  }
  if (expected.path !== undefined && observed.path !== expected.path) out.push({ field: `${at}.path`, expected: expected.path, observed: quote(observed.path) });
  if (expected.title !== undefined && observed.title !== expected.title) out.push({ field: `${at}.title`, expected: expected.title, observed: quote(observed.title) });
}

/**
 * The runtime's comparison. Pure, so what decides a verdict is testable
 * without a browser. A port that never answered, a step that could not be
 * done, a refused host the scenario does not list, a document that tried to
 * leave the loopback, and an observation that was not made each fail it, and
 * none is read as a pass for want of something to compare (I5).
 */
export function compareBrowser(expected: BrowserExpected, mayBlock: readonly string[], observed: BrowseResult): ExpectationOutcome {
  const mismatches: ExpectationMismatch[] = [];
  if (!observed.ready) {
    mismatches.push({ field: 'ready', expected: 'the server listening on its port', observed: 'nothing accepted a connection before readyWithinMs passed' });
  } else {
    if (observed.failedStep !== null) {
      mismatches.push({ field: `steps[${String(observed.failedStep.index)}]`, expected: 'the step done', observed: observed.failedStep.reason });
    }
    for (const refused of observed.blocked) {
      const host = refused.host.toLowerCase();
      if (refused.navigation) {
        // Listed or not: a page that leaves the loopback has left what the scenario can observe.
        mismatches.push({ field: `blocked.${host}`, expected: "the document staying on the sandbox's loopback", observed: `the document tried to navigate to ${host}` });
      } else if (!mayBlock.includes(host)) {
        mismatches.push({
          field: `blocked.${host}`,
          expected: 'no request to a host the scenario does not list in mayBlock',
          observed: `${String(refused.requests)} refused, and the page was shown without what it asked ${host} for`,
        });
      }
    }
    expected.observations.forEach((wanted, i) => {
      const at = `observations[${String(i)}]`;
      const seen = observed.observations[i];
      if (seen === undefined) mismatches.push({ field: at, expected: 'an observation of the page', observed: 'no observation' });
      else compareObservation(wanted, seen, at, mismatches);
    });
    if (observed.observations.length > expected.observations.length) {
      mismatches.push({ field: 'observations', expected: `${String(expected.observations.length)} observations`, observed: String(observed.observations.length) });
    }
  }
  const [first, ...rest] = mismatches;
  return first === undefined ? { held: true } : { held: false, mismatches: [first, ...rest] };
}

/** A provider with a browser. Narrowed once, at construction, so `run` never finds it missing. */
type BrowsingProvider = SandboxProvider & { browse(h: SandboxHandle, request: BrowseRequest): Promise<BrowseResult> };

export function canBrowse(provider: SandboxProvider): provider is BrowsingProvider {
  return typeof provider.browse === 'function';
}

export class BrowserBehavioralAdapter implements BehavioralAdapter {
  readonly kind = 'browser' as const;
  readonly #provider: BrowsingProvider;
  readonly #served = new Set<SandboxHandle>();

  /** The provider that provisioned the handles this adapter will be given. One that cannot browse is refused: its browser would run where the product can replace it. */
  constructor(provider: SandboxProvider) {
    if (!canBrowse(provider)) {
      refuse('unsupported-feature', `sandbox provider ${provider.id} has no browse, so a browser would run where the product can replace it`);
    }
    this.#provider = provider;
  }

  async run(scenario: BehavioralScenario, h: SandboxHandle): Promise<CheckResult> {
    const { input, expected } = readBrowserScenario(scenario);
    if (this.#served.has(h)) {
      refuse('unrecognised-scenario', `scenario ${scenario.id}: sandbox ${h} already ran a browser scenario, whose server still holds it; each browser scenario needs a fresh sandbox`);
    }
    this.#served.add(h);
    const startedAt = new Date().toISOString();
    // A provider that cannot run the command throws, and there is no result to report: the
    // caller's gate treats a required check with no result as a failure.
    const started = await this.#provider.exec(h, [...input.serve], { detach: true });
    const base = { checkId: scenario.id, exitCode: started.exitCode, stderr: started.stderr, suiteCount: null, findings: null, property: null, startedAt };
    if (started.exitCode !== 0) {
      return {
        ...base,
        stdout: '',
        expectation: { held: false, mismatches: [{ field: 'serve', expected: 'the server started', observed: `the start exited ${String(started.exitCode)}: ${quote(started.stderr)}` }] },
        durationMs: started.durationMs,
      };
    }
    const observed = await this.#provider.browse(h, { port: input.port, readyWithinMs: input.readyWithinMs, steps: input.steps });
    return {
      ...base,
      // The browser's whole report is the evidence, the browser that made it included; the expectation is the verdict drawn from it.
      stdout: JSON.stringify(observed),
      expectation: compareBrowser(expected, input.mayBlock, observed),
      durationMs: started.durationMs + observed.durationMs,
    };
  }
}
