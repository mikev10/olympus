/**
 * R34: what a tree declares to install, read from its root, and what each
 * declared installer reads of its lockfile. Each refusal names its cause.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashedLockfile, INSTALLERS, NPM_INSTALLER, PNPM_INSTALLER } from '@olympus-ai/adapters';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { lockedPackages, planInstall } from '../src/install.js';

const GRANTED = ['registry.npmjs.org'];
const HASH = `sha512-${'A'.repeat(86)}==`;
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'r34-plan-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function files(entries: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(entries)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), text);
  }
}

async function refusal(registries = GRANTED): Promise<string> {
  const plan = await planInstall(root, INSTALLERS, registries);
  if (plan.kind !== 'refused') throw new Error(`expected a refusal, got ${plan.kind}`);
  return plan.reason;
}

describe('planInstall (D-R34-04)', () => {
  test('a tree with no manifest and no lockfile has nothing to install, granted or not', async () => {
    await files({ 'hello.txt': 'x', 'node_modules/left/index.js': '' });
    expect(await planInstall(root, INSTALLERS, [])).toEqual({ kind: 'none' });
  });

  test('a manifest with no lockfile is refused, naming the manifest', async () => {
    await files({ 'package.json': '{}' });
    expect(await refusal()).toMatch(/package\.json and no lockfile/);
  });

  test('a lockfile with no registry granted is refused, naming the policy field (I4)', async () => {
    await files({ 'package.json': '{}', 'package-lock.json': hashedLockfile('x', ['node_modules/a']) });
    expect(await refusal([])).toMatch(/installRegistries is empty/);
  });

  test('several lockfiles, and an unsupported one, are refused, naming each', async () => {
    await files({ 'package.json': '{}', 'package-lock.json': hashedLockfile('x', []), 'yarn.lock': '' });
    expect(await refusal()).toMatch(/package-lock\.json and yarn\.lock/);
    await rm(join(root, 'package-lock.json'));
    expect(await refusal()).toMatch(/yarn\.lock is a lockfile no installer reads/);
  });

  test('a lockfile with a package it records no hash for is refused, naming the package', async () => {
    const lock = JSON.parse(hashedLockfile('x', ['node_modules/a', 'node_modules/b'])) as { packages: Record<string, Record<string, unknown>> };
    delete lock.packages['node_modules/b']?.integrity;
    await files({ 'package.json': '{}', 'package-lock.json': JSON.stringify(lock) });
    expect(await refusal()).toMatch(/node_modules\/b \(it records no integrity hash\)/);
  });

  test('a hashed lockfile with a registry granted is installed by its installer', async () => {
    await files({ 'package.json': '{}', 'package-lock.json': hashedLockfile('x', ['node_modules/a']) });
    const plan = await planInstall(root, INSTALLERS, GRANTED);
    expect(plan).toMatchObject({ kind: 'install', installer: NPM_INSTALLER, packages: [{ key: 'node_modules/a', integrity: HASH, unverifiable: null }] });
  });
});

describe('the installers read their lockfiles (D-R34-06)', () => {
  test('npm: a file or git dependency cannot be verified; a workspace link is refused (codex-1); a bundled package arrives inside its parent, whose tarball is hashed', () => {
    const read = lockedPackages(NPM_INSTALLER, JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'x' },
        'node_modules/ws': { resolved: 'packages/ws', link: true },
        'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.0.0.tgz', integrity: HASH },
        'node_modules/a/node_modules/inner': { inBundle: true },
        'node_modules/local': { resolved: 'file:local-1.0.0.tgz', integrity: HASH },
        'node_modules/git': { resolved: 'git+ssh://git@example.com/x.git#abc' },
      },
    }));
    expect(read).toEqual({
      ok: true,
      packages: [
        { key: 'node_modules/a', integrity: HASH, unverifiable: null },
        { key: 'node_modules/git', integrity: null, unverifiable: 'it records no integrity hash' },
        { key: 'node_modules/local', integrity: HASH, unverifiable: 'it resolves from file:local-1.0.0.tgz, not from a registry' },
        { key: 'node_modules/ws', integrity: null, unverifiable: 'it links to packages/ws in the tree, not a registry download' },
      ],
    });
  });

  test('npm: lockfile version 1, and a document that is not one, are refused rather than read as empty (I5)', () => {
    expect(lockedPackages(NPM_INSTALLER, JSON.stringify({ lockfileVersion: 1, dependencies: {} }))).toMatchObject({ ok: false, reason: expect.stringMatching(/version 1/) as unknown });
    expect(lockedPackages(NPM_INSTALLER, '{ not json')).toMatchObject({ ok: false });
    expect(lockedPackages(NPM_INSTALLER, JSON.stringify({ lockfileVersion: 3 }))).toMatchObject({ ok: false });
  });

  test('pnpm: a registry package is its integrity; a tarball, git, or directory resolution cannot be verified', () => {
    const read = lockedPackages(PNPM_INSTALLER, [
      "lockfileVersion: '9.0'",
      'packages:',
      '  a@1.0.0:',
      `    resolution: {integrity: ${HASH}}`,
      '  evil@file:evil-1.0.0.tgz:',
      `    resolution: {integrity: ${HASH}, tarball: file:evil-1.0.0.tgz}`,
      '  g@https://codeload.github.com/x/y/tar.gz/abc:',
      '    resolution: {tarball: https://codeload.github.com/x/y/tar.gz/abc}',
      '  r@git+https://example.com/r.git#abc:',
      '    resolution: {commit: abc, repo: https://example.com/r.git, type: git}',
      '',
    ].join('\n'));
    expect(read).toEqual({
      ok: true,
      packages: [
        { key: 'a@1.0.0', integrity: HASH, unverifiable: null },
        { key: 'evil@file:evil-1.0.0.tgz', integrity: HASH, unverifiable: 'it resolves from file:evil-1.0.0.tgz, not from a registry' },
        { key: 'g@https://codeload.github.com/x/y/tar.gz/abc', integrity: null, unverifiable: 'it records no integrity hash' },
        { key: 'r@git+https://example.com/r.git#abc', integrity: null, unverifiable: 'it is a git dependency, not a registry download' },
      ],
    });
  });

  test('pnpm: another lockfile version is refused; a lockfile with no packages pins none', () => {
    expect(lockedPackages(PNPM_INSTALLER, "lockfileVersion: '6.0'\n")).toMatchObject({ ok: false, reason: expect.stringMatching(/6\.0/) as unknown });
    expect(lockedPackages(PNPM_INSTALLER, "lockfileVersion: '9.0'\nimporters: {}\n")).toEqual({ ok: true, packages: [] });
  });

  test('neither installer runs a lifecycle script or reads a pnpmfile, and each names a failed hash (D-R34-02)', () => {
    expect(NPM_INSTALLER.invocation).toContain('--ignore-scripts');
    expect(NPM_INSTALLER.env.npm_config_ignore_scripts).toBe('true');
    expect(PNPM_INSTALLER.invocation).toEqual(expect.arrayContaining(['--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile']));
    expect([...NPM_INSTALLER.files, ...PNPM_INSTALLER.files]).not.toEqual(expect.arrayContaining(['.npmrc']));
    expect([...NPM_INSTALLER.files, ...PNPM_INSTALLER.files]).not.toEqual(expect.arrayContaining(['.pnpmfile.cjs']));
    expect(NPM_INSTALLER.failure('npm error code EINTEGRITY')).toMatch(/integrity hash/);
    expect(PNPM_INSTALLER.failure('ERR_PNPM_TARBALL_INTEGRITY')).toMatch(/integrity hash/);
  });
});

describe('no code from the tree is installed (external review, codex-1, codex-2, gemini-2)', () => {
  test('npm: a link entry, and a tree directory\'s entry, are refused whatever hash they carry', () => {
    const read = lockedPackages(NPM_INSTALLER, JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { name: 'x' }, 'node_modules/vitest': { resolved: 'judge', link: true }, judge: { name: 'vitest', version: '9.9.9', integrity: HASH } },
    }));
    expect(read).toEqual({
      ok: true,
      packages: [
        { key: 'judge', integrity: HASH, unverifiable: 'it is a directory of the tree, not a registry download' },
        { key: 'node_modules/vitest', integrity: null, unverifiable: 'it links to judge in the tree, not a registry download' },
      ],
    });
  });

  test('pnpm: an importer dependency on link: or file: is refused, naming it', () => {
    const read = lockedPackages(PNPM_INSTALLER, "lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      vitest:\n        specifier: workspace:*\n        version: link:judge\n      a:\n        specifier: 1.0.0\n        version: 1.0.0\n");
    expect(read).toEqual({ ok: true, packages: [{ key: '. > vitest', integrity: null, unverifiable: 'it is link:judge, a directory of the tree, not a registry download' }] });
  });

  test('pnpm: a lockfile that patches a package is refused, naming it', () => {
    const read = lockedPackages(PNPM_INSTALLER, `lockfileVersion: '9.0'\npatchedDependencies:\n  is-number@7.0.0:\n    hash: ${'a'.repeat(64)}\n    path: patches/package.json\n`);
    expect(read).toMatchObject({ ok: false, reason: expect.stringMatching(/patchedDependencies \(is-number@7\.0\.0\)/) as unknown });
  });
});
