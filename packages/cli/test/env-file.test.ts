/**
 * `--env-file` (R36b): the file `factory-host init` wrote names the host's
 * address and token, so no variable is set by hand.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli, type CliIo } from '../src/cli.js';

function io(): CliIo & { lines: string[]; errors: string[]; calls: Array<{ url: string; auth: string | null }> } {
  const lines: string[] = [];
  const errors: string[] = [];
  const calls: Array<{ url: string; auth: string | null }> = [];
  return {
    lines, errors, calls, env: {},
    fetch: ((url: URL | string, opts?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(opts?.headers).get('authorization') });
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }) as typeof fetch,
    out: (line) => { lines.push(line); },
    err: (line) => { errors.push(line); },
  };
}

describe('--env-file', () => {
  test('the address and token come from the file init wrote; a flag still wins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'r36b-cli-'));
    try {
      const file = join(dir, 'host.env');
      await writeFile(file, `# host\nFACTORY_API_TOKEN=${'t'.repeat(64)}\nFACTORY_LISTEN_PORT=7300\nFACTORY_REPOSITORY=C:\repo\n`);
      const out = io();
      expect(await runCli(['--env-file', file, 'status', 'run-1'], out)).toBe(0);
      expect(out.calls).toEqual([{ url: 'http://127.0.0.1:7300/runs/run-1', auth: `Bearer ${'t'.repeat(64)}` }]);
      const flagged = io();
      expect(await runCli(['status', 'run-1', '--env-file', file, '--url', 'http://127.0.0.1:9000'], flagged)).toBe(0);
      expect(flagged.calls[0]?.url).toBe('http://127.0.0.1:9000/runs/run-1');
      const missing = io();
      expect(await runCli(['--env-file', join(dir, 'none.env'), 'status', 'run-1'], missing)).toBe(2);
      expect(missing.errors.join('\n')).toMatch(/could not be read/u);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
