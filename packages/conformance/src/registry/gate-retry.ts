/**
 * R37: a failed gate tells the retry, and the run, why. One free assertion per
 * fix, each failing with its fix reverted (I8): a build retry names each check
 * its gate failed and the cause the gate derived, and no byte of the check's
 * output (#159); a run parked on its gate shows the failed check as its last
 * failure in `status`, and the line tells `events` of it (#158).
 */
import type { RoleId, TaskRequest } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_REPRODUCTION, HELLO_TASK, refusalOf, stubDriver, withLine, writeManifest } from './line.js';

const api = async () => import('@olympus-ai/api');

/** Printed by the check on both streams: container output, which no prompt may carry (I7). */
const OUTPUT_MARKER = 'r37-check-output-marker';

/**
 * `hello-written` as the fixture declares it, printing the marker on stdout
 * and stderr before it exits. Its script builds the file's name rather than
 * spelling it, as the fixture's does (D-R15-03).
 */
const LOUD_REPRODUCTION = {
  ...HELLO_REPRODUCTION,
  command: [
    'node', '-e',
    `const fs = require('node:fs'); const file = ['hello', 'txt'].join('.'); console.log('${OUTPUT_MARKER}'); console.error('${OUTPUT_MARKER}'); process.exit(fs.existsSync(file) && fs.readFileSync(file, 'utf8').trim() === 'hello' ? 0 : 1)`,
  ],
};

export const BUILD_RETRY_TOLD_FAILED_CHECKS: LocalAssertion = runtime({
  id: 'I7.build-retry-told-failed-checks-not-output',
  title:
    "a builder whose first change fails hello-written receives, in its second request's variable suffix, that check's id and the cause the gate derived, exit-code, and no byte of what the check printed, in the suffix, the stable prefix, or the role (#159)",
  run: async () => {
    await withLine('r37-retry-', async (rig) => {
      await writeManifest(rig.dirs, [LOUD_REPRODUCTION]);
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      let builds = 0;
      // The first change writes the wrong content; every later one the right content.
      const driver = await stubDriver({
        during: async (req: TaskRequest) => {
          if (req.role.role !== ('builder' as RoleId)) return;
          builds += 1;
          const content = builds === 1 ? 'goodbye' : 'hello';
          const wrote = await sandbox.exec(req.sandbox, ['node', '-e', `require('node:fs').writeFileSync(['hello', 'txt'].join('.'), ${JSON.stringify(content)})`]);
          if (wrote.exitCode !== 0) throw new Error(`R37 control: the builder's change did not land: ${wrote.stderr}`);
        },
      });
      const components = await rig.components({ driver, sandbox }, { work: false });
      const { startRun } = await api();
      await startRun(await rig.request(components));
      const built = driver.requests.filter((r) => r.role.role === ('builder' as RoleId));
      const [first, second] = built;
      if (first === undefined || second === undefined) throw new Error(`R37 control: the builder was asked ${String(built.length)} times, not twice`);
      if (first.variableSuffix.includes('[failed-checks]')) throw new Error(`R37: the first build was told of a gate that had not run: ${JSON.stringify(first.variableSuffix)}`);
      if (!second.variableSuffix.includes('[failed-checks]\n- hello-written: exit-code')) {
        throw new Error(`R37: the retry was not told hello-written failed on its exit code: ${JSON.stringify(second.variableSuffix)}`);
      }
      for (const req of built) {
        if (req.variableSuffix.includes(OUTPUT_MARKER) || req.stablePrefix.includes(OUTPUT_MARKER) || req.role.instructions.includes(OUTPUT_MARKER)) {
          throw new Error('R37: the check\'s output reached a builder\'s prompt');
        }
      }
    });
  },
});

/** Thrown by the sandbox when the check is run at `verify`: a container's error, which `status` shows as untrusted text. */
const UNSTARTED_MARKER = 'r37-check-could-not-start';

export const UNSTARTED_CHECK_IS_LAST_FAILURE: LocalAssertion = runtime({
  id: 'I5.unstarted-check-is-the-last-failure',
  title:
    "a run whose required check cannot start at verify parks with that check, its cause no-result, and the reason its evidence recorded as its last failure in status, and the line tells events of each failed gate in the same shape (#158)",
  run: async () => {
    await withLine('r37-unstarted-', async (rig) => {
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const inner = new StubSandboxProvider();
      // The check starts over the base, so test-design's exit holds; once a build has run, it cannot be started.
      let armed = false;
      const command = JSON.stringify(HELLO_REPRODUCTION.command);
      const sandbox: SandboxProvider = new Proxy(inner, {
        get(target, key, receiver) {
          if (key !== 'exec') return Reflect.get(target, key, receiver) as unknown;
          return async (...args: Parameters<SandboxProvider['exec']>) => {
            if (armed && JSON.stringify(args[1]) === command) throw new Error(UNSTARTED_MARKER);
            return target.exec(...args);
          };
        },
      });
      const driver = await stubDriver({ during: (req: TaskRequest) => { if (req.role.role === ('builder' as RoleId)) armed = true; return Promise.resolve(); } });
      const components = await rig.components({ driver, sandbox });
      const { admitRun, runStanding } = await api();
      const admission = await admitRun(await rig.request(components));
      if (!admission.ok) throw new Error(`R37 control: the run was not admitted: ${JSON.stringify(admission)}`);
      const told: unknown[] = [];
      refusalOf(await admission.admitted.drive({ onGateFailed: (task, failure) => { told.push({ task, failure }); } }), 'R37 unstarted');
      const { standing } = await runStanding(components.vault, rig.runId);
      if (standing.standing !== 'stopped' || standing.lastFailure?.kind !== 'gate-failed' || standing.lastFailure.task !== HELLO_TASK) {
        throw new Error(`R37: the parked run shows no failed gate as its last failure: ${JSON.stringify(standing)}`);
      }
      const [failed] = standing.lastFailure.failed;
      if (standing.lastFailure.failed.length !== 1 || failed?.checkId !== 'hello-written' || failed.cause !== 'no-result' || failed.untrustedReason?.includes(UNSTARTED_MARKER) !== true) {
        throw new Error(`R37: the last failure is ${JSON.stringify(standing.lastFailure)}`);
      }
      const { STATION_CONTRACTS } = await import('@olympus-ai/core');
      const shape = JSON.stringify({ task: HELLO_TASK, failure: { failed: standing.lastFailure.failed } });
      if (told.length !== STATION_CONTRACTS.build.maxIterations || told.some((t) => JSON.stringify(t) !== shape)) {
        throw new Error(`R37: events were told of ${String(told.length)} failed gates as ${JSON.stringify(told)}`);
      }
    });
  },
});

export const R37_I7: readonly LocalAssertion[] = [BUILD_RETRY_TOLD_FAILED_CHECKS];
export const R37_I5: readonly LocalAssertion[] = [UNSTARTED_CHECK_IS_LAST_FAILURE];
