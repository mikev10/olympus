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
  // The drafted manifest is held to a manifest's shape and the retry is told only codes, so the
  // role is the one place the drafter learns every field; its example must be one the runtime accepts.
  test("the test drafter's example acceptance.json is a manifest the runtime accepts", async () => {
    const role = await readFile(join(SETUP_DIRECTORY, 'roles', 'test-drafter.md'), 'utf8');
    const block = /```json\n([\s\S]*?)```/u.exec(role);
    expect(block, 'the role shows an acceptance.json').not.toBeNull();
    const parsed = parseManifest(JSON.parse(block?.[1] ?? ''), { alone: false });
    expect(parsed).toMatchObject({ ok: true });
    for (const field of ['id', 'kind', 'required', 'onBase', 'timeoutMs', 'tests']) expect(role, field).toContain(`\`${field}\``);
    // Tests are read from the test directory at the tree's root; one written under `.drafts/` is discarded (D-R36b-11).
    expect(role).toMatch(/root of your working directory, not under `\.drafts\/`/u);
    const example = JSON.parse(block?.[1] ?? '') as { checks: Array<{ tests?: string[] }> };
    expect(example.checks[0]?.tests?.[0]).not.toMatch(/^\.drafts\//u);
  });

  test('the policy, the roles, and the rubrics are the shipped examples, byte for byte', async () => {
    expect(await readFile(join(SETUP_DIRECTORY, 'policy.yaml'), 'utf8')).toBe(await readFile(join(EXAMPLES, 'policy.yaml'), 'utf8'));
    await sameDirectory(join(SETUP_DIRECTORY, 'roles'), join(EXAMPLES, 'roles'));
    await sameDirectory(DEFAULT_RUBRICS_DIRECTORY, join(EXAMPLES, 'rubrics'));
  });

  // A real build spent its 200,000 tokens reading the repository before it wrote anything (#192,
  // D-R36b-12): every seat that reads the repository is bound by its dollars, not its tokens.
  test('every seat that reads the repository has a token budget its dollar budget binds before', async () => {
    const policy = await readFile(join(SETUP_DIRECTORY, 'policy.yaml'), 'utf8');
    for (const seat of ['builder', 'reviewer', 'spec-drafter', 'test-drafter']) {
      const block = new RegExp(`\\n  ${seat}:\\n[\\s\\S]*?budget: \\{ maxTokens: (\\d+), maxCostUsd: ([\\d.]+)`, 'u').exec(policy);
      expect(block, seat).not.toBeNull();
      expect(Number(block?.[1]), seat).toBeGreaterThanOrEqual(1_000_000);
    }
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
