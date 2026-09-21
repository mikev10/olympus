/**
 * The image a task runs in.
 *
 * No published image carries the Claude Code CLI, so this package builds one
 * rather than pulling one. Both inputs are pinned — the base by digest, the
 * CLI by exact version — so the image is a function of two constants in this
 * file and `image/Dockerfile`, and a reviewer who builds it gets what CI
 * built. The tag carries the CLI version, so bumping the version builds a
 * different image instead of quietly replacing one under the same name.
 *
 * This is beside the image `packages/sandbox` pins for its own suite, not
 * downstream of it: that one is an alpine that has to run `sh`, this one has
 * to run a model runner, and neither should move because the other did.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { refuse } from './refusal.js';

/** The base, by digest. `node:22-bookworm-slim` at the time it was pinned. */
export const BASE_IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

/** The CLI, by exact version. Never a range: a range makes the image a function of the day it was built. */
export const CLI_VERSION = '2.1.277';

/**
 * The tag the built image carries, derived from everything that decides what is
 * in it: the Dockerfile's bytes, the base digest, and the CLI version.
 *
 * A tag naming the CLI version alone does not identify the image. `ensureImage`
 * returns as soon as the daemon holds the tag, so changing the Dockerfile or
 * the base while leaving the CLI version alone left every machine that had
 * built the old one running it -- old runtime bytes under a report that hashes
 * the new source and blesses the result as current. Deriving the tag from the
 * inputs makes that impossible: different inputs are a different tag, and a
 * different tag is a build.
 */
export function imageTag(): string {
  const dockerfile = readFileSync(join(imageContext(), 'Dockerfile'));
  const digest = createHash('sha256')
    .update(`${BASE_IMAGE}\n${CLI_VERSION}\n`)
    .update(dockerfile)
    .digest('hex')
    .slice(0, 16);
  return `factory-claude-code:${CLI_VERSION}-${digest}`;
}

/** The directory holding the Dockerfile, resolved from this module rather than from the caller's cwd. */
export function imageContext(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'image');
}

interface Ran {
  readonly exitCode: number;
  readonly stderr: string;
}

function docker(executable: string, args: string[], timeoutMs: number): Promise<Ran> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const stderr: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`docker ${args[0] ?? ''} did not finish within ${String(timeoutMs)}ms`));
    }, timeoutMs);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code ?? 1, stderr: Buffer.concat(stderr).toString('utf8') });
    });
  });
}

export interface EnsureImageOptions {
  /** The Docker executable. Defaults to `docker` on PATH. */
  readonly executable?: string;
  /** How long a build may take. Installing the CLI pulls from npm. */
  readonly timeoutMs?: number;
}

/**
 * Builds the image if the daemon does not already hold the tag, and returns
 * the tag.
 *
 * Building on the host is deliberate: the host's network is the developer's
 * own, and the container this produces reaches only what the sandbox's egress
 * allowlist grants it. Nothing from the repository is copied in, so a stale
 * image cannot serve a task an old copy of the tree — the workspace arrives
 * at run time as the sandbox's one writable mount.
 */
export async function ensureImage(options: EnsureImageOptions = {}): Promise<string> {
  const executable = options.executable ?? 'docker';
  const timeoutMs = options.timeoutMs ?? 600_000;
  const tag = imageTag();

  const present = await docker(executable, ['image', 'inspect', tag], 60_000).catch((error: unknown) => {
    refuse('image', `the Docker daemon could not be reached to look for ${tag}: ${String(error)}`);
  });
  if (present.exitCode === 0) return tag;

  const built = await docker(
    executable,
    [
      'build',
      '--build-arg', `BASE=${BASE_IMAGE}`,
      '--build-arg', `CLI_VERSION=${CLI_VERSION}`,
      '--tag', tag,
      imageContext(),
    ],
    timeoutMs,
  ).catch((error: unknown) => {
    refuse('image', `building ${tag} did not finish: ${String(error)}`);
  });
  if (built.exitCode !== 0) {
    refuse('image', `building ${tag} failed with exit code ${String(built.exitCode)}: ${built.stderr.trim()}`);
  }
  return tag;
}
