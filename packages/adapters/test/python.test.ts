/**
 * The Python set (R29): which repositories get it, pytest's collection as
 * pytest 8.4.2 collects it (the expectations below are its `--collect-only`
 * output over the same files, D-R29-07), what it refuses, its runner, its
 * coverage, and its installers.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  AdapterRefusal, buildAdapterSet, CoveragePyAdapter, isConfigFile, PIP_INSTALLER, PYTHON_DEPENDENCY_TREES, PYTHON_IMAGE, PYTEST_BOOTSTRAP, PytestAdapter, UV_INSTALLER,
} from '../src/index.js';
import { pkg, repo, cleanup } from './repo.js';

afterEach(cleanup);

const HASH = `sha256:${'a'.repeat(64)}`;

export function pyproject(extra = '', dev = '"pytest>=8"'): string {
  return `[project]\nname = "hello"\nversion = "0.1.0"\nrequires-python = ">=3.13"\n\n[dependency-groups]\ndev = [${dev}]\n${extra}`;
}

export function uvLock(version = '8.4.2'): string {
  return [
    'version = 1', 'revision = 3', 'requires-python = ">=3.13"', '',
    '[[package]]', 'name = "hello"', 'version = "0.1.0"', 'source = { virtual = "." }', '',
    '[[package]]', 'name = "pytest"', `version = "${version}"`, 'source = { registry = "https://pypi.org/simple" }',
    `wheels = [`, `    { url = "https://files.pythonhosted.org/p/pytest-${version}-py3-none-any.whl", hash = "${HASH}" },`, ']', '',
  ].join('\n');
}

const TEST_A = `import unittest
import pytest
from unittest import TestCase


@pytest.fixture
def test_fixture_not_a_case():
    return 1


@pytest.mark.parametrize("a", [1, 2.5, "x", None, True, -3, 1.0, (1, 2), [3]])
def test_single(a):
    assert a == a


@pytest.mark.parametrize("a,b", [(1, 2), ("q", "q")], ids=["one", None])
def test_multi(a, b):
    assert a != b


@pytest.mark.parametrize("v", [pytest.param(1, id="first"), pytest.param(2, marks=pytest.mark.skip), 1, 1])
def test_params(v):
    assert v


@pytest.mark.parametrize("x", [0, 1])
@pytest.mark.parametrize("y", ["a", "b"])
def test_stacked(x, y):
    assert x is not None


@pytest.mark.parametrize("s", ["L" * 3, "a" + "b"])
def test_nonliteral(s):
    assert s


@pytest.mark.skip(reason="x")
def test_skipped():
    pytest.skip("inner")


class TestPlain:
    def test_m(self):
        assert 1 < 2 <= 3

    def helper(self):
        pass

    class TestInner:
        def test_n(self):
            assert not False


class TestHasInit:
    def __init__(self):
        pass

    def test_never(self):
        pass


class TestBase:
    def test_base_m(self):
        pass


class TestChild(TestBase):
    def test_child_m(self):
        pass


class Checks(TestCase):
    def test_u(self):
        self.assertEqual(1, 1)
        self.assertAlmostEqual(1.0, 1.0, places=3)

    def check_not(self):
        pass

    @unittest.skip("no")
    def test_skipped_u(self):
        pass


class TestNotCollected:
    __test__ = False

    def test_x(self):
        pass


async def test_async():
    assert True
`;

/** A Python repository pinning pytest at `version`, with `files` beside it. */
async function python(files: Readonly<Record<string, string>> = {}, version = '8.4.2', extra = ''): Promise<string> {
  return repo({ 'pyproject.toml': pyproject(extra), 'uv.lock': uvLock(version), ...files });
}

async function pytestOf(root: string): Promise<PytestAdapter> {
  const set = await buildAdapterSet(root, { provider: null, coverage: null });
  if (!(set.test instanceof PytestAdapter)) throw new Error(`no pytest adapter: ${set.reasons.get('test') ?? ''}`);
  return set.test;
}

const rel = (root: string, files: readonly string[]): string[] => files.map((f) => f.slice(root.length + 1).replaceAll('\\', '/'));

describe('the Python set', () => {
  test('a repository declaring pytest, pinned by its lockfile, gets pytest@<major>, coverage.py, the manifest, Semgrep, its trees, and the Python image', async () => {
    const coverage = { report: '/r/coverage.json', sourceRoot: '/workspace' };
    const eight = await buildAdapterSet(await python(), { provider: null, coverage });
    const nine = await buildAdapterSet(await python({}, '9.2.0'), { provider: null, coverage: null });
    expect([eight.stack, nine.stack]).toEqual(['pytest@8', 'pytest@9']);
    expect(eight.coverage).toBeInstanceOf(CoveragePyAdapter);
    expect(eight.manifest).not.toBeNull();
    expect(eight.staticAnalysis?.kind).toBe('static-analysis');
    expect(eight.checkImage).toBe(PYTHON_IMAGE);
    expect(eight.dependencyTrees).toEqual(PYTHON_DEPENDENCY_TREES);
  });

  test('pytest pinned by a hashed requirements.txt is read from it', async () => {
    const root = await repo({ 'requirements.txt': `pytest==9.0.1 \\\n    --hash=${HASH}\n` });
    expect((await buildAdapterSet(root, { provider: null, coverage: null })).stack).toBe('pytest@9');
  });

  test.each([
    ['no pytest declared', { 'pyproject.toml': pyproject('', '"requests"'), 'uv.lock': uvLock() }, /pytest is not declared/],
    ['pytest 8.3', { 'pyproject.toml': pyproject(), 'uv.lock': uvLock('8.3.5') }, /pytest 8\.3\.5 is pinned/],
    ['pytest 7', { 'pyproject.toml': pyproject(), 'uv.lock': uvLock('7.4.4') }, /pytest 7\.4\.4 is pinned/],
    ['no lockfile', { 'pyproject.toml': pyproject() }, /no lockfile pins its version/],
  ])('%s: test is null, the reason named, and no other runner stands in', async (_name, files, reason) => {
    const set = await buildAdapterSet(await repo(files), { provider: null, coverage: null });
    expect(set.test).toBeNull();
    expect(set.reasons.get('test')).toMatch(reason);
    expect(set.unavailableControls()).toContain('test');
  });

  test('a repository declaring both a Node.js and a Python framework gets neither', async () => {
    const set = await buildAdapterSet(await python({ 'package.json': pkg({ vitest: '4' }) }), { provider: null, coverage: null });
    expect(set.test).toBeNull();
    expect(set.reasons.get('test')).toMatch(/both vitest@4 and pytest@8 are declared/);
  });

  test('a repository declaring neither stack names both gaps and is refused at L3', async () => {
    const set = await buildAdapterSet(await repo({ 'README.md': '' }), { provider: null, coverage: null });
    expect(set.stack).toBe('unsupported');
    expect(set.unavailableControls()).toEqual(expect.arrayContaining(['test', 'manifest', 'static-analysis']));
  });
});

describe('pytest collection', () => {
  const LAYOUT = {
    'tests/test_a.py': TEST_A,
    'tests/sub/b_test.py': 'import pytest\n\ndef test_b():\n    assert 1 == pytest.approx(1.0, rel=1e-3)\n',
    'tests/helper.py': 'def test_h():\n    pass\n',
    'test_root.py': 'def test_root():\n    pass\n',
    'build/test_x.py': 'def test_build():\n    pass\n',
    'env/pyvenv.cfg': 'home = /usr\n',
    'env/test_env.py': 'def test_env():\n    pass\n',
    '.venv/test_venv.py': 'def test_venv():\n    pass\n',
    'pkg/__pycache__/test_cached.py': 'def test_c():\n    pass\n',
  };

  test('testpaths, python_files, norecursedirs, virtualenvs, and __pycache__ decide the suites, as pytest decides them', async () => {
    const withPaths = await python(LAYOUT, '8.4.2', '\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n');
    expect(rel(withPaths, await (await pytestOf(withPaths)).enumerateSuites(withPaths))).toEqual(['tests/sub/b_test.py', 'tests/test_a.py']);
    const withoutPaths = await python(LAYOUT);
    expect(rel(withoutPaths, await (await pytestOf(withoutPaths)).enumerateSuites(withoutPaths))).toEqual(['test_root.py', 'tests/sub/b_test.py', 'tests/test_a.py']);
  });

  test('python_files from pytest.ini, which pytest reads before pyproject.toml', async () => {
    const root = await python({ ...LAYOUT, 'pytest.ini': '[pytest]\npython_files = helper.py\ntestpaths = tests\n' }, '8.4.2', '\n[tool.pytest.ini_options]\ntestpaths = ["nowhere"]\n');
    expect(rel(root, await (await pytestOf(root)).enumerateSuites(root))).toEqual(['tests/helper.py']);
  });

  test("pytest 9's pytest.toml is read; pytest 8 passes over it", async () => {
    const files = { ...LAYOUT, 'pytest.toml': '[pytest]\ntestpaths = ["tests/sub"]\n' };
    const nine = await python(files, '9.2.0');
    expect(rel(nine, await (await pytestOf(nine)).enumerateSuites(nine))).toEqual(['tests/sub/b_test.py']);
    const eight = await python(files, '8.4.2');
    expect(rel(eight, await (await pytestOf(eight)).enumerateSuites(eight))).toContain('test_root.py');
  });

  test('a named file is selected whatever its name; one that is not a file is not', async () => {
    const root = await python(LAYOUT);
    const adapter = await pytestOf(root);
    expect(await adapter.selectSuites(root, ['tests/helper.py', 'tests/test_a.py', 'tests/absent.py'])).toEqual(['tests/helper.py', 'tests/test_a.py']);
  });

  test('cases are the ones pytest 8.4.2 collects, with a row whose id the parse cannot make named by its source', async () => {
    const root = await python(LAYOUT);
    const cases = await (await pytestOf(root)).enumerateCases(join(root, 'tests', 'test_a.py'));
    expect([...cases].sort()).toEqual([
      'Checks > test_skipped_u', 'Checks > test_u',
      'TestBase > test_base_m', 'TestChild > test_base_m', 'TestChild > test_child_m',
      'TestPlain > TestInner > test_n', 'TestPlain > test_m',
      'test_async',
      'test_multi[one]', 'test_multi[q-q]',
      'test_nonliteral[?"L" * 3]', 'test_nonliteral[?"a" + "b"]',
      'test_params[1_0]', 'test_params[1_1]', 'test_params[2]', 'test_params[first]',
      'test_single[-3]', 'test_single[1.0]', 'test_single[1]', 'test_single[2.5]', 'test_single[None]', 'test_single[True]', 'test_single[a7]', 'test_single[a8]', 'test_single[x]',
      'test_skipped',
      'test_stacked[a-0]', 'test_stacked[a-1]', 'test_stacked[b-0]', 'test_stacked[b-1]',
    ].sort());
  });

  test('skip markers: pytest marks and calls, unittest decorators, a skipped param, and pytestmark', async () => {
    const root = await python({ ...LAYOUT, 'tests/test_m.py': 'import pytest\npytestmark = pytest.mark.skip\n\ndef test_z():\n    pass\n' });
    const adapter = await pytestOf(root);
    expect([...(await adapter.detectSkipMarkers(join(root, 'tests', 'test_a.py')))].sort()).toEqual([
      '__test__ set: TestNotCollected',
      'pytest.mark.skip: test_params',
      'pytest.mark.skip: test_skipped',
      'pytest.skip: test_skipped',
      'unittest.skip: Checks > test_skipped_u',
    ]);
    // Owned by the module, never by its absolute path, so the same marker in the base and the head pairs.
    expect(await adapter.detectSkipMarkers(join(root, 'tests', 'test_m.py'))).toEqual(['pytest.mark.skip: (module)']);
  });

  // A table the parse cannot count could lose its rows, or empty into pytest's one skipped case, with nothing reported
  // (codex-3, gemini-3): it is refused, as the TypeScript set refuses a non-literal `.each` (D-R29-07's reverse).
  test.each([
    ['a computed table', '@pytest.mark.parametrize("x", list(range(2)))\ndef test_p(x):\n    assert x >= 0\n', /test_p is parametrized by a table the parse cannot count/],
    ['a table from a call', '@pytest.mark.parametrize("x", dynamic_cases())\ndef test_p(x):\n    assert x\n', /test_p is parametrized by a table the parse cannot count/],
    ['a spread row', '@pytest.mark.parametrize("x", [*ROWS])\ndef test_p(x):\n    assert x\n', /test_p is parametrized by a table the parse cannot count/],
    ['a parametrize mark held in a name', 'p = pytest.mark.parametrize("x", [1, 2])\n\n@p\ndef test_p(x):\n    assert x\n', /parametrize outside a test's own decorator/],
    ['a parametrize mark on pytestmark', 'pytestmark = pytest.mark.parametrize("x", [1, 2])\n\ndef test_p(x):\n    assert x\n', /parametrize outside a test's own decorator/],
    ['a test module that generates tests', 'def pytest_generate_tests(metafunc):\n    metafunc.parametrize("x", [1])\n\ndef test_p(x):\n    assert x\n', /pytest_generate_tests/],
  ])('%s is refused', async (_name, body, reason) => {
    const root = await python({ 'tests/test_p.py': `import pytest\n\n${body}` });
    await expect((await pytestOf(root)).enumerateCases(join(root, 'tests', 'test_p.py'))).rejects.toThrow(reason);
  });

  test('an empty table is a skip marker, and a dropped literal row a deleted case', async () => {
    const root = await python({
      'tests/test_e.py': 'import pytest\n\n@pytest.mark.parametrize("x", [])\ndef test_p(x):\n    assert x\n',
      'tests/test_i.py': 'import pytest\n\n@pytest.mark.parametrize("x", [Decimal(1), Decimal(2)], ids=str)\ndef test_p(x):\n    assert x\n',
    });
    const adapter = await pytestOf(root);
    expect(await adapter.detectSkipMarkers(join(root, 'tests', 'test_e.py'))).toContain('parametrize([]): test_p');
    expect(await adapter.enumerateCases(join(root, 'tests', 'test_i.py'))).toEqual(['test_p[?Decimal(1)]', 'test_p[?Decimal(2)]']);
  });

  test("a fixture's params are cases of the fixture's, and a table of them the parse cannot count is refused", async () => {
    const root = await python({
      'tests/test_f.py': 'import pytest\n\n@pytest.fixture(params=[1, 2])\ndef db(request):\n    return request.param\n\ndef test_p(db):\n    assert db\n',
      'tests/test_g.py': 'import pytest\n\n@pytest.fixture(params=make())\ndef db(request):\n    return request.param\n\ndef test_p(db):\n    assert db\n',
    });
    const adapter = await pytestOf(root);
    expect(await adapter.enumerateCases(join(root, 'tests', 'test_f.py'))).toEqual(['fixture db[?1]', 'fixture db[?2]', 'test_p']);
    await expect(adapter.enumerateCases(join(root, 'tests', 'test_g.py'))).rejects.toThrow(/fixture db is parametrized by a table the parse cannot count/);
  });

  // A skip is found by what it names, wherever it is and whatever it is called: under an alias, from a fixture or a
  // helper, under a module-level condition, raised as an exception, or an exit that ends the run (gemini-2, gemini-4).
  test.each([
    ['a module alias', 'import pytest as pt\n\ndef test_x():\n    assert f()\n', 'import pytest as pt\n\ndef test_x():\n    pt.skip()\n    assert f()\n'],
    ['a function imported under another name in the base', 'from pytest import skip as s\n\ndef test_x():\n    assert f()\n', 'from pytest import skip as s\n\ndef test_x():\n    s()\n    assert f()\n'],
    ['a function assigned to a name in the base', 'import pytest\ns = pytest.skip\n\ndef test_x():\n    assert f()\n', 'import pytest\ns = pytest.skip\n\ndef test_x():\n    s()\n    assert f()\n'],
    ['an attribute named by a string', 'import pytest\n\ndef test_x():\n    assert f()\n', 'import pytest\n\ndef test_x():\n    getattr(pytest, "skip")()\n    assert f()\n'],
    ['a raised skip exception', 'import pytest\n\ndef test_x():\n    assert f()\n', 'import pytest\n\ndef test_x():\n    raise pytest.skip.Exception("x")\n'],
    ["unittest's SkipTest", 'import unittest\n\ndef test_x():\n    assert f()\n', 'import unittest\n\ndef test_x():\n    raise unittest.SkipTest()\n'],
    ['an autouse fixture', 'import pytest\n\n@pytest.fixture(autouse=True)\ndef env():\n    return 1\n\ndef test_x():\n    assert f()\n', 'import pytest\n\n@pytest.fixture(autouse=True)\ndef env():\n    pytest.skip()\n\ndef test_x():\n    assert f()\n'],
    ['a helper a test calls', 'import pytest\n\ndef helper():\n    return 1\n\ndef test_x():\n    assert helper()\n', 'import pytest\n\ndef helper():\n    pytest.skip()\n\ndef test_x():\n    assert helper()\n'],
    ['a module-level condition', 'import pytest\n\ndef test_x():\n    assert f()\n', 'import pytest\nif True:\n    pytest.skip("x", allow_module_level=True)\n\ndef test_x():\n    assert f()\n'],
    ['an exit that ends the run', 'import os\n\ndef test_x():\n    assert f()\n', 'import os\n\ndef test_x():\n    os._exit(0)\n'],
    ["pytest's own exit", 'import pytest\n\ndef test_x():\n    assert f()\n', 'import pytest\n\ndef test_x():\n    pytest.exit("done", returncode=0)\n'],
  ])('a skip through %s is reported', async (_name, before, after) => {
    const root = await python({ 'tests/test_b.py': before, 'tests/test_c.py': after });
    const adapter = await pytestOf(root);
    const was = await adapter.detectSkipMarkers(join(root, 'tests', 'test_b.py'));
    const added = (await adapter.detectSkipMarkers(join(root, 'tests', 'test_c.py'))).filter((m) => {
      const i = was.indexOf(m);
      if (i === -1) return true;
      was.splice(i, 1);
      return false;
    });
    expect(added).not.toEqual([]);
  });

  // A test rebound, hidden, or redefined after its definition runs something else, or nothing, while its definition and
  // its assertions still read as they did (codex-4): each is a marker of the test it rebinds.
  test.each([
    ['__test__ set on a test function', 'test_bad.__test__ = False\n'],
    ['a test rebound to another callable', 'test_bad = lambda: None\n'],
    ['a test rebound under a condition', 'if True:\n    test_bad = lambda: None\n'],
    ['a test rebound by a loop', 'for test_bad in [None]:\n    pass\n'],
    ['a test redefined', 'def test_bad():\n    pass\n'],
    ['a test deleted from the module', 'del test_bad\n'],
    ['a test replaced by an import', 'from helpers import test_bad\n'],
    ['a marks list replaced', 'test_bad.pytestmark = []\n'],
    ['__test__ set on the module', '__test__ = False\n'],
    ['a test method rebound in its class', 'class TestK:\n    def test_m(self):\n        assert f()\n\n    test_m = None\n'],
    ['__test__ set to a falsy value on a class', 'class TestK:\n    __test__ = 0\n\n    def test_m(self):\n        assert f()\n'],
  ])('%s is reported', async (_name, appended) => {
    const base = 'import pytest\n\ndef test_bad():\n    assert f()\n\ndef test_ok():\n    assert g()\n';
    const root = await python({ 'tests/test_b.py': base, 'tests/test_c.py': `${base}\n${appended}` });
    const adapter = await pytestOf(root);
    const was = await adapter.detectSkipMarkers(join(root, 'tests', 'test_b.py'));
    const now = await adapter.detectSkipMarkers(join(root, 'tests', 'test_c.py'));
    expect(now.filter((m) => !was.includes(m))).not.toEqual([]);
  });

  test('a module that binds names dynamically is refused', async () => {
    const root = await python({ 'tests/test_x.py': 'def test_bad():\n    assert f()\n\nglobals()["test_bad"] = None\n' });
    await expect((await pytestOf(root)).enumerateCases(join(root, 'tests', 'test_x.py'))).rejects.toThrow(/globals\(\)/);
  });

  test('a module-level name that is not a test, and setattr inside a test, are not markers', async () => {
    const root = await python({ 'tests/test_x.py': 'import pytest\nLIMIT = 3\nhelper_value = LIMIT + 1\n\ndef test_ok():\n    setattr(obj, "x", 1)\n    assert obj.x == 1\n' });
    expect(await (await pytestOf(root)).detectSkipMarkers(join(root, 'tests', 'test_x.py'))).toEqual([]);
  });

  test('an attribute of pytest named by a value the parse cannot see is refused', async () => {
    const root = await python({ 'tests/test_x.py': 'import pytest\n\ndef test_x():\n    getattr(pytest, "sk" + "ip")()\n' });
    await expect((await pytestOf(root)).detectSkipMarkers(join(root, 'tests', 'test_x.py'))).rejects.toThrow(/getattr on pytest/);
  });

  test('a file the grammar cannot read is refused, never read in part', async () => {
    const root = await python({ 'tests/test_bad.py': 'def test_x(:\n    pass\n' });
    await expect((await pytestOf(root)).enumerateCases(join(root, 'tests', 'test_bad.py'))).rejects.toThrow(/does not parse/);
  });
});

describe('what pytest collection refuses', () => {
  test.each([
    ['a conftest collection hook', { 'tests/conftest.py': 'def pytest_collection_modifyitems(items):\n    items.clear()\n' }, '', /pytest_collection_modifyitems/],
    ['a conftest that loads plugins', { 'conftest.py': 'pytest_plugins = ["x"]\n' }, '', /pytest_plugins/],
    ['a conftest that ignores paths', { 'conftest.py': 'collect_ignore = ["tests"]\n' }, '', /collect_ignore/],
    ['a pytest_configure that does more than register markers', { 'conftest.py': 'def pytest_configure(config):\n    config.option.keyword = "x"\n' }, '', /pytest_configure/],
    // Any hook can change what runs or what is reported, not only a collection hook (codex-2).
    ['a conftest run-protocol hook', { 'conftest.py': 'def pytest_runtest_protocol(item, nextitem):\n    return True\n' }, '', /pytest_runtest_protocol/],
    ['a conftest that rewrites the exit status', { 'conftest.py': 'def pytest_sessionfinish(session, exitstatus):\n    session.exitstatus = 0\n' }, '', /pytest_sessionfinish/],
    ['a conftest hook imported from a module', { 'conftest.py': 'from judge_switch import pytest_runtest_protocol\n' }, '', /pytest_runtest_protocol/],
    ['a conftest hook imported under another name', { 'conftest.py': 'from judge_switch import protocol as pytest_runtest_protocol\n' }, '', /pytest_runtest_protocol/],
    ['a conftest hook defined under a condition', { 'conftest.py': 'if True:\n    def pytest_collection_modifyitems(items):\n        items.clear()\n' }, '', /pytest_collection_modifyitems/],
    ['a conftest hook on a class it registers', { 'conftest.py': 'class P:\n    def pytest_runtest_call(self, item):\n        pass\n' }, '', /pytest_runtest_call/],
    ['a conftest wildcard import', { 'conftest.py': 'from judge_switch import *\n' }, '', /imports \* from judge_switch/],
    ['a conftest that binds names dynamically', { 'conftest.py': 'globals()["pytest_" + "runtest_protocol"] = print\n' }, '', /globals/],
    ['a conftest that registers a plugin', { 'conftest.py': 'import pytest\n\n@pytest.fixture(autouse=True)\ndef reg(request):\n    request.config.pluginmanager.register(object())\n' }, '', /pluginmanager/],
    ['a pytest.ini below the root', { 'tests/pytest.ini': '' }, '', /configures pytest below the root/],
    ['addopts that select', {}, '\n[tool.pytest.ini_options]\naddopts = "-k fast"\n', /addopts passes -k/],
    ['a required plugin', {}, '\n[tool.pytest.ini_options]\nrequired_plugins = "pytest-xdist"\n', /requires plugins/],
    ['an ini value with a comment character', { 'pytest.ini': '[pytest]\ntestpaths = tests # the suite\n' }, '', /comment character/],
  ])('%s', async (_name, files, extra, reason) => {
    const set = await buildAdapterSet(await python({ 'tests/test_a.py': 'def test_a():\n    pass\n', ...files }, '8.4.2', extra), { provider: null, coverage: null });
    expect(set.test).toBeNull();
    expect(set.reasons.get('test')).toMatch(reason);
  });

  test('a pytest_configure that only registers markers, and output-only addopts, are read', async () => {
    const root = await python(
      { 'conftest.py': 'def pytest_configure(config):\n    """Markers."""\n    config.addinivalue_line("markers", "slow: slow")\n' },
      '8.4.2', '\n[tool.pytest.ini_options]\naddopts = "-ra -q --strict-markers --tb=short"\n',
    );
    expect((await buildAdapterSet(root, { provider: null, coverage: null })).test).not.toBeNull();
  });

  test('a conftest of fixtures, and a plugin module imported by name, is read', async () => {
    const root = await python({
      'conftest.py': 'import pytest\nimport pytest_mock\nfrom pytest_mock import MockerFixture\n\n\n@pytest.fixture\ndef db(monkeypatch):\n    monkeypatch.setattr("os.sep", "/")\n    return 1\n',
    });
    expect((await buildAdapterSet(root, { provider: null, coverage: null })).test).not.toBeNull();
  });
});

describe('the pytest runner', () => {
  test('the install\'s interpreter, no plugin autoloaded, no doctest, no cache, each named test ./-led', async () => {
    const adapter = await pytestOf(await python());
    expect(adapter.runner).toBe('.venv/bin/python');
    expect(adapter.invocation(['tests/-x.py'])).toEqual(['.venv/bin/python', '-I', '-c', PYTEST_BOOTSTRAP, '--disable-plugin-autoload', '-p', 'no:cacheprovider', '-p', 'no:doctest', './tests/-x.py']);
    expect(adapter.invocation(null)).toHaveLength(9);
  });

  test('pytest is imported from the install before the tree joins the path, and the tree joins it last (codex-1)', () => {
    // `-I` keeps the working directory off `sys.path`, so a root `pytest.py` or `pytest.pyc` cannot stand in for the runner;
    // appending the tree afterwards keeps the tree's own modules importable without letting one shadow an installed module.
    const statements = PYTEST_BOOTSTRAP.split(';').map((s) => s.trim());
    expect(statements.indexOf('import pytest')).toBeGreaterThan(statements.indexOf('sys.path.append(os.getcwd())'));
    expect(statements.some((s) => /sys\.path\.(?:insert|__setitem__)|sys\.path\s*=/u.test(s))).toBe(false);
    expect(statements.at(-1)).toBe('raise SystemExit(pytest.console_main())');
  });

  test('missingRunner names a missing interpreter, then a missing pytest, and is null when both are installed', async () => {
    const root = await python();
    const adapter = await pytestOf(root);
    expect(await adapter.missingRunner(root)).toMatch(/interpreter is not installed at \.venv\/bin\/python/);
    await mkdir(join(root, '.venv', 'bin'), { recursive: true });
    await writeFile(join(root, '.venv', 'bin', 'python'), '');
    expect(await adapter.missingRunner(root)).toMatch(/pytest@8 is not installed in \.venv/);
    await mkdir(join(root, '.venv', 'lib', 'python3.13', 'site-packages', 'pytest'), { recursive: true });
    await writeFile(join(root, '.venv', 'lib', 'python3.13', 'site-packages', 'pytest', '__init__.py'), '');
    expect(await adapter.missingRunner(root)).toBeNull();
  });
});

describe('Python assertions', () => {
  const BEFORE = `import pytest

def test_x():
    assert total == 5
    assert x == pytest.approx(1.0, rel=1e-6)
    with pytest.raises(ValueError):
        f()
    assert ready
    assert gone == 1
`;
  const AFTER = `import pytest

def test_x():
    assert total != 5
    assert x == pytest.approx(1.0, rel=0.1)
    with pytest.raises(ValueError, match="bad"):
        f()
    assert ready == 1
`;

  test('a flipped comparison is weakened, a wider approx is widened, a removed one is removed, and a stronger form is not reported', async () => {
    const root = await python({ 'tests/before.py': BEFORE, 'tests/after.py': AFTER });
    const adapter = await pytestOf(root);
    const before = await adapter.parseAssertions(join(root, 'tests', 'before.py'));
    const after = await adapter.parseAssertions(join(root, 'tests', 'after.py'));
    expect(before.map((a) => [a.operator, ...a.args])).toEqual([
      ['==', 'total', '5'], ['== approx', 'x', '1.0'], ['raises', 'ValueError'], ['truthy', 'ready'], ['==', 'gone', '1'],
    ]);
    const delta = adapter.compareAssertions(before, after);
    expect(delta.weakened.map((a) => adapter.spell(a))).toEqual(['line 4: assert total != 5']);
    expect(delta.toleranceWidened.map((a) => a.tolerance)).toEqual([0.1]);
    expect(delta.removed.map((a) => adapter.spell(a))).toEqual(['line 9: assert gone == 1']);
  });

  // Every argument that changes what an assertion accepts is part of it, and a literal is compared as written (codex-5).
  test.each([
    ['nan_ok added to approx', 'assert x == pytest.approx(1.0)', 'assert x == pytest.approx(1.0, nan_ok=True)'],
    ['nan_ok flipped', 'assert x == pytest.approx(1.0, nan_ok=False)', 'assert x == pytest.approx(1.0, nan_ok=True)'],
    ['nan_ok given by position', 'assert x == pytest.approx(1.0, 1e-6, 1e-12)', 'assert x == pytest.approx(1.0, 1e-6, 1e-12, True)'],
    ['a raises check removed', 'with pytest.raises(ValueError, check=lambda e: e.code == 403):\n        f()', 'with pytest.raises(ValueError):\n        f()'],
    ['a warns argument removed', 'with pytest.warns(UserWarning, match="x"):\n        f()', 'with pytest.warns(UserWarning):\n        f()'],
    ['a unittest keyword changed', 'self.assertRegex(s, r"a+", flags=1)', 'self.assertRegex(s, r"a+", flags=2)'],
    ['whitespace inside an expected string', 'assert f() == "a  b"', 'assert f() == "a b"'],
    ['whitespace inside a match pattern', 'with pytest.raises(ValueError, match="a  b"):\n        f()', 'with pytest.raises(ValueError, match="a b"):\n        f()'],
    ['whitespace inside an f-string', 'assert f() == f"a  {b}"', 'assert f() == f"a {b}"'],
  ])('%s is reported', async (_name, before, after) => {
    const root = await python({ 'tests/b.py': `import pytest\n\ndef test_x():\n    ${before}\n`, 'tests/a.py': `import pytest\n\ndef test_x():\n    ${after}\n` });
    const adapter = await pytestOf(root);
    const delta = adapter.compareAssertions(await adapter.parseAssertions(join(root, 'tests', 'b.py')), await adapter.parseAssertions(join(root, 'tests', 'a.py')));
    expect([...delta.weakened, ...delta.toleranceWidened, ...delta.removed]).not.toHaveLength(0);
  });

  test.each([
    ['a raises check added', 'with pytest.raises(ValueError):\n        f()', 'with pytest.raises(ValueError, check=lambda e: e.code == 403):\n        f()'],
    ['a match added', 'with pytest.raises(ValueError):\n        f()', 'with pytest.raises(ValueError, match="bad"):\n        f()'],
    ['an operand reflowed across lines', 'assert f(1, 2) == "a  b"', 'assert f(1,\n             2) == "a  b"'],
    ['a message changed', 'self.assertEqual(a, b, msg="one")', 'self.assertEqual(a, b, msg="two")'],
  ])('%s is not reported', async (_name, before, after) => {
    const root = await python({ 'tests/b.py': `import pytest\n\ndef test_x():\n    ${before}\n`, 'tests/a.py': `import pytest\n\ndef test_x():\n    ${after}\n` });
    const adapter = await pytestOf(root);
    const delta = adapter.compareAssertions(await adapter.parseAssertions(join(root, 'tests', 'b.py')), await adapter.parseAssertions(join(root, 'tests', 'a.py')));
    expect([...delta.weakened, ...delta.toleranceWidened, ...delta.removed]).toEqual([]);
  });

  test('unittest assertions and almost-equal places become a comparable band', async () => {
    const root = await python({ 'tests/u.py': 'class T:\n    def test(self):\n        self.assertAlmostEqual(a, 1.0, places=3)\n        self.assertIn(x, y, msg="m")\n' });
    const found = await (await pytestOf(root)).parseAssertions(join(root, 'tests', 'u.py'));
    expect(found.map((a) => [a.operator, a.args, a.tolerance])).toEqual([['assertAlmostEqual', ['a', '1.0'], 0.0005], ['assertIn', ['x', 'y'], undefined]]);
  });
});

describe('coverage.py', () => {
  test('a changed statement the report counts as missing is uncovered, one it never names still counts, and a test file is excluded', async () => {
    const base = await python({ 'hello/__init__.py': 'def greet(n):\n    return "hi " + n\n', 'tests/test_h.py': 'def test_h():\n    pass\n' });
    const head = await python({
      'hello/__init__.py': 'def greet(n):\n    """Doc."""\n    if n:\n        return "hello " + n\n    return "none"  # pragma: no cover\n',
      'tests/test_h.py': 'def test_h():\n    assert True\n',
    });
    const report = join(head, 'coverage.json');
    await writeFile(report, JSON.stringify({ meta: { format: 3 }, files: { 'hello/__init__.py': { executed_lines: [1, 3, 4], missing_lines: [], excluded_lines: [5] } } }));
    const tests = await pytestOf(head);
    const adapter = new CoveragePyAdapter({ report, sourceRoot: '/workspace', tests });
    // Changed: 2 (docstring, not a statement), 3, 4 covered, 5 a statement the report excluded: 2 of 3.
    expect(await adapter.changedLineCoverage(base, head)).toBeCloseTo(2 / 3);
    // R28: the same lines, named: the excluded statement is an obligation the report could not remove.
    expect(await adapter.changedLineReport(base, head)).toEqual([{ path: 'hello/__init__.py', executed: [3, 4], unexecuted: [5] }]);
  });

  test('a report that is not coverage.py JSON is refused', async () => {
    const root = await python();
    await writeFile(join(root, 'c.json'), JSON.stringify({ totals: {} }));
    const adapter = new CoveragePyAdapter({ report: join(root, 'c.json'), sourceRoot: '/workspace', tests: await pytestOf(root) });
    await expect(adapter.changedLineCoverage(root, root)).rejects.toBeInstanceOf(AdapterRefusal);
  });
});

describe('the Python installers', () => {
  test('each makes a virtualenv with copies first, builds nothing, installs no project, and verifies every hash', () => {
    for (const installer of [UV_INSTALLER, PIP_INSTALLER]) {
      expect(installer.steps[0]).toEqual(['python', '-I', '-m', 'venv', '--copies', '.venv']);
      for (const step of installer.steps) if (step[0].endsWith('python')) expect(step[1]).toBe('-I');
      expect(installer.image).toBe(PYTHON_IMAGE);
      expect(installer.trees).toEqual(PYTHON_DEPENDENCY_TREES);
    }
    expect(UV_INSTALLER.steps[1]).toEqual(expect.arrayContaining(['uv', 'sync', '--frozen', '--no-install-workspace', '--no-build']));
    expect(PIP_INSTALLER.steps[1]).toEqual(expect.arrayContaining(['--require-hashes', '--no-deps', '--only-binary', ':all:']));
    expect(PIP_INSTALLER.env.PIP_CONFIG_FILE).toBe('/dev/null');
  });

  test('uv.lock: a registry wheel is verifiable; the project is skipped; a git source, a package with no wheel, and an unhashed wheel are not', () => {
    const lock = [
      uvLock(),
      '[[package]]', 'name = "fromgit"', 'version = "1.0"', 'source = { git = "https://example.com/x.git" }', '',
      '[[package]]', 'name = "sdistonly"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }', 'sdist = { url = "https://x/s.tar.gz", hash = "sha256:00" }', '',
      '[[package]]', 'name = "nohash"', 'version = "1.0"', 'source = { registry = "https://pypi.org/simple" }', 'wheels = [{ url = "https://x/n.whl" }]', '',
    ].join('\n');
    const read = UV_INSTALLER.packages(lock);
    if (!read.ok) throw new Error(read.reason);
    expect(read.packages.map((p) => [p.key, p.unverifiable === null ? null : p.unverifiable.split(',')[0]])).toEqual([
      ['fromgit@1.0', 'it comes from git'],
      ['nohash@1.0', 'a wheel of it records no sha256 hash'],
      ['pytest@8.4.2', null],
      ['sdistonly@1.0', 'it has no wheel'],
    ]);
  });

  test('requirements.txt: a pinned, hashed line is verifiable; an unpinned or unhashed one is not; an option line is refused', () => {
    const read = PIP_INSTALLER.packages(`pytest==8.4.2 \\\n    --hash=${HASH}\nrequests>=2 --hash=${HASH}\nidna==3.0\n`);
    if (!read.ok) throw new Error(read.reason);
    expect(read.packages.map((p) => [p.key, p.unverifiable])).toEqual([
      ['idna@3.0', 'it records no hash'], ['pytest@8.4.2', null], ['requests@(unpinned)', 'it is not pinned to one version with =='],
    ]);
    const option = PIP_INSTALLER.packages(`--index-url https://evil.example/simple\npytest==8.4.2 --hash=${HASH}\n`);
    expect(option.ok ? 'read' : option.reason).toMatch(/option --index-url/);
  });

  test('a failed install names a hash failure, a missing wheel, or an unreachable registry', () => {
    expect(UV_INSTALLER.failure('error: Hash mismatch for `iniconfig==2.3.1`')).toMatch(/failed the hash/);
    expect(PIP_INSTALLER.failure('ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE.')).toMatch(/failed the hash/);
    expect(UV_INSTALLER.failure('Building source distributions is disabled')).toMatch(/no wheel/);
    expect(UV_INSTALLER.failure('error: Failed to fetch: `https://pypi.org/simple/x/`')).toMatch(/could not be reached/);
  });
});

describe("Python's config files", () => {
  test.each(['pyproject.toml', 'uv.lock', 'requirements-dev.txt', 'tests/conftest.py', 'pytest.ini', 'setup.cfg', '.coveragerc', 'pkg/x.pth', 'sitecustomize.py'])('%s is a config file', (path) => {
    expect(isConfigFile(path)).toBe(true);
  });

  test('a test file and a module are not', () => {
    expect(isConfigFile('tests/test_a.py')).toBe(false);
    expect(isConfigFile('hello/__init__.py')).toBe(false);
  });
});
