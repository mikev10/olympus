/**
 * Per-command help (R35, #126): `<command> --help` prints one line per flag,
 * from the same table the parser reads, and needs no server.
 */
import { describe, expect, test } from 'vitest';
import { COMMANDS, GLOBAL_FLAGS, runCli, type CliIo } from '../src/cli.js';

function io(): CliIo & { readonly lines: string[]; readonly errors: string[]; readonly calls: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  const calls: string[] = [];
  return {
    lines, errors, calls, env: {},
    fetch: ((url: URL | string) => { calls.push(String(url)); return Promise.resolve(new Response('{}', { status: 200 })); }) as typeof fetch,
    out: (line) => { lines.push(...line.split('\n')); },
    err: (line) => { errors.push(...line.split('\n')); },
  };
}

describe('<command> --help', () => {
  for (const command of COMMANDS) {
    test(`${command.name} --help prints one line per flag and reaches no server`, async () => {
      const out = io();
      expect(await runCli([command.name, '--help'], out)).toBe(0);
      expect(out.calls).toEqual([]);
      expect(out.lines[0]).toMatch(new RegExp(`^usage: olympus-ai ${command.name}\\b`, 'u'));
      for (const [name, flag] of Object.entries({ ...command.flags, ...GLOBAL_FLAGS })) {
        const matching = out.lines.filter((l) => new RegExp(`^  --${name}\\b`, 'u').test(l));
        expect(matching, `--${name}`).toHaveLength(1);
        expect(matching[0]).toContain(flag.help);
      }
      const flagLines = out.lines.filter((l) => /^ {2}--/u.test(l));
      expect(flagLines).toHaveLength(Object.keys(command.flags).length + Object.keys(GLOBAL_FLAGS).length);
    });
  }

  test('the top-level usage names every command in the table', async () => {
    const out = io();
    expect(await runCli(['--help'], out)).toBe(0);
    for (const command of COMMANDS) expect(out.lines.some((l) => l.startsWith(`  ${command.name} `))).toBe(true);
  });

  test('the parser accepts exactly the flags the table names', async () => {
    for (const command of COMMANDS) {
      for (const [name, flag] of Object.entries(command.flags)) {
        const out = io();
        const args = flag.type === 'boolean' ? [`--${name}`] : [`--${name}`, 'x'];
        await runCli([command.name, ...args, '--url', 'http://127.0.0.1:1', '--token', 't'], out);
        expect(out.errors.join('\n'), `${command.name} --${name}`).not.toMatch(/Unknown option/u);
      }
      const out = io();
      expect(await runCli([command.name, '--not-a-flag', '--url', 'http://127.0.0.1:1', '--token', 't'], out)).toBe(2);
      expect(out.errors.join('\n')).toMatch(/Unknown option '--not-a-flag'/u);
    }
  });

  test('readiness asks the API for the revision it is given, and prints the report the stream ends with', async () => {
    const out = io();
    const report = { commit: 'c', ceiling: { kind: 'scanned' } };
    const sse = [
      'event: started', 'data: {"revision":"main","commit":"c"}', '',
      ': scanning', '',
      'event: report', `data: ${JSON.stringify(report)}`, '', '',
    ].join('\n');
    const calls: string[] = [];
    const streaming = { ...out, fetch: ((u: URL | string) => { calls.push(String(u)); return Promise.resolve(new Response(sse, { status: 200 })); }) as typeof fetch };
    expect(await runCli(['readiness', '--revision', 'main', '--url', 'http://127.0.0.1:1', '--token', 't'], streaming)).toBe(0);
    expect(calls).toEqual(['http://127.0.0.1:1/readiness?revision=main']);
    expect(JSON.parse(out.lines.join('\n'))).toEqual(report);
    expect(out.errors[0]).toMatch(/^scanning c/u);
  });

  test('a scan that fails exits 1, saying why', async () => {
    const out = io();
    const sse = ['event: started', 'data: {"commit":"c"}', '', 'event: failed', 'data: {"message":"no policy"}', '', ''].join('\n');
    const streaming = { ...out, fetch: (() => Promise.resolve(new Response(sse, { status: 200 }))) as typeof fetch };
    expect(await runCli(['readiness', '--url', 'http://127.0.0.1:1', '--token', 't'], streaming)).toBe(1);
    expect(out.errors).toContain('the scan failed: no policy');
    expect(out.lines).toEqual([]);
  });
});
