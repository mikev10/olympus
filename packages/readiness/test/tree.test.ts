/**
 * The copy a scan runs against stays inside its destination (R1 §5): trees
 * built object by object, so they can carry what no checkout would write.
 * These need git and no Docker daemon.
 */
import { execFile } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materialize } from '../src/tree.js';

/** A tree node: a blob's text, a symlink's target, or a subtree. Names are bytes, so they can be invalid UTF-8. */
type Node =
  | { readonly blob: string }
  | { readonly link: string }
  | { readonly tree: ReadonlyArray<readonly [Buffer, Node]> };

let base: string;
let repo: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'readiness-tree-'));
  repo = join(base, 'repo');
  await mkdir(repo);
  await git([], 'init', '--quiet', '--initial-branch=main');
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function git(input: Buffer | string | readonly [], ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['-C', repo, '-c', 'user.email=readiness@example.invalid', '-c', 'user.name=readiness', ...args], (error, stdout) => {
      if (error !== null) reject(new Error(error.message, { cause: error }));
      else resolve(stdout.trim());
    });
    child.stdin?.end(Array.isArray(input) ? undefined : input);
  });
}

async function write(node: Node): Promise<{ mode: string; type: string; oid: string }> {
  if ('blob' in node) return { mode: '100644', type: 'blob', oid: await git(node.blob, 'hash-object', '-w', '--stdin') };
  if ('link' in node) return { mode: '120000', type: 'blob', oid: await git(node.link, 'hash-object', '-w', '--stdin') };
  const lines: Buffer[] = [];
  for (const [name, child] of node.tree) {
    const { mode, type, oid } = await write(child);
    lines.push(Buffer.from(`${mode} ${type} ${oid}\t`), name, Buffer.from([0]));
  }
  return { mode: '040000', type: 'tree', oid: await git(Buffer.concat(lines), 'mktree', '-z', '--missing') };
}

async function commitOf(entries: ReadonlyArray<readonly [Buffer | string, Node]>): Promise<string> {
  const { oid } = await write({ tree: entries.map(([name, node]) => [typeof name === 'string' ? Buffer.from(name) : name, node] as const) });
  return git('', 'commit-tree', oid, '-m', 'fixture');
}

/** Everything under `base` outside the repository and the destination: where an escaping write would land. */
async function outside(): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const at = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (at === 'repo' || at === 'dest') continue;
      found.push(at);
      if (entry.isDirectory()) await walk(join(dir, entry.name), at);
    }
  };
  await walk(base, '');
  return found;
}

describe('materialize', () => {
  it('reproduces regular files and a symlink that stays inside the tree', async () => {
    const commit = await commitOf([
      ['src', { tree: [[Buffer.from('a.js'), { blob: 'export {};\n' }]] }],
      ['link.js', { link: 'src/a.js' }],
    ]);
    const dest = join(base, 'dest');
    const { files } = await materialize(repo, commit, dest);
    expect(files).toEqual(['link.js', 'src/a.js']);
    expect((await lstat(join(dest, 'link.js'))).isSymbolicLink()).toBe(true);
    expect((await readlink(join(dest, 'link.js'))).replaceAll('\\', '/')).toBe('src/a.js');
  });

  it('refuses a name that is not UTF-8, so two such names cannot decode to one path', async () => {
    await mkdir(join(base, 'escape'));
    const commit = await commitOf([
      [Buffer.from([0x80]), { link: join(base, 'escape') }],
      [Buffer.from([0x81]), { tree: [[Buffer.from('proof'), { blob: 'written\n' }]] }],
    ]);
    await expect(materialize(repo, commit, join(base, 'dest'))).rejects.toThrow(/not UTF-8/u);
    expect(await outside()).toEqual(['escape']);
  });

  it('refuses a symlink whose target is absolute', async () => {
    const commit = await commitOf([['package.json', { link: join(base, 'secret.json') }]]);
    await expect(materialize(repo, commit, join(base, 'dest'))).rejects.toThrow(/could escape the copy/u);
  });

  it('refuses a symlink that climbs out of the tree, directly or through another link', async () => {
    const direct = await commitOf([['package.json', { link: '../secret.json' }]]);
    await expect(materialize(repo, direct, join(base, 'dest'))).rejects.toThrow(/could escape the copy/u);
    const indirect = await commitOf([['here', { link: '.' }], ['package.json', { link: 'here/../secret.json' }]]);
    await expect(materialize(repo, indirect, join(base, 'dest2'))).rejects.toThrow(/could escape the copy/u);
  });

  it('refuses a write through a path that is already a symlink', async () => {
    const commit = await commitOf([
      ['a', { tree: [[Buffer.from('keep'), { blob: 'kept\n' }]] }],
      ['b', { link: 'a' }],
      ['b', { tree: [[Buffer.from('proof'), { blob: 'written\n' }]] }],
    ]);
    const dest = join(base, 'dest');
    await expect(materialize(repo, commit, dest)).rejects.toThrow(/symlink/u);
    await expect(lstat(join(dest, 'a', 'proof'))).rejects.toThrow(/ENOENT/u);
  });
});
