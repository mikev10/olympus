/**
 * The mount layer, tested without a daemon. Everything here decides whether a
 * container is allowed to exist at all, so it runs before Docker is involved
 * and fails on the refusal's `layer`, not merely on "something threw".
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SandboxRefusal, mountArgument, mountTable, resolveMounts, type MountTable } from '../src/index.js';
import { ESCAPE_MECHANISM, linkTo } from './escape.js';

let base: string;
let workspace: string;
let vault: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'mounts-'));
  workspace = join(base, 'workspace');
  vault = join(base, 'vault');
  await mkdir(workspace, { recursive: true });
  await mkdir(vault, { recursive: true });
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** The refusal this layer must produce, never a bare Error. */
async function refusal(body: () => unknown): Promise<SandboxRefusal> {
  try {
    await body();
  } catch (error) {
    if (error instanceof SandboxRefusal) return error;
    throw error;
  }
  throw new Error('expected a SandboxRefusal, but the call returned');
}

describe('mountTable: I1 at run time', () => {
  test('accepts a workspace and any number of ro mounts, and freezes what it returns', () => {
    const table = mountTable({
      workspace: { source: workspace, target: '/workspace', mode: 'rw' },
      others: [{ source: vault, target: '/ro-one', mode: 'ro' }],
    });
    expect(table.workspace.mode).toBe('rw');
    expect(table.others).toHaveLength(1);
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.isFrozen(table.others)).toBe(true);
    // Freezing the containers alone leaves every entry's mode and source writable, so a
    // validated table could still be edited after the validation that makes it worth
    // anything. Review finding 6, extended to the `others` entries.
    expect(Object.isFrozen(table.workspace)).toBe(true);
    expect(table.others.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  test('refuses a second rw mount, naming it and the invariant', async () => {
    // The type layer has no slot for this; a cast is how it reaches the runtime in practice.
    const spec = {
      workspace: { source: workspace, target: '/workspace', mode: 'rw' as const },
      others: [{ source: vault, target: '/second', mode: 'rw' }],
    } as unknown as Parameters<typeof mountTable>[0];
    const error = await refusal(() => mountTable(spec));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('/second');
    expect(error.message).toContain('I1');
  });

  test('refuses a workspace whose mode is neither rw nor ro', async () => {
    const spec = { workspace: { source: workspace, target: '/workspace', mode: 'rwx' } } as unknown as Parameters<typeof mountTable>[0];
    const error = await refusal(() => mountTable(spec));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('rwx');
  });

  test('refuses a source that is not an absolute host path', async () => {
    const error = await refusal(() => mountTable({ workspace: { source: 'workspace', target: '/workspace', mode: 'rw' } }));
    expect(error.message).toContain('absolute host path');
  });

  test.each([
    ['relative', 'workspace'],
    ['the container root', '/'],
    ['a trailing slash', '/workspace/'],
    ['a parent segment', '/workspace/../etc'],
    ['a dot segment', '/workspace/./sub'],
    ['an empty segment', '/workspace//sub'],
  ])('refuses %s as a target', async (_label, target) => {
    const error = await refusal(() => mountTable({ workspace: { source: workspace, target, mode: 'rw' } }));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('target');
  });

  test('refuses overlapping targets, so no mount is hidden under another', async () => {
    const error = await refusal(() =>
      mountTable({
        workspace: { source: workspace, target: '/workspace', mode: 'rw' },
        others: [{ source: vault, target: '/workspace/nested', mode: 'ro' }],
      }),
    );
    expect(error.message).toContain('overlap');
  });

  test('refuses duplicate targets', async () => {
    const error = await refusal(() =>
      mountTable({
        workspace: { source: workspace, target: '/workspace', mode: 'rw' },
        others: [{ source: vault, target: '/workspace', mode: 'ro' }],
      }),
    );
    expect(error.message).toContain('overlap');
  });

  // `base` does not exist yet when test.each evaluates its table, so these name a fixed root.
  test.each([
    ['a comma', 'a,b'],
    ['an equals sign', 'a=b'],
  ])('refuses a source containing %s rather than approximating the --mount grammar', async (_label, leaf) => {
    const source = join(tmpdir(), leaf);
    const error = await refusal(() => mountTable({ workspace: { source, target: '/workspace', mode: 'rw' } }));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('--mount');
  });
});

describe('resolveMounts: symlinks and `..` are resolved before the Vault is checked', () => {
  test('resolves a plain workspace and carries the mode through', async () => {
    const table = mountTable({ workspace: { source: workspace, target: '/workspace', mode: 'ro' } });
    const [mount] = await resolveMounts(table, [vault]);
    expect(mount?.mode).toBe('ro');
    expect(mount?.target).toBe('/workspace');
    expect(mountArgument({ declared: workspace, source: '/real', target: '/workspace', mode: 'ro' })).toBe(
      'type=bind,source=/real,target=/workspace,readonly',
    );
  });

  test('an rw mount carries no readonly flag', () => {
    expect(mountArgument({ declared: workspace, source: '/real', target: '/workspace', mode: 'rw' })).toBe(
      'type=bind,source=/real,target=/workspace',
    );
  });

  test(`refuses a source that reaches a Vault path through a ${ESCAPE_MECHANISM}, naming both paths`, async () => {
    const link = join(workspace, 'link');
    await linkTo(vault, link);
    const table = mountTable({ workspace: { source: link, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain(link);
    expect(error.message).toContain('I1');
    // The check ran on what the path resolves to, not on what it says.
    expect(error.message).toContain('resolves to it');
  });

  test('refuses a source that reaches a Vault path through `..`', async () => {
    const table = mountTable({ workspace: { source: join(workspace, '..', 'vault'), target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.message).toContain('I1');
  });

  test('refuses a source inside a Vault path', async () => {
    const inside = join(vault, 'objects');
    await mkdir(inside, { recursive: true });
    const table = mountTable({ workspace: { source: inside, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.message).toContain('I1');
  });

  test('refuses a source that contains a Vault path', async () => {
    const table = mountTable({ workspace: { source: base, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.message).toContain('I1');
  });

  test('refuses a Vault path mounted ro: read-only is still one flag away from writable', async () => {
    const table = mountTable({
      workspace: { source: workspace, target: '/workspace', mode: 'rw' },
      others: [{ source: vault, target: '/audit', mode: 'ro' }],
    });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('/audit');
  });

  test('refuses a Vault root that does not exist yet, which still names a location nothing may mount', async () => {
    const future = join(base, 'not-yet');
    const table = mountTable({ workspace: { source: base, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [future]));
    expect(error.message).toContain('I1');
  });

  test('refuses a source that does not exist rather than letting Docker create it', async () => {
    const table = mountTable({ workspace: { source: join(base, 'absent'), target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('refused rather than created');
  });

  test('refuses a source that is a file', async () => {
    const file = join(base, 'file.txt');
    await writeFile(file, 'x');
    const table = mountTable({ workspace: { source: file, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.message).toContain('not a directory');
  });

  test(`refuses two mounts that only overlap after resolution when one is rw (${ESCAPE_MECHANISM})`, async () => {
    const alias = join(base, 'alias');
    await linkTo(workspace, alias);
    // The targets differ and neither declared source contains the other, so the table is well
    // formed; only realpath shows that both mounts land on the same tree, one of them rw.
    const table = mountTable({
      workspace: { source: workspace, target: '/workspace', mode: 'rw' },
      others: [{ source: alias, target: '/alias', mode: 'ro' }],
    });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('overlap');
  });

  test(`refuses a comma-free source that resolves to a comma-bearing path (${ESCAPE_MECHANISM}) — review finding 1`, async () => {
    // Docker's --mount grammar splits on commas, so it would mount the prefix before the comma:
    // a sibling of the Vault named `vault,readonly` truncates to the Vault itself, after every
    // containment check has passed on the longer name.
    const decoy = join(base, 'vault,readonly');
    await mkdir(decoy, { recursive: true });
    const link = join(base, 'plain-link');
    await linkTo(decoy, link);
    expect(link).not.toContain(',');

    const table = mountTable({ workspace: { source: link, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [vault]));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('--mount');
    expect(error.message).toContain('resolves to');
  });

  test('refuses a mount beside a Vault root that does not exist yet, reached through a symlinked parent — review finding 3', async () => {
    // The Vault is declared behind a link and has not been created. Resolving only the part that
    // exists is what makes the two spellings comparable; leaving it unresolved compares a
    // resolved source against an unresolved Vault string and finds no overlap.
    const real = join(base, 'real');
    await mkdir(real, { recursive: true });
    const linkedParent = join(base, 'linked-parent');
    await linkTo(real, linkedParent);
    const futureVault = join(linkedParent, 'vault');

    const table = mountTable({ workspace: { source: real, target: '/workspace', mode: 'rw' } });
    const error = await refusal(() => resolveMounts(table, [futureVault]));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('I1');
  });

  test('allows a mount unrelated to a Vault root that does not exist yet', async () => {
    // The control for the test above: resolving the missing tail must not turn every absent
    // Vault path into a refusal of everything.
    const elsewhere = join(base, 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
    const table = mountTable({ workspace: { source: elsewhere, target: '/workspace', mode: 'rw' } });
    const resolved = await resolveMounts(table, [join(base, 'never-created', 'vault')]);
    expect(resolved).toHaveLength(1);
  });

  test('allows two ro mounts that resolve to the same tree: neither grants a write', async () => {
    const alias = join(base, 'alias');
    await linkTo(workspace, alias);
    const table: MountTable = mountTable({
      workspace: { source: workspace, target: '/workspace', mode: 'ro' },
      others: [{ source: alias, target: '/alias', mode: 'ro' }],
    });
    const resolved = await resolveMounts(table, [vault]);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.source).toBe(resolve(resolved[1]?.source ?? ''));
  });
});
