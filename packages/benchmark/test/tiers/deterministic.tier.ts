/**
 * The deterministic tier on the real line (D-R7-04, D-R7-06): every
 * deterministic item of the current corpus, and the result held to the one
 * committed beside the corpus. A control that stops catching, or starts
 * refusing, changes the result, so the change cannot land without a commit
 * that shows it (I8).
 *
 * **Needs a Docker daemon, the pinned node, gitleaks, and semgrep images, and
 * the npm registry for the corpus install.** It fails without them and is
 * never skipped (D-P2-02). `BENCHMARK_WRITE=1` writes the result instead of
 * comparing it; that is how a deliberate change to the corpus or the line is
 * recorded.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { SECRET_SCAN_IMAGE } from '@olympus-ai/adapters';
import { DEFAULT_LIMITS } from '@olympus-ai/api';
import { loadCorpus, type Corpus } from '../../src/corpus.js';
import { deterministicTier } from '../../src/deterministic.js';
import { openBench, type Bench } from '../../src/line.js';
import { serialize } from '../../src/result.js';

const RESULT = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'benchmark', 'v1-deterministic.json');

let base: string;
let bench: Bench;
let corpus: Corpus;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'benchmark-'));
  bench = await openBench(base);
  corpus = await loadCorpus('v1');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

test('the deterministic tier of corpus v1 gives the committed result', async () => {
  const fresh = serialize(await deterministicTier(bench, corpus));
  if (process.env.BENCHMARK_WRITE === '1') {
    await writeFile(RESULT, fresh);
    return;
  }
  expect(fresh).toBe(await readFile(RESULT, 'utf8'));
});

test('the pinned secret scanner finds nothing in the corpus as committed: a credential is only ever whole inside a sandbox', async () => {
  const spec = {
    image: SECRET_SCAN_IMAGE,
    mounts: { workspace: { source: corpus.root, target: '/corpus', mode: 'ro' as const }, others: [] },
    egress: { mode: 'deny-all' as const, allow: [] },
    limits: { ...DEFAULT_LIMITS, wallClockMs: 300_000 },
    user: { ...bench.user },
  };
  const handle = await bench.provider.provision(spec);
  try {
    // The scanner's built-in rules, every suppression ignored, as the line runs it (D-R17-03).
    const ran = await bench.provider.exec(handle, [
      'gitleaks', 'dir', '/corpus', '--no-banner', '--log-level', 'error', '--ignore-gitleaks-allow',
      '--report-format', 'json', '--report-path', '/dev/stdout', '--exit-code', '0',
    ]);
    expect(ran.exitCode, ran.stderr).toBe(0);
    expect(JSON.parse(ran.stdout)).toEqual([]);
  } finally {
    await bench.provider.destroy(handle);
  }
});
