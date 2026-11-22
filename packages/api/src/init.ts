/**
 * `init` (R36b): the setup a first run needs, written so no file is written
 * by hand. Outside the repository, in a configuration directory: the policy,
 * the roles, the rubrics, and the host's environment file. Inside it, under
 * `.factory/`: a verification manifest and a task graph for the stack the
 * adapter set detects. Policy, roles, and rubrics stay out of every tree a
 * model can write (I1, I3).
 *
 * Every refusal comes before the first write (I5): a stack the detector
 * cannot serve, a file that already exists, a merge target that is not a
 * GitHub repository, a configuration directory inside the repository. Either
 * every file is written or none is.
 *
 * Nothing here writes to a terminal; the caller prints the outcome (I9).
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';
import { buildAdapterSet, PYPI_REGISTRIES, SECRET_SCAN_IMAGE, STATIC_ANALYSIS_IMAGE } from '@olympus-ai/adapters';
import { DEFAULT_RUBRICS_DIRECTORY } from './rubrics.js';

const run = promisify(execFile);

/** What `init` copies from: the shipped examples' policy and roles, byte for byte (D-R36b-04). */
export const SETUP_DIRECTORY: string = fileURLToPath(new URL('../setup/', import.meta.url));

/** The directory under the repository that holds the run files `init` writes. */
export const RUN_FILES_DIRECTORY = '.factory';

/** The configuration directory's name under the home directory, when none is named. */
export const CONFIG_DIRECTORY_NAME = '.factory';

/** The environment file's name in the configuration directory. */
export const HOST_ENV_FILE = 'host.env';

/** The port the host listens on, as `init` writes it. */
export const DEFAULT_PORT = 7300;

/** The container user written on a host with no uids: not root, and the one the conformance rigs use (D-R36b-04). */
export const NO_UID_CONTAINER_USER = { uid: 1000, gid: 1000 } as const;

export interface InitRequest {
  /** The repository's working copy, or any directory in it; its top level is what runs are admitted from. */
  readonly repository: string;
  /** Absolute. Where the policy, roles, rubrics, and environment file go. */
  readonly configDirectory: string;
  /** The branch a passed run merges into. Never guessed. */
  readonly baseBranch: string;
  /** Whether this host has uids. On one with none, the container user is written too. */
  readonly hostHasUids: boolean;
}

export type InitRefusal =
  | 'not-a-repository'
  | 'not-github'
  | 'bad-branch'
  | 'config-inside-repository'
  | 'unsupported-stack'
  | 'exists'
  | 'unwritable-value';

export type InitOutcome =
  | {
      readonly ok: true;
      /** The repository's top level, as the environment file names it. */
      readonly repository: string;
      readonly stack: string;
      readonly envFile: string;
      readonly manifest: string;
      readonly graph: string;
      /** Every file written, absolute. */
      readonly written: readonly string[];
    }
  | { readonly ok: false; readonly reason: InitRefusal; readonly message: string };

function refused(reason: InitRefusal, message: string): InitOutcome {
  return { ok: false, reason, message };
}

async function git(dir: string, ...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['-C', dir, ...args], { encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return null;
  }
}

/** `owner/name` from a GitHub remote URL, https or ssh, or null for anything else. */
export function githubRepository(url: string): string | null {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(url);
  if (match === null) return null;
  const [, owner, name] = match;
  return owner === undefined || name === undefined ? null : `${owner}/${name}`;
}

/** Whether `inner` is `outer` or under it. */
function within(outer: string, inner: string): boolean {
  const rel = relative(outer, inner);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Whether anything is at `path`, a link included: `lstat`, so a dangling link
 * is something there, as the exclusive writes below will find it (R36b review,
 * codex-2). Only an absent entry is absence; any other error is thrown, never
 * read as room to write (I5).
 */
async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

/** The manifest for a detected stack: the suite, and the two scanners, each pinned to the image admission declares. */
export function stackManifest(language: 'node' | 'python'): { checks: unknown[] } {
  const languages = language === 'python' ? '[python]' : '[javascript, typescript]';
  return {
    checks: [
      { id: 'unit', kind: 'unit', required: true, timeoutMs: 600000 },
      { id: 'secret-scan', kind: 'secret-scan', image: SECRET_SCAN_IMAGE, config: null, required: true, timeoutMs: 120000 },
      {
        id: 'static-analysis', kind: 'static-analysis', image: STATIC_ANALYSIS_IMAGE, required: true, timeoutMs: 180000,
        config: `rules:\n  - id: no-eval\n    languages: ${languages}\n    severity: ERROR\n    message: eval runs a string as code\n    pattern: eval(...)\n`,
      },
    ],
  };
}

/** One build task and the review task every build task needs. */
export const INIT_GRAPH = {
  tasks: [
    { id: 'change', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] },
    { id: 'change-review', station: 'review', role: 'reviewer', dependsOn: ['change'], dependencySet: ['**'] },
  ],
} as const;

/** The shipped policy, with a Python stack's registries and manifest in place of Node.js's. */
export function stackPolicy(shipped: string, language: 'node' | 'python'): string {
  if (language === 'node') return shipped;
  const registries = 'installRegistries: [registry.npmjs.org]';
  const protectedPath = '  - "package.json"';
  if (!shipped.includes(registries) || !shipped.includes(protectedPath)) {
    throw new Error('init: the shipped policy no longer holds the Node.js registry and protected path a Python stack replaces');
  }
  return shipped.replace(registries, `installRegistries: [${PYPI_REGISTRIES.join(', ')}]`).replace(protectedPath, '  - "pyproject.toml"');
}

/**
 * Writes the setup for `request.repository`, or refuses before writing
 * anything. The environment file holds no model key and no git token:
 * those are set in the host's environment by hand.
 */
export async function initSetup(request: InitRequest): Promise<InitOutcome> {
  if (!isAbsolute(request.configDirectory)) return refused('unwritable-value', `the configuration directory must be an absolute path, not ${request.configDirectory}`);
  const top = await git(resolve(request.repository), 'rev-parse', '--show-toplevel');
  if (top === null || top === '') return refused('not-a-repository', `${request.repository} is not in a git working copy`);
  const repository = resolve(top);
  const remote = await git(repository, 'remote', 'get-url', 'origin');
  const target = remote === null ? null : githubRepository(remote);
  if (target === null) {
    return refused('not-github', remote === null ? 'the repository has no origin remote, and a passed run merges into a GitHub repository' : `origin is ${remote}, which is not a GitHub repository; a passed run merges into one`);
  }
  if (request.baseBranch === '' || (await git(repository, 'check-ref-format', '--branch', request.baseBranch)) === null) {
    return refused('bad-branch', `'${request.baseBranch}' is not a branch name`);
  }
  const config = resolve(request.configDirectory);
  if (within(repository, config) || within(config, repository)) {
    return refused('config-inside-repository', `the configuration directory ${config} and the repository ${repository} overlap; policy, roles, and rubrics must stay outside every tree a model can write`);
  }

  // The one detector (P8, R29): what it calls unsupported, nothing here backs.
  const set = await buildAdapterSet(repository, { provider: null, coverage: null });
  if (set.test === null) {
    return refused('unsupported-stack', `no supported stack was found in ${repository}: ${set.reasons.get('test') ?? 'no test framework is declared'}. Supported: vitest or jest in package.json, or pytest`);
  }
  const language = set.stack.startsWith('pytest@') ? 'python' : 'node';

  const roles = (await readdir(join(SETUP_DIRECTORY, 'roles'))).filter((f) => f.endsWith('.md')).sort();
  const rubrics = (await readdir(DEFAULT_RUBRICS_DIRECTORY)).filter((f) => f.endsWith('.md')).sort();
  const runFiles = join(repository, RUN_FILES_DIRECTORY);
  const paths = {
    policy: join(config, 'policy.yaml'),
    roles: join(config, 'roles'),
    rubrics: join(config, 'rubrics'),
    vault: join(config, 'vault'),
    trees: join(config, 'trees'),
    env: join(config, HOST_ENV_FILE),
    manifest: join(runFiles, 'verify.json'),
    graph: join(runFiles, 'graph.json'),
  };

  const env: Array<[string, string]> = [
    ['FACTORY_API_TOKEN', randomBytes(32).toString('hex')],
    ['FACTORY_LISTEN_PORT', String(DEFAULT_PORT)],
    ['FACTORY_POLICY_FILE', paths.policy],
    ['FACTORY_ROLES_DIR', paths.roles],
    ['FACTORY_RUBRICS_DIR', paths.rubrics],
    ['FACTORY_VAULT_STORE', paths.vault],
    ['FACTORY_REPOSITORY', repository],
    ['FACTORY_TREES', paths.trees],
    ['FACTORY_GIT_REPOSITORY', target],
    ['FACTORY_GIT_BASE_BRANCH', request.baseBranch],
    ...(request.hostHasUids ? [] : [['FACTORY_CONTAINER_UID', String(NO_UID_CONTAINER_USER.uid)], ['FACTORY_CONTAINER_GID', String(NO_UID_CONTAINER_USER.gid)]] as Array<[string, string]>),
  ];
  const envText = [
    `# The host's configuration, written by init for ${repository}.`,
    '# Start the host with: factory-host --env-file <this file>',
    '# init writes no secret: set ANTHROPIC_API_KEY and FACTORY_GIT_TOKEN in the environment, or add them to this file.',
    ...env.map(([name, value]) => `${name}=${value}`),
    '',
  ].join('\n');
  // A value the file cannot carry back unchanged (a quote, a #, a line break in a path) is refused, not mangled.
  const parsed = parseEnv(envText);
  const unwritable = env.filter(([name, value]) => parsed[name] !== value).map(([name]) => name);
  if (unwritable.length > 0) return refused('unwritable-value', `these values cannot be written to an environment file unchanged: ${unwritable.join(', ')}`);

  const files = [
    paths.policy, paths.env, paths.manifest, paths.graph,
    ...roles.map((f) => join(paths.roles, f)),
    ...rubrics.map((f) => join(paths.rubrics, f)),
  ];
  const present = (await Promise.all(files.map(async (f) => ((await exists(f)) ? f : null)))).filter((f): f is string => f !== null);
  if (present.length > 0) return refused('exists', `refused to overwrite, and nothing was written: ${present.join(', ')}`);

  const policy = stackPolicy(await readFile(join(SETUP_DIRECTORY, 'policy.yaml'), 'utf8'), language);
  for (const dir of [paths.roles, paths.rubrics, paths.vault, paths.trees, runFiles]) await mkdir(dir, { recursive: true });
  // `wx`: a file that appeared since the check above is still not overwritten.
  const write = (path: string, text: string): Promise<void> => writeFile(path, text, { flag: 'wx' });
  await write(paths.policy, policy);
  for (const f of roles) await copyFile(join(SETUP_DIRECTORY, 'roles', f), join(paths.roles, f), constants.COPYFILE_EXCL);
  for (const f of rubrics) await copyFile(join(DEFAULT_RUBRICS_DIRECTORY, f), join(paths.rubrics, f), constants.COPYFILE_EXCL);
  await mkdir(dirname(paths.env), { recursive: true });
  await writeFile(paths.env, envText, { flag: 'wx', mode: 0o600 });
  // The token is a secret: readable by its owner alone, where the host has modes.
  if (request.hostHasUids) await chmod(paths.env, 0o600);
  await write(paths.manifest, `${JSON.stringify(stackManifest(language), null, 2)}\n`);
  await write(paths.graph, `${JSON.stringify(INIT_GRAPH, null, 2)}\n`);
  return { ok: true, repository, stack: set.stack, envFile: paths.env, manifest: paths.manifest, graph: paths.graph, written: files };
}

/** The client's executable name, exactly: the one spelling the name scan exempts. */
const CLI = 'olympus-ai';

/** What `factory-host init` prints: what it wrote, or why it refused, then the two commands that follow. */
export function initReport(outcome: InitOutcome): string[] {
  if (!outcome.ok) return [`init refused (${outcome.reason}): ${outcome.message}`];
  return [
    `stack: ${outcome.stack}`,
    ...outcome.written.map((file) => `wrote ${file}`),
    '',
    'next, with ANTHROPIC_API_KEY and FACTORY_GIT_TOKEN set in the environment:',
    `  factory-host --env-file ${outcome.envFile}`,
    'then, in another terminal, from the repository:',
    `  ${CLI} --env-file ${outcome.envFile} create --workspace ${outcome.repository} --base-commit <full sha of HEAD> --level 1 --draft-spec --draft-tests --intent "<what to change>" --manifest ${RUN_FILES_DIRECTORY}/verify.json --graph ${RUN_FILES_DIRECTORY}/graph.json`,
  ];
}
