/**
 * The host's configuration, declared once (R35, #121, #127): the table names
 * every variable the host reads, the host reads only through it, the shipped
 * docs list every entry, and start-up refuses with every problem at once.
 * And the start-up symlink probe (#28, #123).
 */
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { checkStartup, HOST_VARIABLES, listenProblem, mergeEnvFile, readHostConfig, refusalText, type HostFacts } from '../src/host/config.js';
import { probeSymlinks } from '../src/host/symlinks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAIN = join(ROOT, 'packages', 'api', 'src', 'host', 'main.ts');

/** How a table entry is written in the docs: a prefix family as `NAME*`. */
const documented = (v: (typeof HOST_VARIABLES)[number]): string => (v.prefix === true ? `${v.name}*` : v.name);

/** A host with uids, as Linux and macOS are: the container user is optional there, so these tests are the same on every OS. */
const HAS_UIDS: HostFacts = { uids: true };

const FULL: Record<string, string> = {
  FACTORY_API_TOKEN: 'x'.repeat(32), FACTORY_LISTEN_PORT: '7300', FACTORY_POLICY_FILE: '/p.yaml', FACTORY_ROLES_DIR: '/roles',
  FACTORY_VAULT_STORE: '/store', FACTORY_REPOSITORY: '/repo', FACTORY_TREES: '/trees', ANTHROPIC_API_KEY: 'k',
  FACTORY_GIT_REPOSITORY: 'o/r', FACTORY_GIT_BASE_BRANCH: 'main', FACTORY_GIT_TOKEN: 't',
};

describe('the configuration table and the docs', () => {
  test('.env.example names every variable in the table, and nothing the table does not', async () => {
    const text = await readFile(join(ROOT, '.env.example'), 'utf8');
    const named = [...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]*\*?)=/gmu)].map((m) => m[1]);
    for (const v of HOST_VARIABLES) expect(named, `.env.example lacks ${documented(v)}`).toContain(documented(v));
    for (const name of named) expect(HOST_VARIABLES.map(documented), `.env.example names ${String(name)}, which the host does not read`).toContain(name);
  });

  test('the README\'s configuration table has a row for every variable, saying whether it is required and secret', async () => {
    const readme = await readFile(join(ROOT, 'README.md'), 'utf8');
    // Each column by its position, so a row with Required and Secret swapped is caught (review: codex-8, gemini-2).
    const rows = readme.split(/\r?\n/u).filter((line) => line.startsWith('| `')).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
    for (const v of HOST_VARIABLES) {
      const row = rows.find((cells) => cells[0] === `\`${documented(v)}\``);
      expect(row, `README.md has no row for ${documented(v)}`).toBeDefined();
      expect(row?.[1], `${documented(v)}: Required`).toBe(v.required ? 'yes' : 'no');
      expect(row?.[2], `${documented(v)}: Secret`).toBe(v.secret ? 'yes' : 'no');
    }
  });

  test('the host reads only names the table declares', () => {
    const read = new Set<string>();
    const env = new Proxy(FULL, { get: (target, key) => { if (typeof key === 'string') read.add(key); return target[key as string]; } });
    const result = readHostConfig(env, HAS_UIDS);
    expect(result.ok).toBe(true);
    if (result.ok) result.settings.webhookSecret('FACTORY_WEBHOOK_GITHUB');
    expect(read.size).toBeGreaterThan(0);
    for (const name of read) {
      expect(HOST_VARIABLES.some((v) => (v.prefix === true ? name.startsWith(v.name) : v.name === name)), `${name} is read but not declared`).toBe(true);
    }
  });

  test('main.ts touches the environment once, handing it to readHostConfig', async () => {
    const source = await readFile(MAIN, 'utf8');
    expect(source.match(/process\.env/gu)).toHaveLength(1);
    expect(source).toContain('checkStartup(await environment(process.argv.slice(2), process.env))');
  });

  test('a webhook secret is read only under the webhook prefix', () => {
    const result = readHostConfig({ ...FULL, FACTORY_WEBHOOK_GITHUB: 's' }, HAS_UIDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.webhookSecret('FACTORY_WEBHOOK_GITHUB')).toBe('s');
    expect(result.settings.webhookSecret('ANTHROPIC_API_KEY')).toBeUndefined();
  });
});

describe('start-up refusal (I5)', () => {
  test('an empty environment is refused with every required variable in one list', () => {
    const result = readHostConfig({}, HAS_UIDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const required = HOST_VARIABLES.filter((v) => v.required).map((v) => v.name);
    expect(result.problems).toHaveLength(required.length);
    for (const name of required) expect(result.problems.some((p) => p.startsWith(`${name} is not set`))).toBe(true);
  });

  test('invalid values are listed beside missing ones, not one at a time', () => {
    const { FACTORY_GIT_TOKEN: _token, ...rest } = FULL;
    const result = readHostConfig({ ...rest, FACTORY_LISTEN_PORT: 'eighty', FACTORY_CONTAINER_UID: '1000', FACTORY_CODEX_SEATS: 'reviewer', FACTORY_ENDPOINT_KEY: 'k' }, HAS_UIDS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(5);
    expect(result.problems.join('\n')).toMatch(/FACTORY_GIT_TOKEN is not set/u);
    expect(result.problems.join('\n')).toMatch(/FACTORY_LISTEN_PORT is not a port/u);
    expect(result.problems.join('\n')).toMatch(/FACTORY_CONTAINER_UID and FACTORY_CONTAINER_GID/u);
    expect(result.problems.join('\n')).toMatch(/FACTORY_CODEX_SEATS and FACTORY_CODEX_KEY/u);
    expect(result.problems.join('\n')).toMatch(/FACTORY_ENDPOINT_KEY is set without/u);
  });

  test('the refusal names each problem and where the docs are, and never prints a value', () => {
    const result = readHostConfig({ FACTORY_API_TOKEN: 'secret-token-value' }, HAS_UIDS);
    expect(result.ok).toBe(false);
    const text = refusalText(result.ok ? [] : result.problems);
    expect(text).toMatch(/^not started; \d+ configuration problems:/u);
    expect(text).toContain('.env.example');
    expect(text).not.toContain('secret-token-value');
  });
});

describe('the symlink probe (#28, #123)', () => {
  test('a directory that holds a link passes, and the probe leaves nothing behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'r35-links-'));
    try {
      const made: string[] = [];
      expect(await probeSymlinks(join(dir, 'trees'), async (target, path) => { made.push(path); await symlink(target, path, 'file'); })).toBeNull();
      expect(made).toHaveLength(1);
      expect(await readdir(join(dir, 'trees'))).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a host that cannot create one is refused, naming WSL2 and Developer Mode, whatever the platform', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'r35-links-'));
    try {
      const eperm = Object.assign(new Error('EPERM: operation not permitted, symlink'), { code: 'EPERM' });
      const refusal = await probeSymlinks(dir, () => Promise.reject(eperm));
      expect(refusal).toMatch(/cannot hold a symbolic link \(EPERM\)/u);
      expect(refusal).toMatch(/WSL2/u);
      expect(refusal).toMatch(/Developer Mode/u);
      expect(await readdir(dir)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('every start-up problem in one list (review: codex-5)', () => {
  test('a missing variable, a short token, an unreadable endpoint file, and trees that cannot hold a link are listed together', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'r35-startup-'));
    try {
      const blocker = join(dir, 'a-file');
      await writeFile(blocker, 'not a directory');
      const { FACTORY_GIT_TOKEN: _token, ...rest } = FULL;
      const result = await checkStartup({
        ...rest, FACTORY_API_TOKEN: 'short', FACTORY_TREES: join(blocker, 'trees'),
        FACTORY_ENDPOINT_CONFIG: join(dir, 'no-such-endpoint.json'), FACTORY_ENDPOINT_KEY: 'k',
      }, undefined, HAS_UIDS);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const text = result.problems.join('\n');
      expect(text).toMatch(/FACTORY_GIT_TOKEN is not set/u);
      expect(text).toMatch(/FACTORY_API_TOKEN is shorter than 32 characters/u);
      expect(text).toMatch(/FACTORY_ENDPOINT_CONFIG \(.*no-such-endpoint\.json\)/u);
      expect(text).toMatch(/cannot hold a symbolic link/u);
      expect(result.problems).toHaveLength(4);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a configuration with every check passing is returned with its settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'r35-startup-'));
    try {
      const result = await checkStartup({ ...FULL, FACTORY_TREES: join(dir, 'trees') }, undefined, HAS_UIDS);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.settings.trees).toBe(join(dir, 'trees'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the environment file (#134)', () => {
  test('its values join the environment, and a name the host does not read is refused', () => {
    const merged = mergeEnvFile('host.env', 'FACTORY_LISTEN_PORT=7300\n# a comment\nFACTORY_REPOSITORY=C:\\Users\\me\\repo\n', { ANTHROPIC_API_KEY: 'k' });
    expect(merged).toEqual({ ok: true, env: { ANTHROPIC_API_KEY: 'k', FACTORY_LISTEN_PORT: '7300', FACTORY_REPOSITORY: 'C:\\Users\\me\\repo' } });
    const misspelt = mergeEnvFile('host.env', 'FACTORY_LISTEN_PROT=7300\n', {});
    expect(misspelt).toEqual({ ok: false, problems: ['host.env sets FACTORY_LISTEN_PROT, which the host does not read'] });
  });

  test('a name set in the file and the environment with different values is refused; the same value is not', () => {
    expect(mergeEnvFile('host.env', 'FACTORY_LISTEN_PORT=7300\n', { FACTORY_LISTEN_PORT: '8000' }).ok).toBe(false);
    expect(mergeEnvFile('host.env', 'FACTORY_LISTEN_PORT=7300\n', { FACTORY_LISTEN_PORT: '7300' }).ok).toBe(true);
    // An empty value is unset: a copied .env.example leaves the key to the environment.
    expect(mergeEnvFile('host.env', 'ANTHROPIC_API_KEY=\n', { ANTHROPIC_API_KEY: 'k' })).toEqual({ ok: true, env: { ANTHROPIC_API_KEY: 'k' } });
  });

  test('on a host with no uids, the container user joins the start-up list when unset', () => {
    const without = readHostConfig(FULL, { uids: false });
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.problems).toEqual([expect.stringContaining('FACTORY_CONTAINER_UID and FACTORY_CONTAINER_GID are not set')]);
    expect(readHostConfig({ ...FULL, FACTORY_CONTAINER_UID: '1000', FACTORY_CONTAINER_GID: '1000' }, { uids: false }).ok).toBe(true);
  });

  test('main.ts reads --env-file and prints one line once it listens, naming the address and the repository (#139)', async () => {
    const source = await readFile(MAIN, 'utf8');
    expect(source).toContain("flag !== '--env-file'");
    expect(source).toMatch(/await server\.listen\([^)]*\);\n\s*\} catch \(error\) \{\n\s*refuse\(\[listenProblem\(config\.listenHost, config\.port, error\)\]\);\n\s*\}\n[^\n]*\n\s*process\.stderr\.write\(`factory-host: listening on http:\/\/\$\{config\.listenHost\}:\$\{String\(config\.port\)\}, admitting runs from \$\{config\.repository\}/u);
  });

  test('a port that cannot be listened on is a refusal naming the port, not a stack trace', () => {
    const inUse = Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:7300'), { code: 'EADDRINUSE' });
    expect(listenProblem('127.0.0.1', 7300, inUse)).toBe(
      '127.0.0.1:7300 is already in use, perhaps by a host already running: stop it, or set FACTORY_LISTEN_PORT to another port',
    );
    expect(listenProblem('127.0.0.1', 7300, new Error('listen EACCES: permission denied'))).toBe(
      '127.0.0.1:7300 could not be listened on: listen EACCES: permission denied',
    );
  });
});
