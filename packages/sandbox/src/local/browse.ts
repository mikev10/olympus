/**
 * The browser a browser scenario observes the product through (A-R3-01).
 *
 * Built beside the probe, and for the probe's reason: a browser inside the
 * product's container is one the product can replace, and what it saw would
 * be the product's report of itself.
 *
 * - One container per `browse()` call, started with
 *   `--network container:<sandbox>`. It shares the sandbox's loopback and not
 *   its filesystem or its process tree, and is gone when the call returns.
 * - It has the probe's limits and nothing more: a read-only root, every
 *   capability dropped, no new privileges, an unprivileged user, nothing
 *   mounted. It is also given a memory and a process ceiling, since a page is
 *   the agent's content and the sandbox's own limits do not reach a second
 *   container (D-R3-10).
 * - The request names a port and never a host. Everything else the page asks
 *   for is refused inside the container and reported (`browse-source.ts`).
 * - It observes and decides nothing.
 *
 * The image is the one place a browser comes from: pinned by digest, pulled
 * only by digest, and run by the content ID the engine reports for it, which
 * is what a result names.
 */
import type { BrowseBlockedHost, BrowseObservation, BrowseRequest, BrowseResult, BrowseStep } from '../types.js';
import { BROWSE_SOURCE } from './browse-source.js';
import { refuse } from './refusal.js';

/**
 * The Puppeteer project's own image, 25.19.0: Node, Chrome 158, and the
 * library that starts Chrome and speaks its protocol (D-R3-02). Pinned by
 * digest so the browser a reviewer gets is the browser CI got.
 */
export const BROWSER_IMAGE = 'ghcr.io/puppeteer/puppeteer@sha256:ee4d05f4d7817c2cbb1bc3e3cf2dd9ff7a40ffc899a99bdcf56ecef95503fe45';

/** Where `BROWSER_IMAGE` keeps the library and the browser. Both change with the pin and with nothing else. */
export const BROWSER_DRIVER_PATH = '/home/pptruser/node_modules/puppeteer-core';
export const BROWSER_EXECUTABLE_PATH = '/home/pptruser/.cache/puppeteer/chrome/linux-158.0.8127.88/chrome-linux64/chrome';

/** How long a `click` or `fill` waits for its target to name exactly one visible element, and a `goto` for its page to load. */
export const BROWSE_STEP_MS = 10_000;

/** The longest the browser waits for a page to go quiet before it reads it (D-R3-07). */
export const BROWSE_SETTLE_MS = 5_000;

/** How long a document must go unchanged, with no request in flight, to count as quiet. */
export const BROWSE_QUIET_MS = 250;

/** The browser container's memory ceiling, swap included. */
export const BROWSE_MEMORY = '2g';

/** The most processes and threads the browser container may hold. */
export const BROWSE_PIDS = 1024;

const STEP_KEYS: Readonly<Record<BrowseStep['do'], readonly string[]>> = {
  goto: ['do', 'path'],
  click: ['do', 'target'],
  fill: ['do', 'target', 'value'],
  press: ['do', 'key'],
  observe: ['do', 'target'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True when `text` holds a character below space, or DEL. */
function hasControl(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function checkTarget(target: unknown, at: string): void {
  const forms = 'a role and name, a label, or a text';
  if (!isRecord(target)) refuse('browse', `${at} must name its element by ${forms}`);
  if (sameKeys(target, ['role', 'name'])) {
    if (typeof target.role !== 'string' || target.role.trim() === '' || hasControl(target.role)) refuse('browse', `${at}.role must be a non-empty string`);
    if (typeof target.name !== 'string') refuse('browse', `${at}.name must be a string`);
    return;
  }
  for (const form of ['label', 'text'] as const) {
    if (!sameKeys(target, [form])) continue;
    const value = target[form];
    if (typeof value !== 'string' || value.trim() === '') refuse('browse', `${at}.${form} must be a non-empty string`);
    return;
  }
  // A selector, a script, or a URL is a key none of the three forms has.
  refuse('browse', `${at} must name its element by exactly one of ${forms}; it has ${Object.keys(target).join(', ') || 'no key'}`);
}

function checkStep(step: unknown, i: number): void {
  const at = `steps[${String(i)}]`;
  if (!isRecord(step)) refuse('browse', `${at} must be an object`);
  const kind = step.do;
  if (typeof kind !== 'string' || !Object.hasOwn(STEP_KEYS, kind)) refuse('browse', `${at}.do must be one of goto, click, fill, press, observe`);
  const keys = STEP_KEYS[kind as BrowseStep['do']];
  const extra = Object.keys(step).filter((key) => !keys.includes(key));
  if (extra.length > 0) refuse('browse', `${at} has ${extra.join(', ')}, which a ${kind} step does not carry`);
  if (kind === 'goto') {
    const path = step.path;
    if (typeof path !== 'string' || !path.startsWith('/') || /\s/.test(path) || hasControl(path)) {
      refuse('browse', `${at}.path must begin with / and contain no whitespace or control characters; the host is always the sandbox's loopback`);
    }
    return;
  }
  if (kind === 'press') {
    const key = step.key;
    if (typeof key !== 'string' || key === '' || key.length > 32 || hasControl(key)) refuse('browse', `${at}.key must be the name of one key`);
    return;
  }
  checkTarget(step.target, `${at}.target`);
  if (kind === 'fill' && typeof step.value !== 'string') refuse('browse', `${at}.value must be a string`);
}

/** Refuses a request the browser could not carry out as written, naming the field, rather than doing something else. */
export function checkBrowseRequest(request: BrowseRequest): void {
  if (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535) refuse('browse', 'port must be an integer from 1 to 65535');
  if (!Number.isInteger(request.readyWithinMs) || request.readyWithinMs <= 0) refuse('browse', 'readyWithinMs must be a positive integer');
  const steps: unknown = request.steps;
  if (!Array.isArray(steps) || steps.length === 0) refuse('browse', 'steps must be a non-empty list');
  // Array.from, so a hole is an entry that is checked and refused rather than one forEach skips.
  Array.from(steps as readonly unknown[]).forEach(checkStep);
  // The browser starts on no page, so anything before a goto has nothing to act on.
  if (request.steps[0].do !== 'goto') refuse('browse', 'steps[0] must be a goto: the browser starts on no page');
}

/**
 * What is written to the standard input of `node -` in the browser's
 * container: the request as a string literal, then the runner. JSON's own
 * escaping makes the request a literal and nothing else, so no part of a
 * scenario is read as code.
 */
export function browseProgram(request: BrowseRequest): string {
  return `'use strict';\nconst REQUEST = ${JSON.stringify(JSON.stringify(request))};\n${BROWSE_SOURCE}`;
}

function readObservation(value: unknown): BrowseObservation {
  if (!isRecord(value)) throw new Error('an observation is not an object');
  if (value.kind === 'not-reached' && typeof value.reason === 'string') return { kind: 'not-reached', reason: value.reason };
  if (
    value.kind === 'observed' &&
    typeof value.matched === 'number' && Number.isInteger(value.matched) && value.matched >= 0 &&
    typeof value.visible === 'boolean' &&
    typeof value.text === 'string' &&
    (value.value === null || typeof value.value === 'string') &&
    typeof value.path === 'string' &&
    typeof value.title === 'string'
  ) {
    return { kind: 'observed', matched: value.matched, visible: value.visible, text: value.text, value: value.value, path: value.path, title: value.title };
  }
  throw new Error(`an observation has an unknown shape: ${JSON.stringify(value).slice(0, 200)}`);
}

function readBlocked(value: unknown): BrowseBlockedHost {
  if (
    !isRecord(value) || typeof value.host !== 'string' || value.host === '' ||
    typeof value.requests !== 'number' || !Number.isInteger(value.requests) || value.requests < 0 || typeof value.navigation !== 'boolean'
  ) {
    throw new Error(`a refused host has an unknown shape: ${JSON.stringify(value).slice(0, 200)}`);
  }
  return { host: value.host, requests: value.requests, navigation: value.navigation };
}

/**
 * Reads what the browser's runner printed. The runner is the runtime's own
 * code, so a shape this does not know, or a report that does not add up, is
 * the runner breaking, and it throws rather than reports an observation that
 * was not made. `image` is the content ID the container was started from: the
 * provider's fact, which nothing inside the container supplies.
 */
export function readBrowseOutput(stdout: string, request: BrowseRequest, image: string): BrowseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`the browser printed something that is not JSON: ${stdout.slice(0, 200)}`);
  }
  if (
    !isRecord(parsed) || typeof parsed.ready !== 'boolean' || !Array.isArray(parsed.observations) || !Array.isArray(parsed.blocked) ||
    typeof parsed.durationMs !== 'number' || !isRecord(parsed.browser)
  ) {
    throw new Error('the browser printed a result with an unknown shape');
  }
  const { name, version } = parsed.browser;
  if (typeof name !== 'string' || name === '' || typeof version !== 'string' || version === '') throw new Error('the browser did not say what it is');

  let failedStep: BrowseResult['failedStep'] = null;
  if (parsed.failedStep !== null) {
    const failed = parsed.failedStep;
    if (!isRecord(failed) || typeof failed.index !== 'number' || !Number.isInteger(failed.index) || typeof failed.reason !== 'string') {
      throw new Error('the browser reported a failed step with an unknown shape');
    }
    if (failed.index < 0 || failed.index >= request.steps.length) throw new Error(`the browser reported step ${String(failed.index)} failed, which the request does not have`);
    failedStep = { index: failed.index, reason: failed.reason };
  }

  const observations = Array.from(parsed.observations as readonly unknown[]).map(readObservation);
  const observes = request.steps.flatMap((step, i) => (step.do === 'observe' ? [i] : []));
  const expected = parsed.ready ? observes.length : 0;
  if (observations.length !== expected) throw new Error(`the browser reported ${String(observations.length)} observations for ${String(expected)} observe steps`);
  if (!parsed.ready && failedStep !== null) throw new Error('the browser reported a failed step on a port that never answered');
  // Which observations were made follows from the step that failed, and a report that disagrees is not one to compare.
  observations.forEach((observation, n) => {
    const stepIndex = observes[n];
    const reached = failedStep === null || (stepIndex !== undefined && stepIndex < failedStep.index);
    if (reached !== (observation.kind === 'observed')) throw new Error(`the browser's observation ${String(n)} does not agree with the step it says failed`);
  });

  return {
    ready: parsed.ready,
    observations,
    failedStep,
    blocked: Array.from(parsed.blocked as readonly unknown[]).map(readBlocked),
    browser: { name, version, image },
    durationMs: parsed.durationMs,
  };
}

/**
 * The `docker run` for one browser. The probe's arguments, with a memory and
 * a process ceiling added and nothing else: no capability, no mount, no
 * security option the probe lacks. The program arrives on standard input, so
 * the list is the same length whatever the scenario (D-R3-05). `--rm` so a
 * browser that finished is gone; the provider also removes it by name if its
 * call is still running when the sandbox ends. `labels` are the provider's
 * `--label` arguments, by which one still running when its owner is killed is
 * found.
 */
export function browseRunArgs(name: string, sandboxContainer: string, image: string, labels: readonly string[]): string[] {
  return [
    'run', '--rm', '--interactive',
    '--name', name,
    ...labels,
    '--network', `container:${sandboxContainer}`,
    '--env', `BROWSE_STEP_MS=${String(BROWSE_STEP_MS)}`,
    '--env', `BROWSE_SETTLE_MS=${String(BROWSE_SETTLE_MS)}`,
    '--env', `BROWSE_QUIET_MS=${String(BROWSE_QUIET_MS)}`,
    '--env', `BROWSE_DRIVER=${BROWSER_DRIVER_PATH}`,
    '--env', `BROWSE_CHROME=${BROWSER_EXECUTABLE_PATH}`,
    '--read-only',
    '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges',
    '--user', '65534:65534',
    '--memory', BROWSE_MEMORY,
    '--memory-swap', BROWSE_MEMORY,
    '--pids-limit', String(BROWSE_PIDS),
    image,
    'node', '-',
  ];
}
