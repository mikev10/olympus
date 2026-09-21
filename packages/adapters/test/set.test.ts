/**
 * The adapter set a repository gets, what it says it lacks, and the L3
 * refusal that follows from it (I5).
 */
import { afterEach, describe, expect, test } from 'vitest';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { adapterAdmission, buildAdapterSet, type AdapterSet } from '../src/index.js';
import { cleanup, pkg, repo } from './repo.js';

afterEach(cleanup);

const withEverything = { provider: new StubSandboxProvider(), coverage: { report: '/r/coverage-final.json', sourceRoot: '/workspace' } };

describe('buildAdapterSet', () => {
  test('a vitest repository gets the vitest set; a jest repository gets the jest set', async () => {
    const vitest = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '^4.1.0' }) }), withEverything);
    const jest = await buildAdapterSet(await repo({ 'package.json': pkg({ jest: '^29.7.0' }) }), withEverything);
    expect([vitest.stack, vitest.test?.stack]).toEqual(['vitest@4', 'vitest@4']);
    expect([jest.stack, jest.test?.stack]).toEqual(['jest@29', 'jest@29']);
  });

  test('every set P8 builds names mutation, behavioral:http, and behavioral:browser, so none clears L3 at M1', async () => {
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), withEverything);
    expect(set.unavailableControls()).toEqual(['mutation', 'behavioral:http', 'behavioral:browser']);
  });

  test.each([
    ['neither framework', { 'package.json': pkg({ mocha: '10' }) }, /neither vitest nor jest/],
    ['both frameworks', { 'package.json': pkg({ vitest: '4', jest: '30' }) }, /both vitest and jest/],
    ['no package.json', {}, /no package\.json/],
    ['an unsupported major', { 'package.json': pkg({ vitest: '^2.1.0' }) }, /majors whose discovery rules/],
    ['a config that cannot be read', { 'package.json': pkg({ vitest: '4' }), 'vitest.config.ts': 'export default load();' }, /not an object literal/],
    ['a package.json that is not JSON', { 'package.json': '{ "devDependencies": ' }, /not valid JSON/],
    ['a framework declared at two ranges', { 'package.json': JSON.stringify({ dependencies: { vitest: '3' }, devDependencies: { vitest: '4' } }) }, /declares vitest twice/],
  ])('%s gets test: null and a set that names it, never a guess', async (_, files, why) => {
    const set = await buildAdapterSet(await repo(files), withEverything);
    expect(set.test).toBeNull();
    expect(set.stack).toBe('unsupported');
    expect(set.unavailableControls()).toContain('test');
    expect(set.unavailableControls()).toContain('coverage');
    expect(set.reasons.get('test')).toMatch(why);
  });

  test('a set built with no provider and no coverage report names those two as well', async () => {
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ jest: '30' }) }), { provider: null, coverage: null });
    expect(set.unavailableControls()).toEqual(['coverage', 'mutation', 'behavioral:cli', 'behavioral:http', 'behavioral:browser']);
  });
});

describe('adapterAdmission', () => {
  test('L3 is refused for a set that lacks any control, naming each', async () => {
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), withEverything);
    const admission = adapterAdmission(set, 3);
    expect(admission).toMatchObject({ ok: false, reason: 'controls-unavailable', requested: 3 });
    expect(admission.ok ? [] : admission.unavailable).toEqual(['behavioral:browser', 'behavioral:http', 'mutation']);
  });

  test.each([0, 1, 2] as const)('L%i is not refused, and comes back as asked for', async (level) => {
    const set = await buildAdapterSet(await repo({}), { provider: null, coverage: null });
    expect(adapterAdmission(set, level)).toEqual({ ok: true, level });
  });

  test('a set whose own unavailableControls() under-reports is still refused: the gaps are derived from its slots', () => {
    const lying: AdapterSet = {
      stack: 'custom',
      test: null,
      coverage: null,
      mutation: null,
      behavioral: [],
      manifest: null,
      unavailableControls: () => [],
    };
    const admission = adapterAdmission(lying, 3);
    expect(admission.ok).toBe(false);
    expect(admission.ok ? [] : admission.unavailable).toContain('test');
  });

  test('a value that is not a level is refused rather than compared', async () => {
    const set = await buildAdapterSet(await repo({}), { provider: null, coverage: null });
    expect(() => adapterAdmission(set, 4 as unknown as 3)).toThrow(/not an autonomy level/);
  });
});
