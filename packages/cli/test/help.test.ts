/**
 * Per-command help (R35, #126): `<command> --help` prints one line per flag,
 * from the same table the parser reads, and needs no server.
 */
import { describe, expect, test } from 'vitest';
import { COMMANDS, GLOBAL_FLAGS, runCli, type CliIo } from '../src/cli.js';

/** The executable's name, spelled once and exactly: the I10 scan exempts it and nothing that embeds it. */
const CLI = 'olympus-ai';

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
      expect(out.lines[0]).toMatch(new RegExp(`^usage: ${CLI} ${command.name}\\b`, 'u'));
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

describe('what the table makes the parser send (review: codex-6)', () => {
  test('create sends every flag the table names into the body, repeated flags as lists', async () => {
    const bodies: unknown[] = [];
    const out = io();
    const capture = { ...out, fetch: ((_u: URL | string, init?: RequestInit) => { bodies.push(JSON.parse(init?.body as string)); return Promise.resolve(new Response('{}', { status: 201 })); }) as typeof fetch };
    const args = [
      'create', '--workspace', '/w', '--base-commit', 'c', '--level', '1',
      '--spec', 'a.md', '--spec', 'b.md', '--tests', 't1.md', '--tests', 't2.md',
      '--manifest', 'verify.json', '--graph', 'graph.json', '--security-part', 's.json', '--run-requirements', 'r.json', '--questions', 'q.json',
      '--acceptance-manifest', 'am.json', '--approve-cost', '2.5', '--intent', 'why',
      '--url', 'http://127.0.0.1:1', '--token', 't',
    ];
    expect(await runCli(args, capture)).toBe(0);
    expect(bodies).toEqual([{
      workspace: '/w', baseCommit: 'c', requestedLevel: 1,
      artifacts: {
        spec: ['a.md', 'b.md'], acceptanceTests: ['t1.md', 't2.md'], verificationManifest: 'verify.json', taskGraph: 'graph.json',
        acceptanceManifest: 'am.json', specParts: { security: 's.json', runRequirements: 'r.json', questions: 'q.json' },
      },
      approvedCostUsd: 2.5, intent: 'why',
    }]);
  });

  test('the drafting flags send draft, and approve, reject, and outcomes send what they were given', async () => {
    const sent: Array<{ url: string; body: unknown }> = [];
    const out = io();
    const capture = { ...out, fetch: ((u: URL | string, init?: RequestInit) => { sent.push({ url: String(u), body: init?.body === undefined ? null : JSON.parse(init.body as string) }); return Promise.resolve(new Response('{}', { status: 200 })); }) as typeof fetch };
    const target = ['--url', 'http://127.0.0.1:1', '--token', 't'];
    await runCli(['create', '--workspace', '/w', '--base-commit', 'c', '--level', '1', '--draft-spec', '--draft-tests', '--intent', 'i', '--manifest', 'm', '--graph', 'g', '--run-requirements', 'r', ...target], capture);
    await runCli(['approve', 'run-1', 'spec:1', '--draft', 'h', ...target], capture);
    await runCli(['reject', 'run-1', 'test-design:1', '--draft', 'h', '--reason', 'not-runnable', '--notes', 'n', ...target], capture);
    await runCli(['outcomes', '--from', '2026-01-01', '--to', '2026-02-01', ...target], capture);
    expect(sent[0]?.body).toMatchObject({ artifacts: { spec: 'draft', acceptanceTests: 'draft' }, intent: 'i' });
    expect(sent[1]).toEqual({ url: 'http://127.0.0.1:1/runs/run-1/approve', body: { key: 'spec:1', draft: 'h' } });
    expect(sent[2]).toEqual({ url: 'http://127.0.0.1:1/runs/run-1/reject', body: { key: 'test-design:1', draft: 'h', notes: 'n', reason: 'not-runnable' } });
    expect(sent[3]?.url).toBe('http://127.0.0.1:1/outcomes?from=2026-01-01&to=2026-02-01');
  });
});
