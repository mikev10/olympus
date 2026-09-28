/**
 * The worst-case cost is a bound the line enforces, and it is tight (D-P9-03):
 * a run in which every task spends every driver call its station allows, and
 * passes on the last, makes exactly `worstCase.calls` calls — never one more.
 */
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { maxStarts, STATION_CONTRACTS, StubDriver, type RunId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import { startRun, worstCaseCost } from '../src/index.js';
import { HELLO_CHECK, makeWorkspace, policy, removeWorkspace, runRequest, stubComponents, writeChecks, BUILDER, REVIEWER } from './harness.js';
import { DelegatingDriver } from './wrappers.js';

/** Fails every call but the last of each iteration's allowance, so every retry the contract allows is spent. */
class ExhaustingDriver extends DelegatingDriver {
  calls = 0;
  private readonly seen = new Map<string, number>();

  constructor() {
    super(new StubDriver());
  }

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    this.calls += 1;
    const n = (this.seen.get(req.taskId) ?? 0) + 1;
    this.seen.set(req.taskId, n);
    const station = req.taskId === 'hello' ? 'build' : 'review';
    const perIteration = STATION_CONTRACTS[station].retry.max + 1;
    if (n % perIteration !== 0) throw new Error(`scripted failure ${String(n)} of ${req.taskId}`);
    return this.inner.runTask(req);
  }
}

let workspace: string;
let counter: string;

beforeEach(async () => {
  workspace = await makeWorkspace('p9-cost-');
  counter = join(tmpdir(), `p9-cost-${String(Date.now())}-${String(Math.random()).slice(2)}.count`);
});

afterEach(async () => {
  await removeWorkspace(workspace);
  await rm(counter, { force: true });
});

test('every task spending every start it may, and passing on its last, makes exactly the figure\'s calls', async () => {
  const iterations = STATION_CONTRACTS.build.maxIterations;
  // The check fails on every build but the last, so the build spends every iteration it has.
  const script = [
    "const fs = require('node:fs');",
    `const f = ${JSON.stringify(counter)};`,
    "const n = (fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0) + 1;",
    'fs.writeFileSync(f, String(n));',
    `process.exit(n >= ${String(iterations)} ? 0 : 1);`,
  ].join(' ');
  await writeChecks(workspace, [{ ...HELLO_CHECK, command: ['node', '-e', script] }]);
  const driver = new ExhaustingDriver();
  const components = stubComponents(workspace, { driver, reviewer: driver });
  const runId = 'cost-bound' as RunId;

  const outcome = await startRun(runRequest(runId, workspace, components));
  // The run reaches the integrate gate, which always needs a human; every driver call is behind it.
  expect(outcome).toMatchObject({ ok: false, transition: { reason: 'approval-required', key: 'integrate:1' } });

  const figure = worstCaseCost(
    { tasks: [{ id: 'hello', station: 'build', role: BUILDER } as never, { id: 'hello-review', station: 'review', role: REVIEWER } as never], edges: [] },
    policy(),
  );
  expect(figure.calls).toBe(maxStarts(STATION_CONTRACTS.build) + maxStarts(STATION_CONTRACTS.review));
  expect(driver.calls).toBe(figure.calls);
  const state = await components.vault.readRunState(runId);
  expect(state.usage).toHaveLength(figure.calls);
  expect(state.tasks).toEqual({ hello: 'passed', 'hello-review': 'passed' });
  expect(figure.usd).toBe(figure.calls * 1);
});

test('the figure sums each task\'s calls at its own role\'s ceiling, rounded to a millionth of a dollar', () => {
  const doc = policy();
  const priced = {
    ...doc,
    roles: {
      [BUILDER]: { ...doc.roles[BUILDER], budget: { maxTokens: 1, maxCostUsd: 0.1, maxWallClockMs: 1 } },
      [REVIEWER]: { ...doc.roles[REVIEWER], budget: { maxTokens: 1, maxCostUsd: 0.37, maxWallClockMs: 1 } },
    },
  } as typeof doc;
  const figure = worstCaseCost(
    { tasks: [
      { id: 'a', station: 'build', role: BUILDER } as never,
      { id: 'b', station: 'build', role: BUILDER } as never,
      { id: 'r', station: 'review', role: REVIEWER } as never,
    ], edges: [] },
    priced,
  );
  expect(figure.calls).toBe(9 + 9 + 3);
  expect(figure.usd).toBe(2.91);
  expect(figure.tasks.map((t) => t.usd)).toEqual([0.9, 0.9, 1.11]);
});
