/**
 * R36b: `init` writes a setup admission accepts, and refuses what it cannot
 * back; the host refuses a missing container user where it needs one. Each
 * assertion fails when its check is deleted (I8). The paid half, `init`'s
 * output through the real driver to a merged pull request, is in
 * `packages/api/test/paid/`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InitOutcome, RunRequest } from '@olympus-ai/api';
import { runtime } from '../kit/assert.js';
import { commitFixture } from '../kit/git.js';
import type { LocalAssertion } from '../kit/types.js';
import { workspaceRoot } from '../kit/workspace.js';
import { exampleGraph } from './first-run.js';
import { withVaultDirs } from './local-vault.js';

const api = async () => import('@olympus-ai/api');

/** A small TypeScript repository with vitest 4 and a hashed lockfile: the calc corpus repository's own product files. */
export async function vitestRepository(dir: string): Promise<void> {
  const calc = join(workspaceRoot(), 'corpus', 'v1', 'repos', 'calc');
  await mkdir(join(dir, 'test'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) await cp(join(calc, file), join(dir, file));
  await cp(join(calc, 'src'), join(dir, 'src'), { recursive: true });
  await cp(join(calc, 'test', 'math.test.ts'), join(dir, 'test', 'math.test.ts'));
}

/** The repository as a user's clone: committed, with a GitHub origin. */
function asClone(dir: string): string {
  const commit = commitFixture(dir);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/example/calc.git'], { stdio: 'ignore' });
  return commit;
}

async function init(repository: string, configDirectory: string, hostHasUids = true): Promise<InitOutcome> {
  const { initSetup } = await api();
  return initSetup({ repository, configDirectory, baseBranch: 'trial', hostHasUids });
}

export const INIT_SETUP_ADMITTED: LocalAssertion = runtime({
  id: 'I5.init-setup-admitted',
  title:
    "init on a TypeScript repository with vitest writes a policy, roles, rubrics, a host environment file the host's start-up checks accept, and a manifest and graph under .factory/ that admission accepts for a run drafting its spec and tests, with the Claude Code driver in every seat: the only answer left is the cost to approve; and the policy, roles, and rubrics are outside the repository (R36b)",
  run: async () => {
    const { checkStartup, loadPolicyFile, mergeEnvFile, startRun } = await api();
    await withVaultDirs('r36b-init-', async (dirs, base) => {
      await vitestRepository(dirs.artifacts);
      const baseCommit = asClone(dirs.artifacts);
      const config = join(base, 'config');
      const outcome = await init(dirs.artifacts, config, false);
      if (!outcome.ok) throw new Error(`R36b: init refused a vitest repository: ${JSON.stringify(outcome)}`);
      if (outcome.stack !== 'vitest@4') throw new Error(`R36b: init detected ${outcome.stack}, not vitest@4`);
      if (outcome.written.some((f) => f.startsWith(dirs.artifacts) && !f.includes('.factory'))) throw new Error('R36b: init wrote outside .factory/ in the repository');
      for (const f of ['policy.yaml', 'host.env', join('roles', 'builder.md'), join('rubrics', 'spec.md')]) {
        if (!existsSync(join(config, f))) throw new Error(`R36b: init wrote no ${f} in the configuration directory`);
      }
      // The host's own start-up checks, over the file and the two values set by hand.
      const text = await readFile(outcome.envFile, 'utf8');
      const merged = mergeEnvFile(outcome.envFile, text, { ANTHROPIC_API_KEY: 'sk-ant-by-hand', FACTORY_GIT_TOKEN: 'git-token-by-hand' });
      if (!merged.ok) throw new Error(`R36b: the host refuses init's environment file: ${merged.problems.join('; ')}`);
      const startup = await checkStartup(merged.env, undefined, { uids: false });
      if (!startup.ok) throw new Error(`R36b: the host's start-up refuses init's configuration: ${startup.problems.join('; ')}`);
      if (startup.settings.repository !== dirs.artifacts && startup.settings.repository.toLowerCase() !== dirs.artifacts.toLowerCase()) {
        throw new Error(`R36b: the environment file admits ${startup.settings.repository}, not the repository`);
      }
      const loaded = await loadPolicyFile(startup.settings.policyFile);
      if (!loaded.ok) throw new Error(`R36b: init's policy does not load: ${JSON.stringify(loaded)}`);
      const req: RunRequest = {
        runId: 'r36b-init' as RunRequest['runId'],
        baseCommit, requestedLevel: 1, workspace: dirs.artifacts, policy: loaded.policy,
        roles: startup.settings.rolesDirectory, rubrics: startup.settings.rubricsDirectory,
        components: await exampleGraph(dirs, base), approvedCostUsd: null,
        intent: { text: 'Add a multiply(a, b) function to src/math.ts that returns the product.', from: 'principal' },
        artifacts: { spec: 'draft', acceptanceTests: 'draft', verificationManifest: '.factory/verify.json', taskGraph: '.factory/graph.json' },
      };
      const admitted = await startRun(req);
      if (admitted.ok || admitted.reason !== 'cost-unapproved') throw new Error(`R36b: a run from init's files was answered ${JSON.stringify(admitted)}, not with the cost to approve`);
    });
  },
});

export const INIT_REFUSES_UNSUPPORTED_STACK: LocalAssertion = runtime({
  id: 'I5.init-refuses-an-unsupported-stack',
  title:
    "init refuses a repository the adapter detector finds no supported stack in — no package.json or Python manifest, and one declaring both vitest and jest — naming what it found, and writes no file (I5, R36b)",
  run: async () => {
    await withVaultDirs('r36b-unsupported-', async (dirs, base) => {
      await writeFile(join(dirs.artifacts, 'README.md'), 'no stack here\n');
      asClone(dirs.artifacts);
      const config = join(base, 'config');
      const none = await init(dirs.artifacts, config);
      if (none.ok || none.reason !== 'unsupported-stack' || !none.message.includes('package.json')) {
        throw new Error(`R36b: a repository with no stack was answered ${JSON.stringify(none)}, not refused naming what was found`);
      }
      if (existsSync(join(config, 'policy.yaml')) || existsSync(join(dirs.artifacts, '.factory'))) throw new Error('R36b: init wrote files for a stack it refused');
    });
    await withVaultDirs('r36b-ambiguous-', async (dirs, base) => {
      await vitestRepository(dirs.artifacts);
      const manifest = JSON.parse(await readFile(join(dirs.artifacts, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
      manifest.devDependencies.jest = '29.7.0';
      await writeFile(join(dirs.artifacts, 'package.json'), JSON.stringify(manifest));
      asClone(dirs.artifacts);
      const both = await init(dirs.artifacts, join(base, 'config'));
      if (both.ok || both.reason !== 'unsupported-stack' || !both.message.includes('vitest') || !both.message.includes('jest')) {
        throw new Error(`R36b: a repository declaring vitest and jest was answered ${JSON.stringify(both)}, not refused naming both`);
      }
    });
  },
});

export const INIT_REFUSES_TO_OVERWRITE: LocalAssertion = runtime({
  id: 'I5.init-refuses-to-overwrite',
  title:
    "init refuses when any file it would write exists — a .factory/graph.json in the repository — naming it, and writes nothing else: no policy, no environment file, and the existing file keeps its bytes (I5, R36b)",
  run: async () => {
    await withVaultDirs('r36b-exists-', async (dirs, base) => {
      await vitestRepository(dirs.artifacts);
      asClone(dirs.artifacts);
      await mkdir(join(dirs.artifacts, '.factory'), { recursive: true });
      await writeFile(join(dirs.artifacts, '.factory', 'graph.json'), 'mine\n');
      const config = join(base, 'config');
      const outcome = await init(dirs.artifacts, config);
      if (outcome.ok || outcome.reason !== 'exists' || !outcome.message.includes('graph.json')) {
        throw new Error(`R36b: an existing graph.json was answered ${JSON.stringify(outcome)}, not refused`);
      }
      if (existsSync(join(config, 'policy.yaml')) || existsSync(join(config, 'host.env')) || existsSync(join(dirs.artifacts, '.factory', 'verify.json'))) {
        throw new Error('R36b: init refused but wrote other files');
      }
      if ((await readFile(join(dirs.artifacts, '.factory', 'graph.json'), 'utf8')) !== 'mine\n') throw new Error('R36b: init overwrote the existing graph.json');
    });
  },
});

export const HOST_REFUSES_MISSING_CONTAINER_USER: LocalAssertion = runtime({
  id: 'I5.host-refuses-a-missing-container-user-without-uids',
  title:
    "on a host with no uids, such as native Windows, start-up lists FACTORY_CONTAINER_UID and FACTORY_CONTAINER_GID unset among its problems before it listens, rather than failing when it composes; on a host with uids the same environment is not refused for them (#136)",
  run: async () => {
    const { readHostConfig } = await api();
    const env = {
      FACTORY_API_TOKEN: 'x'.repeat(40), FACTORY_LISTEN_PORT: '7300', FACTORY_POLICY_FILE: '/p.yaml', FACTORY_ROLES_DIR: '/roles',
      FACTORY_VAULT_STORE: '/vault', FACTORY_REPOSITORY: '/repo', FACTORY_TREES: '/trees', ANTHROPIC_API_KEY: 'k',
      FACTORY_GIT_REPOSITORY: 'o/n', FACTORY_GIT_BASE_BRANCH: 'b', FACTORY_GIT_TOKEN: 't',
    };
    const without = readHostConfig(env, { uids: false });
    if (without.ok || !without.problems.some((p) => p.includes('FACTORY_CONTAINER_UID') && p.includes('no uids'))) {
      throw new Error(`R36b: a host with no uids and no container user was answered ${JSON.stringify(without)}`);
    }
    const withUids = readHostConfig(env, { uids: true });
    if (!withUids.ok) throw new Error(`R36b control: the same environment on a host with uids was refused: ${withUids.problems.join('; ')}`);
    const given = readHostConfig({ ...env, FACTORY_CONTAINER_UID: '1000', FACTORY_CONTAINER_GID: '1000' }, { uids: false });
    if (!given.ok) throw new Error(`R36b control: a host with no uids and both set was refused: ${given.problems.join('; ')}`);
  },
});

export const R36B_I5: readonly LocalAssertion[] = [INIT_SETUP_ADMITTED, INIT_REFUSES_UNSUPPORTED_STACK, INIT_REFUSES_TO_OVERWRITE, HOST_REFUSES_MISSING_CONTAINER_USER];
