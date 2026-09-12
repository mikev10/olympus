import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FixtureTask, RunRequest } from '@olympus-ai/api';
import type { AutonomyLevel, RunId, StationId, TaskId } from '@olympus-ai/core';
import { compileError, compileOk, pending, runtime } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { workspaceRoot } from '../kit/workspace.js';
import { contendOnCommit, withVaultDirs } from './local-vault.js';
import { BUILD_CAP, GRANTED_ROLE, ROLE_CEILING, grantingDocument } from './policy.js';

/** The declaration order the entry point promises: vault, sandbox, driver, then the line itself. */
const SKELETON_COMPONENTS: readonly string[] = ['StubVault', 'StubSandboxProvider', 'StubDriver', 'SkeletonLine'];

/** Processes contending on one run's state. More than a pair, so a primitive that happens to serialise two writers is still exposed. */
const CONTENDERS = 8;

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
    runtime({
      id: 'I5.stale-commit-is-refused-under-contention',
      title:
        'concurrent commitRunState calls from separate processes against one ifVersion leave exactly one winner holding the whole record; every loser is refused with a reason rather than silently applied, and a stale commit afterwards stores nothing',
      run: async () => {
        await withVaultDirs('p1-i5-contend-', async (dirs, base) => {
          const runId = 'i5-contend';
          const outcomes = await contendOnCommit(dirs, base, runId, '0', CONTENDERS);

          const winners = outcomes.filter((o) => o.ok);
          if (winners.length !== 1) {
            const detail = outcomes.map((o) => `${o.tag}: ${o.ok ? `stored ${String(o.version)}` : `refused (${o.message})`}`);
            throw new Error(
              `I5: ${String(CONTENDERS)} processes committed run state from version 0 and ${String(winners.length)} succeeded; ` +
                'exactly one may. A lost update is a silent degrade of the only record task status lives in.' +
                `\n  ${detail.join('\n  ')}`,
            );
          }
          const [winner] = winners;
          if (winner === undefined) throw new Error('I5: the winner list has one entry and no entry in it');
          if (winner.version !== '1') {
            throw new Error(`I5: the winning commit stored version ${String(winner.version)}, expected 1`);
          }
          for (const loser of outcomes.filter((o) => !o.ok)) {
            if (loser.message === '') {
              throw new Error(`I5: the refused commit from ${loser.tag} carries no reason; a refusal that says nothing is a silent failure`);
            }
          }

          // The record that landed must be one writer's whole state, not a
          // blend: each child tags its own `tasks`, so the stored state names
          // exactly one of them.
          const { LocalVault } = await import('@olympus-ai/vault');
          const vault = new LocalVault(dirs);
          const stored = await vault.readRunState(runId as RunId);
          if (stored.version !== '1') throw new Error(`I5: the stored state is at version ${stored.version}, expected 1`);
          const tags = Object.keys(stored.tasks);
          if (tags.length !== 1 || tags[0] !== winner.tag) {
            throw new Error(`I5: the stored state carries tasks [${tags.join(', ')}]; expected only the winner's ${winner.tag}`);
          }

          // The same refusal, uncontended: a commit from a version that has
          // already been superseded stores nothing at all.
          let stale = true;
          try {
            await vault.commitRunState({ ...stored, version: '0' }, '0');
          } catch {
            stale = false;
          }
          if (stale) throw new Error('I5: a commit from the superseded version 0 was accepted');
          const after = await vault.readRunState(runId as RunId);
          if (after.version !== '1' || Object.keys(after.tasks).join(',') !== winner.tag) {
            throw new Error(`I5: the refused stale commit changed the store to version ${after.version} with tasks [${Object.keys(after.tasks).join(', ')}]`);
          }
        });
      },
    }),
    runtime({
      id: 'I5.over-request-refused',
      title:
        'the real engine refuses a level above the global cap, the station cap, or the role ceiling with reason exceeds-cap, carries no level on the refusal, and grants a request at or below the tightest bound at exactly the level asked for',
      run: async () => {
        const { StrictPolicyEngine } = await import('@olympus-ai/core');
        const engine = new StrictPolicyEngine();
        const policy = engine.resolvePolicy(grantingDocument());

        // Three bounds, three different values, so each refusal names the one
        // that actually bit. `build` is capped below the role ceiling, which is
        // itself below the global cap.
        const overRequests: Array<{ readonly level: AutonomyLevel; readonly station: StationId; readonly bound: string }> = [
          { level: 2, station: 'build', bound: `the ${String(BUILD_CAP)} cap on build` },
          { level: 3, station: 'verify', bound: `the role ceiling of ${String(ROLE_CEILING)}` },
        ];
        for (const { level, station, bound } of overRequests) {
          const outcome = engine.resolveAutonomy(level, station, GRANTED_ROLE, policy);
          if (outcome.ok) {
            throw new Error(
              `I5: L${String(level)} at '${station}' was granted at L${String(outcome.level)} against ${bound}. ` +
                'An over-request must be refused; a downgrade returns a level the caller never asked for and did not ' +
                'agree to, while reporting success.',
            );
          }
          if (outcome.reason !== 'exceeds-cap') {
            throw new Error(`I5: L${String(level)} at '${station}' was refused as '${outcome.reason}'; expected 'exceeds-cap'`);
          }
          if (Object.hasOwn(outcome, 'level')) {
            throw new Error(`I5: the refusal for L${String(level)} at '${station}' carries a level; there must be nothing on it to mistake for a grant`);
          }
          if (outcome.detail === '') {
            throw new Error(`I5: the refusal for L${String(level)} at '${station}' carries no detail`);
          }
        }

        // The global cap, which the fixture document sets to the maximum and
        // so can never bite on its own. Lowered here, it must refuse a request
        // the station cap and role ceiling would both have allowed.
        const grounded = engine.resolvePolicy({ ...grantingDocument(), globalCap: 0, stationCaps: {} });
        const global = engine.resolveAutonomy(1, 'verify', GRANTED_ROLE, grounded);
        if (global.ok) {
          throw new Error(`I5: L1 at 'verify' was granted at L${String(global.level)} under a global cap of L0`);
        }
        if (global.reason !== 'exceeds-cap') {
          throw new Error(`I5: a request above the global cap was refused as '${global.reason}'; expected 'exceeds-cap'`);
        }
        if (!global.detail.includes('global L0')) {
          throw new Error(`I5: the refusal does not name the bound that bit: ${global.detail}`);
        }
        if (!engine.resolveAutonomy(0, 'verify', GRANTED_ROLE, grounded).ok) {
          throw new Error('I5: L0 under a global cap of L0 was refused; the cap is a ceiling, not an exclusion');
        }

        // The control: a request within every bound is granted, and granted at
        // the level requested rather than raised or lowered to a cap. An engine
        // that refused everything would satisfy the loop above.
        for (const level of [0, 1] as const) {
          const outcome = engine.resolveAutonomy(level, 'build', GRANTED_ROLE, policy);
          if (!outcome.ok) {
            throw new Error(`I5: L${String(level)} at 'build' is within every bound and was refused (${outcome.reason}: ${outcome.detail})`);
          }
          if (outcome.level !== level) {
            throw new Error(`I5: L${String(level)} at 'build' resolved to L${String(outcome.level)}; a request inside the caps is granted as asked, never adjusted`);
          }
        }
      },
    }),
  ],
  pending: [
    pending({
      id: 'I5.policy-document-load-is-hardened',
      owner: 'P9',
      reason:
        'P3 validates an already-parsed policy document; nothing yet reads policy.yaml off a disk, and no package ' +
        'carries a YAML parser (D-P3-01). The loader is the first code to touch untrusted-shaped bytes on their way ' +
        'into the Vault, so the unit that adds it owes four refusals, not four configured options: an exact version ' +
        'pin with no caret on the parser; maxAliasCount 0, so an alias bomb cannot expand; a byte cap on the ' +
        'document; and a nesting-depth limit. Each must be asserted as a refusal that fails when the setting is ' +
        'relaxed. Owner is P9 because P4 is handed a resolved Policy and reads no file, and packages/api is the ' +
        'run-creation path; a unit before P9 that needs a Vault-resident policy at run time inherits this entry by ' +
        'editing the owner.',
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
