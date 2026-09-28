/**
 * The `olympus-ai` executable: the terminal half of the CLI. Everything it does
 * is `runCli` over the process's argv, environment, and streams; the runtime
 * it talks to is wherever `--url` points (I9).
 */
import { runCli } from './cli.js';

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  fetch: globalThis.fetch,
  out: (line) => { process.stdout.write(`${line}\n`); },
  err: (line) => { process.stderr.write(`${line}\n`); },
});
