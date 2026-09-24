/**
 * A CLI scenario runs inside the sandbox and is judged on the host. The
 * comparison is asserted on its own, and then end to end against a real
 * container: this suite requires a Docker daemon and fails without one,
 * because a behavioral check that skips itself proves nothing (I5).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { LocalDockerProvider, type SandboxHandle } from '@olympus-ai/sandbox';
import { AdapterRefusal, CliBehavioralAdapter, compareCli, readCliScenario } from '../src/index.js';

/**
 * Alpine, pinned by digest. `packages/sandbox/test/image.ts` pins the same
 * image for its own suite; the two are independent and neither follows the
 * other.
 */
const TEST_IMAGE = 'alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

describe('readCliScenario', () => {
  test('reads argv, stdin, and every expectation, and defaults the expected exit code to 0', () => {
    expect(readCliScenario({ id: 's', input: { argv: ['greet', 'x'], stdin: 'in' }, expected: { stdoutIncludes: ['hi'] } })).toEqual({
      input: { argv: ['greet', 'x'], stdin: 'in' },
      expected: { exitCode: 0, stdoutIncludes: ['hi'] },
    });
  });

  test.each([
    ['an unknown input key', { argv: ['a'], cwd: '/tmp' }, {}, /input\.cwd/],
    ['an unknown expected key', { argv: ['a'] }, { stdoutMatches: 'x' }, /expected\.stdoutMatches/],
    ['an empty argv', { argv: [] }, {}, /input\.argv/],
    ['argv that is not strings', { argv: ['a', 1] }, {}, /input\.argv/],
    ['a non-integer exit code', { argv: ['a'] }, { exitCode: 1.5 }, /expected\.exitCode/],
    ['an empty includes list', { argv: ['a'] }, { stderrIncludes: [] }, /expected\.stderrIncludes/],
    ['input that is not an object', 'run a', {}, /input must be an object/],
  ])('%s is refused, naming the field', (_, input, expected, field) => {
    const read = (): unknown => readCliScenario({ id: 's', input, expected });
    expect(read).toThrow(AdapterRefusal);
    expect(read).toThrow(field);
  });
});

describe('compareCli', () => {
  test('a process that exits 0 with the wrong output does not hold', () => {
    expect(compareCli({ exitCode: 0, stdout: 'hello\n' }, { exitCode: 0, stdout: 'goodbye\n', stderr: '' })).toEqual({
      held: false,
      mismatches: [{ field: 'stdout', expected: 'hello\n', observed: 'goodbye\n' }],
    });
  });

  test('a scenario that expects a failure holds when the process fails as expected', () => {
    expect(compareCli({ exitCode: 2, stderrIncludes: ['usage'] }, { exitCode: 2, stdout: '', stderr: 'usage: x' })).toEqual({ held: true });
  });

  test('an unexpected crash does not hold even when the scenario says nothing about exit status', () => {
    const outcome = compareCli({ exitCode: 0, stdoutIncludes: ['ok'] }, { exitCode: 1, stdout: 'ok', stderr: '' });
    expect(outcome).toEqual({ held: false, mismatches: [{ field: 'exitCode', expected: '0', observed: '1' }] });
  });

  test('every mismatch is named, and a long observation is quoted, not copied whole', () => {
    const outcome = compareCli({ exitCode: 0, stdoutIncludes: ['a', 'b'] }, { exitCode: 0, stdout: 'x'.repeat(5000), stderr: '' });
    expect(outcome.held).toBe(false);
    if (outcome.held) return;
    expect(outcome.mismatches.map((m) => m.field)).toEqual(['stdoutIncludes[0]', 'stdoutIncludes[1]']);
    expect(outcome.mismatches[0].observed).toMatch(/\(3976 more characters in the result\)$/);
  });
});

describe('CliBehavioralAdapter against a container', () => {
  let provider: LocalDockerProvider;
  let workspace: string;
  let handle: SandboxHandle;

  beforeAll(async () => {
    // Not wrapped: no daemon is a failing suite, never a skipped one.
    provider = await LocalDockerProvider.create({ vaultPaths: [] });
    workspace = await mkdtemp(join(tmpdir(), 'adapters-cli-'));
    handle = await provider.provision({
      image: TEST_IMAGE,
      mounts: { workspace: { source: workspace, target: '/workspace', mode: 'ro' }, others: [] },
      egress: { mode: 'deny-all', allow: [] },
      limits: { cpus: 0.5, memoryMb: 128, pids: 32, wallClockMs: 60_000 },
      user: { uid: 0, gid: 0 },
    });
  });

  afterAll(async () => {
    await provider.destroy(handle);
    await rm(workspace, { recursive: true, force: true });
  });

  test('a scenario runs in the container, its stdin reaches the process, and a matching run holds', async () => {
    const adapter = new CliBehavioralAdapter(provider);
    const result = await adapter.run(
      { id: 'upper', input: { argv: ['sh', '-c', 'cat /etc/alpine-release >/dev/null && tr a-z A-Z'], stdin: 'hello\n' }, expected: { stdout: 'HELLO\n' } },
      handle,
    );
    expect(result).toMatchObject({ checkId: 'upper', exitCode: 0, stdout: 'HELLO\n', suiteCount: null, expectation: { held: true } });
  });

  test('a product that exits 0 with the wrong output yields held: false, with the exit code recorded as evidence', async () => {
    const adapter = new CliBehavioralAdapter(provider);
    const result = await adapter.run({ id: 'wrong', input: { argv: ['echo', 'goodbye'] }, expected: { stdout: 'hello\n' } }, handle);
    expect(result.exitCode).toBe(0);
    expect(result.expectation).toEqual({ held: false, mismatches: [{ field: 'stdout', expected: 'hello\n', observed: 'goodbye\n' }] });
  });
});
