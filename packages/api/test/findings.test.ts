import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunId } from '@olympus-ai/core';
import {
  deriveOutcomes, findingId, holdingHunk, mapLine, parseFindingId, parseHunkRanges, readSeatFindings, type FindingGapInput, type FindingInput, type HunkRange, type RunRecords,
} from '../src/index.js';
import { pathHunks } from '../src/history.js';

const made: string[] = [];
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'r28-tree-'));
  made.push(dir);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

describe('a finding\'s id (R28)', () => {
  it('names its source record and index, and reads back as the same finding', () => {
    const hash = 'a'.repeat(64);
    const review = { source: { kind: 'review' as const, record: { runId: 'run-1' as RunId, kind: 'review-findings' as const, hash } }, index: 2 };
    expect(findingId(review)).toBe(`review:run-1:${hash}:2`);
    expect(parseFindingId(findingId(review))).toEqual(review);
    const nightly = { source: { kind: 'nightly' as const, record: hash }, index: 0 };
    expect(parseFindingId(findingId(nightly))).toEqual(nightly);
  });

  it('is refused for anything else', () => {
    for (const id of ['', 'review:run-1:abc:0', `nightly:${'a'.repeat(64)}:01`, `review:../x:${'a'.repeat(64)}:0`, `critic:r:${'a'.repeat(64)}:0:1`, `other:r:${'a'.repeat(64)}:0`]) {
      expect(parseFindingId(id), id).toBeNull();
    }
  });
});

describe('a line mapped through a zero-context diff (D-R28-01)', () => {
  const h = (oldStart: number, oldLines: number, newStart: number, newLines: number): HunkRange => ({ oldStart, oldLines, newStart, newLines });

  it('shifts by every hunk wholly before it, and is unmappable where a hunk rewrote it', () => {
    // Two lines inserted after line 2, and line 8 replaced by three.
    const hunks = [h(2, 0, 3, 2), h(8, 1, 10, 3)];
    expect(mapLine(hunks, 1)).toBe(1);
    expect(mapLine(hunks, 2)).toBe(2);
    expect(mapLine(hunks, 3)).toBe(5);
    expect(mapLine(hunks, 8)).toBeNull();
    expect(mapLine(hunks, 9)).toBe(13);
    expect(mapLine([], 4)).toBe(4);
  });

  it('finds the hunk whose base side holds a line; a pure insertion holds none', () => {
    const hunks = [h(2, 0, 3, 2), h(8, 2, 10, 1)];
    expect(holdingHunk(hunks, 9)).toEqual(h(8, 2, 10, 1));
    expect(holdingHunk(hunks, 2)).toBeUndefined();
    expect(holdingHunk(hunks, 10)).toBeUndefined();
  });

  it('reads each header, a count left out being one', () => {
    expect(parseHunkRanges('diff --git a/x b/x\n@@ -3 +3,2 @@\n-a\n+b\n+c\n@@ -0,0 +7 @@\n+d\n')).toEqual([h(3, 1, 3, 2), h(0, 0, 7, 1)]);
  });

  it('is read from git, renames off, and a path either commit lacks maps nothing', async () => {
    const repo = await tree({ 'src/a.ts': 'one\ntwo\nthree\n' });
    const git = (...args: string[]): string => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'one');
    const first = git('rev-parse', 'HEAD');
    await writeFile(join(repo, 'src/a.ts'), 'zero\none\ntwo\nTHREE\n');
    git('commit', '-qam', 'two');
    const second = git('rev-parse', 'HEAD');
    const hunks = await pathHunks(repo, first, second, 'src/a.ts');
    expect(hunks).toEqual([h(0, 0, 1, 1), h(3, 1, 4, 1)]);
    expect(mapLine(hunks ?? [], 2)).toBe(3);
    expect(mapLine(hunks ?? [], 3)).toBeNull();
    expect(await pathHunks(repo, first, second, 'src/missing.ts')).toBeNull();
  });
});

describe('a review seat\'s findings, read strictly (R28)', () => {
  const result = (findings: unknown): string => JSON.stringify({ findings });

  it('locates a finding in the reviewed tree, and refuses one naming no file or line it holds', async () => {
    const dir = await tree({ 'src/a.ts': 'one\ntwo\n' });
    const read = await readSeatFindings('review', result([
      { category: 'spec-mismatch', path: 'src/a.ts', line: 2, note: 'kept in the claim only' },
      { category: 'spec-mismatch', path: 'src/a.ts', line: 3 },
      { category: 'spec-mismatch', path: 'src/gone.ts', line: 1 },
      { category: 'check-bypassed', path: 'src', line: 1 },
    ]), dir);
    expect(read).toEqual({
      readable: true,
      findings: [
        { kind: 'located', category: 'spec-mismatch', path: 'src/a.ts', line: 2 },
        { kind: 'refused', cause: 'unlocated', defects: [] },
        { kind: 'refused', cause: 'unlocated', defects: [] },
        { kind: 'refused', cause: 'unlocated', defects: [] },
      ],
    });
    expect(JSON.stringify(read)).not.toContain('kept in the claim only');
  });

  it('refuses fields outside their rules as unrecordable, naming the field and never the value, by each seat\'s own categories', async () => {
    const dir = await tree({ 'a.ts': 'x\n' });
    const read = await readSeatFindings('review', result([
      { category: 'unchecked-input', path: 'a.ts', line: 1 },
      { category: 'spec-mismatch', path: '../a.ts', line: 1 },
      { category: 'spec-mismatch', path: '/etc/passwd', line: 1 },
      { category: 'spec-mismatch', path: 'a.ts', line: 0 },
      { category: 'spec-mismatch', path: 'a.ts', line: 1, severity: 'high' },
      'a.ts:1',
    ]), dir);
    expect(read.findings.map((f) => (f.kind === 'refused' ? [f.cause, f.defects.map((d) => `${d.field}:${d.problem}`)] : f.kind))).toEqual([
      ['unrecordable', ['category:out-of-class']],
      ['unrecordable', ['path:out-of-class']],
      ['unrecordable', ['path:out-of-class']],
      ['unrecordable', ['line:out-of-class']],
      ['unrecordable', ['severity:unknown']],
      ['unrecordable', ['category:missing', 'path:missing', 'line:missing']],
    ]);
    const security = await readSeatFindings('security', result([{ category: 'unchecked-input', path: 'a.ts', line: 1 }]), dir);
    expect(security.findings).toEqual([{ kind: 'located', category: 'unchecked-input', path: 'a.ts', line: 1 }]);
  });

  it('records a message it cannot read as unreadable, never as no findings (I5)', async () => {
    const dir = await tree({ 'a.ts': 'x\n' });
    for (const narrative of ['Looks good to me.', '{"findings": "none"}', '{"findings": [], "verdict": "pass"}', '']) {
      expect(await readSeatFindings('review', narrative, dir)).toEqual({ readable: false, findings: [] });
    }
    expect(await readSeatFindings('review', '{"findings": []}', dir)).toEqual({ readable: true, findings: [] });
  });
});

describe('finding rates (R28)', () => {
  const run = (over: Partial<RunRecords>): RunRecords => ({
    runId: 'r' as RunId, ending: 'merged', requestedLevel: 2, stack: 's', startedAt: null, mergedAt: null, mergeCommit: null, approvalsSpent: 0,
    tasks: [], decisions: [], usage: [], cost: null, reviewGrade: 'different-family', critiques: [], observations: [], lineCoverage: false, ...over,
  });
  const f = (seat: string, family: string, code: boolean, outcome: FindingInput['outcome']): FindingInput => ({ seat, family, code, outcome });

  it('are each a proportion over findings raised, per seat kind and per family', () => {
    const { findings } = deriveOutcomes([run({})], {}, null, [f('critic', 'gpt', false, 'addressed'), f('critic', 'gpt', false, 'open'), f('critic', 'claude', false, 'dismissed')]);
    expect(findings.bySeat.critic?.raised).toBe(3);
    expect(findings.bySeat.critic?.addressed).toMatchObject({ kind: 'rate', count: 1, sample: 3, bound: { side: 'lower' } });
    expect(findings.bySeat.critic?.dismissed).toMatchObject({ kind: 'rate', count: 1, sample: 3, bound: { side: 'upper' } });
    expect(findings.bySeat.critic?.open).toMatchObject({ kind: 'rate', count: 1, sample: 3 });
    expect(findings.byFamily.gpt?.raised).toBe(2);
    expect(findings.byFamily.claude?.raised).toBe(1);
  });

  it('leave a code seat\'s addressed rate unmeasured, never 0 of n, where no run recorded line coverage (D-R28-01)', () => {
    const items = [f('review', 'gpt', true, 'open'), f('review', 'gpt', true, 'dismissed')];
    expect(deriveOutcomes([run({})], {}, null, items).findings.bySeat.review?.addressed).toEqual({ kind: 'unmeasured', cause: 'no-line-coverage' });
    expect(deriveOutcomes([run({ lineCoverage: true })], {}, null, items).findings.bySeat.review?.addressed).toMatchObject({ kind: 'rate', count: 0, sample: 2 });
    expect(deriveOutcomes([run({})], {}, null, items).findings.bySeat.review?.dismissed).toMatchObject({ kind: 'rate', count: 1, sample: 2 });
  });

  it('say how many findings each group refused and how many results it could not read, beside the rates (R28 triage, codex-2, gemini-1)', () => {
    const gaps: FindingGapInput[] = [{ seat: 'review', family: 'gpt', kind: 'refused' }, { seat: 'review', family: 'gpt', kind: 'unreadable' }, { seat: 'security', family: 'gpt', kind: 'refused' }];
    const { findings } = deriveOutcomes([run({})], {}, null, [f('review', 'gpt', true, 'open')], { gaps });
    expect(findings.bySeat.review).toMatchObject({ raised: 1, refused: 1, unreadable: 1 });
    expect(findings.bySeat.security).toMatchObject({ raised: 0, refused: 1, unreadable: 0, addressed: { kind: 'no-sample' } });
    expect(findings.byFamily.gpt).toMatchObject({ raised: 1, refused: 2, unreadable: 1 });
  });

  it('measure a addressed rate where a resolution exists or any run in the store recorded line coverage, not only runs in the window (R28 triage, codex-5)', () => {
    const items = [f('review', 'gpt', true, 'addressed'), f('review', 'gpt', true, 'open')];
    expect(deriveOutcomes([run({})], {}, null, items).findings.bySeat.review?.addressed).toMatchObject({ kind: 'rate', count: 1, sample: 2 });
    const open = [f('review', 'gpt', true, 'open')];
    expect(deriveOutcomes([run({})], {}, null, open, { lineCoverage: true }).findings.bySeat.review?.addressed).toMatchObject({ kind: 'rate', count: 0, sample: 1 });
    expect(deriveOutcomes([run({ lineCoverage: true })], {}, null, open, { lineCoverage: false }).findings.bySeat.review?.addressed).toEqual({ kind: 'unmeasured', cause: 'no-line-coverage' });
  });

  it('are empty where nothing was raised', () => {
    expect(deriveOutcomes([run({})]).findings).toEqual({ bySeat: {}, byFamily: {} });
  });
});
