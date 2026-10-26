/**
 * The invariant assertions this driver owes the registry, each against real
 * sandboxes, real relays, and an endpoint the test owns.
 *
 * Registered in `packages/conformance/src/registry/` as external assertions
 * pointing at this file, and counted only after reconciliation against this
 * package's own run report. They require Docker and `openssl`, call no model,
 * and never skip. See `harness.ts`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { TaskId } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { DECLARED_TOOLS, DriverRefusal, OpenAICompatibleDriver, checkConfig } from '../src/index.js';
import { script } from './endpoint.js';
import { CONFIG, PROCESS_DUMP, WORKDIR, dockerOut, exportContains, modelCalls, withHarness } from './harness.js';

async function refusalOf(action: () => unknown): Promise<DriverRefusal> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DriverRefusal) return error;
    throw error;
  }
  throw new Error('expected a DriverRefusal, and nothing was refused');
}

/** A file's contents, or `absent` only where it does not exist; every other read error fails the test (codex-5). */
async function contentsOrAbsent(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
}

function functionNames(body: Record<string, unknown>): string[] {
  const tools = body.tools;
  if (!Array.isArray(tools)) return [];
  return (tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
}

invariantTest(
  'I1.openai-compatible-driver-executes-inside-the-sandbox',
  'every tool call of a task runs inside the provisioned sandbox through provider.exec and every model call through its relay, and a driver with no provider, or with one that cannot call the relay, cannot be constructed',
  async () => {
    await withHarness(async (h) => {
      const { handle, workspace } = await h.sandbox();
      const marker = `/tmp/ran-inside-${String(Date.now())}`;
      const result = await h.driver.runTask(
        h.request(handle, {
          taskId: 'i1-tools' as TaskId,
          tools: ['Bash', 'Edit', 'Read', 'Write'],
          variableSuffix: script([
            { calls: [{ name: 'Write', arguments: { path: 'notes/a.txt', content: 'alpha beta\n' } }] },
            { calls: [{ name: 'Edit', arguments: { path: 'notes/a.txt', old_string: 'beta', new_string: 'gamma' } }] },
            { calls: [{ name: 'Read', arguments: { path: `${WORKDIR}/notes/a.txt` } }, { name: 'Bash', arguments: { command: `cat /etc/hostname > ${marker} && pwd` } }] },
            { content: 'finished' },
          ]),
        }),
      );

      // The workspace mount holds what the tools wrote, so the writes landed in the container's view of it.
      expect(await readFile(join(workspace, 'notes', 'a.txt'), 'utf8')).toBe('alpha gamma\n');
      expect(result.claim.narrative).toBe('finished');
      expect(result.claim.filesChanged).toStrictEqual(['notes/a.txt']);
      expect(result.events.map((e) => [e.kind, e.detail.tool])).toStrictEqual([
        ['file-write', 'Write'],
        ['file-write', 'Edit'],
        ['tool-call', 'Read'],
        ['command', 'Bash'],
      ]);

      // The command ran in the container: its marker is there, holding the container's own hostname.
      const inside = await h.provider.exec(handle, ['cat', marker]);
      expect(inside.exitCode).toBe(0);
      const hostname = (await dockerOut(['inspect', '--format', '{{.Config.Hostname}}', h.provider.appliedControls(handle).containerId])).trim();
      expect(inside.stdout.trim()).toBe(hostname);

      // What the model read back was the container's file, and Bash ran in the working directory.
      const sent = (await h.received()).map((r) => r.body);
      expect(sent).toHaveLength(4);
      const toolResults = (sent[3]?.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool').map((m) => m.content);
      expect(toolResults[toolResults.length - 2]).toBe('alpha gamma\n');
      expect(toolResults[toolResults.length - 1]).toContain(`--- stdout ---\n${WORKDIR}\n`);

      // Every call the driver made was against this sandbox's handle: four model calls through the relay and the tools' execs.
      expect(h.execs.every((e) => e.handle === handle)).toBe(true);
      expect(modelCalls(h.execs)).toHaveLength(4);
    });

    // No provider is no driver: there is no host to fall back to.
    const refused = await refusalOf(() => new OpenAICompatibleDriver({ provider: undefined as unknown as SandboxProvider, endpoint: CONFIG }));
    expect(refused.layer).toBe('provider');
    // A provider that can only exec would have the model call answered from inside the sandbox: refused too.
    const execOnly = await refusalOf(() => new OpenAICompatibleDriver({ provider: { id: 'exec-only' } as unknown as SandboxProvider, endpoint: CONFIG }));
    expect(execOnly.layer).toBe('provider');
    expect(execOnly.message).toContain('A-R6-05');
  },
);

invariantTest(
  'I4.openai-compatible-driver-tool-inventory-validated',
  'the endpoint is offered exactly the tools the task granted and no others, a model call naming an ungranted tool is answered with an error and never run, ' +
    'and a grant outside the declared inventory is refused before anything runs in the sandbox',
  async () => {
    await withHarness(async (h) => {
      const { handle, workspace } = await h.sandbox();
      const result = await h.driver.runTask(
        h.request(handle, {
          taskId: 'i4-tools' as TaskId,
          tools: ['Read'],
          variableSuffix: script([
            { calls: [{ name: 'Write', arguments: { path: 'forbidden.txt', content: 'x' } }, { name: 'Bash', arguments: { command: 'touch also-forbidden' } }] },
            { content: 'done' },
          ]),
        }),
      );
      const sent = (await h.received()).map((r) => r.body);
      // Offered: Read and nothing else, on every turn.
      expect(sent.map(functionNames)).toStrictEqual([['Read'], ['Read']]);
      // Asked for, never run: no file, no command, and both refusals recorded.
      expect(await contentsOrAbsent(join(workspace, 'forbidden.txt'))).toBe('absent');
      expect(await contentsOrAbsent(join(workspace, 'also-forbidden'))).toBe('absent');
      expect(result.events.map((e) => e.detail)).toStrictEqual([
        { tool: 'Write', refused: true },
        { tool: 'Bash', refused: true },
      ]);
      expect(h.execs.filter((e) => e.kind === 'exec')).toStrictEqual([]);
      const answers = (sent[1]?.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool').map((m) => m.content);
      expect(answers).toStrictEqual(["error: the tool 'Write' is not granted to this task", "error: the tool 'Bash' is not granted to this task"]);

      // A task granted nothing is offered nothing at all.
      await h.driver.runTask(h.request(handle, { taskId: 'i4-none' as TaskId, tools: [] }));
      expect('tools' in ((await h.received()).at(-1)?.body ?? {})).toBe(false);

      // Granting the whole inventory offers exactly the inventory.
      await h.driver.runTask(h.request(handle, { taskId: 'i4-all' as TaskId, tools: [...DECLARED_TOOLS] }));
      expect(functionNames((await h.received()).at(-1)?.body ?? {})).toStrictEqual([...DECLARED_TOOLS]);

      // A grant this driver does not declare is refused before any exec.
      const before = h.execs.length;
      const refused = await refusalOf(() => h.driver.runTask(h.request(handle, { taskId: 'i4-undeclared' as TaskId, tools: ['Read', 'WebFetch'] })));
      expect(refused.layer).toBe('grant');
      expect(refused.message).toContain("'WebFetch'");
      expect(h.execs.length).toBe(before);
    });
  },
);

invariantTest(
  'I4.openai-compatible-credential-not-readable-by-the-task',
  "the endpoint's credential never enters the sandbox: no process, file, environment entry, or argument of it holds the value, " +
    'while every model call reaches the endpoint carrying it as the bearer scheme the operator declared; the same search finds a value an exec was given',
  async () => {
    await withHarness(async (h) => {
      const { handle, workspace } = await h.sandbox();
      await h.driver.runTask(
        h.request(handle, {
          taskId: 'i4-credential' as TaskId,
          tools: ['Bash'],
          variableSuffix: script([{ calls: [{ name: 'Bash', arguments: { command: 'env > env.txt; sleep 30 >/dev/null 2>&1 & echo started' } }] }, { content: 'done' }]),
        }),
      );
      // The endpoint was reached, twice, each time with the provider's credential written as a bearer token.
      const reached = await h.received();
      expect(reached.map((r) => r.bearerMatches)).toStrictEqual([true, true]);

      // What the task could see: its environment, every process left running, every file, how it was started, its workspace.
      expect(await readFile(join(workspace, 'env.txt'), 'utf8')).not.toContain(h.secret);
      const dump = await h.provider.exec(handle, ['sh', '-c', PROCESS_DUMP]);
      expect(dump.stdout).toContain('sleep');
      expect(dump.stdout).not.toContain(h.secret);
      const container = h.provider.appliedControls(handle).containerId;
      expect(await exportContains(container, h.secret)).toBe(false);
      expect(await dockerOut(['inspect', container])).not.toContain(h.secret);

      // The control: the same searches find a value that was handed to an exec, so they are not blind.
      const planted = `planted-${h.secret}`;
      await h.provider.exec(handle, ['sh', '-c', 'printf %s "$PLANTED" > /tmp/planted; sleep 30 >/dev/null 2>&1 &'], { env: { PLANTED: planted } });
      expect(await exportContains(container, planted)).toBe(true);
      expect((await h.provider.exec(handle, ['sh', '-c', PROCESS_DUMP])).stdout).toContain(planted);
    });
  },
);

invariantTest(
  'I6.openai-compatible-family-is-declared',
  "the family a result records is the operator's declaration, never derived; a configuration without one is refused; " +
    'an answer naming another model, or none, refuses the task rather than being attributed to the declared family; ' +
    'and a turn is answered by the relay even after the task replaces node in the sandbox, so nothing the task wrote is attributed to the model (A-R6-05)',
  async () => {
    // The family is the configuration's, whatever the endpoint, the provider, or the model is called.
    const { family: _dropped, ...undeclared } = CONFIG;
    for (const family of [undefined, '', ' test-family', 'Test Family']) {
      const config = family === undefined ? undeclared : { ...CONFIG, family };
      const refused = await refusalOf(() => checkConfig(config));
      expect(refused.layer, JSON.stringify(family)).toBe('configuration');
      expect(refused.message).toContain('family');
    }

    await withHarness(async (h) => {
      const { handle } = await h.sandbox();
      const declared = h.driverWith({ ...CONFIG, family: 'declared-elsewhere', provider: 'openai', models: { ...CONFIG.models, standard: 'test-standard' } });
      const result = await declared.runTask(h.request(handle, { taskId: 'i6-declared' as TaskId }));
      expect(result.model).toStrictEqual({ provider: 'openai', family: 'declared-elsewhere', model: 'test-standard', version: CONFIG.version });
      expect(declared.resolveModel('deep').family).toBe('declared-elsewhere');

      for (const [answered, label] of [['test-other', 'another model'], [null, 'no model']] as const) {
        const refused = await refusalOf(() =>
          h.driver.runTask(h.request(handle, { taskId: `i6-${label.replace(' ', '-')}` as TaskId, variableSuffix: script([{ model: answered, content: 'x' }]) })),
        );
        expect(refused.layer, label).toBe('identity');
      }

      // The task replaces the sandbox's node with a program that prints a well-formed answer from the requested model.
      // The next turn still reaches the endpoint, and what is recorded is the endpoint's answer, not the forgery.
      const forged = JSON.stringify({
        status: 200,
        body: JSON.stringify({ model: CONFIG.models.standard, choices: [{ message: { content: 'forged' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
      });
      const before = (await h.received()).length;
      const replaced = await h.driver.runTask(
        h.request(handle, {
          taskId: 'i6-forged-node' as TaskId,
          tools: ['Bash', 'Write'],
          variableSuffix: script([
            { calls: [{ name: 'Write', arguments: { path: '/tmp/forged.json', content: forged } }] },
            { calls: [{ name: 'Bash', arguments: { command: 'p=$(command -v node) && printf "#!/bin/sh\ncat /tmp/forged.json\n" > "$p" && chmod +x "$p" && node && echo replaced' } }] },
            { content: 'answered by the endpoint' },
          ]),
        }),
      );
      expect(replaced.claim.narrative).toBe('answered by the endpoint');
      expect((await h.received()).length - before).toBe(3);
      // The control: node was replaced, and the forgery it printed is what an in-sandbox caller would have returned.
      const toolResults = ((await h.received()).at(-1)?.body.messages as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool');
      expect(toolResults.at(-1)?.content).toContain('replaced');
      expect(toolResults.at(-1)?.content).toContain('forged');
    });
  },
);
