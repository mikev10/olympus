/**
 * pytest's configuration, read the way pytest reads it and never run
 * (D-R29-04, D-R29-06): which files configure it, in its own order for each
 * supported major (`_pytest/config/findpaths.py`, 8.4.2 and 9.2.0), the
 * settings that decide which files and names are tests, and the version the
 * lockfile pins. A setting that changes collection in a way this package
 * does not model is refused, naming it, as P8 refuses a computed config.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { exists, readRegularFile, SOURCE_FILE_CAP } from '../files.js';
import { describe, refuse } from '../refusal.js';
import { parseIni, splitArgs } from './ini.js';

export type PytestMajor = 8 | 9;

/** The settings that decide what pytest collects, as one tree's config sets them. */
export interface PytestRules {
  readonly major: PytestMajor;
  /** The root file the settings came from, or null for pytest's defaults. */
  readonly configFile: string | null;
  readonly testpaths: readonly string[];
  readonly pythonFiles: readonly string[];
  readonly pythonClasses: readonly string[];
  readonly pythonFunctions: readonly string[];
  readonly norecursedirs: readonly string[];
  /** pytest 9 shortens a string argvalue over 100 characters to `<argname><index>` unless this is `legacy`. */
  readonly longStringIds: 'short' | 'legacy';
}

/** pytest's defaults, identical in 8.4.2 and 9.2.0 (`_pytest/main.py`, `_pytest/python.py`). */
export const PYTEST_DEFAULTS = {
  testpaths: [] as readonly string[],
  pythonFiles: ['test_*.py', '*_test.py'] as readonly string[],
  pythonClasses: ['Test'] as readonly string[],
  pythonFunctions: ['test'] as readonly string[],
  norecursedirs: ['*.egg', '.*', '_darcs', 'build', 'CVS', 'dist', 'node_modules', 'venv', '{arch}'] as readonly string[],
} as const;

/** The files each major reads its config from, in the order it tries them in one directory (`CONFIG_LOADERS_BY_NAME`). */
export const PYTEST_CONFIG_NAMES: Readonly<Record<PytestMajor, readonly string[]>> = {
  8: ['pytest.ini', '.pytest.ini', 'pyproject.toml', 'tox.ini', 'setup.cfg'],
  9: ['pytest.toml', '.pytest.toml', 'pytest.ini', '.pytest.ini', 'pyproject.toml', 'tox.ini', 'setup.cfg'],
};

type Value = string | readonly string[];
type Settings = ReadonlyMap<string, Value>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

async function readToml(path: string): Promise<Record<string, unknown>> {
  try {
    return parseToml(await readRegularFile(path, SOURCE_FILE_CAP));
  } catch (error) {
    return refuse('unparseable', `${path} is not TOML pytest can read: ${describe(error)}`);
  }
}

/** A TOML table's settings, each a string or a list of strings; anything else is a value this package does not read. */
function tomlSettings(table: Record<string, unknown>, label: string): Settings {
  const out = new Map<string, Value>();
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === 'string') out.set(key, value);
    else if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) out.set(key, value);
    else if (typeof value === 'boolean' || typeof value === 'number') out.set(key, String(value));
    else refuse('unresolvable-config', `${label} sets ${key} to a value that is neither a string nor a list of strings`);
  }
  return out;
}

/**
 * The settings `file` holds for pytest, or null when pytest would pass over
 * it. Each loader is the major's own: a dedicated file always configures
 * pytest, a shared one only with its pytest section.
 */
export async function loadConfig(path: string, name: string, major: PytestMajor): Promise<Settings | null> {
  if (name === 'pytest.ini' || name === '.pytest.ini' || name === 'tox.ini' || name === 'setup.cfg') {
    const ini = parseIni(await readRegularFile(path, SOURCE_FILE_CAP), path);
    if (name === 'setup.cfg') {
      if (ini.has('pytest') && !ini.has('tool:pytest')) refuse('unresolvable-config', `${path} has a [pytest] section, which pytest refuses in setup.cfg`);
      return ini.get('tool:pytest') ?? null;
    }
    const section = ini.get('pytest');
    if (section !== undefined) return section;
    return name === 'tox.ini' ? null : new Map();
  }
  const toml = await readToml(path);
  if (name === 'pytest.toml' || name === '.pytest.toml') {
    if (isRecord(toml.pytest)) return tomlSettings(toml.pytest, `${path} [pytest]`);
    const loose = Object.keys(toml).filter((k) => !isRecord(toml[k]));
    if (loose.length > 0) refuse('unresolvable-config', `${path} sets ${loose.join(', ')} outside a [pytest] table, which pytest refuses`);
    return new Map();
  }
  // pyproject.toml
  const tool = isRecord(toml.tool) ? toml.tool : {};
  const pytest = isRecord(tool.pytest) ? tool.pytest : undefined;
  if (pytest === undefined) return null;
  const ini = isRecord(pytest.ini_options) ? pytest.ini_options : undefined;
  const native = Object.fromEntries(Object.entries(pytest).filter(([k]) => k !== 'ini_options'));
  if (major === 8) return ini === undefined ? null : tomlSettings(ini, `${path} [tool.pytest.ini_options]`);
  if (ini !== undefined && Object.keys(native).length > 0) refuse('unresolvable-config', `${path} sets both [tool.pytest] and [tool.pytest.ini_options], which pytest refuses`);
  if (ini !== undefined) return tomlSettings(ini, `${path} [tool.pytest.ini_options]`);
  return Object.keys(native).length > 0 ? tomlSettings(native, `${path} [tool.pytest]`) : null;
}

/** The root's config file and its settings, by the major's order; pytest's defaults when the root holds none. */
export async function rootConfig(root: string, major: PytestMajor): Promise<{ readonly file: string | null; readonly settings: Settings }> {
  for (const name of PYTEST_CONFIG_NAMES[major]) {
    const path = join(root, name);
    if (!(await exists(path))) continue;
    const settings = await loadConfig(path, name, major);
    if (settings !== null) return { file: name, settings };
  }
  return { file: null, settings: new Map() };
}

function argsOf(settings: Settings, key: string, label: string): string[] | undefined {
  const value = settings.get(key);
  if (value === undefined) return undefined;
  return typeof value === 'string' ? splitArgs(value, `${label} ${key}`) : [...value];
}

/** addopts that change only what is printed or how a failure stops the run, never what is collected (D-R29-06). */
const OUTPUT_FLAGS = new Set([
  '-q', '-qq', '-qqq', '--quiet', '-v', '-vv', '-vvv', '--verbose', '-l', '--showlocals', '-s', '--no-header', '--no-summary',
  '--strict-markers', '--strict-config', '--strict', '-x', '--exitfirst',
]);
const OUTPUT_PREFIXES = ['--tb=', '--color=', '--durations=', '--durations-min=', '--maxfail=', '--capture=', '--import-mode=', '--log-level=', '--log-cli-level='];

function checkAddopts(tokens: readonly string[], label: string): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    if (OUTPUT_FLAGS.has(token) || OUTPUT_PREFIXES.some((p) => token.startsWith(p)) || /^-r[fEsxXpPaAN]+$/u.test(token)) continue;
    if (token === '-W' && i + 1 < tokens.length) {
      i++;
      continue;
    }
    if (/^-W.+/u.test(token) || token.startsWith('--pythonwarnings=')) continue;
    refuse('unsupported-feature', `${label} addopts passes ${token}, which may change what pytest collects and is not modelled`);
  }
}

/** The settings that decide collection, read from the root's config, with every one that changes it unmodelled refused. */
export async function pytestRules(root: string, major: PytestMajor): Promise<PytestRules> {
  const { file, settings } = await rootConfig(root, major);
  const label = file ?? 'the pytest defaults';
  for (const [key, value] of settings) {
    const text = typeof value === 'string' ? value : value.join(' ');
    // iniconfig strips an inline comment in some versions and not others, so a value holding one is read two ways.
    if (file !== null && !file.endsWith('.toml') && /[#;]/u.test(text)) {
      refuse('unresolvable-config', `${label} ${key} holds a comment character, which iniconfig versions read differently`);
    }
  }
  checkAddopts(argsOf(settings, 'addopts', label) ?? [], label);
  const plugins = argsOf(settings, 'required_plugins', label) ?? [];
  if (plugins.length > 0) refuse('unsupported-feature', `${label} requires plugins (${plugins.join(', ')}), and a plugin that changes collection is not modelled`);
  const strategy = settings.get('parametrize_long_str_id_strategy');
  if (strategy !== undefined && strategy !== 'short' && strategy !== 'legacy') refuse('unresolvable-config', `${label} parametrize_long_str_id_strategy is ${String(strategy)}`);
  return {
    major,
    configFile: file,
    testpaths: argsOf(settings, 'testpaths', label) ?? PYTEST_DEFAULTS.testpaths,
    pythonFiles: argsOf(settings, 'python_files', label) ?? PYTEST_DEFAULTS.pythonFiles,
    pythonClasses: argsOf(settings, 'python_classes', label) ?? PYTEST_DEFAULTS.pythonClasses,
    pythonFunctions: argsOf(settings, 'python_functions', label) ?? PYTEST_DEFAULTS.pythonFunctions,
    norecursedirs: argsOf(settings, 'norecursedirs', label) ?? PYTEST_DEFAULTS.norecursedirs,
    longStringIds: strategy === 'legacy' || major === 8 ? 'legacy' : 'short',
  };
}

// ---- declaration and version ----------------------------------------------

/** A PEP 508 requirement's name, normalised (PEP 503), or undefined for a line that names none. */
export function requirementName(spec: string): string | undefined {
  const match = /^\s*([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)/u.exec(spec);
  return match?.[1]?.toLowerCase().replace(/[-_.]+/gu, '-');
}

/** The requirement strings `pyproject.toml` declares, in every place uv and PEP 621 and 735 put one. */
function declaredRequirements(toml: Record<string, unknown>): string[] {
  const out: string[] = [];
  const strings = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) if (typeof v === 'string') out.push(v);
  };
  const project = isRecord(toml.project) ? toml.project : {};
  strings(project.dependencies);
  if (isRecord(project['optional-dependencies'])) for (const v of Object.values(project['optional-dependencies'])) strings(v);
  if (isRecord(toml['dependency-groups'])) for (const v of Object.values(toml['dependency-groups'])) strings(v);
  const tool = isRecord(toml.tool) ? toml.tool : {};
  const uv = isRecord(tool.uv) ? tool.uv : {};
  strings(uv['dev-dependencies']);
  return out;
}

/** The root's requirements files, `requirements.txt` and its `requirements-dev.txt`-style siblings; a `requirements/` directory is not read. */
async function requirementsFiles(root: string): Promise<string[]> {
  const names = (await readdir(root, { withFileTypes: true })).filter((e) => e.isFile() && /^requirements[\w.-]*\.txt$/u.test(e.name)).map((e) => e.name);
  return names.sort();
}

/** The requirement lines of a requirements file, continuations joined and comments dropped. */
export function requirementLines(text: string): Array<{ readonly line: number; readonly text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let pending: { line: number; text: string } | null = null;
  const lines = text.split(/\r\n|\n|\r/u);
  for (const [index, raw] of lines.entries()) {
    const hash = raw.search(/(^|\s)#/u);
    const line = (hash === -1 ? raw : raw.slice(0, hash)).trimEnd();
    const continues = line.endsWith('\\');
    const body = continues ? line.slice(0, -1) : line;
    if (pending === null) pending = { line: index + 1, text: body };
    else pending.text += ` ${body}`;
    if (continues) continue;
    if (pending.text.trim() !== '') out.push({ line: pending.line, text: pending.text.trim() });
    pending = null;
  }
  if (pending !== null && pending.text.trim() !== '') out.push({ line: pending.line, text: pending.text.trim() });
  return out;
}

/** Whether the repository declares pytest: in `pyproject.toml` or a root requirements file (D-R29-04). */
export async function declaresPytest(root: string): Promise<boolean> {
  if (await exists(join(root, 'pyproject.toml'))) {
    if (declaredRequirements(await readToml(join(root, 'pyproject.toml'))).some((r) => requirementName(r) === 'pytest')) return true;
  }
  for (const name of await requirementsFiles(root)) {
    const lines = requirementLines(await readRegularFile(join(root, name), SOURCE_FILE_CAP));
    if (lines.some((l) => requirementName(l.text) === 'pytest')) return true;
  }
  return false;
}

/** Whether the root holds a Python project: a `pyproject.toml` or a root requirements file. */
export async function isPythonProject(root: string): Promise<boolean> {
  return (await exists(join(root, 'pyproject.toml'))) || (await requirementsFiles(root)).length > 0;
}

/** The pytest version the lockfile pins: `uv.lock`'s package, or `requirements.txt`'s `==` (D-R29-04). */
export async function pinnedPytest(root: string): Promise<string> {
  const pins: Array<{ readonly from: string; readonly version: string }> = [];
  if (await exists(join(root, 'uv.lock'))) {
    const lock = await readToml(join(root, 'uv.lock'));
    const packages = Array.isArray(lock.package) ? lock.package : [];
    for (const p of packages) {
      if (isRecord(p) && typeof p.name === 'string' && requirementName(p.name) === 'pytest' && typeof p.version === 'string') pins.push({ from: 'uv.lock', version: p.version });
    }
  }
  if (await exists(join(root, 'requirements.txt'))) {
    for (const l of requirementLines(await readRegularFile(join(root, 'requirements.txt'), SOURCE_FILE_CAP))) {
      if (requirementName(l.text) !== 'pytest') continue;
      const match = /^[A-Za-z0-9._-]+\s*==\s*([0-9][0-9A-Za-z.+!-]*)(?:\s|;|$)/u.exec(l.text);
      if (match?.[1] === undefined) refuse('unsupported-version', `requirements.txt line ${String(l.line)} does not pin pytest with ==`);
      pins.push({ from: 'requirements.txt', version: match[1] });
    }
  }
  const versions = [...new Set(pins.map((p) => p.version))];
  const [only] = versions;
  if (only === undefined) return refuse('unsupported-version', 'pytest is declared and no lockfile pins its version (uv.lock or a hashed requirements.txt), so which pytest runs is not known');
  if (versions.length > 1) refuse('unsupported-version', `pytest is pinned at several versions (${pins.map((p) => `${p.version} in ${p.from}`).join(', ')})`);
  return only;
}

/** The major a pinned version selects: 8 from 8.4 on, or 9 (D-R29-04). Any other is refused. */
export function pytestMajor(version: string): PytestMajor {
  const match = /^(\d+)\.(\d+)/u.exec(version);
  const major = Number(match?.[1]);
  const minor = Number(match?.[2]);
  if (major === 9) return 9;
  if (major === 8 && minor >= 4) return 8;
  return refuse('unsupported-version', `pytest ${version} is pinned, and this package encodes the collection rules of pytest 8.4 and later and of pytest 9`);
}
