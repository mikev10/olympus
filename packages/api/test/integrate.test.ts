import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { baseMismatches, GitHubIntegrator, gitBlobSha, reachesRemote } from '../src/index.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'integrate-'));
  await writeFile(join(root, 'hello.txt'), 'hello\n');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('gitBlobSha', () => {
  test('is the sha git gives a blob of the same bytes', () => {
    // `printf 'hello\n' | git hash-object --stdin`
    expect(gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});

describe('baseMismatches', () => {
  const hello = { path: 'hello.txt', mode: '100644', type: 'blob', sha: 'ce013625030ba8dba906f756967f9e9ca394464a' };

  test('a tracked file with the same bytes matches; a directory entry is not compared', async () => {
    expect(await baseMismatches(root, [hello, { path: 'src', mode: '040000', type: 'tree', sha: '0'.repeat(40) }])).toEqual([]);
  });

  test('a tracked file that differs, is absent, or is a submodule is named (D-I1b-03)', async () => {
    const problems = await baseMismatches(root, [
      { ...hello, sha: '1'.repeat(40) },
      { ...hello, path: 'absent.txt' },
      { path: 'vendor', mode: '160000', type: 'commit', sha: '2'.repeat(40) },
    ]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/hello\.txt differs/);
    expect(problems[1]).toMatch(/absent\.txt is tracked/);
    expect(problems[2]).toMatch(/vendor is a commit/);
  });

  test.skipIf(process.platform === 'win32')('a symlink is compared by its target, as git stores it', async () => {
    await symlink('hello.txt', join(root, 'link'));
    expect(await baseMismatches(root, [{ path: 'link', mode: '120000', type: 'blob', sha: gitBlobSha(new TextEncoder().encode('hello.txt')) }])).toEqual([]);
  });
});

describe('reachesRemote', () => {
  test('the remote domain and every host under it reach the remote; a lookalike does not (D-I1b-05)', () => {
    const domains = ['github.com', 'githubusercontent.com'];
    expect(reachesRemote('github.com', domains)).toBe(true);
    expect(reachesRemote('API.GitHub.com.', domains)).toBe(true);
    expect(reachesRemote('objects.githubusercontent.com', domains)).toBe(true);
    expect(reachesRemote('notgithub.com', domains)).toBe(false);
    expect(reachesRemote('registry.npmjs.org', domains)).toBe(false);
  });
});

describe('GitHubIntegrator', () => {
  test('refuses a repository that is not owner/name, and an empty token', () => {
    expect(() => new GitHubIntegrator({ repository: 'no-owner', baseBranch: 'main', token: 't' })).toThrow(/owner\/name/);
    expect(() => new GitHubIntegrator({ repository: 'a/b', baseBranch: 'main', token: '' })).toThrow(/token/);
  });

  test('names GitHub and its API host as the remote, and keeps the token out of every enumerable field', () => {
    const integrator = new GitHubIntegrator({ repository: 'a/b', baseBranch: 'main', token: 'secret-token-value' });
    expect(integrator.remoteDomains).toEqual(expect.arrayContaining(['github.com', 'api.github.com']));
    expect(JSON.stringify(integrator)).not.toContain('secret-token-value');
  });
});
