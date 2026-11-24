/**
 * The image a task runs in.
 *
 * No published image carries the Codex CLI, so this package builds one
 * rather than pulling one. Every input is pinned: the base by digest, and the
 * CLI and each of its platform packages by `sha512` in `image/cli-lock.json`,
 * which the image installs from and never by name (R53). A version number
 * names a release, not its contents; the lockfile names the contents, so a
 * version bump is a reviewed lockfile diff and cannot happen through the
 * registry alone.
 *
 * The image is checked by content too. `ensureImage` returns the content ID
 * of an image this host recorded building, and refuses any other the daemon
 * holds under the tag; the line provisions from that ID and records it in
 * the evidence as `harnessImage` (A-R53-01).
 *
 * This is beside the image `packages/sandbox` pins for its own suite, not
 * downstream of it: that one is an alpine that has to run `sh`, this one has
 * to run a model runner, and neither should move because the other did.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { harnessLockProblems, recordedImage, SandboxRefusal } from '@olympus-ai/sandbox';
import { refuse } from './refusal.js';

/** The base, by digest. `node:22-bookworm-slim` at the time it was pinned. */
export const BASE_IMAGE = 'node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5';

/** The CLI's package. */
export const CLI_PACKAGE = '@openai/codex';

/**
 * The CLI, by exact version: the version the lockfile pins, which
 * `ensureImage` refuses to build if the two differ. The provenance ID and the
 * model identity report it.
 */
export const CLI_VERSION = '0.166.0';

/** Every file of the build context, each hashed into the tag. */
const CONTEXT_FILES = ['Dockerfile', 'package.json', 'cli-lock.json', 'check-install.js', 'catalog.js'] as const;

/**
 * Where this host records the content ID of every image it built. A tag the
 * daemon holds with an ID not recorded here is refused. Removing a record
 * makes the next start refuse its image until the image is removed and
 * rebuilt; it never makes an image trusted.
 */
export const IMAGE_RECORDS = join(homedir(), '.factory', 'images');

/**
 * The tag the built image carries, derived from everything that decides what is
 * in it: every file of the build context, the catalog generator among them,
 * and the base digest.
 *
 * A tag naming the CLI version alone does not identify the image. Deriving the
 * tag from the inputs means different inputs are a different tag, and a
 * different tag is a build: a changed lockfile builds a new image rather than
 * leaving an old one running under a report that hashes the new source.
 */
export function imageTag(): string {
  const hash = createHash('sha256').update(`${BASE_IMAGE}\n${CLI_VERSION}\n`);
  for (const file of CONTEXT_FILES) hash.update(`${file}\n`).update(readFileSync(join(imageContext(), file)));
  return `factory-codex:${CLI_VERSION}-${hash.digest('hex').slice(0, 16)}`;
}

/** The directory holding the Dockerfile, resolved from this module rather than from the caller's cwd. */
export function imageContext(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'image');
}

/** Why the image's manifest and lockfile do not pin `CLI_VERSION` by content, or none. */
export function lockProblems(): string[] {
  const read = (file: string): unknown => JSON.parse(readFileSync(join(imageContext(), file), 'utf8'));
  return harnessLockProblems(read('package.json'), read('cli-lock.json'), { name: CLI_PACKAGE, version: CLI_VERSION });
}

export interface EnsureImageOptions {
  /** The Docker executable. Defaults to `docker` on PATH. */
  readonly executable?: string;
  /** How long a build may take. Installing the CLI pulls from npm. */
  readonly timeoutMs?: number;
  /** Where built images are recorded. Defaults to `IMAGE_RECORDS`. */
  readonly records?: string;
}

/**
 * The content ID of the image a task runs in: built if the daemon does not
 * hold the tag, accepted if it holds the tag as an image this host recorded
 * building, and refused otherwise. A lockfile that does not pin the CLI by
 * content is refused before anything is built (I5).
 *
 * Building on the host is deliberate: the host's network is the developer's
 * own, and the container this produces reaches only what the sandbox's egress
 * allowlist grants it. Nothing from the repository is copied in, so a stale
 * image cannot serve a task an old copy of the tree — the workspace arrives
 * at run time as the sandbox's one writable mount.
 */
export async function ensureImage(options: EnsureImageOptions = {}): Promise<string> {
  const problems = lockProblems();
  if (problems.length > 0) refuse('image', `the image's lockfile does not pin the CLI by content, so nothing was built: ${problems.join('; ')}`);
  try {
    return await recordedImage({
      tag: imageTag(),
      context: imageContext(),
      buildArgs: { BASE: BASE_IMAGE },
      records: options.records ?? IMAGE_RECORDS,
      ...(options.executable === undefined ? {} : { executable: options.executable }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    });
  } catch (error) {
    if (error instanceof SandboxRefusal) refuse('image', error.message);
    throw error;
  }
}
