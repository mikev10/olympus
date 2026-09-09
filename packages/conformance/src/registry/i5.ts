import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixtureTask, RunRequest } from '@olympus-ai/api';
import type { AutonomyLevel, RunId, TaskId } from '@olympus-ai/core';
import { compileError, compileOk, pending, runtime } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { workspaceRoot } from '../kit/workspace.js';

/** The declaration order the entry point promises: vault, sandbox, driver, then the line itself. */
const SKELETON_COMPONENTS: readonly string[] = ['StubVault', 'StubSandboxProvider', 'StubDriver', 'SkeletonLine'];

/** The hello fixture the api package's own test drives: one locked file, one check that exits zero. */
const HELLO_FIXTURE = join('packages', 'api', 'test', 'fixtures', 'hello');

/** I5: Fail closed. */
export const I5: InvariantEntry = {
  title: INVARIANTS.I5,
  assertions: [
    compileError({
      id: 'I5.transition-has-no-warn-and-continue',
      title:
        'StationTransition advances or refuses with a closed reason and the typed payload that reason names beside a message; there is no warned or degraded advance and no prose-only refusal',
      fixture: 'i5/transition-has-no-warn-and-continue.ts',
    }),
    compileError({
      id: 'I5.policy-refusal-is-explicit',
      title: 'PolicyResolution and CapabilityResolution refuse with a reason and detail or succeed with the value; no downgrade marker',
      fixture: 'i5/policy-refusal-is-explicit.ts',
    }),
    compileError({
      id: 'I5.station-requires-declared-capabilities',
      title: 'StationContract.requires accepts only keys of DriverCapabilities',
      fixture: 'i5/station-requires-declared-capabilities.ts',
    }),
    compileError({
      id: 'I5.adapter-set-declares-absent-controls',
      title: 'AdapterSet slots are T | null, never optional, and unavailableControls() is required',
      fixture: 'i5/adapter-set-declares-absent-controls.ts',
    }),
    compileError({
      id: 'I5.check-result-declares-suite-count',
      title: 'CheckResult.suiteCount is required: null is a declared unknown, omission is not representable',
      fixture: 'i5/check-result-declares-suite-count.ts',
    }),
    compileOk({
      id: 'I5.stubs-declare-unsafe',
      title:
        'StubVault, StubSandboxProvider, StubDriver, and SKELETON_LINE are each assignable to DeclaresUnsafe: the type shape, which a declare-only field would also satisfy; runtime existence is proved by I5.unsafe-component-refused-above-l1',
      fixture: 'i5/stubs-declare-unsafe.ts',
    }),
    runtime({
      id: 'I5.unsafe-component-refused-above-l1',
      title:
        'startRun with every stub wired is refused at L2 and L3, naming StubVault, StubSandboxProvider, StubDriver, and SkeletonLine in that order, and passes the hello fixture at L1',
      run: async () => {
        const [api, core, sandbox, vault] = await Promise.all([
          import('@olympus-ai/api'),
          import('@olympus-ai/core'),
          import('@olympus-ai/sandbox'),
          import('@olympus-ai/vault'),
        ]);
        const workspace = await mkdtemp(join(tmpdir(), 's1-hello-'));
        try {
          await cp(join(workspaceRoot(), HELLO_FIXTURE), workspace, { recursive: true });
          const components: RunRequest['components'] = {
            vault: new vault.StubVault(workspace),
            sandbox: new sandbox.StubSandboxProvider(),
            driver: new core.StubDriver(),
          };
          const task: FixtureTask = {
            id: 'hello' as TaskId,
            workspace,
            lockedPaths: ['spec.md'],
            checks: [{ id: 'hello-exit-zero', kind: 'unit', command: 'node -e process.exit(0)', required: true, timeoutMs: 10_000 }],
          };
          const request = (level: AutonomyLevel): RunRequest => ({
            runId: `s1-l${String(level)}` as RunId,
            baseCommit: '0'.repeat(40),
            requestedLevel: level,
            task,
            components,
          });

          for (const level of [2, 3] as const) {
            const outcome = await api.startRun(request(level));
            if (outcome.ok || outcome.reason !== 'unsafe-above-l1') {
              const got = outcome.ok ? 'ok' : outcome.reason;
              throw new Error(`I5: a run at L${String(level)} with every stub wired was not refused as unsafe-above-l1 (got ${got})`);
            }
            const names = outcome.unsafe.map((u) => u.component);
            if (names.join(',') !== SKELETON_COMPONENTS.join(',')) {
              throw new Error(`I5: the L${String(level)} refusal named [${names.join(', ')}]; expected [${SKELETON_COMPONENTS.join(', ')}]`);
            }
            for (const u of outcome.unsafe) {
              if (u.cannotEnforce.length === 0) throw new Error(`I5: ${u.component} declares itself unsafe but names nothing it cannot enforce`);
            }
          }

          const l1 = await api.startRun(request(1));
          if (!l1.ok) {
            throw new Error(`I5: the hello fixture at L1 was refused (${l1.reason}); a runtime that refuses everything does not satisfy this assertion`);
          }
          if (l1.gate.verdict !== 'pass') throw new Error(`I5: the hello fixture at L1 produced verdict '${l1.gate.verdict}', expected 'pass'`);
        } finally {
          await rm(workspace, { recursive: true, force: true });
        }
      },
    }),
  ],
  pending: [
    pending({
      id: 'I5.over-request-refused',
      owner: 'P3',
      reason:
        'resolveAutonomy must return a PolicyRefusal, never a lower level, when the requested level exceeds ' +
        'the station cap or the global cap. Needs the engine P3 delivers.',
    }),
    pending({
      id: 'I5.missing-check-or-shrunken-suite-refuses',
      owner: 'P6',
      reason:
        'A required CheckSpec with no CheckResult, a driver lacking a required capability, or a suiteCount ' +
        'below expectedSuiteCount must fail the gate. Needs the verification runtime P6 delivers.',
    }),
    pending({
      id: 'I5.unsupported-stack-is-loud',
      owner: 'P8',
      reason:
        'AdapterSet.unavailableControls() must name every null slot for a stack, and a stack with any must ' +
        'be refused at L3. Needs the adapter implementations P8 delivers.',
    }),
    pending({
      id: 'I5.check-command-has-a-grammar',
      owner: 'P6',
      reason:
        'CheckSpec.command is one string with no declared grammar, so the skeleton invented one: split on whitespace, ' +
        'no shell, which mangles any quoted argument. A pinned check the runtime cannot execute exactly as pinned must ' +
        'be refused, never approximated. P6 owns the verification manifest and must declare the grammar (an argv array, ' +
        'or a shell string with the shell declared) and assert that an unrepresentable command is refused. Surfaced by ' +
        'S1 (docs/decisions.md, owed contract gaps).',
    }),
  ],
};
