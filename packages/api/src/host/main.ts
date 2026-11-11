#!/usr/bin/env node
/**
 * The `factory-host` executable: the runtime as a service over the production
 * composition. Configured from its environment and nothing else, it touches
 * no terminal (I9); a client finds it at the address it was told to listen on.
 *
 * Every variable it reads is declared in `HOST_VARIABLES` (`config.ts`), and
 * this file reads the environment only through `checkStartup`, which reads it
 * only through `readHostConfig`. Every missing or invalid variable, an
 * unreadable endpoint file, and a trees directory that cannot hold a symbolic
 * link stop the host before it listens, with one list and no stack trace (I5).
 *
 * That list is the one thing this package writes to a terminal, and only this
 * file may (A-HS-01): the executable reports why it did not start, as the
 * CLI's own entry does. Nothing it starts prints anything.
 */
import { GitHubCheckReader } from '../checks.js';
import { createApiServer } from '../http/server.js';
import { GitHubBranchProtection, readinessScanner } from '../readiness-scan.js';
import { checkStartup, HostRefusal } from './config.js';
import { composeHost } from './compose.js';

/** Thrown by start-up and caught once, below, where the list is printed. */
function refuse(problems: readonly string[]): never {
  throw new HostRefusal(problems);
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^factory-host: /u, '');
}

async function start(): Promise<void> {
  // The environment, the endpoint file, and the symlink probe, all into one list before anything is composed.
  const startup = await checkStartup(process.env);
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
      // R1's scan over the working copy runs are admitted from, read-only (R35, D-R35-06).
      readiness: readinessScanner({
        components, repository: config.repository, policyFile: config.policyFile,
        branchProtection: new GitHubBranchProtection({ repository: config.git.repository, branch: config.git.baseBranch, token: config.git.token }),
      }),
    });
  } catch (error) {
    refuse([message(error)]);
  }
  await server.listen(config.port, config.listenHost);

  process.on('SIGTERM', () => {
    void server.close();
  });
}

try {
  await start();
} catch (error) {
  // Anything but a refusal is a fault, and keeps its stack.
  if (!(error instanceof HostRefusal)) throw error;
  // The executable's one terminal write, and the scan's one exemption in this package: the refusal as a
  // list, with no stack, and a non-zero exit (A-HS-01).
  process.stderr.write(`factory-host: ${error.message}\n`);
  process.exitCode = 1;
}
