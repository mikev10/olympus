import { describe, expect, test } from 'vitest';
import { ENDPOINT_CREDENTIAL } from '@olympus-ai/driver-openai-compatible';
import { containerUser, endpointGrants, ENDPOINT_SEATS, parseEndpointFile, seatedDrivers } from '../src/host/compose.js';

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

describe('the endpoint file (R6, D-R6-07)', () => {
  const price = { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 0, cacheWrite1hPerMTok: 0 };
  const config = {
    upstream: 'https://models.example', path: '/v1/chat/completions', header: 'authorization', scheme: 'bearer',
    provider: 'example', family: 'example-family', version: '1', models: { fast: 'm', standard: 'm', deep: 'm' }, prices: { m: price },
    maxOutputTokens: 1024, ceilingField: 'max_tokens', parallelism: 1, maxTurns: 10,
  };
  const file = (extra: Record<string, unknown>): string => JSON.stringify({ ...config, ...extra });

  test('a file naming the configuration and its seats is read as written', () => {
    const endpoint = parseEndpointFile(file({ seats: ['reviewer', 'specCritic', 'testCritic'] }), 'key');
    expect(endpoint.seats).toStrictEqual(['reviewer', 'specCritic', 'testCritic']);
    expect(endpoint.config.family).toBe('example-family');
    expect(endpoint.key).toBe('key');
  });

  test('no seats, an unknown seat, a seat twice, no key, a field the driver does not read, and a file that is not JSON are each refused', () => {
    expect(() => parseEndpointFile(file({}), 'key')).toThrow(/no seats/u);
    expect(() => parseEndpointFile(file({ seats: [] }), 'key')).toThrow(/no seats/u);
    expect(() => parseEndpointFile(file({ seats: ['critic'] }), 'key')).toThrow(/the seats are/u);
    expect(() => parseEndpointFile(file({ seats: ['reviewer', 'reviewer'] }), 'key')).toThrow(/twice/u);
    expect(() => parseEndpointFile(file({ seats: ['reviewer'] }), '')).toThrow(/no credential/u);
    expect(() => parseEndpointFile(file({ seats: ['reviewer'], temperature: 0 }), 'key')).toThrow(/temperature/u);
    expect(() => parseEndpointFile(file({ seats: ['reviewer'], family: undefined }), 'key')).toThrow(/family/u);
    expect(() => parseEndpointFile('{', 'key')).toThrow(/not JSON/u);
  });

  test('a local endpoint declaring no credential comes without a key, and a key beside it is refused (A-R21-04)', () => {
    const local = { upstream: { local: 'docker-host', port: 11434 }, scheme: 'none', seats: ['reviewer'] };
    const endpoint = parseEndpointFile(file(local), '');
    expect(endpoint.key).toBeNull();
    expect(endpointGrants(endpoint)).toStrictEqual({ credentials: {}, dockerHostPorts: [11434] });
    expect(() => parseEndpointFile(file(local), 'key')).toThrow(/must not be set/u);
    // A local endpoint that takes a key is given both.
    const keyed = parseEndpointFile(file({ ...local, scheme: 'bearer' }), 'key');
    expect(endpointGrants(keyed)).toStrictEqual({ credentials: { [ENDPOINT_CREDENTIAL]: 'key' }, dockerHostPorts: [11434] });
    // No key is never inferred: an https endpoint without one is still refused, and so is the none scheme for it.
    expect(() => parseEndpointFile(file({ seats: ['reviewer'] }), '')).toThrow(/no credential/u);
    expect(() => parseEndpointFile(file({ seats: ['reviewer'], scheme: 'none' }), '')).toThrow(/scheme 'none'/u);
    expect(() => parseEndpointFile(file({ ...local, upstream: 'http://localhost:11434' }), '')).toThrow(/upstream/u);
    expect(endpointGrants(parseEndpointFile(file({ seats: ['reviewer'] }), 'key'))).toStrictEqual({ credentials: { [ENDPOINT_CREDENTIAL]: 'key' }, dockerHostPorts: [] });
    expect(endpointGrants(null)).toStrictEqual({ credentials: {}, dockerHostPorts: [] });
  });

  test('the endpoint fills the seats it names and the default fills every other', () => {
    expect(seatedDrivers('claude', null)).toStrictEqual({
      driver: 'claude', reviewer: 'claude', specDrafter: 'claude', specCritic: 'claude', testDrafter: 'claude', testCritic: 'claude',
    });
    expect(seatedDrivers('claude', { driver: 'other', seats: ['reviewer', 'testCritic'] })).toStrictEqual({
      driver: 'claude', reviewer: 'other', specDrafter: 'claude', specCritic: 'claude', testDrafter: 'claude', testCritic: 'other',
    });
    expect(ENDPOINT_SEATS).toHaveLength(6);
  });
});
