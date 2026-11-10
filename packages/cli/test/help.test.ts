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

  test('readiness asks the API for the revision it is given', async () => {
    const out = io();
    expect(await runCli(['readiness', '--revision', 'main', '--url', 'http://127.0.0.1:1', '--token', 't'], out)).toBe(0);
    expect(out.calls).toEqual(['http://127.0.0.1:1/readiness?revision=main']);
  });
});
