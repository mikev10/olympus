/**
 * The invariant assertions the Codex driver owes (R26), each external in
 * `@olympus-ai/driver-codex` and counted only after reconciliation against
 * that package's run report.
 *
 * The paid ones run under the `run-driver` label, with `OPENAI_API_KEY`, as
 * the Claude Code driver's do (D-A-CI-05). Its claim assertions are named in
 * `claims.ts`, and its workspace-instruction assertion in
 * `workspace-instructions.ts`, from the titles below.
 */
import { external } from '../kit/assert.js';

export const CODEX_PACKAGE = '@olympus-ai/driver-codex';
const INVARIANTS = 'test/invariants.test.ts';

/** I1: the CLI runs only through provider.exec, and the mount layer keeps the Vault out of its sandbox. */
export const CODEX_EXECUTES_INSIDE_THE_SANDBOX = external({
  id: 'I1.codex-driver-executes-inside-the-sandbox',
  title:
    "a task's commands run inside the provisioned sandbox and reach the host only through the workspace mount, no mount is the Vault, a Vault mount is refused, and a driver with no provider cannot be constructed",
  level: 'runtime',
  package: CODEX_PACKAGE,
  file: INVARIANTS,
});

/** I4: the session offers exactly the grant, read from its own request before every task (D-R26-02). */
export const CODEX_TOOL_INVENTORY_VALIDATED = external({
  id: 'I4.codex-driver-tool-inventory-validated',
  title:
    'the session offers exactly the tools the task granted, checked by the inspection before every task; a session granted nothing runs no command; a grant outside the declaration, part of a group, or naming an MCP tool is refused before anything runs; and a session offering more than its grant is refused',
  level: 'runtime',
  package: CODEX_PACKAGE,
  file: INVARIANTS,
});

/** I4: the OpenAI credential is held by the relay and never enters the sandbox (P12). */
export const CODEX_CREDENTIAL_NOT_READABLE = external({
  id: 'I4.codex-credential-not-readable-by-the-task',
  title:
    'the model credential never enters the sandbox: no process, environment, argument, or file of the container holds it after a task that ran commands, while the task reached the model through the relay; the session authenticated with the placeholder; the same search finds a value an exec was given',
  level: 'runtime',
  package: CODEX_PACKAGE,
  file: INVARIANTS,
});

/** I6: the family is the driver's stated constant, never derived. */
export const CODEX_FAMILY_IS_DECLARED = external({
  id: 'I6.codex-family-is-declared',
  title:
    "the family a result records is the driver's stated constant, the same for every tier and every model map and never derived from a model name; the model it records is the one the runtime resolved, which the inspection confirmed the session asks for",
  level: 'runtime',
  package: CODEX_PACKAGE,
  file: INVARIANTS,
});

/** I2: the relay's Responses meter counts what the session used, so its reading is not a meter that looked nowhere (A-R26-01). */
export const CODEX_RELAY_METER_AGREES_WITH_SESSION = external({
  id: 'I2.codex-relay-meter-agrees-with-session',
  title:
    "the relay's reading of every paid sandbox in this file equals the CLI's own account of it, class by class: input less cached, cached as cache reads, and output",
  level: 'runtime',
  package: CODEX_PACKAGE,
  file: INVARIANTS,
});

/** The title of the workspace-instruction assertion R23's table names for this driver (D-A-DD-03). */
export const CODEX_WORKSPACE_INSTRUCTIONS_NOT_LOADED_TITLE =
  "an AGENTS.md, an AGENTS.override.md, a nested AGENTS.md, a skill under .agents/skills, .codex/skills, and a nested .agents/skills, and a .codex/config.toml, planted in the workspace, reach neither the session's request nor its reply with no tools or with every declared tool, while the same invocation without the driver's instruction settings carries the plants: the task runs under its role alone";

/** The claim titles, by key, for `claims.ts` (D-R26-07). */
export const CODEX_CLAIM_TITLES = {
  subagents:
    'subagents is declared false and absent: there is no spawnSubagent(), and a session granted the whole inventory offers no multi-agent tool',
  hooks:
    'hooks is declared false and absent: emitArtifacts refuses at the capability layer and writes nothing, and every session runs with the hooks feature off',
  mcp:
    'mcp is declared false and absent: a grant naming an MCP tool is refused before anything runs, and a session granted the whole inventory offers no MCP tool',
  parallelism:
    'the driver runs the declared number of tasks concurrently, each on its own sandbox: four overlap, a fifth waits for a slot, and a second task on one sandbox waits for the first',
  computerUse:
    'computerUse is declared false and absent: no declared tool drives a display, and a session granted the whole inventory offers exactly the declared tools',
  steering:
    'steering is declared false and there is no steer(): a running task has no runtime message channel',
  stablePrefixCaching:
    "stablePrefixCaching is declared false: two tasks sharing one stable prefix send different prompt_cache_key values, so a second reading the first one's prefix from cache is not something the driver can promise",
} as const;
