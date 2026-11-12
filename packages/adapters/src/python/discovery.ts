/**
 * The suites pytest collects, enumerated on the host from files alone by
 * pytest's own rules (`_pytest/main.py`, `_pytest/python.py`, 8.4.2 and
 * 9.2.0): `testpaths`, globbed from the root when no path is given, else the
 * root; every directory entered but `__pycache__`, a virtualenv, and one
 * `norecursedirs` matches; every `.py` file `python_files` matches; and a
 * named file collected whatever its name. Before any of that, every conftest
 * and every config file below the root is checked for what would change
 * collection without the root's settings saying so (D-R29-06).
 */
import type { SyntaxNode } from '@lezer/common';
import { lstat, readdir } from 'node:fs/promises';
import { join, posix, relative, resolve } from 'node:path';
import { glob } from 'tinyglobby';
import { exists, toPosix, VCS_DIRECTORIES, walkTree } from '../files.js';
import { refuse } from '../refusal.js';
import { isDependencyTree } from '../trees.js';
import { loadConfig, pinnedPytest, PYTEST_CONFIG_NAMES, pytestMajor, pytestRules, rootConfig, type PytestMajor, type PytestRules } from './config.js';
import { fnmatch } from './ini.js';
import { argumentsOf, callOf, childrenOf, readPython, statementsOf, textOf, type PythonModule } from './parse.js';

/** Where the sandbox mounts the tree: the path pytest's absolute-path patterns are matched against. */
const MOUNT = '/workspace';

/** `fnmatch_ex`: a pattern with no `/` matches the name, one with a `/` the whole path, relative patterns anchored anywhere. */
export function fnmatchEx(pattern: string, path: string): boolean {
  if (!pattern.includes('/')) return fnmatch(posix.basename(path), pattern);
  return fnmatch(path, posix.isAbsolute(pattern) ? pattern : `*/${pattern}`);
}

/** Hook names whose definition in a conftest changes what is collected (D-R29-06). */
const COLLECTION_HOOK = /^pytest_(?:collect|ignore_collect|pycollect_|generate_tests|collection|make_collect_report|load_initial_conftests|cmdline_|sessionstart|plugin_registered|addhooks)/u;
const COLLECTION_VARIABLES = new Set(['pytest_plugins', 'collect_ignore', 'collect_ignore_glob']);

/** A `pytest_configure` that only registers markers: every statement `config.addinivalue_line("markers", ...)`, a docstring, or `pass`. */
function onlyRegistersMarkers(module: PythonModule, def: SyntaxNode): boolean {
  const params = childrenOf(def).find((c) => c.name === 'ParamList');
  const first = params === undefined ? undefined : childrenOf(params).find((c) => c.name === 'VariableName');
  const body = childrenOf(def).find((c) => c.name === 'Body');
  if (first === undefined || body === undefined) return false;
  const config = textOf(module, first);
  return statementsOf(body).every((s) => {
    if (s.name === 'PassStatement') return true;
    if (s.name !== 'ExpressionStatement') return false;
    const [expr] = childrenOf(s);
    if (expr?.name === 'String') return true;
    const call = expr === undefined ? undefined : callOf(module, expr);
    if (call?.name !== `${config}.addinivalue_line`) return false;
    const args = argumentsOf(module, call.args);
    const kind = args?.positional[0];
    return kind !== undefined && /^["']markers["']$/u.test(textOf(module, kind));
  });
}

/** Refuses a conftest that changes collection: a plugin it loads, a path it ignores, or a collection hook (D-R29-06). */
export async function checkConftest(file: string, label: string): Promise<void> {
  const module = await readPython(file);
  for (const statement of statementsOf(module.tree.topNode)) {
    const def = statement.name === 'DecoratedStatement' ? childrenOf(statement).find((c) => c.name === 'FunctionDefinition') : statement;
    if (def?.name === 'FunctionDefinition') {
      const name = childrenOf(def).find((c) => c.name === 'VariableName');
      const hook = name === undefined ? '' : textOf(module, name);
      if (hook === 'pytest_configure' && !onlyRegistersMarkers(module, def)) {
        refuse('unsupported-feature', `${label} defines pytest_configure, which can change what pytest collects and is not read statically`);
      }
      if (COLLECTION_HOOK.test(hook)) refuse('unsupported-feature', `${label} defines ${hook}, which changes what pytest collects`);
    }
    if (statement.name === 'AssignStatement' || statement.name === 'UpdateStatement') {
      for (const target of childrenOf(statement)) {
        if (target.name === 'AssignOp' || target.name === 'UpdateOp') break;
        if (target.name === 'VariableName' && COLLECTION_VARIABLES.has(textOf(module, target))) {
          refuse('unsupported-feature', `${label} sets ${textOf(module, target)}, which changes what pytest collects`);
        }
      }
    }
  }
}

function skipped(name: string): boolean {
  return VCS_DIRECTORIES.has(name) || isDependencyTree(name);
}

/**
 * The checks over the whole tree: every conftest, and every config file below
 * the root that pytest would read for a test beneath it, since it finds its
 * config by walking up from each path it is given (`locate_config`).
 */
async function checkTree(root: string, major: PytestMajor, rootHasConfig: boolean): Promise<void> {
  const names = new Set(PYTEST_CONFIG_NAMES[major]);
  const entries = await walkTree(root, { skipDirectory: skipped });
  for (const [path, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const name = posix.basename(path);
    if (entry.kind !== 'file') continue;
    if (name === 'conftest.py') await checkConftest(entry.absolute, path);
    if (!path.includes('/') || !names.has(name)) continue;
    const settings = await loadConfig(entry.absolute, name, major);
    if (settings !== null) refuse('unsupported-feature', `${path} configures pytest below the root, so a test beneath it is collected by other settings`);
    if (name === 'pyproject.toml' && !rootHasConfig) refuse('unsupported-feature', `${path} would make its directory pytest's rootdir for a test beneath it, as the root holds no pytest config`);
  }
}

export interface PytestDiscovery {
  readonly version: string;
  readonly rules: PytestRules;
}

/** The pinned version, its major's rules from the root's config, and the tree checked for what would change them. */
export async function pytestDiscovery(root: string): Promise<PytestDiscovery> {
  const version = await pinnedPytest(root);
  const major = pytestMajor(version);
  const rules = await pytestRules(root, major);
  await checkTree(root, major, (await rootConfig(root, major)).file !== null);
  return { version, rules };
}

/** A virtualenv's root, which pytest never enters (`_in_venv`). */
async function isVenv(dir: string): Promise<boolean> {
  return (await exists(join(dir, 'pyvenv.cfg'))) || (await exists(join(dir, 'conda-meta', 'history')));
}

/** The paths `testpaths` names, globbed from the root as pytest globs them, or the root when it names none that exist. */
async function startPaths(root: string, rules: PytestRules): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of rules.testpaths) {
    if (/[{}]/u.test(pattern) || posix.isAbsolute(pattern) || pattern.split('/').includes('..')) {
      refuse('unresolvable-config', `${rules.configFile ?? 'the config'} testpaths entry ${pattern} is not a pattern under the root this package reads`);
    }
    const matched = await glob(pattern, { cwd: root, dot: false, onlyFiles: false, expandDirectories: false, followSymbolicLinks: false });
    found.push(...matched.map((m) => m.replace(/\/+$/u, '')).sort());
  }
  return found.length === 0 ? [''] : [...new Set(found)];
}

/** Every suite pytest collects from the root with no path given, absolute and sorted. */
export async function pytestSuites(root: string): Promise<string[]> {
  const { rules } = await pytestDiscovery(root);
  const top = resolve(root);
  const out = new Set<string>();
  const collects = (rel: string): boolean => rel.endsWith('.py') && rules.pythonFiles.some((p) => fnmatchEx(p, `${MOUNT}/${rel}`));
  const visit = async (rel: string): Promise<void> => {
    const dir = join(top, ...rel.split('/').filter(Boolean));
    const children = (await readdir(dir, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      const path = rel === '' ? child.name : `${rel}/${child.name}`;
      if (child.isSymbolicLink()) {
        if (skipped(child.name) || child.name === '__pycache__') continue;
        refuse('unsafe-path', `${path} is a symbolic link where pytest collects, and pytest follows it`);
      }
      if (child.isDirectory()) {
        if (child.name === '__pycache__' || skipped(child.name)) continue;
        if (await isVenv(join(dir, child.name))) continue;
        if (rules.norecursedirs.some((p) => fnmatchEx(p, `${MOUNT}/${path}`))) continue;
        await visit(path);
      } else if (child.isFile() && collects(path)) out.add(join(top, ...path.split('/')));
    }
  };
  for (const start of await startPaths(top, rules)) {
    const absolute = join(top, ...start.split('/').filter(Boolean));
    const facts = await lstat(absolute);
    if (facts.isSymbolicLink()) refuse('unsafe-path', `testpaths names ${start}, a symbolic link`);
    // A path pytest is given is collected whatever python_files says (`isinitpath`).
    if (facts.isFile()) {
      if (start.endsWith('.py')) out.add(absolute);
    } else if (facts.isDirectory()) await visit(start);
  }
  return [...out].sort();
}

/**
 * The suites `pytest <tests…>` runs from the root: each named file that is a
 * regular `.py` file in the tree, collected whatever its name, since a path
 * pytest is given is not matched against `python_files`.
 */
export async function pytestSelection(root: string, tests: readonly string[]): Promise<string[]> {
  await pytestDiscovery(root);
  const top = resolve(root);
  const out = new Set<string>();
  for (const test of tests) {
    const rel = toPosix(relative(top, resolve(top, test)));
    if (rel.startsWith('..') || posix.isAbsolute(rel) || !rel.endsWith('.py')) continue;
    const facts = await lstat(join(top, ...rel.split('/'))).catch(() => null);
    if (facts?.isFile() === true) out.add(rel);
  }
  return [...out].sort();
}
