/**
 * What a checkout can prove before CI does (D-TOOLING-13, #197), in two sizes:
 *
 *     node scripts/local-check.ts preflight [--base <ref>] [<registry id> ...]
 *     node scripts/local-check.ts full
 *
 * `preflight` is minutes: typecheck, lint, the tests of every package the
 * branch changed, and the named registry entries, stopping at the first
 * failure. Run it after every change, and before `full`.
 *
 * `full` is the acceptance run: every package's tests, each run on its own so
 * one failing package cannot keep another from running, then the conformance
 * package last, as CI orders it (D-R6-08). Run it once, on code `preflight`
 * passed.
 *
 * Some registry entries cannot pass in a checkout: they reconcile against a
 * report only CI's paid suites write (D-A-CI-07). This script names those as
 * NOT RUN HERE and never as passed. Its exit status says that nothing else
 * failed; whether those entries hold is CI's answer alone. It reads the
 * registry's own output and changes nothing the registry decides.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The registry's id for the check that reconciles an external entry against its package's report. */
export const RECONCILIATION_ID = 'I8.external-assertion-execution-reconciled';

/** The static scan every preflight runs: it reads the whole tree, so any change can fail it. */
export const ALWAYS_IDS: readonly string[] = ['I10.no-greek-names-in-code'];

const CONFORMANCE = '@olympus-ai/conformance';
const API = '@olympus-ai/api';

/**
 * The drivers whose full suites call a model. Locally each runs only the
 * files CI runs without the paid label (`.github/workflows/ci.yml`).
 */
export const PAID_DRIVERS: Readonly<Record<string, readonly string[]>> = {
  '@olympus-ai/driver-claude-code': ['test/driver.test.ts'],
  '@olympus-ai/driver-codex': ['test/driver.test.ts', 'test/claims.test.ts'],
};

/** Whether an external entry's report is written only by a paid suite. */
export function isPaid(pkg: string, file: string): boolean {
  return pkg in PAID_DRIVERS || (pkg === API && file.startsWith('test/paid/'));
}

export interface TestOutcome {
  /** The test file, as the reporter names it. */
  readonly file: string;
  /** The test's own title, without its describe blocks. */
  readonly title: string;
  readonly status: string;
}

export interface Verdict {
  /** Failures that are defects here: anything not explained by a missing paid report. */
  readonly failed: string[];
  /** Entries only CI can run, by id. Not passes. */
  readonly notRunHere: string[];
  /** The registry's two aggregate tests, failed for the entries above and nothing else. */
  readonly aggregates: string[];
}

const EXTERNAL_TITLE = /^\[([^\]\s]+)\] [\s\S]* \(external: (\S+) (\S+)\)$/u;
const META_TITLES = ['no entry is missing, no record is malformed, and no pending count exceeds its baseline'];
const META_ID = '[I8.registry-complete]';

function isAggregate(outcome: TestOutcome): boolean {
  return outcome.file.replaceAll('\\', '/').endsWith('test/registry.test.ts')
    && (META_TITLES.includes(outcome.title) || outcome.title.startsWith(`${META_ID} `));
}

/**
 * The registry report's problem lines, read from what the run printed. An
 * absent section is an empty list, which `classify` treats as unexplained.
 */
export function problemLines(output: string): string[] {
  // eslint-disable-next-line no-control-regex -- the escape character is what a colour code starts with
  const lines = output.replace(/\u001b\[[0-9;]*m/gu, '').split(/\r?\n/u);
  const start = lines.lastIndexOf('Problems');
  if (start === -1) return [];
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('  ')) break;
    out.push(line.slice(2));
  }
  return out;
}

/**
 * Sorts a conformance run's failures. A failure is NOT RUN HERE only when it
 * is an external entry whose report a paid suite writes. An aggregate test is
 * excused only when every problem line the registry printed is about such an
 * entry, or is a claim left `missing` by one. Everything else is a failure,
 * and so is anything this cannot read.
 */
export function classify(outcomes: readonly TestOutcome[], problems: readonly string[]): Verdict {
  const paidIds = new Set<string>();
  for (const outcome of outcomes) {
    const m = EXTERNAL_TITLE.exec(outcome.title);
    if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined && isPaid(m[2], m[3])) paidIds.add(m[1]);
  }
  const idOf = (line: string): string => line.slice(0, Math.max(0, line.indexOf(': ')));
  const reconciled = (line: string): boolean => paidIds.has(idOf(line)) && line.includes(`(${RECONCILIATION_ID}`);
  const excusedClaims = new Set(problems.filter(reconciled).map(idOf));
  const missing = (line: string): boolean => {
    const m = /^(\S+): missing \(no assertion and no pending owner\)$/u.exec(line);
    const claim = m?.[1];
    return claim !== undefined && [...excusedClaims].some((id) => id === claim || id.startsWith(`${claim}.`));
  };
  const unexplained = problems.filter((line) => !reconciled(line) && !missing(line));

  const verdict: Verdict = { failed: [], notRunHere: [], aggregates: [] };
  for (const outcome of outcomes) {
    if (outcome.status !== 'failed') continue;
    const m = EXTERNAL_TITLE.exec(outcome.title);
    if (m?.[1] !== undefined && paidIds.has(m[1])) verdict.notRunHere.push(m[1]);
    else if (isAggregate(outcome) && problems.length > 0 && unexplained.length === 0) verdict.aggregates.push(outcome.title);
    else verdict.failed.push(`${outcome.file}: ${outcome.title}`);
  }
  // A problem line with no excuse is a failure even if no test carried it.
  for (const line of unexplained) verdict.failed.push(`registry problem: ${line}`);
  // An aggregate can only be excused by entries that were in fact not run.
  if (verdict.aggregates.length > 0 && verdict.notRunHere.length === 0) {
    verdict.failed.push(...verdict.aggregates.splice(0).map((title) => `test/registry.test.ts: ${title}`));
  }
  return verdict;
}

/** The outcomes in a vitest JSON report. Anything not shaped like one throws: an unreadable report is not a pass. */
export function outcomesOf(report: unknown): TestOutcome[] {
  const files = (report as { testResults?: unknown } | null)?.testResults;
  if (!Array.isArray(files)) throw new Error('local-check: the test report has no testResults list');
  const out: TestOutcome[] = [];
  for (const entry of files as unknown[]) {
    const { name, status, assertionResults } = entry as { name?: unknown; status?: unknown; assertionResults?: unknown };
    if (typeof name !== 'string' || !Array.isArray(assertionResults)) throw new Error('local-check: a test file in the report is malformed');
    let failedTests = 0;
    for (const result of assertionResults as unknown[]) {
      const { title, status: testStatus } = result as { title?: unknown; status?: unknown };
      if (typeof title !== 'string' || typeof testStatus !== 'string') throw new Error(`local-check: a test in ${name} is malformed`);
      if (testStatus === 'failed') failedTests += 1;
      out.push({ file: name, title, status: testStatus });
    }
    // A file that failed with no failed test failed outside one: a broken import, a thrown hook.
    if (status === 'failed' && failedTests === 0) out.push({ file: name, title: '(the file failed outside any test)', status: 'failed' });
  }
  return out;
}

/** A registry id as this script accepts one: what the registry uses, and nothing a pattern could misread. */
export function isRegistryId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9-]+)+$/u.test(id);
}

/** The `-t` pattern that selects exactly the named entries, each by its bracketed id. */
export function idPattern(ids: readonly string[]): string {
  return `\\[(${ids.map((id) => id.replaceAll('.', '\\.')).join('|')})\\]`;
}

/** The named ids no passed test carried: an id that selected nothing must not read as checked. */
export function unproven(ids: readonly string[], outcomes: readonly TestOutcome[]): string[] {
  return ids.filter((id) => !outcomes.some((o) => o.status === 'passed' && o.title.startsWith(`[${id}] `)));
}

export interface WorkspacePackage {
  readonly name: string;
  /** Relative to the repository root, with forward slashes. */
  readonly dir: string;
}

/** Every workspace package with a `test` script. */
export function testedPackages(root: string = ROOT): WorkspacePackage[] {
  const out: WorkspacePackage[] = [];
  for (const parent of ['packages', 'packages/drivers']) {
    for (const entry of readdirSync(join(root, parent), { withFileTypes: true })) {
      const file = join(root, parent, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; scripts?: Record<string, unknown> };
      if (typeof pkg.name === 'string' && typeof pkg.scripts?.test === 'string') out.push({ name: pkg.name, dir: `${parent}/${entry.name}` });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The packages a list of changed paths touches, longest directory first so a driver is not read as `packages/drivers`. */
export function changedPackages(paths: readonly string[], packages: readonly WorkspacePackage[]): WorkspacePackage[] {
  const byDepth = [...packages].sort((a, b) => b.dir.length - a.dir.length);
  const hit = new Set<string>();
  for (const path of paths) {
    const owner = byDepth.find((pkg) => path.replaceAll('\\', '/').startsWith(`${pkg.dir}/`));
    if (owner !== undefined) hit.add(owner.name);
  }
  return packages.filter((pkg) => hit.has(pkg.name));
}

interface Ran {
  readonly status: number;
  readonly output: string;
}

/** Characters cmd.exe gives a meaning; an argument holding one is refused, as `local-release.ts` refuses it. */
const CMD_META = /["%^&|<>!\r\n]/u;

/**
 * Runs a command with its output shown as it arrives and kept. `pnpm` is a
 * .cmd shim on Windows, which only a shell starts; `node` and `git` are
 * started directly everywhere, so their arguments are never interpreted.
 */
function run(command: 'pnpm' | 'node' | 'git', args: readonly string[], cwd: string = ROOT, quiet = false): Promise<Ran> {
  return new Promise((done, fail) => {
    const viaShell = command === 'pnpm' && process.platform === 'win32';
    if (viaShell) {
      const bad = args.find((a) => CMD_META.test(a));
      if (bad !== undefined) { fail(new Error(`local-check: ${JSON.stringify(bad)} holds a character the Windows shell interprets`)); return; }
    }
    const child = viaShell
      ? spawn([command, ...args.map((a) => `"${a}"`)].join(' '), { cwd, shell: true })
      : spawn(command === 'node' ? process.execPath : command, [...args], { cwd });
    let output = '';
    const take = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (!quiet) process.stdout.write(chunk);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', fail);
    child.on('close', (code) => { done({ status: code ?? 1, output }); });
  });
}

interface StepResult {
  readonly ok: boolean;
  readonly note?: string | undefined;
}

interface Step {
  readonly name: string;
  readonly ok: boolean;
  readonly seconds: number;
  readonly note?: string | undefined;
}

async function step(steps: Step[], name: string, work: () => Promise<StepResult>): Promise<boolean> {
  process.stdout.write(`\n=== ${name} ===\n`);
  const started = Date.now();
  let result: StepResult;
  try {
    result = await work();
  } catch (error) {
    result = { ok: false, note: error instanceof Error ? error.message : String(error) };
  }
  steps.push({ name, seconds: Math.round((Date.now() - started) / 1000), ...result });
  return result.ok;
}

const command = (args: readonly string[]) => async (): Promise<StepResult> => ({ ok: (await run('pnpm', args)).status === 0 });

/** One package's tests: the whole suite, or for a paid driver the files that call no model. */
function packageTests(pkg: WorkspacePackage): () => Promise<StepResult> {
  const files = PAID_DRIVERS[pkg.name];
  if (files === undefined) return command(['--filter', pkg.name, 'test']);
  return async () => ({
    ok: (await run('pnpm', ['--filter', pkg.name, 'exec', 'vitest', 'run', ...files])).status === 0,
    note: 'only the files that call no model; the paid suite runs in CI',
  });
}

/** Runs vitest in the conformance package directly, so a `-t` pattern reaches it as written, and reads its JSON report. */
async function conformance(args: readonly string[]): Promise<{ status: number; outcomes: TestOutcome[]; problems: string[] }> {
  const cwd = join(ROOT, 'packages', 'conformance');
  const scratch = mkdtempSync(join(tmpdir(), 'local-check-'));
  try {
    const report = join(scratch, 'report.json');
    const ran = await run('node', [join(cwd, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...args, '--reporter=default', '--reporter=json', `--outputFile.json=${report}`], cwd);
    if (!existsSync(report)) throw new Error(`local-check: the conformance run wrote no report (exit ${String(ran.status)})`);
    return { status: ran.status, outcomes: outcomesOf(JSON.parse(readFileSync(report, 'utf8'))), problems: problemLines(ran.output) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function describeVerdict(verdict: Verdict): string | undefined {
  if (verdict.failed.length > 0) return `${String(verdict.failed.length)} failure(s):\n${verdict.failed.map((f) => `      ${f}`).join('\n')}`;
  if (verdict.notRunHere.length === 0) return undefined;
  return `NOT RUN HERE, and not passed: ${String(verdict.notRunHere.length)} entries that need CI's paid suites${verdict.aggregates.length === 0 ? '' : `, and ${String(verdict.aggregates.length)} aggregate test(s) failing for them alone`}.
      ${verdict.notRunHere.join(' ')}`;
}

async function git(args: readonly string[]): Promise<string[]> {
  const ran = await run('git', args, ROOT, true);
  if (ran.status !== 0) throw new Error(`local-check: git ${args.join(' ')} exited ${String(ran.status)}\n${ran.output}`);
  return ran.output.split(/\r?\n/u).filter((line) => line !== '');
}

async function staticSteps(steps: Step[], tooling: boolean): Promise<boolean> {
  if (!(await step(steps, 'nothing under .plan/ is tracked', async () => ({ ok: (await git(['ls-files', '--', '.plan/'])).length === 0 })))) return false;
  if (!(await step(steps, 'typecheck', command(['typecheck'])))) return false;
  if (!(await step(steps, 'lint', command(['lint'])))) return false;
  if (!tooling) return true;
  if (!(await step(steps, 'typecheck tooling', command(['typecheck:tooling'])))) return false;
  return step(steps, 'test tooling', command(['test:tooling']));
}

async function preflight(base: string, ids: readonly string[], steps: Step[]): Promise<void> {
  const mergeBase = (await git(['merge-base', 'HEAD', base]))[0];
  if (mergeBase === undefined) throw new Error(`local-check: no merge base with ${base}`);
  const paths = [...(await git(['diff', '--name-only', mergeBase])), ...(await git(['ls-files', '--others', '--exclude-standard']))];
  const touched = changedPackages(paths, testedPackages());
  const gate = touched.some((pkg) => pkg.name === CONFORMANCE);
  if (!(await staticSteps(steps, paths.some((p) => p.startsWith('scripts/'))))) return;
  for (const pkg of touched) {
    if (pkg.name === CONFORMANCE) continue;
    if (!(await step(steps, `tests: ${pkg.name}`, packageTests(pkg)))) return;
  }
  const wanted = [...new Set([...ALWAYS_IDS, ...ids])];
  await step(steps, `registry: ${wanted.join(', ')}`, async () => {
    const ran = await conformance(['test/registry.test.ts', '-t', idPattern(wanted)]);
    // Only the named entries are judged: the registry's problem list covers packages this run did not test.
    const verdict = classify(ran.outcomes, []);
    const absent = unproven(wanted, ran.outcomes).filter((id) => !verdict.notRunHere.includes(id));
    if (absent.length > 0) return { ok: false, note: `no passed test carried: ${absent.join(', ')}` };
    return { ok: verdict.failed.length === 0, note: describeVerdict(verdict) };
  });
  if (gate && ids.length === 0) process.stdout.write('\nnote: packages/conformance changed and no registry id was named; name the entries the change touches.\n');
}

async function full(steps: Step[]): Promise<void> {
  if (!(await staticSteps(steps, true))) return;
  // No early return from here on: one failing package must not keep another from running.
  for (const pkg of testedPackages()) {
    if (pkg.name !== CONFORMANCE) await step(steps, `tests: ${pkg.name}`, packageTests(pkg));
  }
  // Last, as in CI: its registry reads the reports the runs above wrote (D-R6-08).
  await step(steps, `tests: ${CONFORMANCE}`, async () => {
    const ran = await conformance([]);
    const verdict = classify(ran.outcomes, ran.problems);
    if (ran.status !== 0 && verdict.failed.length === 0 && verdict.notRunHere.length === 0) return { ok: false, note: `vitest exited ${String(ran.status)} with no failed test in its report` };
    return { ok: verdict.failed.length === 0, note: describeVerdict(verdict) };
  });
}

function summary(mode: string, steps: readonly Step[]): boolean {
  const ok = steps.length > 0 && steps.every((s) => s.ok);
  process.stdout.write(`\n=== local-check ${mode}: ${ok ? 'nothing failed here' : 'FAILED'} ===\n`);
  for (const s of steps) {
    process.stdout.write(`  ${s.ok ? 'ok  ' : 'FAIL'} ${s.name} (${String(s.seconds)}s)\n`);
    if (s.note !== undefined) process.stdout.write(`      ${s.note}\n`);
  }
  if (ok && mode === 'preflight') process.stdout.write('\nThis is not the acceptance run: `node scripts/local-check.ts full` is.\n');
  return ok;
}

const USAGE = 'usage: node scripts/local-check.ts preflight [--base <ref>] [<registry id> ...]\n       node scripts/local-check.ts full\n';

async function main(argv: readonly string[]): Promise<number> {
  const [mode, ...rest] = argv;
  const steps: Step[] = [];
  if (mode === 'full' && rest.length === 0) {
    await full(steps);
  } else if (mode === 'preflight') {
    let base = 'origin/v2';
    const ids: string[] = [];
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i] ?? '';
      if (arg === '--base') {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith('-')) { process.stderr.write(USAGE); return 2; }
        base = next;
        i += 1;
      } else if (isRegistryId(arg)) ids.push(arg);
      else { process.stderr.write(`local-check: ${JSON.stringify(arg)} is not a registry id\n${USAGE}`); return 2; }
    }
    await preflight(base, ids, steps);
  } else {
    process.stderr.write(USAGE);
    return 2;
  }
  return summary(mode, steps) ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
