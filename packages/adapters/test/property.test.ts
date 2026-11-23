import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildAdapterSet, FastCheckAdapter, readReports, reportTag } from '../src/index.js';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'property-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const adapter = new FastCheckAdapter(4);

async function sites(text: string): Promise<number[]> {
  const file = join(root, 'p.property.test.ts');
  await writeFile(file, text);
  return (await adapter.registrations(file, 'p.property.test.ts')).map((s) => s.line);
}

describe('FastCheckAdapter.registrations', () => {
  test('finds fc.assert through a default, a namespace, and a named import, at the line of the assert name', async () => {
    expect(await sites("import fc from 'fast-check';\nfc.assert(fc.property(fc.integer(), () => true));\n")).toEqual([2]);
    expect(await sites("import * as f from 'fast-check';\nconst x = 1;\nf.assert(\n  f.property(f.nat(), () => true),\n);\n")).toEqual([3]);
    expect(await sites("import { assert as check, property, nat } from 'fast-check';\ntest('x', () => { check(property(nat(), () => true)); });\n")).toEqual([2]);
  });

  test('a file that imports fast-check and never calls assert registers nothing', async () => {
    expect(await sites("import fc from 'fast-check';\nexport const a = fc.integer();\nfc.check(fc.property(a, () => true));\n")).toEqual([]);
  });

  test('an assert from another module is not a registration', async () => {
    expect(await sites("import { assert } from 'node:assert';\nimport fc from 'fast-check';\nassert(true);\n")).toEqual([]);
  });

  test('a use of the framework\'s assert it cannot locate is refused, not silently left unrequired (codex-2)', async () => {
    await expect(sites("import fc from 'fast-check';\nfc['assert'](fc.property(fc.integer(), () => true));\n")).rejects.toThrow(/computed/);
    await expect(sites("import fc from 'fast-check';\nconst check = fc.assert;\ncheck(fc.property(fc.integer(), () => true));\n")).rejects.toThrow(/not called/);
    await expect(sites("import * as fc from 'fast-check';\nconst { assert } = fc;\nassert(fc.property(fc.integer(), () => true));\n")).rejects.toThrow(/as a value/);
    await expect(sites("import { assert } from 'fast-check';\nconst again = assert;\n")).rejects.toThrow(/not called/);
    await expect(sites("import fc from 'fast-check';\nimport { run } from './helper';\nrun(fc);\n")).rejects.toThrow(/as a value/);
  });

  test('the framework\'s other uses and its types are allowed', async () => {
    expect(await sites("import fc from 'fast-check';\nconst a: fc.Arbitrary<number> = fc.integer();\ntype T = typeof fc;\nfc.assert(fc.property(a, () => true));\n")).toEqual([4]);
  });

  test('a file that does not parse is refused', async () => {
    await expect(sites('import fc from \'fast-check\';\nfc.assert(\n')).rejects.toThrow(/does not parse/);
  });
});

describe('reports', () => {
  const tag = reportTag('abc');
  test('reads every tagged line and ignores the rest', () => {
    const out = `noise\n${tag}{"ready":true}\n${tag}{"file":"t.ts","line":3,"seed":7,"casesRun":25,"failed":false,"counterexample":null}\n${tag}{"file":null,"line":null,"seed":7,"casesRun":1,"failed":true,"counterexample":"[0]"}\n`;
    expect(readReports(out, 'abc')).toEqual([
      { file: 't.ts', line: 3, seed: 7, casesRun: 25, failed: false, counterexample: null },
      { file: '', line: 0, seed: 7, casesRun: 1, failed: true, counterexample: '[0]' },
    ]);
    expect(readReports(out, 'other')).toBeNull();
  });

  test('a tagged line that cannot be read makes the whole set unreadable', () => {
    expect(readReports(`${tag}{"ready":true}\n${tag}{"file":"t.ts","line":3}\n`, 'abc')).toBeNull();
    expect(readReports(`${tag}{"ready":true}\n${tag}not json\n`, 'abc')).toBeNull();
  });

  test('with no line saying the preload configured the framework, nothing is readable (gemini-3)', () => {
    expect(readReports('', 'abc')).toBeNull();
    expect(readReports(`${tag}{"file":"t.ts","line":3,"seed":7,"casesRun":25,"failed":false,"counterexample":null}\n`, 'abc')).toBeNull();
    expect(readReports(`${tag}{"ready":true}\n`, 'abc')).toEqual([]);
  });
});

describe('the property slot', () => {
  const manifest = (dev: Record<string, string>) => writeFile(join(root, 'package.json'), JSON.stringify({ name: 'x', private: true, devDependencies: dev }));

  test('fast-check 4 beside vitest 4 fills it', async () => {
    await manifest({ vitest: '4.1.11', 'fast-check': '^4.3.0' });
    const set = await buildAdapterSet(root, { provider: null, coverage: null });
    expect(set.property?.framework).toBe('fast-check@4');
    expect(set.unavailableControls()).not.toContain('property');
  });

  test.each([
    [{ vitest: '4.1.11' }, /not declared/],
    [{ vitest: '4.1.11', 'fast-check': '^3.23.0' }, /only fast-check 4/],
    [{ vitest: '3.2.4', 'fast-check': '^4.3.0' }, /vitest 4 only/],
    [{ jest: '30.0.0', 'fast-check': '^4.3.0' }, /vitest 4 only/],
  ])('%j leaves it null and says why', async (dev, why) => {
    await manifest(dev);
    const set = await buildAdapterSet(root, { provider: null, coverage: null });
    expect(set.property).toBeNull();
    expect(set.reasons.get('property')).toMatch(why);
  });
});
