import { compileError, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';

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
  ],
  pending: [
    pending({
      id: 'I2.status-derived-from-check-results',
      owner: 'P6',
      reason:
        'The runtime must compute a task\'s status from CheckResult exit codes alone and record where the ' +
        'claim and the evidence differ (claimEvidenceDiff). Until P6 there is no code that derives status.',
    }),
    pending({
      id: 'I2.unstarted-check-is-in-the-evidence',
      owner: 'P6',
      reason:
        'CheckResult cannot represent a required check that could not be started, so the evidence bundle simply lacks ' +
        "an entry and the only record of why is the refusal's message. A verdict derived from a fact the evidence does " +
        'not carry is not auditable. P6 must give the bundle a record for a check that produced no result, with the ' +
        'reason, and assert that the gate fails on it and that the bundle shows it. Surfaced by S1 (docs/decisions.md, ' +
        'owed contract gaps).',
    }),
  ],
};
