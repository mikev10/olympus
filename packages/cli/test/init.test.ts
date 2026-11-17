/**
 * `init` and `--env-file` (R36b): init needs no server and hands its request
 * to the setup the executable's entry supplies; `--env-file` names the host's
 * address and token, so no variable is set by hand.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { InitOutcome, InitRequest } from '@olympus-ai/api';
import { runCli, type CliIo } from '../src/cli.js';

function io(init?: (r: InitRequest) => Promise<InitOutcome>): CliIo & { lines: string[]; errors: string[]; calls: Array<{ url: string; auth: string | null }> } {
  const lines: string[] = [];
  const errors: string[] = [];
  const calls: Array<{ url: string; auth: string | null }> = [];
  return {
    lines, errors, calls, env: {}, home: resolve('/home/someone'), hostHasUids: false,
    ...(init === undefined ? {} : { init }),
    fetch: ((url: URL | string, opts?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(opts?.headers).get('authorization') });
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }) as typeof fetch,
    out: (line) => { lines.push(line); },
    err: (line) => { errors.push(line); },
  };
}

describe('init', () => {
  test('hands the setup the repository, the default configuration directory, the base branch, and whether the host has uids, and reaches no server', async () => {
    const seen: InitRequest[] = [];
    const out = io((r) => {
      seen.push(r);
      return Promise.resolve({ ok: true, repository: r.repository, stack: 'vitest@4', envFile: join(r.configDirectory, 'host.env'), manifest: 'm', graph: 'g', written: ['a', 'b'] });
    });
    expect(await runCli(['init', '--base-branch', 'trial'], out)).toBe(0);
    expect(seen).toEqual([{ repository: resolve('.'), configDirectory: join(resolve('/home/someone'), '.factory'), baseBranch: 'trial', hostHasUids: false }]);
    expect(out.calls).toEqual([]);
    expect(out.lines).toContain('stack: vitest@4');
    expect(out.lines.some((l) => l.includes(`factory-host --env-file ${join(resolve('/home/someone'), '.factory', 'host.env')}`))).toBe(true);
    expect(out.lines.some((l) => l.includes('create --workspace') && l.includes('--draft-spec --draft-tests') && l.includes('.factory/verify.json'))).toBe(true);
  });

  test('without --base-branch it is a usage error; a refusal exits 1 and says why', async () => {
    const out = io(() => Promise.resolve({ ok: false, reason: 'unsupported-stack', message: 'no package.json' }));
    expect(await runCli(['init'], out)).toBe(2);
    expect(out.errors.join('\n')).toMatch(/--base-branch/u);
    expect(await runCli(['init', '--base-branch', 'trial'], out)).toBe(1);
    expect(out.errors.at(-1)).toBe('init refused (unsupported-stack): no package.json');
  });
});

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
