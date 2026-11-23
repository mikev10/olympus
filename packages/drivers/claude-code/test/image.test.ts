/**
 * The image by content (R53): the CLI installed from the lockfile and never by
 * name, a build whose install does not match the lockfile refused, and a tag
 * the daemon holds as an image this host did not record building refused.
 *
 * These need Docker and npm and call no model. Every image they build under a
 * tag of their own is removed afterwards; the one real tag they touch is
 * built or accepted through `ensureImage()` exactly as the host does, so the
 * record it leaves is the record the host would have left.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import { recordedImage } from '@olympus-ai/sandbox';
import { BASE_IMAGE, CLI_PACKAGE, CLI_VERSION, IMAGE_RECORDS, ensureImage, imageContext, imageTag } from '../src/index.js';

const run = promisify(execFile);
const docker = async (...args: string[]): Promise<string> => (await run('docker', args, { maxBuffer: 64 * 1024 * 1024 })).stdout.trim();

const scratch: string[] = [];
const tags: string[] = [];
afterAll(async () => {
  for (const tag of tags) await docker('image', 'rm', '--force', tag).catch(() => undefined);
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

async function temp(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function testTag(): string {
  const tag = `r53-test-claude-code:${randomUUID().slice(0, 12)}`;
  tags.push(tag);
  return tag;
}

/** The daemon's platform package: what the image's install must hold. */
async function platformPackage(): Promise<string> {
  const arch = await docker('info', '--format', '{{.Architecture}}');
  const cpu = arch === 'aarch64' || arch === 'arm64' ? 'arm64' : arch === 'x86_64' || arch === 'amd64' ? 'x64' : arch;
  return `${CLI_PACKAGE}-linux-${cpu}`;
}

interface Lock {
  readonly packages: Record<string, { readonly version?: string; readonly integrity?: string; readonly optional?: boolean; readonly os?: string[]; readonly cpu?: string[] }>;
}

async function lock(dir: string): Promise<Lock> {
  return JSON.parse(await readFile(join(dir, 'cli-lock.json'), 'utf8')) as Lock;
}

/** A copy of the build context whose lockfile pins `pkg` at a hash its tarball does not have. */
async function alteredContext(pkg: string): Promise<string> {
  const dir = await temp('r53-context-');
  await cp(imageContext(), dir, { recursive: true });
  const locked = await lock(dir);
  const entry = locked.packages[`node_modules/${pkg}`];
  if (entry?.integrity === undefined) throw new Error(`the lockfile pins no ${pkg}`);
  // One character of the digest changed: still a well-formed sha512, of other bytes.
  const altered = entry.integrity.replace(/^sha512-(.)/, (_, c: string) => `sha512-${c === 'A' ? 'B' : 'A'}`);
  await writeFile(join(dir, 'cli-lock.json'), JSON.stringify({ ...locked, packages: { ...locked.packages, [`node_modules/${pkg}`]: { ...entry, integrity: altered } } }, null, 2));
  return dir;
}

invariantTest(
  'I5.claude-code-image-installs-the-cli-by-content',
  "the image installs its CLI from the lockfile and never by name: a build whose lockfile alters one platform package's sha512 fails and names it, "
    + 'the built image holds every package the lockfile pins for its platform at its locked version and integrity, and its CLI reports CLI_VERSION',
  async () => {
    const platform = await platformPackage();
    const records = await temp('r53-records-');

    // The context as committed, built under a tag of its own.
    const id = await recordedImage({ tag: testTag(), context: imageContext(), buildArgs: { BASE: BASE_IMAGE }, records });
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await docker('run', '--rm', id, 'claude', '--version')).toContain(CLI_VERSION);
    // npm's record of the install, inside the image: every package for this platform, at the lockfile's hash.
    const installed = JSON.parse(await docker('run', '--rm', id, 'cat', '/opt/cli/node_modules/.package-lock.json')) as Lock;
    const locked = await lock(imageContext());
    for (const pkg of [CLI_PACKAGE, platform]) {
      const path = `node_modules/${pkg}`;
      expect(installed.packages[path]?.integrity, path).toBe(locked.packages[path]?.integrity);
      expect(installed.packages[path]?.version, path).toBe(locked.packages[path]?.version);
    }
    // The binary on PATH is the lockfile's, not one installed by name elsewhere.
    expect(await docker('run', '--rm', id, 'readlink', '-f', '/usr/local/bin/claude')).toMatch(/^\/opt\/cli\/node_modules\/@anthropic-ai\/claude-code\//);

    // npm skips an optional package whose tarball fails its hash; the build must not (D-R53-02).
    const altered = await recordedImage({ tag: testTag(), context: await alteredContext(platform), buildArgs: { BASE: BASE_IMAGE }, records }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(altered).toBeInstanceOf(Error);
    expect((altered as Error).message).toContain(`node_modules/${platform}`);
    // And the CLI's own package, which npm refuses itself.
    const top = await recordedImage({ tag: testTag(), context: await alteredContext(CLI_PACKAGE), buildArgs: { BASE: BASE_IMAGE }, records }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(top).toBeInstanceOf(Error);
    expect((top as Error).message).toMatch(/integrity|EINTEGRITY|check-install/);
  },
);

invariantTest(
  'I5.claude-code-image-replaced-is-refused',
  'ensureImage returns the content ID of an image this host recorded building under the tag, and refuses, without rebuilding, a tag the daemon holds '
    + 'as an image with no record or another record',
  async () => {
    // The real tag, through the host's own path: built and recorded, or accepted as recorded.
    const id = await ensureImage();
    expect(id).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(await docker('image', 'inspect', '--format', '{{.Id}}', imageTag())).toBe(id);
    const recordedHere = await readdir(join(IMAGE_RECORDS, imageTag().replace(/[^A-Za-z0-9._-]/g, '_')));
    expect(recordedHere).toContain(id.slice('sha256:'.length));

    // The same tag and image, read against a record that never saw it built, or saw another image built.
    const none = await temp('r53-records-');
    await expect(ensureImage({ records: none })).rejects.toThrow(/no record of building/);
    const other = await temp('r53-records-');
    await mkdir(join(other, imageTag().replace(/[^A-Za-z0-9._-]/g, '_')), { recursive: true });
    await writeFile(join(other, imageTag().replace(/[^A-Za-z0-9._-]/g, '_'), 'f'.repeat(64)), '{}\n');
    await expect(ensureImage({ records: other })).rejects.toThrow(/no record of building/);
    expect(await docker('image', 'inspect', '--format', '{{.Id}}', imageTag())).toBe(id);

    // A retag, on a tag of its own: built and recorded, then moved to another image, is refused and not rebuilt over.
    const records = await temp('r53-records-');
    const context = await temp('r53-retag-');
    await writeFile(join(context, 'Dockerfile'), 'ARG BASE\nFROM ${BASE}\nLABEL r53=retag\n');
    const tag = testTag();
    const built = await recordedImage({ tag, context, buildArgs: { BASE: BASE_IMAGE }, records });
    expect(await recordedImage({ tag, context, buildArgs: { BASE: BASE_IMAGE }, records })).toBe(built);
    await docker('tag', id, tag);
    await expect(recordedImage({ tag, context, buildArgs: { BASE: BASE_IMAGE }, records })).rejects.toThrow(/no record of building/);
    expect(await docker('image', 'inspect', '--format', '{{.Id}}', tag)).toBe(id);
  },
);
