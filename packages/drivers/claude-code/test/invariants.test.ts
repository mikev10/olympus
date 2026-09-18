/**
 * The invariant assertions this package owes the registry, run against a real
 * container and a real model call.
 *
 * Registered in `packages/conformance/src/registry` as external assertions
 * pointing at this file. The registry counts one only after reconciling it
 * against the report this package's own run writes, so an id that no test
 * carries, a test that was skipped, a test that failed, a report from another
 * tree, and a missing report are five distinct refusals
 * (`I8.external-assertion-execution-reconciled`).
 *
 * They require Docker and `ANTHROPIC_API_KEY`, and they fail without either.
 * See `harness.ts` for why that is not a gap.
 */
import { readFile, readdir } from 'node:fs/promises';
import { expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { TaskId } from '@olympus-ai/core';
import { CREDENTIAL_VARIABLE, DECLARED_TOOLS, DriverRefusal, ClaudeCodeDriver } from '../src/index.js';
import { WORKDIR, credential, withDriver, type Harness } from './harness.js';

/**
 * A marker only a process inside the container can write, and only into the
 * workspace mount. Finding it on the host proves the command ran in the
 * container and reached the host only through the mount; finding *nothing*
 * outside the workspace proves it reached the host by no other route.
 */
const MARKER = 'i1-inside-the-sandbox.txt';

invariantTest(
  'I1.driver-executes-inside-the-sandbox',
  "a task's commands run inside the provisioned sandbox and nowhere else, and a driver with no provider cannot be constructed",
  async () => {
    // The refusal first, because it costs nothing and it is half the claim: a
    // driver that could be built without a provider has a path that runs the
    // model on the host, outside the mount table where I1 is enforced.
    // A literal credential, not `credential()`: what is under test is the
    // missing provider, and reading the environment first would make this
    // assertion fail for the other reason on a host that has no key.
    const noProvider = (): ClaudeCodeDriver =>
      new ClaudeCodeDriver({ credential: 'not-used-the-construction-refuses-first' } as unknown as { provider: never });
    expect(noProvider).toThrow(DriverRefusal);

    await withDriver(async (h) => {
      const result = await h.driver.runTask(
        h.request({
          taskId: 'i1-inside' as TaskId,
          tools: ['Bash'],
          variableSuffix:
            `Run exactly this command and report only its output: ` +
            `sh -c 'printf %s "$(hostname)" > ${WORKDIR}/${MARKER}; cat /proc/1/cgroup > /dev/null 2>&1; echo done'`,
        }),
      );

      // The marker is in the workspace on the host, so the command ran and its
      // one writable path was the mount.
      const onHost = await readdir(h.workspaceDir);
      expect(onHost).toContain(MARKER);

      // The hostname it wrote is the container's, not this machine's. A driver
      // that ran the CLI on the host would have written the host's.
      const wrote = (await readFile(`${h.workspaceDir}/${MARKER}`, 'utf8')).trim();
      const inContainer = await h.provider.exec(h.handle, ['hostname']);
      expect(wrote).toBe(inContainer.stdout.trim());
      expect(wrote).not.toBe('');

      // And the driver observed the command it ran, so the evidence and the
      // execution are the same event rather than two stories about it.
      expect(result.events.some((e) => e.kind === 'command')).toBe(true);
    });
  },
);

invariantTest(
  'I4.driver-tool-inventory-validated',
  'the CLI session offers exactly the tools the task granted and no wider set, every declared tool is one the CLI really has, and a grant outside the declaration is refused before the task starts',
  async () => {
    await withDriver(async (h) => {
      // A grant the driver does not declare is refused, and nothing runs. The
      // CLI drops an unknown tool name silently, so without this refusal a
      // policy could grant a tool that never existed and read as though the
      // grant had taken effect.
      await expect(h.driver.runTask(h.request({ tools: ['Read', 'Telepathy'] }))).rejects.toThrow(/does not declare/);

      // Every declared tool is one the CLI really offers. Granting the whole
      // inventory must produce exactly the inventory: a name the CLI does not
      // know is dropped, so a declaration that had gone stale comes back short.
      const all = await h.driver.runTask(
        h.request({ taskId: 'i4-inventory' as TaskId, tools: [...DECLARED_TOOLS], variableSuffix: 'Reply with the single word: ok' }),
      );
      expect(all.claim.narrative).not.toBe('');
      const offered = await sessionTools(h, [...DECLARED_TOOLS]);
      expect([...offered].sort((a, b) => a.localeCompare(b))).toEqual([...DECLARED_TOOLS].sort((a, b) => a.localeCompare(b)));

      // A narrower grant is narrower in the session, not merely unused: the
      // tool is absent, so the model has nothing to decline to use (I4).
      const narrow = await sessionTools(h, ['Read']);
      expect(narrow).toEqual(['Read']);
      expect(narrow).not.toContain('Bash');

      // And an empty grant is an empty session. Default deny, applied to the
      // thing the model can actually reach.
      expect(await sessionTools(h, [])).toEqual([]);
    });
  },
);

/**
 * The tools a session comes up with for a given grant, read from the CLI's own
 * `init` message rather than from anything the model says.
 *
 * Run directly through the provider rather than through `runTask`, because
 * what is under test is the session's tool list and not a turn: three grants
 * would otherwise be three model calls for an answer the CLI prints before it
 * makes one.
 */
async function sessionTools(h: Harness, tools: string[]): Promise<string[]> {
  // Bounded by `timeout` rather than by a budget flag. The CLI prints its
  // session before it calls anything and then keeps retrying; without a bound
  // an inspection would sit there until the sandbox's own wall-clock limit
  // ended it, which is ten minutes per grant for an answer that arrives in one
  // second.
  const argv = [
    'sh',
    '-c',
    `cd ${WORKDIR} && exec timeout 30 "$@"`,
    'driver',
    'claude',
    '--print', 'unused: the session is inspected before any turn',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'haiku',
    '--tools', tools.join(','),
    '--setting-sources', '',
    '--strict-mcp-config',
    '--permission-mode', 'bypassPermissions',
    '--permission-prompts', 'none',
    '--no-session-persistence',
  ];
  const ran = await h.provider.exec(h.handle, argv, { env: { [CREDENTIAL_VARIABLE]: credential() } });
  for (const line of ran.stdout.split('\n')) {
    if (!line.includes('"subtype":"init"')) continue;
    const parsed: unknown = JSON.parse(line);
    const list = (parsed as { tools?: unknown }).tools;
    if (Array.isArray(list)) return list.filter((t): t is string => typeof t === 'string');
  }
  throw new Error(`the CLI printed no session for the grant ${JSON.stringify(tools)}; stdout began ${ran.stdout.slice(0, 300)}`);
}
