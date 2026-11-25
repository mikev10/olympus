/**
 * R55 (#175): what `draft` asks the API for and what it prints. A draft is a
 * model's text, so what reaches the terminal is checked character by
 * character here; the command against a real server is the conformance
 * registry's `I9.draft-is-read-through-the-api`.
 */
import { describe, expect, test } from 'vitest';
import type { DraftView } from '@olympus-ai/api';
import { runCli, type CliIo } from '../src/cli.js';
import { draftLines, visible } from '../src/draft.js';

const b64 = (text: string | Uint8Array): string => Buffer.from(text).toString('base64');

const VIEW = {
  runId: 'run-1', station: 'spec', draft: { sha256: 'abc123', attempt: 2 }, awaiting: 'spec:1',
  files: [{ path: '.drafts/run-1/spec.md', sha256: 'f1', base64: b64('# spec\n\nSay hello.\n') }],
  questions: { kind: 'read', assumptions: [{ point: 'the greeting', chose: 'hello' }], openQuestions: ['which file?'] },
} as unknown as DraftView;

interface Asked { url: string; method: string | undefined }

function answering(status: number, body: unknown): { io: CliIo; out: string[]; err: string[]; asked: Asked[] } {
  const out: string[] = [];
  const err: string[] = [];
  const asked: Asked[] = [];
  const io: CliIo = {
    env: {},
    out: (line) => { out.push(line); },
    err: (line) => { err.push(line); },
    fetch: ((u: URL | string, init?: RequestInit) => { asked.push({ url: String(u), method: init?.method }); return Promise.resolve(new Response(JSON.stringify(body), { status })); }) as typeof fetch,
  };
  return { io, out, err, asked };
}

/** The executable's name, alone in its string: the one spelling the I10 scan exempts. */
const NAME = 'olympus-ai';

const TARGET = ['--url', 'http://127.0.0.1:1', '--token', 't'];

/** The characters a line printed for a person must not hold: controls, and the marks that hide or reorder text. */
function hidden(line: string): boolean {
  return Array.from(line).some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x09) || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2069);
  });
}

describe('the draft command', () => {
  test('makes one GET for the run and station, and prints the hash, the approval, each file behind a margin, and the questions', async () => {
    const api = answering(200, VIEW);
    expect(await runCli(['draft', 'run-1', 'spec', ...TARGET], api.io)).toBe(0);
    expect(api.asked).toEqual([{ url: 'http://127.0.0.1:1/runs/run-1/draft?station=spec', method: 'GET' }]);
    expect(api.out).toEqual([
      'run run-1: the spec draft, attempt 2',
      'hash abc123',
      `waiting for a decision at spec:1; to approve it: ${NAME} approve run-1 spec:1 --draft abc123`,
      '',
      'file .drafts/run-1/spec.md (19 bytes, sha256 f1)',
      '| # spec',
      '| ',
      '| Say hello.',
      '',
      'open questions: 1',
      '  1. which file?',
      'assumptions: 1',
      '  1. the greeting',
      '     chose: hello',
    ]);
    expect(api.err).toEqual([]);
  });

  test('a refusal is reported as any other, and a body that is not a draft is not printed as one', async () => {
    const refused = answering(404, { error: 'not-found', message: 'run run-1 has recorded no draft at spec' });
    expect(await runCli(['draft', 'run-1', 'spec', ...TARGET], refused.io)).toBe(1);
    expect(refused.out).toEqual([]);
    expect(refused.err[0]).toBe('error 404 not-found: run run-1 has recorded no draft at spec');
    for (const body of [{}, { ...VIEW, files: [{ path: 'p' }] }, { ...VIEW, questions: { kind: 'other' } }, 'text', null]) {
      const odd = answering(200, body);
      expect(await runCli(['draft', 'run-1', 'spec', ...TARGET], odd.io)).toBe(1);
      expect(odd.out).toEqual([]);
    }
  });

  test('needs a run and a station', async () => {
    const api = answering(200, VIEW);
    expect(await runCli(['draft', 'run-1', ...TARGET], api.io)).toBe(2);
    expect(api.asked).toEqual([]);
  });
});

describe('what a draft may put on a terminal', () => {
  test('control characters, zero-width marks, and direction overrides are printed as escapes; a tab in a file is kept', () => {
    expect(visible('a\u001b[2Jb')).toBe('a\\u{1b}[2Jb');
    expect(visible('x‮y⁦z​﻿')).toBe('x\\u{202e}y\\u{2066}z\\u{200b}\\u{feff}');
    expect(visible('a\tb\rc\u0000\u007f\u009b')).toBe('a\\u{9}b\\u{d}c\\u{0}\\u{7f}\\u{9b}');
    expect(visible('a\tb', '\t')).toBe('a\tb');
    expect(visible('plain text, with é and 日本')).toBe('plain text, with é and 日本');
  });

  test("a file cannot clear the screen, forge one of the command's lines, or hide in its path or the questions", () => {
    const hostile = {
      ...VIEW,
      files: [
        { path: 'spec\u001b[1A.md', sha256: 'f1', base64: b64('safe\u001b[2J\nhash 0000\nfile other.md (1 bytes, sha256 x)\r\nlast\rline') },
        { path: 'binary', sha256: 'f2', base64: b64(new Uint8Array([0xff, 0xfe, 0x00])) },
        { path: 'empty', sha256: 'f3', base64: '' },
      ],
      questions: { kind: 'read', assumptions: [{ point: 'p\nhash 1111', chose: 'c‮' }], openQuestions: ['q\u001b[2K'] },
    } as unknown as DraftView;
    const lines = draftLines(hostile, NAME);
    for (const line of lines) expect(hidden(line), line).toBe(false);
    expect(lines.filter((l) => l.startsWith('hash '))).toEqual(['hash abc123']);
    expect(lines.filter((l) => l.startsWith('file '))).toHaveLength(3);
    expect(lines).toContain('file spec\\u{1b}[1A.md (63 bytes, sha256 f1)');
    expect(lines).toContain('| safe\\u{1b}[2J');
    expect(lines).toContain('| hash 0000');
    expect(lines).toContain('| file other.md (1 bytes, sha256 x)\\u{d}');
    expect(lines).toContain('| last\\u{d}line');
    expect(lines).toContain('| \\x{ff}\\x{fe}\\x{00}');
    expect(lines).toContain('  (empty file)');
    expect(lines).toContain('  1. q\\u{1b}[2K');
    expect(lines).toContain('  1. p\\u{a}hash 1111');
    expect(lines).toContain('     chose: c\\u{202e}');
  });

  test('a draft that is not waiting says so, and one with no questions part or an unreadable one says which', () => {
    expect(draftLines({ ...VIEW, awaiting: null }, NAME)[2]).toBe('not waiting for a decision: status names the draft that is, if one is');
    expect(draftLines({ ...VIEW, questions: { kind: 'none' } }, NAME).at(-1)).toBe('questions: this draft has no questions part');
    expect(draftLines({ ...VIEW, questions: { kind: 'unreadable' } }, NAME).at(-1)).toMatch(/could not be read as a questions part/u);
  });
});

describe('what is printed stands for exactly one sequence of bytes (review: codex-1, codex-2, gemini-1)', () => {
  const linesOf = (bytes: string | Uint8Array): string[] => draftLines({ ...VIEW, files: [{ path: 'f', sha256: 'h', base64: b64(bytes) }] } as unknown as DraftView, NAME);

  test('a file that is not UTF-8 is shown byte for byte, never replaced by a notice', () => {
    const lines = linesOf(new Uint8Array([0x73, 0x65, 0x63, 0xff, 0x72, 0x65, 0x74, 0x0a, 0x5c, 0x09, 0x7f]));
    expect(lines).toContain('| sec\\x{ff}ret');
    expect(lines).toContain('| \\\\\\x{09}\\x{7f}');
    expect(lines.some((l) => l.includes('not shown'))).toBe(false);
    expect(lines.some((l) => !l.startsWith('|') && l.includes('not UTF-8'))).toBe(true);
  });

  test('a control character and the text of its own escape do not print alike', () => {
    const real = linesOf('allow\u0000deny\\u{0}');
    const spelt = linesOf('allow\\u{0}deny\u0000');
    expect(real).toContain('| allow\\u{0}deny\\\\u{0}');
    expect(spelt).toContain('| allow\\\\u{0}deny\\u{0}');
    expect(real).not.toEqual(spelt);
    expect(visible('a\\b')).toBe('a\\\\b');
  });

  test('a byte-order mark, a carriage return, and a missing final newline are each visible', () => {
    expect(linesOf('﻿x\n')).toContain('| \\u{feff}x');
    expect(linesOf('a\r\nb\n')).toEqual(expect.arrayContaining(['| a\\u{d}', '| b']));
    expect(linesOf('a\n')).not.toEqual(linesOf('a'));
    expect(linesOf('a')).toContain('  (no newline at end of file)');
    expect(linesOf('a\n').some((l) => l.includes('no newline'))).toBe(false);
    expect(linesOf('a\n\n')).not.toEqual(linesOf('a\n'));
  });

  test('line and paragraph separators, the Arabic letter mark, and every other format character are escaped', () => {
    expect(visible('a b c؜d')).toBe('a\\u{2028}b\\u{2029}c\\u{61c}d');
    expect(visible('a­b\u{e0001}cd')).toBe('a\\u{ad}b\\u{e0001}c\\u{e000}d');
    expect(linesOf('x hash 0000\n').filter((l) => l.startsWith('hash '))).toEqual(['hash abc123']);
    expect(linesOf('x y\n')).toContain('| x\\u{2028}y');
  });

  test("a note of the command's own cannot be printed by a file", () => {
    expect(linesOf('')).toContain('  (empty file)');
    expect(linesOf('  (empty file)\n')).toContain('|   (empty file)');
    expect(linesOf('  (empty file)\n')).not.toContain('  (empty file)');
  });

  test('a body whose questions part lacks its lists is not a draft', async () => {
    for (const questions of [{ kind: 'read' }, { kind: 'read', assumptions: [], openQuestions: [1] }, { kind: 'read', assumptions: [{ point: 'p' }], openQuestions: [] }]) {
      const odd = answering(200, { ...VIEW, questions });
      expect(await runCli(['draft', 'run-1', 'spec', ...TARGET], odd.io)).toBe(1);
      expect(odd.err).toEqual(['the API answered something that is not a draft']);
      expect(odd.out).toEqual([]);
    }
  });
});
