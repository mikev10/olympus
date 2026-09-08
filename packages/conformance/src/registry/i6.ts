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
        'Review seat assembly must refuse a reviewer whose family equals the author\'s, or record reduced ' +
        'independence when only one family is available. Seats are assembled by the station machine (P4); ' +
        'the multi-seat panel itself is M3.',
    }),
  ],
};
