/**
 * The rubrics a person writes for the critics at `spec` and `test-design`
 * (R19). One Markdown file per drafting station, `spec.md` and
 * `test-design.md`, in a directory on the host beside policy and the roles,
 * which no sandbox mounts. Read at admission for each station the run drafts,
 * recorded in the Vault, and kept for the run: a rubric edited later changes
 * later runs, never this one.
 *
 * The rubric judges, so nothing proposes changes to it (R11 never does), and
 * it never enters a role: the role compiler takes no rubric (D-A-RC-05). It
 * reaches a critic as a granted context part and nowhere else.
 *
 * Every limit is a refusal naming the file (I5): one that is not a regular
 * file, is over the byte cap, is not UTF-8, or holds nothing.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DraftStation } from '@olympus-ai/core';
import type { RequestProblem } from './validate.js';
import { within } from './workspace.js';

/** The rubrics shipped with the runtime, a starting point a person edits, as `DEFAULT_ROLES_DIRECTORY` is for roles. */
export const DEFAULT_RUBRICS_DIRECTORY: string = fileURLToPath(new URL('../rubrics/', import.meta.url));

/** The most bytes a rubric may hold, as a role may (D-R20-03): it reaches a critic in its prompt. */
export const RUBRIC_MAX_BYTES = 32 * 1024;

export interface ReadRubric {
  readonly text: string;
  readonly sha256: string;
}

function problem(station: DraftStation, message: string): RequestProblem {
  return { path: `rubrics.${station}`, code: 'unseated', message };
}

/** Each drafting station's rubric, read from the bytes on disk and hashed, or every problem found. */
export async function readRubrics(
  directory: string, stations: readonly DraftStation[],
): Promise<{ ok: true; rubrics: Partial<Record<DraftStation, ReadRubric>> } | { ok: false; problems: RequestProblem[] }> {
  const problems: RequestProblem[] = [];
  const rubrics: Partial<Record<DraftStation, ReadRubric>> = {};
  for (const station of stations) {
    const file = join(directory, `${station}.md`);
    const facts = await lstat(file).catch(() => null);
    if (facts === null) {
      problems.push(problem(station, `the rubrics directory holds no ${station}.md, and a ${station} critic is never seated without the rubric a person wrote`));
      continue;
    }
    if (!facts.isFile()) {
      problems.push(problem(station, `${station}.md is not a regular file`));
      continue;
    }
    if (facts.size > RUBRIC_MAX_BYTES) {
      problems.push(problem(station, `${station}.md is ${String(facts.size)} bytes, over the ${String(RUBRIC_MAX_BYTES)} a rubric may hold`));
      continue;
    }
    const bytes = await readFile(file);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      problems.push(problem(station, `${station}.md is not UTF-8`));
      continue;
    }
    if (text.trim() === '') {
      problems.push(problem(station, `${station}.md holds no rubric`));
      continue;
    }
    rubrics[station] = { text, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return problems.length === 0 ? { ok: true, rubrics } : { ok: false, problems };
}

async function resolved(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/**
 * The rubrics directory may lie inside neither the workspace nor the
 * workspace store, nor hold either, compared with every link resolved: a
 * rubric a drafter could reach is one it could rewrite to judge itself by
 * (I3), as a role there is one an agent could rewrite (D-R20-04).
 */
export async function rubricsProblems(directory: unknown, places: ReadonlyArray<readonly [string, string]>): Promise<RequestProblem[]> {
  if (typeof directory !== 'string' || directory === '' || !isAbsolute(directory)) {
    return [{ path: 'rubrics', code: 'not-absolute', message: 'rubrics must be the absolute path of the rubrics directory' }];
  }
  const rubrics = await resolved(directory);
  for (const [name, place] of places) {
    const outer = await resolved(place);
    if (within(outer, rubrics) || within(rubrics, outer)) {
      return [{ path: 'rubrics', code: 'overlaps', message: `the rubrics directory ${directory} and the ${name} ${place} overlap; rubrics are read from the host, outside every tree a sandbox mounts` }];
    }
  }
  return [];
}
