import { describe, expect, test } from 'vitest';
import { containerUser } from '../src/host/compose.js';

describe('containerUser', () => {
  test('both absent or empty is no user, and both set is that user', () => {
    expect(containerUser({})).toBeUndefined();
    expect(containerUser({ FACTORY_CONTAINER_UID: '', FACTORY_CONTAINER_GID: '' })).toBeUndefined();
    expect(containerUser({ FACTORY_CONTAINER_UID: '1000', FACTORY_CONTAINER_GID: '1000' })).toEqual({ uid: 1000, gid: 1000 });
    expect(containerUser({ FACTORY_CONTAINER_UID: '0', FACTORY_CONTAINER_GID: '0' })).toEqual({ uid: 0, gid: 0 });
  });

  test('a half-named user is refused, not completed as root (codex-7, gemini-4)', () => {
    expect(() => containerUser({ FACTORY_CONTAINER_UID: '1000', FACTORY_CONTAINER_GID: '' })).toThrow(/both/u);
    expect(() => containerUser({ FACTORY_CONTAINER_UID: '', FACTORY_CONTAINER_GID: '1000' })).toThrow(/both/u);
    expect(() => containerUser({ FACTORY_CONTAINER_UID: '1000' })).toThrow(/both/u);
    expect(() => containerUser({ FACTORY_CONTAINER_UID: '1000', FACTORY_CONTAINER_GID: ' ' })).toThrow(/both/u);
  });

  test('anything but a decimal integer is refused', () => {
    for (const bad of ['-1', '1.5', '1e3', '0x10', ' 1000', 'abc']) {
      expect(() => containerUser({ FACTORY_CONTAINER_UID: bad, FACTORY_CONTAINER_GID: '1000' })).toThrow(/both/u);
    }
  });
});
