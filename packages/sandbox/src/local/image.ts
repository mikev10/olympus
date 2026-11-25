/**
 * An image's content ID, read from the container engine (A-R53-01).
 *
 * A tag or a repository digest is a name, and the engine can be made to
 * answer a name with other bytes: a tag is moved by `docker tag`, and a
 * digest names a manifest that the engine resolves to an image it holds. The
 * content ID is the image itself. `docker run <id>` starts exactly that image
 * or refuses ("No such image"), so a sandbox provisioned from an ID runs the
 * bytes the ID names, whatever happens to the tag afterwards. That is what
 * the evidence records as `harnessImage`, and what the line provisions from.
 */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerCli } from './docker.js';
import { refuse } from './refusal.js';

/** A content ID as the engine prints it: `sha256:` and 64 hex digits. */
export const CONTENT_ID = /^sha256:[0-9a-f]{64}$/;

export interface ImageIdOptions {
  /** The Docker executable. Defaults to `docker` on PATH. */
  readonly executable?: string;
  /**
   * Pull `ref` when the engine does not hold it. Allowed only for a reference
   * pinned by digest (`name@sha256:…`): a pull by digest fetches the one
   * manifest the digest names, where a pull by tag fetches whatever the tag
   * names that day. Off by default: nothing is pulled unless asked.
   */
  readonly pull?: boolean;
}

/** A reference pinned by digest. */
const BY_DIGEST = /@sha256:[0-9a-f]{64}$/;

async function inspectId(executable: string, ref: string): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  return dockerCli(executable, ['image', 'inspect', '--format', '{{.Id}}', ref], { timeoutMs: 60_000 }).catch((error: unknown) => {
    refuse('image', `the Docker daemon could not be reached to read the content ID of ${ref}: ${String(error)}`);
  });
}

/**
 * The content ID of the image `ref` names on this engine, or a refusal: the
 * engine could not be reached, holds no such image, or answered with
 * something that is not a content ID. Nothing is pulled unless `pull` is set
 * and `ref` is pinned by digest.
 */
export async function imageId(ref: string, options: ImageIdOptions = {}): Promise<string> {
  const executable = options.executable ?? 'docker';
  if (ref.trim() === '') refuse('image', 'no image was named, so there is no content ID to read');
  if (options.pull === true && !BY_DIGEST.test(ref)) refuse('image', `${ref} is not pinned by digest, so it is not pulled: a tag names whatever it names the day it is pulled`);
  let read = await inspectId(executable, ref);
  if (read.exitCode !== 0 && options.pull === true) {
    const pulled = await dockerCli(executable, ['pull', '--quiet', ref], { timeoutMs: 600_000 }).catch((error: unknown) => {
      refuse('image', `pulling ${ref} did not finish: ${String(error)}`);
    });
    if (pulled.exitCode !== 0) refuse('image', `pulling ${ref} failed with exit code ${String(pulled.exitCode)}: ${pulled.stderr.trim()}`);
    read = await inspectId(executable, ref);
  }
  if (read.exitCode !== 0) refuse('image', `the engine holds no image ${ref}, so it has no content ID: ${read.stderr.trim()}`);
  const id = read.stdout.trim();
  if (!CONTENT_ID.test(id)) refuse('image', `the engine named ${ref}'s content ID as ${JSON.stringify(id)}, which is not sha256: and 64 hex digits`);
  return id;
}

/** The one registry a harness lockfile may resolve from. */
export const NPM_REGISTRY = 'https://registry.npmjs.org/';

const SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;

/** The CLI a harness lockfile pins: its package name and exact version. */
export interface LockedCli {
  readonly name: string;
  readonly version: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Why a harness image's manifest and lockfile do not pin `cli` by content,
 * one line per problem, or none (R53). The image installs from the lockfile
 * with `npm ci`, which checks each tarball against the lockfile's integrity,
 * so an entry with no `sha512` integrity, or one resolved from anywhere but
 * the registry, would install whatever it is served. Both are refused before
 * a build starts, as is a lockfile whose CLI is not the version the driver
 * reports: the evidence would name one version and the image hold another.
 */
export function harnessLockProblems(manifest: unknown, lock: unknown, cli: LockedCli): string[] {
  const problems: string[] = [];
  const wanted = JSON.stringify({ [cli.name]: cli.version });
  if (!isObject(manifest) || JSON.stringify(manifest.dependencies) !== wanted) {
    problems.push(`package.json does not depend on ${cli.name} at exactly ${cli.version} and nothing else`);
  }
  if (!isObject(lock) || lock.lockfileVersion !== 3 || !isObject(lock.packages)) {
    problems.push('package-lock.json is not a version 3 lockfile with a packages map');
    return problems;
  }
  const packages = lock.packages;
  const root = packages[''];
  if (!isObject(root) || JSON.stringify(root.dependencies) !== wanted) {
    problems.push(`package-lock.json's root does not depend on ${cli.name} at exactly ${cli.version} and nothing else`);
  }
  const top = packages[`node_modules/${cli.name}`];
  if (!isObject(top) || top.version !== cli.version) {
    problems.push(`package-lock.json locks ${cli.name} at ${isObject(top) ? String(top.version) : 'no version'}, not ${cli.version}`);
  }
  for (const [path, entry] of Object.entries(packages)) {
    if (path === '') continue;
    if (!path.startsWith('node_modules/') || !isObject(entry)) {
      problems.push(`package-lock.json entry ${JSON.stringify(path)} is not an installed package`);
      continue;
    }
    if (entry.link === true) problems.push(`${path} is a link, which installs a directory rather than a tarball`);
    if (typeof entry.resolved !== 'string' || !entry.resolved.startsWith(NPM_REGISTRY)) {
      problems.push(`${path} resolves from ${JSON.stringify(entry.resolved)}, not from ${NPM_REGISTRY}`);
    }
    if (typeof entry.integrity !== 'string' || !SHA512.test(entry.integrity)) {
      problems.push(`${path} carries no sha512 integrity, so its tarball would install unchecked`);
    }
  }
  return problems;
}

export interface RecordedImageOptions {
  /** The tag the build is given, derived by the caller from every input of the build. */
  readonly tag: string;
  /** The build context. */
  readonly context: string;
  readonly buildArgs: Readonly<Record<string, string>>;
  /**
   * Where this host records the content ID of every image it built, one
   * directory per tag. It belongs to the host: no sandbox mounts it, and a
   * replaced image cannot write it.
   */
  readonly records: string;
  readonly executable?: string;
  readonly timeoutMs?: number;
  /**
   * How long to wait for another caller that is building this tag. Defaults
   * to the build's own limit and a minute more, which a running build cannot
   * outlast.
   */
  readonly lockWaitMs?: number;
}

/** A tag as a directory name: `:` and `/` are not portable in one. */
function recordDirectory(records: string, tag: string): string {
  return join(records, tag.replace(/[^A-Za-z0-9._-]/g, '_'));
}

async function recorded(records: string, tag: string, id: string): Promise<boolean> {
  return (await stat(join(recordDirectory(records, tag), id.slice('sha256:'.length))).catch(() => null))?.isFile() === true;
}

/** Whether a process of this host is running. A process this one may not signal is running. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Run `work` as the only caller holding `tag`'s lock under `records`
 * (A-R53-02).
 *
 * Two builds of one tag give two content IDs and leave the tag on one; the
 * engine no longer holds the other, so its caller is handed an image that
 * cannot start. And a tag exists before its record is written, so a caller
 * that reads between the two would refuse a build in progress as a replaced
 * image. The lock covers both: it is held from the first look at the tag
 * until the record is written.
 *
 * The lock is a directory beside the tag's records, made by one `mkdir`,
 * which either creates it or fails. A lock left behind is refused and never
 * taken over: two waiters that each judged it left behind could each remove
 * it, the second removing the first's new lock.
 */
async function withTagLock<T>(records: string, tag: string, waitMs: number, work: () => Promise<T>): Promise<T> {
  const lock = `${recordDirectory(records, tag)}.lock`;
  const holderFile = join(lock, 'holder');
  await mkdir(records, { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const made = await mkdir(lock).then(
      () => true,
      (error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        refuse('image', `the lock for building ${tag} could not be taken at ${lock}: ${String(error)}`);
      },
    );
    if (made) break;
    // Unreadable while its holder is between making the lock and naming itself: waited on like any other.
    const holder: unknown = await readFile(holderFile, 'utf8').then((text) => JSON.parse(text) as unknown, () => null);
    if (isObject(holder) && holder.host === hostname() && typeof holder.pid === 'number' && !running(holder.pid)) {
      refuse(
        'image',
        `${tag} is locked at ${lock} by process ${String(holder.pid)} of this host, which is no longer running, so a build of it was cut short. ` +
          'A lock left behind is refused, never taken over; remove that directory and the next start builds.',
      );
    }
    if (Date.now() >= deadline) {
      refuse(
        'image',
        `${tag} is locked at ${lock} and was still held after ${String(waitMs)} ms, longer than a build may take. ` +
          'If no other host is building it, remove that directory and the next start builds.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))));
  }
  try {
    await writeFile(holderFile, `${JSON.stringify({ host: hostname(), pid: process.pid, at: new Date().toISOString() })}\n`);
    return await work();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/**
 * The content ID of the image under `tag`, built here if the engine holds no
 * such tag, or a refusal (R53).
 *
 * A tag the engine already holds is accepted only when its content ID is one
 * this host recorded building under that tag. Anything else is a replaced
 * image, a finding and not a cache miss, so it is refused and never rebuilt
 * over. A build records the ID `--iidfile` names, the image that build
 * produced, before it is returned. The caller provisions from the ID, so a
 * tag moved afterwards changes nothing that runs.
 *
 * One caller at a time per tag (A-R53-02): callers that start together wait
 * on the first, then read the tag it built and recorded.
 */
export async function recordedImage(options: RecordedImageOptions): Promise<string> {
  const waitMs = options.lockWaitMs ?? (options.timeoutMs ?? 600_000) + 60_000;
  return withTagLock(options.records, options.tag, waitMs, () => inspectOrBuild(options));
}

async function inspectOrBuild(options: RecordedImageOptions): Promise<string> {
  const executable = options.executable ?? 'docker';
  const { tag, records } = options;
  const present = await dockerCli(executable, ['image', 'inspect', '--format', '{{.Id}}', tag], { timeoutMs: 60_000 }).catch((error: unknown) => {
    refuse('image', `the Docker daemon could not be reached to look for ${tag}: ${String(error)}`);
  });
  if (present.exitCode === 0) {
    const id = present.stdout.trim();
    if (!CONTENT_ID.test(id)) refuse('image', `the engine named ${tag}'s content ID as ${JSON.stringify(id)}, which is not sha256: and 64 hex digits`);
    if (await recorded(records, tag, id)) return id;
    refuse(
      'image',
      `the engine holds ${tag} as ${id}, which this host has no record of building under that tag (${recordDirectory(records, tag)}). ` +
        'A replaced image is refused, never rebuilt over; remove it with `docker image rm ' + tag + '` and the next start builds and records it.',
    );
  }

  const scratch = await mkdtemp(join(tmpdir(), 'harness-image-'));
  try {
    const iidfile = join(scratch, 'iid');
    const args = ['build', '--iidfile', iidfile];
    for (const [name, value] of Object.entries(options.buildArgs)) args.push('--build-arg', `${name}=${value}`);
    args.push('--tag', tag, options.context);
    const built = await dockerCli(executable, args, { timeoutMs: options.timeoutMs ?? 600_000 }).catch((error: unknown) => {
      refuse('image', `building ${tag} did not finish: ${String(error)}`);
    });
    if (built.exitCode !== 0) {
      refuse('image', `building ${tag} failed with exit code ${String(built.exitCode)}: ${built.stderr.trim()}`);
    }
    const id = (await readFile(iidfile, 'utf8').catch(() => '')).trim();
    if (!CONTENT_ID.test(id)) refuse('image', `building ${tag} reported the content ID ${JSON.stringify(id)}, which is not sha256: and 64 hex digits`);
    const directory = recordDirectory(records, tag);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, id.slice('sha256:'.length)), `${JSON.stringify({ tag, id, builtAt: new Date().toISOString() })}\n`);
    return id;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
