/**
 * The byte cap on a command's output (D-P8-15). `dockerCli` runs whatever
 * executable it is given with no shell, so Node stands in for `docker` here
 * and no daemon is needed: the bound is on what this process holds, which is
 * the same whoever is printing.
 */
import { describe, expect, test } from 'vitest';
import { CliOutputExceeded, DEFAULT_MAX_OUTPUT_BYTES, dockerCli } from '../src/local/docker.js';

const NODE = process.execPath;

function printing(stdout: number, stderr: number, thenWaitMs = 0): string[] {
  return ['-e', `process.stdout.write('a'.repeat(${String(stdout)})); process.stderr.write('b'.repeat(${String(stderr)})); setTimeout(() => {}, ${String(thenWaitMs)});`];
}

describe('dockerCli bounds what it holds of a command\'s output', () => {
  test('output under the cap, on both streams, is returned whole', async () => {
    const result = await dockerCli(NODE, printing(1000, 1000), { maxOutputBytes: 4096 });
    expect(result.stdout).toHaveLength(1000);
    expect(result.stderr).toHaveLength(1000);
  });

  test('output past the cap, counted across both streams, kills the command and refuses rather than truncating', async () => {
    const started = performance.now();
    const outcome = dockerCli(NODE, printing(3000, 3000, 60_000), { maxOutputBytes: 4096 });
    await expect(outcome).rejects.toBeInstanceOf(CliOutputExceeded);
    await expect(outcome).rejects.toThrow(/more than 4096 bytes/);
    // Killed, not waited out: the command would otherwise sleep a minute.
    expect(performance.now() - started).toBeLessThan(30_000);
  });

  test('with no cap given, the default applies; a cap that bounds nothing is refused', async () => {
    expect(DEFAULT_MAX_OUTPUT_BYTES).toBe(64 * 1024 * 1024);
    // The omitted-cap path itself, one byte past the default: pinning the constant alone guards nothing (codex-2).
    await expect(dockerCli(NODE, printing(DEFAULT_MAX_OUTPUT_BYTES + 1, 0, 60_000))).rejects.toBeInstanceOf(CliOutputExceeded);
    for (const cap of [0, -1, Number.NaN, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(dockerCli(NODE, printing(1, 0), { maxOutputBytes: cap })).rejects.toThrow(/bounds nothing/);
    }
  });
});
