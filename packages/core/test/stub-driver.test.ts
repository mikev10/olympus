/**
 * StubDriver: calls no model and returns the canned TaskResult it was
 * constructed with. The result has the contract's six keys and no place to
 * report success (I2).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SandboxHandle } from '@olympus-ai/sandbox';
import { describe, expect, test } from 'vitest';
import { DRIVER_CONTRACT_VERSION, StubDriver, type ModelTier, type RoleId, type TaskId, type TaskRequest } from '../src/index.js';

function request(tier: ModelTier = 'fast'): TaskRequest {
  return {
    taskId: 'task-1' as TaskId,
    role: 'builder' as RoleId,
    stablePrefix: '# spec',
    variableSuffix: 'task-1',
    tier,
    tools: [],
    sandbox: 'sandbox-1' as SandboxHandle,
    timeoutMs: 0,
    budget: { maxTokens: 0, maxCostUsd: 0, maxWallClockMs: 0 },
  };
}

describe('declaration', () => {
  test('is the stub driver at the current contract version', () => {
    const driver = new StubDriver();
    expect(driver.id).toBe('stub');
    expect(driver.contractVersion).toBe(DRIVER_CONTRACT_VERSION);
    expect(driver.provenanceId()).toBe(`stub-driver@${DRIVER_CONTRACT_VERSION}`);
  });

  test('declares itself unsafe as StubDriver, naming the model, events, and artifacts it does not produce', () => {
    const driver = new StubDriver();
    expect(driver.unsafe.component).toBe('StubDriver');
    const text = driver.unsafe.cannotEnforce.join('\n');
    expect(text).toMatch(/model/i);
    expect(text).toMatch(/event/i);
    expect(text).toMatch(/emitArtifacts/);
  });

  test('claims no capability and parallelism 1', () => {
    expect(new StubDriver().capabilities()).toEqual({
      subagents: false,
      hooks: false,
      mcp: false,
      parallelism: 1,
      computerUse: false,
      steering: false,
      stablePrefixCaching: false,
    });
  });

  test('omits the optional spawnSubagent and steer methods, as capabilities() says', () => {
    const driver = new StubDriver();
    expect('spawnSubagent' in driver).toBe(false);
    expect('steer' in driver).toBe(false);
  });

  test('resolves every tier to the stub model with an explicit stub family (I6)', () => {
    const driver = new StubDriver();
    for (const tier of ['fast', 'standard', 'deep'] as const) {
      expect(driver.resolveModel(tier)).toEqual({ provider: 'stub', family: 'stub', model: 'stub', version: '0' });
    }
  });
});

describe('runTask', () => {
  test('returns exactly the six keys of TaskResult and nothing that could report status (I2)', async () => {
    const result = await new StubDriver().runTask(request());
    expect(Object.keys(result).sort()).toEqual(['claim', 'contractVersion', 'events', 'model', 'taskId', 'usage']);
  });

  test('returns the default canned claim, no events, zero usage, and the resolved model', async () => {
    const driver = new StubDriver();
    const result = await driver.runTask(request('deep'));
    expect(result).toEqual({
      taskId: 'task-1',
      claim: { narrative: 'stub: no model was called', filesChanged: [] },
      events: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, wallClockMs: 0 },
      model: driver.resolveModel('deep'),
      contractVersion: DRIVER_CONTRACT_VERSION,
    });
  });

  test('returns the claim it was constructed with', async () => {
    const claim = { narrative: 'I changed a file', filesChanged: ['a.ts'] };
    const result = await new StubDriver({ claim }).runTask(request());
    expect(result.claim).toEqual(claim);
  });

  test('hands out a copy of the canned claim, so a caller cannot alter the next result', async () => {
    const driver = new StubDriver();
    const first = await driver.runTask(request());
    first.claim.filesChanged.push('x.ts');
    first.claim.narrative = 'edited';
    const second = await driver.runTask(request());
    expect(second.claim).toEqual({ narrative: 'stub: no model was called', filesChanged: [] });
  });
});

describe('events, cancel, emitArtifacts', () => {
  test('a handler registered with on() never fires', async () => {
    const driver = new StubDriver();
    let fired = 0;
    for (const kind of ['command', 'file-write', 'tool-call', 'network', 'subagent'] as const) {
      driver.on(kind, () => {
        fired += 1;
      });
    }
    await driver.runTask(request());
    await driver.cancel('task-1' as TaskId);
    expect(fired).toBe(0);
  });

  test('cancel resolves', async () => {
    await expect(new StubDriver().cancel('task-1' as TaskId)).resolves.toBeUndefined();
  });

  test('emitArtifacts writes nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stub-driver-'));
    try {
      await new StubDriver().emitArtifacts([{ role: 'builder' as RoleId, instructions: 'build' }], dir);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
