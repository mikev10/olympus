/**
 * A browser scenario is served inside the sandbox, driven by the provider's
 * browser, and judged on the host. The reading and the comparison are
 * asserted on their own, and then end to end against a real page in a real
 * container: this suite requires a Docker daemon and fails without one,
 * because a behavioral check that skips itself proves nothing (I5).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { BROWSER_IMAGE, EGRESS_PROXY_IMAGE, imageId, LocalDockerProvider, StubSandboxProvider, type BrowseResult, type SandboxHandle } from '@olympus-ai/sandbox';
import { AdapterRefusal, adapterAdmission, BrowserBehavioralAdapter, buildAdapterSet, compareBrowser, readBrowserScenario, type BrowserExpected } from '../src/index.js';
import { cleanup, pkg, repo } from './repo.js';

const goto = { do: 'goto', path: '/' };
const observe = { do: 'observe', target: { text: 'Hello' } };
const one = { observations: [{ text: 'Hello' }] };
const base = { serve: ['s'], port: 80 };
/** An array of `length` with only the given indexes set, and a hole at every other. */
const holed = (length: number, at: Record<number, unknown>): unknown[] => Object.assign(new Array<unknown>(length), at);

describe('readBrowserScenario', () => {
  test('reads serve, port, each step, and each expected observation, and defaults readyWithinMs and mayBlock', () => {
    const steps = [goto, { do: 'fill', target: { label: 'Name' }, value: 'Ada' }, { do: 'press', key: 'Enter' }, { do: 'click', target: { role: 'button', name: 'Greet' } }, observe];
    expect(readBrowserScenario({ id: 's', input: { ...base, steps }, expected: { observations: [{ text: 'Hello', visible: true, value: null }] } })).toEqual({
      input: { serve: ['s'], port: 80, readyWithinMs: 10_000, steps, mayBlock: [] },
      expected: { observations: [{ text: 'Hello', visible: true, value: null }] },
    });
  });

  test('mayBlock is read lower-cased, since a host name has no case', () => {
    const read = readBrowserScenario({ id: 's', input: { ...base, steps: [goto, observe], mayBlock: ['Fonts.Example.COM'] }, expected: one });
    expect(read.input.mayBlock).toEqual(['fonts.example.com']);
  });

  test.each([
    ['an unknown input key', { ...base, steps: [goto, observe], url: 'http://x' }, one, /input\.url/],
    ['an empty serve', { serve: [], port: 80, steps: [goto, observe] }, one, /input\.serve/],
    ['port 0', { serve: ['s'], port: 0, steps: [goto, observe] }, one, /input\.port/],
    ['no steps', { ...base, steps: [] }, { observations: [] }, /input\.steps/],
    ['a first step that is not a goto', { ...base, steps: [observe] }, one, /input\.steps\[0\] must be a goto/],
    ['a goto that is a URL', { ...base, steps: [{ do: 'goto', path: 'http://x/' }, observe] }, one, /input\.steps\[0\]\.path/],
    ['a goto with a url key', { ...base, steps: [{ ...goto, url: 'http://x/' }, observe] }, one, /input\.steps\[0\]\.url/],
    ['an unknown step', { ...base, steps: [goto, { do: 'evaluate', script: '1' }, observe] }, one, /input\.steps\[1\]\.do/],
    ['a selector target', { ...base, steps: [goto, { do: 'click', target: { selector: '#go' } }, observe] }, one, /input\.steps\[1\]\.target/],
    ['a test id target', { ...base, steps: [goto, { do: 'observe', target: { testId: 'out' } }] }, one, /input\.steps\[1\]\.target/],
    ['a target of two forms', { ...base, steps: [goto, { do: 'observe', target: { text: 'a', label: 'a' } }] }, one, /input\.steps\[1\]\.target/],
    ['a role with no name', { ...base, steps: [goto, { do: 'observe', target: { role: 'button' } }] }, one, /input\.steps\[1\]\.target/],
    ['a fill with no value', { ...base, steps: [goto, { do: 'fill', target: { label: 'Name' } }, observe] }, one, /input\.steps\[1\]\.value/],
    ['a step with a key it does not carry', { ...base, steps: [goto, { do: 'click', target: { text: 'a' }, value: 'x' }, observe] }, one, /input\.steps\[1\]\.value/],
    ['no observe step', { ...base, steps: [goto, { do: 'click', target: { text: 'a' } }] }, { observations: [] }, /no observe step/],
    ['fewer expected observations than observe steps', { ...base, steps: [goto, observe, observe] }, one, /expected\.observations has 1 entries for 2/],
    ['more expected observations than observe steps', { ...base, steps: [goto, observe] }, { observations: [{ text: 'a' }, { text: 'b' }] }, /expected\.observations has 2 entries for 1/],
    ['an expected observation that names nothing', { ...base, steps: [goto, observe] }, { observations: [{}] }, /names no field/],
    ['an unknown expected key', { ...base, steps: [goto, observe] }, { observations: [{ textMatches: 'x' }] }, /textMatches/],
    ['an unknown key beside observations', { ...base, steps: [goto, observe] }, { observations: [{ text: 'a' }], screenshot: 'x' }, /expected\.screenshot/],
    ['a matched that is not a count', { ...base, steps: [goto, observe] }, { observations: [{ matched: -1 }] }, /expected\.observations\[0\]\.matched/],
    ['text expected of no element', { ...base, steps: [goto, observe] }, { observations: [{ matched: 0, text: 'a' }] }, /matched is not 1/],
    ['a mayBlock that is not host names', { ...base, steps: [goto, observe], mayBlock: [''] }, one, /input\.mayBlock/],
  ])('%s is refused, naming the field', (_, input, expected, field) => {
    const read = (): unknown => readBrowserScenario({ id: 's', input, expected });
    expect(read).toThrow(AdapterRefusal);
    expect(read).toThrow(field);
  });

  // A hole in an array is skipped by map and forEach, so an unchecked one removes a step or a comparison.
  test.each([
    ['a hole in input.steps', { ...base, steps: holed(3, { 0: goto, 2: observe }) }, one, /input\.steps\[1\]/],
    ['a hole in expected.observations', { ...base, steps: [goto, observe] }, { observations: new Array(1) }, /expected\.observations\[0\]/],
    ['a hole in input.mayBlock', { ...base, steps: [goto, observe], mayBlock: holed(2, { 1: 'a.example' }) }, one, /input\.mayBlock/],
  ])('%s is refused, naming the field', (_, input, expected, field) => {
    const read = (): unknown => readBrowserScenario({ id: 's', input, expected });
    expect(read).toThrow(AdapterRefusal);
    expect(read).toThrow(field);
  });
});

describe('compareBrowser', () => {
  const browser = { name: 'Chrome', version: '1', image: 'sha256:x' };
  const seen = { kind: 'observed' as const, matched: 1, visible: true, text: 'Hello', value: null, path: '/', title: 'Greeter' };
  const result = (overrides: Partial<BrowseResult> = {}): BrowseResult => ({ ready: true, observations: [seen], failedStep: null, blocked: [], browser, durationMs: 1, ...overrides });
  const expecting = (entry: BrowserExpected['observations'][number]): BrowserExpected => ({ observations: [entry] });

  test('holds when every named field matches, and compares only those named', () => {
    expect(compareBrowser(expecting({ text: 'Hello' }), [], result())).toEqual({ held: true });
    expect(compareBrowser(expecting({ title: 'Greeter', path: '/', visible: true, value: null, matched: 1 }), [], result())).toEqual({ held: true });
  });

  test.each([
    ['text', { text: 'Goodbye' }, 'observations[0].text'],
    ['visible', { visible: false }, 'observations[0].visible'],
    ['value', { value: 'Ada' }, 'observations[0].value'],
    ['path', { path: '/done' }, 'observations[0].path'],
    ['title', { title: 'Other' }, 'observations[0].title'],
    ['matched', { matched: 0 }, 'observations[0].matched'],
  ])('a different %s does not hold, naming the observation and the field', (_, entry, field) => {
    const outcome = compareBrowser(expecting(entry), [], result());
    expect(outcome.held).toBe(false);
    expect(outcome.held ? [] : outcome.mismatches.map((m) => m.field)).toEqual([field]);
  });

  test('a target that matched several elements fails on matched, and no text is compared as if one had been picked', () => {
    const several = result({ observations: [{ ...seen, matched: 2, visible: false, text: '' }] });
    const outcome = compareBrowser(expecting({ text: '' }), [], several);
    expect(outcome.held ? [] : outcome.mismatches.map((m) => m.field)).toEqual(['observations[0].matched']);
  });

  test('a target that matched nothing fails unless the scenario expected none', () => {
    const none = result({ observations: [{ ...seen, matched: 0, visible: false, text: '' }] });
    expect(compareBrowser(expecting({ title: 'Greeter' }), [], none).held).toBe(false);
    expect(compareBrowser(expecting({ matched: 0 }), [], none)).toEqual({ held: true });
  });

  test('a port that never answered does not hold, whatever was expected', () => {
    const outcome = compareBrowser(expecting({ matched: 0 }), [], result({ ready: false, observations: [] }));
    expect(outcome.held ? [] : outcome.mismatches.map((m) => m.field)).toEqual(['ready']);
  });

  test('a step that could not be done names the step, and the observation it kept from being made is a mismatch, never a comparison', () => {
    const failed = result({ failedStep: { index: 2, reason: 'the button named "Go" matched no element' }, observations: [{ kind: 'not-reached', reason: 'step 2 could not be done' }] });
    const outcome = compareBrowser(expecting({ matched: 0 }), [], failed);
    expect(outcome.held ? [] : outcome.mismatches.map((m) => m.field)).toEqual(['steps[2]', 'observations[0]']);
    expect(outcome.held ? '' : outcome.mismatches[0].observed).toContain('matched no element');
  });

  test('a refused host fails the scenario naming the host, unless the scenario lists it', () => {
    const blocked = result({ blocked: [{ host: 'fonts.example.com', requests: 2, navigation: false }] });
    const unlisted = compareBrowser(expecting({ text: 'Hello' }), [], blocked);
    expect(unlisted.held ? [] : unlisted.mismatches.map((m) => m.field)).toEqual(['blocked.fonts.example.com']);
    expect(compareBrowser(expecting({ text: 'Hello' }), ['fonts.example.com'], blocked)).toEqual({ held: true });
  });

  test('a document that tried to leave the loopback fails the scenario even when its host is listed', () => {
    const left = result({ blocked: [{ host: 'elsewhere.example.com', requests: 1, navigation: true }] });
    const outcome = compareBrowser(expecting({ text: 'Hello' }), ['elsewhere.example.com'], left);
    expect(outcome.held ? [] : outcome.mismatches.map((m) => m.field)).toEqual(['blocked.elsewhere.example.com']);
  });

  test('fewer observations than expected does not hold', () => {
    expect(compareBrowser(expecting({ text: 'Hello' }), [], result({ observations: [] })).held).toBe(false);
  });
});

describe('a set and the provider it is built on', () => {
  afterAll(cleanup);

  test('a provider with no browse cannot construct the adapter, and its set names the control with the provider as the reason', async () => {
    const stub = new StubSandboxProvider();
    expect(() => new BrowserBehavioralAdapter(stub)).toThrow(/has no browse/);
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), { provider: stub, coverage: null });
    expect(set.unavailableControls()).toContain('behavioral:browser');
    expect(set.reasons.get('behavioral:browser')).toContain(stub.id);
  });

  test('a provider with a browse builds a set that carries the adapter, and mutation still keeps it from L3', async () => {
    const browsing = Object.assign(new StubSandboxProvider(), { browse: (): Promise<never> => Promise.reject(new Error('not called')) });
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), { provider: browsing, coverage: null });
    expect(set.behavioral.map((adapter) => adapter.kind)).toContain('browser');
    expect(set.unavailableControls()).not.toContain('behavioral:browser');
    const l3 = adapterAdmission(set, 3);
    expect(l3.ok ? [] : l3.unavailable).toContain('mutation');
  });

  test('a set built with no provider names the control and says why', async () => {
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), { provider: null, coverage: null });
    expect(set.reasons.get('behavioral:browser')).toMatch(/no sandbox provider/);
  });
});

describe('BrowserBehavioralAdapter, against a real page in a real container', () => {
  /** A product that greets by name on `/`, and says goodbye on `/wrong`. */
  const SERVER = `
    const page = (word) => '<!doctype html><title>Greeter</title><form onsubmit="event.preventDefault(); ' +
      'document.getElementById(\\'out\\').textContent = \\'' + word + ', \\' + document.getElementById(\\'n\\').value">' +
      '<label for="n">Name</label><input id="n"><button>Greet</button></form><p role="status" id="out"></p>';
    require('node:http').createServer((req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(page(req.url === '/wrong' ? 'Goodbye' : 'Hello'));
    }).listen(8080);
  `;
  const scenario = (id: string, path: string): { id: string; input: unknown; expected: unknown } => ({
    id,
    input: {
      serve: ['node', '--eval', SERVER],
      port: 8080,
      steps: [
        { do: 'goto', path },
        { do: 'fill', target: { label: 'Name' }, value: 'Ada' },
        { do: 'click', target: { role: 'button', name: 'Greet' } },
        { do: 'observe', target: { role: 'status', name: '' } },
      ],
    },
    expected: { observations: [{ text: 'Hello, Ada', visible: true }] },
  });

  let provider: LocalDockerProvider;
  let workspace: string;
  const handles: SandboxHandle[] = [];

  async function sandbox(): Promise<SandboxHandle> {
    const h = await provider.provision({
      image: EGRESS_PROXY_IMAGE,
      mounts: { workspace: { source: workspace, target: '/workspace', mode: 'ro' }, others: [] },
      egress: { mode: 'deny-all', allow: [] },
      limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 90_000 },
      user: { uid: 0, gid: 0 },
    });
    handles.push(h);
    return h;
  }

  beforeAll(async () => {
    // Not wrapped: no daemon is a failing suite, never a skipped one.
    provider = await LocalDockerProvider.create({ vaultPaths: [] });
    workspace = await mkdtemp(join(tmpdir(), 'adapters-browser-'));
    // Outside any sandbox's clock: a daemon that does not hold the image pulls it here.
    await imageId(BROWSER_IMAGE, { pull: true });
  }, 900_000);

  afterAll(async () => {
    for (const h of handles) await provider.destroy(h).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
    await cleanup();
  });

  test('a set built on this provider carries the browser adapter', async () => {
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), { provider, coverage: null });
    expect(set.behavioral.map((adapter) => adapter.kind)).toEqual(['cli', 'http', 'browser']);
    expect(set.unavailableControls()).toEqual(['coverage', 'mutation']);
  });

  test('a page that shows what the scenario expects holds, and the result names the browser that saw it', async () => {
    const result = await new BrowserBehavioralAdapter(provider).run(scenario('greets', '/'), await sandbox());
    expect(result).toMatchObject({ checkId: 'greets', exitCode: 0, suiteCount: null, expectation: { held: true } });
    const evidence = JSON.parse(result.stdout) as BrowseResult;
    expect(evidence.observations).toEqual([{ kind: 'observed', matched: 1, visible: true, text: 'Hello, Ada', value: null, path: '/', title: 'Greeter' }]);
    expect(evidence.browser.image).toBe(await imageId(BROWSER_IMAGE));
    expect(evidence.browser.version).toMatch(/^\d+\./u);
  }, 90_000);

  test('a page that renders the wrong text does not hold, and a second scenario on the handle is refused', async () => {
    const adapter = new BrowserBehavioralAdapter(provider);
    const h = await sandbox();
    const result = await adapter.run(scenario('greets-wrong', '/wrong'), h);
    expect(result.expectation).toEqual({ held: false, mismatches: [{ field: 'observations[0].text', expected: 'Hello, Ada', observed: 'Goodbye, Ada' }] });
    await expect(adapter.run(scenario('again', '/'), h)).rejects.toThrow(/already ran a browser scenario/);
  }, 90_000);

  test('a server that never starts does not hold', async () => {
    const never = { ...scenario('never', '/'), input: { serve: ['sleep', '60'], port: 8080, readyWithinMs: 500, steps: [goto, observe] }, expected: one };
    const result = await new BrowserBehavioralAdapter(provider).run(never, await sandbox());
    expect(result.expectation).toMatchObject({ held: false, mismatches: [{ field: 'ready' }] });
  }, 90_000);
});
