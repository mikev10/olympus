/**
 * The line: three station functions over one context, called in order.
 * Each commits run state on the way out, so a RunState alone says where the
 * run is. `build` and `verify` re-verify the locks on the way in, and
 * `verify` re-verifies them again after the checks have run (I3). The verify
 * station runs the checks and derives the verdict from their exit codes and
 * nothing else (I2). It performs no tamper analysis and no claim/evidence
 * diff; SKELETON_LINE says so.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Run, RunState, StationId, StationTransition, Task, TaskResult, TaskStatus, VaultRef } from '@olympus-ai/core';
import type { CheckResult, CheckSpec, GateResult, IntegrityViolation, TamperReport } from '@olympus-ai/integrity';
import type { SandboxSpec } from '@olympus-ai/sandbox';
import type { LockManifest } from '@olympus-ai/vault';
import type { ComponentGraph, FixtureTask, RunOutcome, StationRefusal } from './run.js';

export interface LineContext {
  readonly run: Run;
  readonly task: Task;
  readonly fixture: FixtureTask;
  readonly components: ComponentGraph;
  /** Replaced by every commit. */
  state: RunState;
  /** Set by spec. */
  locks: LockManifest | null;
  /** Set by build, read by verify. */
  result: TaskResult | null;
}

interface Verified {
  readonly gate: GateResult;
  readonly evidence: VaultRef;
  readonly next: StationTransition;
}

export async function runLine(ctx: LineContext): Promise<RunOutcome> {
  const fromSpec = await spec(ctx);
  if (!fromSpec.ok) return { ok: false, reason: 'refused', at: 'spec', transition: fromSpec };
  const fromBuild = await build(ctx);
  if (!fromBuild.ok) return { ok: false, reason: 'refused', at: 'build', transition: fromBuild };
  const fromVerify = await verify(ctx);
  if (!('gate' in fromVerify)) return { ok: false, reason: 'refused', at: 'verify', transition: fromVerify };
  return { ok: true, gate: fromVerify.gate, next: fromVerify.next, state: ctx.state, evidence: fromVerify.evidence };
}

/** `spec`: lock the artifacts the task will be judged by, then hand the run to `build`. */
async function spec(ctx: LineContext): Promise<StationTransition> {
  ctx.locks = await ctx.components.vault.lock(ctx.run.id, [...ctx.fixture.lockedPaths], 'spec');
  await commit(ctx, { station: 'build', status: 'pending' });
  return { ok: true, next: 'build' };
}

/**
 * `build`: re-verify the locks, provision a sandbox, run the one task
 * through the driver, destroy the sandbox, and hand the run to `verify`.
 */
async function build(ctx: LineContext): Promise<StationTransition> {
  const refusal = await refuseIfTampered(ctx, 'build');
  if (refusal !== undefined) return refusal;
  const { sandbox, driver } = ctx.components;
  const handle = await sandbox.provision(workspaceOnly(ctx.fixture, 'rw'));
  try {
    await commit(ctx, { station: 'build', status: 'running' });
    // The locked files' text, read after verification, is the cacheable prefix; the task id is all that varies.
    // `resolve` against the workspace is the same resolution the vault applies to its root.
    const locked = await Promise.all(ctx.fixture.lockedPaths.map((path) => readFile(resolve(ctx.fixture.workspace, path), 'utf8')));
    ctx.result = await driver.runTask({
      taskId: ctx.task.id,
      role: ctx.task.role,
      stablePrefix: locked.join('\n'),
      variableSuffix: ctx.task.id,
      tier: 'fast',
      tools: [], // no policy grants any (I4)
      sandbox: handle,
      timeoutMs: 0,
      budget: { maxTokens: 0, maxCostUsd: 0, maxWallClockMs: 0 },
    });
  } finally {
    await sandbox.destroy(handle);
  }
  await commit(ctx, { station: 'verify', status: 'verifying' });
  return { ok: true, next: 'verify' };
}

/**
 * `verify`: re-verify the locks, run every check in a fresh sandbox where
 * the agent never ran and the workspace is mounted read-only, re-verify the
 * locks again afterwards, derive the verdict, write the evidence, and stop.
 * `review` does not exist, so the run ends here either way.
 */
async function verify(ctx: LineContext): Promise<StationRefusal | Verified> {
  const refusal = await refuseIfTampered(ctx, 'verify');
  if (refusal !== undefined) return refusal;
  const result = ctx.result;
  if (result === null) throw new Error('verify: build produced no TaskResult; the line ran out of order');
  const { sandbox, vault, driver } = ctx.components;

  // Results stay aligned with the specs by position, never matched up by id afterwards.
  const specs = ctx.fixture.checks;
  const results: Array<CheckResult | undefined> = [];
  const unstarted: Array<string | undefined> = [];
  const handle = await sandbox.provision(workspaceOnly(ctx.fixture, 'ro'));
  try {
    for (const check of specs) {
      const startedAt = new Date().toISOString();
      try {
        // Whitespace split and no shell is the whole command grammar in S1; P6 replaces it.
        const exec = await sandbox.exec(handle, check.command.split(/\s+/));
        results.push({
          checkId: check.id,
          exitCode: exec.exitCode,
          stdout: exec.stdout,
          stderr: exec.stderr,
          suiteCount: null,
          durationMs: exec.durationMs,
          startedAt,
        });
        unstarted.push(undefined);
      } catch (error) {
        // There is no exit code to record and none is invented; a required check with no result fails the gate.
        results.push(undefined);
        unstarted.push(describe(error));
      }
    }
  } finally {
    await sandbox.destroy(handle);
  }
  const checks = results.filter((r): r is CheckResult => r !== undefined);

  // The table asked for a read-only workspace, but only a provider that enforces it makes that true,
  // and the stub does not. Evidence collected over a changed artifact is not evidence, so the locks
  // are checked again whatever the provider claims.
  const tampered = await refuseIfTampered(ctx, 'verify', { phase: 'after-checks', checks });
  if (tampered !== undefined) return tampered;

  const failures = specs.flatMap((check, i) => {
    const shortfall = requiredShortfall(check, results[i], unstarted[i]);
    return shortfall === undefined ? [] : [shortfall];
  });
  const verdict = failures.length === 0 ? 'pass' : 'fail';
  const gate: GateResult = { checks, tamper: emptyTamperReport(), violations: [], verdict };
  const evidence = await vault.writeEvidence({
    runId: ctx.run.id,
    taskId: ctx.task.id,
    baseCommit: ctx.run.baseCommit,
    checks,
    claim: result.claim,
    claimEvidenceDiff: [],
    collectedBy: 'runtime',
    driverProvenanceId: driver.provenanceId(),
    contractVersion: driver.contractVersion,
  });
  // The task's status follows the verdict and nothing else (I2).
  await commit(ctx, { station: 'verify', status: verdict === 'pass' ? 'passed' : 'failed', evidence });
  const next: StationTransition =
    verdict === 'pass' ? { ok: true, next: 'review' } : { ok: false, reason: 'gate-failed', detail: failures.join('; ') };
  return { gate, evidence, next };
}

/**
 * I3: a mismatch on the way into a station, or after the checks, is a
 * refusal with a recorded violation, never a warning. The state commits with
 * the task failed at the station that refused. `extra` goes into the
 * violation's detail beside the tampered list: the phase, and the check
 * results when they exist, so a violation read back on its own says what ran.
 */
async function refuseIfTampered(ctx: LineContext, at: StationId, extra: Record<string, unknown> = {}): Promise<StationRefusal | undefined> {
  const { vault, driver } = ctx.components;
  const verdict = await vault.verifyLocks(ctx.run.id);
  if (verdict.ok) return undefined;
  const violation: IntegrityViolation = {
    runId: ctx.run.id,
    taskId: ctx.task.id,
    kind: 'lock-tamper',
    role: ctx.task.role,
    driverProvenanceId: driver.provenanceId(),
    contractVersion: driver.contractVersion,
    detectedAt: new Date().toISOString(),
    detail: { station: at, ...extra, tampered: verdict.tampered },
  };
  const ref = await vault.recordViolation(violation);
  await commit(ctx, { station: at, status: 'failed', violation: ref });
  const paths = verdict.tampered.map((t) => `${t.path} (expected ${t.expected}, actual ${t.actual})`).join(', ');
  const when = typeof extra.phase === 'string' ? ` (${extra.phase})` : '';
  return { ok: false, reason: 'lock-tamper', detail: `locked artifact changed before ${at}${when}: ${paths}` };
}

/** Why a required check fails the gate, or undefined when it does not. A check that is not required never fails it. */
function requiredShortfall(check: CheckSpec, result: CheckResult | undefined, unstartedBecause: string | undefined): string | undefined {
  if (!check.required) return undefined;
  if (result === undefined) return `${check.id}: no result${unstartedBecause === undefined ? '' : ` (${unstartedBecause})`}`;
  if (result.exitCode !== 0) return `${check.id}: exit code ${String(result.exitCode)}`;
  if (check.expectedSuiteCount !== undefined) {
    if (result.suiteCount === null) return `${check.id}: expected ${String(check.expectedSuiteCount)} suites, count unknown`;
    if (result.suiteCount < check.expectedSuiteCount) {
      return `${check.id}: expected ${String(check.expectedSuiteCount)} suites, counted ${String(result.suiteCount)}`;
    }
  }
  return undefined;
}

interface StateChange {
  readonly station: StationId;
  readonly status: TaskStatus;
  readonly evidence?: VaultRef;
  readonly violation?: VaultRef;
}

/** Commits the next state through the vault's version check and keeps what it stored. */
async function commit(ctx: LineContext, change: StateChange): Promise<void> {
  const { state } = ctx;
  ctx.state = await ctx.components.vault.commitRunState(
    {
      runId: state.runId,
      station: change.station,
      tasks: { ...state.tasks, [ctx.task.id]: change.status },
      evidenceRefs: change.evidence === undefined ? state.evidenceRefs : [...state.evidenceRefs, change.evidence],
      violations: change.violation === undefined ? state.violations : [...state.violations, change.violation],
      version: state.version,
    },
    state.version,
  );
}

/**
 * The Workspace alone, nothing else mounted, no egress, no limits: rw for
 * build, ro for verification, so the checks run against a tree they cannot
 * modify (I3). There is no image; the stub ignores it.
 */
function workspaceOnly(fixture: FixtureTask, mode: 'rw' | 'ro'): SandboxSpec {
  return {
    image: 'none',
    mounts: { workspace: { source: fixture.workspace, target: '/workspace', mode }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0, memoryMb: 0, pids: 0, wallClockMs: 0 },
  };
}

/** No analysis ran, and SKELETON_LINE says so; an empty report is not a clean one (S1 finding 4e). */
function emptyTamperReport(): TamperReport {
  return {
    assertionsWeakened: [],
    skipMarkersAdded: [],
    testsDeleted: [],
    snapshotsRegenerated: [],
    coverageDelta: 0,
    protectedPathsTouched: [],
  };
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}
