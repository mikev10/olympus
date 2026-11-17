#!/usr/bin/env node
/**
 * The `olympus-ai` executable: the terminal half of the CLI. Everything it does
 * is `runCli` over the process's argv, environment, and streams; the runtime
 * it talks to is wherever `--url` points (I9). `init` alone runs code of the
 * runtime's package, loaded here only when that is the command (D-R36b-04).
 */
import { homedir } from 'node:os';
import { runCli } from './cli.js';

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  fetch: globalThis.fetch,
  out: (line) => { process.stdout.write(`${line}\n`); },
  err: (line) => { process.stderr.write(`${line}\n`); },
  init: async (request) => (await import('@olympus-ai/api')).initSetup(request),
  home: homedir(),
  hostHasUids: process.getuid !== undefined && process.getgid !== undefined,
});
