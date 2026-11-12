/**
 * R29: the adapter kit, run over every supported stack. A stack is supported
 * exactly when it passes the same assertions the TypeScript set passes, so
 * each assertion below is written once and parameterised by stack: the
 * vitest set and the pytest set each get a base tree and a head tree that
 * weakens an assertion, adds a skip, deletes a test, and edits a config
 * file, and each must be read as such. Deleting the Python adapter's part of
 * any control fails the assertion on the Python row.
 *
 * The last assertion runs the line itself over a Python repository, on the
 * Docker provider, with the real uv install from PyPI, to `integrate`.
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Driver, RoleId, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { BaseRunRecord } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { workspaceRoot } from '../kit/workspace.js';
import { ARTIFACTS, linePolicy, readRecord, refusalOf, stubDriver, withLine, writeManifest } from './line.js';

const adapters = async () => import('@olympus-ai/adapters');
const api = async () => import('@olympus-ai/api');

/** The Python fixture, its lockfile pinning pytest 8.4.2 and coverage 7.10.7 with every wheel hashed. */
const PYTHON_FIXTURE = join('packages', 'conformance', 'fixtures', 'python-hello');

async function pythonFixture(): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const path of ['pyproject.toml', 'uv.lock', 'hello/__init__.py', 'tests/test_hello.py']) {
    files[path] = await readFile(join(workspaceRoot(), PYTHON_FIXTURE, ...path.split('/')), 'utf8');
  }
  return files;
}

/** One stack's row: its trees, what each control must report over them, and where. */
interface Stack {
  readonly name: string;
  readonly stack: RegExp;
  readonly base: () => Promise<Record<string, string>>;
  /** Files the head changes or adds over the base. */
  readonly head: Readonly<Record<string, string>>;
  readonly suites: readonly string[];
  readonly testFile: string;
  readonly deletedCase: string;
  readonly configFile: string;
  /** A coverage report on the head, as the stack's coverage check writes it, under `/workspace`, covering one of two new lines. */
  readonly report: { readonly file: string; readonly text: string };
}

const VITEST_TEST = [
  "import { expect, test } from 'vitest';",
  "import { sum } from './sum';",
  "test('adds', () => { expect(sum(1, 2)).toBe(3); });",
  "test('adds zero', () => { expect(sum(0, 0)).toBe(0); });",
  "test('adds one', () => { expect(sum(1, 0)).toBe(1); });",
  '',
].join('\n');

const PYTEST_TEST = [
  'import pytest',
  'from hello import add',
  '', '',
  'def test_adds():',
  '    assert add(1, 2) == 3',
  '', '',
  'def test_adds_zero():',
  '    assert add(0, 0) == 0',
  '', '',
  'def test_adds_one():',
  '    assert add(1, 0) == 1',
  '',
].join('\n');

const STACKS: readonly Stack[] = [
  {
    name: 'vitest',
    stack: /^vitest@4$/u,
    base: () => Promise.resolve({
      'package.json': JSON.stringify({ name: 'fixture', version: '0.0.0', devDependencies: { vitest: '4.1.11' } }),
      'src/sum.ts': 'export const sum = (a: number, b: number): number => a + b;\n',
      'src/sum.test.ts': VITEST_TEST,
    }),
    head: {
      'package.json': JSON.stringify({ name: 'fixture', version: '0.0.1', devDependencies: { vitest: '4.1.11' } }),
      'src/sum.ts': 'export const sum = (a: number, b: number): number => a + b;\nexport const one = (): number => 1;\nexport const two = (): number => 2;\n',
      'src/sum.test.ts': [
        "import { expect, test } from 'vitest';",
        "import { sum } from './sum';",
        "test('adds', () => { expect(sum(1, 2)).toBeDefined(); });",
        "test.skip('adds zero', () => { expect(sum(0, 0)).toBe(0); });",
        '',
      ].join('\n'),
    },
    suites: ['src/sum.test.ts'],
    testFile: 'src/sum.test.ts',
    deletedCase: 'adds one',
    configFile: 'package.json',
    report: {
      file: 'coverage-final.json',
      text: JSON.stringify({
        '/workspace/src/sum.ts': {
          path: '/workspace/src/sum.ts',
          statementMap: { 0: { start: { line: 1, column: 20 }, end: { line: 1, column: 58 } }, 1: { start: { line: 2, column: 20 }, end: { line: 2, column: 39 } }, 2: { start: { line: 3, column: 20 }, end: { line: 3, column: 39 } } },
          s: { 0: 1, 1: 1, 2: 0 },
        },
      }),
    },
  },
  {
    name: 'pytest',
    stack: /^pytest@8$/u,
    base: async () => ({ ...(await pythonFixture()), 'hello/__init__.py': 'def add(a, b):\n    return a + b\n', 'tests/test_hello.py': PYTEST_TEST }),
    head: {
      'hello/__init__.py': 'def add(a, b):\n    return a + b\n\n\ndef one():\n    return 1\n',
      'tests/test_hello.py': [
        'import pytest',
        'from hello import add',
        '', '',
        'def test_adds():',
        '    assert add(1, 2) != 4',
        '', '',
        '@pytest.mark.skip',
        'def test_adds_zero():',
        '    assert add(0, 0) == 0',
        '',
      ].join('\n'),
    },
    suites: ['tests/test_hello.py'],
    testFile: 'tests/test_hello.py',
    deletedCase: 'test_adds_one',
    configFile: 'pyproject.toml',
    report: {
      file: 'coverage.json',
      text: JSON.stringify({ meta: { format: 3 }, files: { 'hello/__init__.py': { executed_lines: [1, 2, 5], missing_lines: [6], excluded_lines: [] } } }),
    },
  },
];

async function trees(stack: Stack): Promise<{ base: string; head: string; done: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), `conformance-r29-${stack.name}-`));
  const base = join(root, 'base');
  const head = join(root, 'head');
  for (const [path, text] of Object.entries(await stack.base())) {
    await mkdir(dirname(join(base, path)), { recursive: true });
    await writeFile(join(base, path), text);
  }
  await cp(base, head, { recursive: true });
  // The Python row's config change appends to the fixture's own pyproject.toml.
  const pyproject = stack.name === 'pytest' ? { 'pyproject.toml': `${await readFile(join(base, 'pyproject.toml'), 'utf8')}\n# changed\n` } : {};
  const changes = { ...stack.head, ...pyproject };
  for (const [path, text] of Object.entries(changes)) await writeFile(join(head, path), text);
  return { base, head, done: () => rm(root, { recursive: true, force: true }) };
}

async function eachStack(body: (stack: Stack, base: string, head: string) => Promise<void>): Promise<void> {
  for (const stack of STACKS) {
    const { base, head, done } = await trees(stack);
    try {
      await body(stack, base, head);
    } finally {
      await done();
    }
  }
}

export const EVERY_STACK_HAS_ITS_CONTROLS: LocalAssertion = runtime({
  id: 'I5.every-supported-stack-has-its-controls',
  title:
    'over a vitest repository and a pytest repository alike, the adapter set names its stack, carries a test, coverage, manifest, and static-analysis adapter, enumerates exactly the suites its runner collects, selects a named test, and names a runner the tree has not installed rather than starting it (R29)',
  run: async () => {
    const { buildAdapterSet } = await adapters();
    await eachStack(async (stack, base) => {
      const set = await buildAdapterSet(base, { provider: null, coverage: { report: join(base, stack.report.file), sourceRoot: '/workspace' } });
      const missing = [set.test === null ? 'test' : null, set.coverage === null ? 'coverage' : null, set.manifest === null ? 'manifest' : null, set.staticAnalysis === null ? 'static-analysis' : null].filter((m) => m !== null);
      if (set.test === null || missing.length > 0) throw new Error(`I5: the ${stack.name} set lacks ${missing.join(', ')}: ${set.reasons.get('test') ?? ''}`);
      if (!stack.stack.test(set.stack)) throw new Error(`I5: the ${stack.name} set named its stack ${set.stack}`);
      const suites = (await set.test.enumerateSuites(base)).map((s) => s.slice(base.length + 1).replaceAll('\\', '/'));
      if (JSON.stringify(suites) !== JSON.stringify(stack.suites)) throw new Error(`I5: the ${stack.name} set enumerated ${JSON.stringify(suites)}`);
      const selected = await set.test.selectSuites(base, [stack.testFile]);
      if (JSON.stringify(selected) !== JSON.stringify([stack.testFile])) throw new Error(`I5: the ${stack.name} set selected ${JSON.stringify(selected)} for ${stack.testFile}`);
      if ((await set.test.missingRunner(base)) === null) throw new Error(`I5: the ${stack.name} set found a runner in a tree nothing installed`);
    });
  },
});

export const EVERY_STACK_REPORTS_TAMPERING: LocalAssertion = runtime({
  id: 'I3.every-supported-stack-reports-tampering',
  title:
    "over a vitest repository and a pytest repository alike, the runtime's tamper analysis reports a weakened assertion, an added skip, a deleted test, and a changed config file, each by the stack's own adapter, and the assertion is spelled in the stack's language (R29)",
  run: async () => {
    const { analyzeTamper } = await api();
    await eachStack(async (stack, base, head) => {
      const report = await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [], markers: [] });
      const weakened = report.assertionsWeakened.filter((w) => w.file === stack.testFile && w.after !== '(removed)');
      if (weakened.length === 0) throw new Error(`I3: the ${stack.name} set reported no weakened assertion: ${JSON.stringify(report.assertionsWeakened)}`);
      const spelled = stack.name === 'pytest' ? /assert add\(1, 2\) != 4/u : /expect\(sum\(1, 2\)\)\.toBeDefined/u;
      if (!weakened.some((w) => spelled.test(w.after))) throw new Error(`I3: the ${stack.name} weakening was spelled ${JSON.stringify(weakened)}`);
      if (!report.skipMarkersAdded.some((m) => m.file === stack.testFile)) throw new Error(`I3: the ${stack.name} set reported no added skip: ${JSON.stringify(report.skipMarkersAdded)}`);
      if (!report.testsDeleted.some((t) => t.includes(stack.deletedCase))) throw new Error(`I3: the ${stack.name} set reported no deleted test: ${JSON.stringify(report.testsDeleted)}`);
      if (!report.protectedPathsTouched.includes(stack.configFile)) throw new Error(`I3: the ${stack.name} config change was not a touch: ${JSON.stringify(report.protectedPathsTouched)}`);
    });
  },
});

export const EVERY_STACK_MEASURES_CHANGED_LINES: LocalAssertion = runtime({
  id: 'I3.every-supported-stack-measures-changed-lines',
  title:
    "over a vitest repository and a pytest repository alike, changed-line coverage is read from the stack's own report and counts a changed statement the report shows unrun as uncovered (R29)",
  run: async () => {
    const { buildAdapterSet } = await adapters();
    await eachStack(async (stack, base, head) => {
      const report = join(head, stack.report.file);
      await writeFile(report, stack.report.text);
      const set = await buildAdapterSet(base, { provider: null, coverage: { report, sourceRoot: '/workspace' } });
      if (set.coverage === null) throw new Error(`I3: the ${stack.name} set has no coverage adapter`);
      const measured = await set.coverage.changedLineCoverage(base, head);
      if (!(measured > 0 && measured < 1)) throw new Error(`I3: the ${stack.name} set measured ${String(measured)} over a change with one covered and one uncovered line`);
    });
  },
});

export const DEPENDENCY_TREES_ARE_NOT_CARRIED: LocalAssertion = runtime({
  id: 'I3.no-stack-dependency-tree-is-carried',
  title:
    "a task's write under node_modules, .venv, site-packages, or __pycache__, at any depth and in any case, is a dependency-tree write, recorded and never carried into the tree a check runs over, whatever the run's stack; the Python installs remove the same trees before installing (R29, D-R15-05)",
  run: async () => {
    const { inDependencyTree } = await api();
    const { UV_INSTALLER, PIP_INSTALLER } = await adapters();
    for (const path of ['node_modules/vitest/vitest.mjs', '.venv/bin/python', 'pkg/__pycache__/m.cpython-313.pyc', 'lib/site-packages/x.py', '.VENV/bin/python']) {
      if (!inDependencyTree(path)) throw new Error(`I3: ${path} was not read as a dependency-tree write, so it would be carried`);
    }
    for (const path of ['src/venv.py', 'hello/__init__.py', 'tests/test_cache.py']) {
      if (inDependencyTree(path)) throw new Error(`I3: ${path} was read as a dependency-tree write`);
    }
    for (const installer of [UV_INSTALLER, PIP_INSTALLER]) {
      for (const tree of ['.venv', '__pycache__', 'site-packages']) {
        if (!installer.trees.includes(tree)) throw new Error(`I3: the ${installer.stack} install does not remove ${tree} before it installs`);
      }
    }
  },
});

export const PYTHON_INSTALL_RUNS_NO_PACKAGE_CODE: LocalAssertion = runtime({
  id: 'I3.python-install-runs-no-package-code',
  title:
    "each Python install makes its virtualenv with copies, so no link leaves the tree, then installs only wheels verified by the lockfile's hashes, building no package and installing no project; a lockfile naming a package from git, one with no wheel, an unpinned or unhashed requirement, or an option line is refused, naming it (R29, D-R29-05)",
  run: async () => {
    const { UV_INSTALLER, PIP_INSTALLER, UNSUPPORTED_LOCKFILES } = await adapters();
    for (const installer of [UV_INSTALLER, PIP_INSTALLER]) {
      if (installer.steps[0].join(' ') !== 'python -m venv --copies .venv') throw new Error(`I3: the ${installer.stack} install's first step is ${installer.steps[0].join(' ')}`);
    }
    const uv = UV_INSTALLER.steps[1]?.join(' ') ?? '';
    for (const flag of ['--frozen', '--no-build', '--no-install-workspace']) if (!uv.includes(flag)) throw new Error(`I3: the uv install runs without ${flag}: ${uv}`);
    const pip = PIP_INSTALLER.steps[1]?.join(' ') ?? '';
    for (const flag of ['--require-hashes', '--no-deps', '--only-binary :all:']) if (!pip.includes(flag)) throw new Error(`I3: the pip install runs without ${flag}: ${pip}`);
    const hash = `sha256:${'a'.repeat(64)}`;
    const lock = [
      'version = 1', '',
      '[[package]]', 'name = "fromgit"', 'version = "1.0"', 'source = { git = "https://example.com/x.git" }', '',
      '[[package]]', 'name = "sdistonly"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }', 'sdist = { url = "https://x/s.tar.gz", hash = "sha256:00" }', '',
    ].join('\n');
    const read = UV_INSTALLER.packages(lock);
    if (!read.ok || read.packages.some((p) => p.unverifiable === null)) throw new Error(`I3: uv.lock's git and source-only packages were read as verifiable: ${JSON.stringify(read)}`);
    const reqs = PIP_INSTALLER.packages(`requests>=2 --hash=${hash}\nidna==3.0\n`);
    if (!reqs.ok || reqs.packages.some((p) => p.unverifiable === null)) throw new Error(`I3: an unpinned or unhashed requirement was read as verifiable: ${JSON.stringify(reqs)}`);
    const option = PIP_INSTALLER.packages(`--extra-index-url https://example.com/simple\nidna==3.0 --hash=${hash}\n`);
    if (option.ok) throw new Error('I3: a requirements file naming another index was read');
    for (const name of ['poetry.lock', 'Pipfile.lock', 'pdm.lock']) if (!UNSUPPORTED_LOCKFILES.includes(name)) throw new Error(`I3: ${name} is not refused`);
  },
});

/** The rig's stub builder, writing `files` through the sandbox it was handed with the image's own Python, and claiming them. */
async function writingPython(files: Readonly<Record<string, string>>, sandbox: SandboxProvider): Promise<Driver> {
  const driver = await stubDriver();
  return new Proxy(driver, {
    get(target, key, receiver) {
      if (key !== 'runTask') return Reflect.get(target, key, receiver) as unknown;
      return async (req: TaskRequest): Promise<TaskResult> => {
        if (req.role.role !== ('builder' as RoleId)) return target.runTask(req);
        const script = `import json\nfor path, text in json.loads(${JSON.stringify(JSON.stringify(files))}).items():\n    open(path, "w").write(text)\n`;
        const wrote = await sandbox.exec(req.sandbox, ['python', '-c', script]);
        if (wrote.exitCode !== 0) throw new Error(`the builder's write did not land: ${wrote.stderr}`);
        const result = await target.runTask(req);
        return { ...result, claim: { ...result.claim, filesChanged: Object.keys(files) } };
      };
    },
  });
}

export const PYTHON_RUN_REACHES_INTEGRATE: LocalAssertion = runtime({
  id: 'I3.python-run-reaches-integrate',
  title:
    "a run on a Python repository reaches integrate on the Docker provider: the runtime installs its uv.lock from PyPI in the Python image, the locked pytest acceptance test fails over the base and passes over the builder's change in that image with no egress, and the admission records the stack as pytest@8 (R29, needs Docker and the network)",
  timeoutMs: 1_200_000,
  run: async () => {
    const [{ startRun, readRunRecords }, { INSTALLERS, PYPI_REGISTRIES, PYTHON_IMAGE, STATIC_ANALYSIS_IMAGE }, { LocalDockerProvider }, { BASE_IMAGE }] = await Promise.all([
      api(), adapters(), import('@olympus-ai/sandbox'), import('@olympus-ai/driver-claude-code'),
    ]);
    await withLine('r29-line-', async (rig) => {
      const root = rig.dirs.artifacts;
      for (const [path, text] of Object.entries(await pythonFixture())) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), text);
      }
      const test = 'tests/test_hello.py';
      // Semgrep reads Python: the manifest pins a Python rule, as it pins TypeScript ones for a Node.js repository (R17).
      const rules = 'rules:\n  - id: no-eval\n    languages: [python]\n    severity: ERROR\n    message: eval of a value\n    pattern: eval($X)\n';
      await writeManifest(rig.dirs, [
        { id: 'greets', kind: 'acceptance', onBase: 'fails', tests: [test], required: true, timeoutMs: 300_000 },
        { id: 'static-analysis', kind: 'static-analysis', image: STATIC_ANALYSIS_IMAGE, config: rules, required: true, timeoutMs: 300_000 },
      ]);
      const sandbox = await LocalDockerProvider.create({ vaultPaths: [rig.dirs.store, rig.dirs.artifacts] });
      const driver = await writingPython({ 'hello/__init__.py': 'def greet(name):\n    return "hello " + name\n' }, sandbox);
      const components = await rig.components({
        sandbox, driver, reviewer: driver, installers: INSTALLERS,
        // The profile's check image is Node's, with no Python in it: a check that ran there, not in the Python set's own image, could not pass.
        profile: { buildImage: PYTHON_IMAGE, checkImage: BASE_IMAGE, limits: { cpus: 2, memoryMb: 2048, pids: 512 } },
      }, { work: false });
      const policy = await linePolicy({}, { installRegistries: [...PYPI_REGISTRIES] });
      const request = await rig.request(components, { policy, artifacts: { ...ARTIFACTS, acceptanceTests: [...ARTIFACTS.acceptanceTests, test] } });
      const parked = refusalOf(await startRun(request), 'R29 python line');
      if (parked.at !== 'integrate' || parked.transition.reason !== 'approval-required') {
        const baseRun = await components.vault.readBaseRun(rig.runId, null);
        const record = baseRun === null ? null : await readRecord<BaseRunRecord>(components.vault, baseRun);
        const seen = record === null ? 'no base record' : JSON.stringify({ checks: record.checks.map((c) => ({ id: c.checkId, exit: c.exitCode, out: `${c.stdout}${c.stderr}`.slice(-600) })), unstarted: record.unstarted });
        throw new Error(`R29: the Python run stopped at ${parked.at} as '${parked.transition.reason}', not at integrate awaiting approval; base: ${seen}`);
      }
      const records = await readRunRecords(components.vault, rig.runId);
      if (records.stack !== 'pytest@8') throw new Error(`R29: the run recorded its stack as ${String(records.stack)}`);
    });
  },
});

export const R29_I3: readonly LocalAssertion[] = [
  EVERY_STACK_REPORTS_TAMPERING, EVERY_STACK_MEASURES_CHANGED_LINES, DEPENDENCY_TREES_ARE_NOT_CARRIED, PYTHON_INSTALL_RUNS_NO_PACKAGE_CODE, PYTHON_RUN_REACHES_INTEGRATE,
];
export const R29_I5: readonly LocalAssertion[] = [EVERY_STACK_HAS_ITS_CONTROLS];
