/**
 * The harness lockfile's shape, checked before any build (R53), and a pull
 * that only a digest-pinned reference may ask for. Neither needs Docker.
 */
import { describe, expect, test } from 'vitest';
import { harnessLockProblems, imageId, SandboxRefusal } from '../src/index.js';

const CLI = { name: '@vendor/cli', version: '1.2.3' };
const HASH = `sha512-${'A'.repeat(86)}==`;

function manifest(): unknown {
  return { name: 'factory-cli-image', private: true, dependencies: { [CLI.name]: CLI.version } };
}

function lock(overrides: Record<string, unknown> = {}): { lockfileVersion: number; packages: Record<string, unknown> } {
  return {
    lockfileVersion: 3,
    packages: {
      '': { name: 'factory-cli-image', dependencies: { [CLI.name]: CLI.version } },
      [`node_modules/${CLI.name}`]: { version: CLI.version, resolved: 'https://registry.npmjs.org/@vendor/cli/-/cli-1.2.3.tgz', integrity: HASH },
      [`node_modules/${CLI.name}-linux-x64`]: {
        version: CLI.version, resolved: 'https://registry.npmjs.org/@vendor/cli-linux-x64/-/cli-linux-x64-1.2.3.tgz', integrity: HASH, optional: true, os: ['linux'], cpu: ['x64'],
      },
      ...overrides,
    },
  };
}

describe('a harness lockfile pins its CLI by content (R53)', () => {
  test('a lockfile pinning every package by sha512 from the registry, at the CLI version, has no problem', () => {
    expect(harnessLockProblems(manifest(), lock(), CLI)).toEqual([]);
  });

  test('an entry with no sha512 integrity, another hash, or none at all, is refused by name', () => {
    const entry = lock().packages[`node_modules/${CLI.name}-linux-x64`] as Record<string, unknown>;
    for (const integrity of [undefined, `sha1-${'A'.repeat(27)}=`, 'sha512-short', '']) {
      const problems = harnessLockProblems(manifest(), lock({ [`node_modules/${CLI.name}-linux-x64`]: { ...entry, integrity } }), CLI);
      expect(problems.join('\n')).toContain(`node_modules/${CLI.name}-linux-x64 carries no sha512 integrity`);
    }
  });

  test('an entry resolved from anywhere but the registry, or linked to a directory, is refused', () => {
    const entry = lock().packages[`node_modules/${CLI.name}`] as Record<string, unknown>;
    expect(harnessLockProblems(manifest(), lock({ [`node_modules/${CLI.name}`]: { ...entry, resolved: 'https://registry.example/cli-1.2.3.tgz' } }), CLI).join('\n')).toMatch(/resolves from/);
    expect(harnessLockProblems(manifest(), lock({ [`node_modules/${CLI.name}`]: { ...entry, resolved: 'file:../cli' } }), CLI).join('\n')).toMatch(/resolves from/);
    expect(harnessLockProblems(manifest(), lock({ [`node_modules/${CLI.name}`]: { ...entry, link: true } }), CLI).join('\n')).toMatch(/is a link/);
  });

  test('a lockfile or manifest naming another version of the CLI, or another dependency, is refused', () => {
    const entry = lock().packages[`node_modules/${CLI.name}`] as Record<string, unknown>;
    expect(harnessLockProblems(manifest(), lock({ [`node_modules/${CLI.name}`]: { ...entry, version: '1.2.4' } }), CLI).join('\n')).toMatch(/locks @vendor\/cli at 1\.2\.4, not 1\.2\.3/);
    expect(harnessLockProblems({ dependencies: { [CLI.name]: '^1.2.3' } }, lock(), CLI).join('\n')).toMatch(/package\.json does not depend/);
    expect(harnessLockProblems({ dependencies: { [CLI.name]: CLI.version, other: '1.0.0' } }, lock(), CLI).join('\n')).toMatch(/package\.json does not depend/);
    expect(harnessLockProblems(manifest(), lock({ '': { dependencies: { [CLI.name]: '1.2.4' } } }), CLI).join('\n')).toMatch(/root does not depend/);
    expect(harnessLockProblems(manifest(), { lockfileVersion: 2, packages: {} }, CLI).join('\n')).toMatch(/version 3 lockfile/);
  });
});

describe('imageId pulls only a reference pinned by digest (R53)', () => {
  test('a pull by tag is refused before the engine is asked', async () => {
    // An executable that does not exist: a refusal that reached the engine would say the daemon could not be reached.
    const refused = await imageId('node:22', { pull: true, executable: 'no-such-docker-r53' }).then(() => null, (error: unknown) => error);
    expect(refused).toBeInstanceOf(SandboxRefusal);
    expect((refused as Error).message).toMatch(/not pinned by digest/);
  });
});
