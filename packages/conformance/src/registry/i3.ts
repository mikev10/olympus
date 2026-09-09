import { compileError, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';

/** I3: An agent may not be judged by an artifact it can write. */
export const I3: InvariantEntry = {
  title: INVARIANTS.I3,
  assertions: [
    compileError({
      id: 'I3.context-grants-name-locked-artifacts',
      title: 'ContextGrant names the locked spec and acceptance tests; there is no grant for a mutable spec',
      fixture: 'i3/context-grants-name-locked-artifacts.ts',
    }),
    compileError({
      id: 'I3.lock-verdict-names-tampered-paths',
      title: 'a failed LockVerdict must list the tampered paths, and a passing one cannot carry a warning',
      fixture: 'i3/lock-verdict-names-tampered-paths.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I3.lock-verification-detects-change',
      owner: 'P1',
      reason:
        'Vault.verifyLocks must return ok: false with the changed paths when a locked artifact\'s bytes ' +
        'differ from the LockManifest. There is no Vault implementation to exercise until P1.',
    }),
    pending({
      id: 'I3.transition-reverifies-locks',
      owner: 'P4',
      reason:
        'Every station transition must re-verify the lock manifest and refuse with reason "lock-tamper" on ' +
        'a mismatch. The station machine that performs transitions arrives with P4.',
    }),
    pending({
      id: 'I3.lock-preserves-earlier-entries',
      owner: 'P1',
      reason:
        'Vault.lock append-vs-replace semantics: replace loses earlier locked artifacts. The skeleton\'s vault ' +
        'replaces the run\'s manifest on every lock (S1 spec section 2), so a test-design lock would drop the ' +
        'spec lock\'s entries, while I3 requires both locked and re-verified at every transition. The Vault.lock ' +
        'contract is silent on which it means. P1 must make a later lock preserve earlier entries and assert ' +
        'that a re-lock cannot rebase a locked artifact\'s hash. Found by the S1 external review ' +
        '(docs/reviews/2026-09-09-S1-walking-skeleton-adversarial-triage.md, finding 6).',
    }),
  ],
};
