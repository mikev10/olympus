#!/usr/bin/env node
/**
 * The `factory-host` executable: the runtime as a service over the production
 * composition. Configured from its environment and nothing else, it touches
 * no terminal (I9); a client finds it at the address it was told to listen on.
 *
 * Every variable it reads is declared in `HOST_VARIABLES` (`config.ts`), and
 * this file reads the environment only through `readHostConfig`. Every
 * missing or invalid variable, an unreadable endpoint file, and a trees
 * directory that cannot hold a symbolic link stop the host before it listens,
 * with one list and no stack trace (I5).
 */
import { readFile } from 'node:fs/promises';
import { GitHubCheckReader } from '../checks.js';
import { createApiServer } from '../http/server.js';
import { readHostConfig, refusalText } from './config.js';
import { composeHost, parseEndpointFile } from './compose.js';
import { probeSymlinks } from './symlinks.js';

function refuse(problems: readonly string[]): never {
  process.stderr.write(`${refusalText(problems)}\n`);
  process.exit(1);
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^factory-host: /u, '');
}

const read = readHostConfig(process.env);
if (!read.ok) refuse(read.problems);
const config = read.settings;

const problems: string[] = [];
let endpoint = null;
if (config.endpoint !== null) {
  try {
    endpoint = parseEndpointFile(await readFile(config.endpoint.file, 'utf8'), config.endpoint.key);
  } catch (error) {
    problems.push(`FACTORY_ENDPOINT_CONFIG (${config.endpoint.file}): ${message(error)}`);
  }
}
const links = await probeSymlinks(config.trees);
if (links !== null) problems.push(links);
if (problems.length > 0) refuse(problems);

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
  });
} catch (error) {
  refuse([message(error)]);
}
await server.listen(config.port, config.listenHost);

process.on('SIGTERM', () => {
  void server.close();
});
