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
import { checkStartup, HOST_VARIABLES, readHostConfig, refusalText } from '../src/host/config.js';
import { probeSymlinks } from '../src/host/symlinks.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MAIN = join(ROOT, 'packages', 'api', 'src', 'host', 'main.ts');

/** How a table entry is written in the docs: a prefix family as `NAME*`. */
const documented = (v: (typeof HOST_VARIABLES)[number]): string => (v.prefix === true ? `${v.name}*` : v.name);

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
    const result = readHostConfig(env);
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
    expect(source).toContain('checkStartup(process.env)');
  });

  test('a webhook secret is read only under the webhook prefix', () => {
    const result = readHostConfig({ ...FULL, FACTORY_WEBHOOK_GITHUB: 's' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.webhookSecret('FACTORY_WEBHOOK_GITHUB')).toBe('s');
    expect(result.settings.webhookSecret('ANTHROPIC_API_KEY')).toBeUndefined();
  });
});

describe('start-up refusal (I5)', () => {
  test('an empty environment is refused with every required variable in one list', () => {
    const result = readHostConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const required = HOST_VARIABLES.filter((v) => v.required).map((v) => v.name);
    expect(result.problems).toHaveLength(required.length);
    for (const name of required) expect(result.problems.some((p) => p.startsWith(`${name} is not set`))).toBe(true);
  });

  test('invalid values are listed beside missing ones, not one at a time', () => {
    const { FACTORY_GIT_TOKEN: _token, ...rest } = FULL;
    const result = readHostConfig({ ...rest, FACTORY_LISTEN_PORT: 'eighty', FACTORY_CONTAINER_UID: '1000', FACTORY_CODEX_SEATS: 'reviewer', FACTORY_ENDPOINT_KEY: 'k' });
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
    const result = readHostConfig({ FACTORY_API_TOKEN: 'secret-token-value' });
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
      });
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
      const result = await checkStartup({ ...FULL, FACTORY_TREES: join(dir, 'trees') });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.settings.trees).toBe(join(dir, 'trees'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
