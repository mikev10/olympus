import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunId } from '@olympus-ai/core';
import type { LockEntry, LockVerdict } from '@olympus-ai/vault';
import { compileError, pending, runtime } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';
import { withVault } from './local-vault.js';

/** The entry for `path`, or a failure naming what the manifest holds instead. */
function entryFor(entries: readonly LockEntry[], path: string): LockEntry {
  const entry = entries.find((e) => e.path === path);
  if (entry === undefined) {
    throw new Error(`I3: the manifest has no entry for ${path}; it holds [${entries.map((e) => e.path).join(', ')}]`);
  }
  return entry;
}

/** The single tampered record a verdict must carry, or a failure describing what it carried instead. */
function soleTampered(verdict: LockVerdict, context: string): { path: string; expected: string; actual: string } {
  if (verdict.ok) throw new Error(`I3: ${context} verified as intact; a changed locked artifact must never verify ok`);
  if (verdict.tampered.length !== 1) {
    throw new Error(`I3: ${context} reported ${String(verdict.tampered.length)} tampered paths, expected exactly one`);
  }
  const [only] = verdict.tampered;
  if (only === undefined) throw new Error(`I3: ${context} reported a tampered list with no entry in it`);
  return only;
}

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
    runtime({
      id: 'I3.lock-verification-detects-change',
      title:
        'a locked artifact whose bytes change verifies as tampered, naming the path with the hash the manifest holds and the hash on disk; a deleted one is reported the same way rather than throwing; an untouched one verifies clean',
      run: async () => {
        await withVault('p1-i3-change-', async (vault, dirs) => {
          const runId = 'i3-change' as RunId;
          const spec = join(dirs.artifacts, 'spec.md');
          await writeFile(spec, '# hello\n\nThe capability, as locked.\n');

          const manifest = await vault.lock(runId, ['spec.md'], 'spec');
          const locked = entryFor(manifest.entries, 'spec.md');

          const intact = await vault.verifyLocks(runId);
          if (!intact.ok) {
            throw new Error(`I3: an untouched locked artifact verified as tampered (${JSON.stringify(intact.tampered)})`);
          }

          // The failure this invariant exists for: the artifact an agent is
          // judged by is edited after it was locked.
          await writeFile(spec, '# hello\n\nThe capability, quietly widened.\n');
          const changed = soleTampered(await vault.verifyLocks(runId), 'a rewritten locked artifact');
          if (changed.path !== 'spec.md') throw new Error(`I3: the tampered record named ${changed.path}, expected spec.md`);
          if (changed.expected !== locked.sha256) {
            throw new Error(`I3: the tampered record's expected hash is ${changed.expected}, not the ${locked.sha256} the manifest locked`);
          }
          if (changed.actual === changed.expected) {
            throw new Error('I3: the tampered record reports the same hash for expected and actual, so nothing was re-read from disk');
          }

          // A deleted artifact is a mismatch, not an exception: the line must
          // record the violation and refuse, exactly as it does for an edit.
          await rm(spec);
          const deleted = soleTampered(await vault.verifyLocks(runId), 'a deleted locked artifact');
          if (deleted.actual === changed.actual) {
            throw new Error('I3: a deleted locked artifact reports the same actual hash as an edited one; a deletion must be distinguishable');
          }
          if (deleted.expected !== locked.sha256) {
            throw new Error(`I3: the deleted artifact's expected hash is ${deleted.expected}, not the ${locked.sha256} the manifest locked`);
          }
        });
      },
    }),
    runtime({
      id: 'I3.lock-preserves-earlier-entries',
      title:
        'a later lock preserves every earlier entry, so a spec locked at `spec` is still verified after `test-design` locks the acceptance tests, and a re-lock cannot rebase an already-locked artifact\'s hash',
      run: async () => {
        await withVault('p1-i3-preserve-', async (vault, dirs) => {
          const runId = 'i3-preserve' as RunId;
          const spec = join(dirs.artifacts, 'spec.md');
          await writeFile(spec, '# hello\n\nThe capability, as locked.\n');
          await writeFile(join(dirs.artifacts, 'acceptance.test.ts'), "test('hello', () => { expect(run()).toBe(0); });\n");

          const first = await vault.lock(runId, ['spec.md'], 'spec');
          const lockedSpec = entryFor(first.entries, 'spec.md');

          // The second station locks its own artifact. Replace semantics would
          // drop the spec here, and I3 requires both locked and re-verified at
          // every transition.
          const second = await vault.lock(runId, ['acceptance.test.ts'], 'test-design');
          const preserved = entryFor(second.entries, 'spec.md');
          entryFor(second.entries, 'acceptance.test.ts');
          if (preserved.sha256 !== lockedSpec.sha256) {
            throw new Error(`I3: the second lock changed the spec's hash from ${lockedSpec.sha256} to ${preserved.sha256}`);
          }
          if (preserved.lockedBy !== 'spec') {
            throw new Error(`I3: the second lock rewrote the spec's station to ${preserved.lockedBy}; the station that locked an artifact is the audit record`);
          }

          // Verification after the second lock must still cover the first's entries.
          await writeFile(spec, '# hello\n\nThe capability, quietly widened.\n');
          const tampered = soleTampered(await vault.verifyLocks(runId), 'a spec edited after a later station locked its own artifact');
          if (tampered.path !== 'spec.md') {
            throw new Error(`I3: after the second lock, verification named ${tampered.path}; the spec locked at \`spec\` is no longer covered`);
          }

          // Re-locking is how a tamper would launder itself: lock the edited
          // file again and the manifest agrees with the disk.
          let rebased = true;
          try {
            await vault.lock(runId, ['spec.md'], 'test-design');
          } catch {
            rebased = false;
          }
          if (rebased) throw new Error('I3: an already-locked artifact was locked again, which rebases its hash onto the edited bytes');
          const after = soleTampered(await vault.verifyLocks(runId), 'a locked artifact after a refused re-lock');
          if (after.expected !== lockedSpec.sha256) {
            throw new Error(`I3: the refused re-lock still moved the manifest's hash to ${after.expected}`);
          }
        });
      },
    }),
  ],
  pending: [
    pending({
      id: 'I3.transition-reverifies-locks',
      owner: 'P4',
      reason:
        'Every station transition must re-verify the lock manifest and refuse with reason "lock-tamper" on ' +
        'a mismatch. The station machine that performs transitions arrives with P4.',
    }),
  ],
};
