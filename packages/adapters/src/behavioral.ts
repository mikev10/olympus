/**
 * A CLI scenario, run inside the sandbox and judged on the host.
 *
 * The product runs as the scenario's argument vector through
 * `provider.exec`, with the scenario's stdin, and nothing else runs in the
 * container on its behalf. The comparison against `expected` happens here,
 * in the runtime's own process: the sandbox has no read-only root and no
 * dedicated user, and its image is the caller's, so a comparator inside it
 * could be replaced by anything that ran there first (A-P8-01, D-P8-02).
 *
 * `expected` comes from locked acceptance criteria and never from the
 * implementation (I3). This adapter cannot check that; it takes the value it
 * is handed and refuses one it cannot read.
 */
import type { CheckResult, ExpectationMismatch, ExpectationOutcome } from '@olympus-ai/integrity';
import type { SandboxHandle, SandboxProvider } from '@olympus-ai/sandbox';
import { refuse } from './refusal.js';
import type { BehavioralAdapter, BehavioralScenario } from './types.js';

export interface CliInput {
  readonly argv: readonly [string, ...string[]];
  readonly stdin?: string;
}

/**
 * What the run must show. `exitCode` defaults to 0: a scenario that means
 * to test a failure states the code it expects, and one that says nothing
 * about exit status has not agreed to a crash.
 */
export interface CliExpected {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stdoutIncludes?: readonly string[];
  readonly stderr?: string;
  readonly stderrIncludes?: readonly string[];
}

const INPUT_KEYS: ReadonlySet<string> = new Set(['argv', 'stdin']);
const EXPECTED_KEYS: ReadonlySet<string> = new Set(['exitCode', 'stdout', 'stdoutIncludes', 'stderr', 'stderrIncludes']);
/** How much of an observed stream a mismatch quotes; the whole stream is in the result beside it. */
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

function strings(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item): item is string => typeof item === 'string' && item !== '')) {
    refuse('unrecognised-scenario', `${label} must be a non-empty array of non-empty strings`);
  }
  return value;
}

export function readCliScenario(scenario: BehavioralScenario): { input: CliInput; expected: CliExpected } {
  if (typeof scenario.id !== 'string' || scenario.id === '') refuse('unrecognised-scenario', 'scenario.id must be a non-empty string');
  const { input, expected } = scenario;
  if (!isRecord(input)) refuse('unrecognised-scenario', `scenario ${scenario.id}: input must be an object`);
  unknownKeys(input, INPUT_KEYS, 'input');
  const argv = strings(input.argv, 'input.argv');
  const [program, ...rest] = argv;
  if (program === undefined) refuse('unrecognised-scenario', 'input.argv is empty');
  if (input.stdin !== undefined && typeof input.stdin !== 'string') refuse('unrecognised-scenario', 'input.stdin must be a string');

  if (!isRecord(expected)) refuse('unrecognised-scenario', `scenario ${scenario.id}: expected must be an object`);
  unknownKeys(expected, EXPECTED_KEYS, 'expected');
  const exitCode = expected.exitCode ?? 0;
  if (typeof exitCode !== 'number' || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    refuse('unrecognised-scenario', 'expected.exitCode must be an integer from 0 to 255');
  }
  for (const key of ['stdout', 'stderr'] as const) {
    if (expected[key] !== undefined && typeof expected[key] !== 'string') refuse('unrecognised-scenario', `expected.${key} must be a string`);
  }
  return {
    input: { argv: [program, ...rest], ...(typeof input.stdin === 'string' ? { stdin: input.stdin } : {}) },
    expected: {
      exitCode,
      ...(typeof expected.stdout === 'string' ? { stdout: expected.stdout } : {}),
      ...(typeof expected.stderr === 'string' ? { stderr: expected.stderr } : {}),
      ...(expected.stdoutIncludes === undefined ? {} : { stdoutIncludes: strings(expected.stdoutIncludes, 'expected.stdoutIncludes') }),
      ...(expected.stderrIncludes === undefined ? {} : { stderrIncludes: strings(expected.stderrIncludes, 'expected.stderrIncludes') }),
    },
  };
}

function quote(observed: string): string {
  if (observed.length <= QUOTE_LIMIT) return observed;
  return `${observed.slice(0, QUOTE_LIMIT)}… (${String(observed.length - QUOTE_LIMIT)} more characters in the result)`;
}

/** The runtime's comparison. Pure, so what decides a verdict is testable without a container. */
export function compareCli(expected: CliExpected, observed: { exitCode: number; stdout: string; stderr: string }): ExpectationOutcome {
  const mismatches: ExpectationMismatch[] = [];
  if (observed.exitCode !== expected.exitCode) {
    mismatches.push({ field: 'exitCode', expected: String(expected.exitCode), observed: String(observed.exitCode) });
  }
  for (const stream of ['stdout', 'stderr'] as const) {
    const exact = expected[stream];
    if (exact !== undefined && observed[stream] !== exact) mismatches.push({ field: stream, expected: exact, observed: quote(observed[stream]) });
    const includes = stream === 'stdout' ? expected.stdoutIncludes : expected.stderrIncludes;
    (includes ?? []).forEach((fragment, i) => {
      if (!observed[stream].includes(fragment)) {
        mismatches.push({ field: `${stream}Includes[${String(i)}]`, expected: fragment, observed: quote(observed[stream]) });
      }
    });
  }
  const [first, ...rest] = mismatches;
  return first === undefined ? { held: true } : { held: false, mismatches: [first, ...rest] };
}

export class CliBehavioralAdapter implements BehavioralAdapter {
  readonly kind = 'cli' as const;
  readonly #provider: SandboxProvider;

  /** The provider that provisioned the handles this adapter will be given. There is no way to run a scenario without one. */
  constructor(provider: SandboxProvider) {
    this.#provider = provider;
  }

  async run(scenario: BehavioralScenario, h: SandboxHandle): Promise<CheckResult> {
    const { input, expected } = readCliScenario(scenario);
    const startedAt = new Date().toISOString();
    // A provider that cannot run the command throws, and there is no result to report: the
    // caller's gate treats a required check with no result as a failure.
    const observed = await this.#provider.exec(h, [...input.argv], input.stdin === undefined ? {} : { stdin: input.stdin });
    return {
      checkId: scenario.id,
      exitCode: observed.exitCode,
      stdout: observed.stdout,
      stderr: observed.stderr,
      suiteCount: null,
      expectation: compareCli(expected, observed),
      durationMs: observed.durationMs,
      startedAt,
    };
  }
}
