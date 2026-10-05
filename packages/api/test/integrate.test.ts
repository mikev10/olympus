import { cp, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunId } from '@olympus-ai/core';
import { withFakeGitHub, type FakeGitHub } from '@olympus-ai/conformance/fake-github';
import type { IntegrationOpened } from '@olympus-ai/vault';
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

  test('a tracked symlink the base holds as a regular file of the same text is named (codex-3)', async () => {
    const problems = await baseMismatches(root, [{ ...hello, mode: '120000' }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/hello\.txt is a symlink at the base commit and a regular file/u);
  });

  test.skipIf(process.platform === 'win32')('a symlink is compared by its target, as git stores it', async () => {
    await symlink('hello.txt', join(root, 'link'));
    expect(await baseMismatches(root, [{ path: 'link', mode: '120000', type: 'blob', sha: gitBlobSha(new TextEncoder().encode('hello.txt')) }])).toEqual([]);
  });

  test.skipIf(process.platform === 'win32')('a tracked regular file the base holds as a symlink of the same text is named (codex-3)', async () => {
    await symlink('hello.txt', join(root, 'file-as-link'));
    const problems = await baseMismatches(root, [{ path: 'file-as-link', mode: '100644', type: 'blob', sha: gitBlobSha(new TextEncoder().encode('hello.txt')) }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/file-as-link is a regular file at the base commit and a symlink/u);
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

describe('GitHubIntegrator against a GitHub server', () => {
  const token = 'integrate-test-token';
  const runId = 'run-integrate' as RunId;

  /** A base of `hello.txt`, a verified tree that adds `feature.txt`, and the pull request opened over them. */
  async function opened<T>(body: (github: FakeGitHub, integrator: GitHubIntegrator, record: IntegrationOpened, reopen: () => Promise<IntegrationOpened>) => Promise<T>): Promise<T> {
    const base = await mkdtemp(join(tmpdir(), 'integrate-base-'));
    const tree = await mkdtemp(join(tmpdir(), 'integrate-tree-'));
    try {
      await writeFile(join(base, 'hello.txt'), 'hello\n');
      await cp(base, tree, { recursive: true });
      await writeFile(join(tree, 'feature.txt'), 'feature\n');
      return await withFakeGitHub(base, { token }, async (github, baseCommit) => {
        const integrator = new GitHubIntegrator({ repository: github.repository, baseBranch: github.baseBranch, token, apiBase: github.apiBase });
        const reopen = async (): Promise<IntegrationOpened> => integrator.open({ runId, baseCommit, base, tree, diff: [{ path: 'feature.txt', change: 'added', sha256: null }], admittedAt: new Date(0).toISOString() });
        const record = await reopen();
        return body(github, integrator, record, reopen);
      });
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(tree, { recursive: true, force: true });
    }
  }

  test('a merge whose record was lost is found merged over the base commit and recorded again (control)', async () => {
    await opened(async (_github, integrator, record) => {
      const first = await integrator.merge(record);
      const again = await integrator.merge(record);
      expect(again.mergeCommit).toBe(first.mergeCommit);
    });
  });

  test('a push that lands between the base check and the merge halts the run (codex-1)', async () => {
    await opened(async (github, integrator, record) => {
      github.beforeNextMerge = () => github.moveBase();
      await expect(integrator.merge(record)).rejects.toThrow(/not over .* the commit the run was verified over/u);
    });
  });

  test('a pull request merged by someone else after the base moved is not recorded as the run\'s merge (gemini-1)', async () => {
    await opened(async (github, integrator, record) => {
      github.moveBase();
      github.mergeAsSomeoneElse(record.pullRequest);
      await expect(integrator.merge(record)).rejects.toThrow(/not over .* the commit the run was verified over/u);
    });
  });

  test.skipIf(process.platform === 'win32')('a changed path is published as the type the verified tree holds, not the base\'s (codex-3)', async () => {
    const base = await mkdtemp(join(tmpdir(), 'integrate-base-'));
    const tree = await mkdtemp(join(tmpdir(), 'integrate-tree-'));
    try {
      await symlink('production', join(base, 'config'));
      await writeFile(join(tree, 'config'), 'staging');
      await withFakeGitHub(base, { token }, async (github, baseCommit) => {
        const integrator = new GitHubIntegrator({ repository: github.repository, baseBranch: github.baseBranch, token, apiBase: github.apiBase });
        const record = await integrator.open({ runId, baseCommit, base, tree, diff: [{ path: 'config', change: 'modified', sha256: null }], admittedAt: new Date(0).toISOString() });
        expect(github.files(record.commit).get('config')?.mode).toBe('100644');
      });
    } finally {
      await rm(base, { recursive: true, force: true });
      await rm(tree, { recursive: true, force: true });
    }
  });

  test('a pull request retargeted to another branch is refused at open and at merge (gemini-2)', async () => {
    await opened(async (github, integrator, record, reopen) => {
      github.retarget(record.pullRequest, 'elsewhere');
      await expect(reopen()).rejects.toThrow(/targets elsewhere, not main/u);
      await expect(integrator.merge(record)).rejects.toThrow(/targets elsewhere, not main/u);
      expect(github.pulls()[0]?.merged).toBe(false);
    });
  });
});
