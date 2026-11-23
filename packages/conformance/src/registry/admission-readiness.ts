/**
 * R40: admission enforces the readiness ceiling. A run asked above the
 * ceiling its base commit's scan derives is refused, naming what holds it;
 * the ceiling only ever adds a refusal (I4); and a run with no scan records
 * that none ran, rather than reading as cleared (F1).
 */
import type { RunRequest } from '@olympus-ai/api';
import type { RunId } from '@olympus-ai/core';
import { isNoRunState, type AdmissionRecord } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { linePolicy, readRecord, withLine, type LineRig } from './line.js';

const api = async () => import('@olympus-ai/api');

type Port = NonNullable<RunRequest['readiness']>;
type Scanned = Awaited<ReturnType<Port['ceilingAt']>>;

/** A port that answers one ceiling for whatever commit admission asks about, and counts what it was asked. */
function port(level: Scanned['level'], asked: string[] = [], commit?: string): Port {
  return {
    ceilingAt: (_checkout, at) => {
      asked.push(at);
      return Promise.resolve({ kind: 'scanned', level, heldBy: { kind: 'probe', probe: 'testing.adapter' }, commit: commit ?? at });
    },
  };
}

/** Whether the run has state. Only the Vault's own no-state error means none; any other failure is a fault and is thrown (codex-5). */
async function recorded(rig: LineRig): Promise<boolean> {
  try {
    await rig.state();
    return true;
  } catch (error) {
    if (isNoRunState(error)) return false;
    throw error;
  }
}

async function admissionRecord(rig: LineRig): Promise<AdmissionRecord> {
  const components = await rig.components();
  return readRecord<AdmissionRecord>(components.vault, (await rig.state()).admission);
}

export const ADMISSION_REFUSES_ABOVE_THE_READINESS_CEILING: LocalAssertion = runtime({
  id: 'I5.admission-refuses-above-the-readiness-ceiling',
  title:
    'a run asked above the readiness ceiling of its base commit is refused at admission, naming the level, the ceiling, the holding probe, and the commit, and leaves no run state; the same run at the ceiling is admitted with the scanned ceiling in its record',
  run: async () => {
    await withLine('r40-above-', async (rig) => {
      const { admitRun } = await api();
      const asked: string[] = [];
      const outcome = await admitRun(await rig.request(await rig.components(), { requestedLevel: 1, readiness: port(0, asked) }));
      if (outcome.ok || outcome.reason !== 'readiness-refused') throw new Error(`I5: L1 over a scanned L0 ceiling was ${outcome.ok ? 'admitted' : outcome.reason}`);
      if (outcome.requestedLevel !== 1 || outcome.ceiling !== 0 || outcome.heldBy.kind !== 'probe' || outcome.heldBy.probe !== 'testing.adapter' || outcome.commit !== asked[0]) {
        throw new Error(`I5: the readiness refusal does not name what refused it: ${JSON.stringify(outcome)}`);
      }
      if (!outcome.detail.includes('testing.adapter') || !outcome.detail.includes('Refused, not downgraded')) throw new Error(`I5: the refusal's detail is ${outcome.detail}`);
      if (asked.length !== 1 || !/^[0-9a-f]{40,64}$/u.test(asked.join(''))) throw new Error(`I5: the scan was asked about ${asked.join(', ')}, not one resolved commit`);
      if (await recorded(rig)) throw new Error('I5: a run refused by the readiness ceiling left run state behind');
    });
    await withLine('r40-at-', async (rig) => {
      const { admitRun } = await api();
      const outcome = await admitRun(await rig.request(await rig.components(), { requestedLevel: 1, readiness: port(1) }));
      if (!outcome.ok) throw new Error(`I5 control: L1 at a scanned L1 ceiling was refused (${outcome.reason})`);
      const record = await admissionRecord(rig);
      if (record.readiness?.kind !== 'scanned' || record.readiness.level !== 1 || record.readiness.heldBy.kind !== 'probe') {
        throw new Error(`I5: the admission record holds ${JSON.stringify(record.readiness)}, not the scanned ceiling`);
      }
    });
  },
});

export const READINESS_ABSENCE_IS_RECORDED: LocalAssertion = runtime({
  id: 'I4.readiness-absence-is-recorded',
  title:
    'a run admitted with no readiness scan records that none ran and why, an L0 run spends no scan, and neither is refused for it: the policy terms bind alone',
  run: async () => {
    await withLine('r40-none-', async (rig) => {
      const { admitRun } = await api();
      const outcome = await admitRun(await rig.request(await rig.components(), { requestedLevel: 1 }));
      if (!outcome.ok) throw new Error(`I4: a run with no scan port was refused (${outcome.reason})`);
      const record = await admissionRecord(rig);
      if (record.readiness?.kind !== 'not-scanned' || record.readiness.because !== 'no-scanner') {
        throw new Error(`I4: a run with no scan recorded ${JSON.stringify(record.readiness)}`);
      }
    });
    await withLine('r40-zero-', async (rig) => {
      const { admitRun } = await api();
      const asked: string[] = [];
      const outcome = await admitRun(await rig.request(await rig.components(), { requestedLevel: 0, readiness: port(0, asked) }));
      if (!outcome.ok) throw new Error(`I4: an L0 run was refused (${outcome.reason})`);
      if (asked.length > 0) throw new Error('I4: an L0 run was scanned; no ceiling is below L0');
      const record = await admissionRecord(rig);
      if (record.readiness?.kind !== 'not-scanned' || record.readiness.because !== 'level-zero') {
        throw new Error(`I4: an L0 run recorded ${JSON.stringify(record.readiness)}`);
      }
    });
  },
});

export const READINESS_CEILING_NEVER_GRANTS: LocalAssertion = runtime({
  id: 'I4.readiness-ceiling-never-grants-at-admission',
  title:
    'a scanned ceiling above what policy allows admits nothing policy refused: an L1 run under a build cap of L0 is refused by policy whatever the scan derived',
  run: async () => {
    await withLine('r40-grant-', async (rig) => {
      const { admitRun } = await api();
      const policy = await linePolicy({}, { stationCaps: { build: 0 } });
      const outcome = await admitRun(await rig.request(await rig.components(), { requestedLevel: 1, policy, readiness: port(2) }));
      if (outcome.ok || outcome.reason !== 'policy-refused' || outcome.station !== 'build') {
        throw new Error(`I4: a scanned L2 ceiling let an L1 run past a build cap of L0 (${outcome.ok ? 'admitted' : outcome.reason})`);
      }
    });
  },
});

export const READINESS_ANSWER_FOR_ANOTHER_COMMIT_REFUSES: LocalAssertion = runtime({
  id: 'I5.readiness-answer-for-another-commit-refuses',
  title:
    'a readiness scan that answers for another commit than the base admission resolved refuses the admission and leaves no run state, rather than recording a ceiling that is not the base commit\'s',
  run: async () => {
    await withLine('r40-commit-', async (rig) => {
      const { admitRun } = await api();
      let threw = false;
      try {
        await admitRun(await rig.request(await rig.components(), { requestedLevel: 1, readiness: port(2, [], 'f'.repeat(40)) }));
      } catch (error) {
        threw = (error instanceof Error ? error.message : String(error)).includes('not the base commit');
      }
      if (!threw) throw new Error('I5: a ceiling for another commit was not refused');
      if (await recorded(rig)) throw new Error('I5: a refused scan left run state behind');
    });
  },
});

export const RESUME_HOLDS_THE_RECORDED_CEILING: LocalAssertion = runtime({
  id: 'I5.resume-holds-the-recorded-readiness-ceiling',
  title:
    'the admission refusal a resume repeats reads the readiness ceiling from the admission record: a record above its scanned ceiling is refused naming it, one at it, one not scanned, and one written before R40 are not; and resumeRun over a record above its ceiling is refused before the line runs',
  run: async () => {
    await withLine('r40-resume-', async (rig) => {
      const { admitRun, admissionRefusal } = await api();
      const outcome = await admitRun(await rig.request(await rig.components(), { requestedLevel: 1, readiness: port(1) }));
      if (!outcome.ok) throw new Error(`I5 control: the run was refused (${outcome.reason})`);
      const record = await admissionRecord(rig);
      if (record.readiness?.kind !== 'scanned') throw new Error('I5: unreachable, the record holds no scan');
      const at = (readiness: AdmissionRecord['readiness']): AdmissionRecord => {
        const { readiness: _dropped, ...rest } = record;
        return readiness === undefined ? rest : { ...rest, readiness };
      };
      const below = admissionRefusal(at({ ...record.readiness, level: 0 }));
      if (below?.reason !== 'readiness-refused' || below.ceiling !== 0) throw new Error(`I5: a record above its ceiling was not refused (${JSON.stringify(below)})`);
      for (const [name, readiness] of [
        ['at its ceiling', record.readiness],
        ['not scanned', { kind: 'not-scanned', because: 'no-scanner' }],
        ['written before R40', undefined],
      ] as const) {
        if (admissionRefusal(at(readiness)) !== undefined) throw new Error(`I5: a record ${name} was refused`);
      }
      // The resume itself, not only the helper it calls (codex-4): a run whose record holds a ceiling below its
      // level is refused by resumeRun before the line runs, and its state is left as it stood.
      const { resumeRun } = await api();
      const components = await rig.components();
      const state = await rig.state();
      // The Vault admits a run once, so the lowered record is another run's only admission, with this run's state.
      const runId = `${rig.runId}-lowered` as RunId;
      const lowered = await components.vault.recordAdmission({ ...at({ ...record.readiness, level: 0 }), run: { ...record.run, id: runId } });
      const before = await components.vault.commitRunState({ ...state, runId, admission: lowered, version: '0' }, '0');
      const resumed = await resumeRun({ runId, components });
      if (resumed.ok || resumed.reason !== 'readiness-refused' || resumed.ceiling !== 0) {
        throw new Error(`I5: a resume over a record above its ceiling was ${resumed.ok ? 'driven' : resumed.reason}`);
      }
      const after = await components.vault.readRunState(runId);
      if (after.station !== 'intake' || Object.keys(after.tasks).length > 0 || after.version !== before.version) {
        throw new Error(`I5: the refused resume moved the run (station ${after.station}, ${String(Object.keys(after.tasks).length)} tasks)`);
      }
    });
  },
});

export const R40_I4: readonly LocalAssertion[] = [READINESS_ABSENCE_IS_RECORDED, READINESS_CEILING_NEVER_GRANTS];
export const R40_I5: readonly LocalAssertion[] = [ADMISSION_REFUSES_ABOVE_THE_READINESS_CEILING, READINESS_ANSWER_FOR_ANOTHER_COMMIT_REFUSES, RESUME_HOLDS_THE_RECORDED_CEILING];
