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
import { DECLARED_TOOLS, DriverRefusal, ClaudeCodeDriver } from '../src/index.js';
import { WORKDIR, withDriver } from './harness.js';

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

      // Every check below goes through `driver.runTask` and reads the session
      // the driver itself started. An earlier version of this assertion built
      // its own `claude` invocation with its own `--tools`, which meant the
      // registered assertion still passed with `--tools` deleted from the
      // driver: it was testing the CLI's flag, not the driver's use of it.
      // That is the "passes when the property is deleted" failure I8 exists to
      // catch, and it is why the driver's own path is the only path here.
      const narrow = await h.driver.runTask(
        h.request({ taskId: 'i4-narrow' as TaskId, tools: ['Read'], variableSuffix: 'Reply with the single word: ok' }),
      );
      expect(narrow.claim.narrative).not.toBe('');
      expect(h.driver.sessionFor('i4-narrow' as TaskId)?.tools).toEqual(['Read']);

      // An empty grant is an empty session: default deny, applied to what the
      // model can actually reach rather than to what it is asked to avoid.
      await h.driver.runTask(
        h.request({ taskId: 'i4-empty' as TaskId, tools: [], variableSuffix: 'Reply with the single word: ok' }),
      );
      expect(h.driver.sessionFor('i4-empty' as TaskId)?.tools).toEqual([]);

      // And every declared tool is one the CLI really offers. Granting the
      // whole inventory must produce exactly the inventory: a name the CLI does
      // not know is dropped, so a declaration gone stale comes back short --
      // and the driver refuses a session narrower than its grant, so this fails
      // loudly rather than quietly.
      await h.driver.runTask(
        h.request({ taskId: 'i4-inventory' as TaskId, tools: [...DECLARED_TOOLS], variableSuffix: 'Reply with the single word: ok' }),
      );
      const offered = h.driver.sessionFor('i4-inventory' as TaskId)?.tools ?? [];
      expect([...offered].sort((a, b) => a.localeCompare(b))).toEqual([...DECLARED_TOOLS].sort((a, b) => a.localeCompare(b)));
    });
  },
);
