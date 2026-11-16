/**
 * R34: the runtime installs a tree's dependencies from its lockfile before
 * any check runs, in a sandbox of its own whose egress is the registries
 * policy grants, and every check runs over that install with no egress.
 *
 * The rig's stand-in installer copies what a lockfile pins from the
 * fixture's own tree, offline (`standInNpmInstaller`); the base's own
 * `node_modules` is never what a check runs over. The lifecycle-script
 * assertion runs npm's declared invocation in its declared image, with no
 * network, against a dependency whose `postinstall` would leave a mark.
 */
import { execFile } from 'node:child_process';
import { lstat, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ExecOptions, ExecResult, SandboxCapabilities, SandboxHandle, SandboxProvider, SandboxSpec, Teardown } from '@olympus-ai/sandbox';
import type { BaseRunRecord, EvidenceBundle } from '@olympus-ai/vault';
import type { Driver, TaskRequest, TaskResult } from '@olympus-ai/core';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_TASK, linePolicy, readRecord, refusalOf, stubDriver, withLine, writeManifest, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');
const adapters = async () => import('@olympus-ai/adapters');
const docker = promisify(execFile);

/** Fails on a tree whose install does not hold `extra`, and passes on one that does. */
const NEEDS_EXTRA = { id: 'needs-extra', kind: 'behavioral', onBase: 'fails', command: ['node', '-e', "require('extra')"], required: true, timeoutMs: 10_000 };
const EXTRA = 'node_modules/extra';

/** Every file under `root`, by its path relative to it. */
async function listing(root: string, at = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, ...at.split('/').filter(Boolean)), { withFileTypes: true })) {
    const path = at === '' ? entry.name : `${at}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await listing(root, path)));
    else out.push(path);
  }
  return out.sort();
}

/**
 * The stub sandbox, recording each sandbox asked for and the files its
 * workspace held when it was provisioned; an exec in a sandbox of `scripted`'s
 * image is answered with its result instead of run.
 */
class Recording implements SandboxProvider {
  readonly id = 'recording-stub';
  readonly provisioned: Array<{ readonly spec: SandboxSpec; readonly listed: readonly string[] }> = [];
  readonly #scriptedHandles = new Set<SandboxHandle>();
  constructor(private readonly inner: SandboxProvider, private readonly scripted?: { readonly image: string; readonly result: ExecResult }) {}
  async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    this.provisioned.push({ spec, listed: await listing(spec.mounts.workspace.source) });
    const handle = await this.inner.provision(spec);
    if (spec.image === this.scripted?.image) this.#scriptedHandles.add(handle);
    return handle;
  }
  exec(h: SandboxHandle, cmd: string[], options?: ExecOptions): Promise<ExecResult> {
    if (this.#scriptedHandles.has(h) && this.scripted !== undefined) return Promise.resolve(this.scripted.result);
    return this.inner.exec(h, cmd, options);
  }
  destroy(h: SandboxHandle): Promise<Teardown> {
    return this.inner.destroy(h);
  }
  capabilities(): SandboxCapabilities {
    return this.inner.capabilities();
  }
}

async function recording(scripted?: { image: string; result: ExecResult }): Promise<Recording> {
  const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
  return new Recording(new StubSandboxProvider(), scripted);
}

/**
 * A base that declares dependencies: a manifest and `lockfile`, beside a
 * `.npmrc` and a `.pnpmfile.cjs` no install may read. The fixture's tree
 * also holds `extra` under `node_modules`, where the stand-in installs it
 * from, so a check that ran over the base's own trees would find it.
 */
async function withDependencies(rig: LineRig, lockfile: string): Promise<void> {
  const root = rig.dirs.artifacts;
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hello', private: true }));
  await writeFile(join(root, 'package-lock.json'), lockfile);
  await writeFile(join(root, '.npmrc'), 'registry=https://registry.example.invalid/\n');
  await writeFile(join(root, '.pnpmfile.cjs'), "require('node:fs').writeFileSync('/tmp/pnpmfile-ran', '')\n");
  await mkdir(join(root, EXTRA), { recursive: true });
  await writeFile(join(root, EXTRA, 'index.js'), "module.exports = 'extra';\n");
}

/** The rig's stub builder, made to write `files` into its tree as an agent would. */
async function writing(files: Readonly<Record<string, string>>, sandbox: SandboxProvider): Promise<Driver> {
  const driver = await stubDriver();
  return new Proxy(driver, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        if (req.role.role === 'builder') {
          const script = `const fs = require('node:fs'); for (const [f, t] of Object.entries(${JSON.stringify(files)})) fs.writeFileSync(f, t)`;
          const wrote = await sandbox.exec(req.sandbox, ['node', '-e', script]);
          if (wrote.exitCode !== 0) throw new Error(`the builder's write did not land: ${wrote.stderr}`);
        }
        return target.runTask(req);
      };
    },
  });
}

/** Runs the rig's change adding `extra` to the lockfile, and returns the sandboxes asked for and the task's last evidence. */
async function addingExtra(rig: LineRig): Promise<{ sandbox: Recording; bundle: EvidenceBundle | undefined; status: string | undefined; baseRecord: BaseRunRecord }> {
  const { startRun } = await api();
  const { hashedLockfile } = await adapters();
  await withDependencies(rig, hashedLockfile('hello', []));
  await writeManifest(rig.dirs, [NEEDS_EXTRA]);
  const sandbox = await recording();
  const driver = await writing({ 'package-lock.json': hashedLockfile('hello', [EXTRA]) }, sandbox);
  const components = await rig.components({ sandbox, driver, reviewer: driver }, { work: false });
  await startRun(await rig.request(components));
  const state = await rig.state();
  const bundles = await Promise.all(state.evidenceRefs.map((r) => readRecord<EvidenceBundle>(components.vault, r)));
  const baseRun = await components.vault.readBaseRun(rig.runId, null);
  if (baseRun === null) throw new Error('R34: the run wrote no base record');
  return { sandbox, bundle: bundles.at(-1), status: state.tasks[HELLO_TASK], baseRecord: await readRecord<BaseRunRecord>(components.vault, baseRun) };
}

export const INSTALL_ADDS_A_DEPENDENCY: LocalAssertion = runtime({
  id: 'I3.install-adds-a-dependency-the-base-lacks',
  title:
    "a change that adds a dependency the base lacks passes verify: the runtime installs the verified tree's lockfile before any check, the check that needs the dependency fails over the base's install and passes over the change's, the base's own node_modules decides nothing, and the evidence records the lockfile's diff by package and the installed tree's hash (R34)",
  run: async () => {
    await withLine('r34-adds-', async (rig) => {
      const { bundle, status, baseRecord } = await addingExtra(rig);
      const onBase = baseRecord.checks.find((c) => c.checkId === NEEDS_EXTRA.id);
      if (onBase?.exitCode === 0) throw new Error("R34: the check found extra on the base, whose lockfile does not pin it: it ran over the base's own node_modules");
      if (baseRecord.install?.lockfileDiff.added.length !== 0) throw new Error(`R34: the base record's install is ${JSON.stringify(baseRecord.install)}`);
      if (status !== 'passed') throw new Error(`R34: a change adding a dependency left the task ${String(status)}, not passed`);
      const judged = bundle?.checks.find((c) => c.checkId === NEEDS_EXTRA.id);
      const install = bundle?.install;
      if (judged?.exitCode !== 0 || install === null || install === undefined || JSON.stringify(install.lockfileDiff) !== JSON.stringify({ added: [EXTRA], removed: [], changed: [] })) {
        throw new Error(`R34: the change's evidence was ${JSON.stringify({ judged, install })}`);
      }
      if (install.lockfileSha256 === install.baseLockfileSha256 || !/^[0-9a-f]{64}$/.test(install.installedTreeSha256)) throw new Error(`R34: the install record does not name the change's lockfile and tree: ${JSON.stringify(install)}`);
    });
  },
});

export const INSTALL_SANDBOX_IS_ITS_OWN: LocalAssertion = runtime({
  id: 'I4.install-egress-is-the-granted-registries-alone',
  title:
    "the install's sandbox reaches the registries policy grants and nothing else, and mounts a copy of the files its installer reads, never the tree's .npmrc, .pnpmfile.cjs, or source; every check sandbox is read-only with no egress (R34, A-R34-01)",
  run: async () => {
    await withLine('r34-egress-', async (rig) => {
      const { sandbox } = await addingExtra(rig);
      const { STAND_IN_INSTALL_IMAGE } = await adapters();
      const installs = sandbox.provisioned.filter((p) => p.spec.image === STAND_IN_INSTALL_IMAGE);
      if (installs.length < 2) throw new Error(`R34: ${String(installs.length)} install sandboxes were provisioned, not one for the base and one for the change`);
      for (const { spec, listed } of installs) {
        if (spec.egress.mode !== 'allowlist' || JSON.stringify(spec.egress.allow) !== '["registry.npmjs.org"]') throw new Error(`R34: an install's egress was ${JSON.stringify(spec.egress)}`);
        if (JSON.stringify(listed) !== '["package-lock.json","package.json"]') throw new Error(`R34: an install's sandbox held ${JSON.stringify(listed)}`);
      }
      const checks = sandbox.provisioned.filter((p) => p.spec.image !== STAND_IN_INSTALL_IMAGE && p.spec.mounts.workspace.mode === 'ro');
      if (checks.length === 0) throw new Error('R34: no check sandbox was provisioned');
      for (const { spec } of checks) {
        if (spec.egress.mode !== 'deny-all' || spec.egress.allow.length !== 0) throw new Error(`R34: a check sandbox had egress ${JSON.stringify(spec.egress)}`);
      }
    });
  },
});

export const INSTALL_NEEDS_A_GRANT: LocalAssertion = runtime({
  id: 'I4.install-needs-a-granted-registry',
  title: 'a base that declares dependencies, under a policy that grants the install no registry, is refused at admission naming installRegistries, and no install sandbox is provisioned (R34, A-R34-01)',
  run: async () => {
    await withLine('r34-grant-', async (rig) => {
      const { startRun } = await api();
      const { hashedLockfile } = await adapters();
      await withDependencies(rig, hashedLockfile('hello', [EXTRA]));
      await writeManifest(rig.dirs, [NEEDS_EXTRA]);
      const sandbox = await recording();
      const components = await rig.components({ sandbox });
      const outcome = await startRun(await rig.request(components, { policy: await linePolicy({}, { installRegistries: [] }) }));
      const problems = !outcome.ok && outcome.reason === 'invalid-request' ? outcome.problems : [];
      if (!problems.some((p) => p.code === 'not-installable' && p.message.includes('installRegistries'))) throw new Error(`R34: an ungranted install was ${JSON.stringify(outcome)}`);
      if (sandbox.provisioned.length !== 0) throw new Error(`R34: ${String(sandbox.provisioned.length)} sandboxes were provisioned for a refused run`);
    });
  },
});

export const INSTALL_NEEDS_HASHES: LocalAssertion = runtime({
  id: 'I5.install-refuses-an-unhashed-lockfile',
  title: 'a lockfile that pins a package by no integrity hash, or from anywhere but a registry, is refused at admission naming the package, and so is a change whose lockfile does at verify: no check runs over a tree its install could not verify (R34)',
  run: async () => {
    const { startRun } = await api();
    const { hashedLockfile } = await adapters();
    const unhashed = (): string => {
      const lock = JSON.parse(hashedLockfile('hello', [EXTRA])) as { packages: Record<string, Record<string, unknown>> };
      delete lock.packages[EXTRA]?.integrity;
      return JSON.stringify(lock);
    };
    await withLine('r34-unhashed-', async (rig) => {
      await withDependencies(rig, unhashed());
      await writeManifest(rig.dirs, [NEEDS_EXTRA]);
      const outcome = await startRun(await rig.request(await rig.components()));
      const problems = !outcome.ok && outcome.reason === 'invalid-request' ? outcome.problems : [];
      if (!problems.some((p) => p.code === 'not-installable' && p.message.includes(`${EXTRA} (it records no integrity hash)`))) throw new Error(`R34: an unhashed lockfile was ${JSON.stringify(outcome)}`);
    });
    await withLine('r34-unhashed-head-', async (rig) => {
      await withDependencies(rig, hashedLockfile('hello', []));
      await writeManifest(rig.dirs, [NEEDS_EXTRA]);
      const sandbox = await recording();
      const driver = await writing({ 'package-lock.json': unhashed() }, sandbox);
      const components = await rig.components({ sandbox, driver, reviewer: driver }, { work: false });
      refusalOf(await startRun(await rig.request(components)), 'R34 unhashed head');
      const state = await rig.state();
      const bundle = (await Promise.all(state.evidenceRefs.map((r) => readRecord<EvidenceBundle>(components.vault, r)))).at(-1);
      const reason = bundle?.unstarted.find((u) => u.checkId === NEEDS_EXTRA.id)?.reason ?? '';
      if (state.tasks[HELLO_TASK] === 'passed' || !reason.includes('(it records no integrity hash)')) throw new Error(`R34: a change with an unhashed lockfile left the task ${String(state.tasks[HELLO_TASK])}, its check unstarted for '${reason}'`);
    });
  },
});


/** A package-lock.json that links `vitest` to a directory in the tree, as npm writes one for a `file:` directory, with an invented hash on the target's entry, which npm installs. */
const LINKED_RUNNER = JSON.stringify({
  name: 'hello', lockfileVersion: 3, requires: true,
  packages: { '': { name: 'hello', devDependencies: { vitest: 'file:./judge' } }, 'node_modules/vitest': { resolved: 'judge', link: true }, judge: { name: 'vitest', version: '9.9.9', integrity: `sha512-${'A'.repeat(86)}==` } },
});

/** A pnpm-lock.yaml whose importer links `vitest` to a workspace directory, and one that patches a registry package. */
const PNPM_LINKED = "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      vitest:\n        specifier: workspace:*\n        version: link:judge\n";
const PNPM_PATCHED = `lockfileVersion: '9.0'\npatchedDependencies:\n  is-number@7.0.0:\n    hash: ${'a'.repeat(64)}\n    path: patches/package.json\nimporters:\n  .:\n    dependencies:\n      is-number:\n        specifier: 7.0.0\n        version: 7.0.0(patch_hash=${'a'.repeat(64)})\npackages:\n  is-number@7.0.0:\n    resolution: {integrity: sha512-${'A'.repeat(86)}==}\n`;

/** The refusal admission gives `files` written into the rig's base, under `installers`. */
async function admissionOf(rig: LineRig, files: Readonly<Record<string, string>>, installers?: readonly unknown[]): Promise<string> {
  const { startRun } = await api();
  const root = rig.dirs.artifacts;
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'hello', private: true }));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(root, ...name.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...name.split('/')), text);
  }
  await writeManifest(rig.dirs, [NEEDS_EXTRA]);
  const components = await rig.components(installers === undefined ? {} : { installers: installers as never });
  const outcome = await startRun(await rig.request(components));
  const problems = !outcome.ok && outcome.reason === 'invalid-request' ? outcome.problems : [];
  return problems.filter((p) => p.code === 'not-installable').map((p) => p.message).join('\n');
}

export const INSTALL_REFUSES_TREE_CODE: LocalAssertion = runtime({
  id: 'I3.install-installs-no-code-from-the-tree',
  title:
    "an install never puts code the change can write where a check loads a dependency: a lockfile that links a package to a directory in the tree (npm's link entry, pnpm's link: importer), or patches a registry package (pnpm's patchedDependencies), is refused naming it; an install that writes a link resolving outside its own dependency trees is refused; and a node_modules the base holds as a link is removed like any other (R34, external review codex-1, codex-2, gemini-1, gemini-2)",
  run: async () => {
    const { PNPM_INSTALLER } = await adapters();
    await withLine('r34-npmlink-', async (rig) => {
      const refused = await admissionOf(rig, { 'package-lock.json': LINKED_RUNNER, 'judge/package.json': '{"name":"vitest","version":"9.9.9"}' });
      if (!refused.includes('node_modules/vitest')) throw new Error(`R34: a lockfile linking the runner into the tree was admitted: '${refused}'`);
    });
    await withLine('r34-pnpmlink-', async (rig) => {
      const refused = await admissionOf(rig, { 'pnpm-lock.yaml': PNPM_LINKED }, [PNPM_INSTALLER]);
      if (!refused.includes('link:judge')) throw new Error(`R34: a pnpm importer linking the runner into the tree was admitted: '${refused}'`);
    });
    await withLine('r34-patched-', async (rig) => {
      const refused = await admissionOf(rig, { 'pnpm-lock.yaml': PNPM_PATCHED }, [PNPM_INSTALLER]);
      if (!refused.includes('patchedDependencies')) throw new Error(`R34: a pnpm lockfile that patches a package was admitted: '${refused}'`);
    });
    // An installer that writes a link out of its trees, as a link entry a reader missed would: the install is refused at the base run.
    await withLine('r34-escape-', async (rig) => {
      const { startRun } = await api();
      const { hashedLockfile, standInNpmInstaller } = await adapters();
      await withDependencies(rig, hashedLockfile('hello', [EXTRA]));
      await writeManifest(rig.dirs, [NEEDS_EXTRA]);
      const linking = standInNpmInstaller(rig.dirs.artifacts);
      const script = `${linking.steps[0].at(-1) ?? ''}\nrequire('node:fs').symlinkSync('../judge', 'node_modules/escape', 'dir');`;
      const components = await rig.components({ installers: [{ ...linking, steps: [['node', '-e', script]] }] });
      refusalOf(await startRun(await rig.request(components)), 'R34 escape');
      const baseRun = await components.vault.readBaseRun(rig.runId, null);
      const record = baseRun === null ? null : await readRecord<BaseRunRecord>(components.vault, baseRun);
      const reason = record?.unstarted.find((u) => u.checkId === NEEDS_EXTRA.id)?.reason ?? '';
      if (!reason.includes('node_modules/escape')) throw new Error(`R34: an install that linked out of its trees was ${JSON.stringify(record)}`);
    });
    // A base that holds node_modules as a link: it is removed from the tree the checks run over, as a directory is.
    await withLine('r34-baselink-', async (rig) => {
      const { startRun } = await api();
      const { hashedLockfile } = await adapters();
      await withDependencies(rig, hashedLockfile('hello', []));
      await mkdir(join(rig.dirs.artifacts, 'vendor', 'extra'), { recursive: true });
      await writeFile(join(rig.dirs.artifacts, 'vendor', 'extra', 'index.js'), "module.exports = 'vendored';\n");
      await mkdir(join(rig.dirs.artifacts, 'sub'), { recursive: true });
      await symlink(join('..', 'vendor'), join(rig.dirs.artifacts, 'sub', 'node_modules'), 'dir');
      await writeManifest(rig.dirs, [NEEDS_EXTRA]);
      await startRun(await rig.request(await rig.components()));
      const ranOver = join(rig.workspaces.root, rig.runId, 'base-run');
      if ((await lstat(join(ranOver, 'package.json')).catch(() => null)) === null) throw new Error(`R34: the base run left no tree at ${ranOver}, so the case shows nothing`);
      if ((await lstat(join(ranOver, 'sub', 'node_modules')).catch(() => null)) !== null) throw new Error("R34: the base's linked node_modules survived into the tree the checks ran over");
    });
  },
});

export const INSTALL_FAILING_A_HASH_REFUSES: LocalAssertion = runtime({
  id: 'I5.install-refuses-a-package-failing-its-hash',
  title: "an install whose package fails the hash its lockfile records starts no check: npm's declared install, run in its pinned image with no network, refuses a tarball whose bytes are not its lockfile's hash and installs the same lockfile with the true one, and its failure is named as the failed hash; an install failing that way leaves each check unstarted naming it, and the test-design exit is refused before any driver runs (R34, external review codex-3)",
  run: async () => {
    await withLine('r34-hashfail-', async (rig) => {
      const { startRun } = await api();
      const { hashedLockfile, NPM_INSTALLER } = await adapters();
      await withDependencies(rig, hashedLockfile('hello', [EXTRA]));
      await writeManifest(rig.dirs, [NEEDS_EXTRA]);
      const failed: ExecResult = { exitCode: 1, stdout: '', stderr: `npm error code EINTEGRITY\nnpm error sha512-${'B'.repeat(86)}== integrity checksum failed when using sha512\n`, durationMs: 1 };
      const sandbox = await recording({ image: NPM_INSTALLER.image, result: failed });
      const driver = await stubDriver();
      const components = await rig.components({ sandbox, driver, reviewer: driver, installers: [NPM_INSTALLER] });
      const refusal = refusalOf(await startRun(await rig.request(components)), 'R34 hash');
      if (refusal.at !== 'test-design' || driver.requests.length !== 0) throw new Error(`R34: a failed install stopped the run at ${refusal.at} after ${String(driver.requests.length)} driver calls`);
      const baseRun = await components.vault.readBaseRun(rig.runId, null);
      const record = baseRun === null ? null : await readRecord<BaseRunRecord>(components.vault, baseRun);
      const reason = record?.unstarted.find((u) => u.checkId === NEEDS_EXTRA.id)?.reason ?? '';
      if (!reason.includes('a package failed the integrity hash its lockfile records')) throw new Error(`R34: the check over a failed install was ${JSON.stringify(record)}`);
      if (record?.checks.some((c) => c.checkId === NEEDS_EXTRA.id) === true) throw new Error('R34: a check ran over a tree whose install failed');
    });
    // npm itself, in its pinned image with no network, refuses a package whose bytes are not its lockfile's hash,
    // and the declaration names that cause; the same lockfile with the true hash installs (external review, codex-3).
    const { NPM_INSTALLER: npm } = await adapters();
    const intact = await integrityProbe(npm.image, npm.steps[0], npm.env, false);
    if (intact.exit !== 0) throw new Error(`R34: npm's declared install failed over an intact lockfile: ${intact.output}`);
    const tampered = await integrityProbe(npm.image, npm.steps[0], npm.env, true);
    if (tampered.exit === 0 || npm.failure(tampered.output) !== 'a package failed the integrity hash its lockfile records') {
      throw new Error(`R34: npm's declared install over a tampered hash exited ${String(tampered.exit)}: ${tampered.output}`);
    }
  },
});

/**
 * Runs `argv` with `env` in `image`, with no network, in a project whose one
 * dependency is a local tarball with a `postinstall`; true when the script
 * left its mark. Everything is made inside the container: no host path is
 * mounted.
 */
async function postinstallRan(image: string, argv: readonly string[], env: Readonly<Record<string, string>>): Promise<boolean> {
  const setup = [
    'set -e',
    'mkdir -p /tmp/dep /tmp/p && cd /tmp/dep',
    `echo '{"name":"dep","version":"1.0.0","scripts":{"postinstall":"touch /tmp/ran"}}' > package.json`,
    'npm pack --silent >/dev/null && mv dep-1.0.0.tgz /tmp/p/ && cd /tmp/p',
    `echo '{"name":"p","version":"1.0.0","dependencies":{"dep":"file:dep-1.0.0.tgz"}}' > package.json`,
    'npm install --package-lock-only --ignore-scripts --offline --silent >/dev/null',
    '"$@" >/dev/null 2>&1 || { echo install-failed; exit 3; }',
    'if [ -e /tmp/ran ]; then echo ran; else echo clean; fi',
  ].join('\n');
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const { stdout } = await docker('docker', ['run', '--rm', '--network', 'none', ...envArgs, image, 'sh', '-c', setup, 'sh', ...argv]);
  const said = stdout.trim().split('\n').at(-1);
  if (said !== 'ran' && said !== 'clean') throw new Error(`R34: the lifecycle probe said ${stdout}`);
  return said === 'ran';
}


/**
 * Runs `argv` with `env` in `image`, with no network, over a lockfile pinning
 * one local tarball by its true hash, or by one changed character; returns
 * the install's exit and output. Nothing on the host is mounted.
 */
async function integrityProbe(image: string, argv: readonly string[], env: Readonly<Record<string, string>>, tamper: boolean): Promise<{ exit: number; output: string }> {
  const setup = [
    'set -e',
    'mkdir -p /tmp/dep /tmp/p && cd /tmp/dep',
    `echo '{"name":"dep","version":"1.0.0"}' > package.json`,
    'npm pack --silent >/dev/null && mv dep-1.0.0.tgz /tmp/p/ && cd /tmp/p',
    `echo '{"name":"p","version":"1.0.0","dependencies":{"dep":"file:dep-1.0.0.tgz"}}' > package.json`,
    'npm install --package-lock-only --ignore-scripts --offline --silent >/dev/null',
    ...(tamper ? [`node -e "const f='package-lock.json';const l=JSON.parse(require('fs').readFileSync(f));const p=l.packages['node_modules/dep'];const c=p.integrity.charAt(10);p.integrity=p.integrity.slice(0,10)+(c==='A'?'B':'A')+p.integrity.slice(11);require('fs').writeFileSync(f,JSON.stringify(l))"`] : []),
    'set +e; "$@" > /tmp/out 2>&1; code=$?; cat /tmp/out; echo "exit=$code"',
  ].join('\n');
  const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const { stdout } = await docker('docker', ['run', '--rm', '--network', 'none', ...envArgs, image, 'sh', '-c', setup, 'sh', ...argv]);
  const match = /exit=(\d+)\s*$/u.exec(stdout);
  if (match?.[1] === undefined) throw new Error(`R34: the integrity probe printed no exit: ${stdout}`);
  return { exit: Number(match[1]), output: stdout };
}
export const INSTALL_RUNS_NO_SCRIPT: LocalAssertion = runtime({
  id: 'I3.install-runs-no-lifecycle-script',
  title:
    "npm's declared install, run with its declared arguments and environment in its pinned image, leaves a dependency's postinstall unrun, where the same install without them runs it; pnpm's declaration disables scripts and its pnpmfile, which pnpm runs despite --ignore-scripts, and neither installer reads a .npmrc or a pnpmfile from the tree (R34, D-R34-02)",
  run: async () => {
    const { NPM_INSTALLER, PNPM_INSTALLER } = await adapters();
    if (await postinstallRan(NPM_INSTALLER.image, NPM_INSTALLER.steps[0], NPM_INSTALLER.env)) throw new Error("R34: npm's declared install ran a dependency's postinstall");
    // The probe can see a script run: without the flag and the environment, npm runs it.
    const bare = NPM_INSTALLER.steps[0].filter((a) => a !== '--ignore-scripts');
    if (!(await postinstallRan(NPM_INSTALLER.image, bare, { HOME: '/tmp' }))) throw new Error('R34: the probe did not see a postinstall run without --ignore-scripts, so it proves nothing');
    for (const flag of ['--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile']) {
      if (!PNPM_INSTALLER.steps[0].includes(flag)) throw new Error(`R34: pnpm's install does not pass ${flag}`);
    }
    for (const installer of [NPM_INSTALLER, PNPM_INSTALLER]) {
      const read = [...installer.files, ...(installer.nested === null ? [] : [installer.nested])];
      if (read.some((f) => f === '.npmrc' || f.startsWith('.pnpmfile'))) throw new Error(`R34: ${installer.stack}'s install reads ${read.join(', ')}`);
      if (installer.env.npm_config_ignore_scripts !== 'true') throw new Error(`R34: ${installer.stack}'s install environment does not disable scripts`);
    }
  },
});

/** R34's assertions, by the invariant each holds. */
export const R34_I3: readonly LocalAssertion[] = [INSTALL_ADDS_A_DEPENDENCY, INSTALL_RUNS_NO_SCRIPT, INSTALL_REFUSES_TREE_CODE];
export const R34_I4: readonly LocalAssertion[] = [INSTALL_NEEDS_A_GRANT, INSTALL_SANDBOX_IS_ITS_OWN];
export const R34_I5: readonly LocalAssertion[] = [INSTALL_NEEDS_HASHES, INSTALL_FAILING_A_HASH_REFUSES];

