/**
 * R2's refusals to guess. A rate over nothing is `no-sample`, never 0% or
 * 100%; a run refused at admission is counted and judged by no throughput
 * rate; and a cost estimate without history declines, naming the cells it
 * lacks, rather than offering a figure nobody measured (I5).
 */
import type { ModelFamily, RunId } from '@olympus-ai/core';
import { runtime } from '../kit/assert.js';

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
