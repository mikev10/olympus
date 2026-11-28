/**
 * The runtime assertions R3 owns: that a browser verdict is the runtime's
 * comparison of what a browser out of the product's reach saw (I2, I3), that
 * nothing the browser could not do or reach is read as done (I5), and that
 * the browser that ran is named in the evidence (I8).
 *
 * The Docker-backed entries require a daemon and fail without one, for the
 * reason `local-sandbox.ts` gives: an assertion about where a browser ran
 * proves nothing if it skipped the container it was about. Each reads the
 * browser image's content ID before it provisions, so a daemon that does not
 * hold the image pulls it outside any sandbox's wall clock (D-R3-11).
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { CheckResult } from '@olympus-ai/integrity';
import type { BrowseResult, LocalDockerProvider, SandboxHandle, SandboxSpec } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { specFor, withProvider, withSandbox, withSandboxDirs, type SandboxDirs } from './local-sandbox.js';

const run = promisify(execFile);

/**
 * A product on 8080. `/` greets by the name typed into its form and `/wrong`
 * says goodbye instead; `/external` shows its heading and asks another host
 * for an image; `/leave` links off the loopback; `/twins` has two buttons with
 * one name; `/forged` shows a goodbye and rewrites what its own scripts read
 * to say hello, writing what it then reads into its title; `/slow` takes four
 * seconds to answer.
 */
const SERVER = `
  const page = (title, body) => '<!doctype html><html><head><title>' + title + '</title></head><body>' + body + '</body></html>';
  const greeter = (word) => page('Greeter', '<form onsubmit="event.preventDefault(); ' +
    'document.getElementById(\\'out\\').textContent = \\'' + word + ', \\' + document.getElementById(\\'n\\').value">' +
    '<label for="n">Name</label><input id="n"><button>Greet</button></form><p role="status" id="out"></p>');
  require('node:http').createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/') return res.end(greeter('Hello'));
    if (req.url === '/wrong') return res.end(greeter('Goodbye'));
    if (req.url === '/external') return res.end(page('External', '<h1>Shown</h1><img src="http://images.example.invalid/x.png">'));
    if (req.url === '/leave') return res.end(page('Leave', '<h1>Here</h1><a href="http://elsewhere.example.invalid/">Leave</a>'));
    if (req.url === '/twins') return res.end(page('Twins', '<button>Save</button><button>Save</button>'));
    if (req.url === '/forged') return res.end(page('Forged', '<p role="status" id="out">Goodbye, Ada</p><script>' +
      'Object.defineProperty(HTMLElement.prototype, "innerText", { get() { return "Hello, Ada"; } });' +
      'Object.defineProperty(Node.prototype, "textContent", { get() { return "Hello, Ada"; } });' +
      'document.title = "page reads: " + document.getElementById("out").innerText;</script>'));
    if (req.url === '/slow') return setTimeout(() => res.end(page('Slow', '<h1>Late</h1>')), 4000);
    res.statusCode = 404;
    res.end(page('Missing', 'nothing here'));
  }).listen(8080);
`;

interface Scenario {
  readonly id: string;
  readonly input: unknown;
  readonly expected: unknown;
}

function scenario(id: string, steps: readonly unknown[], observations: readonly unknown[], mayBlock?: readonly string[]): Scenario {
  return {
    id,
    input: { serve: ['node', '--eval', SERVER], port: 8080, steps, ...(mayBlock === undefined ? {} : { mayBlock }) },
    expected: { observations },
  };
}

/** Types a name into the form at `path`, submits it, and expects the greeting. */
function greets(id: string, path: string): Scenario {
  return scenario(
    id,
    [
      { do: 'goto', path },
      { do: 'fill', target: { label: 'Name' }, value: 'Ada' },
      { do: 'click', target: { role: 'button', name: 'Greet' } },
      { do: 'observe', target: { role: 'status', name: '' } },
    ],
    [{ text: 'Hello, Ada', visible: true }],
  );
}

/** A sandbox that can serve the product: Node, no egress, and a clock long enough for a step to wait out its target. */
function serving(dirs: SandboxDirs, proxyImage: string): SandboxSpec {
  return specFor(dirs, 'ro', { image: proxyImage, limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 120_000 } });
}

/** A provider, the sandbox image, and the browser image already held, so no sandbox's clock pays for a pull. */
async function withBrowser(
  prefix: string,
  body: (rig: { provider: LocalDockerProvider; spec: () => SandboxSpec; browserImageId: string }) => Promise<void>,
): Promise<void> {
  const { BROWSER_IMAGE, EGRESS_PROXY_IMAGE, imageId } = await import('@olympus-ai/sandbox');
  const browserImageId = await imageId(BROWSER_IMAGE, { pull: true });
  await withProvider(prefix, (provider, dirs) => body({ provider, spec: () => serving(dirs, EGRESS_PROXY_IMAGE), browserImageId }));
}

/** Runs one scenario through the adapter in a sandbox of its own. */
async function judged(rig: { provider: LocalDockerProvider; spec: () => SandboxSpec }, s: Scenario): Promise<CheckResult> {
  const { BrowserBehavioralAdapter } = await import('@olympus-ai/adapters');
  return withSandbox(rig.provider, rig.spec(), (h) => new BrowserBehavioralAdapter(rig.provider).run(s, h));
}

function fields(result: CheckResult): string[] {
  const outcome = result.expectation;
  if (outcome === null) throw new Error('a browser scenario returned no expectation');
  return outcome.held ? [] : outcome.mismatches.map((m) => m.field);
}

function evidence(result: CheckResult): BrowseResult {
  return JSON.parse(result.stdout) as BrowseResult;
}

/** The browser containers running in `h`'s network namespace. */
async function browsersOf(h: SandboxHandle): Promise<string[]> {
  const { stdout } = await run('docker', ['ps', '--all', '--filter', 'name=browse-', '--format', '{{.Names}}']);
  const names = stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
  const joined: string[] = [];
  for (const name of names) {
    const mode = await run('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', name]).then((r) => r.stdout.trim(), () => '');
    if (mode === `container:${h}`) joined.push(name);
  }
  return joined;
}

async function seenBrowser(h: SandboxHandle): Promise<string> {
  for (let i = 0; i < 100; i += 1) {
    const [name] = await browsersOf(h);
    if (name !== undefined) return name;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('I3: no browser container was seen while the call ran');
}

const SLOW = { port: 8080, readyWithinMs: 10_000, steps: [{ do: 'goto', path: '/slow' }, { do: 'observe', target: { text: 'Late' } }] } as const;

/**
 * Run inside the product's container while the browser runs: every port
 * listening in the shared network namespace but the product's own, and what
 * each answers a request with. A browser driven over a port would be one of
 * them, and would answer.
 */
const LISTENERS = `
  const fs = require('node:fs');
  const ports = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (error) { continue; }
    for (const line of text.split('\\n').slice(1)) {
      const cols = line.trim().split(/\\s+/);
      if (cols[3] === '0A') ports.add(parseInt(cols[1].split(':').pop(), 16));
    }
  }
  ports.delete(8080);
  const ask = (port) => new Promise((resolve) => {
    const req = require('node:http').get({ host: '127.0.0.1', port, path: '/json/version', timeout: 3000 }, (res) => { res.resume(); resolve([port, res.statusCode]); });
    req.on('timeout', () => { req.destroy(); resolve([port, 'timeout']); });
    req.on('error', (error) => resolve([port, error.code || 'error']));
  });
  Promise.all([...ports].map(ask)).then((answers) => process.stdout.write(JSON.stringify(answers)));
`;

export const BROWSER_VERDICT_JUDGED_OUTSIDE_THE_PRODUCT: LocalAssertion = runtime({
  id: 'I2.browser-verdict-judged-outside-the-product',
  title:
    'a browser scenario runs against a real server in a real sandbox; a page that shows what the scenario expects after its steps holds, ' +
    'one that renders with the wrong text does not, naming the observation and the field, and the gate fails it on its expectation; ' +
    'a page that rewrites what its own scripts read is still judged on what it shows',
  run: async () => {
    const { requiredShortfall } = await import('@olympus-ai/api');
    const spec = { id: 'greets', kind: 'behavioral' as const, command: ['serve'] as const, required: true, timeoutMs: 60_000 };
    await withBrowser('conformance-browser-', async (rig) => {
      const right = await judged(rig, greets('greets', '/'));
      if (right.expectation?.held !== true) throw new Error(`I2: a page that showed what was expected did not hold: ${JSON.stringify(right.expectation)}`);
      if (requiredShortfall(spec, right) !== undefined) throw new Error('I2: a held browser expectation failed the gate');
      // A page that asked for nothing must report no refused host, or every scenario would fail on the browser's own traffic (D-R3-04).
      if (evidence(right).blocked.length !== 0) throw new Error(`I2: a page that asked no other host for anything reported ${JSON.stringify(evidence(right).blocked)}`);

      const wrong = await judged(rig, greets('greets', '/wrong'));
      if (wrong.expectation?.held !== false) throw new Error("I2: a page that rendered the wrong text was accepted by the runtime's comparison");
      const named = fields(wrong).join(',');
      if (named !== 'observations[0].text') throw new Error(`I2: the mismatch named ${named}, not the observation and field that differed`);
      const failed = requiredShortfall(spec, wrong);
      if (failed?.cause !== 'expectation') throw new Error(`I2: a page with the wrong text did not fail the gate on its expectation (${failed?.cause ?? 'passed'})`);

      // A page that rewrites what its own scripts read does not rewrite what the browser reports. The title is the
      // control: the page wrote it from its own reading, so the expectation on it holds only if the rewrite took.
      const status = [{ do: 'goto', path: '/forged' }, { do: 'observe', target: { role: 'status', name: '' } }];
      const forged = await judged(rig, scenario('forged', status, [{ text: 'Hello, Ada', title: 'page reads: Hello, Ada' }]));
      const told = fields(forged).join(',');
      if (told !== 'observations[0].text') {
        throw new Error(`I2: a page that reports itself as showing the expected text ${told === '' ? 'held' : `failed on ${told}`}, not on the text the browser read`);
      }
    });
  },
});

export const BROWSER_OUT_OF_THE_PRODUCTS_REACH: LocalAssertion = runtime({
  id: 'I3.browser-out-of-the-products-reach',
  title:
    "the browser is inspected while it runs: in the sandbox's network namespace and its own process namespace, nothing mounted, a read-only root, every capability " +
    'dropped and none added, no new privileges, an unprivileged user, without a file the product wrote, and with no port the product can drive it through; ' +
    'a deny-all sandbox it browsed is still --network none, and no browser outlives its call or its sandbox',
  run: async () => {
    await withBrowser('conformance-browser-reach-', async ({ provider, spec }) => {
      await withSandbox(provider, spec(), async (h) => {
        const started = await provider.exec(h, ['node', '--eval', SERVER], { detach: true });
        if (started.exitCode !== 0) throw new Error(`I3: the product's server did not start: ${started.stderr}`);
        const planted = await provider.exec(h, ['sh', '-c', 'echo forged > /tmp/browse-marker']);
        if (planted.exitCode !== 0) throw new Error("I3: could not plant the marker in the product's container");

        const call = provider.browse(h, SLOW);
        const browser = await seenBrowser(h);
        // PidMode empty is Docker's private PID namespace: the product's processes are not the browser's.
        const format =
          '{{.HostConfig.NetworkMode}}|{{.HostConfig.PidMode}}|{{json .Mounts}}|{{json .HostConfig.Binds}}|{{json .HostConfig.Tmpfs}}|{{.HostConfig.ReadonlyRootfs}}|' +
          '{{json .HostConfig.CapDrop}}|{{json .HostConfig.CapAdd}}|{{.HostConfig.Privileged}}|{{json .HostConfig.SecurityOpt}}|{{.Config.User}}';
        const inspected = (await run('docker', ['inspect', '--format', format, browser])).stdout.trim();
        const wanted = `container:${h}||[]|null|null|true|["ALL"]|null|false|["no-new-privileges"]|65534:65534`;
        if (inspected !== wanted) throw new Error(`I3: the browser ran as ${inspected}, not ${wanted}`);
        // Asked inside the browser's container, with its own node binary as a control, so an exec
        // that failed cannot pass for a file that is absent.
        const check =
          "const fs = require('node:fs'); process.stdout.write(JSON.stringify({ marker: fs.existsSync('/tmp/browse-marker'), control: fs.existsSync(process.execPath) }))";
        const inside = (await run('docker', ['exec', browser, 'node', '--eval', check])).stdout.trim();
        if (inside !== '{"marker":false,"control":true}') throw new Error(`I3: inside the browser's container, the product's marker and the control read ${inside}`);

        // From the product's side of the shared network: whatever the browser's container listens on refuses the product.
        let listeners: Array<[number, number | string]> = [];
        for (let i = 0; i < 30 && listeners.length < 2; i += 1) {
          const asked = await provider.exec(h, ['node', '--eval', LISTENERS]);
          if (asked.exitCode !== 0) throw new Error(`I3: the product's container could not list what listens beside it: ${asked.stderr}`);
          listeners = JSON.parse(asked.stdout) as Array<[number, number | string]>;
          if (listeners.length < 2) await new Promise((r) => setTimeout(r, 100));
        }
        if (listeners.length < 2) throw new Error(`I3 control: the browser's two refusing listeners were not seen from the product's container (${JSON.stringify(listeners)})`);
        const open = listeners.filter(([, status]) => status !== 403);
        if (open.length > 0) throw new Error(`I3: the product reached a listener beside it that did not refuse it: ${JSON.stringify(open)}`);

        const result = await call;
        const [seen] = result.observations;
        if (seen?.kind !== 'observed' || seen.text !== 'Late') throw new Error(`I3: the browser did not observe the product's page: ${JSON.stringify(result)}`);
        const network = (await run('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', h])).stdout.trim();
        if (network !== 'none') throw new Error(`I3: browsing a deny-all sandbox changed its network to ${network}`);
        const left = await browsersOf(h);
        if (left.length > 0) throw new Error(`I3: browser containers outlived their call: ${left.join(', ')}`);
      });

      // A call still running when its sandbox ends: the browser goes with it.
      const h = await provider.provision(spec());
      let call: Promise<unknown> | undefined;
      try {
        const started = await provider.exec(h, ['node', '--eval', SERVER], { detach: true });
        if (started.exitCode !== 0) throw new Error(`I3: the product's server did not start: ${started.stderr}`);
        call = provider.browse(h, SLOW).catch((error: unknown) => error);
        await seenBrowser(h);
      } finally {
        await provider.destroy(h);
      }
      await call;
      const outlived = await browsersOf(h);
      if (outlived.length > 0) throw new Error(`I3: browser containers outlived their sandbox: ${outlived.join(', ')}`);
    });
  },
});

export const BROWSER_NEVER_LEAVES_LOOPBACK: LocalAssertion = runtime({
  id: 'I5.browser-never-leaves-loopback',
  title:
    'a page that asks another host for a resource has the request refused and the host reported; unlisted, it fails the scenario naming the host, and listed in mayBlock ' +
    'it does not; a link that navigates off the loopback fails the scenario whether or not its host is listed',
  run: async () => {
    await withBrowser('conformance-browser-loopback-', async (rig) => {
      const shown = [{ do: 'goto', path: '/external' }, { do: 'observe', target: { role: 'heading', name: 'Shown' } }];
      const unlisted = await judged(rig, scenario('external', shown, [{ text: 'Shown' }]));
      const reported = evidence(unlisted).blocked;
      if (reported.length !== 1 || reported[0]?.host !== 'images.example.invalid' || reported[0].requests < 1 || reported[0].navigation) {
        throw new Error(`I5: the refused request was not reported as the one host the page asked for: ${JSON.stringify(reported)}`);
      }
      if (fields(unlisted).join(',') !== 'blocked.images.example.invalid') {
        throw new Error(`I5: a page that asked an unlisted host for a resource ${unlisted.expectation?.held === true ? 'held' : `failed on ${fields(unlisted).join(',')}`}`);
      }
      const listed = await judged(rig, scenario('external', shown, [{ text: 'Shown' }], ['images.example.invalid']));
      if (listed.expectation?.held !== true) throw new Error(`I5 control: a refused host the scenario lists failed it: ${JSON.stringify(listed.expectation)}`);
      if (evidence(listed).blocked.length !== 1) throw new Error('I5: a listed host was refused and not reported');

      const leave = [{ do: 'goto', path: '/leave' }, { do: 'click', target: { role: 'link', name: 'Leave' } }, { do: 'observe', target: { role: 'heading', name: 'Here' } }];
      for (const mayBlock of [undefined, ['elsewhere.example.invalid']]) {
        const left = await judged(rig, scenario('leave', leave, [{ matched: 0 }], mayBlock));
        const named = fields(left);
        if (!named.includes('blocked.elsewhere.example.invalid')) {
          throw new Error(`I5: a link off the loopback ${mayBlock === undefined ? '' : 'to a listed host '}${named.length === 0 ? 'held' : `failed on ${named.join(',')} only`}`);
        }
        const gone = evidence(left).blocked.find((b) => b.host === 'elsewhere.example.invalid');
        if (gone?.navigation !== true) throw new Error(`I5: the navigation off the loopback was not reported as one: ${JSON.stringify(evidence(left).blocked)}`);
      }
    });
  },
});

export const BROWSER_STEP_THAT_CANNOT_BE_DONE: LocalAssertion = runtime({
  id: 'I5.browser-step-that-cannot-be-done',
  title:
    'a step whose target matches nothing, or more than one element, fails the scenario naming the step; every later observation is not-reached, ' +
    'and none is compared as if it had been made',
  run: async () => {
    await withBrowser('conformance-browser-step-', async (rig) => {
      const cases: Array<[string, unknown, string]> = [
        ['two elements', { role: 'button', name: 'Save' }, 'matched 2 elements'],
        ['no element', { text: 'Publish' }, 'matched no element'],
      ];
      for (const [what, target, reason] of cases) {
        // The expectation would hold had the observation been made: the page's title is Twins.
        const steps = [{ do: 'goto', path: '/twins' }, { do: 'click', target }, { do: 'observe', target: { role: 'button', name: 'Save' } }];
        const result = await judged(rig, scenario('twins', steps, [{ matched: 2, title: 'Twins' }]));
        const report = evidence(result);
        if (report.failedStep?.index !== 1 || !report.failedStep.reason.includes(reason)) {
          throw new Error(`I5: a click on a target that names ${what} was reported as ${JSON.stringify(report.failedStep)}`);
        }
        if (report.observations.length !== 1 || report.observations[0]?.kind !== 'not-reached') {
          throw new Error(`I5: the observation after a step that could not be done was reported as made: ${JSON.stringify(report.observations)}`);
        }
        const named = fields(result).join(',');
        if (named !== 'steps[1],observations[0]') throw new Error(`I5: a click on a target that names ${what} ${named === '' ? 'held' : `failed on ${named}`}, not on its step and the observation it kept from being made`);
      }
      // Control: the same expectation holds when no step fails, so the failures above are the step's.
      const control = await judged(rig, scenario('twins', [{ do: 'goto', path: '/twins' }, { do: 'observe', target: { role: 'button', name: 'Save' } }], [{ matched: 2, title: 'Twins' }]));
      if (control.expectation?.held !== true) throw new Error(`I5 control: the expectation does not hold on the page with no failed step: ${JSON.stringify(control.expectation)}`);
    });
  },
});

export const BROWSER_UNAVAILABLE_WITHOUT_A_PROVIDER: LocalAssertion = runtime({
  id: 'I5.browser-unavailable-without-a-provider',
  title:
    'a provider with no browse builds a set that names behavioral:browser, with that provider as the reason, and cannot construct the browser adapter; ' +
    'a provider with one builds a set that carries it, and mutation still keeps that set from L3',
  run: async () => {
    const [{ adapterAdmission, BrowserBehavioralAdapter, buildAdapterSet }, { LocalDockerProvider: Provider, StubSandboxProvider }] = await Promise.all([
      import('@olympus-ai/adapters'),
      import('@olympus-ai/sandbox'),
    ]);
    await withSandboxDirs('conformance-browser-set-', async (dirs) => {
      await writeFile(join(dirs.workspace, 'package.json'), JSON.stringify({ name: 'fixture', devDependencies: { vitest: '^4.1.0' } }));

      const stub = new StubSandboxProvider();
      if ('browse' in stub) throw new Error('I5: StubSandboxProvider has a browse, though every process it runs is on the host');
      const without = await buildAdapterSet(dirs.workspace, { provider: stub, coverage: null });
      if (!without.unavailableControls().includes('behavioral:browser')) throw new Error('I5: a set on a provider with no browse did not name behavioral:browser');
      if (without.behavioral.some((adapter) => adapter.kind === 'browser')) throw new Error('I5: a set on a provider with no browse carries a browser adapter');
      const why = without.reasons.get('behavioral:browser') ?? '';
      if (!why.includes(stub.id)) throw new Error(`I5: the reason behavioral:browser is unavailable does not name the provider: ${why}`);
      let refused = false;
      try {
        new BrowserBehavioralAdapter(stub);
      } catch {
        refused = true;
      }
      if (!refused) throw new Error('I5: the browser adapter was constructed on a provider with no browse');

      const local = await Provider.create({ vaultPaths: [dirs.vault] });
      const withBrowse = await buildAdapterSet(dirs.workspace, { provider: local, coverage: null });
      if (withBrowse.unavailableControls().includes('behavioral:browser')) throw new Error('I5: a set on a provider with a browse still names behavioral:browser');
      if (!withBrowse.behavioral.some((adapter) => adapter.kind === 'browser')) throw new Error('I5: a set on a provider with a browse carries no browser adapter');
      const l3 = adapterAdmission(withBrowse, 3);
      if (l3.ok || !l3.unavailable.includes('mutation')) throw new Error(`I5: a set that can browse was not still refused L3 for mutation: ${l3.ok ? 'admitted' : l3.message}`);
      if (l3.unavailable.includes('behavioral:browser')) throw new Error('I5: the L3 refusal names behavioral:browser for a set that carries it');
    });
  },
});

export const BROWSER_SCENARIO_SHAPE: LocalAssertion = runtime({
  id: 'I5.browser-scenario-shape',
  title:
    'an input or expected with an unrecognised key, a goto that is not a path, a target that is none of the three forms, an expected not as long as the observe steps, ' +
    'or a second scenario on a served handle is refused, naming the field',
  run: async () => {
    const { AdapterRefusal, BrowserBehavioralAdapter, readBrowserScenario } = await import('@olympus-ai/adapters');
    const goto = { do: 'goto', path: '/' };
    const observe = { do: 'observe', target: { text: 'Hello' } };
    const base = { serve: ['node', 'server.js'], port: 8080 };
    const one = { observations: [{ text: 'Hello' }] };
    const good = { id: 'shape', input: { ...base, steps: [goto, observe] }, expected: one };
    readBrowserScenario(good);

    const refusals: Array<[string, unknown, unknown, string]> = [
      ['an unrecognised input key', { ...base, steps: [goto, observe], url: 'http://other.example/' }, one, 'input.url'],
      ['an unrecognised expected key', { ...base, steps: [goto, observe] }, { ...one, screenshot: 'page.png' }, 'expected.screenshot'],
      ['an unrecognised key in an expected observation', { ...base, steps: [goto, observe] }, { observations: [{ html: '<p>' }] }, 'expected.observations[0].html'],
      ['a goto that is a URL', { ...base, steps: [{ do: 'goto', path: 'http://other.example/' }, observe] }, one, 'input.steps[0].path'],
      ['a goto that carries a host', { ...base, steps: [{ do: 'goto', path: '/', host: 'other.example' }, observe] }, one, 'input.steps[0].host'],
      ['a selector over markup', { ...base, steps: [goto, { do: 'click', target: { selector: '#go' } }, observe] }, one, 'input.steps[1].target'],
      ['a test id', { ...base, steps: [goto, { do: 'observe', target: { testId: 'out' } }] }, one, 'input.steps[1].target'],
      ['a target of two forms', { ...base, steps: [goto, { do: 'observe', target: { text: 'Hello', label: 'Hello' } }] }, one, 'input.steps[1].target'],
      ['a script step', { ...base, steps: [goto, { do: 'evaluate', script: 'document.title' }, observe] }, one, 'input.steps[1].do'],
      ['fewer expected observations than observe steps', { ...base, steps: [goto, observe, observe] }, one, 'expected.observations has 1 entries for 2'],
      ['more expected observations than observe steps', { ...base, steps: [goto, observe] }, { observations: [{ text: 'a' }, { text: 'b' }] }, 'expected.observations has 2 entries for 1'],
      ['an expected observation that names nothing', { ...base, steps: [goto, observe] }, { observations: [{}] }, 'expected.observations[0]'],
      ['no observe step', { ...base, steps: [goto] }, { observations: [] }, 'input.steps'],
    ];
    for (const [what, input, expected, field] of refusals) {
      let message: string | undefined;
      try {
        readBrowserScenario({ id: 'shape', input, expected });
      } catch (error) {
        if (!(error instanceof AdapterRefusal) || error.reason !== 'unrecognised-scenario') throw error;
        message = error.message;
      }
      if (message === undefined) throw new Error(`I5: a browser scenario with ${what} was read`);
      if (!message.includes(field)) throw new Error(`I5: the refusal of ${what} did not name ${field}: ${message}`);
    }

    await withBrowser('conformance-browser-shape-', async ({ provider, spec }) => {
      await withSandbox(provider, spec(), async (h) => {
        const adapter = new BrowserBehavioralAdapter(provider);
        await adapter.run(greets('first', '/'), h);
        let message: string | undefined;
        try {
          await adapter.run(greets('second', '/'), h);
        } catch (error) {
          if (!(error instanceof AdapterRefusal)) throw error;
          message = error.message;
        }
        if (message === undefined) throw new Error('I5: a second browser scenario ran on a handle whose first server still holds it');
        if (!message.includes('second') || !message.includes('fresh sandbox')) throw new Error(`I5: the refusal of a second scenario did not name it: ${message}`);
      });
    });
  },
});

export const BROWSER_NAMED_IN_EVIDENCE: LocalAssertion = runtime({
  id: 'I8.browser-named-in-evidence',
  title:
    "a browser scenario's result names the image's content ID and the browser's name and version, and the content ID is the one the pin resolves to on the engine that ran it",
  run: async () => {
    const { CONTENT_ID } = await import('@olympus-ai/sandbox');
    await withBrowser('conformance-browser-evidence-', async (rig) => {
      const result = await judged(rig, greets('greets', '/'));
      const { browser } = evidence(result);
      if (!CONTENT_ID.test(rig.browserImageId)) throw new Error(`I8 control: the pin resolved to ${rig.browserImageId}, which is not a content ID`);
      if (browser.image !== rig.browserImageId) throw new Error(`I8: the result names image ${browser.image}, and the pin resolves to ${rig.browserImageId}`);
      if (browser.name.trim() === '') throw new Error('I8: the result does not name the browser');
      if (!/^\d+(\.\d+)+$/u.test(browser.version)) throw new Error(`I8: the result names the browser's version as ${JSON.stringify(browser.version)}`);
      // The container was started from that ID: an image is run by its content ID or not at all.
      const { browseRunArgs } = await import('@olympus-ai/sandbox');
      const args = browseRunArgs('browse-x', 'sandbox-x', rig.browserImageId, []);
      if (args[args.length - 3] !== rig.browserImageId) throw new Error(`I8: the browser container is started from ${String(args[args.length - 3])}, not the content ID`);
    });
  },
});

/** R3's assertions, by the invariant each one is registered under. */
export const R3_ASSERTIONS = {
  I2: [BROWSER_VERDICT_JUDGED_OUTSIDE_THE_PRODUCT],
  I3: [BROWSER_OUT_OF_THE_PRODUCTS_REACH],
  I5: [BROWSER_NEVER_LEAVES_LOOPBACK, BROWSER_STEP_THAT_CANNOT_BE_DONE, BROWSER_UNAVAILABLE_WITHOUT_A_PROVIDER, BROWSER_SCENARIO_SHAPE],
  I8: [BROWSER_NAMED_IN_EVIDENCE],
} as const;
