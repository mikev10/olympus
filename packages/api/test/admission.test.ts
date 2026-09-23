/**
 * Admission: every refusal that happens before a run's first state, and the
 * regression tests from the external review of S1
 * (docs/reviews/2026-09-09-S1-walking-skeleton-adversarial-triage.md), carried
 * over to a manifest and a graph read from the workspace. Every refusal is read
 * by field: a path and a code for a request problem, a payload for a transition.
 * And every one leaves nothing behind: no admission, no state, no lock.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunId, TaskId } from '@olympus-ai/core';
import type { EvidenceBundle, Vault } from '@olympus-ai/vault';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { startRun, type ComponentGraph, type RequestProblemCode, type RunOutcome } from '../src/index.js';
import {
  ARTIFACTS,
  BUILDER,
  ChosenDriver,
  HELLO_CHECK,
  makeWorkspace,
  policy,
  policyDocument,
  removeWorkspace,
  roleScope,
  runRequest,
  stubComponents,
  writeChecks,
  writeGraph,
} from './harness.js';

const runId = 'run-admission' as RunId;
const ok = { ...HELLO_CHECK, id: 'x' };
const bad = { ...ok, command: ['node', '-e', 'process.exit(3)'] };

let workspace: string;
let components: ComponentGraph;

beforeEach(async () => {
  workspace = await makeWorkspace('p4-admission-');
  components = stubComponents(workspace);
});

afterEach(async () => {
  await removeWorkspace(workspace);
});

async function expectNothingWritten(vault: Vault): Promise<void> {
  await expect(vault.readRunState(runId)).rejects.toThrow();
  await expect(vault.verifyLocks(runId)).rejects.toThrow();
}

/** The refusal that happens before anything is admitted, naming the field and the code. */
async function expectInvalid(outcome: RunOutcome, path: string, code: RequestProblemCode): Promise<void> {
  expect(outcome).toMatchObject({ ok: false, reason: 'invalid-request' });
  if (outcome.ok || outcome.reason !== 'invalid-request') return;
  expect(outcome.problems).toContainEqual(expect.objectContaining({ path, code }));
  for (const problem of outcome.problems) expect(problem.message).not.toBe('');
  await expectNothingWritten(components.vault);
}

const start = (overrides: Parameters<typeof runRequest>[3] = {}): Promise<RunOutcome> => startRun(runRequest(runId, workspace, components, overrides));

describe('S1 finding 1: duplicate check ids', () => {
  test('a manifest with a duplicated id is refused before anything runs', async () => {
    await writeChecks(workspace, [ok, bad]);
    await expectInvalid(await start(), 'manifest.checks[1].id', 'duplicate');
  });

  test('results keep their position: a second required check that fails is not masked by a first that passes', async () => {
    await writeChecks(workspace, [ok, { ...bad, id: 'y' }]);
    const outcome = await start();
    if (outcome.ok || outcome.reason !== 'refused' || outcome.state === null) throw new Error('expected the task to park');
    const [ref] = outcome.state.evidenceRefs;
    if (ref === undefined) throw new Error('no evidence');
    const bundle = JSON.parse(new TextDecoder().decode(await components.vault.read(ref))) as EvidenceBundle;
    expect(bundle.checks.map((c) => [c.checkId, c.exitCode])).toEqual([
      ['x', 0],
      ['y', 3],
    ]);
    expect(outcome.state.tasks['hello' as TaskId]).toBe('parked');
  });
});

describe('S1 finding 3: the verification manifest', () => {
  test('3a: a manifest with no checks, or only optional ones, is refused', async () => {
    await writeChecks(workspace, []);
    await expectInvalid(await start(), 'manifest.checks', 'missing');
    await writeChecks(workspace, [{ ...ok, required: false }]);
    await expectInvalid(await start(), 'manifest.checks', 'none-required');
  });

  test('3c: a check whose required flag is not a boolean, or with an empty command, id, or bad suite count, is refused', async () => {
    await writeChecks(workspace, [{ ...bad, required: 'yes' }]);
    await expectInvalid(await start(), 'manifest.checks[0].required', 'not-boolean');
    await writeChecks(workspace, [{ ...ok, command: [] }]);
    await expectInvalid(await start(), 'manifest.checks[0].command', 'empty');
    await writeChecks(workspace, [{ ...ok, command: ['  '] }]);
    await expectInvalid(await start(), 'manifest.checks[0].command[0]', 'empty');
    await writeChecks(workspace, [{ ...ok, command: 'node -e process.exit(0)' }]);
    await expectInvalid(await start(), 'manifest.checks[0].command', 'not-argv');
    await writeChecks(workspace, [{ ...ok, command: ['node', 7] }]);
    await expectInvalid(await start(), 'manifest.checks[0].command[1]', 'not-argv');
    await writeChecks(workspace, [{ ...ok, id: '' }]);
    await expectInvalid(await start(), 'manifest.checks[0].id', 'empty');
    await writeChecks(workspace, [{ ...ok, expectedSuiteCount: -1 }]);
    await expectInvalid(await start(), 'manifest.checks[0].expectedSuiteCount', 'not-integer');
  });

  test('a manifest or a graph that is not JSON is refused', async () => {
    await writeFile(join(workspace, 'verify.json'), '{ checks: [');
    await expectInvalid(await start(), 'artifacts.verificationManifest', 'not-json');
  });
});

describe('S1 finding 7: artifact paths', () => {
  test('an absolute path is refused before anything is read, not thrown after the lock', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'p4-outside-'));
    try {
      await writeFile(join(outside, 'other.md'), 'elsewhere');
      await expectInvalid(await start({ artifacts: { ...ARTIFACTS, spec: [join(outside, 'other.md')] } }), 'artifacts.spec[0]', 'absolute');
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test('a path with a .. segment, an empty list, an empty path, or a path listed twice is refused', async () => {
    await expectInvalid(await start({ artifacts: { ...ARTIFACTS, spec: ['a/../../spec.md'] } }), 'artifacts.spec[0]', 'escapes');
    await expectInvalid(await start({ artifacts: { ...ARTIFACTS, acceptanceTests: [] } }), 'artifacts.acceptanceTests', 'missing');
    await expectInvalid(await start({ artifacts: { ...ARTIFACTS, taskGraph: '' } }), 'artifacts.taskGraph', 'empty');
    await expectInvalid(await start({ artifacts: { ...ARTIFACTS, acceptanceTests: ['spec.md'] } }), 'artifacts.acceptanceTests[0]', 'duplicate');
  });

  test('an artifact that is not in the workspace is refused', async () => {
    await expectInvalid(await start({ artifacts: { ...ARTIFACTS, spec: ['absent.md'] } }), 'artifacts.spec[0]', 'unreadable');
  });
});

describe('the task graph', () => {
  const build = { id: 'b', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] };
  const review = { id: 'r', station: 'review', role: 'reviewer', dependsOn: ['b'], dependencySet: ['**'] };

  test('a build task no review task covers is refused: its work would reach integrate unreviewed', async () => {
    await writeGraph(workspace, [build]);
    await expectInvalid(await start(), 'graph.tasks[0]', 'unreviewed');
  });

  test('a cycle, a dependency on a missing or a review task, and a task at another station are refused', async () => {
    await writeGraph(workspace, [{ ...build, dependsOn: ['c'] }, { ...build, id: 'c', dependsOn: ['b'] }, { ...review, dependsOn: ['b', 'c'] }]);
    await expectInvalid(await start(), 'graph.tasks', 'cycle');
    await writeGraph(workspace, [build, { ...review, dependsOn: ['b', 'nope'] }]);
    await expectInvalid(await start(), 'graph.tasks[1].dependsOn[1]', 'bad-dependency');
    await writeGraph(workspace, [{ ...build, dependsOn: ['r'] }, review]);
    await expectInvalid(await start(), 'graph.tasks[0].dependsOn[0]', 'bad-dependency');
    await writeGraph(workspace, [build, review, { ...build, id: 'i', station: 'integrate' }]);
    await expectInvalid(await start(), 'graph.tasks[2].station', 'bad-station');
  });
});

describe('policy and capabilities, checked before anything is admitted (I4, I5)', () => {
  test('a policy that does not validate is refused', async () => {
    await expectInvalid(await start({ policy: { ...policy(), globalCap: 4 } as never }), 'policy', 'invalid-policy');
  });

  test('a driver without a capability build requires is refused at build, naming it, with no state', async () => {
    const driver = new ChosenDriver({ capabilities: { parallelism: 0 } });
    const outcome = await startRun(runRequest(runId, workspace, { ...components, driver, reviewer: new ChosenDriver() }));
    expect(outcome).toEqual({
      ok: false,
      reason: 'refused',
      at: 'build',
      transition: expect.objectContaining({ reason: 'capability-missing', station: 'build', capability: 'parallelism' }) as unknown,
      state: null,
    });
    expect(driver.requests).toEqual([]);
    await expectNothingWritten(components.vault);
  });

  test('an over-request at a station no role acts at is refused at admission, naming the station', async () => {
    const outcome = await start({ policy: policy({ ...policyDocument(), stationCaps: { integrate: 0 } }) });
    expect(outcome).toMatchObject({ ok: false, reason: 'policy-refused', station: 'integrate', role: null, refusal: { reason: 'exceeds-cap' } });
    await expectNothingWritten(components.vault);
  });

  test('a role the policy does not define is refused at the station the graph schedules it at', async () => {
    const outcome = await start({ policy: policy({ roles: { [BUILDER]: roleScope('builder') } }) });
    expect(outcome).toMatchObject({ ok: false, reason: 'policy-refused', station: 'review', role: 'reviewer', refusal: { reason: 'capability-missing' } });
    await expectNothingWritten(components.vault);
  });
});
