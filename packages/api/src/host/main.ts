#!/usr/bin/env node
/**
 * The `factory-host` executable: the runtime as a service over the production
 * composition. Configured from its environment, and from the one file
 * `--env-file <path>` names, read through the same table (#134). It touches
 * no terminal (I9); a client finds it at the address it was told to listen on.
 *
 * Every variable it reads is declared in `HOST_VARIABLES` (`config.ts`), and
 * this file reads the environment only through `checkStartup`, which reads it
 * only through `readHostConfig`. Every missing or invalid variable, an
 * unreadable endpoint file, and a trees directory that cannot hold a symbolic
 * link stop the host before it listens, with one list and no stack trace (I5).
 *
 * `factory-host init` writes the setup a first run needs instead of starting
 * (R36b, D-R36b-07): the host owns the runtime code and the file it writes,
 * so the CLI stays a client with no runtime dependency (I9).
 *
 * Only this file in this package writes to a terminal or reads its arguments
 * (A-HS-01, A-HS-03, D-R36b-05), and it writes four things to stderr: why
 * the executable did not start, as the CLI's own entry does; what `init`
 * wrote or why it refused; one line once it listens, naming where and the
 * repository it admits (#139); and the one line the service gives it per
 * failed attempt. Nothing it starts prints anything itself.
 */
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { GitHubCheckReader } from '../checks.js';
import { createApiServer } from '../http/server.js';
import { GitHubBranchProtection, readinessScanner } from '../readiness-scan.js';
import { CONFIG_DIRECTORY_NAME, initReport, initSetup } from '../init.js';
import { checkStartup, hostFacts, HostRefusal, listenProblem, mergeEnvFile } from './config.js';
import { composeHost } from './compose.js';

/** Thrown by start-up and caught once, below, where the list is printed. */
function refuse(problems: readonly string[]): never {
  throw new HostRefusal(problems);
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^factory-host: /u, '');
}

/** The environment, merged with the file `--env-file` names; any other argument is refused. */
async function environment(args: readonly string[], env: Readonly<Record<string, string | undefined>>): Promise<Readonly<Record<string, string | undefined>>> {
  if (args.length === 0) return env;
  const [flag, file, ...rest] = args;
  if (flag !== '--env-file' || file === undefined || file === '' || rest.length > 0) refuse(['the only argument is --env-file <path>']);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    refuse([`--env-file ${file} could not be read: ${message(error)}`]);
  }
  const merged = mergeEnvFile(file, text, env);
  if (!merged.ok) refuse(merged.problems);
  return merged.env;
}

/** `factory-host init --base-branch <branch> [--repository <path>] [--config-dir <path>]`: the setup, written or refused. */
async function init(args: readonly string[]): Promise<void> {
  let values: { 'base-branch'?: string | undefined; repository?: string | undefined; 'config-dir'?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...args], strict: true, allowPositionals: false,
      options: { 'base-branch': { type: 'string' }, repository: { type: 'string' }, 'config-dir': { type: 'string' } },
    }));
  } catch (error) {
    values = {};
    process.stderr.write(`factory-host: init: ${message(error)}\n`);
  }
  const baseBranch = values['base-branch'];
  if (baseBranch === undefined || baseBranch === '') {
    process.stderr.write('factory-host: init: usage: factory-host init --base-branch <branch> [--repository <path>] [--config-dir <abs path>]\n');
    process.exitCode = 2;
    return;
  }
  const outcome = await initSetup({
    repository: resolve(values.repository ?? '.'),
    configDirectory: resolve(values['config-dir'] ?? join(homedir(), CONFIG_DIRECTORY_NAME)),
    baseBranch,
    hostHasUids: hostFacts().uids,
  });
  for (const line of initReport(outcome)) process.stderr.write(`${line}\n`);
  if (!outcome.ok) process.exitCode = 1;
}

async function start(): Promise<void> {
  // The environment, the endpoint file, and the symlink probe, all into one list before anything is composed.
  const startup = await checkStartup(await environment(process.argv.slice(2), process.env));
  if (!startup.ok) refuse(startup.problems);
  const config = startup.settings;
  const { endpoint } = startup;

  let server;
  try {
    const components = await composeHost({
      ...(config.containerUser === undefined ? {} : { containerUser: config.containerUser }),
      endpoint,
      codex: config.codex,
      store: config.store,
      repository: config.repository,
      trees: config.trees,
      modelKey: config.modelKey,
      git: config.git,
    });
    server = createApiServer({
      components,
      token: config.token,
      principal: config.principal,
      policyFile: config.policyFile,
      rolesDirectory: config.rolesDirectory,
      secrets: config.webhookSecret,
      // The nightly sweep scans the branch runs merge into, as the working copy holds it (D-R13a-04).
      nightlyTarget: {
        checkout: config.repository, branch: config.git.baseBranch,
        checks: config.checksToken === null ? null : new GitHubCheckReader({ repository: config.git.repository, token: config.checksToken }),
      },
      rubricsDirectory: config.rubricsDirectory,
      // The service hands over one flattened line per failed attempt; the host prints it (A-HS-03, D-R36a-13).
      log: (line) => {
        process.stderr.write(`factory-host: ${line}
`);
      },
      // R1's scan over the working copy runs are admitted from, read-only (R35, D-R35-06).
      readiness: readinessScanner({
        components, repository: config.repository, policyFile: config.policyFile,
        branchProtection: new GitHubBranchProtection({ repository: config.git.repository, branch: config.git.baseBranch, token: config.git.token }),
      }),
    });
  } catch (error) {
    refuse([message(error)]);
  }
  try {
    await server.listen(config.port, config.listenHost);
  } catch (error) {
    refuse([listenProblem(config.listenHost, config.port, error)]);
  }
  // One line once listening, so a started host is not mistaken for a hung one (#139). No secret is in it.
  process.stderr.write(`factory-host: listening on http://${config.listenHost}:${String(config.port)}, admitting runs from ${config.repository}; stop with Ctrl+C\n`);

  process.on('SIGTERM', () => {
    void server.close();
  });
}

try {
  const args = process.argv.slice(2);
  if (args[0] === 'init') await init(args.slice(1));
  else await start();
} catch (error) {
  // Anything but a refusal is a fault, and keeps its stack.
  if (!(error instanceof HostRefusal)) throw error;
  // The executable's one terminal write, and the scan's one exemption in this package: the refusal as a
  // list, with no stack, and a non-zero exit (A-HS-01).
  process.stderr.write(`factory-host: ${error.message}\n`);
  process.exitCode = 1;
}
