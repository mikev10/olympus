/**
 * The local provider's writability rule, as a pure function of a directory's
 * owner, group, and mode. The refusal it feeds is exercised against a real
 * daemon in `local.test.ts` and the I5 registry assertion; the rule itself
 * holds on every host, including one whose daemon does not carry ownership.
 */
import { describe, expect, test } from 'vitest';
import { canCreateIn } from '../src/local/ownership.js';

const owner = { uid: 1000, gid: 1000 };

describe('a user can create entries in a directory only with write and search on it', () => {
  test('write without search is not enough, for the owner, the group, or anyone else', () => {
    expect(canCreateIn({ uid: 1000, gid: 1000, mode: 0o600 }, owner)).toBe(false);
    expect(canCreateIn({ uid: 1, gid: 1000, mode: 0o060 }, owner)).toBe(false);
    expect(canCreateIn({ uid: 1, gid: 1, mode: 0o006 }, owner)).toBe(false);
  });

  test('write and search together are, from the class the user falls in', () => {
    expect(canCreateIn({ uid: 1000, gid: 1000, mode: 0o700 }, owner)).toBe(true);
    expect(canCreateIn({ uid: 1, gid: 1000, mode: 0o070 }, owner)).toBe(true);
    expect(canCreateIn({ uid: 1, gid: 1, mode: 0o003 }, owner)).toBe(true);
  });

  test("only that class counts: an owner is not rescued by the group's or anyone's bits", () => {
    expect(canCreateIn({ uid: 1000, gid: 1000, mode: 0o077 }, owner)).toBe(false);
    expect(canCreateIn({ uid: 1, gid: 1000, mode: 0o707 }, owner)).toBe(false);
  });
});
