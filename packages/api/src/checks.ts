/**
 * The provider adapter R8b reads check runs through (D-A-OB-09): GitHub's
 * `GET /repos/{owner}/{repo}/commits/{sha}/check-runs`, host-side, beside
 * `GitHubIntegrator` and never in a sandbox. It takes its own read-only token,
 * never the integrator's merge token (I4, D-A-OB-14). Whatever it cannot read
 * whole, it throws on: a 401, 403, or 404, a timeout, a page that does not add
 * up to the total, or a run on another commit. The walk records that as a
 * refusal and leaves the window open, never as a missing check (I5).
 */
import type { CheckReader, CheckRun } from './observation-plan.js';

export interface GitHubCheckReaderOptions {
  /** `owner/name`. */
  readonly repository: string;
  /** A token that can read the repository's check runs, and nothing it needs to write. */
  readonly token: string;
  /** Defaults to `https://api.github.com`. */
  readonly apiBase?: string;
  /** Per request. Defaults to 30 s. */
  readonly timeoutMs?: number;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const PER_PAGE = 100;
/** A commit with more check runs than this is not read in part: it is refused (I5). */
const MAX_PAGES = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One check run from the provider's body, or a throw: a run missing a field is never read as a run without it. */
function checkRunOf(value: unknown, commit: string): CheckRun {
  if (!isObject(value)) throw new Error('checks: GitHub listed a check run that is not an object');
  const { id, name, head_sha: headSha, status, conclusion, completed_at: completedAt, app } = value;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) throw new Error('checks: GitHub listed a check run with no id');
  if (typeof name !== 'string' || typeof status !== 'string') throw new Error(`checks: check run ${String(id)} has no name or status`);
  if (headSha !== commit) throw new Error(`checks: check run ${String(id)} is on another commit than ${commit}`);
  if (conclusion !== null && typeof conclusion !== 'string') throw new Error(`checks: check run ${String(id)} has a conclusion that is not text`);
  if (completedAt !== null && (typeof completedAt !== 'string' || Number.isNaN(Date.parse(completedAt)))) throw new Error(`checks: check run ${String(id)} has a completion time that is not a time`);
  const slug = isObject(app) && typeof app.slug === 'string' ? app.slug : null;
  return { id: String(id), app: slug, name, headSha, status, conclusion, completedAt: completedAt === null ? null : new Date(completedAt).toISOString() };
}

export class GitHubCheckReader implements CheckReader {
  readonly repository: string;
  readonly #token: string;
  readonly #api: string;
  readonly #timeoutMs: number;

  constructor(options: GitHubCheckReaderOptions) {
    if (!REPOSITORY.test(options.repository)) throw new Error(`checks: ${options.repository} is not owner/name`);
    if (options.token === '') throw new Error('checks: no token');
    this.repository = options.repository;
    this.#token = options.token;
    this.#api = (options.apiBase ?? 'https://api.github.com').replace(/\/+$/u, '');
    this.#timeoutMs = options.timeoutMs ?? 30_000;
  }

  async checkRuns(commit: string): Promise<readonly CheckRun[]> {
    if (!COMMIT.test(commit)) throw new Error(`checks: ${commit} is not a commit`);
    const runs: CheckRun[] = [];
    let total: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const body = await this.#get(`/commits/${commit}/check-runs?filter=all&per_page=${String(PER_PAGE)}&page=${String(page)}`);
      if (!isObject(body) || typeof body.total_count !== 'number' || !Number.isSafeInteger(body.total_count) || !Array.isArray(body.check_runs)) {
        throw new Error(`checks: GitHub's list of check runs on ${commit} is not one`);
      }
      // A total that moves between pages is a list read in part; it is read again next walk, never used (I5).
      if (total !== null && body.total_count !== total) throw new Error(`checks: the check runs on ${commit} changed while they were read`);
      total = body.total_count;
      for (const run of body.check_runs as readonly unknown[]) runs.push(checkRunOf(run, commit));
      if (runs.length >= total || body.check_runs.length === 0) break;
    }
    if (total === null || runs.length !== total) throw new Error(`checks: GitHub reported ${String(total)} check runs on ${commit} and ${String(runs.length)} were read`);
    if (new Set(runs.map((r) => r.id)).size !== runs.length) throw new Error(`checks: GitHub listed one check run on ${commit} twice`);
    return runs;
  }

  async #get(path: string): Promise<unknown> {
    const response = await fetch(`${this.#api}/repos/${this.repository}${path}`, {
      headers: { authorization: `Bearer ${this.#token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const text = await response.text();
    // The status alone: a body is the provider's text, and the token never appears in what is thrown.
    if (!response.ok) throw new Error(`checks: GitHub answered ${path.split('?')[0] ?? path} with ${String(response.status)}`);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`checks: GitHub's answer to ${path.split('?')[0] ?? path} is not JSON`);
    }
  }
}
