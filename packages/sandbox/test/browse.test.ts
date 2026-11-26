/**
 * The browser (A-R3-01): a browser in the sandbox's network namespace and out
 * of its filesystem and process tree, started for one call and gone after it.
 * The Docker-backed tests require a daemon and fail without one, as the rest
 * of this package's Docker-backed suites do: a browser that skipped itself
 * would prove nothing about where it ran.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  BROWSER_IMAGE,
  browseProgram,
  browseRunArgs,
  checkBrowseRequest,
  EGRESS_PROXY_IMAGE,
  imageId,
  LocalDockerProvider,
  readBrowseOutput,
  SandboxRefusal,
  type BrowseRequest,
  type BrowseStep,
  type SandboxHandle,
  type SandboxSpec,
} from '../src/index.js';
import { BROWSE_SOURCE } from '../src/local/browse-source.js';
import { probeRunArgs } from '../src/local/probe.js';

const run = promisify(execFile);

/** A product on 8080: a form that greets, a page that asks other hosts for things, a link that leaves, two buttons with one name, and a slow page. */
const SERVER = `
const page = (title, body) => '<!doctype html><html><head><title>' + title + '</title></head><body>' + body + '</body></html>';
require('node:http').createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url === '/') return res.end(page('Greeter',
    '<form onsubmit="event.preventDefault(); document.getElementById(\\'out\\').textContent = \\'Hello, \\' + document.getElementById(\\'n\\').value">' +
    '<label for="n">Name</label><input id="n"><button>Greet</button></form><p role="status" id="out"></p>'));
  if (req.url === '/external') return res.end(page('External', '<h1>Shown</h1><img src="http://images.example.invalid/x.png">' +
    '<script>fetch("https://api.example.invalid/v1").catch(() => {}); try { new WebSocket("ws://socket.example.invalid/s") } catch (e) {}</script>'));
  if (req.url === '/leave') return res.end(page('Leave', '<a href="http://elsewhere.example.invalid/">Leave</a>'));
  if (req.url === '/twins') return res.end(page('Twins', '<button>Save</button><button>Save</button>'));
  if (req.url === '/slow') return setTimeout(() => res.end(page('Slow', '<h1>Late</h1>')), 3000);
  res.statusCode = 404;
  res.end(page('Missing', 'nothing here'));
}).listen(8080);
`;

let provider: LocalDockerProvider;
let base: string;
const live: SandboxHandle[] = [];

function specFor(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: EGRESS_PROXY_IMAGE,
    mounts: { workspace: { source: join(base, 'workspace'), target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 90_000 },
    user: { uid: 0, gid: 0 },
    ...overrides,
  };
}

async function serving(overrides: Partial<SandboxSpec> = {}): Promise<SandboxHandle> {
  const h = await provider.provision(specFor(overrides));
  live.push(h);
  const started = await provider.exec(h, ['node', '--eval', SERVER], { detach: true });
  expect(started.exitCode).toBe(0);
  return h;
}

function steps(first: BrowseStep, ...rest: BrowseStep[]): BrowseRequest {
  return { port: 8080, readyWithinMs: 10_000, steps: [first, ...rest] };
}

async function browseContainers(): Promise<string[]> {
  const { stdout } = await run('docker', ['ps', '--all', '--filter', 'name=browse-', '--format', '{{.Names}}']);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

async function refusal(body: () => unknown): Promise<SandboxRefusal> {
  try {
    await body();
  } catch (error) {
    if (error instanceof SandboxRefusal) return error;
    throw error;
  }
  throw new Error('expected a SandboxRefusal, but the call returned');
}

const GREET: BrowseRequest = steps(
  { do: 'goto', path: '/' },
  { do: 'fill', target: { label: 'Name' }, value: 'Ada' },
  { do: 'click', target: { role: 'button', name: 'Greet' } },
  { do: 'observe', target: { role: 'status', name: '' } },
);

describe('a browse request is refused by shape', () => {
  const bad: Array<[string, unknown, string]> = [
    ['a port out of range', { port: 0, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }] }, 'port'],
    ['no steps', { port: 80, readyWithinMs: 1, steps: [] }, 'steps'],
    ['a first step that is not a goto', { port: 80, readyWithinMs: 1, steps: [{ do: 'observe', target: { text: 'x' } }] }, 'steps[0] must be a goto'],
    ['a goto that is a URL', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: 'http://other.example/' }] }, 'steps[0].path'],
    ['a goto with a url key', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/', url: 'http://other.example/' }] }, 'url'],
    ['an unknown step', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'evaluate', script: '1' }] }, 'steps[1].do'],
    ['a selector target', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'click', target: { selector: '#go' } }] }, 'steps[1].target'],
    ['a target of two forms', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'click', target: { text: 'Go', label: 'Go' } }] }, 'steps[1].target'],
    ['a role with no name', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'click', target: { role: 'button' } }] }, 'steps[1].target'],
    ['an empty text', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'observe', target: { text: ' ' } }] }, 'steps[1].target.text'],
    ['a fill with no value', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'fill', target: { label: 'Name' } }] }, 'steps[1].value'],
    ['a press with no key', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, { do: 'press', key: '' }] }, 'steps[1].key'],
    // eslint-disable-next-line no-sparse-arrays -- the hole is the case
    ['a hole in the steps', { port: 80, readyWithinMs: 1, steps: [{ do: 'goto', path: '/' }, , { do: 'press', key: 'Enter' }] }, 'steps[1]'],
  ];
  test.each(bad)('%s', async (_name, request, named) => {
    const refused = await refusal(() => {
      checkBrowseRequest(request as BrowseRequest);
    });
    expect(refused.layer).toBe('browse');
    expect(refused.message).toContain(named);
  });

  test('a request of every step kind is accepted', () => {
    expect(() => {
      checkBrowseRequest(steps({ do: 'goto', path: '/a?b=1' }, { do: 'press', key: 'Enter' }, ...GREET.steps.slice(1)));
    }).not.toThrow();
  });
});

describe('what the browser printed is read strictly', () => {
  const image = `sha256:${'a'.repeat(64)}`;
  const seen = { kind: 'observed', matched: 1, visible: true, text: 'Hello, Ada', value: null, path: '/', title: 'Greeter' };
  const printed = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({ ready: true, observations: [seen], failedStep: null, blocked: [], browser: { name: 'Chrome', version: '1.2.3' }, durationMs: 5, ...overrides });

  test('a whole report is returned with the image the provider started', () => {
    const result = readBrowseOutput(printed(), GREET, image);
    expect(result.browser).toEqual({ name: 'Chrome', version: '1.2.3', image });
    expect(result.observations).toEqual([seen]);
  });

  test('an image named by the container is not the one reported', () => {
    const result = readBrowseOutput(printed({ browser: { name: 'Chrome', version: '1.2.3', image: 'sha256:forged' } }), GREET, image);
    expect(result.browser.image).toBe(image);
  });

  const broken: Array<[string, Record<string, unknown>]> = [
    ['fewer observations than observe steps', { observations: [] }],
    ['an observation with a field missing', { observations: [{ ...seen, text: undefined }] }],
    ['a browser that does not say its version', { browser: { name: 'Chrome', version: '' } }],
    ['a failed step the request does not have', { failedStep: { index: 9, reason: 'x' }, observations: [{ kind: 'not-reached', reason: 'x' }] }],
    ['an observation made after the step that failed', { failedStep: { index: 1, reason: 'x' } }],
    ['an observation not made though no step failed', { observations: [{ kind: 'not-reached', reason: 'x' }] }],
    ['observations on a port that never answered', { ready: false }],
    ['a refused host with no count', { blocked: [{ host: 'a.example', navigation: false }] }],
  ];
  test.each(broken)('%s throws', (_name, overrides) => {
    expect(() => readBrowseOutput(printed(overrides), GREET, image)).toThrow();
  });

  test('text that is not JSON throws', () => {
    expect(() => readBrowseOutput('Aw, Snap', GREET, image)).toThrow(/not JSON/u);
  });
});

describe('the browser container is started with the probe\'s limits and no more', () => {
  const args = browseRunArgs('browse-x', 'sandbox-x', `sha256:${'a'.repeat(64)}`, ['--label', 'k=v']);
  const probe = probeRunArgs('probe-x', 'sandbox-x', 'image', []);
  /** The flags given to `docker run`, which end where the command inside the container begins. */
  const flags = (list: readonly string[]): string[] => list.slice(0, list.indexOf('node')).filter((arg) => arg.startsWith('--'));

  test('it adds a memory and a process ceiling to the probe\'s flags, and nothing that widens', () => {
    const added = flags(args).filter((flag) => !flags(probe).includes(flag));
    expect(added.sort()).toEqual(['--label', '--memory', '--memory-swap', '--pids-limit']);
    for (const flag of flags(probe)) expect(flags(args)).toContain(flag);
    for (const widening of ['--privileged', '--cap-add', '--volume', '-v', '--mount', '--tmpfs', '--shm-size', '--publish', '-p', '--pid', '--ipc', '--device']) expect(args).not.toContain(widening);
    expect(args.filter((arg) => arg === '--security-opt')).toHaveLength(1);
    expect(args[args.indexOf('--security-opt') + 1]).toBe('no-new-privileges');
    expect(args[args.indexOf('--network') + 1]).toBe('container:sandbox-x');
    expect(args[args.indexOf('--user') + 1]).toBe('65534:65534');
  });

  test('neither the runner nor a scenario is in an argument, so the command line does not grow with either', () => {
    expect(args.slice(-2)).toEqual(['node', '-']);
    expect(args.join(' ')).not.toContain('puppeteer.launch');
    // Windows starts no process whose command line passes 32,767 characters; this one is a fixed few hundred.
    expect(['docker', ...args].join(' ').length).toBeLessThan(1024);
  });

  test('the program is the request as one string literal, then the runner', () => {
    const hostile = steps({ do: 'goto', path: '/' }, { do: 'fill', target: { label: 'Name' }, value: '"; process.exit(0); // `${x}`' }, { do: 'observe', target: { text: 'x' } });
    const program = browseProgram(hostile);
    const [strict, literal] = program.split('\n');
    expect(strict).toBe("'use strict';");
    const match = /^const REQUEST = (".*");$/su.exec(literal ?? '');
    expect(match).not.toBeNull();
    // The literal parses back, through two JSON readings, to the request and nothing else.
    expect(JSON.parse(JSON.parse(match?.[1] ?? '') as string)).toEqual(hostile);
    expect(program.endsWith(BROWSE_SOURCE)).toBe(true);
  });

  test('the runner holds nothing a raw template would read, drives Chrome over a pipe, and opens no debugging port', () => {
    expect(BROWSE_SOURCE).not.toContain('`');
    expect(BROWSE_SOURCE).not.toContain('${');
    expect(BROWSE_SOURCE).toContain('pipe: true');
    expect(BROWSE_SOURCE).not.toContain('remote-debugging-port');
  });
});

describe('browse', () => {
  beforeAll(async () => {
    provider = await LocalDockerProvider.create({ vaultPaths: [] });
    // Outside any sandbox's clock: a daemon that does not hold the image pulls it here.
    await imageId(BROWSER_IMAGE, { pull: true });
  }, 900_000);

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'sandbox-browse-'));
    await mkdir(join(base, 'workspace'));
  });

  afterEach(async () => {
    for (const h of live.splice(0)) await provider.destroy(h).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  });

  test('a form in a deny-all sandbox is filled, submitted, and read, and the sandbox is still --network none', async () => {
    const h = await serving();
    const result = await provider.browse(h, GREET);
    expect(result.ready).toBe(true);
    expect(result.failedStep).toBeNull();
    expect(result.blocked).toEqual([]);
    expect(result.observations).toEqual([{ kind: 'observed', matched: 1, visible: true, text: 'Hello, Ada', value: null, path: '/', title: 'Greeter' }]);
    expect(result.browser.image).toBe(await imageId(BROWSER_IMAGE));
    expect(result.browser.name).not.toBe('');
    expect(result.browser.version).toMatch(/^\d+\./u);
    const network = (await run('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', h])).stdout.trim();
    expect(network).toBe('none');
    expect(await browseContainers()).toEqual([]);
  });

  test('every host the page asks for is refused and reported: an image, a fetch over TLS, and a socket', async () => {
    const h = await serving();
    const result = await provider.browse(h, steps({ do: 'goto', path: '/external' }, { do: 'observe', target: { role: 'heading', name: 'Shown' } }));
    expect(result.failedStep).toBeNull();
    expect(result.blocked.map((b) => b.host)).toEqual(['api.example.invalid', 'images.example.invalid', 'socket.example.invalid']);
    expect(result.blocked.every((b) => b.requests >= 1 && !b.navigation)).toBe(true);
    expect(result.observations[0]).toMatchObject({ kind: 'observed', matched: 1, text: 'Shown' });
  });

  test('a link off the loopback fails its step, names the host as a navigation, and leaves the later observation unmade', async () => {
    const h = await serving();
    const result = await provider.browse(h, steps({ do: 'goto', path: '/leave' }, { do: 'click', target: { text: 'Leave' } }, { do: 'observe', target: { text: 'Leave' } }));
    expect(result.failedStep?.index).toBe(1);
    expect(result.failedStep?.reason).toContain('elsewhere.example.invalid');
    expect(result.blocked).toEqual([{ host: 'elsewhere.example.invalid', requests: 1, navigation: true }]);
    expect(result.observations).toEqual([{ kind: 'not-reached', reason: 'step 1 could not be done' }]);
  });

  test('a target that names two elements is counted when observed and never clicked', async () => {
    const h = await serving();
    const save = { role: 'button', name: 'Save' };
    const result = await provider.browse(h, steps({ do: 'goto', path: '/twins' }, { do: 'observe', target: save }, { do: 'click', target: save }, { do: 'observe', target: save }));
    expect(result.observations[0]).toMatchObject({ kind: 'observed', matched: 2, visible: false, text: '' });
    expect(result.failedStep?.index).toBe(2);
    expect(result.failedStep?.reason).toContain('matched 2 elements');
    expect(result.observations[1]?.kind).toBe('not-reached');
  });

  test('a path that begins with two slashes is a path on the loopback, never another host', async () => {
    const h = await serving();
    const result = await provider.browse(h, steps({ do: 'goto', path: '//elsewhere.example.invalid/x' }, { do: 'observe', target: { text: 'nothing here' } }));
    expect(result.blocked).toEqual([]);
    expect(result.observations[0]).toMatchObject({ kind: 'observed', matched: 1, title: 'Missing' });
  });

  test('a port nothing listens on is not ready, and the browser is still named', async () => {
    const h = await serving();
    const result = await provider.browse(h, { ...GREET, port: 8099, readyWithinMs: 500 });
    expect(result).toMatchObject({ ready: false, observations: [], failedStep: null, blocked: [] });
    expect(result.browser.version).not.toBe('');
  });

  test('a call still running when the sandbox ends has its container removed with it', async () => {
    const h = await serving();
    const call = provider.browse(h, steps({ do: 'goto', path: '/slow' }, { do: 'observe', target: { text: 'Late' } })).catch((error: unknown) => error);
    let seen: string | undefined;
    for (let i = 0; i < 100 && seen === undefined; i += 1) {
      [seen] = await browseContainers();
      if (seen === undefined) await new Promise((r) => setTimeout(r, 100));
    }
    expect(seen).toBeDefined();
    await provider.destroy(h);
    live.splice(live.indexOf(h), 1);
    await call;
    expect(await browseContainers()).toEqual([]);
  });

  test('a browser that outlives the wall clock ends the sandbox, and the call is refused', async () => {
    const h = await serving({ limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 4_000 } });
    const refused = await refusal(() => provider.browse(h, steps({ do: 'goto', path: '/slow' }, { do: 'observe', target: { text: 'Late' } })));
    expect(refused.layer).toBe('lifetime');
    expect(await browseContainers()).toEqual([]);
  });

  test('an ended sandbox is refused before any browser starts', async () => {
    const h = await serving();
    await provider.destroy(h);
    live.splice(live.indexOf(h), 1);
    const refused = await refusal(() => provider.browse(h, GREET));
    expect(refused.layer).toBe('lifetime');
  });
});
