/**
 * The answer key never leaves the host (I3, D-R7-03): what reaches a sandbox
 * is a change's bytes, and nothing that says what the change seeds; and no
 * other package can import the corpus or its runner.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { RoleId, TaskId, TaskRequest } from '@olympus-ai/core';
import type { SandboxHandle, SandboxProvider } from '@olympus-ai/sandbox';
import { loadCorpus } from '../src/corpus.js';
import { ScriptedSeat } from '../src/seats.js';

const BUILDER = 'builder' as RoleId;

/** A sandbox that records every argv it is asked to run, and runs none. */
function recording(): { provider: SandboxProvider; argvs: string[][] } {
  const argvs: string[][] = [];
  const provider = {
    exec: (_h: SandboxHandle, argv: readonly string[]) => {
      argvs.push([...argv]);
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 });
    },
  } as unknown as SandboxProvider;
  return { provider, argvs };
}

function request(role: RoleId): TaskRequest {
  return {
    taskId: 'multiply' as TaskId,
    role: { role, instructions: '', sha256: '0'.repeat(64) },
    stablePrefix: '',
    variableSuffix: '',
    tier: 'standard',
    tools: [],
    sandbox: 'h' as SandboxHandle,
    timeoutMs: 1000,
    budget: { maxTokens: 1, maxCostUsd: 1, maxWallClockMs: 1000 },
  };
}

describe('what a scripted seat sends into its sandbox', () => {
  test("holds each item's change and claim, and never its id, group, or what it seeds", async () => {
    const corpus = await loadCorpus();
    for (const item of corpus.items.filter((i) => i.seat === 'build')) {
      const { provider, argvs } = recording();
      const seat = new ScriptedSeat(provider, BUILDER, item.change, item.claim);
      const result = await seat.runTask(request(BUILDER));
      expect(argvs).toHaveLength(1);
      const sent = argvs.join('\n') + JSON.stringify(result);
      // An id or group that is also a word the change uses (`multiply`, say) is not a leak; these are not.
      for (const label of [item.id, item.group, item.seeds ?? '', item.kind === 'seeded' ? 'seeded' : 'control']) {
        if (label !== '' && !Object.values(item.change.write).some((c) => JSON.stringify(c).includes(label))) expect(sent, item.id).not.toContain(label);
      }
      expect(result.claim.narrative).toBe(item.claim);
    }
  });

  test('lands nothing for a task under another role', async () => {
    const corpus = await loadCorpus();
    const item = corpus.items.find((i) => i.seat === 'build');
    if (item === undefined) throw new Error('the corpus has no build item');
    const { provider, argvs } = recording();
    await new ScriptedSeat(provider, BUILDER, item.change, item.claim).runTask(request('reviewer' as RoleId));
    expect(argvs).toEqual([]);
  });

  test("a change that does not land fails the item rather than letting the line judge an unchanged tree", async () => {
    const corpus = await loadCorpus();
    const item = corpus.items.find((i) => i.seat === 'build');
    if (item === undefined) throw new Error('the corpus has no build item');
    const provider = { exec: () => Promise.resolve({ exitCode: 1, stdout: '', stderr: 'disk full', durationMs: 0 }) } as unknown as SandboxProvider;
    await expect(new ScriptedSeat(provider, BUILDER, item.change, item.claim).runTask(request(BUILDER))).rejects.toThrow(/did not land/);
  });
});

describe('no other package can reach the corpus', () => {
  test('no workspace package depends on @olympus-ai/benchmark', async () => {
    const packages = join(import.meta.dirname, '..', '..');
    const manifests: string[] = [];
    for (const entry of await readdir(packages, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'benchmark') continue;
      if (entry.name === 'drivers') {
        for (const driver of await readdir(join(packages, 'drivers'), { withFileTypes: true })) if (driver.isDirectory()) manifests.push(join(packages, 'drivers', driver.name, 'package.json'));
      } else manifests.push(join(packages, entry.name, 'package.json'));
    }
    expect(manifests.length).toBeGreaterThan(5);
    for (const manifest of manifests) expect(await readFile(manifest, 'utf8'), manifest).not.toContain('@olympus-ai/benchmark');
  });
});
