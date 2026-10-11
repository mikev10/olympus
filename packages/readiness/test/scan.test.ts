/**
 * The acceptance criteria of R1 §8 that need a scan, over real fixture
 * repositories and a real Docker daemon.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderReport, scan, type ProbeId, type ProbeResult, type ReadinessReport } from '../src/index.js';
import { EMPTY_LOCK, PROTECTED, gitRepository, lockfileFor, manifest, options, treeHash, withWorkbench, writeFiles, type Workbench } from './repo.js';

const probe = (report: ReadinessReport, id: ProbeId): ProbeResult => {
  const found = report.probes.find((p) => p.probe === id);
  if (found === undefined) throw new Error(`no result for ${id}`);
  return found;
};

/** A package with vitest and v8 coverage, one source file, and one passing test. */
async function greenRepository(bench: Workbench, dir: string, extra: Readonly<Record<string, string>> = {}): Promise<void> {
  await writeFiles(dir, {
    'package.json': manifest({
      type: 'module',
      scripts: { build: 'node -e "0"', test: 'vitest run' },
      devDependencies: { vitest: '3.2.4', '@vitest/coverage-v8': '3.2.4' },
    }),
    ...extra,
  });
  await lockfileFor(bench, dir);
  await gitRepository(dir, {});
}

describe('a repository that supports every ceiling-bearing probe', () => {
  it('derives L2 held by the scan limit, deterministically, without changing the repository, with full evidence', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'green');
      await greenRepository(bench, dir, {
        'sum.js': 'export const sum = (a, b) => a + b;\n',
        'sum.test.js': "import { expect, test } from 'vitest';\nimport { sum } from './sum.js';\ntest('adds', () => expect(sum(1, 2)).toBe(3));\n",
        'AGENTS.md': '# Agents\n',
      });
      const before = await treeHash(dir);

      const first = await scan(options(bench, dir, { branchProtection: PROTECTED }));
      expect(first.ceiling, renderReport(first)).toMatchObject({ kind: 'scanned', level: 2, heldBy: { kind: 'scan-limit' } });
      expect(await treeHash(dir)).toBe(before);

      for (const result of first.probes) {
        expect(result.collectedBy).toBe('runtime');
        if (result.evidence.via !== 'executed') continue;
        expect(result.evidence.argv.length).toBeGreaterThan(0);
        expect(result.evidence.image).not.toBe('');
        if (result.evidence.run.kind === 'exited') {
          expect(Number.isInteger(result.evidence.run.exitCode)).toBe(true);
          expect(result.evidence.run.durationMs).toBeGreaterThanOrEqual(0);
          expect(result.evidence.run.outputSha256).toMatch(/^[0-9a-f]{64}$/u);
        }
      }
      for (const id of ['build.install', 'build.clean', 'testing.green-at-base', 'testing.coverage', 'integrate.secret-scan'] as const) {
        expect(probe(first, id).evidence.via, id).toBe('executed');
      }

      const second = await scan(options(bench, dir, { branchProtection: PROTECTED }));
      expect(second.ceiling).toEqual(first.ceiling);
      expect(await treeHash(dir)).toBe(before);
    });
  });
});

describe('a repository with no test suite', () => {
  it('derives L0 and names the enumeration probe', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'no-suite');
      await greenRepository(bench, dir, { 'sum.js': 'export const sum = (a, b) => a + b;\n' });
      const report = await scan(options(bench, dir));
      expect(probe(report, 'build.clean').outcome, renderReport(report)).toBe('supported');
      expect(probe(report, 'testing.adapter').outcome).toBe('supported');
      expect(report.ceiling).toMatchObject({ level: 0, heldBy: { kind: 'probe', probe: 'testing.enumerate' } });
      expect(renderReport(report)).toContain('held by testing.enumerate');
    });
  });
});

describe('a suite whose every test is skipped', () => {
  it('is not green at base: an exit 0 with nothing passed holds the ceiling at L0', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'skipped');
      await greenRepository(bench, dir, {
        'sum.js': 'export const sum = (a, b) => a + b;\n',
        'sum.test.js': "import { expect, test } from 'vitest';\nimport { sum } from './sum.js';\ntest.skip('adds', () => expect(sum(1, 2)).toBe(3));\n",
      });
      const report = await scan(options(bench, dir, { branchProtection: PROTECTED }));
      expect(probe(report, 'testing.enumerate').outcome, renderReport(report)).toBe('supported');
      expect(probe(report, 'testing.green-at-base').outcome).toBe('absent');
      expect(probe(report, 'testing.green-at-base').detail).toMatch(/no test passed/u);
      expect(report.ceiling).toMatchObject({ level: 0, heldBy: { kind: 'probe', probe: 'testing.green-at-base' } });
    });
  });
});

describe('a coverage run that measures no file', () => {
  it('is not coverage: an empty Istanbul report holds the ceiling at L1', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'unmeasured');
      await greenRepository(bench, dir, {
        'sum.js': 'export const sum = (a, b) => a + b;\n',
        'sum.test.js': "import { expect, test } from 'vitest';\nimport { sum } from './sum.js';\ntest('adds', () => expect(sum(1, 2)).toBe(3));\n",
        'vitest.config.js': "export default { test: { coverage: { include: ['nothing/**'] } } };\n",
      });
      const report = await scan(options(bench, dir, { branchProtection: PROTECTED }));
      expect(probe(report, 'testing.green-at-base').outcome, renderReport(report)).toBe('supported');
      expect(probe(report, 'testing.coverage').outcome).toBe('absent');
      expect(probe(report, 'testing.coverage').detail).toMatch(/measured no file/u);
      expect(report.ceiling).toMatchObject({ level: 1, heldBy: { kind: 'probe', probe: 'testing.coverage' } });
    });
  });
});

/** A build that reads a file the commit does not carry: present in the working directory, ignored by git. */
const INCREMENTAL = {
  '.gitignore': 'dist/\n',
  'package-lock.json': EMPTY_LOCK,
  'package.json': manifest({ scripts: { build: 'node -e "require(\'fs\').accessSync(\'dist/prebuilt.js\')"' } }),
};

describe('a repository that builds only incrementally', () => {
  it('derives L0 held by the clean build, reported with the argv and exit code that produced it', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'incremental');
      await gitRepository(dir, INCREMENTAL);
      await writeFiles(dir, { 'dist/prebuilt.js': 'module.exports = 1;\n' });

      const report = await scan(options(bench, dir));
      expect(report.ceiling, renderReport(report)).toMatchObject({ level: 0, heldBy: { kind: 'probe', probe: 'build.clean' } });
      const built = probe(report, 'build.clean');
      expect(built.outcome).toBe('absent');
      if (built.evidence.via !== 'executed' || built.evidence.run.kind !== 'exited') throw new Error(`build.clean did not exit: ${built.detail}`);
      expect(built.evidence.argv).toContain('build');
      expect(built.evidence.run.exitCode).not.toBe(0);
      expect(renderReport(report)).toMatch(/npm run build \(exit [1-9]/u);
    });
  });
});

describe('a probe that times out and a probe that fails', () => {
  it('derive the same ceiling, and the report tells them apart', async () => {
    await withWorkbench(async (bench) => {
      const failing = join(bench.base, 'failing');
      const hanging = join(bench.base, 'hanging');
      await gitRepository(failing, { 'package-lock.json': EMPTY_LOCK, 'package.json': manifest({ scripts: { build: 'node -e "process.exit(1)"' } }) });
      await gitRepository(hanging, { 'package-lock.json': EMPTY_LOCK, 'package.json': manifest({ scripts: { build: 'node -e "setTimeout(() => {}, 600000)"' } }) });
      const timeouts = { installMs: 120_000, probeMs: 20_000, coldProvisionMs: 60_000 };

      const failed = await scan(options(bench, failing, { timeouts }));
      const stopped = await scan(options(bench, hanging, { timeouts }));
      expect(probe(failed, 'build.clean').outcome, renderReport(failed)).toBe('absent');
      expect(probe(stopped, 'build.clean').outcome, renderReport(stopped)).toBe('indeterminate');
      expect(stopped.ceiling.level).toBe(failed.ceiling.level);
      expect(stopped.ceiling.heldBy).toEqual(failed.ceiling.heldBy);
      expect(probe(stopped, 'build.clean').detail).not.toBe(probe(failed, 'build.clean').detail);
    });
  });
});

describe('a committed secret', () => {
  it('is found by the secret scan, which holds the ceiling below L2', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'secret');
      // Assembled at run time so this file is not itself a finding.
      const token = ['ghp', '_', 'k7Qx2Lm9Pz4Rt8Vw1Ny6Bc3Hd5Fg0Js2Ka7E'].join('');
      await gitRepository(dir, { 'package-lock.json': EMPTY_LOCK, 'package.json': manifest({}), 'config.js': `export const token = '${token}';\n` });
      const report = await scan(options(bench, dir));
      const secret = probe(report, 'integrate.secret-scan');
      expect(secret.outcome, renderReport(report)).toBe('absent');
      expect(secret.detail).toContain('found leaks');
      expect(secret.detail).not.toContain(token);
    });
  });
});

describe('a revision', () => {
  it('that names no commit is refused before anything runs', async () => {
    await withWorkbench(async (bench) => {
      const dir = join(bench.base, 'repo');
      await gitRepository(dir, { 'package.json': manifest({}) });
      await expect(scan(options(bench, dir, { revision: 'no-such-branch' }))).rejects.toThrow(/has no commit 'no-such-branch'/u);
      await expect(scan(options(bench, dir, { revision: '--output=x' }))).rejects.toThrow(/refused rather than passed to git as an option/u);
    });
  });
});
