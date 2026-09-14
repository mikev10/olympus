import { compileError } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { REVIEW_SEAT_FAMILY_CHECK, REVIEWER_RECEIVES_NO_AUTHOR_MATERIAL } from './line-assertions.js';

/** I6: Reviewers never share the author's model family. */
export const I6: InvariantEntry = {
  title: INVARIANTS.I6,
  assertions: [
    compileError({
      id: 'I6.model-family-is-explicit',
      title: 'ModelFamily is branded: a plain string, the driver id, the provider, or the model name cannot be passed as a family',
      fixture: 'i6/model-family-is-explicit.ts',
    }),
    compileError({
      id: 'I6.review-context-excludes-author-material',
      title: 'the station contract table cannot grant a review seat the author narrative or the plan',
      fixture: 'i6/review-context-excludes-author-material.ts',
    }),
    REVIEW_SEAT_FAMILY_CHECK,
    REVIEWER_RECEIVES_NO_AUTHOR_MATERIAL,
  ],
  pending: [],
};
