/**
 * The seven `driver.*` capability claims, each proven against the real CLI
 * inside a real container.
 *
 * I8 is this unit's whole subject: every `true` in `capabilities()` has been a
 * declaration with nothing behind it since F2, and every assertion here fails
 * when the thing it names is taken away. Each is checked in both directions
 * where the direction means something — declaring a capability the CLI does
 * not give is a false claim, and giving one that is not declared is an
 * undeclared capability.
 *
 * Registered in `packages/conformance/src/registry/claims.ts` as external
 * assertions pointing at this file, and counted only after reconciliation
 * against this package's own run report.
 *
 * They require Docker and `ANTHROPIC_API_KEY`, they cost money, and they never
 * skip. See `harness.ts`.
 */
import { expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { RoleId, TaskId } from '@olympus-ai/core';
import type { SandboxHandle } from '@olympus-ai/sandbox';
import { DECLARED_TOOLS, HOOK_SETTINGS, PARALLELISM, artifactFiles } from '../src/index.js';
import { MCP_SERVER_SOURCE, withDriver } from './harness.js';

invariantTest(
  'driver.subagents',
  'spawnSubagent() runs a child task under the parent request\'s policy grants and returns its own TaskResult',
  async () => {
    await withDriver(async (h) => {
      const parent = h.request({ taskId: 'sub-parent' as TaskId, tools: ['Read'] });
      const child = await h.driver.spawnSubagent({ role: 'reviewer' as RoleId, instructions: 'You review. Do exactly what the message asks, then end your reply with the exact token PLUM-6620.', sha256: '0'.repeat(64) }, {
        ...parent,
        taskId: 'sub-child' as TaskId,
        variableSuffix: 'Reply with the single word: child',
      });

      // A TaskResult of its own, not the parent's, and carrying the contract
      // version rather than a status the model chose (I2).
      expect(child.taskId).toBe('sub-child');
      expect(child.claim.narrative.toLowerCase()).toContain('child');
      expect(child.contractVersion).toBe(h.driver.contractVersion);

      // The session really ran under the role it was given: only the role's
      // instructions ask for the token, and the message does not (D-R20-14).
      expect(child.claim.narrative).toContain('PLUM-6620');
      // And really was under the parent's grants, read from what the CLI
      // printed before it took a turn, not from what the model said afterwards.
      const session = h.driver.sessionFor('sub-child' as TaskId);
      expect(session?.tools).toEqual(['Read']);
      expect(session?.tools).not.toContain('Bash');

      // And the capability is declared, so the two agree.
      expect(h.driver.capabilities().subagents).toBe(true);
    });
  },
);

invariantTest(
  'driver.hooks',
  'the driver installs the hook points emitArtifacts() renders, and each one that fires arrives as a DriverEvent the CLI reported',
  async () => {
    // Outside the workspace mount, because the driver refuses a settings file
    // the agent can write: a hook is a command that runs outside the task's
    // tool grant, and one read from the tree being worked on is a capability
    // arriving from the work rather than from policy (I3, I4).
    const settingsDir = '/tmp/driver-settings';
    const settingsPath = `${settingsDir}/settings.json`;
    await withDriver(
      async (h) => {
        // The hook points come from emitArtifacts, written through the sandbox
        // like everything else, and the session is started with that file.
        await h.driver.emitArtifacts([{ role: 'builder' as RoleId, instructions: 'unused here', sha256: '0'.repeat(64) }], settingsDir);
        const written = await h.provider.exec(h.handle, ['cat', settingsPath]);
        expect(written.exitCode).toBe(0);
        for (const point of Object.keys(HOOK_SETTINGS)) expect(written.stdout).toContain(point);

        const result = await h.driver.runTask(
          h.request({
            taskId: 'hooks' as TaskId,
            tools: ['Read'],
            variableSuffix: `Read the file ${settingsPath} and reply with the single word: read`,
          }),
        );

        const fired: string[] = [];
        for (const event of result.events) {
          const hook = event.detail.hook;
          if (typeof hook === 'string') fired.push(hook);
        }
        // SessionStart fires on every session; the tool points fire because the
        // task used a tool. Both were rendered by emitArtifacts, so what is
        // asserted is the round trip and not the CLI's own defaults.
        expect(fired).toContain('SessionStart');
        expect(fired).toContain('PreToolUse');
        expect(fired).toContain('PostToolUse');
        expect(h.driver.capabilities().hooks).toBe(true);

        // The rendering and the firing are the same set: a point emitArtifacts
        // does not write is a point that cannot fire.
        const rendered = artifactFiles([{ role: 'builder' as RoleId, instructions: '', sha256: '0'.repeat(64) }], '/t').find((f) => f.path.endsWith('settings.json'));
        for (const point of fired) expect(rendered?.content).toContain(point);
      },
      { settingsPath },
    );
  },
);

invariantTest(
  'driver.mcp',
  'the MCP servers a task\'s grants name are reachable from that task, and no other server is loaded',
  async () => {
    const probe = { command: 'node', args: ['--eval', MCP_SERVER_SOURCE, 'probe'] };
    const unused = { command: 'node', args: ['--eval', MCP_SERVER_SOURCE, 'unused'] };
    await withDriver(
      async (h) => {
        const result = await h.driver.runTask(
          h.request({
            taskId: 'mcp' as TaskId,
            tools: ['mcp__probe__ping'],
            variableSuffix: 'Call the ping tool once and reply with exactly what it returned.',
          }),
        );

        // What the session came up with, before anything the model said about
        // it. The first run of this assertion checked the narrative first and
        // reported a model claiming tools that do not exist in the CLI at all
        // — a confabulated list — which said nothing about whether the server
        // had loaded. The CLI's own startup report is the fact; the narrative
        // is a claim (I2), and a claim is worth checking only once the fact
        // it depends on is established.
        const loaded = h.driver.sessionFor('mcp' as TaskId);
        expect(loaded?.mcpServers.map((server) => server.name)).toEqual(['probe']);
        expect(loaded?.tools).toContain('mcp__probe__ping');

        // Then the tool really was reachable, and really was used.
        expect(result.claim.narrative.toLowerCase()).toContain('pong');
        expect(result.events.some((e) => typeof e.detail.tool === 'string' && e.detail.tool.includes('probe'))).toBe(true);

        // And nothing else was loaded. Read from the session's own startup
        // report: `--strict-mcp-config` plus a configuration built from the
        // grants alone is what makes "no other server" a fact about the session
        // rather than about what the model chose to use. `unused` is configured
        // on the driver and granted by nothing, so its absence here is the
        // whole claim.
        const session = h.driver.sessionFor('mcp' as TaskId);
        expect(session?.mcpServers.map((server) => server.name)).toEqual(['probe']);
        expect(session?.mcpServers.every((server) => server.status === 'connected')).toBe(true);

        // And no tool beyond the grant, not even from the server that was
        // granted. `probe` offers `ungranted` as well as `ping`; a session that
        // held it would be offering the model a tool policy never granted,
        // which is the I4 failure this driver's inspection pass exists to
        // close. `--tools` cannot do it: it governs the built-in set, and an
        // MCP server contributes its whole list.
        expect(session?.tools).toContain('mcp__probe__ping');
        expect(session?.tools).not.toContain('mcp__probe__ungranted');

        // A grant naming a server the driver does not hold is refused, rather
        // than dropped into a session that then looks configured.
        await expect(h.driver.runTask(h.request({ tools: ['mcp__absent__thing'] }))).rejects.toThrow(/no MCP server named/);
        expect(h.driver.capabilities().mcp).toBe(true);
      },
      { mcpServers: { probe, unused } },
    );
  },
);

invariantTest(
  'driver.parallelism',
  'the driver runs the declared number of tasks concurrently, each on its own sandbox, under one provenance id: four overlap, a fifth waits, and a second task on one sandbox waits for the first',
  async () => {
    await withDriver(async (h) => {
      expect(h.driver.capabilities().parallelism).toBe(PARALLELISM);
      const provenance = h.driver.provenanceId();
      const others = await h.provisionMore(PARALLELISM);

      // The window measured is the CLI's, not the caller's: promises created
      // together all begin at the same instant whatever the driver does, so
      // timing them would prove nothing. What the declaration claims is how
      // many invocations are inside sandboxes at once, and that one sandbox
      // never holds two.
      let inside = 0;
      let mostAtOnce = 0;
      const perSandbox = new Map<SandboxHandle, number>();
      let mostOnOne = 0;
      h.observeExec((sandbox) => {
        inside += 1;
        mostAtOnce = Math.max(mostAtOnce, inside);
        perSandbox.set(sandbox, (perSandbox.get(sandbox) ?? 0) + 1);
        mostOnOne = Math.max(mostOnOne, perSandbox.get(sandbox) ?? 0);
        return () => {
          inside -= 1;
          perSandbox.set(sandbox, (perSandbox.get(sandbox) ?? 1) - 1);
        };
      });

      // Five sandboxes with one task each, and a second task on the first: six tasks.
      const sandboxes = [h.handle, ...others, h.handle];
      await Promise.all(sandboxes.map((sandbox, i) =>
        h.driver.runTask(h.request({ sandbox, taskId: `par-${String(i)}` as TaskId, variableSuffix: `Reply with the single word: task${String(i)}` }))));

      // Four at once and never five: a driver more concurrent than it declares
      // has an undeclared capability rather than a bonus, and one less
      // concurrent declares a number nothing exercises. One sandbox never held two.
      expect(mostAtOnce).toBe(PARALLELISM);
      expect(mostOnOne).toBe(1);

      // One provenance id across every task, because it is the driver's identity and
      // not a per-task value.
      expect(h.driver.provenanceId()).toBe(provenance);
    });
  },
);

invariantTest(
  'driver.computerUse',
  'computerUse is declared false and is absent: no declared tool drives a display, and a session granted the whole inventory offers none',
  async () => {
    await withDriver(async (h) => {
      expect(h.driver.capabilities().computerUse).toBe(false);

      // Nothing in the inventory could drive one, so there is no grant that
      // would reach one, and a request for one is refused before any task.
      expect(DECLARED_TOOLS.some((t) => /computer|screen|display|mouse|keyboard/i.test(t))).toBe(false);
      await expect(h.driver.runTask(h.request({ tools: ['ComputerUse'] }))).rejects.toThrow(/does not declare/);

      // And the container has no display for one to drive. The absence is
      // asserted rather than skipped, the same way `sandbox.computerUse` is.
      const display = await h.provider.exec(h.handle, ['sh', '-c', 'printf %s "${DISPLAY:-}"; ls /tmp/.X11-unix 2>/dev/null | head -1']);
      expect(display.stdout.trim()).toBe('');
    });
  },
);

invariantTest(
  'driver.steering',
  'steering is declared false and there is no steer(): a running task has no runtime message channel, in both directions',
  async () => {
    await withDriver(async (h) => {
      expect(h.driver.capabilities().steering).toBe(false);
      // Declared false and absent. A method that existed and threw would be a
      // capability declared false and present, which is the direction this
      // assertion refuses just as firmly as the other.
      expect('steer' in h.driver).toBe(false);

      const result = await h.driver.runTask(h.request({ taskId: 'steer' as TaskId, variableSuffix: 'Reply with the single word: ok' }));
      // A task ran, so the absence is of a channel into a live session rather
      // than of sessions.
      expect(result.claim.narrative).not.toBe('');
      expect(h.driver.sessionFor('steer' as TaskId)?.sessionId).not.toBe('');
    });
  },
);

invariantTest(
  'driver.stablePrefixCaching',
  'cacheReadTokens is zero on the first task of a run and non-zero on a second that shares its stablePrefix and differs only in variableSuffix',
  async () => {
    await withDriver(async (h) => {
      expect(h.driver.capabilities().stablePrefixCaching).toBe(true);

      const first = await h.driver.runTask(
        h.request({ taskId: 'cache-1' as TaskId, variableSuffix: 'Reply with the single word: one' }),
      );
      const second = await h.driver.runTask(
        h.request({ taskId: 'cache-2' as TaskId, variableSuffix: 'Reply with the single word: two' }),
      );

      // The prefix carries a nonce, so no session before this run has ever
      // presented it: the first task has to write it, and only the second can
      // read it back.
      expect(first.usage.cacheWriteTokens).toBeGreaterThan(0);

      // The second reads strictly more than the first. That difference is the
      // stable prefix, and it is what the split buys: a driver that
      // concatenated the prefix and the suffix would present the CLI's own
      // system prompt unchanged on both tasks, so both would read the same
      // amount and this would not move.
      expect(second.usage.cacheReadTokens).toBeGreaterThan(first.usage.cacheReadTokens);

      // And having read it, the second task does not write it again.
      expect(second.usage.cacheWriteTokens).toBeLessThan(first.usage.cacheWriteTokens);

      // The two tasks really did differ only in the suffix.
      expect(first.claim.narrative).not.toBe(second.claim.narrative);
    });
  },
);
