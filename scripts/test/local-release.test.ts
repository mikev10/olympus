/**
 * The release script's one command runner (R35 review, codex-1): an argument
 * reaches the program as given, never expanded by a shell, and on Windows an
 * argument the shell would interpret is refused rather than escaped.
 */
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { run } from '../local-release.ts';

const ECHO = ['-e', 'process.stdout.write(String(process.argv[1]))'];

describe('local-release run()', () => {
  test('a shell substitution in an argument arrives as text', () => {
    expect(run('node', [...ECHO, 'x-$(echo expanded)-`echo expanded`'], tmpdir())).toBe('x-$(echo expanded)-`echo expanded`');
  });

  test.runIf(process.platform === 'win32')('on Windows an argument cmd.exe interprets is refused before anything runs', () => {
    for (const bad of ['a%PATH%b', 'a&b', 'a|b', 'a"b', 'a^b', 'a!b']) {
      expect(() => run('node', [...ECHO, bad], tmpdir())).toThrow(/the Windows shell interprets/u);
    }
  });
});
