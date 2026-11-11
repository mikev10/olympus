/**
 * The runtime's dependency install (R34). Before the base run and before any
 * check of a task, the runtime installs from the tree's lockfile in a sandbox
 * of its own, into a directory of the run's it owns, and replaces every
 * dependency tree the tree holds with that install. No seat runs it and none
 * writes its output: the runner a suite check starts is the install's, never
 * what a task wrote (I1, I3).
 *
 * The install's sandbox mounts a copy of the files the installer declares and
 * nothing else of the tree, reaches the registries policy grants and nothing
 * else (A-R34-01, I4), and runs no lifecycle script. Every package is verified
 * against the hash its lockfile records; a lockfile that records none, a
 * second lockfile, an unsupported one, or a manifest with none is refused,
 * naming it (I5). The install reaches the checks inside the tree they mount
 * read-only, since the sandbox refuses a mount nested in another (D-R34-03).
 */
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { UNSUPPORTED_LOCKFILES, VCS_DIRECTORIES, type DependencyInstaller, type LockedPackage } from '@olympus-ai/adapters';
import type { StationId, TaskId } from '@olympus-ai/core';
import type { SandboxHandle, SandboxSpec } from '@olympus-ai/sandbox';
import type { InstallRecord } from '@olympus-ai/vault';
import { parse as parseYaml } from 'yaml';
import { recordEgress } from './decisions.js';
import type { LineContext } from './line.js';
import { installPath, treeDigest } from './workspace.js';

/** An install's wall clock. A lockfile that takes longer is not installed and its checks do not start. */
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/** What a tree declares to install: nothing, an installer's lockfile, or a reason it cannot be installed. */
export type InstallPlan =
  | { readonly kind: 'none' }
  | { readonly kind: 'install'; readonly installer: DependencyInstaller; readonly lockfileText: string; readonly packages: readonly LockedPackage[] }
  | { readonly kind: 'refused'; readonly reason: string };

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() === true;
}

function sha256(bytes: string | Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A lockfile's packages, read by the installer from the document the runtime parsed (D-R34-07). */
export function lockedPackages(installer: DependencyInstaller, text: string): ReturnType<DependencyInstaller['packages']> {
  let document: unknown;
  try {
    document = installer.format === 'json' ? (JSON.parse(text) as unknown) : (parseYaml(text) as unknown);
  } catch (error) {
    return { ok: false, reason: `${installer.lockfile} is not ${installer.format === 'json' ? 'JSON' : 'YAML'}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return installer.packages(document);
}

/** At most this many packages are named in a refusal; the rest are counted. */
const NAMED = 5;

/**
 * What `tree` declares to install, read from its root alone (D-R34-04): one
 * lockfile an installer reads, with a registry granted and every package
 * hashed, or nothing to install when the root holds neither a lockfile nor a
 * manifest any installer reads. Anything else is a refusal naming what was
 * found.
 */
export async function planInstall(tree: string, installers: readonly DependencyInstaller[], registries: readonly string[]): Promise<InstallPlan> {
  const names = [...new Set([...installers.map((i) => i.lockfile), ...UNSUPPORTED_LOCKFILES])];
  const found: string[] = [];
  for (const name of names) if (await isFile(join(tree, name))) found.push(name);
  if (found.length > 1) return { kind: 'refused', reason: `the tree holds ${found.join(' and ')}; which one installs it is not decided` };
  const [lockfile] = found;
  if (lockfile === undefined) {
    const manifests = [...new Set(installers.map((i) => i.manifest))];
    for (const manifest of manifests) {
      if (await isFile(join(tree, manifest))) return { kind: 'refused', reason: `the tree holds ${manifest} and no lockfile, so its dependencies cannot be installed as pinned` };
    }
    return { kind: 'none' };
  }
  const installer = installers.find((i) => i.lockfile === lockfile);
  if (installer === undefined) return { kind: 'refused', reason: `${lockfile} is a lockfile no installer reads` };
  if (registries.length === 0) {
    return { kind: 'refused', reason: `the tree holds ${lockfile}, and policy grants no registry the install may reach (installRegistries is empty), so nothing is installed` };
  }
  const lockfileText = await readFile(join(tree, lockfile), 'utf8');
  const read = lockedPackages(installer, lockfileText);
  if (!read.ok) return { kind: 'refused', reason: read.reason };
  const unverifiable = read.packages.filter((p) => p.unverifiable !== null);
  if (unverifiable.length > 0) {
    const named = unverifiable.slice(0, NAMED).map((p) => `${p.key} (${p.unverifiable ?? ''})`).join('; ');
    const more = unverifiable.length > NAMED ? `; and ${String(unverifiable.length - NAMED)} more` : '';
    return { kind: 'refused', reason: `${lockfile} does not pin every package by a hash an install can verify: ${named}${more}` };
  }
  return { kind: 'install', installer, lockfileText, packages: read.packages };
}

/** Whether a directory name is one of the dependency trees `installers` write, in any case (D-R15-07). */
function treeNamer(installers: readonly DependencyInstaller[]): (name: string) => boolean {
  const names = new Set(installers.flatMap((i) => i.trees.map((t) => t.toLowerCase())));
  return (name) => names.has(name.toLowerCase());
}

/** Every dependency tree under `root`, by its path relative to it, outside VCS directories. Not entered. */
async function dependencyTrees(root: string, isTree: (name: string) => boolean, at = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(join(root, ...at.split('/').filter(Boolean)), { withFileTypes: true })) {
    if (!entry.isDirectory() || VCS_DIRECTORIES.has(entry.name)) continue;
    const path = at === '' ? entry.name : `${at}/${entry.name}`;
    if (isTree(entry.name)) out.push(path);
    else out.push(...(await dependencyTrees(root, isTree, path)));
  }
  return out;
}

/** Every file the installer reads that `tree` holds: its root files, and its nested manifest in every directory outside a dependency tree. */
async function inputFiles(tree: string, installer: DependencyInstaller, isTree: (name: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  for (const name of installer.files) if (await isFile(join(tree, name))) files.push(name);
  const nested = installer.nested;
  if (nested === null) return files;
  const walk = async (at: string): Promise<void> => {
    for (const entry of await readdir(join(tree, ...at.split('/')), { withFileTypes: true })) {
      if (!entry.isDirectory() || VCS_DIRECTORIES.has(entry.name) || isTree(entry.name)) continue;
      const path = at === '' ? entry.name : `${at}/${entry.name}`;
      if (await isFile(join(tree, path, nested))) files.push(`${path}/${nested}`);
      await walk(path);
    }
  };
  await walk('');
  return files.sort();
}

/** The lockfile's diff against the base's, by package key. A base lockfile that does not read is diffed as empty. */
function lockfileDiff(head: readonly LockedPackage[], base: readonly LockedPackage[]): InstallRecord['lockfileDiff'] {
  const before = new Map(base.map((p) => [p.key, p.integrity]));
  const after = new Map(head.map((p) => [p.key, p.integrity]));
  return {
    added: [...after.keys()].filter((k) => !before.has(k)).sort(),
    removed: [...before.keys()].filter((k) => !after.has(k)).sort(),
    changed: [...after.entries()].filter(([k, v]) => before.has(k) && before.get(k) !== v).map(([k]) => k).sort(),
  };
}

/** The digest of every dependency tree an install wrote, each by its path. */
async function installedDigest(dir: string, trees: readonly string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of trees) hash.update(`${path}\0${await treeDigest(join(dir, ...path.split('/')))}\n`);
  return hash.digest('hex');
}

/** Where an install the run already made keeps what it recorded, beside the trees it wrote. */
const RECORD = 'install.json';
const ROOT = 'root';

/** The outcome of installing into a tree: the record, nothing to install, or why its checks cannot start. */
export type InstallOutcome =
  | { readonly ok: true; readonly install: InstallRecord | null }
  | { readonly ok: false; readonly at: 'plan' | 'provision' | 'install'; readonly reason: string };

/**
 * Replaces every dependency tree in `tree` with the runtime's install of its
 * lockfile, made once per run for each set of inputs (D-R34-08). `tree` is a
 * tree the runtime built for checks to run over. A tree that declares
 * nothing to install keeps no dependency tree at all, so what the base
 * installed never decides a check (D-R34-04).
 */
export async function installInto(ctx: LineContext, tree: string, base: string, taskId: TaskId | null, station: StationId): Promise<InstallOutcome> {
  const { installers } = ctx.components;
  const isTree = treeNamer(installers);
  for (const path of await dependencyTrees(tree, isTree)) await rm(join(tree, ...path.split('/')), { recursive: true, force: true });
  const plan = await planInstall(tree, installers, ctx.policy.installRegistries);
  if (plan.kind === 'none') return { ok: true, install: null };
  if (plan.kind === 'refused') return { ok: false, at: 'plan', reason: `no dependency was installed: ${plan.reason}` };
  const { installer } = plan;

  const inputs = await inputFiles(tree, installer, isTree);
  const key = createHash('sha256');
  key.update(`${installer.stack}\0${installer.image}\0${JSON.stringify(installer.invocation)}\0${JSON.stringify(installer.env)}\n`);
  for (const path of inputs) key.update(`${path}\0${sha256(await readFile(join(tree, ...path.split('/'))))}\n`);
  const dir = installPath(ctx.components.workspaces, ctx.run.id, key.digest('hex'));

  let record: InstallRecord;
  if (await isFile(join(dir, RECORD))) {
    record = JSON.parse(await readFile(join(dir, RECORD), 'utf8')) as InstallRecord;
  } else {
    const made = await install(ctx, plan, inputs, tree, base, dir, taskId, station);
    if (!made.ok) return made;
    record = made.install;
  }
  for (const path of await dependencyTrees(join(dir, ROOT), isTree)) {
    await cp(join(dir, ROOT, ...path.split('/')), join(tree, ...path.split('/')), { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  }
  return { ok: true, install: record };
}

async function install(
  ctx: LineContext, plan: Extract<InstallPlan, { kind: 'install' }>, inputs: readonly string[], tree: string, base: string, dir: string, taskId: TaskId | null, station: StationId,
): Promise<{ ok: true; install: InstallRecord } | { ok: false; at: 'provision' | 'install'; reason: string }> {
  const { installer } = plan;
  const { sandbox, workspaces, profile, vault } = ctx.components;
  // Built beside its final place and renamed in, so two tasks installing the same inputs at once never share a directory.
  const building = `${dir}.${randomUUID()}`;
  const work = join(building, ROOT);
  await mkdir(work, { recursive: true, mode: 0o700 });
  for (const path of inputs) {
    const target = join(work, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(tree, ...path.split('/')), target);
  }
  const spec: SandboxSpec = {
    image: installer.image,
    mounts: { workspace: { source: work, target: '/workspace', mode: 'rw' }, others: [] },
    // The install's egress is the registries policy grants, and no other sandbox's is (A-R34-01).
    egress: { mode: 'allowlist', allow: [...ctx.policy.installRegistries] },
    limits: profile === null ? { cpus: 0, memoryMb: 0, pids: 0, wallClockMs: INSTALL_TIMEOUT_MS } : { ...profile.limits, wallClockMs: INSTALL_TIMEOUT_MS },
    user: { ...workspaces.user },
  };
  let handle: SandboxHandle;
  try {
    handle = await sandbox.provision(spec);
  } catch (error) {
    await rm(building, { recursive: true, force: true });
    return { ok: false, at: 'provision', reason: `the install's sandbox could not be provisioned: ${error instanceof Error ? error.message : String(error)}` };
  }
  let failed: string | undefined;
  try {
    const exec = await sandbox.exec(handle, [...installer.invocation], { env: { ...installer.env } });
    if (exec.exitCode !== 0) {
      const cause = installer.failure(`${exec.stdout}\n${exec.stderr}`) ?? `it exited ${String(exec.exitCode)}`;
      failed = `the install from ${installer.lockfile} failed: ${cause}`;
    }
  } catch (error) {
    failed = `the install from ${installer.lockfile} did not run: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    // Whatever the install's proxy decided is recorded, as every sandbox's is (D-P14-04).
    const { egress } = await sandbox.destroy(handle);
    await recordEgress({ vault, runId: ctx.run.id, taskId, station }, egress);
  }
  if (failed !== undefined) {
    await rm(building, { recursive: true, force: true });
    return { ok: false, at: 'install', reason: failed };
  }

  const trees = await dependencyTrees(work, treeNamer([installer]));
  const baseText = (await isFile(join(base, installer.lockfile))) ? await readFile(join(base, installer.lockfile), 'utf8') : null;
  const baseRead = baseText === null ? null : lockedPackages(installer, baseText);
  const record: InstallRecord = {
    stack: installer.stack,
    lockfile: installer.lockfile,
    image: installer.image,
    invocation: [...installer.invocation],
    lockfileSha256: sha256(plan.lockfileText),
    baseLockfileSha256: baseText === null ? null : sha256(baseText),
    lockfileDiff: lockfileDiff(plan.packages, baseRead?.ok === true ? baseRead.packages : []),
    installedTreeSha256: await installedDigest(work, trees),
    collectedBy: 'runtime',
  };
  await writeFile(join(building, RECORD), JSON.stringify(record));
  try {
    await rename(building, dir);
  } catch {
    // Another task installed the same inputs first; its install is the same lockfile's, so it is used.
    await rm(building, { recursive: true, force: true });
    if (!(await isFile(join(dir, RECORD)))) throw new Error(`install: ${dir} was neither made by this install nor by another`);
    return { ok: true, install: JSON.parse(await readFile(join(dir, RECORD), 'utf8')) as InstallRecord };
  }
  return { ok: true, install: record };
}
