import { compileError } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { UNMET_EXPECTATION_FAILS_THE_GATE } from './adapters.js';
import { RESUME_DERIVES_STATE_FROM_THE_VAULT } from './line-assertions.js';
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
    STATUS_DERIVED_FROM_CHECK_RESULTS,
    TASK_RESULT_KEY_SET_ENFORCED,
    UNSTARTED_CHECK_IS_IN_THE_EVIDENCE,
  ],
  pending: [],
};
