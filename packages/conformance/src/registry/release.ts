/**
 * `I9.packaged-host-runs` (R35, #55): the one supported way to run, tested as
 * a user runs it. `scripts/local-release.ts` builds every released package,
 * packs each as npm would publish it, and installs the tarballs into an empty
 * directory. Then, from that install and nothing in the checkout:
 *
 * - every installed `bin` names JavaScript the tarball holds;
 * - `factory-host`, started from its `bin` with nothing set, refuses with
 *   every required variable in one list, no stack frame, and a non-zero exit,
 *   before it listens (I5);
 * - `factory-host`, configured with the shipped examples, listens, headless,
 *   and `olympus-ai`, started from its own `bin` as a separate process, reaches
 *   it over HTTP and nothing else (I9).
 *
 * A `bin` pointing at TypeScript, a missing shebang, a file the tarball does
 * not ship, an install that reaches back into the checkout, or a refusal that
 * prints a stack fails here.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceRoot } from '../kit/workspace.js';

const BUILD_MS = 600_000;
const LISTEN_MS = 600_000;
/** Required variables a refusal must name; the table in packages/api/src/host/config.ts is their source. */
const REQUIRED = [
  'FACTORY_API_TOKEN', 'FACTORY_LISTEN_PORT', 'FACTORY_POLICY_FILE', 'FACTORY_ROLES_DIR', 'FACTORY_VAULT_STORE',
  'FACTORY_REPOSITORY', 'FACTORY_TREES', 'ANTHROPIC_API_KEY', 'FACTORY_GIT_REPOSITORY', 'FACTORY_GIT_BASE_BRANCH', 'FACTORY_GIT_TOKEN',
];

interface Ran { readonly code: number | null; readonly stdout: string; readonly stderr: string }

/** The variables a child process needs to find node, git, and Docker, and nothing of the factory's. */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_HOST', 'DOCKER_CONFIG', 'ProgramFiles', 'ComSpec']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function run(command: string, args: readonly string[], options: { cwd?: string; env?: Record<string, string>; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolveRan, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env ?? baseEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`I9: ${command} ${args.join(' ')} did not finish in ${String(options.timeoutMs)} ms`)); }, options.timeoutMs);
    child.on('error', reject);
    child.on('close', (code) => { clearTimeout(timer); resolveRan({ code, stdout, stderr }); });
  });
}

/** The file an installed package's `bin` names, which must be JavaScript the tarball shipped. */
function installedBin(install: string, pkg: string, name: string): string {
  const dir = join(install, 'node_modules', ...pkg.split('/'));
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { bin?: Record<string, string> };
  const target = manifest.bin?.[name];
  if (target === undefined) throw new Error(`I9: the installed ${pkg} has no bin named ${name}`);
  if (!target.endsWith('.js')) throw new Error(`I9: the installed ${pkg}'s bin ${name} is ${target}, not JavaScript`);
  const file = join(dir, target);
  if (!existsSync(file)) throw new Error(`I9: the installed ${pkg}'s bin ${name} names ${target}, which the tarball does not hold`);
  if (!readFileSync(file, 'utf8').startsWith('#!/usr/bin/env node\n')) throw new Error(`I9: ${pkg}'s bin ${name} has no node shebang, so it cannot be run as a command`);
  return file;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => { resolvePort(port); });
    });
  });
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  const ran = await run('git', ['-c', 'user.name=conformance', '-c', 'user.email=conformance@invalid', ...args], { cwd, timeoutMs: 60_000 });
  if (ran.code !== 0) throw new Error(`I9: git ${args.join(' ')} exited ${String(ran.code)}: ${ran.stderr}`);
}

export async function assertPackagedHostRuns(): Promise<void> {
  const root = workspaceRoot();
  const dir = await mkdtemp(join(tmpdir(), 'r35-release-'));
  let host: ChildProcess | undefined;
  try {
    const install = join(dir, 'install');
    const released = await run(process.execPath, [join(root, 'scripts', 'local-release.ts'), install], { cwd: root, env: { ...baseEnv() }, timeoutMs: BUILD_MS });
    if (released.code !== 0) throw new Error(`I9: the local release failed\n${released.stderr}`);
    const hostBin = installedBin(install, '@olympus-ai/api', 'factory-host');
    const cliBin = installedBin(install, 'olympus-ai', 'olympus-ai');
    if (hostBin.startsWith(root) || cliBin.startsWith(root)) throw new Error('I9: an installed bin resolves into the checkout');

    // Nothing set: one refusal naming every required variable, no frame, a non-zero exit.
    const refused = await run(process.execPath, [hostBin], { cwd: dir, timeoutMs: 60_000 });
    if (refused.code === 0) throw new Error('I9: factory-host started with nothing set');
    const missing = REQUIRED.filter((name) => !refused.stderr.includes(`${name} is not set`));
    if (missing.length > 0) throw new Error(`I9: the refusal does not name ${missing.join(', ')}\n${refused.stderr}`);
    if (/^\s+at /mu.test(refused.stderr)) throw new Error(`I9: the refusal prints a stack trace\n${refused.stderr}`);
    if (!refused.stderr.includes('.env.example')) throw new Error(`I9: the refusal does not say where the variables are described\n${refused.stderr}`);

    // Configured from the shipped examples: the host listens and the CLI reaches it.
    const repository = join(dir, 'repo');
    await mkdir(repository);
    await git(repository, 'init', '--quiet', '--initial-branch=main');
    await writeFile(join(repository, 'README.md'), 'a repository for the packaged-host assertion\n');
    await git(repository, 'add', 'README.md');
    await git(repository, 'commit', '--quiet', '-m', 'base');
    await cp(join(root, 'examples', 'roles'), join(dir, 'roles'), { recursive: true });
    const token = randomBytes(24).toString('hex');
    const port = await freePort();
    const env: Record<string, string> = {
      ...baseEnv(),
      FACTORY_API_TOKEN: token, FACTORY_LISTEN_PORT: String(port), FACTORY_POLICY_FILE: join(root, 'examples', 'policy.yaml'),
      FACTORY_ROLES_DIR: join(dir, 'roles'), FACTORY_VAULT_STORE: join(dir, 'store'), FACTORY_REPOSITORY: repository, FACTORY_TREES: join(dir, 'trees'),
      ANTHROPIC_API_KEY: 'unused-no-run-is-started', FACTORY_GIT_REPOSITORY: 'example/unused', FACTORY_GIT_BASE_BRANCH: 'main', FACTORY_GIT_TOKEN: 'unused',
      // A host with no uids names who sandboxes run as (D-I1b-10); one with them derives it.
      ...(process.getuid === undefined ? { FACTORY_CONTAINER_UID: '1000', FACTORY_CONTAINER_GID: '1000' } : {}),
    };
    let hostErr = '';
    const started = spawn(process.execPath, [hostBin], { cwd: dir, env, stdio: ['ignore', 'ignore', 'pipe'] });
    host = started;
    started.stderr.on('data', (chunk: Buffer) => { hostErr += chunk.toString('utf8'); });
    const url = `http://127.0.0.1:${String(port)}`;
    const cli = (...args: string[]): Promise<Ran> => run(process.execPath, [cliBin, ...args, '--url', url, '--token', token], { cwd: dir, env: baseEnv(), timeoutMs: 60_000 });
    const deadline = Date.now() + LISTEN_MS;
    for (;;) {
      if (started.exitCode !== null) throw new Error(`I9: the configured factory-host exited ${String(started.exitCode)}\n${hostErr}`);
      const ran = await cli('outcomes');
      if (ran.code === 0) {
        JSON.parse(ran.stdout);
        break;
      }
      if (Date.now() > deadline) throw new Error(`I9: factory-host did not answer within ${String(LISTEN_MS)} ms\n${ran.stderr}\n${hostErr}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const unknown = await cli('status', 'no-such-run');
    if (unknown.code !== 1 || !unknown.stderr.includes('error 404')) throw new Error(`I9: the CLI did not report the host's 404 for an unknown run\n${unknown.stderr}`);
    const help = await run(process.execPath, [cliBin, 'create', '--help'], { cwd: dir, env: baseEnv(), timeoutMs: 60_000 });
    if (help.code !== 0 || !help.stdout.includes('--workspace')) throw new Error(`I9: the installed CLI's create --help failed\n${help.stderr}`);
  } finally {
    if (host?.exitCode === null) {
      const exited = new Promise((r) => host?.once('exit', r));
      host.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
