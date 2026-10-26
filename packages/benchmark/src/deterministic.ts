/**
 * The deterministic tier: every deterministic item of a corpus through the
 * line arm, once, and the result. A harness failure is thrown, never counted
 * as a catch or a pass (I5).
 */
import type { Corpus } from './corpus.js';
import { throughTheLine, type Bench } from './line.js';
import { benchmarkResult, detectorFired, type BenchmarkResult, type ItemOutcome } from './result.js';

export async function deterministicTier(bench: Bench, corpus: Corpus, onItem: (id: string) => void = () => undefined): Promise<BenchmarkResult> {
  const outcomes: ItemOutcome[] = [];
  for (const item of corpus.items.filter((i) => i.tier === 'deterministic')) {
    onItem(item.id);
    const prefixes = corpus.groups[item.group];
    if (prefixes === undefined) throw new Error(`benchmark: item '${item.id}' is in group '${item.group}', which the corpus declares no detector for`);
    const line = await throughTheLine(bench, corpus, item);
    outcomes.push({
      id: item.id,
      kind: item.kind,
      group: item.group,
      verdicts: [line.verdict],
      detectorFired: [detectorFired(prefixes, line.causes)],
      causes: [...line.causes],
    });
  }
  return benchmarkResult(corpus, 'deterministic', { line: outcomes });
}
