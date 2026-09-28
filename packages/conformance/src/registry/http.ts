/**
 * The runtime assertions P11 owns: that an HTTP verdict is the runtime's
 * comparison of what a client out of the product's reach observed (I2), and
 * that a provider without such a client is named rather than trusted (I5).
 *
 * The Docker-backed entries require a daemon and fail without one, for the
 * reason `local-sandbox.ts` gives: an assertion about where a client ran
 * proves nothing if it skipped the container it was about.
 */
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { specFor, withProvider, withSandbox, withSandboxDirs } from './local-sandbox.js';

const run = promisify(execFile);

/** A product that answers `/` correctly, `/wrong` with a 200 and the wrong body, and `/slow` after two seconds. */
const SERVER = `
  require('node:http').createServer((req, res) => {
    const reply = () => res.end(req.url === '/wrong' ? 'goodbye' : 'hello');
    if (req.url === '/slow') setTimeout(reply, 2000); else reply();
  }).listen(8080);
`;

function scenario(id: string, path: string): { id: string; input: unknown; expected: unknown } {
  return {
    id,
    input: { serve: ['node', '--eval', SERVER], port: 8080, exchanges: [{ method: 'GET', path }] },
    expected: { exchanges: [{ status: 200, body: 'hello' }] },
  };
}

async function probeContainers(): Promise<string[]> {
  const { stdout } = await run('docker', ['ps', '--all', '--filter', 'name=probe-', '--format', '{{.Names}}']);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

export const HTTP_VERDICT_JUDGED_OUTSIDE_THE_PRODUCT: LocalAssertion = runtime({
  id: 'I2.http-verdict-judged-outside-the-product',
  title:
    'an HTTP scenario runs against a real server in a real sandbox; a server that answers as expected holds, one that answers 200 ' +
    "with the wrong body does not, naming the exchange and field, and the gate fails it on its expectation",
  run: async () => {
    const [{ HttpBehavioralAdapter }, { requiredShortfall }, { EGRESS_PROXY_IMAGE }] = await Promise.all([
      import('@olympus-ai/adapters'),
      import('@olympus-ai/api'),
      import('@olympus-ai/sandbox'),
    ]);
    const spec = { id: 'greets', kind: 'behavioral' as const, command: ['serve'] as const, required: true, timeoutMs: 30_000 };
    await withProvider('conformance-http-', async (provider, dirs) => {
      const image = { image: EGRESS_PROXY_IMAGE };
      const right = await withSandbox(provider, specFor(dirs, 'ro', image), (h) => new HttpBehavioralAdapter(provider).run(scenario('greets', '/'), h));
      if (right.expectation?.held !== true) throw new Error(`I2: a server that answered as expected did not hold: ${JSON.stringify(right.expectation)}`);
      if (requiredShortfall(spec, right) !== undefined) throw new Error('I2: a held HTTP expectation failed the gate');

      const wrong = await withSandbox(provider, specFor(dirs, 'ro', image), (h) => new HttpBehavioralAdapter(provider).run(scenario('greets', '/wrong'), h));
      if (wrong.expectation?.held !== false) throw new Error('I2: a 200 with the wrong body was accepted by the runtime\'s comparison');
      const field = wrong.expectation.mismatches[0].field;
      if (field !== 'exchanges[0].body') throw new Error(`I2: the mismatch named ${field}, not the exchange and field that differed`);
      const failed = requiredShortfall(spec, wrong);
      if (failed?.cause !== 'expectation') throw new Error(`I2: a 200 with the wrong body did not fail the gate on its expectation (${failed?.cause ?? 'passed'})`);
    });
  },
});

export const HTTP_PROBE_SHARES_NETWORK_NOT_FILESYSTEM: LocalAssertion = runtime({
  id: 'I2.http-probe-shares-network-not-filesystem',
  title:
    "the probe is inspected while it runs: in the sandbox's network namespace and its own process namespace, nothing mounted, a " +
    'read-only root, every capability dropped, no new privileges, an unprivileged user, and without a file the product wrote; a deny-all sandbox it probed is still --network none, and no probe outlives its call',
  run: async () => {
    const { EGRESS_PROXY_IMAGE } = await import('@olympus-ai/sandbox');
    await withProvider('conformance-probe-', async (provider, dirs) => {
      await withSandbox(provider, specFor(dirs, 'ro', { image: EGRESS_PROXY_IMAGE }), async (h) => {
        const started = await provider.exec(h, ['node', '--eval', SERVER], { detach: true });
        if (started.exitCode !== 0) throw new Error(`I2: the product's server did not start: ${started.stderr}`);
        const planted = await provider.exec(h, ['sh', '-c', 'echo forged > /tmp/probe-marker']);
        if (planted.exitCode !== 0) throw new Error('I2: could not plant the marker in the product\'s container');

        const call = provider.probe(h, { port: 8080, readyWithinMs: 10_000, exchanges: [{ method: 'GET', path: '/slow' }] });
        let probe: string | undefined;
        for (let i = 0; i < 50 && probe === undefined; i += 1) {
          [probe] = await probeContainers();
          if (probe === undefined) await new Promise((r) => setTimeout(r, 100));
        }
        if (probe === undefined) throw new Error('I2: no probe container was seen while the call ran');
        // PidMode empty is Docker's private PID namespace: the product's processes are not the probe's.
        const format =
          '{{.HostConfig.NetworkMode}}|{{.HostConfig.PidMode}}|{{json .Mounts}}|{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapDrop}}|' +
          '{{json .HostConfig.SecurityOpt}}|{{.Config.User}}';
        const inspected = (await run('docker', ['inspect', '--format', format, probe])).stdout.trim();
        const wanted = `container:${h}||[]|true|["ALL"]|["no-new-privileges"]|65534:65534`;
        if (inspected !== wanted) throw new Error(`I2: the probe ran as ${inspected}, not ${wanted}`);
        // Asked inside the probe, with its own node binary as a control, so an exec that failed
        // cannot pass for a file that is absent.
        const check =
          "const fs = require('node:fs'); process.stdout.write(JSON.stringify({ marker: fs.existsSync('/tmp/probe-marker'), control: fs.existsSync(process.execPath) }))";
        const inside = (await run('docker', ['exec', probe, 'node', '--eval', check])).stdout.trim();
        if (inside !== '{"marker":false,"control":true}') throw new Error(`I2: inside the probe, the product's marker and the control read ${inside}`);

        const result = await call;
        const [seen] = result.observations;
        if (seen?.kind !== 'response' || seen.body !== 'hello') throw new Error(`I2: the probe did not observe the product's answer: ${JSON.stringify(result)}`);
        const network = (await run('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', h])).stdout.trim();
        if (network !== 'none') throw new Error(`I2: probing a deny-all sandbox changed its network to ${network}`);
        const left = await probeContainers();
        if (left.length > 0) throw new Error(`I2: probe containers outlived their call: ${left.join(', ')}`);
      });
    });
  },
});

export const HTTP_PROBE_ABSENT_IS_NAMED: LocalAssertion = runtime({
  id: 'I5.http-probe-absent-is-named',
  title:
    'a provider with no probe builds a set that names behavioral:http unavailable and cannot construct the HTTP adapter; ' +
    'a provider with one builds a set that carries it, and mutation and browser still keep that set from L3',
  run: async () => {
    const [{ adapterAdmission, buildAdapterSet, HttpBehavioralAdapter }, { LocalDockerProvider, StubSandboxProvider }] = await Promise.all([
      import('@olympus-ai/adapters'),
      import('@olympus-ai/sandbox'),
    ]);
    await withSandboxDirs('conformance-http-set-', async (dirs) => {
      await writeFile(join(dirs.workspace, 'package.json'), JSON.stringify({ name: 'fixture', devDependencies: { vitest: '^4.1.0' } }));

      const stub = new StubSandboxProvider();
      if ('probe' in stub) throw new Error('I5: StubSandboxProvider has a probe, though every process it runs is on the host');
      const without = await buildAdapterSet(dirs.workspace, { provider: stub, coverage: null });
      if (!without.unavailableControls().includes('behavioral:http')) throw new Error('I5: a set on a provider with no probe did not name behavioral:http');
      if (without.behavioral.some((adapter) => adapter.kind === 'http')) throw new Error('I5: a set on a provider with no probe carries an HTTP adapter');
      let refused = false;
      try {
        new HttpBehavioralAdapter(stub);
      } catch {
        refused = true;
      }
      if (!refused) throw new Error('I5: the HTTP adapter was constructed on a provider with no probe');

      const local = await LocalDockerProvider.create({ vaultPaths: [dirs.vault] });
      const withProbe = await buildAdapterSet(dirs.workspace, { provider: local, coverage: null });
      if (withProbe.unavailableControls().includes('behavioral:http')) throw new Error('I5: a set on a provider with a probe still names behavioral:http');
      const l3 = adapterAdmission(withProbe, 3);
      if (l3.ok || !l3.unavailable.includes('mutation') || !l3.unavailable.includes('behavioral:browser')) {
        throw new Error(`I5: the L3 refusal did not still name mutation and behavioral:browser: ${l3.ok ? 'admitted' : l3.message}`);
      }
    });
  },
});
