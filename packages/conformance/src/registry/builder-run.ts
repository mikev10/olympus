/**
 * R57: the builder runs the locked acceptance tests in its own sandbox before
 * it finishes. Its tree holds the runtime's install of its lockfile, never the
 * base's own dependency trees; the cache its test runner writes there is not
 * recorded as a write in a dependency tree, while any other write still is
 * (D-R15-05); and init grants `Bash` to the builder alone, with no egress.
 * Each assertion fails with the thing it guards removed (I8).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RoleId, TaskRequest } from '@olympus-ai/core';
import type { EvidenceBundle } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { withVaultDirs } from './local-vault.js';
import { asClone, vitestRepository } from './init.js';
import { EXTRA, recording, withDependencies } from './install.js';
import { HELLO_REPRODUCTION, readRecord, stubDriver, withLine, writeManifest, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');
const adapters = async () => import('@olympus-ai/adapters');

/** A package the base's own tree holds and its lockfile does not pin: an install never places it. */
const STALE = 'node_modules/stale';
/** Where Vitest keeps its results under Vite's default cache directory. */
const CACHE_FILE = 'node_modules/.vite/vitest/0000/results.json';

/** A base whose lockfile pins `extra` and whose own tree also holds `stale`, with `hello-written` its one check. */
async function installedBase(rig: LineRig): Promise<void> {
  const { hashedLockfile } = await adapters();
  await withDependencies(rig, hashedLockfile('hello', [EXTRA]));
  await mkdir(join(rig.dirs.artifacts, STALE), { recursive: true });
  await writeFile(join(rig.dirs.artifacts, STALE, 'index.js'), "module.exports = 'stale';\n");
  await writeManifest(rig.dirs, [HELLO_REPRODUCTION]);
}

/** A builder that runs `script` with node in its own tree, then writes the change `hello-written` passes on. */
async function building(script: string, sandbox: Awaited<ReturnType<typeof recording>>): Promise<{ driver: Awaited<ReturnType<typeof stubDriver>>; seen: string[] }> {
  const seen: string[] = [];
  const driver = await stubDriver({
    during: async (req: TaskRequest) => {
      if (req.role.role !== ('builder' as RoleId)) return;
      const ran = await sandbox.exec(req.sandbox, ['node', '-e', `const fs = require('node:fs'); ${script}; fs.writeFileSync(['hello', 'txt'].join('.'), 'hello')`]);
      if (ran.exitCode !== 0) throw new Error(`R57 control: the builder's command did not run: ${ran.stderr}`);
      seen.push(ran.stdout.trim());
    },
  });
  return { driver, seen };
}

async function lastBundle(rig: LineRig, components: Awaited<ReturnType<LineRig['components']>>): Promise<EvidenceBundle | undefined> {
  const state = await rig.state();
  return (await Promise.all(state.evidenceRefs.map((r) => readRecord<EvidenceBundle>(components.vault, r)))).at(-1);
}

export const BUILD_TREE_HOLDS_THE_INSTALL: LocalAssertion = runtime({
  id: 'I3.build-tree-holds-the-runtime-install',
  title:
    "the tree a builder is handed holds the runtime's install of its lockfile, so the builder can run the locked tests in its own sandbox with no network: a package the lockfile pins is there, and one only the base's own tree held is not, so the base's dependency trees never reach the builder; verify still judges over an install of its own (R57)",
  run: async () => {
    await withLine('r57-install-', async (rig) => {
      await installedBase(rig);
      const sandbox = await recording();
      const { driver, seen } = await building(
        `console.log(JSON.stringify({ extra: fs.existsSync(${JSON.stringify(`${EXTRA}/index.js`)}), stale: fs.existsSync(${JSON.stringify(STALE)}) }))`,
        sandbox,
      );
      const components = await rig.components({ sandbox, driver, reviewer: driver }, { work: false });
      const { startRun } = await api();
      await startRun(await rig.request(components));
      const [first] = seen;
      if (first === undefined) throw new Error('R57 control: the builder never ran');
      const tree = JSON.parse(first) as { extra: boolean; stale: boolean };
      if (!tree.extra) throw new Error(`R57: the builder's tree does not hold ${EXTRA}, which its lockfile pins: it was handed no install`);
      if (tree.stale) throw new Error(`R57: the builder's tree holds ${STALE}, which only the base's own tree held`);
      const bundle = await lastBundle(rig, components);
      if (bundle?.install === null || bundle?.install === undefined) throw new Error(`R57: verify recorded no install of its own: ${JSON.stringify(bundle?.install)}`);
    });
  },
});

export const BUILDER_CACHE_IS_NOT_RECORDED: LocalAssertion = runtime({
  id: 'I3.builder-tool-cache-is-not-a-dependency-write',
  title:
    "a builder that writes under node_modules/.vite, where Vitest keeps its results, and also changes an installed package, has the package recorded as written in a dependency tree and not carried (D-R15-05), and the cache neither recorded nor carried: running the tests raises no finding, and a write anywhere else in a dependency tree still does (R57)",
  run: async () => {
    await withLine('r57-cache-', async (rig) => {
      await installedBase(rig);
      const sandbox = await recording();
      const { driver } = await building(
        [
          `fs.mkdirSync(${JSON.stringify(CACHE_FILE.slice(0, CACHE_FILE.lastIndexOf('/')))}, { recursive: true })`,
          `fs.writeFileSync(${JSON.stringify(CACHE_FILE)}, '{}')`,
          `fs.writeFileSync(${JSON.stringify(`${EXTRA}/index.js`)}, "module.exports = 'changed';")`,
        ].join('; '),
        sandbox,
      );
      const components = await rig.components({ sandbox, driver, reviewer: driver }, { work: false });
      const { startRun } = await api();
      await startRun(await rig.request(components));
      const bundle = await lastBundle(rig, components);
      if (bundle === undefined) throw new Error('R57 control: the task left no evidence');
      if (JSON.stringify(bundle.notCarried) !== JSON.stringify([EXTRA])) {
        throw new Error(`R57: the writes recorded in a dependency tree were ${JSON.stringify(bundle.notCarried)}, not exactly ${EXTRA}`);
      }
    });
  },
});

export const INIT_GRANTS_BASH_TO_THE_BUILDER: LocalAssertion = runtime({
  id: 'I4.init-grants-bash-to-the-builder-alone',
  title:
    "init's policy grants Bash to the builder, with no egress, so it can run the locked tests in its own sandbox, and to no other seat: no drafter, critic, or reviewer runs a command (R57)",
  run: async () => {
    const { initSetup, loadPolicyFile } = await api();
    await withVaultDirs('r57-init-', async (dirs, base) => {
      await vitestRepository(dirs.artifacts);
      asClone(dirs.artifacts);
      const config = join(base, 'config');
      const outcome = await initSetup({ repository: dirs.artifacts, configDirectory: config, baseBranch: 'trial', hostHasUids: false });
      if (!outcome.ok) throw new Error(`R57 control: init refused a vitest repository: ${JSON.stringify(outcome)}`);
      const loaded = await loadPolicyFile(join(config, 'policy.yaml'));
      if (!loaded.ok) throw new Error(`R57 control: init's policy does not load: ${JSON.stringify(loaded)}`);
      const roles = Object.entries(loaded.policy.roles);
      const builder = loaded.policy.roles['builder' as RoleId];
      if (builder?.tools.includes('Bash') !== true) throw new Error(`R57: init's builder is granted ${JSON.stringify(builder?.tools)}, not Bash`);
      if (builder.network.egress !== 'none') throw new Error(`R57: init's builder, granted Bash, has egress ${JSON.stringify(builder.network.egress)}`);
      const others = roles.filter(([id, role]) => id !== 'builder' && role.tools.includes('Bash')).map(([id]) => id);
      if (others.length > 0) throw new Error(`R57: init grants Bash to ${others.join(', ')} as well as the builder`);
      const instructions = await readFile(join(config, 'roles', 'builder.md'), 'utf8');
      if (!instructions.includes('run the acceptance tests')) throw new Error("R57: init's builder role does not tell it to run the acceptance tests");
    });
  },
});

/** R57's assertions, by the invariant each holds. */
export const R57_I3: readonly LocalAssertion[] = [BUILD_TREE_HOLDS_THE_INSTALL, BUILDER_CACHE_IS_NOT_RECORDED];
export const R57_I4: readonly LocalAssertion[] = [INIT_GRANTS_BASH_TO_THE_BUILDER];
