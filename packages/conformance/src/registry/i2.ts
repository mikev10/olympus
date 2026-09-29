import { compileError, external, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { UNMET_EXPECTATION_FAILS_THE_GATE } from './adapters.js';
import { HTTP_VERDICT_JUDGED_OUTSIDE_THE_PRODUCT, HTTP_PROBE_SHARES_NETWORK_NOT_FILESYSTEM } from './http.js';
import { COST_IS_RUNTIME_METERED, RESUME_DERIVES_STATE_FROM_THE_VAULT } from './line-assertions.js';
import { STATUS_DERIVED_FROM_CHECK_RESULTS, TASK_RESULT_KEY_SET_ENFORCED, UNSTARTED_CHECK_IS_IN_THE_EVIDENCE } from './verification.js';

/** I2: The runtime derives status; the model never reports it. */
export const I2: InvariantEntry = {
  title: INVARIANTS.I2,
  assertions: [
    compileError({
      id: 'I2.task-result-has-no-status',
      title: 'TaskResult and AgentClaim have no status, passed, success, verdict, ok, or exitCode field',
      fixture: 'i2/task-result-has-no-status.ts',
    }),
    compileError({
      id: 'I2.task-status-lives-in-run-state',
      title: 'Task carries no status; RunState.tasks is the only place it can be read from',
      fixture: 'i2/task-status-lives-in-run-state.ts',
    }),
    compileError({
      id: 'I2.evidence-collected-by-runtime',
      title: 'EvidenceBundle.collectedBy admits only "runtime" and the bundle has no pass/fail field',
      fixture: 'i2/evidence-collected-by-runtime.ts',
    }),
    compileError({
      id: 'I2.gate-verdict-single-source',
      title: 'GateResult has one verdict and no second boolean to disagree with it',
      fixture: 'i2/gate-verdict-single-source.ts',
    }),
    compileError({
      id: 'I2.records-are-readonly',
      title:
        'RunState, TaskResult, and AgentClaim cannot be mutated after construction: status, station, references, events, and the claim are read-only, and a new state is a new record',
      fixture: 'i2/records-are-readonly.ts',
    }),
    compileError({
      id: 'I2.check-result-declares-expectation',
      title:
        'CheckResult.expectation is required, null for a check with none; a held expectation carries no mismatch and a failed one at least one',
      fixture: 'i2/check-result-declares-expectation.ts',
    }),
    RESUME_DERIVES_STATE_FROM_THE_VAULT,
    UNMET_EXPECTATION_FAILS_THE_GATE,
    // P11: an HTTP verdict is drawn from a client the product cannot replace, and made on the host.
    HTTP_VERDICT_JUDGED_OUTSIDE_THE_PRODUCT,
    HTTP_PROBE_SHARES_NETWORK_NOT_FILESYSTEM,
    STATUS_DERIVED_FROM_CHECK_RESULTS,
    TASK_RESULT_KEY_SET_ENFORCED,
    UNSTARTED_CHECK_IS_IN_THE_EVIDENCE,
    // P13: what a call cost is collected by the runtime from the relay, never taken from the driver's report.
    COST_IS_RUNTIME_METERED,
    // P13's paid control: the meter counts what the session used, so a reading of zero is not a meter that looked nowhere (I8).
    external({
      id: 'I2.relay-meter-agrees-with-session',
      title: "the relay's reading of a session equals the CLI's own account of it, class by class, so the meter is not blind to what the session used",
      level: 'runtime',
      package: '@olympus-ai/driver-claude-code',
      file: 'test/invariants.test.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I2.enforcement-decisions-recorded-by-the-enforcer',
      owner: 'P14',
      reason:
        'A control that refuses leaves no record of having refused. An admission refusal writes nothing, by design; a ' +
        "station refusal returns to its caller and RunState keeps 'parked' but not why; the egress proxy's per-connection " +
        "verdicts go to its container's stdout and are destroyed with it. Only the relay's budget refusals reach the " +
        "Vault, in P13's usage records. So what an agent tried and was stopped from doing is answerable from nowhere, " +
        'and no refusal or park rate can be computed, nor backfilled later. P14 must write each decision, with its ' +
        'cause as a closed type, from the component that made it into a write-once Vault record beside run state, and ' +
        'assert that deleting the write for any one cause fails. Surfaced by the agent-lifecycle amendment ' +
        '(docs/decisions.md, D-A-LC-02).',
    }),
  ],
};
