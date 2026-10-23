/**
 * R2's refusals to guess. A rate over nothing is `no-sample`, never 0% or
 * 100%; a run refused at admission is counted and judged by no throughput
 * rate; and a cost estimate without history declines, naming the cells it
 * lacks, rather than offering a figure nobody measured (I5).
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelFamily, RunId } from '@olympus-ai/core';
import type { AdmissionRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import { readRecord, withLine } from './line.js';

const api = async () => import('@olympus-ai/api');

export const OUTCOMES_REFUSE_WITHOUT_A_SAMPLE = runtime({
  id: 'I5.outcomes-refuse-without-a-sample',
  title:
    'over an empty Vault every rate and distribution is no-sample and cost per merge has no figure; a run refused at admission is counted refused and enters no throughput rate; a cost estimate for a station and model with no past tasks declines and names the cell',
  run: async () => {
    const { estimateCost, outcomes } = await api();
    const { StubVault } = await import('@olympus-ai/vault');
    const vault = new StubVault(process.cwd());

    const empty = await outcomes(vault);
    const rates = [empty.safety.caughtFalseDone, empty.throughput.autonomyRatio, empty.throughput.reviewExitRefused];
    const spreads = [empty.throughput.cycleTime, empty.throughput.iterationsToGreen, empty.throughput.attemptsPerTask];
    if ([...rates, ...spreads].some((r) => r.kind !== 'no-sample') || empty.throughput.costPerMergedChange.kind !== 'no-sample' || empty.throughput.rolledYield !== null) {
      throw new Error(`I5: an empty Vault yields a figure: ${JSON.stringify(empty)}`);
    }

    await vault.recordDecision({
      runId: 'r2-refused' as RunId,
      taskId: null,
      station: null,
      decidedAt: new Date().toISOString(),
      occurrence: 'r2-refused',
      decision: { cause: 'admission-refused', decidedBy: 'admission', refusal: { reason: 'invalid-request', problems: [] } },
      collectedBy: 'runtime',
    });
    const refused = await outcomes(vault);
    if (refused.population.refused !== 1 || refused.population.total !== 1) throw new Error(`I5: a run refused at admission is not counted refused: ${JSON.stringify(refused.population)}`);
    if (refused.throughput.autonomyRatio.kind !== 'no-sample') throw new Error('I5: a run refused at admission entered the autonomy ratio');
    if (refused.throughput.decisionsByCause['admission-refused'] !== 1) throw new Error('I5: the admission refusal is not counted by cause');

    const model = { provider: 'conformance', family: 'claude' as ModelFamily, model: 'never-run', version: '1' };
    const estimate = await estimateCost(vault, [{ station: 'build', model }]);
    if (estimate.kind !== 'insufficient-sample' || estimate.short.length !== 1 || estimate.short[0]?.sample !== 0 || estimate.short[0].station !== 'build') {
      throw new Error(`I5: a cost estimate with no history did not decline naming its cell: ${JSON.stringify(estimate)}`);
    }
  },
});

/**
 * A Vault that reads every admission record as one written before R18, with
 * no stack. The store now refuses to write such a record, so the read is what
 * stands in for it.
 */
function beforeStacks(inner: Vault): Vault {
  return new Proxy(inner, {
    get(target, key) {
      if (key === 'read') {
        return async (ref: Parameters<Vault['read']>[0]): Promise<Uint8Array> => {
          const bytes = await target.read(ref);
          if (ref.kind !== 'admission') return bytes;
          const { stack: _dropped, ...before } = JSON.parse(new TextDecoder().decode(bytes)) as AdmissionRecord;
          return new TextEncoder().encode(JSON.stringify(before));
        };
      }
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/**
 * R18: the stack a rate is kept under is the one the runtime's adapter
 * detection found at admission, written into the admission record and never
 * taken from a model's account. A run with no stack on record is
 * `unrecorded`, never filed under a guess, and a record that names none is
 * refused rather than stored, since a stack cannot be written later.
 */
export const ADMISSION_RECORDS_THE_DETECTED_STACK = runtime({
  id: 'I2.admission-records-the-detected-stack',
  title:
    "admission records the stack the base's adapter set detected: vitest 4 declared is recorded vitest@4, and the same rig with no package.json unsupported; the run's records read that stack and outcomes key the run under it; a record with no stack is keyed unrecorded, never a guessed stack; the local Vault refuses an admission record that names no stack and stores nothing",
  run: async () => {
    const { admitRun, deriveOutcomes, readRunRecords, UNRECORDED_STACK } = await api();
    const admitted = (prefix: string, vitest: boolean): Promise<string> => withLine(prefix, async (rig) => {
      if (vitest) await writeFile(join(rig.dirs.artifacts, 'package.json'), JSON.stringify({ name: 'hello', private: true, devDependencies: { vitest: '^4.1.0' } }));
      const components = await rig.components();
      const admission = await admitRun(await rig.request(components));
      if (!admission.ok) throw new Error(`I2: the rig's run was not admitted: ${JSON.stringify(admission)}`);
      const record = await readRecord<AdmissionRecord>(components.vault, admission.admitted.state.admission);

      const read = await readRunRecords(components.vault, rig.runId);
      if (read.stack !== record.stack) throw new Error(`I2: the run's records read stack ${String(read.stack)}, not the ${record.stack} admission recorded`);
      const keys = Object.keys(deriveOutcomes([{ ...read, ending: 'merged' }]).throughput.autonomyRatioByStack);
      if (keys.join() !== record.stack) throw new Error(`I2: a run admitted on ${record.stack} was keyed under ${keys.join(', ')}`);

      const before = await readRunRecords(beforeStacks(components.vault), rig.runId);
      const unkeyed = Object.keys(deriveOutcomes([{ ...before, ending: 'merged' }]).throughput.autonomyRatioByStack);
      if (before.stack !== null || unkeyed.join() !== UNRECORDED_STACK) {
        throw new Error(`I5: a run whose record names no stack was read as ${String(before.stack)} and keyed under ${unkeyed.join(', ')}, not ${UNRECORDED_STACK}`);
      }

      const other = `${rig.runId}-unstacked` as RunId;
      const { stack: _dropped, ...unstacked } = { ...record, run: { ...record.run, id: other } };
      const stored = await components.vault.recordAdmission(unstacked as AdmissionRecord).then(() => true, () => false);
      if (stored || (await components.vault.listRuns()).includes(other)) throw new Error('I5: the local Vault stored an admission record that names no stack');
      return record.stack;
    });

    const detected = await admitted('r18-vitest-', true);
    if (detected !== 'vitest@4') throw new Error(`I2: a base declaring vitest 4 was recorded as ${detected}`);
    // The control: the value is read from the base, not a constant every record carries.
    const none = await admitted('r18-none-', false);
    if (none !== 'unsupported') throw new Error(`I2 control: a base declaring no test framework was recorded as ${none}`);
  },
});
