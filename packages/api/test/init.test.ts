/**
 * `init`'s parts (R36b). What it writes is copied from the shipped examples,
 * which R36a's tests admit, so the copies are held equal to them here; the
 * whole of `init` against admission is the conformance suite's.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { PYPI_REGISTRIES } from '@olympus-ai/adapters';
import { DEFAULT_RUBRICS_DIRECTORY } from '../src/rubrics.js';
import { githubRepository, INIT_GRAPH, SETUP_DIRECTORY, stackManifest, stackPolicy } from '../src/init.js';
import { parseGraph, parseManifest } from '../src/index.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples');

async function sameDirectory(a: string, b: string): Promise<void> {
  const files = (await readdir(a)).sort();
  expect(files).toEqual((await readdir(b)).sort());
  for (const f of files) expect(await readFile(join(a, f), 'utf8'), f).toBe(await readFile(join(b, f), 'utf8'));
}

describe('what init copies', () => {
  test('the policy, the roles, and the rubrics are the shipped examples, byte for byte', async () => {
    expect(await readFile(join(SETUP_DIRECTORY, 'policy.yaml'), 'utf8')).toBe(await readFile(join(EXAMPLES, 'policy.yaml'), 'utf8'));
    await sameDirectory(join(SETUP_DIRECTORY, 'roles'), join(EXAMPLES, 'roles'));
    await sameDirectory(DEFAULT_RUBRICS_DIRECTORY, join(EXAMPLES, 'rubrics'));
  });

  test('a Python stack gets the Python registries and protects pyproject.toml; Node.js gets the policy unchanged', async () => {
    const shipped = await readFile(join(SETUP_DIRECTORY, 'policy.yaml'), 'utf8');
    expect(stackPolicy(shipped, 'node')).toBe(shipped);
    const python = stackPolicy(shipped, 'python');
    expect(python).toContain(`installRegistries: [${PYPI_REGISTRIES.join(', ')}]`);
    expect(python).toContain('  - "pyproject.toml"');
    expect(python).not.toContain('installRegistries: [registry.npmjs.org]');
  });
});

describe('the run files init writes', () => {
  test('the manifest parses beside drafted tests, and the graph is one build task and its review', () => {
    for (const language of ['node', 'python'] as const) {
      const parsed = parseManifest(stackManifest(language), { alone: false });
      expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
    }
    // Alone, it has nothing failing on the base: drafted tests supply that.
    expect(parseManifest(stackManifest('node')).ok).toBe(false);
    expect(INIT_GRAPH.tasks.map((t) => t.station)).toEqual(['build', 'review']);
    const graph = parseGraph(JSON.parse(JSON.stringify(INIT_GRAPH)), { runId: 'r' as never, baseCommit: 'a'.repeat(40), workspace: '/w' });
    expect(graph.ok, JSON.stringify(graph)).toBe(true);
  });
});

describe('the merge target', () => {
  test('is read from a GitHub remote, https or ssh, and nothing else', () => {
    expect(githubRepository('https://github.com/mikev10/my-recipes.git')).toBe('mikev10/my-recipes');
    expect(githubRepository('git@github.com:owner/name.git')).toBe('owner/name');
    expect(githubRepository('ssh://git@github.com/owner/name')).toBe('owner/name');
    expect(githubRepository('https://gitlab.com/owner/name.git')).toBeNull();
    expect(githubRepository('https://github.com/owner')).toBeNull();
  });
});
