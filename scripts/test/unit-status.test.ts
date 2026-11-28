/**
 * The unit status document (D-TOOLING-21): it is derived from the
 * decomposition and its own list of done units, and the committed file is
 * held to that derivation byte for byte.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { dependencyIds, parseDone, parseUnits, plainTitle, problemsOf, render, summary, waiting } from '../unit-status.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const DECOMPOSITION = [
  '| ID | Unit | Phase | Owner | Depends on | Size |',
  '|---|---|---|---|---|---|',
  '| F1 | Spine | 0 | maintainer | — | done |',
  '| P1 | Vault | 2 | contributor | F1 | 2–3 |',
  '| I1a | The real line | 3 | maintainer | F1–F1, P1 | 3 |',
  '| I1b | The proof | 3 | maintainer | I1a | 2 |',
  '',
  'Prose between the tables.',
  '',
  '| ID | Unit | Milestone | Depends on | Spec |',
  '|---|---|---|---|---|',
  '| R1 | Readiness ([#1](https://example.test/1)) (opens with a contract amendment) | M2 | P1, I1 | — |',
  '| R2 | Outcomes | M3 | R1 | — |',
  '',
  '| Some | Other | Table |',
  '|---|---|---|',
  '| R9 | not a unit row | x |',
].join('\n');

describe('unit-status', () => {
  test('every row of both unit tables is read, and no other table is', () => {
    const { units, problems } = parseUnits(DECOMPOSITION);
    expect(problems).toEqual([]);
    expect(units.map((unit) => `${unit.id} ${unit.milestone}`)).toEqual(['F1 M1', 'P1 M1', 'I1a M1', 'I1b M1', 'R1 M2', 'R2 M3']);
    expect(units.find((unit) => unit.id === 'R1')?.title).toBe('Readiness');
  });

  test('a title loses its issue list and its amendment note, and nothing else in parentheses', () => {
    expect(plainTitle('Sandbox (local Docker)')).toBe('Sandbox (local Docker)');
    expect(plainTitle('A ([#1](u), [#2](u) to [#3](u)) (opens with a contract amendment)')).toBe('A');
  });

  test('a range of dependencies is every unit in it', () => {
    expect(dependencyIds('P1–P3, R8a, I1')).toEqual(['P1', 'P2', 'P3', 'R8a', 'I1']);
    expect(dependencyIds('—')).toEqual([]);
  });

  test('a unit waits on each dependency that is not done, and a split unit\'s parent means both halves', () => {
    const { units } = parseUnits(DECOMPOSITION);
    const { on, problems } = waiting(units, new Set(['F1', 'P1', 'I1a']));
    expect(problems).toEqual([]);
    expect(on.get('I1b')).toEqual([]);
    expect(on.get('R1')).toEqual(['I1b']);
    expect(on.get('R2')).toEqual(['R1']);
  });

  test('a dependency or a done unit that no table names is a problem', () => {
    const { units } = parseUnits(`${DECOMPOSITION}\n\n| ID | Unit | Milestone | Depends on | Spec |\n|---|---|---|---|---|\n| R3 | Browser | M3 | R77 | — |`);
    expect(waiting(units, new Set(['Z9'])).problems).toEqual(['R3 depends on R77, which no table names', 'Z9 is marked done and no table names it']);
  });

  test('two rows for one unit, and a row with no id, are problems', () => {
    const twice = parseUnits(`${DECOMPOSITION}\n\n| ID | Unit | Milestone | Depends on | Spec |\n|---|---|---|---|---|\n| R1 | Again | M2 | — | — |\n| soon | Later | M2 | — | — |`);
    expect(twice.problems).toHaveLength(2);
    expect(twice.problems[0]).toBe('R1 has two rows');
  });

  test('what is written reads back as the same done units, and passes its own check', () => {
    const { units } = parseUnits(DECOMPOSITION);
    const done = new Set(['F1', 'P1']);
    const written = render(units, done);
    expect(parseDone(written)).toEqual(done);
    expect(problemsOf(DECOMPOSITION, written, null)).toEqual([]);
    expect(written).toContain('| P1 | Vault | M1 | F1 | done |');
    expect(written).toContain('| R1 | Readiness | M2 | P1, I1 | **open** |');
  });

  test('marking one unit done changes its row and no other line', () => {
    const { units } = parseUnits(DECOMPOSITION);
    const before = render(units, new Set(['F1'])).split('\n');
    const after = render(units, new Set(['F1', 'P1'])).split('\n');
    expect(after).toHaveLength(before.length);
    expect(after.filter((line, i) => line !== before[i])).toEqual(['| P1 | Vault | M1 | F1 | done |']);
  });

  test('the summary counts by milestone and separates the ready units from the waiting', () => {
    const { units } = parseUnits(DECOMPOSITION);
    expect(summary(units, new Set(['F1', 'P1']))).toEqual([
      '2 of 6 units done, 4 remaining.',
      '  M1: 2 of 4 done, 2 remaining',
      '  M2: 0 of 1 done, 1 remaining',
      '  M3: 0 of 1 done, 1 remaining',
      'Ready to start:',
      '  I1a  M1  The real line',
      'Waiting:',
      '  I1b  M1  The proof (on I1a)',
      '  R1  M2  Readiness (on I1a, I1b)',
      '  R2  M3  Outcomes (on R1)',
    ]);
  });

  test('a hand edit, a new unit, and a tagged unit not marked done each fail the check', () => {
    const { units } = parseUnits(DECOMPOSITION);
    const written = render(units, new Set(['F1']));
    expect(problemsOf(DECOMPOSITION, written.replace('| P1 | Vault |', '| P1 | The Vault |'), null)).toHaveLength(1);
    const grown = `${DECOMPOSITION}\n\n| ID | Unit | Milestone | Depends on | Spec |\n|---|---|---|---|---|\n| R3 | Browser | M3 | R1 | — |`;
    expect(problemsOf(grown, written, null)).toHaveLength(1);
    expect(problemsOf(DECOMPOSITION, written, ['F1', 'P1', 'TOOLING'])).toEqual([
      'P1 has the tag reviewed/P1 and is not marked done: run `node scripts/unit-status.ts write --done P1`',
    ]);
  });

  test('the committed STATUS.md is what the committed DECOMPOSITION.md derives', () => {
    const decomposition = readFileSync(join(ROOT, 'docs', 'plan', 'DECOMPOSITION.md'), 'utf8');
    const status = readFileSync(join(ROOT, 'docs', 'plan', 'STATUS.md'), 'utf8');
    expect(problemsOf(decomposition, status, null)).toEqual([]);
    expect(parseDone(status).size).toBeGreaterThan(0);
  });
});
