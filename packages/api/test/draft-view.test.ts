/**
 * R55 (#175): the draft a person reads is the draft the hash covers. The
 * route's own behaviour, through the CLI, is `I9.draft-is-read-through-the-api`.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { DraftAttempt, RunId, RunState, VaultRef } from '@olympus-ai/core';
import { draftDigest, type DraftFile, type DraftRecord, type Vault } from '@olympus-ai/vault';
import { awaitingKey, readDraft, specDraftPaths, type RunStanding } from '../src/index.js';

const RUN = 'run-r55' as RunId;
const REF = { runId: RUN, kind: 'draft', hash: 'a'.repeat(64) } as VaultRef;

function file(path: string, text: string): DraftFile {
  const bytes = Buffer.from(text, 'utf8');
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') };
}

const QUESTIONS = { assumptions: [{ point: 'the greeting', chose: 'hello' }], openQuestions: ['which file?'] };
const SPEC = file(specDraftPaths(RUN).spec, '# spec\n');
const FILES = [SPEC, file(specDraftPaths(RUN).questions, JSON.stringify(QUESTIONS))];

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    runId: RUN, station: 'spec', attempt: 1, sha256: draftDigest(FILES), files: FILES, discarded: [], problems: [],
    model: {} as DraftRecord['model'], role: {} as DraftRecord['role'], collectedBy: 'runtime',
    ...overrides,
  };
}

function attempt(overrides: Partial<DraftAttempt> = {}): DraftAttempt {
  return { attempt: 1, draft: REF, sha256: draftDigest(FILES), critic: null, baseRun: null, failed: [], sentBack: null, ...overrides };
}

function state(attempts: readonly DraftAttempt[]): RunState {
  return { runId: RUN, drafts: { spec: { attempts, locked: null, parked: false } } } as unknown as RunState;
}

function vault(stored: unknown): Vault {
  return { read: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(stored))) } as unknown as Vault;
}

describe('readDraft', () => {
  test('returns the latest recorded draft with its files and the questions part as read', async () => {
    const read = await readDraft(vault(record()), state([attempt()]), 'spec');
    expect(read).toEqual({ ok: true, draft: { sha256: draftDigest(FILES), attempt: 1 }, files: FILES, questions: { kind: 'read', ...QUESTIONS } });
  });

  test('an attempt that has drafted nothing yet is passed over for the last one that has', async () => {
    const read = await readDraft(vault(record()), state([attempt(), attempt({ attempt: 2, draft: null, sha256: null, failed: null })]), 'spec');
    expect(read.ok && read.draft.attempt).toBe(1);
  });

  test('a station with no draft is no-draft, whether it has no attempts or none recorded', async () => {
    for (const s of [state([]), state([attempt({ draft: null, sha256: null })]), { runId: RUN, drafts: {} } as unknown as RunState]) {
      expect(await readDraft(vault(record()), s, 'spec')).toMatchObject({ ok: false, reason: 'no-draft' });
    }
    expect(await readDraft(vault(record()), state([attempt()]), 'test-design')).toMatchObject({ ok: false, reason: 'no-draft' });
  });

  test('bytes, a file list, or a record that does not match the hash run state holds is refused, with no file returned', async () => {
    const changed = [{ ...SPEC, base64: Buffer.from('other bytes').toString('base64') }, ...FILES.slice(1)];
    const extra = [...FILES, file('extra.md', 'x')];
    const cases: unknown[] = [
      record({ files: changed }),
      record({ files: extra }),
      record({ files: extra, sha256: draftDigest(extra) }),
      record({ attempt: 2 }),
      record({ station: 'test-design' }),
      record({ runId: 'another-run' as RunId }),
      { ...record(), files: 'none' },
      // A record that is not a record, or a file that is not a file, is a mismatch too, never a throw (review: gemini-3).
      null,
      'text',
      [],
      { ...record(), files: [null] },
      { ...record(), files: [{ path: 1, sha256: 'x', base64: 'eA==' }] },
      { ...record(), files: [{ path: 'p', sha256: 'x' }] },
    ];
    for (const stored of cases) {
      const read = await readDraft(vault(stored), state([attempt()]), 'spec');
      expect(read, JSON.stringify(stored).slice(0, 80)).toMatchObject({ ok: false, reason: 'mismatch' });
      expect(read).not.toHaveProperty('files');
    }
    const unreadable = { read: () => Promise.reject(new Error('no such object')) } as unknown as Vault;
    expect(await readDraft(unreadable, state([attempt()]), 'spec')).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  test('a questions file the runtime cannot read is unreadable, and a draft without one has none', async () => {
    for (const text of ['not json', '{"openQuestions": []}', '[]']) {
      const files = [SPEC, file(specDraftPaths(RUN).questions, text)];
      const read = await readDraft(vault(record({ files, sha256: draftDigest(files) })), state([attempt({ sha256: draftDigest(files) })]), 'spec');
      expect(read.ok && read.questions).toEqual({ kind: 'unreadable' });
    }
    const files = [SPEC];
    const read = await readDraft(vault(record({ files, sha256: draftDigest(files) })), state([attempt({ sha256: draftDigest(files) })]), 'spec');
    expect(read.ok && read.questions).toEqual({ kind: 'none' });
  });
});

describe('awaitingKey', () => {
  const draft = { sha256: 'h', attempt: 2 };
  const waiting = { standing: 'awaiting-approval', key: 'spec:1', escalations: [], draft: { station: 'spec', draft, failed: [], problems: [], critic: null, attemptsLeft: 1 } } as RunStanding;

  test('is the key only where the standing names this station, hash, and attempt as the draft waiting', () => {
    expect(awaitingKey(waiting, 'spec', draft)).toBe('spec:1');
    expect(awaitingKey(waiting, 'spec', { sha256: 'h', attempt: 1 })).toBeNull();
    expect(awaitingKey(waiting, 'spec', { sha256: 'other', attempt: 2 })).toBeNull();
    expect(awaitingKey(waiting, 'test-design', draft)).toBeNull();
    expect(awaitingKey({ standing: 'open' }, 'spec', draft)).toBeNull();
    expect(awaitingKey({ standing: 'awaiting-approval', key: 'integrate:1', escalations: [], draft: null }, 'spec', draft)).toBeNull();
  });
});
