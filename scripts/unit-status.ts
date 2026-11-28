/**
 * Which units are done and which can start (D-TOOLING-21):
 *
 *     node scripts/unit-status.ts                      # print progress and the units ready to start
 *     node scripts/unit-status.ts write [--done <id>]  # regenerate docs/plan/STATUS.md
 *     node scripts/unit-status.ts check [--tags]       # fail when STATUS.md is not what `write` produces
 *
 * `docs/plan/DECOMPOSITION.md` names every unit and what it depends on.
 * `docs/plan/STATUS.md` records which of them are done, one row per unit. A
 * unit's own pull request marks it done with `write --done <id>`, so the
 * merge is what makes the row true on `v2`, and it changes that row alone.
 * The counts, and whether an open unit is ready (every dependency done) or
 * waiting, are printed by the bare command and never committed: a line that
 * counts units would be changed by every unit, and open branches would meet
 * on it.
 *
 * `check` regenerates the file from the two documents and compares bytes, so
 * a unit added to the decomposition, or a row edited by hand, fails until the
 * file is written again. `--tags` also reads the `reviewed/<id>` tags and
 * fails when a tagged unit is not marked done. It is one direction only: a
 * unit marked done with no tag is the unit whose pull request is open, or one
 * that shipped before the tags existed (F1, F2).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECOMPOSITION = join(ROOT, 'docs', 'plan', 'DECOMPOSITION.md');
const STATUS = join(ROOT, 'docs', 'plan', 'STATUS.md');

export interface Unit {
  readonly id: string;
  readonly title: string;
  /** `M1` for a unit of the first table, whose column is a phase; otherwise the milestone the row names. */
  readonly milestone: string;
  /** The ids the row's "Depends on" cell names, as written: a range is expanded, a split unit's parent is kept. */
  readonly dependsOn: readonly string[];
}

export interface Parsed {
  readonly units: readonly Unit[];
  readonly problems: readonly string[];
}

const UNIT_ID = /^[A-Z]\d+[ab]?$/u;

function cells(line: string): string[] {
  return line.split('|').slice(1, -1).map((cell) => cell.trim());
}

/** The title without what the decomposition adds for its own readers: the issues a unit closes, and the amendment note. */
export function plainTitle(title: string): string {
  return title
    .replace(/\s*\(opens with a contract amendment\)/u, '')
    .replace(/\s*\(\[#\d+\]\(.*\)\)$/u, '')
    .trim();
}

/** The ids one "Depends on" cell names. `P1–P14` is every P from 1 to 14. */
export function dependencyIds(cell: string): string[] {
  const expanded = cell.replace(/([A-Z])(\d+)\s*[–-]\s*\1(\d+)/gu, (_match, letter: string, from: string, to: string) => {
    const ids: string[] = [];
    for (let n = Number(from); n <= Number(to); n += 1) ids.push(`${letter}${String(n)}`);
    return ids.join(', ');
  });
  return [...expanded.matchAll(/\b[A-Z]\d+[ab]?\b/gu)].map((match) => match[0]);
}

/**
 * Every row of every unit table in the decomposition. A unit table is one
 * whose header starts `| ID | Unit |`; its other columns are found by name,
 * since the M1 table and the one after it differ.
 */
export function parseUnits(markdown: string): Parsed {
  const units: Unit[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  let header: string[] | null = null;
  for (const line of markdown.split(/\r?\n/u)) {
    if (!line.startsWith('|')) {
      header = null;
      continue;
    }
    const row = cells(line);
    if (row[0] === 'ID' && row[1] === 'Unit') {
      header = row;
      continue;
    }
    if (header === null || row.every((cell) => /^-+$/u.test(cell))) continue;
    const id = row[0] ?? '';
    if (!UNIT_ID.test(id)) {
      problems.push(`a unit table row names no unit id: ${line}`);
      continue;
    }
    if (seen.has(id)) {
      problems.push(`${id} has two rows`);
      continue;
    }
    seen.add(id);
    const stage = header.indexOf('Milestone');
    const depends = header.indexOf('Depends on');
    if (depends === -1 || (stage === -1 && !header.includes('Phase'))) {
      problems.push(`${id}: its table has no "Depends on" column, or neither "Milestone" nor "Phase"`);
      continue;
    }
    const milestone = stage === -1 ? 'M1' : row[stage] ?? '';
    if (!/^M\d+$/u.test(milestone)) problems.push(`${id}: "${milestone}" is not a milestone`);
    units.push({ id, title: plainTitle(row[1] ?? ''), milestone, dependsOn: dependencyIds(row[depends] ?? '') });
  }
  if (units.length === 0) problems.push('no unit table was found');
  return { units, problems };
}

/** The units a dependency stands for: itself, or both halves of a unit that was split (`I1` is `I1a` and `I1b`). */
function resolveDependency(id: string, ids: ReadonlySet<string>): string[] | null {
  if (ids.has(id)) return [id];
  const halves = ['a', 'b'].map((half) => `${id}${half}`).filter((half) => ids.has(half));
  return halves.length > 0 ? halves : null;
}

/** For each unit, the dependencies that are not done, and a problem for every dependency that names no unit. */
export function waiting(units: readonly Unit[], done: ReadonlySet<string>): { readonly on: ReadonlyMap<string, readonly string[]>; readonly problems: readonly string[] } {
  const ids = new Set(units.map((unit) => unit.id));
  const on = new Map<string, readonly string[]>();
  const problems: string[] = [];
  for (const unit of units) {
    const open: string[] = [];
    for (const dependency of unit.dependsOn) {
      const resolved = resolveDependency(dependency, ids);
      if (resolved === null) problems.push(`${unit.id} depends on ${dependency}, which no table names`);
      else open.push(...resolved.filter((id) => !done.has(id)));
    }
    on.set(unit.id, [...new Set(open)]);
  }
  for (const id of done) if (!ids.has(id)) problems.push(`${id} is marked done and no table names it`);
  return { on, problems };
}

/** The ids whose row in the status file ends `done`. Nothing else in the file is read back. */
export function parseDone(status: string): Set<string> {
  const done = new Set<string>();
  for (const line of status.split(/\r?\n/u)) {
    if (!line.startsWith('|')) continue;
    const row = cells(line);
    const id = row[0] ?? '';
    if (UNIT_ID.test(id) && row[row.length - 1] === 'done') done.add(id);
  }
  return done;
}

/**
 * One row per unit, in the decomposition's order, and nothing that counts
 * them. A unit's pull request changes its own row and no other line, so two
 * units open at once do not meet in this file unless their rows are
 * neighbours. The counts and the ready units are printed, never committed.
 */
export function render(units: readonly Unit[], done: ReadonlySet<string>): string {
  const lines: string[] = [
    '# Unit status',
    '',
    '<!-- Generated by `node scripts/unit-status.ts write`. Do not edit by hand: `check` compares every byte. -->',
    '',
    'Every unit in [DECOMPOSITION.md](DECOMPOSITION.md), and whether it is done. A unit is',
    '`done` when its pull request has merged into `v2`: the unit\'s own pull request',
    'changes its row, so the merge is what makes the row true. Every other unit is',
    '**open**, and can start once every unit it depends on is done. Work in flight is not',
    'recorded here: an open `unit/<id>` branch or pull request is where to see it.',
    '',
    'For the counts, and the open units that are ready to start:',
    '',
    '```',
    'node scripts/unit-status.ts',
    '```',
    '',
    '| ID | Unit | Milestone | Depends on | Status |',
    '|---|---|---|---|---|',
    ...units.map((unit) => `| ${unit.id} | ${unit.title} | ${unit.milestone} | ${unit.dependsOn.length === 0 ? '—' : unit.dependsOn.join(', ')} | ${done.has(unit.id) ? 'done' : '**open**'} |`),
    '',
  ];
  return lines.join('\n');
}

/** What the bare command prints: the counts by milestone, then each open unit, the ready ones first. */
export function summary(units: readonly Unit[], done: ReadonlySet<string>): string[] {
  const { on } = waiting(units, done);
  const open = units.filter((unit) => !done.has(unit.id));
  const blockers = (unit: Unit): readonly string[] => on.get(unit.id) ?? [];
  const lines = [`${String(units.length - open.length)} of ${String(units.length)} units done, ${String(open.length)} remaining.`];
  for (const milestone of [...new Set(units.map((unit) => unit.milestone))].sort()) {
    const total = units.filter((unit) => unit.milestone === milestone).length;
    const left = open.filter((unit) => unit.milestone === milestone).length;
    lines.push(`  ${milestone}: ${String(total - left)} of ${String(total)} done, ${String(left)} remaining`);
  }
  lines.push('Ready to start:');
  for (const unit of open) if (blockers(unit).length === 0) lines.push(`  ${unit.id}  ${unit.milestone}  ${unit.title}`);
  lines.push('Waiting:');
  for (const unit of open) if (blockers(unit).length > 0) lines.push(`  ${unit.id}  ${unit.milestone}  ${unit.title} (on ${blockers(unit).join(', ')})`);
  return lines;
}

/** Why the status file is not current, one line each; empty when it is. `tagged` is null when the tags were not read. */
export function problemsOf(decomposition: string, status: string, tagged: readonly string[] | null): string[] {
  const { units, problems } = parseUnits(decomposition);
  const done = parseDone(status);
  const all = [...problems, ...waiting(units, done).problems];
  if (all.length === 0 && render(units, done) !== status.replace(/\r\n/gu, '\n')) {
    all.push('docs/plan/STATUS.md is not what `node scripts/unit-status.ts write` produces from DECOMPOSITION.md: run it and commit the result');
  }
  const ids = new Set(units.map((unit) => unit.id));
  for (const id of tagged ?? []) {
    if (ids.has(id) && !done.has(id)) all.push(`${id} has the tag reviewed/${id} and is not marked done: run \`node scripts/unit-status.ts write --done ${id}\``);
  }
  return all;
}

function reviewedTags(): string[] {
  const listed = spawnSync('git', ['tag', '--list', 'reviewed/*'], { cwd: ROOT, encoding: 'utf8' });
  if (listed.status !== 0) throw new Error(`git tag --list failed: ${listed.stderr}`);
  return listed.stdout.split(/\r?\n/u).filter((line) => line !== '').map((line) => line.slice('reviewed/'.length));
}

function main(argv: readonly string[]): number {
  const [command, ...rest] = argv;
  const decomposition = readFileSync(DECOMPOSITION, 'utf8');
  if (command === 'check') {
    const unknown = rest.filter((arg) => arg !== '--tags');
    if (unknown.length > 0) {
      console.error(`unit-status check: unknown argument ${unknown.join(' ')}`);
      return 2;
    }
    const problems = problemsOf(decomposition, readFileSync(STATUS, 'utf8'), rest.includes('--tags') ? reviewedTags() : null);
    for (const problem of problems) console.error(problem);
    if (problems.length === 0) console.log('docs/plan/STATUS.md is current.');
    return problems.length === 0 ? 0 : 1;
  }
  const { units, problems } = parseUnits(decomposition);
  const done = parseDone(readFileSync(STATUS, 'utf8'));
  if (command === 'write') {
    for (let i = 0; i < rest.length; i += 2) {
      const id = rest[i + 1];
      if (rest[i] !== '--done' || id === undefined) {
        console.error('usage: node scripts/unit-status.ts write [--done <id>]...');
        return 2;
      }
      done.add(id);
    }
    const all = [...problems, ...waiting(units, done).problems];
    if (all.length > 0) {
      for (const problem of all) console.error(problem);
      return 1;
    }
    writeFileSync(STATUS, render(units, done));
    console.log(`wrote docs/plan/STATUS.md: ${String(done.size)} of ${String(units.length)} units done`);
    return 0;
  }
  if (command !== undefined) {
    console.error('usage: node scripts/unit-status.ts [write [--done <id>]... | check [--tags]]');
    return 2;
  }
  for (const line of summary(units, done)) console.log(line);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
