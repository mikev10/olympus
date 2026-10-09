import { compileError, external } from '../kit/assert.js';
import { ENFORCEMENT_DECISIONS_RECORDED } from './decisions.js';
import { RUN_REPORT_READS_ONLY_RECORDS } from './integration.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { UNMET_EXPECTATION_FAILS_THE_GATE } from './adapters.js';
import { HTTP_VERDICT_JUDGED_OUTSIDE_THE_PRODUCT, HTTP_PROBE_SHARES_NETWORK_NOT_FILESYSTEM } from './http.js';
import { CALL_RECORDED_BEFORE_IT_IS_MADE, COST_IS_RUNTIME_METERED, RESUME_DERIVES_STATE_FROM_THE_VAULT } from './line-assertions.js';
import { ESCALATION_DECIDED_FROM_FAILED_GATES, RELAY_BOUND_TO_TIER_MODEL } from './tier.js';
import { STATUS_DERIVED_FROM_CHECK_RESULTS, TASK_RESULT_KEY_SET_ENFORCED, UNSTARTED_CHECK_IS_IN_THE_EVIDENCE } from './verification.js';
import { READINESS_OUTCOME_IS_RUNTIME_DERIVED } from './readiness.js';

/** I2: The runtime derives status; the model never reports it. */
export const I2: InvariantEntry = {
  title: INVARIANTS.I2,
  assertions: [
    READINESS_OUTCOME_IS_RUNTIME_DERIVED,
    RUN_REPORT_READS_ONLY_RECORDS,
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
    // I1a: a call is on record before it is made, so a process stop during it is a lost reading, not a silence (D-I1a-12).
    CALL_RECORDED_BEFORE_IT_IS_MADE,
    // P14: every enforcement decision, by cause, recorded by the runtime for the component that made it.
    ENFORCEMENT_DECISIONS_RECORDED,
    // R14: the tier rises only from the failed gates run state counts, and the relay serves only the tier's model.
    ESCALATION_DECIDED_FROM_FAILED_GATES,
    RELAY_BOUND_TO_TIER_MODEL,
    // P13's paid control: the meter counts what the session used, so a reading of zero is not a meter that looked nowhere (I8).
    external({
      id: 'I2.relay-meter-agrees-with-session',
      title: "the relay's reading of a session equals the CLI's own account of it, class by class, so the meter is not blind to what the session used",
      level: 'runtime',
      package: '@olympus-ai/driver-claude-code',
      file: 'test/invariants.test.ts',
    }),
    // I1a's paid run: on the composed host, every real call is metered by the relay the line provisioned, and its record names the runtime's model.
    external({
      id: 'I2.line-usage-is-metered-and-names-its-model',
      title:
        "every usage record of a real driver call on the composed host is metered by the relay the line provisioned, and names the model the runtime resolved the scope's tier to, never the driver's own account",
      level: 'runtime',
      package: '@olympus-ai/api',
      file: 'test/paid/line.paid.test.ts',
    }),
  ],
  pending: [],
};
