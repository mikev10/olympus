/**
 * The invariant assertions this package owes the registry, run against a real
 * container and real model calls (R26's conformance).
 *
 * Registered in `packages/conformance/src/registry/codex.ts` as external
 * assertions pointing at this file, and counted only after reconciliation
 * against the report this package's run writes. They need Docker and
 * `OPENAI_API_KEY`, and fail without either (`harness.ts`).
 *
 * Every task is the smallest that proves its point, on the `fast` tier.
 */
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { TaskId } from '@olympus-ai/core';
import { SandboxRefusal, type SandboxProvider } from '@olympus-ai/sandbox';
import { CATALOG_WITH_PATCH, CATALOG_WITHOUT_PATCH, CodexDriver, DECLARED_TOOLS, DriverRefusal, FAMILY, KEY_PLACEHOLDER, TIER_MODELS } from '../src/index.js';
import { PROCESS_DUMP, WORKDIR, credential, dockerOut, meteredSessions, spec, withDriver, type Harness } from './harness.js';
import { plantAll, plants, plantsAreLiveAndAbsent } from './plants.js';

const MARKER = 'i1-inside-the-sandbox.txt';

/**
 * Runs the inspection of an empty grant through a provider that swaps the
 * catalog without `apply_patch` for the one with it, as a CLI that offered a
 * tool its configuration did not would. Returns the refusal's layer.
 */
async function widenedSessionRefusal(h: Harness): Promise<string> {
  const widening: SandboxProvider = {
    id: h.provider.id,
    provision: (s) => h.provider.provision(s),
    destroy: (x) => h.provider.destroy(x),
    capabilities: () => h.provider.capabilities(),
    exec: (x, cmd, o) => h.provider.exec(x, cmd.map((arg) => arg.replace(CATALOG_WITHOUT_PATCH, CATALOG_WITH_PATCH)), o),
  };
  const driver = new CodexDriver({ provider: widening, workdir: WORKDIR });
  const refusal: unknown = await driver.inspect(h.request({ taskId: 'widened' as TaskId, tools: [] })).catch((e: unknown) => e);
  if (!(refusal instanceof DriverRefusal)) throw new Error(`a session offering apply_patch to an empty grant was not refused: ${String(refusal)}`);
  expect(refusal.message).toContain('apply_patch');
  return refusal.layer;
}

invariantTest(
  'I1.codex-driver-executes-inside-the-sandbox',
  "a task's commands run inside the provisioned sandbox and reach the host only through the workspace mount, no mount is the Vault, a Vault mount is refused, and a driver with no provider cannot be constructed",
  async () => {
    expect(() => new CodexDriver({} as unknown as { provider: never })).toThrow(DriverRefusal);
    await withDriver({ relay: true }, async (h) => {
      // The mount layer refuses a workspace that is the Vault, before any container starts (I1).
      const refused: unknown = await h.provider.provision(spec(h.image, h.vaultDir, true)).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(refused).toBeInstanceOf(SandboxRefusal);
      expect((refused as SandboxRefusal).layer).toBe('mount');
      expect(h.provider.appliedControls(h.handle).mounts.every((m) => !m.source.startsWith(h.vaultDir))).toBe(true);

      const result = await h.driver.runTask(
        h.request({
          taskId: 'i1-inside' as TaskId,
          tools: ['exec_command', 'write_stdin'],
          variableSuffix: `Run exactly this shell command once, then reply with the single word: done\n\nprintf %s "$(hostname)" > ${WORKDIR}/${MARKER}`,
        }),
      );
      expect(result.events.some((e) => e.kind === 'command')).toBe(true);
      // The marker reached the host through the mount, and it holds the container's hostname, not this machine's.
      expect(await readdir(h.workspaceDir)).toContain(MARKER);
      const written = await readFile(join(h.workspaceDir, MARKER), 'utf8');
      const containerId = h.provider.appliedControls(h.handle).containerId;
      const hostname = (await dockerOut(['inspect', '--format', '{{.Config.Hostname}}', containerId])).trim();
      expect(written).toBe(hostname);
      // Nothing the task wrote reached the Vault.
      expect(await readdir(h.vaultDir)).toStrictEqual([]);
    });
  },
);

invariantTest(
  'I4.codex-driver-tool-inventory-validated',
  'the session offers exactly the tools the task granted, checked by the inspection before every task; a session granted nothing runs no command; ' +
    'a grant outside the declaration, part of a group, or naming an MCP tool is refused before anything runs; and a session offering more than its grant is refused',
  async () => {
    await withDriver({ relay: true }, async (h) => {
      const before = h.execs.length;
      for (const tools of [['web_search'], ['exec_command'], ['mcp__s__t']]) {
        const refusal: unknown = await h.driver.runTask(h.request({ taskId: 'i4-refused' as TaskId, tools })).catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(DriverRefusal);
        expect((refusal as DriverRefusal).layer).toBe('grant');
      }
      expect(h.execs.length).toBe(before);

      // Granted nothing, asked to run a command: the session holds no tool to run it with.
      const marker = `i4-${randomUUID()}.txt`;
      const result = await h.driver.runTask(
        h.request({ taskId: 'i4-nothing' as TaskId, tools: [], variableSuffix: `Create the file ${WORKDIR}/${marker} if you can. Then reply with one word.` }),
      );
      expect(h.driver.inspectionFor('i4-nothing' as TaskId)?.tools).toStrictEqual([]);
      expect(result.events.filter((e) => e.kind === 'command' || e.kind === 'file-write')).toStrictEqual([]);
      expect(await readdir(h.workspaceDir)).not.toContain(marker);

      // The catalogs that decide apply_patch are not the task's to rewrite.
      const writable = await h.provider.exec(h.handle, ['sh', '-c', 'for f in /opt/codex/*.json; do test -w "$f" && echo "$f"; done; true']);
      expect(writable.stdout.trim()).toBe('');
      // A session that offers more than its grant is refused: a CLI configured, behind the driver's back,
      // with the catalog that keeps apply_patch offers a tool nobody granted, and the inspection catches it.
      expect(await widenedSessionRefusal(h)).toBe('grant');
    });
  },
);

invariantTest(
  'I4.codex-credential-not-readable-by-the-task',
  "the model credential never enters the sandbox: no process, environment, argument, or file of the container holds it after a task that ran commands, while the task reached the model through the relay; the session authenticated with the placeholder; the same search finds a value an exec was given",
  async () => {
    const secret = credential();
    await withDriver({ relay: true }, async (h) => {
      const result = await h.driver.runTask(
        h.request({
          taskId: 'i4-credential' as TaskId,
          tools: ['exec_command', 'write_stdin'],
          variableSuffix: 'Run the shell command `env | sort > /tmp/env.txt` once, then reply with the single word: done',
        }),
      );
      expect(result.usage.outputTokens).toBeGreaterThan(0);
      expect(h.driver.inspectionFor('i4-credential' as TaskId)?.authorization).toBe(`Bearer ${KEY_PLACEHOLDER}`);
      const search = async (): Promise<{ processes: boolean; files: boolean }> => {
        const dump = await h.provider.exec(h.handle, ['sh', '-c', PROCESS_DUMP]);
        // The value travels on stdin, so the search itself puts it in no environment and no argument.
        const files = await h.provider.exec(h.handle, ['sh', '-c', 'grep -rlF --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev -f /dev/stdin / 2>/dev/null || true'], { stdin: `${secret}\n` });
        return { processes: dump.stdout.includes(secret), files: files.stdout.trim() !== '' };
      };
      expect(await search()).toStrictEqual({ processes: false, files: false });
      // The search is not blind: a value an exec was given is found in a file it wrote.
      await h.provider.exec(h.handle, ['sh', '-c', 'printf %s "$PLANTED" > /tmp/planted.txt'], { env: { PLANTED: secret } });
      expect((await search()).files).toBe(true);
    });
  },
);

invariantTest(
  'I6.codex-family-is-declared',
  "the family a result records is the driver's stated constant, the same for every tier and every model map and never derived from a model name; " +
    'the model it records is the one the runtime resolved, which the inspection confirmed the session asks for',
  async () => {
    await withDriver({ relay: true }, async (h) => {
      const result = await h.driver.runTask(h.request({ taskId: 'i6-family' as TaskId }));
      expect(result.model).toStrictEqual(h.driver.resolveModel('fast'));
      expect(result.model.family).toBe(FAMILY);
      expect(result.model.family).toBe('openai');
      expect(result.model.model).toBe(TIER_MODELS.fast);
      expect(h.driver.inspectionFor('i6-family' as TaskId)?.model).toBe(TIER_MODELS.fast);
      const swapped = new CodexDriver({ provider: h.provider, models: { fast: TIER_MODELS.deep, standard: TIER_MODELS.deep, deep: TIER_MODELS.deep } });
      expect(swapped.resolveModel('fast').family).toBe(FAMILY);
    });
  },
);

invariantTest(
  'I3.codex-workspace-instructions-not-loaded',
  'an AGENTS.md, an AGENTS.override.md, a nested AGENTS.md, a skill under .agents/skills, .codex/skills, and a nested .agents/skills, and a .codex/config.toml, planted in the workspace, '
    + "reach neither the session's request nor its reply with no tools or with every declared tool, nor the request of a session started in the nested directory, while the same invocation without the driver's instruction settings carries every plant but the config: "
    + 'the task runs under its role alone',
  async () => {
    await withDriver({ relay: true }, async (h) => {
      const set = plants();
      await plantAll(h, set);
      for (const [i, tools] of [[], [...DECLARED_TOOLS]].entries()) {
        const taskId = `i3-${String(i)}` as TaskId;
        const result = await h.driver.runTask(h.request({ taskId, tools, variableSuffix: 'Reply with the single word: ready' }));
        const body = h.driver.inspectionFor(taskId)?.body ?? '';
        expect(body).not.toBe('');
        for (const p of set) {
          expect(body, p.path).not.toContain(p.token);
          expect(result.claim.narrative, p.path).not.toContain(p.token);
        }
        expect(result.claim.narrative.toLowerCase()).toContain('ready');
      }
      // Each plant live in a control and absent from the driver, from the root and from sub/ (codex-5). The inspection calls no model.
      let n = 0;
      await plantsAreLiveAndAbsent(h, set, [...DECLARED_TOOLS], async (driver) => {
        n += 1;
        return (await driver.inspect(h.request({ taskId: `i3-live-${String(n)}` as TaskId, tools: [...DECLARED_TOOLS] }))).body;
      });
    });
  },
);

// Last in the file: it reads what every test above left in `meteredSessions`, and calls no model.
invariantTest(
  'I2.codex-relay-meter-agrees-with-session',
  "the relay's reading of every paid sandbox in this file equals the CLI's own account of it, class by class: input less cached, cached as cache reads, and output",
  () => {
    const used = meteredSessions.filter((s) => s.cli.inputTokens > 0);
    expect(used.length).toBeGreaterThan(0);
    for (const session of meteredSessions) {
      if (session.reading instanceof Error) throw session.reading;
      expect(session.reading.kind, session.test).toBe('metered');
      if (session.reading.kind !== 'metered') continue;
      expect(
        {
          inputTokens: session.reading.inputTokens,
          cacheReadTokens: session.reading.cacheReadTokens,
          outputTokens: session.reading.outputTokens,
          cacheWriteTokens: session.reading.cacheWriteTokens,
        },
        session.test,
      ).toStrictEqual({
        inputTokens: session.cli.inputTokens - session.cli.cachedTokens,
        cacheReadTokens: session.cli.cachedTokens,
        outputTokens: session.cli.outputTokens,
        cacheWriteTokens: 0,
      });
      expect(session.reading.exhausted, session.test).toBe('none');
    }
  },
);
