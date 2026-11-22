/**
 * Where the runtime tells a drafter to write (#151, R36b, D-R36b-11). A test
 * draft is read from two places: the manifest under `.drafts/<run>/`, and
 * the test files under the locked spec's `testDirectory` from the tree's
 * root. A line naming only the first sent a real drafter's tests under
 * `.drafts/` on all three attempts, where they were discarded.
 */
import { describe, expect, test } from 'vitest';
import type { RunId } from '@olympus-ai/core';
import { draftDestination } from '../src/drafting.js';
import type { RunRequirements } from '../src/spec-parts.js';

const run = { id: 'r1' as RunId } as never;
const requirements = { testDirectory: 'src/lib', framework: 'vitest' } as unknown as RunRequirements;

describe('the draft destination line', () => {
  test('at test-design it names the manifest under .drafts and the tests under the test directory from the root', () => {
    const line = draftDestination({ run, drafting: { defect: null } as never, requirements }, 'test-design');
    expect(line).toContain('.drafts/r1/acceptance.json');
    expect(line).toContain('src/lib/');
    expect(line).toMatch(/root of your working directory/u);
    expect(line).toMatch(/not under \.drafts/u);
  });

  test('at spec it names every spec file under .drafts', () => {
    const line = draftDestination({ run, drafting: { defect: null } as never, requirements: null }, 'spec');
    expect(line).toContain('.drafts/r1/spec.md');
    expect(line).not.toMatch(/test directory/u);
  });
});
