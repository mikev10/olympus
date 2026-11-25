/**
 * One build of a tag at a time (A-R53-02, #231).
 *
 * Two builds of one tag give two content IDs and leave the tag on one of
 * them; the engine no longer holds the other, so a caller handed it cannot
 * start a container. `recordedImage` holds a lock per tag, so callers that
 * start together are all handed the one image the tag names.
 *
 * These need Docker and call no model. They are not skipped on a host
 * without it: a suite that skipped itself would report green having checked
 * nothing.
 */
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, describe, expect, test } from 'vitest';
import { recordedImage, SandboxRefusal } from '../src/index.js';
import { TEST_IMAGE } from './image.js';

const run = promisify(execFile);
const docker = async (...args: string[]): Promise<string> => (await run('docker', args)).stdout.trim();

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
  const tag = `a-r53-02-test:${randomUUID().slice(0, 12)}`;
  tags.push(tag);
  return tag;
}

/** A build context of one layer over the pinned test image. */
async function context(): Promise<string> {
  const dir = await temp('a-r53-02-context-');
  await writeFile(join(dir, 'Dockerfile'), 'ARG BASE\nFROM ${BASE}\nLABEL a-r53-02=lock\n');
  return dir;
}

/** Where `recordedImage` keeps a tag's records, and its lock beside them. */
function recordDirectory(records: string, tag: string): string {
  return join(records, tag.replace(/[^A-Za-z0-9._-]/g, '_'));
}

/** The process ID of a process that has exited. */
async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  const pid = child.pid;
  if (pid === undefined) throw new Error('the child process did not start');
  await new Promise<void>((resolve) => child.once('exit', () => { resolve(); }));
  return pid;
}

describe('one build of a tag at a time (A-R53-02)', () => {
  test('callers that start together are handed the one image the tag names, which the engine holds, built once', async () => {
    const records = await temp('a-r53-02-records-');
    const tag = testTag();
    const options = { tag, context: await context(), buildArgs: { BASE: TEST_IMAGE }, records };

    const ids = await Promise.all([recordedImage(options), recordedImage(options), recordedImage(options), recordedImage(options)]);

    const named = await docker('image', 'inspect', '--format', '{{.Id}}', tag);
    expect(ids).toEqual([named, named, named, named]);
    // The ID starts a container: the engine holds it.
    expect(await docker('run', '--rm', named, 'true')).toBe('');
    // One build, so one record.
    expect(await readdir(recordDirectory(records, tag))).toEqual([named.slice('sha256:'.length)]);
    // And the lock is gone, so the next caller does not wait.
    expect(await readdir(records)).toEqual([tag.replace(/[^A-Za-z0-9._-]/g, '_')]);
  }, 300_000);

  test('a lock whose holder on this host has exited is refused at once, names what to remove, and nothing is built', async () => {
    const records = await temp('a-r53-02-records-');
    const tag = testTag();
    const lock = `${recordDirectory(records, tag)}.lock`;
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, 'holder'), JSON.stringify({ host: hostname(), pid: await exitedPid() }));

    const started = Date.now();
    const refusal = await recordedImage({ tag, context: await context(), buildArgs: { BASE: TEST_IMAGE }, records }).then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(SandboxRefusal);
    expect((refusal as Error).message).toContain(lock);
    expect((refusal as Error).message).toMatch(/no longer running/);
    expect(Date.now() - started).toBeLessThan(30_000);
    await expect(docker('image', 'inspect', '--format', '{{.Id}}', tag)).rejects.toThrow();
    // Refused, not taken over: the lock is still there.
    expect(await readdir(lock)).toEqual(['holder']);
  }, 120_000);

  test('a lock still held when the wait runs out is refused, and nothing is built', async () => {
    const records = await temp('a-r53-02-records-');
    const tag = testTag();
    const lock = `${recordDirectory(records, tag)}.lock`;
    await mkdir(lock, { recursive: true });
    // This process holds it and is running, so it is never judged left behind.
    await writeFile(join(lock, 'holder'), JSON.stringify({ host: hostname(), pid: process.pid }));

    const refusal = await recordedImage({ tag, context: await context(), buildArgs: { BASE: TEST_IMAGE }, records, lockWaitMs: 1_500 }).then(() => null, (error: unknown) => error);

    expect(refusal).toBeInstanceOf(SandboxRefusal);
    expect((refusal as Error).message).toContain(lock);
    expect((refusal as Error).message).toMatch(/still held/);
    await expect(docker('image', 'inspect', '--format', '{{.Id}}', tag)).rejects.toThrow();
  }, 120_000);

  test('a lock held on another host is waited on, never judged by a process ID of this one', async () => {
    const records = await temp('a-r53-02-records-');
    const tag = testTag();
    const lock = `${recordDirectory(records, tag)}.lock`;
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, 'holder'), JSON.stringify({ host: `not-${hostname()}`, pid: await exitedPid() }));

    await expect(recordedImage({ tag, context: await context(), buildArgs: { BASE: TEST_IMAGE }, records, lockWaitMs: 1_500 })).rejects.toThrow(/still held/);
  }, 120_000);
});
