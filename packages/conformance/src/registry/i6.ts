import { compileError, pending } from '../kit/assert.js';
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
  pending: [
    pending({
      id: 'I6.review-seat-reads-only-its-grants',
      owner: 'P6',
      reason:
        'grantedContext keeps the author narrative and the plan out of the review seat\'s TaskRequest, and '
        + 'I6.reviewer-receives-no-author-material proves it by searching the request. The seat is still provisioned over '
        + 'the author\'s whole workspace, and the admitted task graph — the plan — is a file in that tree, so a reviewer '
        + 'granted a read tool can open what its contract denies it. P4 mounts that tree read-only, which stops the seat '
        + 'writing what it judges, and cannot stop it reading: a curated view holding only the grants allowed needs the '
        + 'runtime-collected diff, which P6 produces, in place of the author\'s working copy. P6 owes that view and an '
        + 'assertion whose reviewer actively opens the admitted graph and an author-written sentinel file and is refused '
        + 'both. Surfaced by P4\'s external review, finding 5.',
    }),
  ],
};
