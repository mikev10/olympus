import { compileError, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';

/** I6: Reviewers never share the author's model family. */
export const I6: InvariantEntry = {
  title: INVARIANTS.I6,
  assertions: [
    compileError({
      id: 'I6.model-family-is-explicit',
      title: 'ModelFamily is branded: a plain string, the driver id, the provider, or the model name cannot be passed as a family',
      fixture: 'i6/model-family-is-explicit.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I6.review-seat-family-check',
      owner: 'P4',
      reason:
        'Review seat assembly must compare the reviewer\'s family with the author\'s on every seat. At L0-L2, when only ' +
        'one family is available, the seat may be filled by the same family and the run must record reduced independence ' +
        'in the gate result rather than claim the guarantee. At L3 a same-family reviewer is refused and the run does not ' +
        'advance; reduced independence is not reportable at L3. Both halves must be asserted. Seats are assembled by the ' +
        'station machine (P4); the multi-seat panel itself is M3.',
    }),
  ],
};
